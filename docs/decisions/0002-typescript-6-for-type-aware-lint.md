# 2. TypeScript stays on 6.0.x so type-aware linting keeps working

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

TypeScript 7.0 shipped in July 2026 with the compiler rewritten in Go, roughly
ten times faster than 6.0. On speed alone it is the obvious choice for a new
template.

It also ships without a stable programmatic compiler API. typescript-eslint's
type-aware rules are built directly against that API, and typescript-eslint
declares its supported range as:

```
"typescript": ">=4.8.4 <6.1.0"
```

TypeScript 7 sits entirely outside it. A request to support 7.0 was closed as
not planned; the new API is expected in TypeScript 7.1.

This matters more here than it would elsewhere. The type-aware rule set —
`no-floating-promises`, `no-misused-promises`, the `no-unsafe-*` family,
`no-unnecessary-condition`, `switch-exhaustiveness-check` — is where most of
this template's strictness actually comes from. Without type information those
rules do not merely degrade; they cannot run at all. Choosing TypeScript 7 means
choosing a fast compiler and a substantially weaker linter.

## Decision

Pin `typescript` to `~6.0.3`.

The tilde, not a caret, is deliberate: `^6.0.3` would allow 6.1.0, which is
already outside typescript-eslint's declared range.

## Alternatives considered

**Adopt TypeScript 7 and drop type-aware rules.** Rejected outright. It trades
the template's central quality property for compile speed on a codebase that
starts at zero files.

**Adopt TypeScript 7 for `tsc`, keep 6.0 for ESLint** via Microsoft's
`@typescript/typescript6` compatibility package. This works, and is the
documented migration path. Rejected for a _template_: two compilers, two
versions of the type system, and a class of bug where the linter and the
compiler disagree about the same code. That is a reasonable trade for a large
codebase with a measured build-time problem, and an unreasonable one for a fresh
project with no build-time problem at all.

**Do not pin; take whatever is latest.** Rejected — installs would silently pick
up 7.x and type-aware linting would vanish without an error that explains why.

## Consequences

- Slower type-checking than 7.0 offers. On a new project this is not measurable.
- The pin must be revisited deliberately; nothing will prompt us.

## Revisit when

typescript-eslint publishes a release whose peer range admits TypeScript 7 —
expected after 7.1 ships the stable API. At that point this ADR is superseded,
not amended: check the peer range with `npm view typescript-eslint peerDependencies`
before changing the pin.
