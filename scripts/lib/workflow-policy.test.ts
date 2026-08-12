import { describe, expect, it } from 'vitest';

import {
  checkActionManifest,
  checkWorkflow,
  checkWorkflows,
} from './workflow-policy.ts';

const PINNED_CHECKOUT =
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

/** A workflow that satisfies every rule, so each test can break exactly one. */
function compliantWorkflow(
  steps = `      - uses: ${PINNED_CHECKOUT}\n        with:\n          persist-credentials: false\n`,
): string {
  return `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
${steps}`;
}

/** checkWorkflow returns local references too; the tests assert on problems. */
function problemsOf(source: string): readonly string[] {
  return checkWorkflow(source).problems;
}

describe('checkWorkflow', () => {
  it('accepts a workflow that satisfies every rule', () => {
    expect(problemsOf(compliantWorkflow())).toStrictEqual([]);
  });

  it('rejects the pull_request_target trigger', () => {
    const source = compliantWorkflow().replace(
      'pull_request:',
      'pull_request_target:',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('pull_request_target'),
    ]);
  });

  it('finds pull_request_target in a list of triggers', () => {
    const source = compliantWorkflow().replace(
      '  pull_request:\n',
      '  [push, pull_request_target]\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('pull_request_target'),
    ]);
  });

  it('accepts a single trigger written as a bare string', () => {
    const source = compliantWorkflow().replace(
      'on:\n  pull_request:\n',
      'on: push\n',
    );
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('rejects a workflow with no top-level permissions block', () => {
    const source = compliantWorkflow().replace(
      'permissions:\n  contents: read\n',
      '',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('permissions'),
    ]);
  });

  it('rejects a job without a timeout', () => {
    const source = compliantWorkflow().replace('    timeout-minutes: 15\n', '');
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('timeout-minutes'),
    ]);
  });

  it('rejects a timeout longer than the limit', () => {
    const source = compliantWorkflow().replace(
      'timeout-minutes: 15',
      'timeout-minutes: 360',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('the limit is 30'),
    ]);
  });

  it('rejects an action pinned to a tag rather than a commit', () => {
    const source = compliantWorkflow(
      '      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('not pinned to a full commit sha'),
    ]);
  });

  it('rejects an action pinned to an abbreviated commit', () => {
    const source = compliantWorkflow(
      '      - uses: actions/checkout@3d3c42e\n        with:\n          persist-credentials: false\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('not pinned to a full commit sha'),
    ]);
  });

  it('accepts a local action referenced by path', () => {
    const source = compliantWorkflow('      - uses: ./.github/actions/setup\n');
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('rejects a checkout that leaves credentials behind', () => {
    const source = compliantWorkflow(`      - uses: ${PINNED_CHECKOUT}\n`);
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('persist-credentials'),
    ]);
  });

  it('rejects a checkout that persists credentials explicitly', () => {
    const source = compliantWorkflow(
      `      - uses: ${PINNED_CHECKOUT}\n        with:\n          persist-credentials: true\n`,
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('persist-credentials'),
    ]);
  });

  it('rejects an expression interpolated into a run block', () => {
    const source = compliantWorkflow(
      '      - run: echo "${{ github.event.pull_request.title }}"\n',
    );
    expect(problemsOf(source)).toStrictEqual([expect.stringContaining('run:')]);
  });

  it('accepts a run block that reads the same value from the environment', () => {
    const source = compliantWorkflow(
      '      - env:\n          TITLE: ${{ github.event.pull_request.title }}\n        run: echo "${TITLE}"\n',
    );
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('reports every violation in a job rather than stopping at the first', () => {
    const source = `name: CI
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: echo "\${{ github.head_ref }}"
`;
    expect(problemsOf(source)).toHaveLength(5);
  });

  it('reports invalid YAML as a single problem', () => {
    expect(problemsOf('name: [unclosed\n')).toStrictEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });

  it('rejects a document that is not a mapping', () => {
    expect(problemsOf('- a\n- b\n')).toStrictEqual([
      expect.stringContaining('mapping at the top level'),
    ]);
  });

  it('rejects a workflow with no jobs', () => {
    expect(
      problemsOf('name: CI\non: push\npermissions:\n  contents: read\n'),
    ).toStrictEqual([expect.stringContaining('no `jobs` mapping')]);
  });

  it('rejects a job that is not a mapping', () => {
    const source =
      'name: CI\non: push\npermissions:\n  contents: read\njobs:\n  check: "nope"\n';
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('is not a mapping'),
    ]);
  });

  it('ignores a job whose steps key is not a list', () => {
    const source = `name: CI
on: push
permissions:
  contents: read
jobs:
  check:
    timeout-minutes: 5
    uses: ./.github/workflows/reusable.yml
`;
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('rejects an external reusable workflow pinned to a branch', () => {
    const source = `name: CI
on: push
permissions:
  contents: read
jobs:
  deploy:
    uses: octo-org/central/.github/workflows/deploy.yml@main
`;
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('reusable workflow'),
    ]);
  });

  it('accepts an external reusable workflow pinned to a full commit sha', () => {
    const source = `name: CI
on: push
permissions:
  contents: read
jobs:
  deploy:
    uses: octo-org/central/.github/workflows/deploy.yml@3d3c42e5aac5ba805825da76410c181273ba90b1
`;
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('rejects a top-level permissions block that grants every write scope', () => {
    const source = compliantWorkflow().replace(
      'permissions:\n  contents: read\n',
      'permissions: write-all\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('every write scope'),
    ]);
  });

  it('rejects a job that overrides restrictive permissions with write-all', () => {
    const source = compliantWorkflow().replace(
      '    timeout-minutes: 15\n',
      '    timeout-minutes: 15\n    permissions: write-all\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('job `check` declares'),
    ]);
  });

  it('rejects an id-token grant, which mints an OIDC identity for the repository', () => {
    const source = compliantWorkflow().replace(
      'permissions:\n  contents: read\n',
      'permissions:\n  contents: read\n  id-token: write\n',
    );
    expect(problemsOf(source)).toStrictEqual([
      expect.stringContaining('id-token: write'),
    ]);
  });

  it('allows an id-token grant scoped to the job that needs OIDC', () => {
    const source = compliantWorkflow().replace(
      '    steps:\n',
      '    permissions:\n      id-token: write\n    steps:\n',
    );
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('does not demand a timeout on a job that calls a reusable workflow', () => {
    const source = `name: CI
on: push
permissions:
  contents: read
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`;
    expect(problemsOf(source)).toStrictEqual([]);
  });

  it('records the local action a step uses so the caller can check it was scanned', () => {
    const result = checkWorkflow(
      compliantWorkflow('      - uses: ./.github/actions/setup\n'),
    );
    expect([...result.localReferences]).toStrictEqual([
      '.github/actions/setup',
    ]);
  });

  it('records a local reusable workflow separately from local actions', () => {
    const result = checkWorkflow(`name: CI
on: push
permissions:
  contents: read
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`);
    expect([...result.localWorkflowReferences]).toStrictEqual([
      '.github/workflows/reusable.yml',
    ]);
    expect([...result.localReferences]).toStrictEqual([]);
  });
});

