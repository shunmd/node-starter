import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryFields = [
  'default_branch',
  'has_issues',
  'has_projects',
  'has_wiki',
  'allow_squash_merge',
  'allow_merge_commit',
  'allow_rebase_merge',
  'allow_auto_merge',
  'delete_branch_on_merge',
  'use_squash_pr_title_as_default',
  'squash_merge_commit_title',
  'squash_merge_commit_message',
] as const;

const repositoryBooleanFields = new Set([
  'has_issues',
  'has_projects',
  'has_wiki',
  'allow_squash_merge',
  'allow_merge_commit',
  'allow_rebase_merge',
  'allow_auto_merge',
  'delete_branch_on_merge',
  'use_squash_pr_title_as_default',
]);

const repositoryStringFields = new Set([
  'default_branch',
  'squash_merge_commit_title',
  'squash_merge_commit_message',
]);

const rulesetRuleTypes = new Set([
  'deletion',
  'non_fast_forward',
  'pull_request',
  'required_status_checks',
]);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const githubRoot = join(repositoryRoot, 'infra', 'github');
const apiVersion = '2022-11-28';

type JsonObject = Record<string, unknown>;

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

interface RepositoryReference {
  readonly owner: string;
  readonly name: string;
}

interface RulesetSummary {
  readonly id: number;
  readonly name: string;
}

interface EnvironmentSummary {
  readonly name: string;
}

interface SecretManifestEntry {
  readonly name: string;
  readonly required: boolean;
}

interface SecretManifest {
  readonly repository: readonly SecretManifestEntry[];
  readonly environments: Readonly<
    Record<string, readonly SecretManifestEntry[]>
  >;
}

interface DesiredConfiguration {
  readonly repository: JsonObject;
  readonly rulesets: readonly JsonObject[];
  readonly environments: readonly JsonObject[];
  readonly secrets: SecretManifest;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !isUnknownArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return isUnknownArray(value) && value.every(isString);
}

