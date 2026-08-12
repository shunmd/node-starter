# node-starter

A template for starting Node.js projects: reproducible toolchain, strict static
analysis, a supply-chain policy that holds without anyone remembering it, and a
documented place for coding agents to work.

It is deliberately unopinionated about what you build. There is no web
framework, no cloud SDK, no build step — those belong to the project, not to its
foundation.

## What you get

| Concern         | Choice                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------- |
| Toolchain       | [mise](https://mise.jdx.dev) pins Node 24.19.0 and pnpm 11.20.0, checksummed in `mise.lock` |
| Package manager | pnpm 11, with a 5-day release cooldown on every dependency                                  |
| Language        | TypeScript 6.0 (`strict` plus everything `strict` leaves off), ESM                          |
| Lint            | ESLint 10 flat config, typescript-eslint `strictTypeChecked`, no warnings                   |
| Format          | Prettier, near-default, verified in CI                                                      |
| Test            | Vitest with an 80% coverage floor                                                           |
| CI              | GitHub Actions running `pnpm verify` plus a required Mutation job                           |
| Static analysis | ESLint SonarJS rules, Knip, dependency-cruiser, Gitleaks                                    |
| AI              | `AGENTS.md` context router, imported by `CLAUDE.md`                                         |

## Prerequisites

Only [mise](https://mise.jdx.dev/getting-started.html). It installs everything
else, at the exact versions this repository pins.

```sh
curl https://mise.run | sh
```

You do **not** need a system Node or a system pnpm, and if you have them they
will not be used.

## Quick start

```sh
mise trust        # approve this repo's mise.toml
mise install      # install Node + pnpm at the pinned versions
mise exec -- pnpm install   # install dependencies from pnpm-lock.yaml
mise exec -- pnpm verify    # verify everything passes before you change anything
```

If `pnpm verify` is green on a fresh clone, your environment is correct.

## VS Code

Workspace extension recommendations are in
[`.vscode/extensions.json`](.vscode/extensions.json). They cover the tools this
repository actually uses:

- EditorConfig for the repository-wide editor defaults.
- ESLint for diagnostics and autofixable lint rules.
- Prettier for formatting, resolved from the local dependency.
- Vitest for running and debugging tests from the Testing view.
- GitHub Actions for workflow authoring and run inspection.

No separate TypeScript extension is recommended. VS Code already provides
TypeScript language features, while `typescript` in this repository and
`pnpm typecheck` remain the type-checking authority.

> **First run only:** `mise.lock` records the resolved versions and their
> checksums. It is committed in this repository, so every `mise install`
> verifies downloads against it instead of trusting whatever the backend serves.

## Commands

| Command                | What it does                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm verify`          | **The standard gate.** Toolchain, format, lint, types, dead code, architecture, coverage, secrets. |
| `pnpm check`           | Compatibility alias for `pnpm verify`.                                                             |
| `pnpm fix`             | Applies every mechanical fix (`prettier --write`, `eslint --fix`).                                 |
| `pnpm lint`            | ESLint only.                                                                                       |
| `pnpm typecheck`       | `tsc --noEmit`.                                                                                    |
| `pnpm test`            | Vitest, once.                                                                                      |
| `pnpm test:coverage`   | Vitest with the 80% lines/functions/branches/statements floor.                                     |
| `pnpm test:mutation`   | Required StrykerJS mutation gate with an 80% score floor, separate from `pnpm verify`.             |
| `pnpm deadcode`        | Knip unused files, dependencies and exports.                                                       |
| `pnpm architecture`    | dependency-cruiser circular and production-to-test checks.                                         |
| `pnpm secret:scan`     | Gitleaks scan of staged content or the working tree.                                               |
| `pnpm test:watch`      | Vitest, watching.                                                                                  |
| `pnpm format:check`    | Prettier in check mode.                                                                            |
| `pnpm check:toolchain` | Toolchain pins agree, and are old enough to be trusted.                                            |

CI runs `pnpm verify` in the standard `check` job and `pnpm test:mutation` in a
separate required `mutation` job. There is intentionally no `ci` script.

`pnpm verify` is the preferred name for the same gate. It includes toolchain,
format, lint, type, dead-code, architecture, coverage and secret checks;
`pnpm check` remains as a compatibility alias.

## Code quality

The rules are in `eslint.config.js` and `tsconfig.json`, with the reasoning
written inline next to each deviation. The two conventions worth knowing before
you read them:

- **No warnings.** Every rule is `error` or `off`. A warning is a rule nobody
  has to obey, and it makes a green build mean less.
- **Suppressions must explain themselves.** `eslint-disable` without a
  description is itself a lint error, and a disable comment that no longer
  suppresses anything is too.

TypeScript runs with `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`erasableSyntaxOnly` and `verbatimModuleSyntax`. ESLint adds the type-aware
`strictTypeChecked` set on top — floating promises, unsafe `any` flows,
non-exhaustive switches and conditions that can never be false are all errors.

The complete merge policy, including coverage, complexity, duplication,
local static-analysis rules and mutation-testing rules, is in
[`docs/code-quality-gate.md`](docs/code-quality-gate.md).

## AI development

The root [`AGENTS.md`](AGENTS.md) is a small navigation document shared with
Claude Code through [`CLAUDE.md`](CLAUDE.md). Current repository knowledge is
routed from [`docs/index.md`](docs/index.md); historical decisions are indexed
separately in [`docs/decisions/index.md`](docs/decisions/index.md). This README
remains a human-facing setup and customization guide.

The recommended AI-assisted workflow is bounded by small tasks, isolated
branches, independent CI and human approval for production or high-risk
changes. See [`docs/development-guide.md`](docs/development-guide.md#ai-assisted-change-loop)
and [ADR 5](docs/decisions/0005-bounded-ai-assisted-development.md).

The template is not a web application, so Playwright is intentionally not
installed. Generated web projects should add an `e2e` script and a minimal
critical-user-flow suite when they have an application to launch.

## Supply chain

Every npm package — direct and transitive — must have been public for **5 days**
before pnpm will install it. Most malicious publishes are found and pulled
within hours, so waiting costs almost nothing and removes almost all of the
exposure.

The same 5 days applies to Node and pnpm themselves, enforced by
`scripts/check-toolchain-age.ts` because pnpm's setting cannot cover its own
version. Dependency install scripts are blocked by default (`allowBuilds: {}`),
and `trustPolicy: no-downgrade` refuses packages whose provenance got weaker
than the lockfile recorded.

The full design, including the ways around it, is in
[`docs/decisions/0003-release-cooldown.md`](docs/decisions/0003-release-cooldown.md).
Read the "Known bypasses" section before relying on any of it.

## Updating dependencies

```sh
pnpm outdated
pnpm update --latest
pnpm verify
```

There is no update bot. Adding one is reasonable — configure its cooldown to
match the 5 days in `pnpm-workspace.yaml` if you do.

## Updating Node.js / pnpm

Both are pinned to exact patch versions in three places that must agree:
`mise.toml`, `package.json` (`devEngines`) and `mise.lock`. The procedure, and
the reason for the friction, is in
[`docs/development-guide.md`](docs/development-guide.md#updating-the-toolchain).

## Creating a new project from this template

```sh
gh repo create my-project --template shunmd/node-starter --private --clone
cd my-project
mise trust && mise install && mise exec -- pnpm install && mise exec -- pnpm verify && mise exec -- pnpm test:mutation
```

Or use the "Use this template" button on GitHub.

For an existing project, follow the
[`existing-project adoption guide`](docs/adoption-guide.md).

To compare an existing project against the template later:

```sh
scripts/diff-upstream.sh
```

Nothing syncs automatically — the script shows the diff and you decide.

## Initial customization checklist

Work through this before your first real commit.

- [ ] `package.json` — set `name`, `description`, `license`, and remove
      `"private": true` if this will be published.
- [ ] `README.md` — replace this file with your project's own. Keep the
      Prerequisites and Quick start sections; the rest is about the template.
- [ ] `docs/architecture.md` — replace the template's structure with yours.
- [ ] `src/index.ts` and `src/index.test.ts` — placeholder code. Delete them.
- [ ] `scripts/diff-upstream.sh` — point `TEMPLATE_REMOTE` at this template if
      you forked it somewhere else.
- [ ] `AGENTS.md` — keep only durable repository-wide guidance that tools
      cannot enforce, and use `docs/index.md` for detail.
- [ ] `docs/decisions/` — ADRs 1–6 describe the template's own decisions. Keep
      relevant history and add yours from number 7.
- [ ] `docs/ai/learnings.md` — clear the seeded entry once it stops being useful.
- [ ] `mise.lock` — verify the pinned lockfile after changing the toolchain.
- [ ] `LICENSE` — add one if this is going to be shared.
- [ ] Decide whether you need a build step
      ([how](docs/development-guide.md#building-and-publishing)).
- [ ] Enable branch protection on `main` requiring the `check` and `mutation`
      jobs, so the gate is not merely advisory.

## Layout

```text
.
├── AGENTS.md              # Agent navigation and repository-wide guidance.
├── CLAUDE.md              # Stub importing AGENTS.md.
├── README.md              # This file: for a human arriving for the first time.
├── mise.toml              # Exact Node + pnpm pins. The reproducibility root.
├── mise.lock              # Checksums for the above. Written by `mise install`; commit it.
├── package.json           # Scripts, deps, devEngines assertions.
├── pnpm-workspace.yaml    # pnpm settings, incl. the supply-chain policy.
├── pnpm-lock.yaml         # Resolved dependency graph. Committed.
├── tsconfig.json          # Type-checking rules.
├── eslint.config.js       # Lint rules, with rationale inline.
├── prettier.config.js     # Formatting. Deliberately almost empty.
├── vitest.config.ts       # Test runner config.
├── stryker.config.json     # Mutation-testing thresholds and scope.
├── knip.jsonc              # Dead-code and dependency analysis.
├── .dependency-cruiser.json # Dependency boundary rules.
├── .vscode/
│   └── extensions.json     # Workspace extension recommendations.
├── .editorconfig          # Editor defaults, incl. for files Prettier ignores.
├── .gitattributes         # Line endings; marks lockfiles as generated.
├── .prettierignore        # Generated output and lockfiles.
├── .github/workflows/
│   └── ci.yml             # Runs the standard and mutation gates; guards enforcement.
├── scripts/
│   ├── check-toolchain-age.ts  # 5-day policy for Node/pnpm; pin coherence.
│   ├── diff-upstream.sh        # Compare this project against the template.
│   └── secret-scan.sh          # Gitleaks working-tree/staged-content scan.
├── types/
│   └── untyped-modules.d.ts    # Ambient types for deps that ship none.
├── src/
│   ├── index.ts           # Placeholder. Delete.
│   └── index.test.ts      # Placeholder. Delete.
└── docs/
    ├── index.md            # Documentation router.
    ├── architecture.md    # The shape of the system and context boundaries.
    ├── development-guide.md # Recurring human procedures.
    ├── adoption-guide.md  # Existing-project migration procedure.
    ├── ai/
    │   ├── learnings.md            # Volatile discoveries. Agent-writable.
    │   └── improvement-backlog.md  # Proposed rule changes. Agent-writable.
    └── decisions/         # ADRs: why, and what was rejected.
        ├── index.md
        ├── 0000-adr-template.md
        ├── 0001-toolchain-ownership.md
        ├── 0002-typescript-6-for-type-aware-lint.md
        ├── 0003-release-cooldown.md
        ├── 0004-ai-asset-layout.md
        ├── 0005-bounded-ai-assisted-development.md
        └── 0006-navigation-first-ai-context.md
```
