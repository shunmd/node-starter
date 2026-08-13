/**
 * The GitHub REST API client: authentication, pagination and the repository
 * reference GitHub calls -- but not what to do with the responses. Drift
 * comparison lives in ./drift.ts, applying changes in ./apply.ts.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { parseRepositoryReference } from '../lib/github-settings-normalize.ts';
import {
  isRecord,
  isString,
  isUnknownArray,
} from '../lib/github-settings-schema.ts';
import type { RepositoryReference } from '../lib/github-settings-types.ts';
import { getStringEnvironmentVariable } from './env.ts';

const execFile = promisify(execFileCallback);

const apiVersion = '2022-11-28';
export const apiPageSize = 100;

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export async function getRepositoryReference(
  repositoryRoot: string,
): Promise<RepositoryReference> {
  const configured = getStringEnvironmentVariable('GITHUB_REPOSITORY');
  if (configured !== undefined) {
    const [owner, name] = configured.split('/');
    if (
      owner !== undefined &&
      name !== undefined &&
      owner.length > 0 &&
      name.length > 0
    ) {
      return { owner, name };
    }
    throw new Error(
      `GITHUB_REPOSITORY must use OWNER/REPOSITORY format: ${configured}`,
    );
  }

  let origin: string;
  try {
    const result = await execFile(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    origin = result.stdout;
  } catch (error: unknown) {
    throw new Error('Unable to read the origin remote from git', {
      cause: error,
    });
  }
  const reference = parseRepositoryReference(origin);
  if (reference === undefined) {
    throw new Error(
      'Unable to determine the GitHub repository from GITHUB_REPOSITORY or origin',
    );
  }
  return reference;
}

function getToken(): string {
  const token =
    getStringEnvironmentVariable('GH_TOKEN') ??
    getStringEnvironmentVariable('GITHUB_TOKEN');
  if (token === undefined) {
    throw new Error('Remote operations require GH_TOKEN or GITHUB_TOKEN');
  }
  return token;
}

function apiUrl(reference: RepositoryReference, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.name)}${path}`;
}

export async function request(
  reference: RepositoryReference,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<ApiResponse> {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${getToken()}`,
    'X-GitHub-Api-Version': apiVersion,
  });
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const requestInit: RequestInit = { method, headers };
  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }
  const response = await fetch(apiUrl(reference, path), requestInit);
  const responseBody: unknown = await response.json();
  return { status: response.status, body: responseBody };
}

export function requireApiSuccess(
  response: ApiResponse,
  operation: string,
): unknown {
  if (response.status < 200 || response.status >= 300) {
    const detail =
      isRecord(response.body) && isString(response.body['message'])
        ? response.body['message']
        : JSON.stringify(response.body);
    throw new Error(
      `${operation} failed with HTTP ${String(response.status)}: ${detail}`,
    );
  }
  return response.body;
}

export async function requestPagedArray(
  reference: RepositoryReference,
  path: string,
  operation: string,
): Promise<readonly unknown[]> {
  const values: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const response = requireApiSuccess(
      await request(reference, `${path}${separator}page=${String(page)}`),
      operation,
    );
    if (!isUnknownArray(response)) {
      throw new Error(`${operation} returned an invalid response`);
    }
    values.push(...response);
    if (response.length < apiPageSize) {
      return values;
    }
  }
}
