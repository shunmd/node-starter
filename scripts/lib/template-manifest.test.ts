import { describe, expect, it } from 'vitest';

import {
  type TemplateManifest,
  checkManifestCoverage,
  comparablePaths,
  findDuplicateEntries,
  manifestEntries,
  parseTemplateManifest,
} from './template-manifest.ts';

function manifestValue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    coverage: { roots: ['', 'scripts'], ignore: ['^docs/ai/'] },
    groups: [
      {
        id: 'scripts',
        title: 'Quality gate scripts',
        ownership: 'adopt',
        paths: ['scripts/lib/', 'scripts/check-workflows.ts'],
      },
      {
        id: 'toolchain',
        title: 'Toolchain',
        ownership: 'merge',
        paths: ['package.json'],
      },
      {
        id: 'destination',
        title: 'Per project',
        ownership: 'project',
        paths: ['.gitignore'],
      },
    ],
    ...overrides,
  };
}

function validManifest(): TemplateManifest {
  return parseTemplateManifest(manifestValue());
}

const TRACKED = [
  'package.json',
  '.gitignore',
  'scripts/check-workflows.ts',
  'scripts/lib/workflow-policy.ts',
  'src/index.ts',
] as const;

describe('parseTemplateManifest', () => {
  it('reads coverage roots, ignores and groups from a valid document', () => {
    const manifest = validManifest();

    expect(manifest.coverage.roots).toEqual(['', 'scripts']);
    expect(manifest.coverage.ignore).toEqual(['^docs/ai/']);
    expect(manifest.groups).toHaveLength(3);
    expect(manifest.groups[0]?.id).toBe('scripts');
    expect(manifest.groups[0]?.title).toBe('Quality gate scripts');
    expect(manifest.groups[0]?.ownership).toBe('adopt');
  });

  it('rejects a document that is not an object', () => {
    expect(() => parseTemplateManifest([])).toThrow(
      /did not parse to an object/,
    );
    expect(() => parseTemplateManifest(null)).toThrow(
      /did not parse to an object/,
    );
  });

  it('rejects a missing coverage block', () => {
    expect(() => parseTemplateManifest({ groups: [] })).toThrow(
      /coverage must be an object/,
    );
  });

  it('rejects coverage fields that are not string arrays', () => {
    expect(() =>
      parseTemplateManifest(
        manifestValue({ coverage: { roots: 'scripts', ignore: [] } }),
      ),
    ).toThrow(/coverage\.roots must be an array of strings/);
    expect(() =>
      parseTemplateManifest(
        manifestValue({ coverage: { roots: [], ignore: [7] } }),
      ),
    ).toThrow(/coverage\.ignore must be an array of strings/);
  });

  it('rejects an empty or non-array groups list', () => {
    expect(() => parseTemplateManifest(manifestValue({ groups: [] }))).toThrow(
      /groups must be a non-empty array/,
    );
    expect(() => parseTemplateManifest(manifestValue({ groups: {} }))).toThrow(
      /groups must be a non-empty array/,
    );
  });

  it('names the offending group by index', () => {
    expect(() =>
      parseTemplateManifest(manifestValue({ groups: ['not a group'] })),
    ).toThrow(/groups\[0\] must be an object/);
  });

  it('rejects an unknown ownership', () => {
    expect(() =>
      parseTemplateManifest(
        manifestValue({
          groups: [
            { id: 'a', title: 'A', ownership: 'copy', paths: ['package.json'] },
          ],
        }),
      ),
    ).toThrow(/ownership is "copy"; it must be one of adopt, merge, project/);
  });

  it('rejects a group with an empty path list', () => {
    expect(() =>
      parseTemplateManifest(
        manifestValue({
          groups: [{ id: 'a', title: 'A', ownership: 'adopt', paths: [] }],
        }),
      ),
    ).toThrow(/paths must list at least one path/);
  });

  it('rejects a group with a missing or empty identifier', () => {
    expect(() =>
      parseTemplateManifest(
        manifestValue({
          groups: [
            { id: '', title: 'A', ownership: 'adopt', paths: ['package.json'] },
          ],
        }),
      ),
    ).toThrow(/groups\[0\]\.id must be a non-empty string/);
    expect(() =>
      parseTemplateManifest(
        manifestValue({
          groups: [{ id: 'a', ownership: 'adopt', paths: ['package.json'] }],
        }),
      ),
    ).toThrow(/groups\[0\]\.title must be a non-empty string/);
  });
});

