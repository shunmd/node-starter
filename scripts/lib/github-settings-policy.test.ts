import { describe, expect, it } from 'vitest';

import {
  validateConfigurationValues,
  validateMainRulesetApprovalPolicy,
} from './github-settings-approval-policy.ts';
import { validateCiWorkflowContract } from './github-settings-ci-contract.ts';
import {
  validateEnvironment,
  validateSecrets,
} from './github-settings-environment.ts';
import {
  checkRequiredSecrets,
  comparableJson,
  environmentBody,
  normalizeEnvironmentForComparison,
  normalizeRulesetForComparison,
  parseRepositoryReference,
  reportDrift,
  secretNames,
  selectFields,
  sortJson,
} from './github-settings-normalize.ts';
import {
  validateRepository,
  validateRuleset,
} from './github-settings-schema.ts';
import type { JsonObject } from './github-settings-types.ts';

/** A repository-settings.json that satisfies every field. */
function compliantRepository(): JsonObject {
  return {
    default_branch: 'main',
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    allow_auto_merge: false,
    delete_branch_on_merge: true,
    use_squash_pr_title_as_default: true,
    squash_merge_commit_title: 'PR_TITLE',
    squash_merge_commit_message: 'PR_BODY',
  };
}

/** rulesets/main.json as it must read once ADR 0008 applies. */
function compliantMainRuleset(): JsonObject {
  return {
    name: 'main',
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: {
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: 'check' },
            { context: 'mutation' },
            { context: 'github-settings' },
          ],
          strict_required_status_checks_policy: true,
        },
      },
    ],
  };
}

function compliantProductionEnvironment(): JsonObject {
  return {
    environment: 'production',
    wait_timer: 0,
    prevent_self_review: true,
    reviewers: [],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
  };
}

function compliantSecrets(): JsonObject {
  return { repository: [], environments: {} };
}

function compliantCiWorkflow(): string {
  return `
jobs:
  check:
    steps:
      - run: pnpm verify
  mutation:
    steps:
      - run: pnpm test:mutation
  github-settings:
    steps:
      - run: node scripts/github-settings.ts --check
`;
}

describe('validateRepository', () => {
  it('accepts a fully specified repository', () => {
    const errors: string[] = [];
    expect(validateRepository(compliantRepository(), errors)).toBeDefined();
    expect(errors).toStrictEqual([]);
  });

  it('rejects a missing required field', () => {
    const value = compliantRepository();
    delete value['has_wiki'];
    const errors: string[] = [];
    validateRepository(value, errors);
    expect(errors).toStrictEqual([
      expect.stringContaining('has_wiki is required'),
    ]);
  });

  it('rejects a field of the wrong type', () => {
    const value = { ...compliantRepository(), has_issues: 'yes' };
    const errors: string[] = [];
    validateRepository(value, errors);
    expect(errors).toStrictEqual([
      expect.stringContaining('has_issues must be a boolean'),
    ]);
  });

  it('rejects an unsupported key', () => {
    const value = { ...compliantRepository(), private: true };
    const errors: string[] = [];
    validateRepository(value, errors);
    expect(errors).toStrictEqual([
      expect.stringContaining('private is not supported'),
    ]);
  });

  it('rejects a non-object value', () => {
    const errors: string[] = [];
    expect(validateRepository([], errors)).toBeUndefined();
    expect(errors).toStrictEqual([
      expect.stringContaining('must contain a JSON object'),
    ]);
  });
});

