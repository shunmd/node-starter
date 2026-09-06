import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

const readFileMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  readdir: readdirMock,
}));

const { loadConfiguration, readCiWorkflowSource, repositoryRoot } =
  await import('./io.ts');

function file(name: string): { name: string; isFile: () => boolean } {
  return { name, isFile: () => true };
}

/**
 * Serves this repository's own infra/github/ documents, so the happy path is
 * checked against the desired state the gate actually enforces rather than a
 * fixture that can drift away from the schema.
 */
function stubRepository(): void {
  readdirMock.mockImplementation((directory: string) =>
    Promise.resolve(
      directory.endsWith('rulesets')
        ? [file('main.json'), file('a-main.json'), file('notes.txt')]
        : [file('production.json')],
    ),
  );
  readFileMock.mockImplementation((path: string) =>
    Promise.resolve(readFileSync(realPath(path), 'utf8')),
  );
}

/** `a-main.json` is a second copy of the real ruleset, used to test ordering. */
function realPath(path: string): string {
  return path.replace('a-main.json', 'main.json');
}

describe('repositoryRoot', () => {
  it('points at the repository, not at scripts/github-settings', () => {
    expect(repositoryRoot.endsWith('github-settings')).toBe(false);
    expect(repositoryRoot.endsWith('scripts')).toBe(false);
  });
});

describe('readCiWorkflowSource', () => {
  it('reads .github/workflows/ci.yml from the repository root', async () => {
    readFileMock.mockResolvedValue('name: CI');
    await expect(readCiWorkflowSource()).resolves.toBe('name: CI');
    expect(readFileMock).toHaveBeenCalledWith(
      `${repositoryRoot}/.github/workflows/ci.yml`,
      'utf8',
    );
  });
});

describe('loadConfiguration', () => {
  it('reads every declared document and ignores non-JSON files', async () => {
    stubRepository();
    const configuration = await loadConfiguration();
    // Two ruleset documents, read in name order, and notes.txt ignored.
    expect(
      configuration.rulesets.map((ruleset) => ruleset['name']),
    ).toStrictEqual(['main', 'main']);
    expect(configuration.environments).toHaveLength(1);
    expect(configuration.environments[0]?.['environment']).toBe('production');
    expect(configuration.repository['default_branch']).toBe('main');
  });

  it('reports an unreadable infrastructure file as one named failure', async () => {
    readdirMock.mockResolvedValue([]);
    readFileMock.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );
    await expect(loadConfiguration()).rejects.toThrow(
      'Unable to read GitHub infrastructure JSON: ENOENT',
    );
  });

  it('reports a non-Error read failure without losing it', async () => {
    readdirMock.mockResolvedValue([]);
    readFileMock.mockRejectedValue('disk gone');
    await expect(loadConfiguration()).rejects.toThrow(
      'Unable to read GitHub infrastructure JSON: disk gone',
    );
  });

  it('rejects invalid desired state rather than applying it', async () => {
    stubRepository();
    readFileMock.mockImplementation((path: string) =>
      path.endsWith('repository-settings.json')
        ? Promise.resolve('[]')
        : Promise.resolve(readFileSync(realPath(path), 'utf8')),
    );
    await expect(loadConfiguration()).rejects.toThrow(
      'Invalid GitHub infrastructure configuration',
    );
  });

  it('reads every document as UTF-8 text with directory entry types', async () => {
    stubRepository();
    await loadConfiguration();
    expect(readFileMock).toHaveBeenCalledWith(
      `${repositoryRoot}/infra/github/repository-settings.json`,
      'utf8',
    );
    expect(readdirMock).toHaveBeenCalledWith(
      `${repositoryRoot}/infra/github/rulesets`,
      { withFileTypes: true },
    );
  });

  it('ignores directory entries that are not files', async () => {
    readdirMock.mockImplementation((directory: string) =>
      Promise.resolve(
        directory.endsWith('rulesets')
          ? [{ name: 'nested.json', isFile: () => false }, file('main.json')]
          : [file('production.json')],
      ),
    );
    readFileMock.mockImplementation((path: string) =>
      Promise.resolve(readFileSync(realPath(path), 'utf8')),
    );
    const configuration = await loadConfiguration();
    expect(configuration.rulesets).toHaveLength(1);
  });

  it('reports the path of a document that is not JSON', async () => {
    readdirMock.mockResolvedValue([]);
    readFileMock.mockResolvedValue('not json');
    await expect(loadConfiguration()).rejects.toThrow(
      /Unable to read GitHub infrastructure JSON: .*JSON/,
    );
  });
});
