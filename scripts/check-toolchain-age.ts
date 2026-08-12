/**
 * Enforces the toolchain half of the release-cooldown policy.
 *
 * A pinned Node or pnpm version must already have been public for the number
 * of days in `scripts/lib/toolchain-policy.ts`, and the pins must agree across
 * every file that declares them. Because `pnpm check` runs this both locally
 * and in CI, a pull request that bumps either pin too eagerly cannot go green.
 *
 * The rules are in `scripts/lib/toolchain-policy.ts`. This file fetches the
 * two release feeds and turns problems into an exit status.
 *
 * Run: `pnpm check:toolchain`
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COOLDOWN_DAYS,
  ageInDays,
  checkAge,
  checkCooldownPolicy,
  checkPinsAgree,
  readDeclaredPins,
  readMisePins,
  readNodeReleaseDate,
  readNpmPublishTime,
} from './lib/toolchain-policy.ts';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

async function main(): Promise<void> {
  const mise = readMisePins(read('mise.toml'));
  const problems = [
    ...checkPinsAgree(mise, readDeclaredPins(JSON.parse(read('package.json')))),
    ...checkCooldownPolicy(read('pnpm-workspace.yaml')),
  ];

  const [packument, distIndex] = await Promise.all([
    fetchJson('https://registry.npmjs.org/pnpm', 'the npm registry'),
    fetchJson('https://nodejs.org/dist/index.json', 'nodejs.org'),
  ]);
  const pnpmPublished = readNpmPublishTime(packument, 'pnpm', mise.pnpm);
  const nodePublished = readNodeReleaseDate(distIndex, mise.node);

  const now = new Date();
  problems.push(
    ...checkAge('pnpm', mise.pnpm, pnpmPublished, now),
    ...checkAge('node', mise.node, nodePublished, now),
  );

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
    `Toolchain OK: node ${mise.node} (${ageInDays(nodePublished, now).toFixed(0)}d), ` +
      `pnpm ${mise.pnpm} (${ageInDays(pnpmPublished, now).toFixed(0)}d), ` +
      `dependency cooldown ${String(COOLDOWN_DAYS)}d and strict.`,
  );
}

await main();
