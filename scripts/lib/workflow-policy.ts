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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYaml(source: string): unknown {
  return parse(source) as unknown;
}

/**
 * YAML 1.1 readers turn a bare `on` key into the boolean `true`. The parser
 * used here follows YAML 1.2 and keeps it a string, but reading both means a
 * parser change cannot silently disable the trigger rules.
 */
function readTriggers(workflow: Record<string, unknown>): unknown {
  return workflow['on'] ?? workflow['true'];
}

function triggerNames(workflow: Record<string, unknown>): readonly string[] {
  const triggers = readTriggers(workflow);
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

function checkTopLevelPermissions(
  workflow: Record<string, unknown>,
  problems: string[],
): void {
  const permissions = workflow['permissions'];
  if (permissions === undefined) {
    problems.push(
      'does not declare top-level `permissions`, so its jobs inherit whatever the ' +
        'repository default is. Declare the least privilege the workflow needs.',
    );
  }
}

function steps(
  job: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const value = job['steps'];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function checkTimeout(
  jobName: string,
  job: Record<string, unknown>,
  problems: string[],
): void {
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

function checkStepPinning(
  jobName: string,
  step: Record<string, unknown>,
  problems: string[],
): void {
  const uses = step['uses'];
  if (typeof uses !== 'string' || uses.startsWith('./')) {
    return;
  }
  if (!PINNED_ACTION.test(uses)) {
    problems.push(
      `job \`${jobName}\` uses \`${uses}\`, which is not pinned to a full commit sha. A tag ` +
        `or branch can be re-pointed at different code after review.`,
    );
  }
}

function checkStepCheckoutCredentials(
  jobName: string,
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
      `job \`${jobName}\` checks out without \`persist-credentials: false\`, leaving a usable ` +
        `token in .git/config for every later step, including dependency install scripts.`,
    );
  }
}

function checkStepRunInterpolation(
  jobName: string,
  step: Record<string, unknown>,
  problems: string[],
): void {
  const run = step['run'];
  if (typeof run === 'string' && run.includes(EXPRESSION_OPEN)) {
    problems.push(
      `job \`${jobName}\` interpolates a \${{ }} expression directly into \`run:\`. The value is ` +
        `pasted into the shell before it executes, so anything that can influence it can run ` +
        `commands. Bind it to \`env:\` and reference the environment variable instead.`,
    );
  }
}

function checkJob(
  jobName: string,
  job: Record<string, unknown>,
  problems: string[],
): void {
  checkTimeout(jobName, job, problems);
  for (const step of steps(job)) {
    checkStepPinning(jobName, step, problems);
    checkStepCheckoutCredentials(jobName, step, problems);
    checkStepRunInterpolation(jobName, step, problems);
  }
}

/**
 * Returns one message per violation, each already phrased as a sentence that
 * follows the workflow's path.
 */
export function checkWorkflow(source: string): readonly string[] {
  const problems: string[] = [];

  let workflow: unknown;
  try {
    workflow = parseYaml(source);
  } catch (error: unknown) {
    return [
      `is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (!isRecord(workflow)) {
    return ['does not contain a YAML mapping at the top level'];
  }

  checkTriggers(workflow, problems);
  checkTopLevelPermissions(workflow, problems);

  const jobs = workflow['jobs'];
  if (!isRecord(jobs)) {
    problems.push('declares no `jobs` mapping');
    return problems;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isRecord(job)) {
      problems.push(`job \`${jobName}\` is not a mapping`);
      continue;
    }
    checkJob(jobName, job, problems);
  }

  return problems;
}

export interface WorkflowSource {
  readonly path: string;
  readonly source: string;
}

/** Prefixes each workflow's problems with the file they belong to. */
export function checkWorkflows(
  workflows: readonly WorkflowSource[],
): readonly string[] {
  if (workflows.length === 0) {
    return ['No workflow files were found under .github/workflows.'];
  }
  return workflows.flatMap((workflow) =>
    checkWorkflow(workflow.source).map(
      (problem) => `${workflow.path} ${problem}`,
    ),
  );
}
