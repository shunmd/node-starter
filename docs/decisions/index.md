# Architectural decisions

Read an ADR only when the current task needs historical rationale, rejected
alternatives, or a decision's revisit condition. This index does not reproduce
ADR bodies.

## Active

| ADR                                                                                    | Decision                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`0001-toolchain-ownership.md`](0001-toolchain-ownership.md)                           | Toolchain pins have one reproducibility root and mirrored assertions.          |
| [`0002-typescript-6-for-type-aware-lint.md`](0002-typescript-6-for-type-aware-lint.md) | TypeScript 6 is retained for the current type-aware lint compatibility window. |
| [`0003-release-cooldown.md`](0003-release-cooldown.md)                                 | Dependencies follow a five-day release cooldown and trust policy.              |
| [`0005-bounded-ai-assisted-development.md`](0005-bounded-ai-assisted-development.md)   | AI-assisted changes use bounded tasks and independent gates.                   |
| [`0006-navigation-first-ai-context.md`](0006-navigation-first-ai-context.md)           | Agent context is minimal at startup and routed to on-demand documents.         |
| [`0007-protected-file-review-notice.md`](0007-protected-file-review-notice.md)         | Protected-file changes are reported for review without blocking valid PRs.     |

## Superseded

| ADR                                                                                        | Replaced by                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`0004-ai-asset-layout.md`](0004-ai-asset-layout.md)                                       | [`0006-navigation-first-ai-context.md`](0006-navigation-first-ai-context.md)   |
| [`0007-machine-verifiable-review-boundary.md`](0007-machine-verifiable-review-boundary.md) | [`0007-protected-file-review-notice.md`](0007-protected-file-review-notice.md) |

`0000-adr-template.md` is a writing template, not an architectural decision.
