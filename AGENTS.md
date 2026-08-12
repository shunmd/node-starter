# AGENTS.md

Operating rules for coding agents (Claude Code, Codex, and others) working in
this repository. This file is the single source of truth for agent behaviour.
`CLAUDE.md` imports it; nothing restates it.

**What is deliberately NOT in this file:** anything a tool already enforces.
Formatting, import style, type strictness, unused code, promise handling and
dependency policy are decided by Prettier, ESLint, TypeScript and pnpm, not by
this document. If you want to know whether something is allowed, run the check
— do not look for a sentence here granting permission.

## The one command

```sh
pnpm check
```

Runs, in order: toolchain policy, format check, lint, typecheck, tests. CI runs
this exact command and nothing else. Green here means the change meets the
standard.

Fixing what is mechanically fixable:

```sh
pnpm fix     # prettier --write + eslint --fix
```

## Non-negotiables

1. **Finish on green.** Do not report work as complete while `pnpm check`
   fails. If you cannot make it pass, say what fails and why, and leave the
   failure visible.
2. **Never weaken a check to pass it.** Do not add rule overrides, `skipLibCheck`
   exceptions, `--no-verify`, `.eslintignore` entries, or `expect.soft` to make
   red turn green. The check is the requirement, not an obstacle to it.
3. **`eslint-disable` needs a reason.** Suppressions without a description are a
   lint error, by design. Write why the rule is wrong _here_, not that it was
   inconvenient.
4. **The enforcement layer needs a human.** You may edit anything in `src/`,
   `docs/`, tests and README freely. Changes to `eslint.config.js`,
   `tsconfig.json`, `mise.toml`, `mise.lock`, `pnpm-workspace.yaml`,
   `.github/workflows/` and `scripts/check-toolchain-age.ts` require the human
   to approve them explicitly. CI blocks these paths (see
   `guard-enforcement-layer`); if you believe one should change, propose it in
   `docs/ai/improvement-backlog.md` instead of editing it.
5. **Do not add dependencies casually.** Every new package is permanent attack
   surface. Prefer the Node standard library. If you do add one, say in the
   commit message what it replaced and why the standard library was not enough.
6. **Do not bump Node or pnpm.** Those pins carry a 5-day cooldown policy that
   `pnpm check:toolchain` enforces. See `docs/development-guide.md`.

## Conventions the tools cannot check

- **`type` over `interface`** except when declaration merging is genuinely
  needed. (`consistent-type-definitions` enforces the choice; this line records
  which one.)
- **Errors carry context.** Throw `Error` subclasses with a message naming the
  input that failed, not a bare string.
- **Tests describe behaviour, not implementation.** A test name should survive a
  refactor of the thing it tests.
- **Comments explain why.** What the code does is readable; why it does it this
  way, and what breaks if changed, is not.
- **No barrel files** (`index.ts` re-exporting a directory). They defeat
  tree-shaking and make import cycles easy to create by accident.

## Where knowledge goes

Adding a thought to the wrong file is how instruction sets rot. Use this table.

| You learned...                                        | Write it in                      |
| ----------------------------------------------------- | -------------------------------- |
| A rule every future change must follow                | this file (keep it short)        |
| Why a decision was made, and what was rejected        | `docs/decisions/NNNN-*.md` (ADR) |
| How this project is shaped                            | `docs/architecture.md`           |
| A gotcha, a workaround, a "this looked broken but..." | `docs/ai/learnings.md`           |
| An idea for improving the setup itself                | `docs/ai/improvement-backlog.md` |
| How a human gets started                              | `README.md`                      |
| How a human does a recurring task                     | `docs/development-guide.md`      |

You may write to `docs/**` and `README.md` without asking. You may not write to
the enforcement layer (rule 4).

## Self-improvement loop

This repository is meant to get better as it is used. When you notice something:

1. **Can a tool enforce it?** Then it does not belong in prose. Add it to
   `docs/ai/improvement-backlog.md` as a proposed lint rule, tsconfig flag or CI
   step, with the exact configuration change. A human applies it.
2. **Is it a fact about this codebase?** Append to `docs/ai/learnings.md` with
   the date. Keep entries short and delete them when they stop being true — a
   learnings file that only grows becomes noise nobody reads.
3. **Is it a decision with alternatives?** Write an ADR in `docs/decisions/`.
4. **Is a rule in this file now wrong or unused?** Say so explicitly in your
   response. Deleting stale rules matters as much as adding good ones; an
   instruction nobody follows teaches agents that instructions are optional.

Before adding anything here, check it is not already implied by a check. This
file should stay under roughly 100 lines. If it is growing, something in it
should have been a lint rule.
