import { describe, expect, it } from 'vitest';

import {
  checkJob,
  checkSteps,
  checkWorkflowTriggersAndPermissions,
  type WorkflowReferences,
} from './workflow-rules.ts';

const PINNED_CHECKOUT =
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const PINNED_ACTION =
  'actions/setup-node@3d3c42e5aac5ba805825da76410c181273ba90b1';
const PINNED_REUSABLE_WORKFLOW =
  'owner/repo/.github/workflows/build.yml@3d3c42e5aac5ba805825da76410c181273ba90b1';

function references(): WorkflowReferences {
  return {
    localActionReferences: new Set<string>(),
    localWorkflowReferences: new Set<string>(),
  };
}

describe('checkSteps', () => {
  it('flags an action reference that is not pinned to a full commit sha', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ uses: 'actions/setup-node@v4' }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      'job `build` uses `actions/setup-node@v4`, which is not pinned to a ' +
        'full commit sha. A tag or branch can be re-pointed at different ' +
        'code after review.',
    ]);
  });

  it('accepts an action pinned to a full commit sha', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ uses: PINNED_ACTION }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('rejects an action reference with a trailing character after the sha', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ uses: `${PINNED_ACTION}x` }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      `job \`build\` uses \`${PINNED_ACTION}x\`, which is not pinned to a ` +
        'full commit sha. A tag or branch can be re-pointed at different ' +
        'code after review.',
    ]);
  });

  it('rejects an action reference with extra content before the owner', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ uses: `oops ${PINNED_ACTION}` }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      `job \`build\` uses \`oops ${PINNED_ACTION}\`, which is not pinned to ` +
        'a full commit sha. A tag or branch can be re-pointed at different ' +
        'code after review.',
    ]);
  });

  it('records a local action reference without flagging it', () => {
    const problems: string[] = [];
    const localReferences = new Set<string>();
    checkSteps(
      'job `build`',
      { steps: [{ uses: './.github/actions/setup/' }] },
      problems,
      localReferences,
    );
    expect(problems).toStrictEqual([]);
    expect(localReferences).toStrictEqual(new Set(['.github/actions/setup']));
  });

  it('strips every trailing slash from a local action reference', () => {
    const localReferences = new Set<string>();
    checkSteps(
      'job `build`',
      { steps: [{ uses: './.github/actions/setup//' }] },
      [],
      localReferences,
    );
    expect(localReferences).toStrictEqual(new Set(['.github/actions/setup']));
  });

  it('flags a checkout step missing persist-credentials: false', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ uses: PINNED_CHECKOUT }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      'job `build` checks out without `persist-credentials: false`, leaving ' +
        'a usable token in .git/config for every later step, including ' +
        'dependency install scripts.',
    ]);
  });

  it('flags a checkout step whose with block is not a plain object', () => {
    const problems: string[] = [];
    const withArray = Object.assign([], { 'persist-credentials': false });
    checkSteps(
      'job `build`',
      { steps: [{ uses: PINNED_CHECKOUT, with: withArray }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      'job `build` checks out without `persist-credentials: false`, leaving ' +
        'a usable token in .git/config for every later step, including ' +
        'dependency install scripts.',
    ]);
  });

  it('accepts a checkout step with persist-credentials: false', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      {
        steps: [
          { uses: PINNED_CHECKOUT, with: { 'persist-credentials': false } },
        ],
      },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('flags a run step that interpolates a ${{ }} expression', () => {
    const problems: string[] = [];
    checkSteps(
      'job `build`',
      { steps: [{ run: 'echo ${{ github.event.issue.title }}' }] },
      problems,
      new Set(),
    );
    expect(problems).toStrictEqual([
      'job `build` interpolates a ${{ }} expression directly into `run:`. ' +
        'The value is pasted into the shell before it executes, so anything ' +
        'that can influence it can run commands. Bind it to `env:` and ' +
        'reference the environment variable instead.',
    ]);
  });

  it('does nothing when steps is not an array', () => {
    const problems: string[] = [];
    checkSteps('job `build`', {}, problems, new Set());
    expect(problems).toStrictEqual([]);
  });

  it('ignores non-record entries in the steps array without crashing', () => {
    const problems: string[] = [];
    expect(() => {
      checkSteps(
        'job `build`',
        { steps: ['not-a-step', null, 42] },
        problems,
        new Set(),
      );
    }).not.toThrow();
    expect(problems).toStrictEqual([]);
  });
});

