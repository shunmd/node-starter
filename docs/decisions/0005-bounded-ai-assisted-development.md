# 5. AI-assisted changes are bounded by independent gates

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Coding agents can shorten the path from an idea to a working change, but their
output is not a source of truth. An agent can misunderstand a requirement,
write tests that repeat the same misunderstanding, or make a change that is
locally valid but unsafe in a deployed system.

The repository already has an executable quality gate in `pnpm check`. The
remaining question is how to use agents around that gate without treating an
agent's claim that it is finished as evidence.

## Decision

Use agents inside a bounded workflow with independent decision points:

1. A human fixes the intent, acceptance criteria, architecture constraints and
   security boundary.
2. The work is split into a small, reviewable task. The task records its
   acceptance criteria and expected tests before implementation begins.
3. The implementation is isolated to its own branch and pull request. The
   agent works with development and test resources only.
4. The implementing agent writes or updates tests and runs `pnpm check`, but
   its own report is not the final verdict.
5. Review checks the diff against the task and architecture, with specific
   attention to security, data consistency, error handling and compatibility.
   A second agent may assist with this review, but its result is advisory.
6. CI independently runs the repository gate. A change is not complete merely
   because an agent says it is complete; the required checks must pass.
7. When the project has a deployable application, staging smoke or E2E checks
   run before production. Production deployment retains an explicit human
   approval gate.

The strictness of review follows the risk of the change. Authentication,
authorization, database migrations, payments, secrets, IAM and production
infrastructure require human review even when automated checks pass. Low-risk
changes may use a lighter review path only when the repository's branch and CI
controls still prevent an unverified change from reaching the protected branch.

## Alternatives considered

**Trust the implementing agent and its tests.** Rejected because the agent can
share the requirement mistake that produced the implementation, tests and
completion report.

**Use a second agent as the final authority.** Rejected because review models
can also miss defects. Review is a useful independent signal, while CI and the
human production gate remain the authoritative boundaries they can actually
enforce.

**Automate every change through production.** Rejected because the cost of an
incorrect security, data or infrastructure decision is not bounded by the
scope of a code diff.

**Copy the full external workflow into this template.** Rejected because this
template has no application deployment, staging environment, E2E suite or
issue tracker yet. The reusable principle is documented here; project-specific
steps belong in the generated project's own architecture and deployment docs.

## Consequences

- Tasks become easier to review because intent and acceptance criteria are
  explicit before implementation.
- Agents remain useful for planning, implementation, testing and review without
  being able to unilaterally define correctness or production safety.
- A generated application must add its own staging, E2E, deployment and branch
  protection configuration. This ADR does not claim those controls exist in
  the template.
- Small changes and isolated branches add process overhead, but make failures
  easier to attribute and revert.

## Revisit when

The template gains a deployable reference application, or the repository's CI
and branch protection can mechanically enforce risk-based review requirements.
At that point, replace the advisory parts of this ADR with concrete commands
and protected-environment rules.
