/**
 * Applies the workflow policy in `scripts/lib/workflow-policy.ts` to every file
 * under `.github/workflows`, and to every composite action under
 * `.github/actions` -- a local `uses: ./...` would otherwise be a hole straight
 * through the gate.
 *
 * Run: `pnpm check:workflows`
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type PolicySource, checkWorkflows } from './lib/workflow-policy.ts';

const githubRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
);

function isYaml(name: string): boolean {
  return name.endsWith('.yml') || name.endsWith('.yaml');
}

async function readWorkflows(): Promise<readonly PolicySource[]> {
  const directory = path.join(githubRoot, 'workflows');
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && isYaml(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        path: `.github/workflows/${entry.name}`,
        source: await readFile(path.join(directory, entry.name), 'utf8'),
      })),
  );
}

/**
 * Keyed by the directory a workflow references (`.github/actions/setup`), not
 * by the manifest file, because that is what `uses:` names. Nested action
 * directories are included so a local action cannot hide another local action
 * below the first directory level.
 */
async function readActionDirectory(
  directory: string,
  relativeDirectory: string,
): Promise<readonly PolicySource[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  // GitHub gives action.yml precedence when both supported manifest names are
  // present. Do not depend on the filesystem's directory-entry order here.
  const manifest =
    entries.find((entry) => entry.isFile() && entry.name === 'action.yml') ??
    entries.find((entry) => entry.isFile() && entry.name === 'action.yaml');
  const current =
    manifest === undefined
      ? []
      : [
          {
            path: path.posix.join('.github/actions', relativeDirectory),
            source: await readFile(path.join(directory, manifest.name), 'utf8'),
          },
        ];
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) =>
        readActionDirectory(
          path.join(directory, entry.name),
          path.posix.join(relativeDirectory, entry.name),
        ),
      ),
  );
  return [...current, ...nested.flat()];
}

async function readActions(): Promise<readonly PolicySource[]> {
  return readActionDirectory(path.join(githubRoot, 'actions'), '');
}

async function main(): Promise<void> {
  const [workflows, actions] = await Promise.all([
    readWorkflows(),
    readActions(),
  ]);

  const problems = checkWorkflows(workflows, actions);
  if (problems.length > 0) {
    console.error(
      `Workflow policy check failed (${String(problems.length)}):\n`,
    );
    for (const problem of problems) {
      console.error(`  - ${problem}\n`);
    }
    process.exit(1);
  }

  console.log(
    `Workflows OK: ${String(workflows.length)} workflows and ${String(actions.length)} ` +
      `composite actions checked, all actions pinned to a commit sha.`,
  );
}

await main();
