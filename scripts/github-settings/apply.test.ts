import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as githubApi from './github-api.ts';

import type { DesiredConfiguration } from '../lib/github-settings-types.ts';

const requestMock = vi.hoisted(() => vi.fn());
const requestRulesetSummariesMock = vi.hoisted(() => vi.fn());

vi.mock('./github-api.ts', async () => {
  const actual = await vi.importActual<typeof githubApi>('./github-api.ts');
  return {
    ...actual,
    request: requestMock,
    requestRulesetSummaries: requestRulesetSummariesMock,
  };
});

const { applyConfiguration, assertApplyIsAuthorized } =
  await import('./apply.ts');

const reference = { owner: 'owner', name: 'name' } as const;

function configuration(
  overrides: Partial<DesiredConfiguration> = {},
): DesiredConfiguration {
  return {
    repository: { default_branch: 'main', unknown_field: 'ignored' },
    rulesets: [{ name: 'main', target: 'branch' }],
    environments: [{ environment: 'production', reviewers: [] }],
    secrets: { repository: [], environments: {} },
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockResolvedValue({ status: 200, body: {} });
  requestRulesetSummariesMock.mockResolvedValue({
    available: true,
    summaries: [],
  });
  vi.stubEnv('GITHUB_ACTIONS', '');
  vi.stubEnv('GITHUB_EVENT_NAME', '');
  vi.stubEnv('GITHUB_REF', '');
  vi.stubEnv('ALLOW_GITHUB_SETTINGS_APPLY', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('assertApplyIsAuthorized', () => {
  it('allows the protected workflow_dispatch job on main', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    expect(() => {
      assertApplyIsAuthorized();
    }).not.toThrow();
  });

  it('allows an explicit local opt-in', () => {
    vi.stubEnv('ALLOW_GITHUB_SETTINGS_APPLY', '1');
    expect(() => {
      assertApplyIsAuthorized();
    }).not.toThrow();
  });

  it('refuses a workflow_dispatch run on another branch', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');
    vi.stubEnv('GITHUB_REF', 'refs/heads/topic');
    expect(() => {
      assertApplyIsAuthorized();
    }).toThrow('Apply is restricted to workflow_dispatch on main');
  });

  it('refuses a pull request run, which is the bypass ADR 8 removes', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    expect(() => {
      assertApplyIsAuthorized();
    }).toThrow('Apply is restricted to workflow_dispatch on main');
  });

  it('refuses a local run that is not opted in, even outside Actions', () => {
    vi.stubEnv('GITHUB_ACTIONS', '');
    vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    expect(() => {
      assertApplyIsAuthorized();
    }).toThrow(
      'Apply is restricted to workflow_dispatch on main or ALLOW_GITHUB_SETTINGS_APPLY=1',
    );
  });

  it('refuses an opt-in value other than 1', () => {
    vi.stubEnv('ALLOW_GITHUB_SETTINGS_APPLY', 'yes');
    expect(() => {
      assertApplyIsAuthorized();
    }).toThrow('Apply is restricted to workflow_dispatch on main');
  });
});

