import { describe, expect, it } from 'vitest';

import {
  checkCiWorkflowContract,
  checkRequiredStatusChecksMatchJobs,
} from './gate-contract-ci.ts';
import {
  type GateContractDocuments,
  checkArchitectureContract,
  checkCoverageContract,
  checkGateContract,
  checkLintContract,
  checkMutationContract,
  checkRequiredScripts,
} from './gate-contract.ts';

const REQUIRED_SCRIPT_NAMES = [
  'check',
  'verify',
  'fix',
  'format',
  'format:check',
  'lint',
  'lint:fix',
  'typecheck',
  'deadcode',
  'architecture',
  'duplication',
  'test',
  'test:watch',
  'test:coverage',
  'test:mutation',
  'secret:scan',
  'check:toolchain',
  'check:workflows',
  'check:deps',
  'check:gate-contract',
  'check:manifest',
  'check:scope',
  'github:settings',
] as const;

function validPackageJson(
  overrides: Partial<Record<string, string>> = {},
): unknown {
  const scripts: Record<string, string> = {};
  for (const name of REQUIRED_SCRIPT_NAMES) {
    scripts[name] = `run ${name}`;
  }
  return { scripts: { ...scripts, ...overrides } };
}

function validVitestConfigSource(
  overrides: Partial<
    Record<'lines' | 'functions' | 'branches' | 'statements', number>
  > = {},
): string {
  const lines = overrides.lines ?? 95;
  const functions = overrides.functions ?? 95;
  const branches = overrides.branches ?? 95;
  const statements = overrides.statements ?? 95;
  return `export default {
  test: {
    coverage: {
      include: ['src/**/*.ts', 'scripts/lib/**/*.ts', 'scripts/github-settings/**/*.ts'],
      thresholds: {
        perFile: true,
        lines: ${String(lines)},
        functions: ${String(functions)},
        branches: ${String(branches)},
        statements: ${String(statements)},
      },
    },
  },
};`;
}

function validStrykerConfig(breakThreshold = 95): unknown {
  return {
    mutate: [
      'src/**/*.ts',
      'scripts/lib/**/*.ts',
      'scripts/github-settings/**/*.ts',
      '!**/*.test.ts',
    ],
    thresholds: { high: 95, low: 95, break: breakThreshold },
  };
}

function validEslintConfigSource(): string {
  return `export default [
  {
    rules: {
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': ['error', {}],
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: [] },
      ],
    },
  },
];`;
}

function validDependencyCruiserConfig(): unknown {
  return {
    forbidden: [
      { name: 'no-circular', severity: 'error', from: {}, to: {} },
      { name: 'no-production-to-test', severity: 'error', from: {}, to: {} },
      { name: 'no-orphans', severity: 'error', from: {}, to: {} },
      { name: 'no-lib-to-entry-point', severity: 'error', from: {}, to: {} },
    ],
  };
}

function validCiWorkflowSource(jobsYaml?: string): string {
  const jobs =
    jobsYaml ??
    `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`;
  return `name: CI
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
jobs:
${jobs}`;
}

function validMainRulesetConfig(): unknown {
  return {
    name: 'main',
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [
            { context: 'check' },
            { context: 'mutation' },
          ],
        },
      },
    ],
  };
}

function validDocuments(): GateContractDocuments {
  return {
    packageJson: validPackageJson(),
    vitestConfigSource: validVitestConfigSource(),
    strykerConfig: validStrykerConfig(),
    eslintConfigSource: validEslintConfigSource(),
    dependencyCruiserConfig: validDependencyCruiserConfig(),
    ciWorkflowSource: validCiWorkflowSource(),
    mainRulesetConfig: validMainRulesetConfig(),
  };
}

describe('checkGateContract', () => {
  it('accepts a fully compliant gate configuration', () => {
    expect(checkGateContract(validDocuments())).toStrictEqual([]);
  });

  it('surfaces a problem from the underlying package.json check', () => {
    const documents = validDocuments();
    const problems = checkGateContract({
      ...documents,
      packageJson: { scripts: {} },
    });
    expect(problems).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('missing the required script "test:mutation"'),
      ]),
    );
  });
});