describe('checkJob', () => {
  function baseJob(overrides: Record<string, unknown> = {}) {
    return {
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 15,
      steps: [
        { uses: PINNED_CHECKOUT, with: { 'persist-credentials': false } },
      ],
      ...overrides,
    };
  }

  it('flags a job without timeout-minutes', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ 'timeout-minutes': undefined }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `build` does not set timeout-minutes, so a hung step occupies a ' +
        'runner for the six-hour default.',
    ]);
  });

  it('flags a job whose timeout-minutes exceeds the limit', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ 'timeout-minutes': 45 }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `build` sets timeout-minutes to 45; the limit is 30.',
    ]);
  });

  it('accepts a job within the timeout limit', () => {
    const problems: string[] = [];
    checkJob('build', baseJob(), problems, references());
    expect(problems).toStrictEqual([]);
  });

  it('accepts a job whose timeout-minutes equals the limit exactly', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ 'timeout-minutes': 30 }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('skips the timeout check for a job that calls a reusable workflow', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      { uses: PINNED_REUSABLE_WORKFLOW },
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('flags job-level permissions: write-all', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: 'write-all' }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `build` declares `permissions: write-all`, which grants every ' +
        'write scope at once. List the individual scopes the job needs.',
    ]);
  });

  it('flags job-level permissions: write', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: 'write' }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `build` declares `permissions: write`, which grants every write ' +
        'scope at once. List the individual scopes the job needs.',
    ]);
  });

  it('accepts a job-level permissions string outside the broad set', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: 'read-all' }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('allows id-token: write at the job level', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: { 'id-token': 'write' } }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('does not flag id-token: read at the job level', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: { 'id-token': 'read' } }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('does not flag a write scope other than id-token', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: { actions: 'write' } }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('ignores a non-string permission scope value', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      baseJob({ permissions: { 'id-token': 5 } }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('accepts a local reusable workflow under .github/workflows/', () => {
    const problems: string[] = [];
    const refs = references();
    checkJob(
      'build',
      { uses: './.github/workflows/build.yml' },
      problems,
      refs,
    );
    expect(problems).toStrictEqual([]);
    expect(refs.localWorkflowReferences).toStrictEqual(
      new Set(['.github/workflows/build.yml']),
    );
  });

  it('rejects a local reusable workflow outside .github/workflows/', () => {
    const problems: string[] = [];
    checkJob('build', { uses: './scripts/build.yml' }, problems, references());
    expect(problems).toStrictEqual([
      'job `build` uses local reusable workflow `./scripts/build.yml`, ' +
        'which must be under .github/workflows/.',
    ]);
  });

  it('accepts an external reusable workflow pinned to a full commit sha', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      { uses: PINNED_REUSABLE_WORKFLOW },
      problems,
      references(),
    );
    expect(problems).toStrictEqual([]);
  });

  it('rejects an external reusable workflow that is not pinned', () => {
    const problems: string[] = [];
    checkJob(
      'build',
      { uses: 'owner/repo/.github/workflows/build.yml@main' },
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `build` uses reusable workflow ' +
        '`owner/repo/.github/workflows/build.yml@main`, which is not pinned ' +
        'to a full commit sha. A tag or branch can be re-pointed at ' +
        'different code after review.',
    ]);
  });

  it('rejects an external reusable workflow with trailing content after the sha', () => {
    const problems: string[] = [];
    const uses = `${PINNED_REUSABLE_WORKFLOW}x`;
    checkJob('build', { uses }, problems, references());
    expect(problems).toStrictEqual([
      `job \`build\` uses reusable workflow \`${uses}\`, which is not ` +
        'pinned to a full commit sha. A tag or branch can be re-pointed at ' +
        'different code after review.',
    ]);
  });

  it('rejects an external reusable workflow with content before the owner', () => {
    const problems: string[] = [];
    const uses = `oops ${PINNED_REUSABLE_WORKFLOW}`;
    checkJob('build', { uses }, problems, references());
    expect(problems).toStrictEqual([
      `job \`build\` uses reusable workflow \`${uses}\`, which is not ` +
        'pinned to a full commit sha. A tag or branch can be re-pointed at ' +
        'different code after review.',
    ]);
  });

  it('reports the job name in every step-level problem it collects', () => {
    const problems: string[] = [];
    checkJob(
      'lint',
      baseJob({ steps: [{ uses: 'actions/setup-node@v4' }] }),
      problems,
      references(),
    );
    expect(problems).toStrictEqual([
      'job `lint` uses `actions/setup-node@v4`, which is not pinned to a ' +
        'full commit sha. A tag or branch can be re-pointed at different ' +
        'code after review.',
    ]);
  });
});