describe('applyConfiguration', () => {
  it('patches only the declared repository fields', async () => {
    await applyConfiguration(reference, configuration());
    expect(requestMock).toHaveBeenNthCalledWith(1, reference, '', 'PATCH', {
      default_branch: 'main',
    });
  });

  it('creates a ruleset that does not exist yet', async () => {
    await applyConfiguration(reference, configuration());
    expect(requestMock).toHaveBeenCalledWith(reference, '/rulesets', 'POST', {
      name: 'main',
      target: 'branch',
    });
  });

  it('updates a ruleset that already exists, by id', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: true,
      summaries: [{ id: 7, name: 'main' }],
    });
    await applyConfiguration(reference, configuration());
    expect(requestMock).toHaveBeenCalledWith(reference, '/rulesets/7', 'PUT', {
      name: 'main',
      target: 'branch',
    });
  });

  it('skips a ruleset with no name rather than creating an unnamed one', async () => {
    await applyConfiguration(
      reference,
      configuration({ rulesets: [{ target: 'branch' }] }),
    );
    expect(requestMock).not.toHaveBeenCalledWith(
      reference,
      '/rulesets',
      'POST',
      expect.anything(),
    );
  });

  it('skips ruleset apply when the plan does not offer rulesets', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: false,
      summaries: [],
    });
    await applyConfiguration(reference, configuration());
    expect(requestMock).not.toHaveBeenCalledWith(
      reference,
      '/rulesets',
      'POST',
      expect.anything(),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rulesets are not available'),
    );
  });

  it('applies each environment under its encoded name', async () => {
    await applyConfiguration(
      reference,
      configuration({ environments: [{ environment: 'stag ing' }] }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      reference,
      '/environments/stag%20ing',
      'PUT',
      expect.anything(),
    );
  });

  it('skips an environment entry with no name', async () => {
    await applyConfiguration(
      reference,
      configuration({ environments: [{ reviewers: [] }] }),
    );
    expect(requestMock).not.toHaveBeenCalledWith(
      reference,
      expect.stringContaining('/environments/'),
      'PUT',
      expect.anything(),
    );
  });

  it('fails loudly when GitHub rejects a call', async () => {
    requestMock.mockResolvedValue({
      status: 422,
      body: { message: 'Validation failed' },
    });
    await expect(
      applyConfiguration(reference, configuration()),
    ).rejects.toThrow(
      'Applying repository settings failed with HTTP 422: Validation failed',
    );
  });

  it('never touches secret values', async () => {
    await applyConfiguration(reference, configuration());
    expect(console.log).toHaveBeenCalledWith(
      'Secret values were not read or changed.',
    );
  });

  it('lists rulesets under the operation name the apply report uses', async () => {
    await applyConfiguration(reference, configuration());
    expect(requestRulesetSummariesMock).toHaveBeenCalledWith(
      reference,
      'Listing repository rulesets before apply',
    );
  });

  it('logs what it applied, in order', async () => {
    await applyConfiguration(reference, configuration());
    expect(vi.mocked(console.log).mock.calls.flat()).toStrictEqual([
      'Applied repository settings.',
      'Created ruleset main.',
      'Applied environment production.',
      'Secret values were not read or changed.',
    ]);
  });

  it('logs an updated ruleset rather than a created one', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: true,
      summaries: [{ id: 7, name: 'main' }],
    });
    await applyConfiguration(reference, configuration());
    expect(vi.mocked(console.log).mock.calls.flat()).toContain(
      'Updated ruleset main.',
    );
  });

  it('warns with the reason rulesets were skipped', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: false,
      summaries: [],
    });
    await applyConfiguration(reference, configuration());
    expect(vi.mocked(console.warn).mock.calls.flat()).toStrictEqual([
      'Rulesets are not available on this repository (requires GitHub Pro/Team/Enterprise for a private repository, or making it public). Skipping ruleset apply.',
    ]);
  });

  it('ignores a summary that is not a record when matching by name', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: true,
      summaries: ['main', { id: 7, name: 'other' }, { name: 'main' }],
    });
    await applyConfiguration(reference, configuration());
    expect(requestMock).toHaveBeenCalledWith(
      reference,
      '/rulesets',
      'POST',
      expect.anything(),
    );
  });

  it('names the ruleset in an update failure', async () => {
    requestRulesetSummariesMock.mockResolvedValue({
      available: true,
      summaries: [{ id: 7, name: 'main' }],
    });
    requestMock.mockImplementation((_reference: unknown, path: string) =>
      Promise.resolve(
        path === '/rulesets/7'
          ? { status: 422, body: { message: 'Invalid' } }
          : { status: 200, body: {} },
      ),
    );
    await expect(
      applyConfiguration(reference, configuration()),
    ).rejects.toThrow('Updating ruleset main failed with HTTP 422: Invalid');
  });

  it('names the ruleset in a create failure', async () => {
    requestMock.mockImplementation((_reference: unknown, path: string) =>
      Promise.resolve(
        path === '/rulesets'
          ? { status: 422, body: { message: 'Invalid' } }
          : { status: 200, body: {} },
      ),
    );
    await expect(
      applyConfiguration(reference, configuration()),
    ).rejects.toThrow('Creating ruleset main failed with HTTP 422: Invalid');
  });

  it('names the environment in an apply failure', async () => {
    requestMock.mockImplementation((_reference: unknown, path: string) =>
      Promise.resolve(
        path === '/environments/production'
          ? { status: 422, body: { message: 'Invalid' } }
          : { status: 200, body: {} },
      ),
    );
    await expect(
      applyConfiguration(reference, configuration()),
    ).rejects.toThrow(
      'Applying environment production failed with HTTP 422: Invalid',
    );
  });

  it('sends the environment body without the environment name field', async () => {
    await applyConfiguration(
      reference,
      configuration({
        environments: [{ environment: 'production', wait_timer: 5 }],
      }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      reference,
      '/environments/production',
      'PUT',
      { wait_timer: 5 },
    );
  });
});
