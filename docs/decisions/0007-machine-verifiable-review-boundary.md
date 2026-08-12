# 7. What replaces human code review, and what does not

Date: 2026-08-12

## Status

Accepted

## Context

This repository's stated goal is that a change is judged by executable checks
rather than by a human reading a diff. The checks that existed covered
formatting, types, lint, dead code, dependency direction, duplication, secrets
in the working tree, tests, coverage and mutation score. That is a strong
correctness gate, and reviewing this repository against its own goal found
that the gaps were not in correctness at all.

The gaps clustered in four places.

**Nothing looked at the dependencies.** `pnpm install --frozen-lockfile` proved
the graph was the reviewed one and the release cooldown proved it was not brand
new, but no check asked whether anything in it had a published advisory or a
licence the project may not accept. At the time of writing, `pnpm audit` on the
unchanged repository reported a moderate advisory in a transitive dependency,
and `pnpm licenses list` reported an LGPL-3.0-only package. Neither was a
mistake, and neither was a decision anyone had recorded. A human reading a
`package.json` diff cannot answer either question.

**Coverage was measured as a repository-wide average.** An 80% average lets a
well-tested module pay for an untested one, so the file a reviewer would have
worried about is precisely the one the average hides. The same gate reported
100% while the 1326-line script that reconciles the repository's own GitHub
settings had no tests at all.

**The workflows were unreviewed code with the highest privilege in the repo.**
One of the two pinned its actions to commit shas and one pinned them to tags; a
tag can be re-pointed at different code after review. Nothing prevented a
`${{ }}` expression being interpolated into a `run:` block, nothing required a
job timeout, and every checkout left a usable token in `.git/config` for later
steps.

**The human approval boundary was author-controlled.** The rule that the
enforcement layer changes only with a human's sign-off was implemented as a CI
job reading the pull request title for `TOOLCHAIN-CHANGE-APPROVED`, or a label.
An agent opening a pull request sets its own title. The control was therefore
satisfiable by the party it was meant to constrain, and it covered three script
files rather than all of `scripts/` and `infra/`.

Secret scanning had a narrower version of the same shape: it scanned the files
on disk, so a credential that was committed and then deleted passed, while the
key stayed in every clone.

## Decision

Add the missing gates, and be explicit about which part of review is being
replaced and which part is not.

1. **Dependency policy as a gate.** `pnpm check:deps` fails on any `pnpm audit`
   advisory and any licence outside an allow list. Escapes go through
   `infra/policy/dependency-policy.json`, which requires the exact finding, a
   reason and an owner; vulnerability exceptions additionally require a
   `reviewBy` date, after which the exception fails instead of suppressing. An
   exception that no longer matches anything is itself a failure, so approvals
   for solved problems cannot accumulate. Dependabot proposes the upgrades, with
   its cooldown set to the same five days as pnpm's.

2. **Per-file coverage instead of an average**, over `src/**` and
   `scripts/lib/**`. This also serves as the stand-in for diff coverage, which
   no tool in this toolchain measures: a new file cannot enter below the bar and
   an existing one cannot be pushed below it. To make that meaningful, the
   decision logic of every enforcement script moved into `scripts/lib/`, which
   is covered and mutation-tested; the entry points keep only argv, I/O and exit
   and are capped at 120 lines so logic cannot migrate there to escape.

3. **Workflow policy as a gate.** `pnpm check:workflows` requires commit-sha
   pins, job timeouts, declared top-level permissions, no `pull_request_target`,
   no expression interpolated into `run:`, and `persist-credentials: false` on
   checkout.

4. **A real approval boundary.** `.github/CODEOWNERS` plus
   `require_code_owner_review` on the `main` ruleset makes enforcement-layer
   changes require an approval the author cannot grant. The CI guard job stays,
   reframed as what it actually is -- a declaration of intent that stops
   incidental edits -- and its protected paths widen to all of `scripts/`,
   `infra/`, `.github/` and `pnpm-lock.yaml`.
   `require_last_push_approval` closes the gap where post-approval pushes
   merged unreviewed.

5. **Secret scanning over the commit history**, not only the working tree, with
   CI checking out at full depth and a shallow clone failing loudly rather than
   passing on the commits it happens to have.

`src/` and `docs/` are deliberately not in CODEOWNERS. Requiring a human to
read ordinary application changes would restore exactly the review this
repository exists to remove.

## Consequences

Two of the new gates depend on facts outside the repository, so a pull request
can go red without its own content changing: a newly published advisory, or an
expired `reviewBy` date. That is the intended behaviour of a supply-chain gate
and it is the reason the exception format requires a re-evaluation date rather
than permanent approval. Both also require network access and fail closed, in
line with `check:toolchain`.

Requiring `persist-credentials: false` and commit-sha pins makes adding a
workflow step slightly more work, and every action upgrade now arrives as a
Dependabot pull request rather than a hand-edited tag.

Per-file coverage is stricter than it looks: a small file with one uncovered
branch can fail where the average would not have noticed. That is the point,
but it means genuinely trivial modules need a test or need to not exist.

The `require_code_owner_review` requirement means a solo maintainer cannot
merge their own enforcement-layer change without using the admin bypass the
ruleset already grants. That is a visible, logged action, which is the
distinction being bought.

Three things remain unmeasured and are recorded as such in
`docs/code-quality-gate.md` rather than presented as covered: severity-classified
static analysis (no SonarQube), duplication on changed lines only, and shell
script linting. ShellCheck and actionlint are both native binaries that would
have to be added to `mise.toml` and `mise.lock`; `docs/ai/improvement-backlog.md`
carries the proposals.
