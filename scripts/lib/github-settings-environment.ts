/**
 * Structural validation for environments/*.json and secrets-manifest.json.
 * Split from github-settings-schema.ts only to stay under the repository's
 * 300-line file cap; the validation style is identical.
 */

import {
  assertAllowedKeys,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
  readRequiredString,
} from './github-settings-schema.ts';
import type {
  JsonObject,
  SecretManifest,
  SecretManifestEntry,
} from './github-settings-types.ts';

function validateEnvironmentReviewers(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isUnknownArray(value)) {
    errors.push(`${path}.reviewers must be an array`);
    return;
  }
  for (const [index, reviewer] of value.entries()) {
    if (
      !isRecord(reviewer) ||
      !new Set(['User', 'Team']).has(String(reviewer['type'])) ||
      !isNumber(reviewer['id']) ||
      !Number.isInteger(reviewer['id'])
    ) {
      errors.push(
        `${path}.reviewers[${String(index)}] must contain a User or Team type and integer id`,
      );
    }
  }
}

function validateEnvironmentPolicy(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path}.deployment_branch_policy must be an object`);
    return;
  }
  const protectedBranches = value['protected_branches'];
  const customBranchPolicies = value['custom_branch_policies'];
  if (!isBoolean(protectedBranches) || !isBoolean(customBranchPolicies)) {
    errors.push(`${path}.deployment_branch_policy flags must be booleans`);
  } else if (protectedBranches === customBranchPolicies) {
    errors.push(
      `${path}.deployment_branch_policy must enable exactly one policy`,
    );
  }
}

export function validateEnvironment(
  value: unknown,
  path: string,
  errors: string[],
): JsonObject | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must contain a JSON object`);
    return undefined;
  }
  assertAllowedKeys(
    value,
    new Set([
      'environment',
      'wait_timer',
      'prevent_self_review',
      'reviewers',
      'deployment_branch_policy',
    ]),
    path,
    errors,
  );
  const environment = readRequiredString(value, 'environment', path, errors);
  if (
    value['wait_timer'] !== undefined &&
    (!isNumber(value['wait_timer']) || value['wait_timer'] < 0)
  ) {
    errors.push(`${path}['wait_timer'] must be a non-negative number`);
  }
  if (
    value['prevent_self_review'] !== undefined &&
    !isBoolean(value['prevent_self_review'])
  ) {
    errors.push(`${path}['prevent_self_review'] must be a boolean`);
  }
  validateEnvironmentReviewers(value['reviewers'], path, errors);
  validateEnvironmentPolicy(value['deployment_branch_policy'], path, errors);
  return environment === undefined ? undefined : value;
}

function validateSecretEntry(
  value: unknown,
  path: string,
  errors: string[],
): SecretManifestEntry | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  assertAllowedKeys(
    value,
    new Set(['name', 'required', 'purpose']),
    path,
    errors,
  );
  const name = readRequiredString(value, 'name', path, errors);
  if (!isBoolean(value['required'])) {
    errors.push(`${path}['required'] must be a boolean`);
  }
  if (!isString(value['purpose']) || value['purpose'].length === 0) {
    errors.push(`${path}['purpose'] must be a non-empty string`);
  }
  if (name === undefined || !isBoolean(value['required'])) {
    return undefined;
  }
  return { name, required: value['required'] };
}

function validateSecretEntries(
  value: unknown,
  path: string,
  errors: string[],
): SecretManifestEntry[] {
  if (!isUnknownArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const entries: SecretManifestEntry[] = [];
  for (const [index, entry] of value.entries()) {
    const validEntry = validateSecretEntry(
      entry,
      `${path}[${String(index)}]`,
      errors,
    );
    if (validEntry !== undefined) {
      entries.push(validEntry);
    }
  }
  return entries;
}

function validateEnvironmentSecretEntries(
  value: unknown,
  errors: string[],
): Record<string, readonly SecretManifestEntry[]> {
  if (!isRecord(value)) {
    errors.push('secrets-manifest.json.environments must be an object');
    return {};
  }
  const environments: Record<string, readonly SecretManifestEntry[]> = {};
  for (const [environment, entries] of Object.entries(value)) {
    environments[environment] = validateSecretEntries(
      entries,
      `secrets-manifest.json.environments.${environment}`,
      errors,
    );
  }
  return environments;
}

export function validateSecrets(
  value: unknown,
  errors: string[],
): SecretManifest | undefined {
  if (!isRecord(value)) {
    errors.push('secrets-manifest.json must contain a JSON object');
    return undefined;
  }
  assertAllowedKeys(
    value,
    new Set(['repository', 'environments']),
    'secrets-manifest.json',
    errors,
  );
  const repository = validateSecretEntries(
    value['repository'],
    'secrets-manifest.json.repository',
    errors,
  );
  const environments = validateEnvironmentSecretEntries(
    value['environments'],
    errors,
  );

  return { repository, environments };
}