describe('checkActionManifest', () => {
  const compliantAction = `name: setup
runs:
  using: composite
  steps:
    - uses: ${PINNED_CHECKOUT}
      with:
        persist-credentials: false
`;

  it('accepts a composite action whose steps satisfy the step rules', () => {
    expect(checkActionManifest(compliantAction).problems).toStrictEqual([]);
  });

  it('rejects an unpinned action inside a composite action', () => {
    const source = compliantAction.replace(
      PINNED_CHECKOUT,
      'actions/checkout@v7',
    );
    expect(checkActionManifest(source).problems).toStrictEqual([
      expect.stringContaining('not pinned to a full commit sha'),
    ]);
  });

  it('rejects an expression interpolated into a composite action run block', () => {
    const source = `name: setup
runs:
  using: composite
  steps:
    - run: echo "\${{ github.head_ref }}"
      shell: bash
`;
    expect(checkActionManifest(source).problems).toStrictEqual([
      expect.stringContaining('run:'),
    ]);
  });

  it('rejects a manifest with no runs mapping', () => {
    expect(checkActionManifest('name: setup\n').problems).toStrictEqual([
      expect.stringContaining('no `runs` mapping'),
    ]);
  });

  it('reports invalid YAML as a single problem', () => {
    expect(checkActionManifest('name: [unclosed\n').problems).toStrictEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });
});

describe('checkWorkflows', () => {
  it('prefixes each problem with the file it came from', () => {
    const problems = checkWorkflows([
      { path: '.github/workflows/ci.yml', source: 'name: CI\non: push\n' },
    ]);
    expect(problems[0]).toContain('.github/workflows/ci.yml');
  });

  it('treats an empty workflow directory as a failure', () => {
    expect(checkWorkflows([])).toStrictEqual([
      expect.stringContaining('No workflow files'),
    ]);
  });

  it('returns nothing when every workflow is compliant', () => {
    expect(
      checkWorkflows([
        { path: '.github/workflows/ci.yml', source: compliantWorkflow() },
      ]),
    ).toStrictEqual([]);
  });

  it('rejects a local action reference whose manifest was never scanned', () => {
    const problems = checkWorkflows([
      {
        path: '.github/workflows/ci.yml',
        source: compliantWorkflow('      - uses: ./.github/actions/setup\n'),
      },
    ]);
    expect(problems).toStrictEqual([
      expect.stringContaining('was not among the scanned manifests'),
    ]);
  });

  it('accepts a nested local action reference whose manifest was scanned', () => {
    const problems = checkWorkflows(
      [
        {
          path: '.github/workflows/ci.yml',
          source: compliantWorkflow(
            '      - uses: ./.github/actions/setup/inner\n',
          ),
        },
      ],
      [
        {
          path: '.github/actions/setup/inner',
          source:
            'name: setup\nruns:\n  using: composite\n  steps:\n    - run: echo ok\n      shell: bash\n',
        },
      ],
    );
    expect(problems).toStrictEqual([]);
  });

  it('accepts a local reusable workflow whose file was scanned', () => {
    const problems = checkWorkflows([
      {
        path: '.github/workflows/ci.yml',
        source: `name: CI
on: push
permissions:
  contents: read
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`,
      },
      { path: '.github/workflows/reusable.yml', source: compliantWorkflow() },
    ]);
    expect(problems).toStrictEqual([]);
  });

  it('rejects a local reusable workflow outside the workflow directory', () => {
    const problems = checkWorkflows([
      {
        path: '.github/workflows/ci.yml',
        source: `name: CI
on: push
permissions:
  contents: read
jobs:
  call:
    uses: ./.github/actions/setup
`,
      },
    ]);
    expect(problems).toStrictEqual([
      expect.stringContaining('must be under .github/workflows'),
    ]);
  });

  it('applies the step rules to the scanned action manifest as well', () => {
    const problems = checkWorkflows(
      [
        {
          path: '.github/workflows/ci.yml',
          source: compliantWorkflow('      - uses: ./.github/actions/setup\n'),
        },
      ],
      [
        {
          path: '.github/actions/setup',
          source:
            'name: setup\nruns:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n',
        },
      ],
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('.github/actions/setup'),
      expect.stringContaining('persist-credentials'),
    ]);
  });
});
