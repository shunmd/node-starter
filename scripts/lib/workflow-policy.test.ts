import { describe, expect, it } from 'vitest';

import { checkWorkflow, checkWorkflows } from './workflow-policy.ts';

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

describe('checkWorkflow', () => {
  it('accepts a workflow that satisfies every rule', () => {
    expect(checkWorkflow(compliantWorkflow())).toStrictEqual([]);
  });

  it('rejects the pull_request_target trigger', () => {
    const source = compliantWorkflow().replace(
      'pull_request:',
      'pull_request_target:',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('pull_request_target'),
    ]);
  });

  it('finds pull_request_target in a list of triggers', () => {
    const source = compliantWorkflow().replace(
      '  pull_request:\n',
      '  [push, pull_request_target]\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('pull_request_target'),
    ]);
  });

  it('accepts a single trigger written as a bare string', () => {
    const source = compliantWorkflow().replace(
      'on:\n  pull_request:\n',
      'on: push\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([]);
  });

  it('rejects a workflow with no top-level permissions block', () => {
    const source = compliantWorkflow().replace(
      'permissions:\n  contents: read\n',
      '',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('permissions'),
    ]);
  });

  it('rejects a job without a timeout', () => {
    const source = compliantWorkflow().replace('    timeout-minutes: 15\n', '');
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('timeout-minutes'),
    ]);
  });

  it('rejects a timeout longer than the limit', () => {
    const source = compliantWorkflow().replace(
      'timeout-minutes: 15',
      'timeout-minutes: 360',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('the limit is 30'),
    ]);
  });

  it('rejects an action pinned to a tag rather than a commit', () => {
    const source = compliantWorkflow(
      '      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('not pinned to a full commit sha'),
    ]);
  });

  it('rejects an action pinned to an abbreviated commit', () => {
    const source = compliantWorkflow(
      '      - uses: actions/checkout@3d3c42e\n        with:\n          persist-credentials: false\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('not pinned to a full commit sha'),
    ]);
  });

  it('accepts a local action referenced by path', () => {
    const source = compliantWorkflow('      - uses: ./.github/actions/setup\n');
    expect(checkWorkflow(source)).toStrictEqual([]);
  });

  it('rejects a checkout that leaves credentials behind', () => {
    const source = compliantWorkflow(`      - uses: ${PINNED_CHECKOUT}\n`);
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('persist-credentials'),
    ]);
  });

  it('rejects a checkout that persists credentials explicitly', () => {
    const source = compliantWorkflow(
      `      - uses: ${PINNED_CHECKOUT}\n        with:\n          persist-credentials: true\n`,
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('persist-credentials'),
    ]);
  });

  it('rejects an expression interpolated into a run block', () => {
    const source = compliantWorkflow(
      '      - run: echo "${{ github.event.pull_request.title }}"\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([
      expect.stringContaining('run:'),
    ]);
  });

  it('accepts a run block that reads the same value from the environment', () => {
    const source = compliantWorkflow(
      '      - env:\n          TITLE: ${{ github.event.pull_request.title }}\n        run: echo "${TITLE}"\n',
    );
    expect(checkWorkflow(source)).toStrictEqual([]);
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
    expect(checkWorkflow(source)).toHaveLength(5);
  });

  it('reports invalid YAML as a single problem', () => {
    expect(checkWorkflow('name: [unclosed\n')).toStrictEqual([
      expect.stringContaining('not valid YAML'),
    ]);
  });

  it('rejects a document that is not a mapping', () => {
    expect(checkWorkflow('- a\n- b\n')).toStrictEqual([
      expect.stringContaining('mapping at the top level'),
    ]);
  });

  it('rejects a workflow with no jobs', () => {
    expect(
      checkWorkflow('name: CI\non: push\npermissions:\n  contents: read\n'),
    ).toStrictEqual([expect.stringContaining('no `jobs` mapping')]);
  });

  it('rejects a job that is not a mapping', () => {
    const source =
      'name: CI\non: push\npermissions:\n  contents: read\njobs:\n  check: "nope"\n';
    expect(checkWorkflow(source)).toStrictEqual([
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
    expect(checkWorkflow(source)).toStrictEqual([]);
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
});
