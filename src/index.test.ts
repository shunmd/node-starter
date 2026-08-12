import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { greet } from './index.ts';

describe('greet', () => {
  it('returns a greeting for a known language', () => {
    expect(greet('en')).toStrictEqual({ language: 'en', text: 'Hello' });
  });

  it('returns the Japanese greeting for Japanese input', () => {
    expect(greet('ja')).toStrictEqual({ language: 'ja', text: 'こんにちは' });
  });

  it('returns undefined for an unknown language', () => {
    expect(greet('xx')).toBeUndefined();
  });

  it('echoes the requested language back when known', () => {
    fc.assert(
      fc.property(fc.constantFrom('en', 'ja'), (language) => {
        expect(greet(language)?.language).toBe(language);
      }),
    );
  });

  it('never throws and only returns undefined or a matching greeting', () => {
    fc.assert(
      fc.property(fc.string(), (language) => {
        const result = greet(language);
        expect(result === undefined || result.language === language).toBe(true);
      }),
    );
  });
});