describe('checkRequiredScripts', () => {
  it('accepts every required script present', () => {
    expect(checkRequiredScripts(validPackageJson())).toStrictEqual([]);
  });

  it('rejects a package.json with no scripts object', () => {
    expect(checkRequiredScripts({})).toStrictEqual([
      expect.stringContaining('no scripts object'),
    ]);
  });

  it('rejects test:mutation being removed from package.json', () => {
    const scripts: Record<string, string> = {};
    for (const name of REQUIRED_SCRIPT_NAMES) {
      if (name !== 'test:mutation') {
        scripts[name] = `run ${name}`;
      }
    }
    const problems = checkRequiredScripts({ scripts });
    expect(problems).toStrictEqual([
      expect.stringContaining('missing the required script "test:mutation"'),
    ]);
  });
});

describe('checkCoverageContract', () => {
  it('accepts a coverage block that measures src/ and scripts/lib/ at >= 95%', () => {
    expect(checkCoverageContract(validVitestConfigSource())).toStrictEqual([]);
  });

  it('rejects coverage.include dropping scripts/lib/', () => {
    const source = validVitestConfigSource().replace(
      ", 'scripts/lib/**/*.ts'",
      '',
    );
    expect(checkCoverageContract(source)).toStrictEqual([
      expect.stringContaining(
        'coverage.include is missing "scripts/lib/**/*.ts"',
      ),
    ]);
  });

  it('rejects a lines threshold below 95%', () => {
    const problems = checkCoverageContract(
      validVitestConfigSource({ lines: 94 }),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('coverage.thresholds.lines is 94'),
    ]);
  });

  it('rejects perFile being turned off', () => {
    const source = validVitestConfigSource().replace(
      'perFile: true',
      'perFile: false',
    );
    expect(checkCoverageContract(source)).toStrictEqual([
      expect.stringContaining('perFile must be true'),
    ]);
  });

  it('rejects a config with no coverage block at all', () => {
    expect(checkCoverageContract('export default { test: {} };')).toStrictEqual(
      [expect.stringContaining('no coverage block')],
    );
  });

  it('rejects a coverage marker with no opening brace after it', () => {
    expect(
      checkCoverageContract('export default { test: { coverage: 123 } };'),
    ).toStrictEqual([expect.stringContaining('no coverage block')]);
  });

  it('rejects an unterminated coverage block', () => {
    expect(
      checkCoverageContract('export default { test: { coverage: { include: ['),
    ).toStrictEqual([expect.stringContaining('no coverage block')]);
  });

  it('rejects a coverage block with no thresholds sub-block at all', () => {
    const source = `export default {
  test: {
    coverage: {
      include: ['src/**/*.ts', 'scripts/lib/**/*.ts', 'scripts/github-settings/**/*.ts'],
    },
  },
};`;
    const problems = checkCoverageContract(source);
    expect(problems).toStrictEqual([
      expect.stringContaining('perFile must be true'),
      expect.stringContaining('coverage.thresholds.lines is missing'),
      expect.stringContaining('coverage.thresholds.functions is missing'),
      expect.stringContaining('coverage.thresholds.branches is missing'),
      expect.stringContaining('coverage.thresholds.statements is missing'),
    ]);
  });

  it('reports a single dropped metric as missing rather than lowered', () => {
    const source = validVitestConfigSource().replace('functions: 95,\n', '');
    expect(checkCoverageContract(source)).toStrictEqual([
      expect.stringContaining('coverage.thresholds.functions is missing'),
    ]);
  });
});

describe('checkMutationContract', () => {
  it('accepts a mutate list covering src/ and scripts/lib/ with break >= 95', () => {
    expect(checkMutationContract(validStrykerConfig())).toStrictEqual([]);
  });

  it('rejects a break threshold of 94', () => {
    expect(checkMutationContract(validStrykerConfig(94))).toStrictEqual([
      expect.stringContaining(
        'thresholds.break must be a number of at least 95',
      ),
    ]);
  });

  it('rejects scripts/lib/ being dropped from the mutate scope', () => {
    const config = validStrykerConfig();
    expect(
      checkMutationContract({
        ...(config as Record<string, unknown>),
        mutate: [
          'src/**/*.ts',
          'scripts/github-settings/**/*.ts',
          '!**/*.test.ts',
        ],
      }),
    ).toStrictEqual([
      expect.stringContaining('mutate is missing "scripts/lib/**/*.ts"'),
    ]);
  });

  it('rejects a config that did not parse to an object', () => {
    expect(checkMutationContract([])).toStrictEqual([
      expect.stringContaining('did not parse to an object'),
    ]);
  });

  it('rejects a mutate field that is not an array of glob patterns', () => {
    expect(
      checkMutationContract({
        mutate: 'src/**/*.ts',
        thresholds: { break: 95 },
      }),
    ).toStrictEqual([
      expect.stringContaining('mutate must be an array of glob patterns'),
    ]);
  });

  it('rejects a missing break threshold', () => {
    expect(
      checkMutationContract({
        mutate: [
          'src/**/*.ts',
          'scripts/lib/**/*.ts',
          'scripts/github-settings/**/*.ts',
        ],
        thresholds: {},
      }),
    ).toStrictEqual([
      expect.stringContaining(
        'thresholds.break must be a number of at least 95',
      ),
    ]);
  });
});

