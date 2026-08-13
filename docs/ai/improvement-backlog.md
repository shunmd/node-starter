# Improvement backlog

Proposed changes to the enforcement layer — lint rules, tsconfig flags, CI
steps, scripts. Protected paths receive a review notice when changed; proposals
land here and a human reviews and applies them through the repository's normal
review process.

A proposal is only useful if it is concrete. Include:

- **What** — the exact configuration change, as a diff or a code block.
- **Why** — the specific problem it caught or would have caught, ideally a real
  incident in this repository rather than a general principle.
- **Cost** — what it will make noisier, slower, or more annoying. A proposal
  with no stated cost has not been thought through and will be rejected.

Delete accepted proposals once applied (the ADR or the config diff is the
record). Delete rejected ones with a one-line note saying why, so the same idea
is not re-proposed every month.

---

## Open

These are the gaps that `docs/code-quality-gate.md` lists as `Not measured`.
None of them is presented as covered anywhere, and none should be closed by
weakening something else.

### Add ShellCheck to the pinned toolchain

**What:** add `shellcheck` to `[tools]` in `mise.toml` (which also requires
regenerating `mise.lock`), then a `check:shell` script running
`shellcheck scripts/*.sh` and wire it into `pnpm check`.

**Why:** `scripts/secret-scan.sh` and `scripts/diff-upstream.sh` have no static
analysis at all. ESLint does not read shell, so an unquoted expansion, a
`set -e` that does not apply inside a pipeline, or a typo'd variable name is
caught only by running the script on the path that happens to be exercised.
Both scripts are in the enforcement layer.

**Cost:** one more native binary to keep pinned and to re-lock on upgrade.
ShellCheck also has opinionated style rules (SC2086 and friends) that will
require a first pass of fixes.

**Blocked on:** a human regenerating `mise.lock`, since `locked = true` means
mise will not resolve a tool that has no committed checksum.

### Add actionlint to the pinned toolchain

**What:** add `actionlint` to `[tools]` in `mise.toml` and run it alongside
`pnpm check:workflows`.

**Why:** `scripts/lib/workflow-policy.ts` checks the security and hygiene
properties this repository cares about, and deliberately nothing else. It does
not know GitHub's schema, so a misspelled `runs-on`, an invalid `if:`
expression, or a job referencing a `needs:` that does not exist still parses as
valid YAML and fails at runtime instead of at `pnpm verify`.

**Cost:** same as ShellCheck -- another pinned binary. Some overlap with the
existing checks, though actionlint does not cover the sha-pinning or
`persist-credentials` rules.

**Blocked on:** the same `mise.lock` regeneration.

### Add CodeQL for severity-classified static analysis

**What:** a `.github/workflows/codeql.yml` running `github/codeql-action`
init/analyze for `javascript-typescript`, and its job added to
`required_status_checks` in `infra/github/rulesets/main.json`.

**Why:** `Static Analysis: Critical / High Issue` is the one row in the quality
gate table that has been `Not measured` since the beginning.
`eslint-plugin-security` matches syntactic patterns in a single file; CodeQL
does interprocedural taint tracking, which is a different class of finding. The
repository is public, so CodeQL is free.

**Cost:** a slower required check (a few minutes), and a second findings inbox
in the GitHub Security tab rather than in `pnpm verify` output. Findings are
severity-classified, which means deciding a severity threshold -- the first
policy question in this repository that a `= 0` gate cannot express.

**Blocked on:** the action must be pinned to a commit sha
(`pnpm check:workflows` enforces this), and the sha has to be read from the
upstream repository at the version being adopted.

### Deepen the CI execution contract beyond "the job exists"

