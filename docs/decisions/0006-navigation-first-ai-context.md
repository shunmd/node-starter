# 6. Agent context is navigation-first

- **Status:** Accepted
- **Date:** 2026-08-12
- **Scope:** Root instructions, documentation routing, and repository knowledge maintenance
- **Supersedes:** [0004-ai-asset-layout.md](0004-ai-asset-layout.md)

## Context

Coding agents consume startup context on every task. A large instruction file
raises that cost and makes stale or duplicated rules compete with executable
configuration. The repository already has detailed current documentation,
quality tooling, and ADRs; the problem is choosing the smallest reliable entry
point for each task.

## Decision

1. `AGENTS.md` is a short navigation document with only four sections:
   `Project`, `Commands`, `Repository guidance`, and `Context`. It points to
   detailed documents instead of embedding their contents.
2. `CLAUDE.md` contains only `@AGENTS.md`, so Claude Code and Codex share the
   same repository-wide navigation source without duplicated rules.
3. `docs/index.md` is the one-hop router for current knowledge. Current
   architecture, recurring procedures, quality policy, and decision status each
   have one owning document.
4. `docs/decisions/index.md` routes historical rationale and marks active versus
   superseded ADRs. ADR bodies are not loaded for routine work.
5. `README.md` remains human-facing. It may explain the template and quick
   start, but it is not mandatory agent context.
6. Local `AGENTS.md` files are added only for independent workspaces, packages,
   or services with durable rules that cannot be supplied by the root router.
   A flat repository does not receive instruction files in every directory.
7. Mechanically enforceable rules remain in tooling. New knowledge is first
   classified as temporary, executable, current, historical, or procedural;
   only the appropriate existing source is updated. No `.ai/` knowledge base or
   append-only learning archive is created.
8. `docs/ai/` is limited to temporary maintenance queues. Entries are pruned,
   promoted, or deleted; it is not a source of truth for current architecture.

## Consequences

- Most tasks load only `AGENTS.md` and the documents selected through
  `docs/index.md`.
- The same fact has a clear owner, reducing contradictory instructions.
- Documentation maintenance includes deletion and consolidation, not only
  addition.
- Agents must spend one extra step selecting a document when they need detail,
  but unrelated context is not paid for on every task.

## Alternatives considered

**Keep all rules in a larger `AGENTS.md`.** Rejected because every task pays for
rules and procedures it does not need, and growth makes stale guidance harder
to detect.

**Make `README.md` mandatory agent context.** Rejected because setup guidance
for a human arriving at the project is not the same audience or granularity as
mid-task repository guidance.

**Create a separate `.ai/` knowledge base.** Rejected because it duplicates the
existing documentation and creates another source of truth to keep aligned.

**Add `AGENTS.md` to every directory.** Rejected because this repository has no
independent subtree rules that justify the additional always-loaded files.
