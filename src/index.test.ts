import { describe, expect, it } from 'vitest';

import { greet } from './index.ts';

describe('greet', () => {
  it('returns a greeting for a known language', () => {
    expect(greet('en')).toStrictEqual({ language: 'en', text: 'Hello' });
  });

  it('returns undefined for an unknown language', () => {
    expect(greet('xx')).toBeUndefined();
  });
});