describe('checkLintContract', () => {
  it('accepts every required rule set to error', () => {
    expect(checkLintContract(validEslintConfigSource())).toStrictEqual([]);
  });

  it('rejects a required rule downgraded to warn', () => {
    const source = validEslintConfigSource().replace(
      "'vitest/no-focused-tests': 'error'",
      "'vitest/no-focused-tests': 'warn'",
    );
    expect(checkLintContract(source)).toStrictEqual([
      expect.stringContaining(
        'rule "vitest/no-focused-tests" is not set to "error"',
      ),
    ]);
  });

  it('rejects a required rule turned off', () => {
    const source = validEslintConfigSource().replace(
      "complexity: ['error', 10]",
      "complexity: 'off'",
    );
    expect(checkLintContract(source)).toStrictEqual([
      expect.stringContaining('rule "complexity" is not set to "error"'),
    ]);
  });

  it('does not confuse cognitive-complexity with the bare complexity rule', () => {
    const source = validEslintConfigSource().replace(
      "'sonarjs/cognitive-complexity': ['error', 15]",
      "'sonarjs/cognitive-complexity': 'off'",
    );
    expect(checkLintContract(source)).toStrictEqual([
      expect.stringContaining(
        'rule "sonarjs/cognitive-complexity" is not set to "error"',
      ),
    ]);
  });
});

describe('checkArchitectureContract', () => {
  it('accepts every required forbidden rule at error severity', () => {
    expect(
      checkArchitectureContract(validDependencyCruiserConfig()),
    ).toStrictEqual([]);
  });

  it('rejects no-orphans being removed', () => {
    const config = validDependencyCruiserConfig() as { forbidden: unknown[] };
    const problems = checkArchitectureContract({
      forbidden: config.forbidden.filter(
        (rule) => (rule as { name: string }).name !== 'no-orphans',
      ),
    });
    expect(problems).toStrictEqual([
      expect.stringContaining(
        'missing the required forbidden rule "no-orphans"',
      ),
    ]);
  });

  it('rejects a required rule downgraded from error severity', () => {
    const config = validDependencyCruiserConfig() as { forbidden: unknown[] };
    const problems = checkArchitectureContract({
      forbidden: config.forbidden.map((rule) =>
        (rule as { name: string }).name === 'no-circular'
          ? { ...(rule as Record<string, unknown>), severity: 'warn' }
          : rule,
      ),
    });
    expect(problems).toStrictEqual([
      expect.stringContaining('rule "no-circular" has severity "warn"'),
    ]);
  });

  it('rejects a config that did not parse to an object', () => {
    expect(checkArchitectureContract([])).toStrictEqual([
      expect.stringContaining('did not parse to an object'),
    ]);
  });

  it('rejects a config with no forbidden array', () => {
    expect(checkArchitectureContract({})).toStrictEqual([
      expect.stringContaining('has no forbidden array'),
    ]);
  });

  it('ignores a non-object entry in the forbidden array instead of crashing on it', () => {
    const config = validDependencyCruiserConfig() as { forbidden: unknown[] };
    expect(
      checkArchitectureContract({ forbidden: [null, ...config.forbidden] }),
    ).toStrictEqual([]);
  });
});

