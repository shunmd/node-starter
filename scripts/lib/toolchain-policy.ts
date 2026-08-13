/**
 * The release-cooldown policy, as decisions rather than as I/O.
 *
 * pnpm's `minimumReleaseAge` governs packages pnpm resolves. It has no opinion
 * about pnpm itself or about Node.js, because neither is installed as a
 * dependency -- mise installs them before any package.json is read. This
 * module holds the rules that close that gap: a pinned toolchain version must
 * already have been public for COOLDOWN_DAYS, the pins must agree across every
 * file that declares them, and the pnpm settings the policy depends on must
 * still be the ones it was written against.
 *
 * Fetching publish dates lives in `scripts/check-toolchain-age.ts`.
 */

import { parse } from 'yaml';

export const COOLDOWN_DAYS = 5;
export const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** Must equal `minimumReleaseAge` in pnpm-workspace.yaml, in minutes. */
const EXPECTED_MINIMUM_RELEASE_AGE_MINUTES = COOLDOWN_DAYS * 24 * 60;

export interface ToolchainPins {
  readonly node: string;
  readonly pnpm: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ageInDays(published: Date, now: Date): number {
  return (now.getTime() - published.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Returns the body of a top-level TOML table, so a key lookup cannot match an
 * identically named key in a different section. mise.toml has `node` under
 * `[tools]`; a TOML parser is not worth a dependency for two string reads, but
 * reading them out of the wrong table would be.
 */
export function tomlSection(source: string, section: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start === -1) {
    return '';
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim().startsWith('['));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Reads `key = "value"` from a TOML table body, ignoring commented-out lines. */
export function tomlString(source: string, key: string): string | undefined {
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    // Stryker disable next-line ConditionalExpression,MethodExpression,BlockStatement:
    // a line starting with `#` can never also start with `key`, so skipping
    // it here can never change whether the regex below matches.
    if (trimmed.startsWith('#')) {
      continue;
    }
    const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`).exec(trimmed);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

export function readMisePins(miseToml: string): ToolchainPins {
  const tools = tomlSection(miseToml, 'tools');
  const node = tomlString(tools, 'node');
  const pnpm = tomlString(tools, 'pnpm');
  if (node === undefined || pnpm === undefined) {
    throw new Error(
      'mise.toml must pin both node and pnpm to exact versions under [tools].',
    );
  }
  return { node, pnpm };
}

export function readDeclaredPins(packageJson: unknown): ToolchainPins {
  if (!isRecord(packageJson)) {
    throw new Error('package.json did not parse to an object.');
  }
  const devEngines = packageJson['devEngines'];
  if (!isRecord(devEngines)) {
    throw new Error('package.json has no devEngines block.');
  }
  const runtime = devEngines['runtime'];
  const packageManager = devEngines['packageManager'];
  if (!isRecord(runtime) || !isRecord(packageManager)) {
    throw new Error('devEngines must declare both runtime and packageManager.');
  }
  const node = runtime['version'];
  const pnpm = packageManager['version'];
  if (typeof node !== 'string' || typeof pnpm !== 'string') {
    throw new Error(
      'devEngines.runtime.version and devEngines.packageManager.version must be strings.',
    );
  }
  return { node, pnpm };
}

export function checkPinsAgree(
  mise: ToolchainPins,
  declared: ToolchainPins,
): readonly string[] {
  const problems: string[] = [];
  if (mise.node !== declared.node) {
    problems.push(
      `Node pin mismatch: mise.toml says ${mise.node}, package.json devEngines.runtime says ${declared.node}.`,
    );
  }
  if (mise.pnpm !== declared.pnpm) {
    problems.push(
      `pnpm pin mismatch: mise.toml says ${mise.pnpm}, package.json devEngines.packageManager says ${declared.pnpm}.`,
    );
  }
  return problems;
}

/**
 * The pnpm settings the cooldown depends on. Each of these has a default that
 * turns the policy into a logging feature, so the check is that the file still
 * says what this script was written against -- not merely that the key exists.
 */
export function checkCooldownPolicy(workspaceYaml: string): readonly string[] {
  const parsed: unknown = parse(workspaceYaml) as unknown;
  if (!isRecord(parsed)) {
    return ['pnpm-workspace.yaml did not parse to a mapping.'];
  }
  const problems: string[] = [];
  if (parsed['minimumReleaseAge'] !== EXPECTED_MINIMUM_RELEASE_AGE_MINUTES) {
    problems.push(
      `pnpm-workspace.yaml sets minimumReleaseAge to ${String(parsed['minimumReleaseAge'])}; ` +
        `expected ${String(EXPECTED_MINIMUM_RELEASE_AGE_MINUTES)} (${String(COOLDOWN_DAYS)} days) ` +
        `to match the toolchain cooldown enforced by this script.`,
    );
  }
  if (parsed['minimumReleaseAgeStrict'] !== true) {
    problems.push(
      'pnpm-workspace.yaml must set minimumReleaseAgeStrict: true. Without it pnpm ' +
        'auto-approves immature versions into minimumReleaseAgeExclude instead of refusing them.',
    );
  }
  if (parsed['minimumReleaseAgeIgnoreMissingTime'] !== false) {
    problems.push(
      'pnpm-workspace.yaml must set minimumReleaseAgeIgnoreMissingTime: false, so a package ' +
        'without a registry publish time is refused rather than treated as mature.',
    );
  }
  if (parsed['trustPolicy'] !== 'no-downgrade') {
    problems.push(
      'pnpm-workspace.yaml must set trustPolicy: no-downgrade, so a package whose registry ' +
        'trust signals got weaker than the lockfile recorded is refused.',
    );
  }
  const allowBuilds = parsed['allowBuilds'];
  if (allowBuilds !== null && !isRecord(allowBuilds)) {
    problems.push(
      'pnpm-workspace.yaml must declare allowBuilds, which lists the dependencies permitted ' +
        'to run install-time lifecycle scripts. An empty map means none may run.',
    );
  }
  return problems;
}

export function checkAge(
  tool: string,
  version: string,
  published: Date,
  now: Date,
): readonly string[] {
  if (now.getTime() - published.getTime() >= COOLDOWN_MS) {
    return [];
  }
  return [
    `${tool}@${version} was published ${ageInDays(published, now).toFixed(1)} days ago; ` +
      `the cooldown is ${String(COOLDOWN_DAYS)} days. ` +
      `Pin an older release, or wait until ${new Date(published.getTime() + COOLDOWN_MS).toISOString()}.`,
  ];
}

/** Publish time of a version, from an npm registry packument's `time` map. */
export function readNpmPublishTime(
  packument: unknown,
  pkg: string,
  version: string,
): Date {
  if (!isRecord(packument) || !isRecord(packument['time'])) {
    throw new Error(`The npm packument for ${pkg} has no usable "time" field.`);
  }
  const published = packument['time'][version];
  if (typeof published !== 'string') {
    throw new Error(
      `The npm registry does not list a publish time for ${pkg}@${version}.`,
    );
  }
  return new Date(published);
}

/** Release date of a Node.js version, from the official dist index. */
export function readNodeReleaseDate(index: unknown, version: string): Date {
  if (!Array.isArray(index)) {
    throw new Error('nodejs.org/dist/index.json did not return an array.');
  }
  for (const entry of index) {
    if (
      isRecord(entry) &&
      entry['version'] === `v${version}` &&
      typeof entry['date'] === 'string'
    ) {
      // The dist index carries a date, not a timestamp. Use the end of the
      // recorded day so the missing publication time cannot shorten the
      // cooldown window.
      return new Date(`${entry['date']}T23:59:59.999Z`);
    }
  }
  throw new Error(`nodejs.org does not list a release for Node ${version}.`);
}
