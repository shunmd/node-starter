import { describe, expect, it, vi } from 'vitest';

import { getStringEnvironmentVariable } from './env.ts';

describe('getStringEnvironmentVariable', () => {
  it('returns the value of a set variable', () => {
    vi.stubEnv('NODE_STARTER_FIXTURE', 'value');
    expect(getStringEnvironmentVariable('NODE_STARTER_FIXTURE')).toBe('value');
  });

  it('treats an empty variable as unset, because CI sets empty strings', () => {
    vi.stubEnv('NODE_STARTER_FIXTURE', '');
    expect(
      getStringEnvironmentVariable('NODE_STARTER_FIXTURE'),
    ).toBeUndefined();
  });

  it('returns undefined for a variable that was never set', () => {
    expect(getStringEnvironmentVariable('NODE_STARTER_ABSENT')).toBeUndefined();
  });
});