**What:** extend `checkCiWorkflowContract` in `scripts/lib/gate-contract-ci.ts`
(added alongside the Gate Contract Test) so it also rejects: a required job
gated by an `if:` expression referencing something other than the event
itself, a `needs:` chain that can leave a required job unreachable, a required
job's steps moved into a second workflow file the ruleset does not name, and a
`required_status_checks` context whose name does not match any job's
effective status-check name (the job's `name:` field, not just its key). It
should also confirm `scripts/github-settings.ts --check` runs in CI as exactly
`--check` (optionally `--check --remote`), never `--apply` outside the
protected `workflow_dispatch` path.

**Why:** the Gate Contract Test in `scripts/lib/gate-contract.ts` and
`scripts/lib/gate-contract-ci.ts` proves the `check` and `mutation` jobs exist,
are not short-circuited by `if: false` or `continue-on-error: true`, and are
not excluded by a `paths` filter on the `pull_request` trigger. It does not yet
prove they always _run to completion on the path that matters_ -- a `needs:`
graph that silently strands a job, or a job quietly moved to a workflow the
ruleset was never updated to watch, would still pass today's contract.

**Cost:** meaningfully more complex than the existing check: reasoning about
`needs:` reachability and cross-workflow job movement needs a small graph
walk, not a field read, and is easy to get subtly wrong in a way that either
misses real weakenings or false-positives on legitimate workflow shapes.

### Ratchet quality thresholds and scope against the PR's base branch

**What:** a `gate-ratchet` check that fetches the pull request's base-branch
version of `package.json`, `vitest.config.ts`, `stryker.config.json`,
`eslint.config.js`, `.dependency-cruiser.json` and
`infra/github/rulesets/main.json` (via `git show <base-sha>:<path>`) and fails
if the head version lowers a coverage or mutation threshold, narrows the
`src/**` / `scripts/lib/**` coverage or mutation scope, downgrades an ESLint
rule from `error`, downgrades a dependency-cruiser rule's severity, removes a
required status check, or removes a script from `pnpm check`'s chain --
independent of whether the resulting configuration still satisfies the Gate
Contract Test's fixed floor.

**Why:** the Gate Contract Test enforces a fixed floor (thresholds `>= 80`,
specific rules present at `error`). It cannot by itself distinguish "was
already at 85% and a PR drops it to 81%" from "has always been 81%" -- both
pass the same fixed check. A ratchet is the mechanism that turns "does not
violate the floor" into "does not move backward", which is what
`docs/code-quality-gate.md` section 1.2 asks for but nothing currently
verifies mechanically.

**Cost:** needs the base SHA, which means it only runs meaningfully in CI (or
locally against a real base ref), not as a plain `pnpm verify` step run from a
detached worktree. Comparing "scope" rather than just thresholds means parsing
the same glob lists the Gate Contract Test already parses, twice, once per
ref -- worth sharing code with `scripts/lib/gate-contract.ts` rather than
duplicating the extraction logic.

### Remove the ruleset's admin bypass and add a required `gate-integrity` job

**What:** two related, security-relevant changes that should land together and
be reviewed as GitHub-settings changes, not as ordinary code: (1) remove the
`bypass_actors` entry from `infra/github/rulesets/main.json`, so no
`RepositoryRole` can merge into `main` around the required checks even inside
a pull request; (2) add a `gate-integrity` job to `.github/workflows/ci.yml`
running `pnpm check:gate-contract` (and, once it exists, the ratchet check
above), and require it in `infra/github/rulesets/main.json` alongside `check`
and `mutation`.

**Why:** today `pnpm check:gate-contract` only runs as one step inside the
`check` job, and the ruleset still grants a bypass actor the ability to merge
without any required check passing at all. Both gaps mean the enforcement
described in this backlog's other entries, and in
`scripts/lib/gate-contract.ts` itself, can be routed around rather than
defeated on its own terms -- which is a materially different risk from a check
that simply has not been written yet.

**Cost:** removing the bypass actor removes the repository owner's own escape
hatch for a genuinely broken gate (a bad required check that cannot be fixed
through the normal PR path); it should not be done without a second way to
recover, such as `enforcement: evaluate` as a documented manual fallback. This
is exactly the kind of decision `docs/architecture.md` reserves for a human:
"Proposed enforcement changes ... Human applies accepted proposals."

### Decompose `scripts/github-settings.ts`

**What:** move its validation, normalisation and drift-comparison functions into
`scripts/lib/github-settings-policy.ts`, leaving the API client, argument
parsing and orchestration in the entry point. Then delete the two exemptions
for it in `eslint.config.js`.

**Why:** it is 1300 lines, it is the only file exempt from the entry-point size
limits, and it is outside the coverage scope -- so the script that reconciles
this repository's own branch protection has no tests. Its validation half is
already pure and would be straightforward to cover.

**Cost:** a large mechanical diff in a protected path, which is exactly the kind
of change that is hard to review. Worth doing on its own, not alongside
anything else.

### Measure duplication on changed lines

**What:** replace or supplement jscpd's whole-tree percentage with a
diff-scoped measurement, so the `<= 3%` on new code in the standard gate can be
reported honestly.

**Why:** the current 2% whole-tree threshold is not the same metric. As the
repository grows, a change can add a substantial clone while the overall
percentage falls.

**Cost:** no tool in the current toolchain does this. jscpd has no diff mode, so
this needs either a wrapper that runs it against the merge base or a different
tool -- and a wrapper that computes a percentage is itself enforcement-layer
code that would need tests.

## Rejected

### Enable `eslint-plugin-unicorn` recommended

**Why not:** it is a large set of opinionated rules with a high false-positive
rate on ordinary Node code (`prevent-abbreviations` in particular renames
well-understood identifiers). The cost — reflexive `eslint-disable` comments and
generated code contorted to satisfy style rules — outweighs the defect-finding
value. Individual unicorn rules may still be worth enabling one at a time, with
a concrete reason each.
