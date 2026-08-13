/**
 * File I/O for infra/github/: reading the desired-state JSON and the CI
 * workflow it must be consistent with. Structural validation lives in
 * ../lib/github-settings-policy.ts.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateConfigurationValues } from '../lib/github-settings-approval-policy.ts';
import type {
  DesiredConfiguration,
  JsonDocument,
} from '../lib/github-settings-types.ts';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const githubRoot = join(repositoryRoot, 'infra', 'github');

function readJsonFile(path: string): Promise<unknown> {
  return readFile(path, 'utf8').then(
    (content) => JSON.parse(content) as unknown,
  );
}

async function readJsonDocuments(
  directory: string,
  displayDirectory: string,
): Promise<readonly JsonDocument[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));
  return Promise.all(
    jsonFiles.map(async (entry) => ({
      path: join(displayDirectory, entry.name),
      value: await readJsonFile(join(directory, entry.name)),
    })),
  );
}

async function readConfigurationFiles(): Promise<
  readonly [unknown, readonly JsonDocument[], readonly JsonDocument[], unknown]
> {
  try {
    const [repository, rulesets, environments, secrets] = await Promise.all([
      readJsonFile(join(githubRoot, 'repository-settings.json')),
      readJsonDocuments(join(githubRoot, 'rulesets'), 'rulesets'),
      readJsonDocuments(join(githubRoot, 'environments'), 'environments'),
      readJsonFile(join(githubRoot, 'secrets-manifest.json')),
    ] as const);
    return [repository, rulesets, environments, secrets];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read GitHub infrastructure JSON: ${message}`, {
      cause: error,
    });
  }
}

export async function loadConfiguration(): Promise<DesiredConfiguration> {
  const [repositoryValue, rulesetDocuments, environmentDocuments, secretValue] =
    await readConfigurationFiles();
  return validateConfigurationValues(
    repositoryValue,
    rulesetDocuments,
    environmentDocuments,
    secretValue,
  );
}

export function readCiWorkflowSource(): Promise<string> {
  return readFile(
    join(repositoryRoot, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
}
