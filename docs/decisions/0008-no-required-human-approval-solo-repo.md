# 8. No required human approval is a solo-repository decision

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

[`0007-protected-file-review-notice.md`](0007-protected-file-review-notice.md)
explains why a blocking, path-based review guard was replaced with an
informational notice: the friction it added to metadata-only changes was
larger than the benefit. That ADR argues from CI friction. It does not say,
on its own, whether "no required approval" is a property of this repository
in particular, or a general claim about the template's review model — nor
does it say when that stops being true.

Separately, `infra/github/rulesets/main.json` still carried a `bypass_actors`
entry granting the repository's admin role a `pull_request`-mode bypass. That
entry was added by
[`0007-machine-verifiable-review-boundary.md`](0007-machine-verifiable-review-boundary.md)
(superseded), which required `require_code_owner_review` on `main` and used
the bypass as the sole maintainer's escape hatch around their own requirement.
The superseding ADR reverted `require_code_owner_review` to `false`. The
bypass was never removed, so it has stood for a while granting an exception to
a requirement that no longer exists.

## Decision

For this repository, as long as it has a single maintainer, the following is
the intended configuration -- not an oversight to be closed later:

- `required_approving_review_count: 0`
- `require_code_owner_review: false`
- `require_last_push_approval: false`
- `bypass_actors: []` on the `main` ruleset -- no admin PR bypass
- `.github/CODEOWNERS` is retained as metadata for adopters who choose to
  enable code-owner review, not as a control this repository currently uses

The `main` ruleset still requires the `check`, `mutation` and (as of this
ADR) `github-settings` status checks and review-thread resolution. What is
removed is specifically the human-approval layer on top of those checks, per
the risk-based review guidance in
[ADR 5](0005-bounded-ai-assisted-development.md): a solo maintainer applying
that guidance to their own repository is the human decision point ADR 5
requires, exercised once at merge time rather than twice.

Emergency changes to GitHub settings -- including re-adding a bypass in a
future incident -- go through the existing `workflow_dispatch` `apply` job in
`.github/workflows/github-settings.yml`, restricted to `main` and the
`production` environment. That is a visible, logged action distinct from a
silent PR bypass, which is the property this ADR is protecting.

This does not create full independence between policy and enforcement: the
same repository holds both `infra/github/rulesets/main.json` and the code in
`scripts/` that checks it, so a change to one can, in principle, accompany a
change to the other in the same pull request. `check`, `mutation` and
`github-settings` all still have to pass, and
`scripts/lib/github-settings-policy.ts` is itself covered and mutation-tested
(see [ADR 5](0005-bounded-ai-assisted-development.md)), but this is not the
same guarantee an external quality gate or a second human would provide. This
residual risk is accepted for a solo repository and is the reason the next
section names a concrete point at which it should not be accepted anymore.

## Alternatives considered

**Keep the admin bypass as a documented emergency path.** Rejected because it
was already documented as exactly that under the superseded ADR, and the
requirement it was meant to bypass no longer exists. An unused bypass is not
a safety margin; it is an unmonitored door.

**Restate this inside ADR 0007.** Rejected because ADR 0007 is about
replacing a blocking notice with an informational one -- a CI-ergonomics
decision. Whether approval is required at all, for whom, and until when, is a
different question with a different revisit trigger, and conflating the two
would make either one harder to revisit independently.

**Require code-owner review again, immediately.** Rejected for the same
reason ADR 0007-superseded's predecessor was reverted: for a single
maintainer, `require_code_owner_review` cannot be satisfied by anyone other
than an admin bypass, which reintroduces exactly the unmonitored door this
ADR removes.

## Consequences

- A regression in `main.json` (a reintroduced bypass, `require_code_owner_review:
true`, `require_last_push_approval: true`, or a required check silently
  dropped) fails `node scripts/github-settings.ts --check` before it reaches
  GitHub, per
  [`scripts/lib/github-settings-approval-policy.ts`](../../scripts/lib/github-settings-approval-policy.ts).
- There is no PR-time human gate on enforcement-layer changes. `check`,
  `mutation`, `github-settings` and the `protected-file-notice` comment
  (informational) are what a reviewer -- including a future one working
  alongside the maintainer -- has to work with.
- Adopting this template for a team, a production deployment, or high-risk
  assets means revisiting this ADR before relying on it, not after.

## Revisit when

The repository gains a second regular committer, a production-facing
deployment, or begins handling high-risk assets (secrets, payments, PII). At
that point, enable `require_code_owner_review` on the `main` ruleset and/or
route the affected changes through an external quality gate, per the
risk-based review guidance in
[ADR 5](0005-bounded-ai-assisted-development.md), rather than reusing the
admin bypass this ADR removed.