describe('validateRuleset', () => {
  it('accepts a compliant main ruleset', () => {
    const errors: string[] = [];
    expect(
      validateRuleset(compliantMainRuleset(), 'rulesets/main.json', errors),
    ).toBeDefined();
    expect(errors).toStrictEqual([]);
  });

  it('rejects an unsupported target', () => {
    const ruleset = { ...compliantMainRuleset(), target: 'commit' };
    const errors: string[] = [];
    validateRuleset(ruleset, 'rulesets/main.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining('target must be branch, tag, or push'),
    );
  });

  it('rejects a pull_request rule missing a parameter', () => {
    const ruleset = compliantMainRuleset();
    const rules = ruleset['rules'] as JsonObject[];
    const pullRequestRule = rules.find(
      (rule) => rule['type'] === 'pull_request',
    )!;
    delete (pullRequestRule['parameters'] as JsonObject)[
      'require_code_owner_review'
    ];
    const errors: string[] = [];
    validateRuleset(ruleset, 'rulesets/main.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'parameters.require_code_owner_review must be a boolean',
      ),
    );
  });

  it('rejects an empty required_status_checks array', () => {
    const ruleset = compliantMainRuleset();
    const rules = ruleset['rules'] as JsonObject[];
    const statusChecksRule = rules.find(
      (rule) => rule['type'] === 'required_status_checks',
    )!;
    (statusChecksRule['parameters'] as JsonObject)['required_status_checks'] =
      [];
    const errors: string[] = [];
    validateRuleset(ruleset, 'rulesets/main.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'required_status_checks must be a non-empty array',
      ),
    );
  });

  it('rejects malformed conditions', () => {
    const ruleset = { ...compliantMainRuleset(), conditions: { ref_name: {} } };
    const errors: string[] = [];
    validateRuleset(ruleset, 'rulesets/main.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining('include and exclude must be string arrays'),
    );
  });
});

describe('validateEnvironment', () => {
  it('accepts a compliant production environment', () => {
    const errors: string[] = [];
    expect(
      validateEnvironment(
        compliantProductionEnvironment(),
        'environments/production.json',
        errors,
      ),
    ).toBeDefined();
    expect(errors).toStrictEqual([]);
  });

  it('rejects a deployment_branch_policy enabling both flags', () => {
    const environment = {
      ...compliantProductionEnvironment(),
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: true,
      },
    };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining('must enable exactly one policy'),
    );
  });

  it('rejects a non-object deployment_branch_policy', () => {
    const environment = {
      ...compliantProductionEnvironment(),
      deployment_branch_policy: 'always',
    };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining('deployment_branch_policy must be an object'),
    );
  });

  it('rejects a negative wait_timer', () => {
    const environment = { ...compliantProductionEnvironment(), wait_timer: -1 };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining("['wait_timer'] must be a non-negative number"),
    );
  });

  it('rejects a prevent_self_review of the wrong type', () => {
    const environment = {
      ...compliantProductionEnvironment(),
      prevent_self_review: 'yes',
    };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining("['prevent_self_review'] must be a boolean"),
    );
  });

  it('rejects a reviewers value that is not an array', () => {
    const environment = {
      ...compliantProductionEnvironment(),
      reviewers: 'nobody',
    };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining('reviewers must be an array'),
    );
  });

  it('rejects a reviewer entry with an unsupported type or non-integer id', () => {
    const environment = {
      ...compliantProductionEnvironment(),
      reviewers: [
        { type: 'Bot', id: 1 },
        { type: 'User', id: 1.5 },
      ],
    };
    const errors: string[] = [];
    validateEnvironment(environment, 'environments/production.json', errors);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'reviewers[0] must contain a User or Team type and integer id',
      ),
    );
    expect(errors).toContainEqual(
      expect.stringContaining(
        'reviewers[1] must contain a User or Team type and integer id',
      ),
    );
  });
});

