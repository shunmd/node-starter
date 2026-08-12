# Project

This repository is a generic Node.js project template. It provides a
reproducible toolchain, executable quality gates, and a small context router for
coding agents.

# Commands

```sh
pnpm verify   # the local standard quality gate
pnpm fix      # mechanical formatting and lint fixes
```

Use `package.json` for the complete script list and `docs/index.md` to find
task-specific documentation.

# Repository guidance

- Treat code, configuration, tests, and CI as the source of truth for rules
  they can verify. Do not duplicate enforceable rules in prose.
- Read the nearest workspace or package `AGENTS.md` before changing files in
  that scope. Add local instructions only when an independent subtree has
  durable knowledge that the root cannot express.
- Preserve the existing source of truth. Before adding knowledge, update,
  merge, or remove an existing source instead of creating a parallel note.
- Store only durable repository knowledge. Temporary discoveries are not a
  reason to grow always-loaded instructions; route current facts to the right
  document and historical rationale to an ADR.
- A change is complete only when `pnpm verify` passes. Do not weaken a check to
  make it pass; leave an unresolved failure visible.
- Where tooling does not decide, prefer `interface` over `type`, give errors
  input context, name tests by behaviour, explain why in comments, and avoid
  barrel files.
- The enforcement layer and its human-approval boundary are documented in
  `docs/architecture.md` and `docs/development-guide.md`.

# Context

- `docs/index.md` is the documentation router. Read only documents relevant to
  the task; do not scan all of `docs/` by default.
- Read `docs/decisions/index.md` only when historical rationale or alternatives
  matter. Do not load every ADR for a routine task.
- `README.md` is for humans. `CLAUDE.md` imports this file and contains no
  duplicate instructions.
