/**
 * The half of the gate contract that reads `.github/workflows/ci.yml` and
 * `infra/github/rulesets/main.json`: are the required CI jobs still present,
 * not disabled or exempted from failing, not narrowed by a path filter that
 * could skip them on a pull request, and still the exact set the ruleset's
 * required status checks name.
 *
 * Split out of `gate-contract.ts` the same way `workflow-rules.ts` is split
 * out of `workflow-policy.ts`: one file per document format, one export per
 * question, kept small enough to stay under this repository's own size limit
 * for `scripts/lib/`.
 */

import { parse } from 'yaml';

const CHECK_JOB = 'check';
const MUTATION_JOB = 'mutation';
const REQUIRED_CI_JOBS = [CHECK_JOB, MUTATION_JOB] as const;

/**
 * The command each required job must still run. A job that exists, is enabled
 * and reports its name is not evidence of anything if the step that did the
 * work was deleted: the substring is matched against the job's `run` steps,
 * because the mutation job wraps its command in a shell script.
 */
const REQUIRED_CI_JOB_COMMANDS: Readonly<Record<string, string>> = {
  [CHECK_JOB]: 'pnpm verify',
  [MUTATION_JOB]: 'pnpm test:mutation',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseWorkflow(source: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = parse(source) as unknown;
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}

function jobsOf(workflow: Record<string, unknown>): Record<string, unknown> {
  return isRecord(workflow['jobs']) ? workflow['jobs'] : {};
}

/**
 * The name GitHub reports a job under, which is what a ruleset's required
 * status check matches. `name:` wins when present; the job key is only the
 * fallback. Comparing contexts against job keys would pass a workflow whose
 * `name:` was changed, leaving `main` waiting forever for a check nothing
 * reports.
 */
function reportedName(job: unknown, jobKey: string): string {
  return isRecord(job) && typeof job['name'] === 'string' && job['name'] !== ''
    ? job['name']
    : jobKey;
}

function runSteps(job: Record<string, unknown>): readonly string[] {
  const steps = job['steps'];
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps.flatMap((step) =>
    isRecord(step) && typeof step['run'] === 'string' ? [step['run']] : [],
  );
}

function checkRequiredJob(
  jobName: string,
  jobs: Record<string, unknown>,
): readonly string[] {
  const job = jobs[jobName];
  if (!isRecord(job)) {
    return [`ci.yml is missing the required "${jobName}" job.`];
  }
  const problems: string[] = [];
  if (job['if'] === false || job['if'] === 'false') {
    problems.push(`ci.yml job "${jobName}" is disabled with if: false.`);
  }
  if (job['continue-on-error'] === true) {
    problems.push(
      `ci.yml job "${jobName}" sets continue-on-error: true, so its failure would not fail the workflow.`,
    );
  }
  const command = REQUIRED_CI_JOB_COMMANDS[jobName];
  if (
    command !== undefined &&
    !runSteps(job).some((run) => run.includes(command))
  ) {
    problems.push(
      `ci.yml job "${jobName}" no longer runs \`${command}\`, so the job could report success without running the gate.`,
    );
  }
  return problems;
}

function checkTriggerPaths(
  workflow: Record<string, unknown>,
): readonly string[] {
  const on = workflow['on'] ?? workflow['true'];
  const trigger = isRecord(on) ? on['pull_request'] : undefined;
  if (!isRecord(trigger)) {
    return [];
  }
  if (trigger['paths'] !== undefined || trigger['paths-ignore'] !== undefined) {
    return [
      'ci.yml restricts the pull_request trigger with paths/paths-ignore, so a change ' +
        'outside that filter would merge without the required check and mutation jobs running.',
    ];
  }
  return [];
}

export function checkCiWorkflowContract(
  ciWorkflowSource: string,
): readonly string[] {
  const workflow = parseWorkflow(ciWorkflowSource);
  if (workflow === undefined) {
    return ['ci.yml is not valid YAML with a top-level mapping.'];
  }
  return [
    ...REQUIRED_CI_JOBS.flatMap((jobName) =>
      checkRequiredJob(jobName, jobsOf(workflow)),
    ),
    ...checkTriggerPaths(workflow),
  ];
}

function requiredStatusContexts(mainRulesetConfig: unknown): readonly string[] {
  if (!isRecord(mainRulesetConfig)) {
    return [];
  }
  const rules = mainRulesetConfig['rules'];
  if (!Array.isArray(rules)) {
    return [];
  }
  for (const rule of rules) {
    if (!isRecord(rule) || rule['type'] !== 'required_status_checks') {
      continue;
    }
    const parameters = rule['parameters'];
    const statusChecks = isRecord(parameters)
      ? parameters['required_status_checks']
      : undefined;
    if (!Array.isArray(statusChecks)) {
      continue;
    }
    return statusChecks.flatMap((check) =>
      isRecord(check) && typeof check['context'] === 'string'
        ? [check['context']]
        : [],
    );
  }
  return [];
}

export function checkRequiredStatusChecksMatchJobs(
  mainRulesetConfig: unknown,
  ciWorkflowSource: string,
): readonly string[] {
  const contexts = requiredStatusContexts(mainRulesetConfig);
  const workflow = parseWorkflow(ciWorkflowSource);
  const jobs = workflow === undefined ? {} : jobsOf(workflow);
  const reportedNames = Object.entries(jobs).map(([jobKey, job]) =>
    reportedName(job, jobKey),
  );
  return [
    ...REQUIRED_CI_JOBS.filter(
      (jobKey) => !contexts.includes(reportedName(jobs[jobKey], jobKey)),
    ).map(
      (jobKey) =>
        `rulesets/main.json does not require the "${reportedName(jobs[jobKey], jobKey)}" status check that ci.yml's "${jobKey}" job reports.`,
    ),
    ...contexts
      .filter((context) => !reportedNames.includes(context))
      .map(
        (context) =>
          `rulesets/main.json requires status check "${context}", but no ci.yml job reports that name.`,
      ),
  ];
}