function readRequiredString(
  object: JsonObject,
  key: string,
  context: string,
  errors: string[],
): string | undefined {
  const value = object[key];
  if (!isString(value) || value.length === 0) {
    errors.push(`${context}.${key} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function readJsonFile(path: string): Promise<unknown> {
  return readFile(path, 'utf8').then(
    (content) => JSON.parse(content) as unknown,
  );
}

function assertAllowedKeys(
  object: JsonObject,
  allowed: ReadonlySet<string>,
  context: string,
  errors: string[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      errors.push(`${context}.${key} is not supported`);
    }
  }
}

function validateRepository(
  value: unknown,
  errors: string[],
): JsonObject | undefined {
  if (!isRecord(value)) {
    errors.push('repository-settings.json must contain a JSON object');
    return undefined;
  }

  assertAllowedKeys(
    value,
    new Set(repositoryFields),
    'repository-settings.json',
    errors,
  );

  for (const field of repositoryFields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) {
      errors.push(`repository-settings.json.${field} is required`);
      continue;
    }
    if (repositoryBooleanFields.has(field) && !isBoolean(fieldValue)) {
      errors.push(`repository-settings.json.${field} must be a boolean`);
    }
    if (repositoryStringFields.has(field) && !isString(fieldValue)) {
      errors.push(`repository-settings.json.${field} must be a string`);
    }
  }

  return value;
}

function validateRulesetConditions(
  value: JsonObject,
  path: string,
  errors: string[],
): void {
  const conditions = value['conditions'];
  if (!isRecord(conditions)) {
    errors.push(`${path}.conditions must be an object`);
    return;
  }
  const refName = conditions['ref_name'];
  if (!isRecord(refName)) {
    errors.push(`${path}.conditions.ref_name must be an object`);
    return;
  }
  if (
    !isStringArray(refName['include']) ||
    !isStringArray(refName['exclude'])
  ) {
    errors.push(
      `${path}.conditions.ref_name include and exclude must be string arrays`,
    );
  }
}

function validateRulesetRules(
  value: JsonObject,
  path: string,
  errors: string[],
): void {
  const rules = value['rules'];
  if (!isUnknownArray(rules) || rules.length === 0) {
    errors.push(`${path}.rules must be a non-empty array`);
    return;
  }
  for (const [index, rule] of rules.entries()) {
    if (
      !isRecord(rule) ||
      !isString(rule['type']) ||
      !rulesetRuleTypes.has(rule['type'])
    ) {
      errors.push(`${path}.rules[${String(index)}] has an unsupported type`);
    }
  }
}

function validateRuleset(
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
      'name',
      'target',
      'enforcement',
      'bypass_actors',
      'conditions',
      'rules',
    ]),
    path,
    errors,
  );
  const name = readRequiredString(value, 'name', path, errors);
  const target = readRequiredString(value, 'target', path, errors);
  const enforcement = readRequiredString(value, 'enforcement', path, errors);
  if (target !== undefined && !new Set(['branch', 'tag', 'push']).has(target)) {
    errors.push(`${path}.target must be branch, tag, or push`);
  }
  if (
    enforcement !== undefined &&
    !new Set(['active', 'disabled', 'evaluate']).has(enforcement)
  ) {
    errors.push(`${path}.enforcement must be active, disabled, or evaluate`);
  }

  if (!isUnknownArray(value['bypass_actors'])) {
    errors.push(`${path}['bypass_actors'] must be an array`);
  }
  validateRulesetConditions(value, path, errors);
  validateRulesetRules(value, path, errors);

  return name === undefined ? undefined : value;
}

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

function validateEnvironment(
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

function validateSecrets(
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

function getRequiredStatusContexts(ruleset: JsonObject): readonly string[] {
  if (!isUnknownArray(ruleset['rules'])) {
    return [];
  }
  for (const rule of ruleset['rules']) {
    if (
      !isRecord(rule) ||
      rule['type'] !== 'required_status_checks' ||
      !isRecord(rule['parameters'])
    ) {
      continue;
    }
    if (!isUnknownArray(rule['parameters']['required_status_checks'])) {
      return [];
    }
    return rule['parameters']['required_status_checks'].flatMap(
      (statusCheck) => {
        if (!isRecord(statusCheck) || !isString(statusCheck['context'])) {
          return [];
        }
        return [statusCheck['context']];
      },
    );
  }
  return [];
}

interface CliOptions {
  readonly check: boolean;
  readonly remote: boolean;
  readonly apply: boolean;
}

async function readConfigurationFiles(): Promise<
  readonly [unknown, unknown, unknown, unknown]
> {
  try {
    return await Promise.all([
      readJsonFile(join(githubRoot, 'repository-settings.json')),
      readJsonFile(join(githubRoot, 'rulesets', 'main.json')),
      readJsonFile(join(githubRoot, 'environments', 'production.json')),
      readJsonFile(join(githubRoot, 'secrets-manifest.json')),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read GitHub infrastructure JSON: ${message}`, {
      cause: error,
    });
  }
}