describe('checkCiWorkflowContract', () => {
  it('accepts a workflow defining check and mutation without restrictions', () => {
    expect(checkCiWorkflowContract(validCiWorkflowSource())).toStrictEqual([]);
  });

  it('rejects the mutation job being removed from the workflow', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('missing the required "mutation" job'),
    ]);
  });

  it('rejects a required job that no longer runs its gate command', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: echo "nothing to do"
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining(
        'job "check" no longer runs `pnpm verify`, so the job could report success',
      ),
    ]);
  });

  it('accepts a mutation command wrapped in a longer shell script', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: |
          set -euo pipefail
          pnpm test:mutation --mutate src/index.ts
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([]);
  });

  it('looks past steps that are actions rather than commands', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([]);
  });

  it('rejects continue-on-error: true on a required job', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
    continue-on-error: true
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining(
        'job "check" sets continue-on-error: true, so its failure would not fail the workflow',
      ),
    ]);
  });

  it('rejects a required job disabled with if: false', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
    if: false
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('job "check" is disabled with if: false'),
    ]);
  });

  it('rejects a pull_request trigger narrowed by paths', () => {
    const source = validCiWorkflowSource().replace(
      '  pull_request:\n    types: [opened, synchronize, reopened]\n',
      "  pull_request:\n    types: [opened, synchronize, reopened]\n    paths:\n      - 'src/**'\n",
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('restricts the pull_request trigger with paths'),
    ]);
  });

  it('rejects a pull_request trigger narrowed by paths-ignore', () => {
    const source = validCiWorkflowSource().replace(
      '  pull_request:\n    types: [opened, synchronize, reopened]\n',
      "  pull_request:\n    types: [opened, synchronize, reopened]\n    paths-ignore:\n      - 'docs/**'\n",
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('restricts the pull_request trigger with paths'),
    ]);
  });

  it('rejects a workflow that is not valid YAML', () => {
    expect(checkCiWorkflowContract(':\n  - not: [valid')).toStrictEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });

  it('rejects a workflow whose top-level document is not a mapping', () => {
    expect(checkCiWorkflowContract('- just\n- a\n- list\n')).toStrictEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });

  it('rejects a workflow with no jobs mapping at all', () => {
    const source = 'name: CI\non:\n  pull_request: {}\n';
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('missing the required "check" job'),
      expect.stringContaining('missing the required "mutation" job'),
    ]);
  });

  it('accepts a workflow whose pull_request trigger has no explicit block', () => {
    const source = validCiWorkflowSource().replace(
      '  pull_request:\n    types: [opened, synchronize, reopened]\n',
      '  pull_request:\n',
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([]);
  });
});

