---
name: adopt-nextjs-quality-gate
description: Apply this repository's quality gate (pnpm verify plus the mutation job) to a Next.js project, or add Next.js to a project that already runs the gate. Use when a destination uses the Next.js App Router or Pages Router and the checks that assume a plain Node library -- Knip entry points, dependency-cruiser no-orphans, vitest environment, jscpd and Stryker scopes, tsconfig without JSX -- have to be reconciled with it. Not for adding Next.js to the node-starter template itself, which is deliberately framework-free.
---

# Adopting the quality gate into a Next.js project

`docs/adoption-guide.md` owns the general migration and its completion
checklist. Follow it first; this skill covers only what Next.js specifically
breaks, and each step is a decision to make rather than a patch to paste.

The template's checks assume a plain Node library: one explicit entry point,
no DOM, no JSX, no build. Next.js violates all four. Do not resolve that by
loosening a check — every step below declares the framework's conventions to
the tool that cannot see them.

## Step 0 — settle the two facts everything else depends on

Answer these before editing any config, because every later step branches on
them:

1. **Which router?** App Router (`app/`), Pages Router (`pages/`), or both
   during a migration. This decides the entry patterns in Knip and
   dependency-cruiser.
2. **Are components tested in this repo?** If E2E covers the UI and unit tests
   cover only server code, the Vitest environment stays `node` and Steps 5 and
   6 shrink to nothing. Decide it deliberately; do not discover it later.

Record both answers in the ADR from Step 9.

## Step 1 — tsconfig

Next.js rewrites `tsconfig.json` on first run. Let it, then reconcile: it turns
off settings the template sets on purpose.

Next.js needs `jsx: "preserve"`, `moduleResolution: "bundler"`, `lib` including
`"dom"` and `"dom.iterable"`, `plugins: [{ "name": "next" }]`, `allowJs`,
`incremental`, and `noEmit` (already set).