describe('validateSecrets', () => {
  it('accepts an empty secrets manifest', () => {
    const errors: string[] = [];
    expect(validateSecrets(compliantSecrets(), errors)).toStrictEqual({
      repository: [],
      environments: {},
    });
    expect(errors).toStrictEqual([]);
  });

  it('rejects a secret entry without a purpose', () => {
    const value = {
      repository: [{ name: 'TOKEN', required: true, purpose: '' }],
      environments: {},
    };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining("['purpose'] must be a non-empty string"),
    );
  });

  it('accepts a fully specified secret entry in repository and environment scope', () => {
    const value = {
      repository: [
        {
          name: 'GH_ADMIN_TOKEN',
          required: true,
          purpose: 'apply GitHub settings',
        },
      ],
      environments: {
        production: [
          { name: 'DEPLOY_KEY', required: false, purpose: 'deploy step' },
        ],
      },
    };
    const errors: string[] = [];
    expect(validateSecrets(value, errors)).toStrictEqual({
      repository: [{ name: 'GH_ADMIN_TOKEN', required: true }],
      environments: {
        production: [{ name: 'DEPLOY_KEY', required: false }],
      },
    });
    expect(errors).toStrictEqual([]);
  });

  it('rejects a non-object secret entry', () => {
    const value = { repository: ['not-an-object'], environments: {} };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining('repository[0] must be an object'),
    );
  });

  it('rejects a missing purpose', () => {
    const value = {
      repository: [{ name: 'TOKEN', required: true }],
      environments: {},
    };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining("['purpose'] must be a non-empty string"),
    );
  });

  it('rejects a required flag of the wrong type', () => {
    const value = {
      repository: [{ name: 'TOKEN', required: 'yes', purpose: 'auth' }],
      environments: {},
    };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining("['required'] must be a boolean"),
    );
  });

  it('rejects a repository field that is not an array', () => {
    const value = { repository: 'TOKEN', environments: {} };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'secrets-manifest.json.repository must be an array',
      ),
    );
  });

  it('rejects an environments field that is not an object', () => {
    const value = { repository: [], environments: 'production' };
    const errors: string[] = [];
    validateSecrets(value, errors);
    expect(errors).toContainEqual(
      expect.stringContaining(
        'secrets-manifest.json.environments must be an object',
      ),
    );
  });

  it('rejects a non-object secrets manifest', () => {
    const errors: string[] = [];
    expect(validateSecrets([], errors)).toBeUndefined();
    expect(errors).toStrictEqual([
      expect.stringContaining(
        'secrets-manifest.json must contain a JSON object',
      ),
    ]);
  });
});

