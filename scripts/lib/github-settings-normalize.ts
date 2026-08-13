/**
 * Normalizes a desired-state JSON document and a live GitHub API response to
 * the same shape, and reports where they still disagree. Also the one place
 * that turns a git remote URL into a RepositoryReference, since that parse
 * is pure and worth testing on its own.
 */

import {
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from './github-settings-schema.ts';
import {
  pullRequestRuleFields,
  requiredStatusChecksParameterFields,
  type JsonObject,
  type RepositoryReference,
  type SecretManifestEntry,
} from './github-settings-types.ts';

export function parseRepositoryReference(
  remote: string,
): RepositoryReference | undefined {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    remote.trim(),
  );
  if (match === null) {
    return undefined;
  }
  const [, owner, name] = match;
  if (owner === undefined || name === undefined) {
    return undefined;
  }
  return { owner, name };
}

export function selectFields(
  object: JsonObject,
  fields: readonly string[],
): JsonObject {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (object[field] !== undefined) {
      selected[field] = object[field];
    }
  }
  return selected;
}

export function sortJson(value: unknown): unknown {
  if (isUnknownArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

export function comparableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function reportDrift(
  path: string,
  desired: unknown,
  actual: unknown,
  drifts: string[],
): void {
  if (comparableJson(desired) !== comparableJson(actual)) {
    drifts.push(
      `${path}\n  desired: ${comparableJson(desired)}\n  actual:  ${comparableJson(actual)}`,
    );
  }
}

function normalizeRulesetRule(rule: unknown): unknown {
  if (!isRecord(rule) || !isRecord(rule['parameters'])) {
    return rule;
  }
  if (rule['type'] === 'pull_request') {
    return {
      ...rule,
      parameters: selectFields(rule['parameters'], pullRequestRuleFields),
    };
  }
  if (rule['type'] !== 'required_status_checks') {
    return rule;
  }

  const parameters = selectFields(
    rule['parameters'],
    requiredStatusChecksParameterFields,
  );
  if (isUnknownArray(parameters['required_status_checks'])) {
    parameters['required_status_checks'] = parameters[
      'required_status_checks'
    ].map((statusCheck) => {
      if (!isRecord(statusCheck)) {
        return statusCheck;
      }
      return selectFields(statusCheck, ['context']);
    });
  }
  return { ...rule, parameters };
}

export function normalizeRulesetForComparison(value: JsonObject): JsonObject {
  const result: Record<string, unknown> = selectFields(value, [
    'name',
    'target',
    'enforcement',
    'bypass_actors',
    'conditions',
    'rules',
  ]);
  if (isUnknownArray(result['rules'])) {
    result['rules'] = result['rules'].map(normalizeRulesetRule);
  }
  return result;
}

export function normalizeEnvironmentForComparison(
  value: JsonObject,
): JsonObject {
  const protectionRules = isUnknownArray(value['protection_rules'])
    ? value['protection_rules']
    : [];
  const reviewersRule = protectionRules.find(
    (rule) => isRecord(rule) && rule['type'] === 'required_reviewers',
  );
  const reviewers =
    isRecord(reviewersRule) && isUnknownArray(reviewersRule['reviewers'])
      ? reviewersRule['reviewers'].flatMap((reviewer) => {
          if (!isRecord(reviewer) || !isRecord(reviewer['reviewer'])) {
            return [];
          }
          const actor = reviewer['reviewer'];
          if (!isString(actor['type']) || !isNumber(actor['id'])) {
            return [];
          }
          return [{ type: actor['type'], id: actor['id'] }];
        })
      : [];
  return {
    wait_timer: value['wait_timer'],
    prevent_self_review: value['prevent_self_review'],
    reviewers,
    deployment_branch_policy: value['deployment_branch_policy'],
  };
}

export function environmentBody(environment: JsonObject): JsonObject {
  const body: Record<string, unknown> = { ...environment };
  delete body['environment'];
  return body;
}

export function secretNames(value: unknown): readonly string[] {
  if (!isRecord(value) || !isUnknownArray(value['secrets'])) {
    return [];
  }
  return value['secrets'].flatMap((secret) => {
    if (!isRecord(secret) || !isString(secret['name'])) {
      return [];
    }
    return [secret['name']];
  });
}

export function checkRequiredSecrets(
  scope: string,
  entries: readonly SecretManifestEntry[],
  actualNames: readonly string[],
  drifts: string[],
): void {
  for (const entry of entries) {
    if (entry.required && !actualNames.includes(entry.name)) {
      drifts.push(`${scope} secret ${entry.name} is missing`);
    }
  }
}
