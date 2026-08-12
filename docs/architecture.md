# Architecture

This repository is a generic Node.js project template. It has no application
layers, web framework, cloud integration, or build output. Its architecture is
the separation between executable enforcement, current documentation, and
historical rationale.

## Executable enforcement

| Concern                              | Source of truth                            |
| ------------------------------------ | ------------------------------------------ |
| Toolchain versions and checksums     | `mise.toml` and `mise.lock`                |
| Dependency policy and resolved graph | `pnpm-workspace.yaml` and `pnpm-lock.yaml` |
| Formatting                           | `prettier.config.js`                       |
| Type and code correctness            | `tsconfig.json` and `eslint.config.js`     |
| Behaviour and coverage               | `vitest.config.ts` and `src/**/*.test.ts`  |
| Mutation testing                     | `stryker.config.json`                      |
| Dead code and dependency use         | `knip.jsonc`                               |
| Dependency boundaries                | `.dependency-cruiser.json`                 |
| Secret detection                     | `scripts/secret-scan.sh`                   |
| Toolchain age and coherence          | `scripts/lib/toolchain-policy.ts`          |
| Dependency vulnerabilities, licences | `scripts/lib/dependency-policy.ts`         |
| Accepted dependency exceptions       | `infra/policy/dependency-policy.json`      |
| Workflow (CI) policy                 | `scripts/lib/workflow-policy.ts`           |
| Dependency update proposals          | `.github/dependabot.yml`                   |
| Human approval boundary              | `.github/CODEOWNERS`                       |
| CI execution                         | `.github/workflows/ci.yml`                 |
| GitHub repository desired state      | `infra/github/*.json`                      |
| GitHub settings API reconciliation   | `scripts/github-settings.ts`               |
| GitHub settings drift detection      | `.github/workflows/github-settings.yml`    |

The standard checks share `pnpm verify`; Mutation Testing runs through the
required `pnpm test:mutation` job. The `protected-file-notice` job reports
changes to files that define quality enforcement, the toolchain or
supply-chain settings, but does not block a pull request. `pnpm check` is the
compatibility alias for `pnpm verify`. A rule that a tool can enforce belongs
in that tool's configuration, not in an agent instruction or a duplicate
policy paragraph.

## The enforcement scripts

`scripts/` is split by testability, because the scripts are what decides
whether everything else passes, and an untested gate is not a gate.

| Layer          | Contents                                    | Verified by                            |
| -------------- | ------------------------------------------- | -------------------------------------- |
| `scripts/lib/` | Every pass/fail decision, as pure functions | Per-file coverage and mutation testing |
| `scripts/*.ts` | argv, file and network I/O, printing, exit  | Running them in `pnpm verify` and CI   |

The dependency runs one way -- `.dependency-cruiser.json` forbids a library
module from importing an entry point, since importing one would execute its
top-level `main()`. ESLint caps the entry points at 120 lines so logic cannot
migrate there to escape the coverage scope. `scripts/github-settings.ts`
predates the split and is exempt from both; the proposal to decompose it is in
`docs/ai/improvement-backlog.md`.

## The human approval boundary

Two mechanisms, doing different jobs. The CI `guard enforcement layer` job
records a _declaration of intent_: the pull request title or label says the
enforcement layer is being changed on purpose. Both are set by whoever opened
the pull request, so neither is an approval. The approval is
`.github/CODEOWNERS`, enforced by the `main` ruleset as a required code-owner
review, which an author cannot grant themselves.

`src/` and `docs/` are deliberately absent from CODEOWNERS. Changes there are
judged by the checks; requiring a human to read them would restore the review
this repository exists to remove.

## Documentation ownership

| Knowledge                    | Owner                            | Loading policy                         |
| ---------------------------- | -------------------------------- | -------------------------------------- |
| Current repository shape     | `docs/architecture.md`           | On demand from `docs/index.md`         |
| Recurring procedures         | `docs/development-guide.md`      | On demand from `docs/index.md`         |
| Existing project adoption    | `docs/adoption-guide.md`         | On demand from `docs/index.md`         |
| Quality policy               | `docs/code-quality-gate.md`      | On demand when evaluating the gate     |
| Historical rationale         | `docs/decisions/*.md`            | Only through `docs/decisions/index.md` |
| Temporary discoveries        | `docs/ai/learnings.md`           | Prune, promote, or delete              |
| Proposed enforcement changes | `docs/ai/improvement-backlog.md` | Human applies accepted proposals       |

`AGENTS.md` is the always-loaded router. `CLAUDE.md` imports it. `README.md` is
human-facing and is not a second agent knowledge base.

## Knowledge maintenance

When new information appears, classify it before writing it down. Temporary
observations are discarded; mechanically enforceable rules go to tooling;
current facts update their existing owner; historical reasons become an ADR;
repeatable procedures belong in the development guide or an appropriate skill.
Update or remove superseded text instead of appending another version.

The repository does not create `.ai/` context trees or instruction files for
every directory. A local `AGENTS.md` is justified only by an independent
workspace, package, or service with durable additional knowledge.

## Boundary with the README

`README.md` explains what the template is, how a human starts it, and how to
customize it. It does not own architecture rationale or agent startup context.
