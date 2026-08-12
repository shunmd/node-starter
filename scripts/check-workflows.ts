/**
 * Applies the workflow policy in `scripts/lib/workflow-policy.ts` to every
 * file under `.github/workflows`.
 *
 * Run: `pnpm check:workflows`
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkWorkflows } from './lib/workflow-policy.ts';

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.github',
  'workflows',
);

async function main(): Promise<void> {
  const entries = await readdir(workflowRoot, { withFileTypes: true });
  const workflows = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        path: `.github/workflows/${entry.name}`,
        source: await readFile(path.join(workflowRoot, entry.name), 'utf8'),
      })),
  );

  const problems = checkWorkflows(workflows);
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
    `Workflows OK: ${String(workflows.length)} checked, all actions pinned to a commit sha.`,
  );
}

await main();
