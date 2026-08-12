/**
 * Placeholder entry point.
 *
 * This file exists so a freshly cloned template has something for `pnpm check`
 * to lint, type-check and test. Replace it with your actual code -- see the
 * customization checklist in README.md.
 */

export interface Greeting {
  readonly language: string;
  readonly text: string;
}

const greetings: Readonly<Record<string, string>> = {
  en: 'Hello',
  ja: 'こんにちは',
};

/**
 * Returns a greeting for the given language, or `undefined` if the language is
 * unknown.
 *
 * The `undefined` in the return type is not decoration: `noUncheckedIndexedAccess`
 * makes the index lookup below `string | undefined`, so callers are forced to
 * handle a miss.
 */
export function greet(language: string): Greeting | undefined {
  const text = greetings[language];
  if (text === undefined) {
    return undefined;
  }
  return { language, text };
}
