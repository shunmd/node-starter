# Architecture

> **Replace this file.** In a generated project it should describe that
> project's shape. What follows describes the template itself, and is here as a
> worked example of the level of detail worth writing down.

## The template's own structure

The repository has one organising idea: **every rule that can be executed is
executed, and only what cannot be executed is written down.**

That produces three layers.

### 1. Enforcement (executable)

| Concern                      | Owner                                    |
| ---------------------------- | ---------------------------------------- |
| Which binaries exist         | `mise.toml` + `mise.lock`                |
| Which packages are allowed   | `pnpm-workspace.yaml` + `pnpm-lock.yaml` |
| Layout of code               | `prettier.config.js`                     |
| Correctness of code          | `tsconfig.json`, `eslint.config.js`      |
| Behaviour of code            | `vitest.config.ts` + `src/**/*.test.ts`  |
| Coverage floor               | `vitest.config.ts`                       |
| Dead code and dependency use | `knip.jsonc`                             |
| Dependency boundaries        | `.dependency-cruiser.json`               |
| Secret detection             | `mise.toml` + `scripts/secret-scan.sh`   |
| Toolchain age and coherence  | `scripts/check-toolchain-age.ts`         |
| All of the above, remotely   | `.github/workflows/ci.yml`               |

These are wired together by a single entry point, `pnpm verify` (`pnpm check` is
a compatibility alias). Adding a new
mechanical rule means adding it to one of these files — never to prose.

### 2. Durable decisions (written, stable)

`docs/decisions/` holds ADRs: why a thing is the way it is, what else was
considered, and what would make us change our minds. An ADR is not edited after
it is accepted; it is superseded by a later one.

`docs/code-quality-gate.md` is the normative quality policy. It defines the
standard metrics and marks which ones are active in this template versus
conditional on an application-specific Sonar, E2E or mutation-testing setup.

### 3. Working knowledge (written, volatile)

`docs/ai/learnings.md` and `docs/ai/improvement-backlog.md` are append-and-prune
scratch space that agents maintain as they work. Nothing here is authoritative;
it is a staging area for things that may become ADRs, lint rules, or nothing.

## Why the separation matters

Rules stated only in prose decay in a predictable way: they are followed while
someone remembers them, then followed inconsistently, then cited in review as if
they had always been enforced. Rules stated as checks either work or fail
loudly. So the design question for any new rule is not "where should I document
this" but "can this be a check". Prose is the fallback, not the default.

## Boundary with README

`README.md` is for someone who has never seen the repository: what it is, how to
start, what to change first. It does not explain rationale. This file and
`docs/decisions/` do.
