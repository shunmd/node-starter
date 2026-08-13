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

function jobSteps(document: unknown, job: string): readonly unknown[] {
  if (!isRecord(document) || !isRecord(document['jobs'])) {
    return [];
  }
  const jobValue = document['jobs'][job];
  if (!isRecord(jobValue) || !isUnknownArray(jobValue['steps'])) {
    return [];
  }
  return jobValue['steps'];
}

function jobRunsCommand(
  document: unknown,
  job: string,
  command: string,
): boolean {
  return jobSteps(document, job).some(
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

  for (const job of requiredMainStatusChecks) {
    if (!isRecord(document['jobs'][job])) {
      errors.push(
        `ci.yml must define a ${job} job required by rulesets/main.json`,
      );
    }
  }

  for (const [job, command] of Object.entries(ciWorkflowJobCommands)) {
    if (
      isRecord(document['jobs'][job]) &&
      !jobRunsCommand(document, job, command)
    ) {
      errors.push(`ci.yml job ${job} must run \`${command}\``);
    }
  }

  return errors;
}
