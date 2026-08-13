/**
 * Resolves every path or glob a quality tool is scoped to -- Stryker's
 * `mutate`, Vitest's `include` and `coverage.include`, jscpd's `path`, the
 * directories `pnpm architecture` scans -- against the files this repository
 * actually has, using the decisions in `scripts/lib/scope-contract.ts`.
 *
 * This is the check that would have caught a `stryker.config.json` merged
 * from another repository's layout: `mutate: ["src/application/**\/*.ts"]`
 * left in place after an adoption whose source lives at `src/**\/*.ts`.
 * Stryker itself refuses to run on that, but only after the rest of the gate
 * has already passed; jscpd and coverage `include` do not refuse at all, they
 * report success over an empty set. Resolving each scope here, in the fast
 * gate, turns both into one named error before the mutation job or a false
 * "clean" report.
 *
 * Run: `pnpm check:scope`
 */

import { glob } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ScopeDocuments,
  checkScopesResolve,
  collectDeclaredScopes,
  scopePatterns,
} from './lib/scope-contract.ts';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function readText(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readText(relativePath)) as unknown;
}

async function countMatches(pattern: string): Promise<number> {
  let count = 0;
  // node:fs/promises glob resolves against process.cwd(); this script is run
  // from the repository root by its package.json script, matching every
  // other path in this file.
  for await (const _match of glob(pattern, { cwd: repositoryRoot })) {
    count += 1;
    if (count >= 1) {
      break;
    }
  }
  return count;
}

async function main(): Promise<void> {
  const [packageJson, vitestConfigSource, strykerConfig, jscpdConfig] =
    await Promise.all([
      readJson('package.json'),
      readText('vitest.config.ts'),
      readJson('stryker.config.json'),
      readJson('.jscpd.json'),
    ]);

  const documents: ScopeDocuments = {
    packageJson,
    vitestConfigSource,
    strykerConfig,
    jscpdConfig,
  };
  const scopes = collectDeclaredScopes(documents);
  const patterns = scopePatterns(scopes);
  const matchCounts = new Map<string, number>(
    await Promise.all(
      patterns.map(
        async (pattern) => [pattern, await countMatches(pattern)] as const,
      ),
    ),
  );

  const problems = checkScopesResolve(scopes, matchCounts);
  if (problems.length > 0) {
    console.error(
      `Scope contract check failed (${String(problems.length)}):\n`,
    );
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `Scope contract OK: ${String(patterns.length)} declared scopes each match at least one file.`,
  );
}

await main();