describe('manifestEntries', () => {
  it('returns every path when no ownership filter is given', () => {
    expect(manifestEntries(validManifest())).toEqual([
      'scripts/lib/',
      'scripts/check-workflows.ts',
      'package.json',
      '.gitignore',
    ]);
  });

  it('filters to the requested ownerships', () => {
    expect(manifestEntries(validManifest(), ['project'])).toEqual([
      '.gitignore',
    ]);
  });
});

describe('comparablePaths', () => {
  it('excludes project-owned paths, whose content is a destination decision', () => {
    expect(comparablePaths(validManifest())).toEqual([
      'scripts/lib/',
      'scripts/check-workflows.ts',
      'package.json',
    ]);
  });
});

describe('findDuplicateEntries', () => {
  it('finds nothing when each path has one ownership', () => {
    expect(findDuplicateEntries(validManifest())).toEqual([]);
  });

  it('reports a path claimed by two groups', () => {
    const manifest = parseTemplateManifest(
      manifestValue({
        groups: [
          {
            id: 'a',
            title: 'A',
            ownership: 'adopt',
            paths: ['package.json', 'mise.toml'],
          },
          { id: 'b', title: 'B', ownership: 'merge', paths: ['package.json'] },
        ],
      }),
    );

    expect(findDuplicateEntries(manifest)).toEqual(['package.json']);
  });
});

describe('checkManifestCoverage', () => {
  it('accepts a manifest that matches the repository', () => {
    expect(checkManifestCoverage(validManifest(), [...TRACKED])).toEqual([]);
  });

  it('reports a tracked file below a root that no group lists', () => {
    const problems = checkManifestCoverage(validManifest(), [
      ...TRACKED,
      'scripts/github-settings.ts',
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"scripts/github-settings.ts" is not listed');
  });

  it('reports a listed path that matches no file, so a rename cannot go unnoticed', () => {
    const problems = checkManifestCoverage(
      validManifest(),
      TRACKED.filter((file) => file !== 'scripts/check-workflows.ts'),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'lists "scripts/check-workflows.ts", which matches no tracked file',
    );
  });

  it('reports a path two groups both claim', () => {
    const manifest = parseTemplateManifest(
      manifestValue({
        groups: [
          { id: 'a', title: 'A', ownership: 'adopt', paths: ['package.json'] },
          { id: 'b', title: 'B', ownership: 'merge', paths: ['package.json'] },
        ],
      }),
    );

    const problems = checkManifestCoverage(manifest, ['package.json']);

    expect(problems).toEqual([
      expect.stringContaining('in more than one group'),
    ]);
  });

  it('ignores files outside the declared roots', () => {
    expect(
      checkManifestCoverage(validManifest(), [
        ...TRACKED,
        'src/deep/module.ts',
      ]),
    ).toEqual([]);
  });

  it('treats the empty root as top-level files only', () => {
    const problems = checkManifestCoverage(validManifest(), [
      ...TRACKED,
      'renovate.json',
    ]);

    expect(problems).toEqual([
      expect.stringContaining('"renovate.json" is not listed'),
    ]);
  });

  it('skips files matching a coverage ignore pattern', () => {
    const manifest = parseTemplateManifest(
      manifestValue({
        coverage: { roots: ['scripts'], ignore: ['^scripts/local/'] },
        groups: [
          {
            id: 'scripts',
            title: 'Quality gate scripts',
            ownership: 'adopt',
            paths: ['scripts/lib/', 'scripts/check-workflows.ts'],
          },
        ],
      }),
    );

    expect(
      checkManifestCoverage(manifest, [
        'scripts/check-workflows.ts',
        'scripts/lib/workflow-policy.ts',
        'scripts/local/scratch.ts',
      ]),
    ).toEqual([]);
  });

  it('matches a directory entry only as a prefix, not as a name fragment', () => {
    const problems = checkManifestCoverage(validManifest(), [
      ...TRACKED,
      'scripts/library-notes.md',
    ]);

    expect(problems).toEqual([
      expect.stringContaining('"scripts/library-notes.md" is not listed'),
    ]);
  });
});
