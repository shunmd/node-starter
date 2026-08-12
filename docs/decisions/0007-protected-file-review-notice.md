# 7. Protected-file changes are reported for review

- **Status:** Accepted
- **Date:** 2026-08-12
- **Scope:** Pull request checks and main-branch required status checks

## Context

The repository has a set of files that can change how quality, toolchain and
supply-chain checks work. A blocking path-based guard made every change to
those files require a title marker or label, including harmless metadata-only
changes such as a package license update. That friction was larger than the
benefit for this repository's review workflow.

## Decision

1. `check` and `mutation` remain required status checks for `main`.
2. The `protected-file-notice` job reports changes to the protected paths in a
   pull request comment and does not block merging.
3. The job updates one bot-authored comment instead of creating a comment for
   every commit. It removes the comment when the protected-path change is
   reverted.
4. Comment API failures, including insufficient permissions for fork pull
   requests, are warnings only. The notice is supplemental evidence, not a
   merge gate.

## Consequences

- Metadata-only changes no longer need a title marker or label.
- Reviewers can see protected-file changes in the pull request conversation.
- A reviewer can ignore the notice, so this no longer prevents an agent from
  weakening a check. Required status checks and human review remain the actual
  merge controls.
- Fork pull requests may not receive the comment when their token is
  read-only; the workflow remains successful in that case.

## Alternatives considered

**Keep the blocking guard.** Rejected because path-level detection creates
avoidable friction for benign changes and the repository's review process is
already the intended human decision point.

**Remove all CI checks.** Rejected because `check` and `mutation` still provide
the repository's reproducible quality gate.

**Use a required notification check.** Rejected because a comment service or
token permission failure should not block an otherwise valid pull request.
