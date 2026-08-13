/**
 * Checks `infra/template-manifest.json` against the files this repository
 * actually tracks, so the template's own inventory cannot go stale. The
 * decision logic lives in `scripts/lib/template-manifest.ts`.
 *
 * Run: `pnpm check:manifest`
 *      `node scripts/check-template-manifest.ts --list` (paths worth diffing,
 *      consumed by `scripts/diff-upstream.sh`)
 *      `node scripts/check-template-manifest.ts --list --manifest <path>`
 *      (list from a different manifest file -- `scripts/diff-upstream.sh`
 *      uses this to also list the *upstream* template's manifest, so a
 *      repository whose own manifest predates a file the template later
 *      added still gets shown that file as missing, instead of the gap
 *      being invisible because neither manifest agrees to look for it.)
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  checkManifestCoverage,
  comparablePaths,
  parseTemplateManifest,
} from './lib/template-manifest.ts';

const execFileAsync = promisify(execFile);

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const defaultManifestPath = path.join(
  repositoryRoot,
  'infra',
  'template-manifest.json',
);

function manifestPathFromArguments(): string {
  const flagIndex = process.argv.indexOf('--manifest');
  const value = flagIndex === -1 ? undefined : process.argv[flagIndex + 1];
  if (flagIndex !== -1 && value === undefined) {
    throw new Error('--manifest requires a file path.');
  }
  return value ?? defaultManifestPath;
}

async function readManifest(
  manifestPath: string,
): Promise<ReturnType<typeof parseTemplateManifest>> {
  const source = await readFile(manifestPath, 'utf8');
  return parseTemplateManifest(JSON.parse(source) as unknown);
}

async function readTrackedFiles(): Promise<readonly string[]> {
  // `--others --exclude-standard` includes files that are present but not yet
  // committed. During an adoption every file is in exactly that state, and a
  // check that could not see them would report the whole template as missing.
  const arguments_ = [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ];
  const { stdout } = await execFileAsync('git', arguments_, {
    cwd: repositoryRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

async function main(): Promise<void> {
  const manifest = await readManifest(manifestPathFromArguments());

  if (process.argv.includes('--list')) {
    console.log(comparablePaths(manifest).join('\n'));
    return;
  }

  const problems = checkManifestCoverage(manifest, await readTrackedFiles());
  if (problems.length > 0) {
    console.error(
      `Template manifest check failed (${String(problems.length)}):\n`,
    );
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `Template manifest OK: ${String(manifest.groups.length)} groups cover every ` +
      `tracked file below ${manifest.coverage.roots.length.toString()} roots.`,
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
