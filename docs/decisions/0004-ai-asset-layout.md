# 4. AGENTS.md is the single source of truth for agent instructions

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

A repository that wants coding agents to work well tends to accumulate files
aimed at them: `AGENTS.md`, `CLAUDE.md`, a `docs/` tree, sometimes skills or
per-directory instruction files. The failure mode is not having too few of them.
It is having the same rule written in three of them, where two are stale and
nobody knows which two.

Two facts constrain the layout:

- Claude Code reads `CLAUDE.md`. It does not read `AGENTS.md` natively. Codex
  and most other agents read `AGENTS.md`.
- `CLAUDE.md` supports `@path` imports, so it can point at another file rather
  than copy it.

## Decision

**`AGENTS.md` is the only file containing agent rules.** `CLAUDE.md` is a stub
that imports it with `@AGENTS.md` and says, in the file itself, that rules must
not be added there.

Content is routed by lifetime and audience, with each destination owning
something the others do not:

| File                                                           | Owns                                      | Who writes it         |
| -------------------------------------------------------------- | ----------------------------------------- | --------------------- |
| `eslint.config.js`, `tsconfig.json`, `pnpm-workspace.yaml`, CI | every rule that can be executed           | human only            |
| `AGENTS.md`                                                    | rules for agents that cannot be executed  | human; agent proposes |
| `CLAUDE.md`                                                    | an import of `AGENTS.md`, nothing else    | nobody                |
| `README.md`                                                    | getting a human started                   | anyone                |
| `docs/development-guide.md`                                    | how a human performs recurring tasks      | anyone                |
| `docs/architecture.md`                                         | the shape of the system                   | anyone                |
| `docs/decisions/`                                              | why, and what was rejected                | anyone                |
| `docs/ai/learnings.md`                                         | volatile facts discovered while working   | agent, freely         |
| `docs/ai/improvement-backlog.md`                               | proposed changes to the enforcement layer | agent, freely         |

The governing rule, stated at the top of `AGENTS.md`: **anything a tool enforces
is not written down as an instruction.** Formatting, import style, type
strictness, unused code, promise handling and dependency policy get no prose,
because ESLint, TypeScript, Prettier and pnpm already answer those questions and
answer them the same way every time.

`AGENTS.md` carries a soft size limit of roughly 100 lines. Growth past it is
treated as a signal that something in the file should have been a lint rule.

## The self-improvement loop, and its limit

Agents may edit `docs/**` and `README.md` without asking. They may not edit the
enforcement layer — that boundary is enforced by the `guard-enforcement-layer`
CI job, which fails any pull request touching `eslint.config.js`,
`tsconfig.json`, `mise.toml`, `mise.lock`, `pnpm-workspace.yaml`,
`.github/workflows/` or `scripts/check-toolchain-age.ts` without an explicit
human marker (a `toolchain` label or `TOOLCHAIN-CHANGE-APPROVED` in the title).

This is the asymmetry the whole design rests on: an agent that can freely
weaken its own checks does not have checks. Making rules stricter and making
them looser look identical to a diff, so the boundary is drawn around the files
rather than around the direction of change.

Improvement proposals therefore flow one way — into
`docs/ai/improvement-backlog.md`, with the exact config change, the concrete
problem, and the cost — and a human applies them.

## Alternatives considered

**Symlink `CLAUDE.md -> AGENTS.md`.** Zero duplication and no import mechanism
needed, and it is what Anthropic's own documentation suggests. Rejected only
because symlinks need `core.symlinks` on Windows checkouts and are easy to
break accidentally; the two-line stub achieves the same thing with no
portability caveat. Either is defensible.

**Per-directory `AGENTS.md` files.** Genuinely useful in a large monorepo where
subtrees have different rules. Rejected for the template: with one `src/`
directory it creates a second place to look with nothing to say. A generated
project may add them when it has subtrees that actually differ.

**Put rules in `README.md` and have agents read that.** Rejected — the README's
audience is a human seeing the project for the first time, and instructions for
that reader and instructions for an agent mid-task want different content at
different lengths. Merging them makes both worse.

**Let agents edit lint config freely.** Rejected; see the asymmetry above.

## Consequences

- Any new agent tool that reads some third filename needs a stub like
  `CLAUDE.md`, not a copy.
- The guard job is a real cost on legitimate toolchain work: every such pull
  request needs a label or a title marker. That is the intended friction.
- `docs/ai/learnings.md` will accumulate stale entries unless pruned. The file
  says so, but nothing enforces it — a genuine soft spot in this design.

## Revisit when

Claude Code reads `AGENTS.md` natively, which makes `CLAUDE.md` deletable; or
`docs/ai/learnings.md` demonstrably rots, at which point the loop needs a
mechanical prune step rather than an instruction to prune.