function validateConfigurationValues(
  repositoryValue: unknown,
  rulesetValue: unknown,
  environmentValue: unknown,
  secretValue: unknown,
): DesiredConfiguration {
  const errors: string[] = [];
  const repository = validateRepository(repositoryValue, errors);
  const ruleset = validateRuleset(rulesetValue, 'rulesets/main.json', errors);
  const environment = validateEnvironment(
    environmentValue,
    'environments/production.json',
    errors,
  );
  const secrets = validateSecrets(secretValue, errors);

  if (ruleset !== undefined) {
    const expectedChecks = getRequiredStatusContexts(ruleset);
    if (
      !expectedChecks.includes('check') ||
      !expectedChecks.includes('mutation')
    ) {
      errors.push(
        'rulesets/main.json must require both check and mutation status checks',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid GitHub infrastructure configuration:\n- ${errors.join('\n- ')}`,
    );
  }
  if (
    repository === undefined ||
    ruleset === undefined ||
    environment === undefined ||
    secrets === undefined
  ) {
    throw new Error('Invalid GitHub infrastructure configuration');
  }
  return {
    repository,
    rulesets: [ruleset],
    environments: [environment],
    secrets,
  };
}

async function loadConfiguration(): Promise<DesiredConfiguration> {
  const [repositoryValue, rulesetValue, environmentValue, secretValue] =
    await readConfigurationFiles();
  return validateConfigurationValues(
    repositoryValue,
    rulesetValue,
    environmentValue,
    secretValue,
  );
}

function getStringEnvironmentVariable(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseRepositoryReference(
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

async function getRepositoryReference(): Promise<RepositoryReference> {
  const configured = getStringEnvironmentVariable('GITHUB_REPOSITORY');
  if (configured !== undefined) {
    const [owner, name] = configured.split('/');
    if (
      owner !== undefined &&
      name !== undefined &&
      owner.length > 0 &&
      name.length > 0
    ) {
      return { owner, name };
    }
    throw new Error(
      `GITHUB_REPOSITORY must use OWNER/REPOSITORY format: ${configured}`,
    );
  }

  const gitConfig = await readFile(
    join(repositoryRoot, '.git', 'config'),
    'utf8',
  );
  const origin = /\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*([^\n]+)/.exec(
    gitConfig,
  );
  const reference =
    origin === null ? undefined : parseRepositoryReference(origin[1] ?? '');
  if (reference === undefined) {
    throw new Error(
      'Unable to determine the GitHub repository from GITHUB_REPOSITORY or origin',
    );
  }
  return reference;
}

function getToken(): string {
  const token =
    getStringEnvironmentVariable('GH_TOKEN') ??
    getStringEnvironmentVariable('GITHUB_TOKEN');
  if (token === undefined) {
    throw new Error('Remote operations require GH_TOKEN or GITHUB_TOKEN');
  }
  return token;
}

function apiUrl(reference: RepositoryReference, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}${path}`;
}

async function request(
  reference: RepositoryReference,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<ApiResponse> {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${getToken()}`,
    'X-GitHub-Api-Version': apiVersion,
  });
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const requestInit: RequestInit = { method, headers };
  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }
  const response = await fetch(apiUrl(reference, path), requestInit);
  const responseBody: unknown = await response.json();
  return { status: response.status, body: responseBody };
}

function requireApiSuccess(response: ApiResponse, operation: string): unknown {
  if (response.status < 200 || response.status >= 300) {
    const detail =
      isRecord(response.body) && isString(response.body['message'])
        ? response.body['message']
        : JSON.stringify(response.body);
    throw new Error(
      `${operation} failed with HTTP ${String(response.status)}: ${detail}`,
    );
  }
  return response.body;
}

function selectFields(
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

function sortJson(value: unknown): unknown {
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

function comparableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function reportDrift(
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

function normalizeRulesetForComparison(value: JsonObject): JsonObject {
  const result: Record<string, unknown> = selectFields(value, [
    'name',
    'target',
    'enforcement',
    'bypass_actors',
    'conditions',
    'rules',
  ]);
  if (isUnknownArray(result['rules'])) {
    result['rules'] = result['rules'].map((rule) => {
      if (
        !isRecord(rule) ||
        rule['type'] !== 'required_status_checks' ||
        !isRecord(rule['parameters'])
      ) {
        return rule;
      }
      const parameters: Record<string, unknown> = { ...rule['parameters'] };
      if (isUnknownArray(parameters['required_status_checks'])) {
        parameters['required_status_checks'] = parameters[
          'required_status_checks'
        ].map((statusCheck) => {
          if (
            !isRecord(statusCheck) ||
            statusCheck['integration_id'] === undefined
          ) {
            return statusCheck;
          }
          const normalizedStatusCheck: Record<string, unknown> = {
            ...statusCheck,
          };
          delete normalizedStatusCheck['integration_id'];
          return normalizedStatusCheck;
        });
      }
      return { ...rule, parameters };
    });
  }
  return result;
}

function normalizeEnvironmentForComparison(value: JsonObject): JsonObject {
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

function environmentBody(environment: JsonObject): JsonObject {
  const body: Record<string, unknown> = { ...environment };
  delete body['environment'];
  return body;
}

function secretNames(value: unknown): readonly string[] {
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

function checkRequiredSecrets(
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

async function checkRepositoryDrift(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
  drifts: string[],
): Promise<void> {
  const response = requireApiSuccess(
    await request(reference, ''),
    'Reading repository settings',
  );
  if (!isRecord(response)) {
    throw new Error('Reading repository settings returned an invalid response');
  }
  reportDrift(
    'repository settings',
    configuration.repository,
    selectFields(response, repositoryFields),
    drifts,
  );
}

async function checkRulesetDrift(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
  drifts: string[],
): Promise<void> {
  const response = requireApiSuccess(
    await request(reference, '/rulesets?per_page=100'),
    'Listing repository rulesets',
  );
  if (!isUnknownArray(response)) {
    throw new Error('Listing repository rulesets returned an invalid response');
  }
  const summaries: RulesetSummary[] = response.flatMap((summary) =>
    isRecord(summary) && isNumber(summary['id']) && isString(summary['name'])
      ? [{ id: summary['id'], name: summary['name'] }]
      : [],
  );
  for (const desiredRuleset of configuration.rulesets) {
    const name = desiredRuleset['name'];
    if (!isString(name)) {
      continue;
    }
    const summary = summaries.find((candidate) => candidate.name === name);
    if (summary === undefined) {
      drifts.push(`ruleset ${name} is missing`);
      continue;
    }
    const actual = requireApiSuccess(
      await request(reference, `/rulesets/${String(summary.id)}`),
      `Reading ruleset ${name}`,
    );
    if (!isRecord(actual)) {
      throw new Error(`Reading ruleset ${name} returned an invalid response`);
    }
    reportDrift(
      `ruleset ${name}`,
      normalizeRulesetForComparison(desiredRuleset),
      normalizeRulesetForComparison(actual),
      drifts,
    );
  }
}

async function checkEnvironmentDrift(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
  drifts: string[],
): Promise<void> {
  const response = requireApiSuccess(
    await request(reference, '/environments?per_page=100'),
    'Listing repository environments',
  );
  if (!isRecord(response) || !isUnknownArray(response['environments'])) {
    throw new Error(
      'Listing repository environments returned an invalid response',
    );
  }
  const summaries: EnvironmentSummary[] = response['environments'].flatMap(
    (environment) =>
      isRecord(environment) && isString(environment['name'])
        ? [{ name: environment['name'] }]
        : [],
  );
  for (const desiredEnvironment of configuration.environments) {
    const name = desiredEnvironment['environment'];
    if (!isString(name)) {
      continue;
    }
    if (!summaries.some((candidate) => candidate.name === name)) {
      drifts.push(`environment ${name} is missing`);
      continue;
    }
    const actual = requireApiSuccess(
      await request(reference, `/environments/${encodeURIComponent(name)}`),
      `Reading environment ${name}`,
    );
    if (!isRecord(actual)) {
      throw new Error(
        `Reading environment ${name} returned an invalid response`,
      );
    }
    reportDrift(
      `environment ${name}`,
      normalizeEnvironmentForComparison(environmentBody(desiredEnvironment)),
      normalizeEnvironmentForComparison(actual),
      drifts,
    );
  }
}

async function checkSecretDrift(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
  drifts: string[],
): Promise<void> {
  const repositoryNames = secretNames(
    requireApiSuccess(
      await request(reference, '/actions/secrets?per_page=100'),
      'Listing repository secrets',
    ),
  );
  checkRequiredSecrets(
    'repository',
    configuration.secrets.repository,
    repositoryNames,
    drifts,
  );
  for (const [environment, entries] of Object.entries(
    configuration.secrets.environments,
  )) {
    const names = secretNames(
      requireApiSuccess(
        await request(
          reference,
          `/environments/${encodeURIComponent(environment)}/secrets?per_page=100`,
        ),
        `Listing secrets for environment ${environment}`,
      ),
    );
    checkRequiredSecrets(`environment ${environment}`, entries, names, drifts);
  }
}

async function checkRemote(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
): Promise<string[]> {
  const drifts: string[] = [];
  await checkRepositoryDrift(reference, configuration, drifts);
  await checkRulesetDrift(reference, configuration, drifts);
  await checkEnvironmentDrift(reference, configuration, drifts);
  await checkSecretDrift(reference, configuration, drifts);
  return drifts;
}

async function applyConfiguration(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
): Promise<void> {
  requireApiSuccess(
    await request(
      reference,
      '',
      'PATCH',
      selectFields(configuration.repository, repositoryFields),
    ),
    'Applying repository settings',
  );
  console.log('Applied repository settings.');

  const rulesetSummariesResponse = requireApiSuccess(
    await request(reference, '/rulesets?per_page=100'),
    'Listing repository rulesets before apply',
  );
  if (!isUnknownArray(rulesetSummariesResponse)) {
    throw new Error('Listing repository rulesets returned an invalid response');
  }
  for (const desiredRuleset of configuration.rulesets) {
    const name = desiredRuleset['name'];
    if (!isString(name)) {
      continue;
    }
    const existing = rulesetSummariesResponse.find(
      (candidate) =>
        isRecord(candidate) &&
        candidate['name'] === name &&
        isNumber(candidate['id']),
    );
    if (isRecord(existing) && isNumber(existing['id'])) {
      requireApiSuccess(
        await request(
          reference,
          `/rulesets/${String(existing['id'])}`,
          'PUT',
          desiredRuleset,
        ),
        `Updating ruleset ${name}`,
      );
      console.log(`Updated ruleset ${name}.`);
    } else {
      requireApiSuccess(
        await request(reference, '/rulesets', 'POST', desiredRuleset),
        `Creating ruleset ${name}`,
      );
      console.log(`Created ruleset ${name}.`);
    }
  }

  for (const desiredEnvironment of configuration.environments) {
    const name = desiredEnvironment['environment'];
    if (!isString(name)) {
      continue;
    }
    requireApiSuccess(
      await request(
        reference,
        `/environments/${encodeURIComponent(name)}`,
        'PUT',
        environmentBody(desiredEnvironment),
      ),
      `Applying environment ${name}`,
    );
    console.log(`Applied environment ${name}.`);
  }
  console.log('Secret values were not read or changed.');
}

function assertApplyIsAuthorized(): void {
  const isProtectedWorkflow =
    getStringEnvironmentVariable('GITHUB_ACTIONS') === 'true' &&
    getStringEnvironmentVariable('GITHUB_EVENT_NAME') === 'workflow_dispatch' &&
    getStringEnvironmentVariable('GITHUB_REF') === 'refs/heads/main';
  if (
    !isProtectedWorkflow &&
    getStringEnvironmentVariable('ALLOW_GITHUB_SETTINGS_APPLY') !== '1'
  ) {
    throw new Error(
      'Apply is restricted to workflow_dispatch on main or ALLOW_GITHUB_SETTINGS_APPLY=1',
    );
  }
}

function printUsage(): void {
  console.error(
    'Usage: node scripts/github-settings.ts --check [--remote] | --apply',
  );
}

function parseArguments(): CliOptions | undefined {
  const argumentsList = process.argv.slice(2);
  const check = argumentsList.includes('--check');
  const remote = argumentsList.includes('--remote');
  const apply = argumentsList.includes('--apply');
  const validArguments = (check && !apply) || (apply && !check && !remote);
  if (!validArguments) {
    printUsage();
    process.exitCode = 2;
    return undefined;
  }
  return { check, remote, apply };
}

async function validateWorkflowContract(): Promise<void> {
  const workflow = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  if (
    /^\s+check:\s*$/m.exec(workflow) === null ||
    /^\s+mutation:\s*$/m.exec(workflow) === null
  ) {
    throw new Error(
      'ci.yml must define both check and mutation jobs required by main.json',
    );
  }
}

async function runRemoteCheck(
  reference: RepositoryReference,
  configuration: DesiredConfiguration,
): Promise<void> {
  const drifts = await checkRemote(reference, configuration);
  if (drifts.length > 0) {
    throw new Error(
      `GitHub settings drift detected for ${reference.owner}/${reference.name}:\n- ${drifts.join('\n- ')}`,
    );
  }
  console.log(
    `GitHub settings match desired state for ${reference.owner}/${reference.name}.`,
  );
}

async function main(): Promise<void> {
  const options = parseArguments();
  if (options === undefined) {
    return;
  }
  const configuration = await loadConfiguration();
  await validateWorkflowContract();
  console.log(
    'GitHub infrastructure JSON and CI status-check contract are valid.',
  );
  if (!options.remote && !options.apply) {
    return;
  }

  const reference = await getRepositoryReference();
  if (options.remote) {
    await runRemoteCheck(reference, configuration);
    return;
  }

  assertApplyIsAuthorized();
  await applyConfiguration(reference, configuration);
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
