/**
 * CLI entry point for the GitHub settings tool: argv parsing and
 * orchestration only. Validation, normalization and drift-comparison logic
 * live in scripts/lib/github-settings-policy.ts (tested, mutation-scored);
 * file and network I/O live in scripts/github-settings/.
 */

import {
  applyConfiguration,
  assertApplyIsAuthorized,
} from './github-settings/apply.ts';
import { runRemoteCheck } from './github-settings/drift.ts';
import { getRepositoryReference } from './github-settings/github-api.ts';
import {
  loadConfiguration,
  readCiWorkflowSource,
  repositoryRoot,
} from './github-settings/io.ts';
import { validateCiWorkflowContract } from './lib/github-settings-ci-contract.ts';

interface CliOptions {
  readonly check: boolean;
  readonly remote: boolean;
  readonly apply: boolean;
}

function printUsage(): void {
  console.error(
    'Usage: node scripts/github-settings.ts --check [--remote] | --apply',
  );
}

function parseArguments(): CliOptions | undefined {
  const argumentsList = process.argv.slice(2);
  const check = argumentsList.includes('--check');
  const remote = argumentsList.includes('--remote');
  const apply = argumentsList.includes('--apply');
  const validArguments = (check && !apply) || (apply && !check && !remote);
  if (!validArguments) {
    printUsage();
    process.exitCode = 2;
    return undefined;
  }
  return { check, remote, apply };
}

async function validateWorkflowContract(): Promise<void> {
  const source = await readCiWorkflowSource();
  const errors = validateCiWorkflowContract(source);
  if (errors.length > 0) {
    throw new Error(`Invalid CI workflow contract:\n- ${errors.join('\n- ')}`);
  }
}

async function main(): Promise<void> {
  const options = parseArguments();
  if (options === undefined) {
    return;
  }
  const configuration = await loadConfiguration();
  await validateWorkflowContract();
  console.log(
    'GitHub infrastructure JSON and CI status-check contract are valid.',
  );
  if (!options.remote && !options.apply) {
    return;
  }

  const reference = await getRepositoryReference(repositoryRoot);
  if (options.remote) {
    await runRemoteCheck(reference, configuration);
    return;
  }

  assertApplyIsAuthorized();
  await applyConfiguration(reference, configuration);
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