describe('validateConfigurationValues', () => {
  function validConfiguration() {
    return {
      repositoryValue: compliantRepository(),
      rulesetDocuments: [
        { path: 'rulesets/main.json', value: compliantMainRuleset() },
      ],
      environmentDocuments: [
        {
          path: 'environments/production.json',
          value: compliantProductionEnvironment(),
        },
      ],
      secretValue: compliantSecrets(),
    };
  }

  it('accepts a fully valid configuration', () => {
    const {
      repositoryValue,
      rulesetDocuments,
      environmentDocuments,
      secretValue,
    } = validConfiguration();
    const configuration = validateConfigurationValues(
      repositoryValue,
      rulesetDocuments,
      environmentDocuments,
      secretValue,
    );
    expect(configuration.rulesets).toHaveLength(1);
    expect(configuration.environments).toHaveLength(1);
  });

  it('fails when no ruleset is named main', () => {
    const { repositoryValue, environmentDocuments, secretValue } =
      validConfiguration();
    const rulesetDocuments = [
      {
        path: 'rulesets/other.json',
        value: { ...compliantMainRuleset(), name: 'other' },
      },
    ];
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        environmentDocuments,
        secretValue,
      ),
    ).toThrow(/must contain a main\.json ruleset named main/);
  });

  it.each(['check', 'mutation', 'github-settings'])(
    'fails when the %s status check is missing',
    (missingContext) => {
      const { repositoryValue, environmentDocuments, secretValue } =
        validConfiguration();
      const ruleset = compliantMainRuleset();
      const rules = ruleset['rules'] as JsonObject[];
      const statusChecksRule = rules.find(
        (rule) => rule['type'] === 'required_status_checks',
      )!;
      (statusChecksRule['parameters'] as JsonObject)['required_status_checks'] =
        (
          (statusChecksRule['parameters'] as JsonObject)[
            'required_status_checks'
          ] as JsonObject[]
        ).filter((check) => check['context'] !== missingContext);
      const rulesetDocuments = [{ path: 'rulesets/main.json', value: ruleset }];
      expect(() =>
        validateConfigurationValues(
          repositoryValue,
          rulesetDocuments,
          environmentDocuments,
          secretValue,
        ),
      ).toThrow(new RegExp(`must require the ${missingContext} status check`));
    },
  );

  it('fails when the main ruleset declares a bypass actor', () => {
    const { repositoryValue, environmentDocuments, secretValue } =
      validConfiguration();
    const ruleset = {
      ...compliantMainRuleset(),
      bypass_actors: [
        {
          actor_type: 'RepositoryRole',
          actor_id: 5,
          bypass_mode: 'pull_request',
        },
      ],
    };
    const rulesetDocuments = [{ path: 'rulesets/main.json', value: ruleset }];
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        environmentDocuments,
        secretValue,
      ),
    ).toThrow(/must not declare bypass_actors/);
  });

  it('fails when require_code_owner_review is true', () => {
    const { repositoryValue, environmentDocuments, secretValue } =
      validConfiguration();
    const ruleset = compliantMainRuleset();
    const rules = ruleset['rules'] as JsonObject[];
    const pullRequestRule = rules.find(
      (rule) => rule['type'] === 'pull_request',
    )!;
    (pullRequestRule['parameters'] as JsonObject)['require_code_owner_review'] =
      true;
    const rulesetDocuments = [{ path: 'rulesets/main.json', value: ruleset }];
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        environmentDocuments,
        secretValue,
      ),
    ).toThrow(/require_code_owner_review to false/);
  });

  it('fails when require_last_push_approval is true', () => {
    const { repositoryValue, environmentDocuments, secretValue } =
      validConfiguration();
    const ruleset = compliantMainRuleset();
    const rules = ruleset['rules'] as JsonObject[];
    const pullRequestRule = rules.find(
      (rule) => rule['type'] === 'pull_request',
    )!;
    (pullRequestRule['parameters'] as JsonObject)[
      'require_last_push_approval'
    ] = true;
    const rulesetDocuments = [{ path: 'rulesets/main.json', value: ruleset }];
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        environmentDocuments,
        secretValue,
      ),
    ).toThrow(/require_last_push_approval to false/);
  });

  it('fails on a malformed ruleset structure', () => {
    const { repositoryValue, environmentDocuments, secretValue } =
      validConfiguration();
    const rulesetDocuments = [
      { path: 'rulesets/main.json', value: { name: 'main' } },
    ];
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        environmentDocuments,
        secretValue,
      ),
    ).toThrow(/Invalid GitHub infrastructure configuration/);
  });

  it('fails when no production environment is declared', () => {
    const { repositoryValue, rulesetDocuments, secretValue } =
      validConfiguration();
    expect(() =>
      validateConfigurationValues(
        repositoryValue,
        rulesetDocuments,
        [],
        secretValue,
      ),
    ).toThrow(/must contain a production environment/);
  });
});

describe('validateMainRulesetApprovalPolicy', () => {
  it('accepts a compliant main ruleset', () => {
    const errors: string[] = [];
    validateMainRulesetApprovalPolicy(compliantMainRuleset(), errors);
    expect(errors).toStrictEqual([]);
  });

  it('rejects a non-empty bypass_actors array', () => {
    const ruleset = {
      ...compliantMainRuleset(),
      bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5 }],
    };
    const errors: string[] = [];
    validateMainRulesetApprovalPolicy(ruleset, errors);
    expect(errors).toStrictEqual([
      expect.stringContaining('must not declare bypass_actors'),
    ]);
  });
});

describe('validateCiWorkflowContract', () => {
  it('accepts a workflow that defines every required job with the right command', () => {
    expect(validateCiWorkflowContract(compliantCiWorkflow())).toStrictEqual([]);
  });

  it('rejects a workflow missing the github-settings job', () => {
    const source = `
jobs:
  check:
    steps:
      - run: pnpm verify
  mutation:
    steps:
      - run: pnpm test:mutation
`;
    expect(validateCiWorkflowContract(source)).toContainEqual(
      expect.stringContaining('must define a github-settings job'),
    );
  });

  it('rejects a github-settings job that runs the wrong command', () => {
    const source = compliantCiWorkflow().replace(
      'node scripts/github-settings.ts --check',
      'node scripts/github-settings.ts --check --remote',
    );
    expect(validateCiWorkflowContract(source)).toContainEqual(
      expect.stringContaining(
        'job github-settings must run `node scripts/github-settings.ts --check`',
      ),
    );
  });

  it('rejects a document with no jobs map', () => {
    expect(validateCiWorkflowContract('name: CI\n')).toStrictEqual([
      'ci.yml must define a jobs map',
    ]);
  });

  it('rejects invalid YAML', () => {
    expect(validateCiWorkflowContract('jobs: [')).toStrictEqual([
      expect.stringContaining('ci.yml is not valid YAML'),
    ]);
  });
});

