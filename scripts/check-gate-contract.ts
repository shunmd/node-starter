/**
 * Checks that the quality gate's own configuration still matches
 * docs/code-quality-gate.md, using the decisions in scripts/lib/gate-contract.ts.
 *
 * Run: `pnpm check:gate-contract`
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkGateContract } from './lib/gate-contract.ts';

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

async function main(): Promise<void> {
  const [
    packageJson,
    vitestConfigSource,
    strykerConfig,
    eslintConfigSource,
    dependencyCruiserConfig,
    ciWorkflowSource,
    mainRulesetConfig,
  ] = await Promise.all([
    readJson('package.json'),
    readText('vitest.config.ts'),
    readJson('stryker.config.json'),
    readText('eslint.config.js'),
    readJson('.dependency-cruiser.json'),
    readText(path.join('.github', 'workflows', 'ci.yml')),
    readJson(path.join('infra', 'github', 'rulesets', 'main.json')),
  ]);

  const problems = checkGateContract({
    packageJson,
    vitestConfigSource,
    strykerConfig,
    eslintConfigSource,
    dependencyCruiserConfig,
    ciWorkflowSource,
    mainRulesetConfig,
  });

  if (problems.length > 0) {
    console.error(`Gate contract check failed (${String(problems.length)}):\n`);
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    'Gate contract OK: the quality gate configuration matches docs/code-quality-gate.md.',
  );
}

await main();
