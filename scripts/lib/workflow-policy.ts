/**
 * Treats GitHub Actions workflows as code that has to pass review, because
 * nothing else in this repository did.
 *
 * A workflow is the most privileged code here: it runs with a token, on a
 * runner, against the repository itself. The failure modes are not the ones
 * ESLint looks for -- a mutable action tag that is re-pointed at new code, a
 * pull request title interpolated straight into a shell, a checkout that
 * leaves a credential behind for later steps. Each rule below is one of those,
 * expressed as a property of the parsed workflow rather than as a sentence in
 * a document.
 *
 * Composite actions under `.github/actions/` are checked with the same step
 * rules and by the same run. A local `uses: ./...` reference is only accepted
 * when the manifest it points at was one of the files scanned -- otherwise the
 * rules would stop at the workflow boundary, and an unpinned action one level
 * down would run in CI having passed the gate.
 *
 * The rules are deliberately absolute. Every one of them has a supported
 * alternative that is no harder to write, so there is no case for a per-file
 * escape hatch.
 */

import { parse } from 'yaml';

/** `owner/repo@<full 40-character commit sha>`, or a local `./path` action. */
const PINNED_ACTION = /^[^@\s]+\/[^@\s]+@[0-9a-f]{40}$/;

/** The opening of any GitHub Actions expression. Forbidden inside `run:`. */
const EXPRESSION_OPEN = '${{';

const MAX_TIMEOUT_MINUTES = 30;

const CHECKOUT_ACTION = 'actions/checkout';

/**
 * The shorthands that grant every scope at once. `permissions: write-all` is
 * the same token a workflow with no `permissions:` block gets, written down.
 */
const BROAD_PERMISSIONS = new Set(['write-all', 'write']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYaml(source: string): unknown {
  return parse(source) as unknown;
}

/** `./.github/actions/setup` and `.github/actions/setup` name the same thing. */
function normalizeLocalReference(reference: string): string {
  return reference.replace(/^\.\//, '').replace(/\/+$/, '');
}

// --- Steps ------------------------------------------------------------------
//
// Identical whether the step is in a workflow job or in a composite action, so
// they take a context string rather than a job name.

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

function checkSteps(
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

// --- Permissions ------------------------------------------------------------

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
    if (scope === 'contents' || typeof granted !== 'string') {
      continue;
    }
    if (granted === 'write' && scope === 'id-token') {
      problems.push(
        `${where} grants \`id-token: write\`, which lets the job mint an OIDC identity for ` +
          `this repository. Grant it only in the job that needs to authenticate.`,
      );
    }
  }
}

// --- Triggers ---------------------------------------------------------------

/**
 * YAML 1.1 readers turn a bare `on` key into the boolean `true`. The parser
 * used here follows YAML 1.2 and keeps it a string, but reading both means a
 * parser change cannot silently disable the trigger rules.
 */
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

// --- Jobs -------------------------------------------------------------------

/**
 * A job that calls a reusable workflow through `uses:` cannot carry
 * `timeout-minutes` -- GitHub rejects the workflow if it does. The timeout for
 * that work belongs in the called workflow, which this check reaches on its own
 * when the callee is local.
 */
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

function checkJob(
  jobName: string,
  job: Record<string, unknown>,
  problems: string[],
  localReferences: Set<string>,
): void {
  checkTimeout(jobName, job, problems);
  checkPermissionsValue(`job \`${jobName}\``, job['permissions'], problems);
  const uses = job['uses'];
  if (typeof uses === 'string' && uses.startsWith('./')) {
    localReferences.add(normalizeLocalReference(uses));
  }
  checkSteps(`job \`${jobName}\``, job, problems, localReferences);
}

// --- Documents --------------------------------------------------------------

export interface PolicySource {
  readonly path: string;
  readonly source: string;
}

interface DocumentResult {
  readonly problems: readonly string[];
  readonly localReferences: ReadonlySet<string>;
}

function parseDocument(
  source: string,
): Record<string, unknown> | readonly string[] {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error: unknown) {
    return [
      `is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (!isRecord(document)) {
    return ['does not contain a YAML mapping at the top level'];
  }
  return document;
}

/** Returns one message per violation, each phrased to follow the file's path. */
export function checkWorkflow(source: string): DocumentResult {
  const parsed = parseDocument(source);
  if (Array.isArray(parsed)) {
    return { problems: parsed, localReferences: new Set() };
  }
  const workflow = parsed as Record<string, unknown>;

  const problems: string[] = [];
  const localReferences = new Set<string>();

  checkTriggers(workflow, problems);
  if (workflow['permissions'] === undefined) {
    problems.push(
      'does not declare top-level `permissions`, so its jobs inherit whatever the ' +
        'repository default is. Declare the least privilege the workflow needs.',
    );
  }
  checkPermissionsValue('the workflow', workflow['permissions'], problems);

  const jobs = workflow['jobs'];
  if (!isRecord(jobs)) {
    problems.push('declares no `jobs` mapping');
    return { problems, localReferences };
  }
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isRecord(job)) {
      problems.push(`job \`${jobName}\` is not a mapping`);
      continue;
    }
    checkJob(jobName, job, problems, localReferences);
  }
  return { problems, localReferences };
}

/** The same step rules, applied to a composite action's `runs.steps`. */
export function checkActionManifest(source: string): DocumentResult {
  const parsed = parseDocument(source);
  if (Array.isArray(parsed)) {
    return { problems: parsed, localReferences: new Set() };
  }
  const manifest = parsed as Record<string, unknown>;

  const problems: string[] = [];
  const localReferences = new Set<string>();
  const runs = manifest['runs'];
  if (!isRecord(runs)) {
    problems.push('declares no `runs` mapping');
    return { problems, localReferences };
  }
  checkSteps('this action', runs, problems, localReferences);
  return { problems, localReferences };
}

/**
 * @param workflows - every file under `.github/workflows`.
 * @param actions - every `action.yml` under `.github/actions`, keyed by the
 *   directory a workflow would reference (`.github/actions/setup`).
 */
export function checkWorkflows(
  workflows: readonly PolicySource[],
  actions: readonly PolicySource[] = [],
): readonly string[] {
  if (workflows.length === 0) {
    return ['No workflow files were found under .github/workflows.'];
  }

  const problems: string[] = [];
  const referenced = new Set<string>();
  const scanned = new Set(actions.map((action) => action.path));

  for (const document of [...workflows, ...actions]) {
    const isAction = scanned.has(document.path);
    const result = isAction
      ? checkActionManifest(document.source)
      : checkWorkflow(document.source);
    for (const problem of result.problems) {
      problems.push(`${document.path} ${problem}`);
    }
    for (const reference of result.localReferences) {
      referenced.add(reference);
    }
  }

  for (const reference of referenced) {
    if (!scanned.has(reference)) {
      problems.push(
        `A workflow references the local action \`./${reference}\`, which was not among the ` +
          `scanned manifests. Its steps would run in CI without passing these rules; put the ` +
          `action under .github/actions/ so it is checked too.`,
      );
    }
  }

  return problems;
}