Check what it changed, and restore anything from the template's strictness
block it dropped — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`. Two need a real decision rather than a restore:

- `verbatimModuleSyntax` is compatible, but `"use client"` files are stricter
  about type-only imports; expect a first pass of `import type` fixes.
- `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` exist so
  the template runs `.ts` files under Node with no build step. Next.js has its
  own bundler and does not want them. Drop both unless `scripts/` still runs
  directly under Node — which it does if the enforcement scripts came across.
  In that case keep them and give the app its own `tsconfig.app.json`.

Add the framework's source directories to `include`.

## Step 2 — ESLint

The template's config has no React, JSX or Next.js rules, and
`globals.nodeBuiltin` gives no `window` or `document`. Add, scoped to the app's
files rather than repository-wide:

- `eslint-plugin-react` and `eslint-plugin-react-hooks` — the hooks rules are
  the ones that catch real defects.
- `@next/eslint-plugin-next` — its `no-html-link-for-pages` and
  `no-sync-scripts` rules encode framework constraints nothing else checks.
- `eslint-plugin-jsx-a11y` — optional, and a genuine judgment call: it produces
  a large first-pass backlog. If accessibility is not being reviewed anywhere
  else, take the backlog.
- `globals.browser` in `languageOptions.globals` for client files only. Server
  Components and route handlers must keep failing on `window`, which is the
  point.

Every dependency here goes through the five-day release cooldown in
`pnpm-workspace.yaml` and the licence and advisory gates in `pnpm check:deps`.

Two existing limits will fire on ordinary Next.js code. Decide, do not reflex:

- `max-lines-per-function: 60` counts a component's whole JSX tree. Raising it
  for `**/*.tsx` is defensible; raising it globally is not.
- `sonarjs/no-duplicate-string` with `threshold: 3` fires on repeated Tailwind
  class strings. Prefer extracting the shared class list over disabling.

## Step 3 — Knip

`knip.jsonc` lists one entry point, `src/index.ts`. Every route file in a
Next.js app is reachable only through the router, so Knip reports the entire
application as unused.

Enable Knip's Next.js plugin rather than hand-listing patterns — it already
knows `app/**/page.tsx`, `layout.tsx`, `route.ts`, `middleware.ts`,
`instrumentation.ts`, `not-found.tsx` and their Pages Router equivalents, and
it tracks them across Next.js versions. Keep `treatConfigHintsAsErrors: true`.

Do not add ignores for the reported paths. An ignore that silences the router's
files also silences a genuinely dead component sitting next to them.

## Step 4 — dependency-cruiser

`no-orphans` reports the same files for the same reason. Add the
convention-loaded paths to the rule's `pathNot`, alongside the existing `.d.ts`
and config entries.

Then re-examine two rules against the app's real shape:

- `no-production-to-dev-dependency` forbids `src/` importing a devDependency.
  In a Next.js app `react` and `react-dom` are dependencies but `@types/react`
  is a devDependency; type-only imports are already excluded by
  `dependencyTypesNot: ["type-only"]` in the sibling rule but not here.
  Verify the rule still passes before assuming it does.
- `no-lib-to-entry-point` is about `scripts/`. It stays as-is unless the
  enforcement scripts were not adopted, in which case delete it rather than
  leave a rule guarding nothing.

## Step 5 — Vitest

Only if Step 0 said components are tested here.

Set `environment: 'jsdom'` (or `happy-dom`), add `@testing-library/react`, and
widen `include` to the component extensions. Prefer a `environmentMatchGlobs`
style split so server-side tests keep running under `node` — a DOM in a test
that does not need one hides accidental `window` access in server code.

Leave `retry: 0`, the mock-reset flags and the per-file thresholds alone. They
are the reason the suite is evidence.

## Step 6 — jscpd and Stryker scopes

Both name `src` and `scripts` directly and will silently measure nothing in the
app directory.

- `.jscpd.json` — add the app's source path and `tsx` to `format`.
- `stryker.config.json` — extend `mutate` to the app's source. This is a cost
  decision: mutation testing a component tree is slow and the mutants are often
  equivalent. Scoping `mutate` to business logic and excluding presentational
  components is legitimate, but `docs/code-quality-gate.md` requires the
  exclusion and its reason to be recorded, not assumed.

The per-file 80% coverage floor applies to whatever ends up in scope. Do not
lower it to accommodate untested components; narrow the scope and say so.

## Step 7 — CI

Add `next build` as a required step. It is the only check that catches a broken
route, an invalid `generateStaticParams`, or a Server Component importing
client-only code — `pnpm typecheck` sees none of these.

Whether it belongs in `pnpm verify` or a separate job is the trade-off from
`docs/development-guide.md`: in `verify` it blocks every commit and slows the
local loop; as a separate job it parallelises but can be merged around unless
it is a required check. If the host (Vercel and similar) already builds on
every push, a duplicate CI build may be redundant — confirm that its failure
actually blocks the merge before relying on it.

Any new workflow must satisfy `pnpm check:workflows`: actions pinned to a full
commit sha, `timeout-minutes` on the job, top-level `permissions`, no `${{ }}`
interpolated into `run:`, and `persist-credentials: false` on checkout.

## Step 8 — the protected-file notice

Almost every step above edits a protected path, so the PR will carry the
`protected-file-notice` comment listing them. That is the design working, not a
failure. It does not block the merge, and the required `check` and `mutation`
jobs still have to pass.

## Step 9 — documentation

- `docs/architecture.md` states the repository has no application layers, web
  framework, cloud integration or build output. After this work all four are
  false. Rewrite the section; do not append a correction below it.
- Write an ADR from `docs/decisions/0000-adr-template.md` recording the Step 0
  answers, every check whose scope was narrowed, and the reason. Add it to
  `docs/decisions/index.md`.
- Keep it out of `AGENTS.md`. Nothing here is a rule an agent needs at startup,
  and the file carries a soft 100-line limit.

## Verify

```sh
pnpm verify
pnpm test:mutation
pnpm install --frozen-lockfile
```

A green `pnpm verify` after a scope change is not by itself evidence: confirm
the app's files are actually inside each check's scope. The failure mode of
this whole migration is a gate that passes because it is looking at nothing.

Check specifically that Knip reports the app's files as entry points rather
than not seeing them, that the coverage report lists the app's modules, and
that `pnpm duplication` reports a file count consistent with the app's size.