describe('normalizeRulesetForComparison', () => {
  it('drops GitHub API fields the desired-state schema does not declare', () => {
    const apiResponse = {
      id: 42,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [],
      current_user_can_bypass: 'never',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [{ type: 'deletion' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      _links: {},
    };
    const normalized = normalizeRulesetForComparison(apiResponse);
    expect(normalized).not.toHaveProperty('id');
    expect(normalized).not.toHaveProperty('created_at');
    expect(normalized).toStrictEqual({
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [],
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [{ type: 'deletion' }],
    });
  });

  it('strips extra pull_request parameters the API returns', () => {
    const desired = normalizeRulesetForComparison(compliantMainRuleset());
    const apiResponse = compliantMainRuleset();
    const rules = apiResponse['rules'] as JsonObject[];
    const pullRequestRule = rules.find(
      (rule) => rule['type'] === 'pull_request',
    )!;
    (pullRequestRule['parameters'] as JsonObject)[
      'automatic_copilot_code_review'
    ] = false;
    expect(normalizeRulesetForComparison(apiResponse)).toStrictEqual(desired);
  });

  it('tolerates a ruleset with no rules array', () => {
    expect(normalizeRulesetForComparison({ name: 'main' })).toStrictEqual({
      name: 'main',
    });
  });

  it('passes through a rule of an unrecognized type that still has parameters', () => {
    const apiResponse = {
      name: 'main',
      rules: [
        { type: 'commit_message_pattern', parameters: { pattern: '.*' } },
      ],
    };
    expect(normalizeRulesetForComparison(apiResponse)).toStrictEqual({
      name: 'main',
      rules: [
        { type: 'commit_message_pattern', parameters: { pattern: '.*' } },
      ],
    });
  });

  it('tolerates a required_status_checks rule with no status check array', () => {
    const apiResponse = {
      name: 'main',
      rules: [
        {
          type: 'required_status_checks',
          parameters: { do_not_enforce_on_create: false },
        },
      ],
    };
    expect(normalizeRulesetForComparison(apiResponse)).toStrictEqual({
      name: 'main',
      rules: [
        {
          type: 'required_status_checks',
          parameters: { do_not_enforce_on_create: false },
        },
      ],
    });
  });

  it('passes through a non-object status check entry unchanged', () => {
    const apiResponse = {
      name: 'main',
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: ['check'] },
        },
      ],
    };
    expect(normalizeRulesetForComparison(apiResponse)).toStrictEqual({
      name: 'main',
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: ['check'] },
        },
      ],
    });
  });
});

describe('normalizeEnvironmentForComparison', () => {
  it('extracts reviewers from the API protection_rules shape', () => {
    const apiResponse = {
      wait_timer: 0,
      prevent_self_review: true,
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: [{ reviewer: { type: 'User', id: 1 } }],
        },
      ],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    };
    expect(normalizeEnvironmentForComparison(apiResponse)).toStrictEqual({
      wait_timer: 0,
      prevent_self_review: true,
      reviewers: [{ type: 'User', id: 1 }],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    });
  });

  it('matches a desired environment through environmentBody', () => {
    const desired = normalizeEnvironmentForComparison(
      environmentBody(compliantProductionEnvironment()),
    );
    expect(desired).toStrictEqual({
      wait_timer: 0,
      prevent_self_review: true,
      reviewers: [],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    });
  });

  it('drops a reviewer entry whose reviewer field is not an object', () => {
    const apiResponse = {
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: ['not-an-object', { reviewer: { type: 'Team', id: 7 } }],
        },
      ],
    };
    expect(
      normalizeEnvironmentForComparison(apiResponse)['reviewers'],
    ).toStrictEqual([{ type: 'Team', id: 7 }]);
  });

  it('drops a reviewer entry with a malformed actor', () => {
    const apiResponse = {
      protection_rules: [
        {
          type: 'required_reviewers',
          reviewers: [{ reviewer: { type: 1, id: 'not-a-number' } }],
        },
      ],
    };
    expect(
      normalizeEnvironmentForComparison(apiResponse)['reviewers'],
    ).toStrictEqual([]);
  });
});

