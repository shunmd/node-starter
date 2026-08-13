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
  return [
    ...REQUIRED_CI_JOBS.filter((jobName) => !contexts.includes(jobName)).map(
      (jobName) =>
        `rulesets/main.json does not require the "${jobName}" status check that ci.yml defines.`,
    ),
    ...contexts
      .filter((context) => !(context in jobs))
      .map(
        (context) =>
          `rulesets/main.json requires status check "${context}", but ci.yml has no job with that name.`,
      ),
  ];
}
