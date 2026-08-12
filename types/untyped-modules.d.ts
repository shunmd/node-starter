/**
 * Ambient declarations for dependencies that ship no types.
 *
 * `eslint.config.js` is type-checked (`checkJs`), which is worth it -- it
 * catches misspelled rule names and wrong option shapes at `pnpm typecheck`
 * rather than at `pnpm lint`. The cost is that an untyped plugin makes the
 * whole file fail, so each one is declared here explicitly.
 *
 * Keep this file small. A growing list is a sign of depending on unmaintained
 * packages, which is worth knowing about.
 */

declare module 'eslint-plugin-promise' {
  import type { Linter } from 'eslint';

  // Declared as named keys rather than an index signature on purpose: with
  // `noUncheckedIndexedAccess`, an index signature would make every lookup
  // `| undefined` and push the problem into eslint.config.js. Add keys here as
  // they are actually used.
  const plugin: {
    readonly configs: {
      readonly 'flat/recommended': Linter.Config;
    };
  };
  export default plugin;
}

declare module 'eslint-plugin-security' {
  import type { Linter } from 'eslint';

  const plugin: {
    readonly configs: {
      readonly recommended: Linter.Config;
    };
  };
  export default plugin;
}
