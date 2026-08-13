import { describe, expect, it } from 'vitest';

import {
  type ScopeDocuments,
  checkScopesResolve,
  collectDeclaredScopes,
  scopePatterns,
} from './scope-contract.ts';

function documents(overrides: Partial<ScopeDocuments> = {}): ScopeDocuments {
  return {
    packageJson: {
      scripts: {
        architecture:
          'depcruise --config .dependency-cruiser.json -- src scripts',
      },
    },
    vitestConfigSource: `export default {
  test: {
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
    coverage: {
      include: ['src/**/*.ts', 'scripts/lib/**/*.ts'],
    },
  },
};`,
    strykerConfig: {
      mutate: ['src/**/*.ts', 'scripts/lib/**/*.ts', '!**/*.test.ts'],
    },
    jscpdConfig: { path: ['src', 'scripts'] },
    ...overrides,
  };
}

describe('collectDeclaredScopes', () => {
  it('reads a scope from each of the five sources', () => {
    const scopes = collectDeclaredScopes(documents());
    const sources = new Set(scopes.map((scope) => scope.source));

    expect(sources).toEqual(
      new Set([
        'stryker.config.json mutate',
        'vitest.config.ts coverage.include',
        'vitest.config.ts include',
        '.jscpd.json path',
        'the "architecture" script in package.json',
      ]),
    );
  });

  it('turns a bare directory into a recursive glob', () => {
    const scopes = collectDeclaredScopes(documents());
    const jscpdScope = scopes.find((scope) => scope.declared === 'src');

    expect(jscpdScope?.pattern).toBe('src/**/*');
  });

  it('strips a trailing slash before appending the recursive glob, rather than doubling it', () => {
    const scopes = collectDeclaredScopes(
      documents({ jscpdConfig: { path: ['scripts/'] } }),
    );

    expect(
      scopes.filter((scope) => scope.source === '.jscpd.json path'),
    ).toEqual([
      expect.objectContaining({
        declared: 'scripts/',
        pattern: 'scripts/**/*',
      }),
    ]);
  });

  it('only strips a slash at the very end, not one in the middle of the path', () => {
    const scopes = collectDeclaredScopes(
      documents({ jscpdConfig: { path: ['src/lib'] } }),
    );

    expect(
      scopes.filter((scope) => scope.source === '.jscpd.json path'),
    ).toEqual([
      expect.objectContaining({ declared: 'src/lib', pattern: 'src/lib/**/*' }),
    ]);
  });

  it('leaves an existing glob pattern as written', () => {
    const scopes = collectDeclaredScopes(documents());
    const strykerScope = scopes.find(
      (scope) => scope.declared === 'src/**/*.ts',
    );

    expect(strykerScope?.pattern).toBe('src/**/*.ts');
  });

  it('skips exclusion patterns, which narrow a scope rather than define one', () => {
    const scopes = collectDeclaredScopes(
      documents({
        strykerConfig: { mutate: ['src/**/*.ts', '!**/*.test.ts'] },
      }),
    );

    expect(
      scopes.filter((scope) => scope.source === 'stryker.config.json mutate'),
    ).toEqual([expect.objectContaining({ declared: 'src/**/*.ts' })]);
  });

  it('skips a declared value that is the empty string', () => {
    const scopes = collectDeclaredScopes(
      documents({ jscpdConfig: { path: ['src', ''] } }),
    );

    expect(
      scopes.filter((scope) => scope.source === '.jscpd.json path'),
    ).toEqual([expect.objectContaining({ declared: 'src' })]);
  });

  it('drops a non-string entry from a stryker mutate array rather than treating it as a path', () => {
    const scopes = collectDeclaredScopes(
      documents({ strykerConfig: { mutate: ['src/**/*.ts', 5, null] } }),
    );

    expect(
      scopes.filter((scope) => scope.source === 'stryker.config.json mutate'),
    ).toEqual([expect.objectContaining({ declared: 'src/**/*.ts' })]);
  });

  it('returns nothing for a stryker config with no mutate array', () => {
    const scopes = collectDeclaredScopes(
      documents({ strykerConfig: { thresholds: { break: 80 } } }),
    );

    expect(
      scopes.some((scope) => scope.source === 'stryker.config.json mutate'),
    ).toBe(false);
  });

  it('returns nothing when stryker.config.json did not parse to an object', () => {
    const scopes = collectDeclaredScopes(documents({ strykerConfig: null }));

    expect(
      scopes.some((scope) => scope.source === 'stryker.config.json mutate'),
    ).toBe(false);
  });

  it('returns nothing when .jscpd.json did not parse to an object', () => {
    const scopes = collectDeclaredScopes(documents({ jscpdConfig: [] }));

    expect(scopes.some((scope) => scope.source === '.jscpd.json path')).toBe(
      false,
    );
  });

  it('returns nothing when package.json has no architecture script', () => {
    const scopes = collectDeclaredScopes(documents({ packageJson: {} }));

    expect(
      scopes.some(
        (scope) => scope.source === 'the "architecture" script in package.json',
      ),
    ).toBe(false);
  });

  it('returns nothing when the architecture script has no -- separator', () => {
    const scopes = collectDeclaredScopes(
      documents({
        packageJson: { scripts: { architecture: 'depcruise --config x.json' } },
      }),
    );

    expect(
      scopes.some(
        (scope) => scope.source === 'the "architecture" script in package.json',
      ),
    ).toBe(false);
  });

  it('returns nothing when the architecture script is not a string', () => {
    const scopes = collectDeclaredScopes(
      documents({
        packageJson: { scripts: { architecture: ['not', 'a', 'string'] } },
      }),
    );

    expect(
      scopes.some(
        (scope) => scope.source === 'the "architecture" script in package.json',
      ),
    ).toBe(false);
  });

  it('returns nothing when the architecture script is a number rather than a string', () => {
    const scopes = collectDeclaredScopes(
      documents({ packageJson: { scripts: { architecture: 42 } } }),
    );

    expect(
      scopes.some(
        (scope) => scope.source === 'the "architecture" script in package.json',
      ),
    ).toBe(false);
  });

  it('filters out an empty target left by an extra space right after the -- separator', () => {
    const scopes = collectDeclaredScopes(
      documents({
        packageJson: {
          scripts: { architecture: 'depcruise --config x.json --  src' },
        },
      }),
    );

    expect(
      scopes
        .filter(
          (scope) =>
            scope.source === 'the "architecture" script in package.json',
        )
        .map((scope) => scope.declared),
    ).toEqual(['src']);
  });

  it('reads exactly the whitespace-separated targets after the -- separator', () => {
    const scopes = collectDeclaredScopes(
      documents({
        packageJson: {
          scripts: {
            architecture:
              'depcruise --config .dependency-cruiser.json --  src   scripts ',
          },
        },
      }),
    );

    expect(
      scopes
        .filter(
          (scope) =>
            scope.source === 'the "architecture" script in package.json',
        )
        .map((scope) => scope.declared),
    ).toEqual(['src', 'scripts']);
  });

  it('starts reading targets exactly four characters after the -- separator, not "-- " itself', () => {
    const scopes = collectDeclaredScopes(
      documents({
        packageJson: {
          scripts: { architecture: 'depcruise --config x.json -- src' },
        },
      }),
    );

    expect(
      scopes
        .filter(
          (scope) =>
            scope.source === 'the "architecture" script in package.json',
        )
        .map((scope) => scope.declared),
    ).toEqual(['src']);
  });

  it('returns nothing for coverage.include when vitest.config.ts has no include field at all', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { coverage: {} } };`,
      }),
    );

    expect(
      scopes.some(
        (scope) => scope.source === 'vitest.config.ts coverage.include',
      ),
    ).toBe(false);
    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('does not mistake an unrelated array for the array literal when the field text is missing', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { label: ['decoy'], test: { coverage: {} } };`,
      }),
    );

    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('does not mistake an unrelated array for the array literal when the bracket is missing', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { label: 'decoy', test: { include: ] } };`,
      }),
    );

    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('slices from immediately after the opening bracket, not one character before it', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: X'["a.ts"] } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts include')
        .map((scope) => scope.declared),
    ).toEqual(['a.ts']);
  });

  it('finds the coverage.include array by its own field name, not whatever bracket comes first', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { coverage: { thresholds: { lines: [1, 2] }, include: ['src/**/*.ts'] } } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts coverage.include')
        .map((scope) => scope.declared),
    ).toEqual(['src/**/*.ts']);
  });

  it('finds the top-level include array by its own field name, not whatever bracket comes first', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { setupFiles: ['setup.ts'], include: ['src/**/*.ts'] } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts include')
        .map((scope) => scope.declared),
    ).toEqual(['src/**/*.ts']);
  });

  it('reads only the include array that comes after the coverage: marker for coverage.include', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: ['top-level/**'], coverage: { include: ['src/**/*.ts'] } } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts coverage.include')
        .map((scope) => scope.declared),
    ).toEqual(['src/**/*.ts']);
  });

  it('finds no coverage.include when vitest.config.ts has no "coverage:" marker at all', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: ['src/**/*.ts'] } };`,
      }),
    );

    expect(
      scopes.some(
        (scope) => scope.source === 'vitest.config.ts coverage.include',
      ),
    ).toBe(false);
  });

  it('returns nothing when an include field is present but has no array literal after it', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: someHelper() } };`,
      }),
    );

    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('returns nothing when the field has a closing bracket but no opening one', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: ] } };`,
      }),
    );

    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('returns nothing when the array literal is opened but never closed', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: ['src/**/*.ts' } };`,
      }),
    );

    expect(
      scopes.some((scope) => scope.source === 'vitest.config.ts include'),
    ).toBe(false);
  });

  it('reads exactly the quoted entries inside the array, single- or double-quoted', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { include: ["src/**/*.ts", 'scripts/**/*.ts'] } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts include')
        .map((scope) => scope.declared),
    ).toEqual(['src/**/*.ts', 'scripts/**/*.ts']);
  });

  it('does not read an entry that starts outside the array brackets', () => {
    const scopes = collectDeclaredScopes(
      documents({
        vitestConfigSource: `export default { test: { outer: 'not-in-scope', include: ['src/**/*.ts'] } };`,
      }),
    );

    expect(
      scopes
        .filter((scope) => scope.source === 'vitest.config.ts include')
        .map((scope) => scope.declared),
    ).toEqual(['src/**/*.ts']);
  });

  it('returns nothing for a jscpd config with no path array', () => {
    const scopes = collectDeclaredScopes(documents({ jscpdConfig: {} }));

    expect(scopes.some((scope) => scope.source === '.jscpd.json path')).toBe(
      false,
    );
  });
});

describe('scopePatterns', () => {
  it('deduplicates a pattern declared in more than one place', () => {
    const scopes = collectDeclaredScopes(documents());
    const patterns = scopePatterns(scopes);

    expect(
      patterns.filter((pattern) => pattern === 'src/**/*.ts'),
    ).toHaveLength(1);
  });
});

describe('checkScopesResolve', () => {
  it('reports nothing when every declared scope has at least one match', () => {
    const scopes = collectDeclaredScopes(documents());
    const matchCounts = new Map(
      scopePatterns(scopes).map((pattern) => [pattern, 1]),
    );

    expect(checkScopesResolve(scopes, matchCounts)).toEqual([]);
  });

  it('names the source and declared value of a scope with zero matches', () => {
    const scopes = collectDeclaredScopes(
      documents({
        strykerConfig: {
          mutate: ['src/application/**/*.ts', '!**/*.test.ts'],
        },
      }),
    );
    const matchCounts = new Map(
      scopePatterns(scopes).map((pattern) => [
        pattern,
        pattern === 'src/application/**/*.ts' ? 0 : 1,
      ]),
    );

    const problems = checkScopesResolve(scopes, matchCounts);

    expect(problems).toEqual([
      'stryker.config.json mutate declares "src/application/**/*.ts", which matches no file in this ' +
        "repository. Point it at this project's real layout: a scope that resolves " +
        'to nothing either stops the tool outright or reports success over an empty set.',
    ]);
  });

  it('treats a pattern missing from matchCounts as zero matches', () => {
    const scopes = collectDeclaredScopes(documents());

    expect(checkScopesResolve(scopes, new Map())).toHaveLength(scopes.length);
  });
});
