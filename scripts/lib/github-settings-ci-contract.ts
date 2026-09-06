/**
 * Confirms `ci.yml` actually backs every status check `main.json` requires.
 * A ruleset can require a context by name with no job ever reporting it;
 * this is what makes that combination fail closed at `--check` instead of
 * hanging forever as an "expected" status.
 */

import { parse } from 'yaml';

import {
  isRecord,
  isString,
  isUnknownArray,
} from './github-settings-schema.ts';
import {
  ciWorkflowJobCommands,
  requiredMainStatusChecks,
} from './github-settings-types.ts';

/**
 * Finds the job that reports a given status-check context. GitHub reports a
 * job under its `name:` when it has one, so a ruleset context is matched
 * against that first and against the job key only as the fallback -- a
 * renamed job would otherwise leave `main` requiring a check nothing reports.
 */
function findJobReporting(
  document: unknown,
  context: string,
): Record<string, unknown> | undefined {
  if (!isRecord(document) || !isRecord(document['jobs'])) {
    return undefined;
  }
  const jobs = Object.entries(document['jobs']).filter(
    (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
  );
  return (
    jobs.find(([, job]) => job['name'] === context)?.[1] ??
    jobs.find(
      ([jobKey, job]) => jobKey === context && !isString(job['name']),
    )?.[1]
  );
}

function jobSteps(document: unknown, context: string): readonly unknown[] {
  const job = findJobReporting(document, context);
  if (job === undefined || !isUnknownArray(job['steps'])) {
    return [];
  }
  return job['steps'];
}

function jobRunsCommand(
  document: unknown,
  context: string,
  command: string,
): boolean {
  return jobSteps(document, context).some(
    (step) =>
      isRecord(step) && isString(step['run']) && step['run'].trim() === command,
  );
}

export function validateCiWorkflowContract(source: string): readonly string[] {
  const errors: string[] = [];
  let document: unknown;
  try {
    document = parse(source) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return [`ci.yml is not valid YAML: ${message}`];
  }

  if (!isRecord(document) || !isRecord(document['jobs'])) {
    return ['ci.yml must define a jobs map'];
  }

  for (const context of requiredMainStatusChecks) {
    if (findJobReporting(document, context) === undefined) {
      errors.push(
        `ci.yml must define a job reporting the ${context} status check required by rulesets/main.json`,
      );
    }
  }

  for (const [context, command] of Object.entries(ciWorkflowJobCommands)) {
    if (
      findJobReporting(document, context) !== undefined &&
      !jobRunsCommand(document, context, command)
    ) {
      errors.push(`ci.yml job ${context} must run \`${command}\``);
    }
  }

  return errors;
}