describe('reportDrift', () => {
  it('reports nothing when desired and actual are equivalent regardless of key order', () => {
    const drifts: string[] = [];
    reportDrift('repository settings', { a: 1, b: 2 }, { b: 2, a: 1 }, drifts);
    expect(drifts).toStrictEqual([]);
  });

  it('reports a difference between desired and actual', () => {
    const drifts: string[] = [];
    reportDrift(
      'repository settings',
      { allow_auto_merge: false },
      { allow_auto_merge: true },
      drifts,
    );
    expect(drifts).toStrictEqual([
      expect.stringContaining('repository settings'),
    ]);
  });
});

describe('sortJson / comparableJson', () => {
  it('sorts object keys recursively', () => {
    expect(sortJson({ b: 1, a: { d: 2, c: 3 } })).toStrictEqual({
      a: { c: 3, d: 2 },
      b: 1,
    });
  });

  it('sorts objects nested inside arrays without reordering the array itself', () => {
    expect(sortJson([{ b: 1, a: 2 }, 'x'])).toStrictEqual([
      { a: 2, b: 1 },
      'x',
    ]);
  });

  it('produces the same comparable string for differently ordered objects', () => {
    expect(comparableJson({ a: 1, b: 2 })).toBe(comparableJson({ b: 2, a: 1 }));
  });
});

describe('selectFields', () => {
  it('omits fields the object does not define', () => {
    expect(selectFields({ a: 1 }, ['a', 'b'])).toStrictEqual({ a: 1 });
  });
});

describe('secretNames', () => {
  it('reads secret names from a GitHub API secrets response', () => {
    expect(
      secretNames({
        secrets: [{ name: 'GH_ADMIN_TOKEN' }, { name: 'NPM_TOKEN' }],
      }),
    ).toStrictEqual(['GH_ADMIN_TOKEN', 'NPM_TOKEN']);
  });

  it('returns an empty array for a malformed response', () => {
    expect(secretNames({})).toStrictEqual([]);
  });

  it('skips entries that are not a record with a string name', () => {
    expect(
      secretNames({ secrets: ['not-an-object', { name: 42 }, { name: 'OK' }] }),
    ).toStrictEqual(['OK']);
  });
});

describe('checkRequiredSecrets', () => {
  it('does not report an optional secret that is missing', () => {
    const drifts: string[] = [];
    checkRequiredSecrets(
      'repository',
      [{ name: 'OPTIONAL_TOKEN', required: false }],
      [],
      drifts,
    );
    expect(drifts).toStrictEqual([]);
  });

  it('does not report a required secret that is already present', () => {
    const drifts: string[] = [];
    checkRequiredSecrets(
      'repository',
      [{ name: 'GH_ADMIN_TOKEN', required: true }],
      ['GH_ADMIN_TOKEN'],
      drifts,
    );
    expect(drifts).toStrictEqual([]);
  });
});

describe('parseRepositoryReference', () => {
  it('parses an SSH remote URL', () => {
    expect(
      parseRepositoryReference('git@github.com:shunmd/node-starter.git'),
    ).toStrictEqual({
      owner: 'shunmd',
      name: 'node-starter',
    });
  });

  it('parses an HTTPS remote URL without a .git suffix', () => {
    expect(
      parseRepositoryReference('https://github.com/shunmd/node-starter'),
    ).toStrictEqual({
      owner: 'shunmd',
      name: 'node-starter',
    });
  });

  it('returns undefined for a non-GitHub remote', () => {
    expect(
      parseRepositoryReference('https://gitlab.com/shunmd/node-starter.git'),
    ).toBeUndefined();
  });
});
