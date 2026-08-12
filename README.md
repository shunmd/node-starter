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
| Test            | Vitest                                                                                      |
| CI              | GitHub Actions running the same `pnpm check` you run locally                                |
| AI              | `AGENTS.md` as single source of truth, imported by `CLAUDE.md`                              |

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
pnpm install      # install dependencies from pnpm-lock.yaml
pnpm check        # verify everything passes before you change anything
```

If `pnpm check` is green on a fresh clone, your environment is correct.

> **First run only:** `mise install` writes `mise.lock`, which records the
> resolved versions and their checksums. It is not in this repository yet
> because it is machine-generated. Commit it as your first commit — from then
> on, every `mise install` verifies downloads against it instead of trusting
> whatever the backend serves.

## Commands

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm check`           | **The gate.** Toolchain policy, format, lint, types, tests.        |
| `pnpm fix`             | Applies every mechanical fix (`prettier --write`, `eslint --fix`). |
| `pnpm lint`            | ESLint only.                                                       |
| `pnpm typecheck`       | `tsc --noEmit`.                                                    |
| `pnpm test`            | Vitest, once.                                                      |
| `pnpm test:watch`      | Vitest, watching.                                                  |
| `pnpm test:coverage`   | Vitest with V8 coverage.                                           |
| `pnpm format:check`    | Prettier in check mode.                                            |
| `pnpm check:toolchain` | Toolchain pins agree, and are old enough to be trusted.            |

CI runs `pnpm check` and nothing else, so there is no separate standard to
satisfy and no way for the two to drift apart. There is intentionally no `ci`
script.

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

## AI development

`AGENTS.md` is the single source of truth for coding agents. `CLAUDE.md` imports
it; nothing duplicates it.

The organising principle is that **rules which can be executed are executed**.
Formatting, typing, dependency policy and lint standards are not described to
agents in prose — they are enforced by tools that answer the same way every
time. `AGENTS.md` holds only what tooling cannot check.

Agents may freely update `docs/`, including `docs/ai/learnings.md` (things
discovered while working) and `docs/ai/improvement-backlog.md` (proposed changes
to the setup itself). They may **not** change the enforcement layer — lint
config, tsconfig, CI, toolchain pins, supply-chain settings. The
`guard-enforcement-layer` CI job blocks pull requests that touch those paths
without an explicit human approval marker, because an agent that can weaken its
own checks does not have checks.

The recommended AI-assisted workflow is bounded by small tasks, isolated
branches, independent CI and human approval for production or high-risk
changes. See [`docs/development-guide.md`](docs/development-guide.md#ai-assisted-change-loop)
and [ADR 5](docs/decisions/0005-bounded-ai-assisted-development.md).

See [`docs/decisions/0004-ai-asset-layout.md`](docs/decisions/0004-ai-asset-layout.md).

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
pnpm check
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
mise trust && mise install && pnpm install && pnpm check
```

Or use the "Use this template" button on GitHub.

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
- [ ] `AGENTS.md` — add project-specific rules under "Conventions the tools
      cannot check". Do not restate anything a tool already enforces.
- [ ] `docs/decisions/` — ADRs 1–4 describe the template's own decisions. Keep
      them (they explain your setup) and add yours from number 5.
- [ ] `docs/ai/learnings.md` — clear the seeded entry once it stops being useful.
- [ ] `mise.lock` — run `mise install` and commit the generated lockfile.
- [ ] `LICENSE` — add one if this is going to be shared.
- [ ] Decide whether you need a build step
      ([how](docs/development-guide.md#building-and-publishing)).
- [ ] Enable branch protection on `main` requiring the `check` job, so the gate
      is not merely advisory.

## Layout

```text
.
├── AGENTS.md              # Agent rules. Single source of truth.
├── CLAUDE.md              # Two-line stub importing AGENTS.md.
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
├── .editorconfig          # Editor defaults, incl. for files Prettier ignores.
├── .gitattributes         # Line endings; marks lockfiles as generated.
├── .prettierignore        # Generated output and lockfiles.
├── .github/workflows/
│   └── ci.yml             # Runs `pnpm check`; guards the enforcement layer.
├── scripts/
│   ├── check-toolchain-age.ts  # 5-day policy for Node/pnpm; pin coherence.
│   └── diff-upstream.sh        # Compare this project against the template.
├── types/
│   └── untyped-modules.d.ts    # Ambient types for deps that ship none.
├── src/
│   ├── index.ts           # Placeholder. Delete.
│   └── index.test.ts      # Placeholder. Delete.
└── docs/
    ├── architecture.md    # The shape of the system.
    ├── development-guide.md # Recurring human procedures.
    ├── ai/
    │   ├── learnings.md            # Volatile discoveries. Agent-writable.
    │   └── improvement-backlog.md  # Proposed rule changes. Agent-writable.
    └── decisions/         # ADRs: why, and what was rejected.
        ├── 0000-adr-template.md
        ├── 0001-toolchain-ownership.md
        ├── 0002-typescript-6-for-type-aware-lint.md
        ├── 0003-release-cooldown.md
        └── 0004-ai-asset-layout.md
```
