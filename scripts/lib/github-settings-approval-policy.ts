/**
 * The solo-repo "no required human approval" policy for the `main` ruleset,
 * and the top-level entry point that combines every validator into one
 * DesiredConfiguration or throws. See
 * docs/decisions/0008-no-required-human-approval-solo-repo.md.
 */

import {
  validateEnvironment,
  validateSecrets,
} from './github-settings-environment.ts';
import {
  isRecord,
  isString,
  isUnknownArray,
  validateRepository,
  validateRuleset,
} from './github-settings-schema.ts';
import {
  requiredMainStatusChecks,
  type DesiredConfiguration,
  type JsonDocument,
  type JsonObject,
} from './github-settings-types.ts';

// Stryker disable ArrayDeclaration,ConditionalExpression,LogicalOperator,BlockStatement:
// every early return here feeds a plain `.includes(knownContextString)`
// check in the caller below, so any wrong, non-matching value -- whether a
// placeholder array or an extra `undefined` entry -- behaves exactly like
// the correct result there.
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
// Stryker restore ArrayDeclaration,ConditionalExpression,LogicalOperator,BlockStatement

/**
 * The `main` ruleset's `pull_request` rule, if any. Shared by the bypass and
 * review-parameter checks below so both read the same rule instance.
 */
function findPullRequestRule(ruleset: JsonObject): JsonObject | undefined {
  if (!isUnknownArray(ruleset['rules'])) {
    return undefined;
  }
  const rule = ruleset['rules'].find(
    (candidate) => isRecord(candidate) && candidate['type'] === 'pull_request',
  );
  return isRecord(rule) ? rule : undefined;
}

/**
 * The `main` ruleset must not grant a bypass, and must not require
 * code-owner or last-push review. This is what makes a regression in
 * `main.json` fail `--check` before it ever reaches GitHub.
 */
export function validateMainRulesetApprovalPolicy(
  mainRuleset: JsonObject,
  errors: string[],
): void {
  const bypassActors = mainRuleset['bypass_actors'];
  if (isUnknownArray(bypassActors) && bypassActors.length > 0) {
    errors.push(
      'rulesets/main.json must not declare bypass_actors (see ADR 0008)',
    );
  }

  const pullRequestRule = findPullRequestRule(mainRuleset);
  const parameters = pullRequestRule?.['parameters'];
  if (!isRecord(parameters)) {
    return;
  }
  if (parameters['require_code_owner_review'] !== false) {
    errors.push(
      'rulesets/main.json pull_request rule must set require_code_owner_review to false (see ADR 0008)',
    );
  }
  if (parameters['require_last_push_approval'] !== false) {
    errors.push(
      'rulesets/main.json pull_request rule must set require_last_push_approval to false (see ADR 0008)',
    );
  }
}

function validateMainRuleset(
  rulesets: readonly JsonObject[],
  errors: string[],
): void {
  const mainRuleset = rulesets.find((ruleset) => ruleset['name'] === 'main');
  if (mainRuleset === undefined) {
    errors.push('rulesets must contain a main.json ruleset named main');
    return;
  }
  for (const context of requiredMainStatusChecks) {
    if (!getRequiredStatusContexts(mainRuleset).includes(context)) {
      errors.push(
        `rulesets/main.json must require the ${context} status check`,
      );
    }
  }
  validateMainRulesetApprovalPolicy(mainRuleset, errors);
}

export function validateConfigurationValues(
  repositoryValue: unknown,
  rulesetDocuments: readonly JsonDocument[],
  environmentDocuments: readonly JsonDocument[],
  secretValue: unknown,
): DesiredConfiguration {
  const errors: string[] = [];
  const repository = validateRepository(repositoryValue, errors);
  const rulesets = rulesetDocuments.flatMap((document) => {
    const ruleset = validateRuleset(document.value, document.path, errors);
    return ruleset === undefined ? [] : [ruleset];
  });
  const environments = environmentDocuments.flatMap((document) => {
    const environment = validateEnvironment(
      document.value,
      document.path,
      errors,
    );
    return environment === undefined ? [] : [environment];
  });
  const secrets = validateSecrets(secretValue, errors);

  validateMainRuleset(rulesets, errors);
  if (
    !environments.some(
      (environment) => environment['environment'] === 'production',
    )
  ) {
    errors.push('environments must contain a production environment');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid GitHub infrastructure configuration:\n- ${errors.join('\n- ')}`,
    );
  }
  // Stryker disable next-line ConditionalExpression,LogicalOperator,BlockStatement:
  // validateRepository/validateSecrets only return undefined after pushing an
  // error, so `errors.length > 0` above always throws first -- this is a
  // type-narrowing guard for the return type, not reachable behavior.
  if (repository === undefined || secrets === undefined) {
    throw new Error('Invalid GitHub infrastructure configuration');
  }
  return { repository, rulesets, environments, secrets };
}