describe('checkWorkflowTriggersAndPermissions', () => {
  it('flags the pull_request_target trigger', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      { on: 'pull_request_target', permissions: { contents: 'read' } },
      problems,
    );
    expect(problems).toStrictEqual([
      'uses the pull_request_target trigger, which runs with a writable ' +
        'token in the context of the base repository while checking out ' +
        'code a fork controls. Use pull_request instead and pass anything ' +
        'privileged through a separate workflow.',
    ]);
  });

  it('finds pull_request_target among an array of string triggers', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      {
        on: ['push', 'pull_request_target'],
        permissions: { contents: 'read' },
      },
      problems,
    );
    expect(problems).toStrictEqual([
      'uses the pull_request_target trigger, which runs with a writable ' +
        'token in the context of the base repository while checking out ' +
        'code a fork controls. Use pull_request instead and pass anything ' +
        'privileged through a separate workflow.',
    ]);
  });

  it('ignores a non-string entry in an array of triggers', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      { on: [123, 'push'], permissions: { contents: 'read' } },
      problems,
    );
    expect(problems).toStrictEqual([]);
  });

  it('treats a workflow with no `on` trigger at all as declaring none', () => {
    const problems: string[] = [];
    expect(() => {
      checkWorkflowTriggersAndPermissions(
        { permissions: { contents: 'read' } },
        problems,
      );
    }).not.toThrow();
    expect(problems).toStrictEqual([]);
  });

  it('flags a workflow with no top-level permissions block', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions({ on: 'push' }, problems);
    expect(problems).toStrictEqual([
      'does not declare top-level `permissions`, so its jobs inherit ' +
        'whatever the repository default is. Declare the least privilege ' +
        'the workflow needs.',
    ]);
  });

  it('flags id-token: write at the workflow level', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      { on: 'push', permissions: { 'id-token': 'write' } },
      problems,
    );
    expect(problems).toStrictEqual([
      'the workflow grants `id-token: write`, which lets the job mint an ' +
        'OIDC identity for this repository. Grant it only in the job that ' +
        'needs to authenticate.',
    ]);
  });

  it('exempts the contents scope from the write check', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      { on: 'push', permissions: { contents: 'write' } },
      problems,
    );
    expect(problems).toStrictEqual([]);
  });

  it('accepts a compliant workflow', () => {
    const problems: string[] = [];
    checkWorkflowTriggersAndPermissions(
      { on: 'push', permissions: { contents: 'read' } },
      problems,
    );
    expect(problems).toStrictEqual([]);
  });
});
