/**
 * Fails the build on a known-vulnerable or wrongly-licensed dependency.
 *
 * Neither check existed before: `pnpm install --frozen-lockfile` proves the
 * dependency graph is the one that was reviewed, and the release cooldown
 * proves it is not brand new, but nothing asked whether anything in it has a
 * published advisory or a licence this project may not accept. A human
 * reviewer reading a diff cannot answer either question, so it is a gate.
 *
 * The decision logic is in `scripts/lib/dependency-policy.ts`. This file only
 * runs pnpm, reads the policy, and turns problems into an exit status.
 *
 * Run: `pnpm check:deps`
 */

import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  evaluateLicenses,
  evaluateVulnerabilities,
  parseAuditReport,
  parseDependencyPolicy,
  parseLicenseReport,
} from './lib/dependency-policy.ts';

const execFile = promisify(execFileCallback);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * `pnpm audit` exits non-zero when it finds anything, and `pnpm licenses list`
 * exits non-zero when the store is incomplete. Both still write the JSON we
 * need on stdout, so the exit status is not the signal here -- an unparseable
 * stdout is.
 */
async function pnpmJson(args: readonly string[]): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await execFile('pnpm', [...args], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error: unknown) {
    const captured: unknown =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? error.stdout
        : undefined;
    if (typeof captured !== 'string' || captured.trim().length === 0) {
      throw new Error(
        `\`pnpm ${args.join(' ')}\` produced no JSON. This check fails closed: ` +
          `an unverifiable dependency graph is treated as unapproved.`,
        { cause: error },
      );
    }
    stdout = captured;
  }
  try {
    return JSON.parse(stdout);
  } catch (error: unknown) {
    throw new Error(`\`pnpm ${args.join(' ')}\` did not return JSON.`, {
      cause: error,
    });
  }
}

function todayInUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const policy = parseDependencyPolicy(
    JSON.parse(
      await readFile(
        path.join(repoRoot, 'infra', 'policy', 'dependency-policy.json'),
        'utf8',
      ),
    ),
  );

  const [auditReport, licenseReport] = await Promise.all([
    pnpmJson(['audit', '--json']),
    pnpmJson(['licenses', 'list', '--json']),
  ]);

  const problems = [
    ...evaluateVulnerabilities(
      parseAuditReport(auditReport),
      policy,
      todayInUtc(),
    ),
    ...evaluateLicenses(parseLicenseReport(licenseReport), policy),
  ];

  if (problems.length > 0) {
    console.error(
      `Dependency policy check failed (${String(problems.length)}):\n`,
    );
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `Dependencies OK: no unaccepted advisories, and every licence is allowed or ` +
      `explicitly excepted.`,
  );
}

await main();
