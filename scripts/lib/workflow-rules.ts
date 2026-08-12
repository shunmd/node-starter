/** Rules shared by workflow jobs and composite action manifests. */

/** `owner/repo@<full 40-character commit sha>` for an action step. */
const PINNED_ACTION = /^[^@\s]+\/[^@\s]+@[0-9a-f]{40}$/;

/** External reusable workflows use `owner/repo/.github/workflows/file.yml@sha`. */
const PINNED_REUSABLE_WORKFLOW =
  /^[^@\s/]+\/[^@\s/]+\/\.github\/workflows\/[^@\s]+@[0-9a-f]{40}$/;

/** The opening of any GitHub Actions expression. Forbidden inside `run:`. */
const EXPRESSION_OPEN = '${{';

const MAX_TIMEOUT_MINUTES = 30;
const CHECKOUT_ACTION = 'actions/checkout';
const BROAD_PERMISSIONS = new Set(['write-all', 'write']);

export interface WorkflowReferences {
  readonly localActionReferences: Set<string>;
  readonly localWorkflowReferences: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `./.github/actions/setup` and `.github/actions/setup` name the same thing. */
function normalizeLocalReference(reference: string): string {
  return reference.replace(/^\.\//, '').replace(/\/+$/, '');
}

function checkStepPinning(
  context: string,
  step: Record<string, unknown>,
  problems: string[],
  localReferences: Set<string>,
): void {
  const uses = step['uses'];
  if (typeof uses !== 'string') {
    return;
  }
  if (uses.startsWith('./')) {
    localReferences.add(normalizeLocalReference(uses));
    return;
  }
  if (!PINNED_ACTION.test(uses)) {
    problems.push(
      `${context} uses \`${uses}\`, which is not pinned to a full commit sha. A tag ` +
        `or branch can be re-pointed at different code after review.`,
    );
  }
}

function checkStepCheckoutCredentials(
  context: string,
  step: Record<string, unknown>,
  problems: string[],
): void {
  const uses = step['uses'];
  if (typeof uses !== 'string' || !uses.startsWith(`${CHECKOUT_ACTION}@`)) {
    return;
  }
  const withBlock = step['with'];
  if (!isRecord(withBlock) || withBlock['persist-credentials'] !== false) {
    problems.push(
      `${context} checks out without \`persist-credentials: false\`, leaving a usable ` +
        `token in .git/config for every later step, including dependency install scripts.`,
    );
  }
}

function checkStepRunInterpolation(
  context: string,
  step: Record<string, unknown>,
  problems: string[],
): void {
  const run = step['run'];
  if (typeof run === 'string' && run.includes(EXPRESSION_OPEN)) {
    problems.push(
      `${context} interpolates a \${{ }} expression directly into \`run:\`. The value is ` +
        `pasted into the shell before it executes, so anything that can influence it can run ` +
        `commands. Bind it to \`env:\` and reference the environment variable instead.`,
    );
  }
}

export function checkSteps(
  context: string,
  container: Record<string, unknown>,
  problems: string[],
  localReferences: Set<string>,
): void {
  const value = container['steps'];
  if (!Array.isArray(value)) {
    return;
  }
  for (const step of value.filter(isRecord)) {
    checkStepPinning(context, step, problems, localReferences);
    checkStepCheckoutCredentials(context, step, problems);
    checkStepRunInterpolation(context, step, problems);
  }
}

function permissionProblem(
  where: string,
  scope: string,
  granted: string,
  allowJobScopedOidc: boolean,
): string | undefined {
  if (scope !== 'id-token' || granted !== 'write' || allowJobScopedOidc) {
    return undefined;
  }
  return (
    `${where} grants \`id-token: write\`, which lets the job mint an OIDC identity for ` +
    `this repository. Grant it only in the job that needs to authenticate.`
  );
}

/**
 * Presence is not least privilege. A `permissions:` block that says `write-all`
 * grants exactly what an absent block grants, so checking only for absence
 * lets the broadest possible token through the gate that advertises the
 * narrowest.
 */
function checkPermissionsValue(
  where: string,
  value: unknown,
  problems: string[],
  allowJobScopedOidc = false,
): void {
  if (typeof value === 'string' && BROAD_PERMISSIONS.has(value)) {
    problems.push(
      `${where} declares \`permissions: ${value}\`, which grants every write scope at once. ` +
        `List the individual scopes the job needs.`,
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [scope, granted] of Object.entries(value)) {
    if (scope !== 'contents' && typeof granted === 'string') {
      const problem = permissionProblem(
        where,
        scope,
        granted,
        allowJobScopedOidc,
      );
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
}

function triggerNames(workflow: Record<string, unknown>): readonly string[] {
  const triggers = workflow['on'] ?? workflow['true'];
  if (typeof triggers === 'string') {
    return [triggers];
  }
  if (Array.isArray(triggers)) {
    return triggers.filter((name): name is string => typeof name === 'string');
  }
  if (isRecord(triggers)) {
    return Object.keys(triggers);
  }
  return [];
}

function checkTriggers(
  workflow: Record<string, unknown>,
  problems: string[],
): void {
  if (triggerNames(workflow).includes('pull_request_target')) {
    problems.push(
      'uses the pull_request_target trigger, which runs with a writable token in the ' +
        'context of the base repository while checking out code a fork controls. Use ' +
        'pull_request instead and pass anything privileged through a separate workflow.',
    );
  }
}

function checkTimeout(
  jobName: string,
  job: Record<string, unknown>,
  problems: string[],
): void {
  if (typeof job['uses'] === 'string') {
    return;
  }
  const timeout = job['timeout-minutes'];
  if (typeof timeout !== 'number') {
    problems.push(
      `job \`${jobName}\` does not set timeout-minutes, so a hung step occupies a runner ` +
        `for the six-hour default.`,
    );
    return;
  }
  if (timeout > MAX_TIMEOUT_MINUTES) {
    problems.push(
      `job \`${jobName}\` sets timeout-minutes to ${String(timeout)}; the limit is ` +
        `${String(MAX_TIMEOUT_MINUTES)}.`,
    );
  }
}

function checkReusableWorkflowUse(
  jobName: string,
  uses: string,
  problems: string[],
  references: WorkflowReferences,
): void {
  if (uses.startsWith('./')) {
    const reference = normalizeLocalReference(uses);
    if (reference.startsWith('.github/workflows/')) {
      references.localWorkflowReferences.add(reference);
    } else {
      problems.push(
        `job \`${jobName}\` uses local reusable workflow \`${uses}\`, which ` +
          `must be under .github/workflows/.`,
      );
    }
    return;
  }
  if (!PINNED_REUSABLE_WORKFLOW.test(uses)) {
    problems.push(
      `job \`${jobName}\` uses reusable workflow \`${uses}\`, which is not ` +
        `pinned to a full commit sha. A tag or branch can be re-pointed at ` +
        `different code after review.`,
    );
  }
}

export function checkJob(
  jobName: string,
  job: Record<string, unknown>,
  problems: string[],
  references: WorkflowReferences,
): void {
  checkTimeout(jobName, job, problems);
  checkPermissionsValue(
    `job \`${jobName}\``,
    job['permissions'],
    problems,
    true,
  );
  const uses = job['uses'];
  if (typeof uses === 'string') {
    checkReusableWorkflowUse(jobName, uses, problems, references);
  }
  checkSteps(
    `job \`${jobName}\``,
    job,
    problems,
    references.localActionReferences,
  );
}

export function checkWorkflowTriggersAndPermissions(
  workflow: Record<string, unknown>,
  problems: string[],
): void {
  checkTriggers(workflow, problems);
  if (workflow['permissions'] === undefined) {
    problems.push(
      'does not declare top-level `permissions`, so its jobs inherit whatever the ' +
        'repository default is. Declare the least privilege the workflow needs.',
    );
  }
  checkPermissionsValue('the workflow', workflow['permissions'], problems);
}
