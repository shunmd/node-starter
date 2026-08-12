/**
 * Enforces the toolchain half of the release-cooldown policy.
 *
 * pnpm's `minimumReleaseAge` setting governs packages pnpm *resolves*. It has
 * no opinion about pnpm itself or about Node.js, because neither is installed
 * as a dependency -- they are installed by mise before any package.json is
 * read. Nothing in mise, pnpm or Node enforces a cooldown on the toolchain.
 *
 * So the cooldown for the toolchain is enforced here instead, as a rule about
 * what may be committed: a pinned Node or pnpm version must already have been
 * public for COOLDOWN_DAYS. Because `pnpm check` runs this both locally and in
 * CI, a pull request that bumps either pin too eagerly cannot go green.
 *
 * It also asserts that the pins agree across the files that declare them,
 * which is the failure this repository is otherwise most likely to develop.
 *
 * Run: `pnpm check:toolchain`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const COOLDOWN_DAYS = 5;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** Must equal `minimumReleaseAge` in pnpm-workspace.yaml, in minutes. */
const EXPECTED_MINIMUM_RELEASE_AGE_MINUTES = COOLDOWN_DAYS * 24 * 60;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const problems: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads `key = "value"` from a flat TOML section without a TOML parser. */
function tomlString(source: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm').exec(source);
  return match?.[1];
}

function yamlNumber(source: string, key: string): number | undefined {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(\\d+)\\s*$`, 'm').exec(source);
  const raw = match?.[1];
  return raw === undefined ? undefined : Number(raw);
}

function yamlScalar(source: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*([^\\s#]+)`, 'm').exec(source);
  return match?.[1];
}

function ageInDays(published: Date): number {
  return (Date.now() - published.getTime()) / (24 * 60 * 60 * 1000);
}

function checkAge(tool: string, version: string, published: Date): void {
  const age = Date.now() - published.getTime();
  if (age < COOLDOWN_MS) {
    fail(
      `${tool}@${version} was published ${ageInDays(published).toFixed(1)} days ago; ` +
        `the cooldown is ${String(COOLDOWN_DAYS)} days. ` +
        `Pin an older release, or wait until ${new Date(published.getTime() + COOLDOWN_MS).toISOString()}.`,
    );
  }
}

async function fetchJson(url: string, description: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Could not reach ${description} (${url}) to verify release dates. ` +
        `This check fails closed: an unverifiable toolchain pin is treated as unapproved.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `${description} returned HTTP ${String(response.status)} for ${url}.`,
    );
  }
  return await response.json();
}

/** Publish time of a version, from the npm registry packument `time` map. */
async function npmPublishTime(pkg: string, version: string): Promise<Date> {
  const packument = await fetchJson(
    `https://registry.npmjs.org/${pkg}`,
    'the npm registry',
  );
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
async function nodeReleaseDate(version: string): Promise<Date> {
  const index = await fetchJson(
    'https://nodejs.org/dist/index.json',
    'nodejs.org',
  );
  if (!Array.isArray(index)) {
    throw new Error('nodejs.org/dist/index.json did not return an array.');
  }
  for (const entry of index) {
    if (
      isRecord(entry) &&
      entry['version'] === `v${version}` &&
      typeof entry['date'] === 'string'
    ) {
      // The dist index carries a date, not a timestamp; treat it as midnight
      // UTC, which is the conservative (earliest) reading.
      return new Date(`${entry['date']}T00:00:00Z`);
    }
  }
  throw new Error(`nodejs.org does not list a release for Node ${version}.`);
}

async function main(): Promise<void> {
  const miseToml = read('mise.toml');
  const workspaceYaml = read('pnpm-workspace.yaml');

  const packageJsonRaw: unknown = JSON.parse(read('package.json'));
  if (!isRecord(packageJsonRaw)) {
    throw new Error('package.json did not parse to an object.');
  }
  const devEngines = packageJsonRaw['devEngines'];
  if (!isRecord(devEngines)) {
    throw new Error('package.json has no devEngines block.');
  }
  const runtime = devEngines['runtime'];
  const packageManager = devEngines['packageManager'];
  if (!isRecord(runtime) || !isRecord(packageManager)) {
    throw new Error('devEngines must declare both runtime and packageManager.');
  }

  const miseNode = tomlString(miseToml, 'node');
  const misePnpm = tomlString(miseToml, 'pnpm');
  const declaredNode = runtime['version'];
  const declaredPnpm = packageManager['version'];

  if (typeof miseNode !== 'string' || typeof misePnpm !== 'string') {
    throw new Error('mise.toml must pin both node and pnpm to exact versions.');
  }
  if (typeof declaredNode !== 'string' || typeof declaredPnpm !== 'string') {
    throw new Error(
      'devEngines.runtime.version and devEngines.packageManager.version must be strings.',
    );
  }

  // --- The pins must agree -------------------------------------------------
  if (miseNode !== declaredNode) {
    fail(
      `Node pin mismatch: mise.toml says ${miseNode}, package.json devEngines.runtime says ${declaredNode}.`,
    );
  }
  if (misePnpm !== declaredPnpm) {
    fail(
      `pnpm pin mismatch: mise.toml says ${misePnpm}, package.json devEngines.packageManager says ${declaredPnpm}.`,
    );
  }

  // --- The dependency cooldown must match the toolchain cooldown -----------
  const minimumReleaseAge = yamlNumber(workspaceYaml, 'minimumReleaseAge');
  if (minimumReleaseAge !== EXPECTED_MINIMUM_RELEASE_AGE_MINUTES) {
    fail(
      `pnpm-workspace.yaml sets minimumReleaseAge to ${String(minimumReleaseAge)}; ` +
        `expected ${String(EXPECTED_MINIMUM_RELEASE_AGE_MINUTES)} (${String(COOLDOWN_DAYS)} days) ` +
        `to match the toolchain cooldown enforced by this script.`,
    );
  }
  if (yamlScalar(workspaceYaml, 'minimumReleaseAgeStrict') !== 'true') {
    fail(
      'pnpm-workspace.yaml must set minimumReleaseAgeStrict: true. Without it pnpm ' +
        'auto-approves immature versions into minimumReleaseAgeExclude instead of refusing them.',
    );
  }
  if (
    yamlScalar(workspaceYaml, 'minimumReleaseAgeIgnoreMissingTime') !== 'false'
  ) {
    fail(
      'pnpm-workspace.yaml must set minimumReleaseAgeIgnoreMissingTime: false, so a package ' +
        'without a registry publish time is refused rather than treated as mature.',
    );
  }

  // --- The pinned versions must have cooled down ---------------------------
  const [pnpmPublished, nodePublished] = await Promise.all([
    npmPublishTime('pnpm', misePnpm),
    nodeReleaseDate(miseNode),
  ]);
  checkAge('pnpm', misePnpm, pnpmPublished);
  checkAge('node', miseNode, nodePublished);

  if (problems.length > 0) {
    console.error(
      `Toolchain policy check failed (${String(problems.length)}):\n`,
    );
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `Toolchain OK: node ${miseNode} (${ageInDays(nodePublished).toFixed(0)}d), ` +
      `pnpm ${misePnpm} (${ageInDays(pnpmPublished).toFixed(0)}d), ` +
      `dependency cooldown ${String(COOLDOWN_DAYS)}d and strict.`,
  );
}

await main();
