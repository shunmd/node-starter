/**
 * Checks that the paths the quality tools are aimed at actually exist.
 *
 * Every scope in this repository is written as a path or a glob in a config
 * file -- `stryker.config.json`'s `mutate`, `vitest.config.ts`'s
 * `coverage.include`, `.jscpd.json`'s `path`, the directories the
 * `architecture` script passes to dependency-cruiser. None of them are checked
 * against the filesystem by the tool that reads them, and the two failure
 * modes are not equally visible:
 *
 *   - Stryker refuses to run when `mutate` resolves to nothing, so a
 *     `src/application/**\/*.ts` left behind from another repository's layout
 *     stops the mutation job outright. Loud, but only at the very end of an
 *     adoption.
 *   - jscpd, coverage `include` and dependency-cruiser simply measure the
 *     empty set. The gate reports success over nothing at all, which is the
 *     failure this repository exists to prevent.
 *
 * Both come from the same mistake: a scope that was merged from the template,
 * or written for a layout the repository does not have. Resolving each
 * declared scope once, in the fast gate, turns it into a named error before
 * either can happen.
 */

interface DeclaredScope {
  /** The config file and field the pattern came from, for the error message. */
  readonly source: string;
  /** The pattern as written in that file. */
  readonly declared: string;
  /** The pattern to resolve; a bare directory becomes a recursive glob. */
  readonly pattern: string;
}

export interface ScopeDocuments {
  readonly packageJson: unknown;
  readonly vitestConfigSource: string;
  readonly strykerConfig: unknown;
  readonly jscpdConfig: unknown;
}

const GLOB_CHARACTERS = /[*?[\]{}]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * A scope worth resolving. Exclusions (`!**\/*.test.ts`) are skipped: they
 * narrow a scope rather than defining one, and a repository with no test files
 * yet is not misconfigured.
 */
function toScope(source: string, declared: string): DeclaredScope | undefined {
  if (declared.startsWith('!') || declared.length === 0) {
    return undefined;
  }
  const pattern = GLOB_CHARACTERS.test(declared)
    ? declared
    : `${declared.replace(/\/$/, '')}/**/*`;
  return { source, declared, pattern };
}

/** Reads a `[...]` array of quoted strings that follows `field` in `source`. */
function arrayLiteralAfter(source: string, field: string): readonly string[] {
  const fieldIndex = source.indexOf(field);
  if (fieldIndex === -1) {
    return [];
  }
  const start = source.indexOf('[', fieldIndex);
  const end = source.indexOf(']', start);
  if (start === -1 || end === -1) {
    return [];
  }
  // match[0] is the whole quoted token ('src/**/*.ts'); stripping its first
  // and last character avoids a capture-group index, which TypeScript can
  // only type as possibly `undefined`.
  return [...source.slice(start + 1, end).matchAll(/['"][^'"]+['"]/g)].map(
    (match) => match[0].slice(1, -1),
  );
}

/** Reads the directories the `architecture` script passes after its `--`. */
function architectureTargets(packageJson: unknown): readonly string[] {
  if (!isRecord(packageJson) || !isRecord(packageJson['scripts'])) {
    return [];
  }
  const command = packageJson['scripts']['architecture'];
  if (typeof command !== 'string') {
    return [];
  }
  const separatorIndex = command.indexOf(' -- ');
  if (separatorIndex === -1) {
    return [];
  }
  // No length filter: a split on whitespace can yield an empty leading or
  // trailing token, but toScope already discards a zero-length declared value
  // below, so filtering it here too would only be dead weight.
  return command.slice(separatorIndex + 4).split(/\s+/);
}

export function collectDeclaredScopes(
  documents: ScopeDocuments,
): readonly DeclaredScope[] {
  const mutate = isRecord(documents.strykerConfig)
    ? stringArray(documents.strykerConfig['mutate'])
    : [];
  const jscpdPaths = isRecord(documents.jscpdConfig)
    ? stringArray(documents.jscpdConfig['path'])
    : [];
  const coverageInclude = arrayLiteralAfter(
    documents.vitestConfigSource.slice(
      documents.vitestConfigSource.indexOf('coverage:'),
    ),
    'include:',
  );
  const testInclude = arrayLiteralAfter(
    documents.vitestConfigSource,
    'include:',
  );

  return [
    ...mutate.map((entry) => toScope('stryker.config.json mutate', entry)),
    ...coverageInclude.map((entry) =>
      toScope('vitest.config.ts coverage.include', entry),
    ),
    ...testInclude.map((entry) => toScope('vitest.config.ts include', entry)),
    ...jscpdPaths.map((entry) => toScope('.jscpd.json path', entry)),
    ...architectureTargets(documents.packageJson).map((entry) =>
      toScope('the "architecture" script in package.json', entry),
    ),
  ].filter((scope): scope is DeclaredScope => scope !== undefined);
}

export function scopePatterns(
  scopes: readonly DeclaredScope[],
): readonly string[] {
  return [...new Set(scopes.map((scope) => scope.pattern))];
}

/**
 * Reports each declared scope that matched no file. `matchCounts` comes from
 * resolving `scopePatterns` against the filesystem in the calling script.
 */
export function checkScopesResolve(
  scopes: readonly DeclaredScope[],
  matchCounts: ReadonlyMap<string, number>,
): readonly string[] {
  return scopes
    .filter((scope) => (matchCounts.get(scope.pattern) ?? 0) === 0)
    .map(
      (scope) =>
        `${scope.source} declares "${scope.declared}", which matches no file in this ` +
        `repository. Point it at this project's real layout: a scope that resolves ` +
        `to nothing either stops the tool outright or reports success over an empty set.`,
    );
}
