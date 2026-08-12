import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import n from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint rules are the enforcement layer of this repository's coding standards.
 * A rule that lives here does not need to be repeated in AGENTS.md or README:
 * `pnpm lint` is what actually decides.
 *
 * Two conventions apply throughout:
 *
 *  1. There are no warnings. Every rule is `error` or `off`. A warning is a
 *     rule nobody has to obey, and it makes "CI is green" mean less than
 *     "the code meets the standard".
 *
 *  2. A rule that is autofixable is close to free, so autofixable strictness
 *     is preferred over strictness that only produces work.
 *
 * Deviations from a preset are grouped at the bottom with the reason inline.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.mise/**'],
  },

  // --- Base ----------------------------------------------------------------
  js.configs.recommended,

  // strictTypeChecked is the strongest typescript-eslint preset: it needs type
  // information and enables the no-unsafe-* family, no-floating-promises,
  // no-misused-promises, no-unnecessary-condition and friends. This is where
  // most of "as strict as practical" actually comes from.
  tseslint.configs.strictTypeChecked,
  // stylisticTypeChecked is about consistent expression of the same semantics
  // (prefer-nullish-coalescing, consistent-type-definitions, ...). It does not
  // touch layout, so it does not collide with Prettier.
  tseslint.configs.stylisticTypeChecked,

  n.configs['flat/recommended-module'],
  promise.configs['flat/recommended'],
  comments.recommended,

  {
    languageOptions: {
      globals: globals.nodeBuiltin,
      parserOptions: {
        // projectService lets type-aware rules work without hand-maintaining a
        // list of tsconfig paths.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      // An `eslint-disable` that no longer suppresses anything is stale
      // suppression. Deleting it is mechanical, so make it an error.
      reportUnusedDisableDirectives: 'error',
    },
  },

  // --- Deliberate deviations ------------------------------------------------
  {
    rules: {
      // Every suppression must say why. This is the counterweight to a strict
      // rule set: silencing a rule stays possible, but it leaves a reviewable
      // sentence behind instead of a bare pragma.
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: [] },
      ],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',

      // `_`-prefixed bindings are the agreed way to say "intentionally unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Type-only imports are erased; mixing them with value imports hides
      // that. Autofixable, and required by verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],

      // `as` stays legal (it is genuinely needed at I/O boundaries), but
      // `{...} as SomeType` is banned: it silently permits missing and excess
      // properties, which is exactly the mistake it looks like it prevents.
      // Use a type annotation instead.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'never',
        },
      ],

      // A switch over a union must handle every member. Non-union switches
      // still need a default, so adding a case elsewhere cannot silently fall
      // through to nothing.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          allowDefaultCaseForExhaustiveSwitch: false,
          considerDefaultExhaustiveForUnions: true,
          requireDefaultForNonUnion: true,
        },
      ],

      // Immutability by default at API boundaries; autofixable.
      '@typescript-eslint/prefer-readonly': 'error',

      // A single guard against genuinely unreadable functions. The threshold is
      // set high on purpose: it should fire on a 300-line branch monster, not
      // on ordinary code. A low threshold trains people (and agents) to split
      // functions for the linter rather than for the reader.
      complexity: ['error', 20],

      // Names of types are structural information, so they are worth
      // constraining. Broader naming-convention configs mostly generate churn.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        },
      ],

      // eslint-plugin-n cannot see devDependencies used by config files the way
      // this repo lays them out, and TypeScript already resolves imports.
      'n/no-missing-import': 'off',
      // Redundant with @typescript-eslint/no-floating-promises, which is
      // type-aware and therefore more accurate.
      'promise/catch-or-return': 'off',
    },
  },

  // --- Tests ----------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // Tests deliberately construct wrong values to prove they are rejected.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // --- Operational scripts --------------------------------------------------
  {
    files: ['scripts/**'],
    rules: {
      // These are command-line tools, not library code. Their exit status is
      // their interface, and printing to stderr is how they report.
      'n/no-process-exit': 'off',
      'no-console': 'off',
    },
  },

  // --- Plain JS (config files) ----------------------------------------------
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: turns off everything Prettier already decides, so layout
  // has exactly one owner.
  prettierConfig,
);