describe('checkRequiredStatusChecksMatchJobs', () => {
  it('accepts a ruleset that requires exactly the jobs ci.yml defines', () => {
    expect(
      checkRequiredStatusChecksMatchJobs(
        validMainRulesetConfig(),
        validCiWorkflowSource(),
      ),
    ).toStrictEqual([]);
  });

  it('rejects the mutation status check being dropped from the ruleset', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'check' }] },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining(
        'does not require the "mutation" status check that ci.yml\'s "mutation" job reports',
      ),
    ]);
  });

  it('matches a required status check against the job name, not the job key', () => {
    const source = validCiWorkflowSource(
      `  quality:
    name: check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(
      checkRequiredStatusChecksMatchJobs(validMainRulesetConfig(), source),
    ).toStrictEqual([]);
  });

  it('rejects a job whose name no longer reports the required status check', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: quality
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(
      checkRequiredStatusChecksMatchJobs(validMainRulesetConfig(), source),
    ).toStrictEqual([
      expect.stringContaining(
        'does not require the "quality" status check that ci.yml\'s "check" job reports',
      ),
      expect.stringContaining(
        'requires status check "check", but no ci.yml job reports that name',
      ),
    ]);
  });

  it('rejects a required status check with no matching ci.yml job', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'check' },
                { context: 'mutation' },
                { context: 'renamed-job' },
              ],
            },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining(
        'requires status check "renamed-job", but no ci.yml job reports that name',
      ),
    ]);
  });

  it('treats a ruleset that is not an object as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      [],
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('treats a ruleset with rules that are not an array as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      { rules: 'not-an-array' },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('treats a ruleset whose rules field is not iterable as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      { rules: 42 },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('does not let a skipped rule leak its data through when a later rule matches', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          {
            type: 'pull_request',
            parameters: {
              required_status_checks: [{ context: 'decoy' }],
            },
          },
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'check' },
                { context: 'mutation' },
              ],
            },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('excludes a malformed required_status_checks entry from the derived contexts', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'check' },
                'not-an-object',
                { context: 'mutation' },
              ],
            },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('skips a rule that is not required_status_checks before finding the real one', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          { type: 'pull_request', parameters: {} },
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                { context: 'check' },
                { context: 'mutation' },
              ],
            },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('treats required_status_checks parameters without an array as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [{ type: 'required_status_checks', parameters: {} }],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('treats a required_status_checks rule with non-object parameters as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          { type: 'required_status_checks', parameters: 'not-an-object' },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('treats a ruleset with no required_status_checks rule as requiring nothing', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      { rules: [{ type: 'pull_request', parameters: {} }] },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('reports every required status check as missing a job when the workflow is invalid', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      validMainRulesetConfig(),
      ':\n  - not: [valid',
    );
    expect(problems).toStrictEqual([
      expect.stringContaining(
        'requires status check "check", but no ci.yml job reports that name',
      ),
      expect.stringContaining(
        'requires status check "mutation", but no ci.yml job reports that name',
      ),
    ]);
  });
});

describe('checkCiWorkflowContract details', () => {
  it('rejects an empty job name as reporting nothing', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: ''
    runs-on: ubuntu-latest
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(
      checkRequiredStatusChecksMatchJobs(validMainRulesetConfig(), source),
    ).toStrictEqual([]);
  });

  it('rejects a mutation job that stopped running Stryker', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    steps:
      - run: echo skipped
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      'ci.yml job "mutation" no longer runs `pnpm test:mutation`, so the job ' +
        'could report success without running the gate.',
    ]);
  });

  it('rejects a job whose steps are not a list', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    steps: none
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('job "check" no longer runs `pnpm verify`'),
    ]);
  });

  it('reports the exact message for a disabled job', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    if: false
    runs-on: ubuntu-latest
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      'ci.yml job "check" is disabled with if: false.',
    ]);
  });

  it('reports the exact message for a missing job', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    runs-on: ubuntu-latest
    steps:
      - run: pnpm verify
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      'ci.yml is missing the required "mutation" job.',
    ]);
  });

  it('reports the exact message for a path-filtered pull_request trigger', () => {
    const source = validCiWorkflowSource().replace(
      '  pull_request:\n    types: [opened, synchronize, reopened]\n',
      '  pull_request:\n    paths: [src/**]\n',
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      'ci.yml restricts the pull_request trigger with paths/paths-ignore, so a ' +
        'change outside that filter would merge without the required check and ' +
        'mutation jobs running.',
    ]);
  });

  it('reads the trigger block when YAML parsed the `on` key as true', () => {
    const source = `name: CI
true:
  pull_request:
    paths: [src/**]
jobs:
  check:
    name: check
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    steps:
      - run: pnpm test:mutation
`;
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      expect.stringContaining('restricts the pull_request trigger'),
    ]);
  });

  it('ignores a required status check entry with no string context', () => {
    const problems = checkRequiredStatusChecksMatchJobs(
      {
        rules: [
          {
            type: 'required_status_checks',
            parameters: {
              required_status_checks: [
                'check',
                { context: 'check' },
                { context: 'mutation' },
              ],
            },
          },
        ],
      },
      validCiWorkflowSource(),
    );
    expect(problems).toStrictEqual([]);
  });
});

describe('checkCiWorkflowContract edge cases', () => {
  it('treats the quoted string "false" as a disabled job', () => {
    const source = validCiWorkflowSource(
      `  check:
    name: check
    if: 'false'
    runs-on: ubuntu-latest
    steps:
      - run: pnpm verify
  mutation:
    name: mutation
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:mutation
`,
    );
    expect(checkCiWorkflowContract(source)).toStrictEqual([
      'ci.yml job "check" is disabled with if: false.',
    ]);
  });

  it('reports every required check when the ruleset is not an object', () => {
    expect(
      checkRequiredStatusChecksMatchJobs('main', validCiWorkflowSource()),
    ).toStrictEqual([
      expect.stringContaining('does not require the "check" status check'),
      expect.stringContaining('does not require the "mutation" status check'),
    ]);
  });

  it('reports every required check when the ruleset has no rules array', () => {
    expect(
      checkRequiredStatusChecksMatchJobs(
        { rules: 'none' },
        validCiWorkflowSource(),
      ),
    ).toHaveLength(2);
  });

  it('skips a rule that is not a required_status_checks rule', () => {
    expect(
      checkRequiredStatusChecksMatchJobs(
        {
          rules: [
            'deletion',
            { type: 'pull_request' },
            {
              type: 'required_status_checks',
              parameters: {
                required_status_checks: [
                  { context: 'check' },
                  { context: 'mutation' },
                ],
              },
            },
          ],
        },
        validCiWorkflowSource(),
      ),
    ).toStrictEqual([]);
  });

  it('reports a required check entry whose context is not a string', () => {
    expect(
      checkRequiredStatusChecksMatchJobs(
        {
          rules: [
            {
              type: 'required_status_checks',
              parameters: {
                required_status_checks: [
                  { context: 'check' },
                  { context: 'mutation' },
                  { context: 7 },
                ],
              },
            },
          ],
        },
        validCiWorkflowSource(),
      ),
    ).toStrictEqual([]);
  });
});
