/**
 * Formatting is not a decision this repository wants to keep making, so this
 * config is deliberately tiny. Anything not listed here is Prettier's default,
 * on purpose: defaults need no justification, no documentation and no
 * migration when Prettier changes its mind.
 *
 * @type {import("prettier").Config}
 */
export default {
  // Fewer escaped quotes in the strings this codebase actually writes.
  singleQuote: true,
};
