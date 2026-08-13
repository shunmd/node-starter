/**
 * The template's file inventory as data instead of prose.
 *
 * Adoption used to depend on three hand-maintained copies of "the files the
 * template owns": one in `scripts/diff-upstream.sh`, one in
 * `docs/adoption-guide.md`, and one in the protected-path regex in
 * `.github/workflows/ci.yml`. Nothing compared them with the repository, so a
 * file added after those lists were written -- `scripts/github-settings.ts`
 * and everything below it, for instance -- was invisible to every adoption
 * that followed, and the destination repository ended up with a gate that was
 * missing pieces it never knew to ask for.
 *
 * `infra/template-manifest.json` is now the one list, and the functions here
 * decide two things about it: that every file below the declared roots is
 * accounted for, and that every accounted-for path still exists. Either
 * failure is a gate failure, so the list cannot drift away from the repository
 * again without someone being told.
 */

const OWNERSHIPS = ['adopt', 'merge', 'project'] as const;

export type Ownership = (typeof OWNERSHIPS)[number];

interface ManifestGroup {
  readonly id: string;
  readonly title: string;
  readonly ownership: Ownership;
  readonly paths: readonly string[];
}

interface ManifestCoverage {
  /** Path prefixes the completeness check applies to; `''` means top level. */
  readonly roots: readonly string[];
  /** Regular expressions for paths deliberately outside the inventory. */
  readonly ignore: readonly string[];
}

export interface TemplateManifest {
  readonly coverage: ManifestCoverage;
  readonly groups: readonly ManifestGroup[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(
      `infra/template-manifest.json: ${field} must be an array of strings.`,
    );
  }
  return value as readonly string[];
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `infra/template-manifest.json: ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function parseGroup(value: unknown, index: number): ManifestGroup {
  const field = `groups[${String(index)}]`;
  if (!isRecord(value)) {
    throw new Error(
      `infra/template-manifest.json: ${field} must be an object.`,
    );
  }
  const ownership = readString(value['ownership'], `${field}.ownership`);
  if (!OWNERSHIPS.includes(ownership as Ownership)) {
    throw new Error(
      `infra/template-manifest.json: ${field}.ownership is "${ownership}"; ` +
        `it must be one of ${OWNERSHIPS.join(', ')}.`,
    );
  }
  const paths = readStringArray(value['paths'], `${field}.paths`);
  if (paths.length === 0) {
    throw new Error(
      `infra/template-manifest.json: ${field}.paths must list at least one path.`,
    );
  }
  return {
    id: readString(value['id'], `${field}.id`),
    title: readString(value['title'], `${field}.title`),
    ownership: ownership as Ownership,
    paths,
  };
}

export function parseTemplateManifest(value: unknown): TemplateManifest {
  if (!isRecord(value)) {
    throw new Error('infra/template-manifest.json did not parse to an object.');
  }
  const coverage = value['coverage'];
  if (!isRecord(coverage)) {
    throw new Error(
      'infra/template-manifest.json: coverage must be an object with roots and ignore.',
    );
  }
  const groups = value['groups'];
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error(
      'infra/template-manifest.json: groups must be a non-empty array.',
    );
  }
  return {
    coverage: {
      roots: readStringArray(coverage['roots'], 'coverage.roots'),
      ignore: readStringArray(coverage['ignore'], 'coverage.ignore'),
    },
    groups: groups.map(parseGroup),
  };
}

/** A manifest entry ending in `/` stands for every file below it. */
function covers(entry: string, file: string): boolean {
  return entry.endsWith('/') ? file.startsWith(entry) : entry === file;
}

function isUnderRoot(file: string, root: string): boolean {
  return root === '' ? !file.includes('/') : file.startsWith(`${root}/`);
}

function isIgnored(file: string, patterns: readonly string[]): boolean {
  // Patterns come from a checked-in configuration file, not from user input.
  return patterns.some((pattern) => new RegExp(pattern).test(file));
}

export function manifestEntries(
  manifest: TemplateManifest,
  ownerships: readonly Ownership[] = [...OWNERSHIPS],
): readonly string[] {
  return manifest.groups
    .filter((group) => ownerships.includes(group.ownership))
    .flatMap((group) => group.paths);
}

/**
 * Paths worth comparing against the template. `project` entries are excluded:
 * their content is a destination decision, so a diff against the template's
 * copy would only ever be noise.
 */
export function comparablePaths(manifest: TemplateManifest): readonly string[] {
  return manifestEntries(manifest, ['adopt', 'merge']);
}

export function findDuplicateEntries(
  manifest: TemplateManifest,
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of manifestEntries(manifest)) {
    if (seen.has(entry)) {
      duplicates.add(entry);
    }
    seen.add(entry);
  }
  return [...duplicates].sort((left, right) => left.localeCompare(right));
}

/**
 * Compares the manifest with the files the repository actually tracks.
 *
 * Both directions matter. An unlisted file is a file no adoption will copy; a
 * listed path that matches nothing is a rename or deletion that left the
 * inventory pointing at a file that no longer exists, and the next adoption
 * would silently skip it.
 */
export function checkManifestCoverage(
  manifest: TemplateManifest,
  trackedFiles: readonly string[],
): readonly string[] {
  const entries = manifestEntries(manifest);
  const problems: string[] = [];

  for (const entry of entries) {
    if (!trackedFiles.some((file) => covers(entry, file))) {
      problems.push(
        `infra/template-manifest.json lists "${entry}", which matches no tracked file. ` +
          `Update the manifest when a template-owned file is renamed or removed.`,
      );
    }
  }

  for (const file of trackedFiles) {
    const inScope = manifest.coverage.roots.some((root) =>
      isUnderRoot(file, root),
    );
    if (!inScope || isIgnored(file, manifest.coverage.ignore)) {
      continue;
    }
    if (!entries.some((entry) => covers(entry, file))) {
      problems.push(
        `"${file}" is not listed in infra/template-manifest.json. Add it to the group ` +
          `that describes how a destination repository should adopt it, or to ` +
          `coverage.ignore when the template does not own it.`,
      );
    }
  }

  for (const duplicate of findDuplicateEntries(manifest)) {
    problems.push(
      `infra/template-manifest.json lists "${duplicate}" in more than one group; ` +
        `each path needs exactly one ownership.`,
    );
  }

  return problems;
}
