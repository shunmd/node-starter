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
 * by the manifest file, because that is what `uses:` names.
 */
async function readActions(): Promise<readonly PolicySource[]> {
  const directory = path.join(githubRoot, 'actions');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        for (const name of ['action.yml', 'action.yaml']) {
          try {
            return {
              path: `.github/actions/${entry.name}`,
              source: await readFile(
                path.join(directory, entry.name, name),
                'utf8',
              ),
            };
          } catch {
            continue;
          }
        }
        return undefined;
      }),
  );
  return manifests.filter((manifest) => manifest !== undefined);
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
