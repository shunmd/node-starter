---
name: upgrade-node-starter
description: Pull later template changes into a repository that already adopted node-starter -- new enforcement scripts, raised coverage/mutation thresholds, workflow or GitHub-settings changes -- and verify none of it was left half-applied. Use for periodic template maintenance, when the template's own CHANGELOG-worthy commits (a new check, a stricter threshold) need to reach an already-adopted repository, or when a repository's `pnpm check:manifest` / `scripts/diff-upstream.sh` looks stale. Not for the first adoption -- see adopt-node-starter for that.
---

# Upgrading an already-adopted repository

`docs/adoption-guide.md` §9 owns the short version of this procedure. This
skill is the executable pass: how to find what changed upstream, apply it
without quietly weakening anything already in place, and verify the result.

An upgrade fails the same way an adoption does — quietly. `pnpm verify`
passing after an upgrade is not evidence the upgrade is complete: a check the
destination never had cannot fail by being missing, and a threshold the
destination already exceeds does not complain about being merged down to the
template's floor. The steps below are built around catching exactly those two
silent failures.

## Step 0 — orient

```sh
cd <destination-repo>
git switch -c chore/upgrade-node-starter
git remote get-url template >/dev/null 2>&1 || git remote add template https://github.com/shunmd/node-starter.git
git fetch --quiet template main
```

Confirm the destination already has `infra/template-manifest.json` and
`pnpm check:manifest` passes before touching anything. If it does not, this is
a first adoption, not an upgrade — use `adopt-node-starter` instead, since the
manifest-driven diff this skill relies on has nothing to compare against yet.

## Step 1 — find what changed, including what the destination's own manifest cannot see

```sh
scripts/diff-upstream.sh main
```

This reads two manifests, not one: the destination's own
`infra/template-manifest.json`, and the upstream template's copy at
`template/main`, unioned together. That union is the point of this step. A
destination that adopted an older template version has a manifest that
predates every file the template added since — `check:manifest` and
`diff-upstream.sh` used to only ever look at the destination's own list, so a
new enforcement script (this is exactly how
`scripts/check-scope-contract.ts` and `scripts/check-template-manifest.ts`
would have been missed by an upgrade run before this union existed) never
showed up as missing. The union closes that: a path either manifest lists is
checked, so a file the destination's manifest has never heard of still
surfaces as `not present locally (upstream addition)`.

Read the output in three categories:

- `not present locally (upstream addition)` — a new template file. Copy it
  (Step 2).
- `=== <file>` with a diff — an existing shared file changed upstream. Merge it
  by hand (Step 3); never apply the diff mechanically, since the destination's
  own edits inside that file are exactly what a blind apply would discard.
- `not present upstream (local addition)` — the destination's own file. Leave
  it.

## Step 2 — copy new `adopt`-owned files wholesale

Cross-reference the new paths from Step 1 against the upstream manifest's
groups to find their ownership:

```sh
git show template/main:infra/template-manifest.json | node -e '
  const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const g of m.groups) console.log(`${g.title} [${g.ownership}]\n` + g.paths.join("\n") + "\n");
'
```

For every new path whose group is `adopt` (`scripts/`, `infra/github/`, and
the manifest file itself), copy it directly:

```sh
git checkout template/main -- <path>
```

Do not hand-edit an `adopt`-owned file during an upgrade. If the destination
needed a change to one, that change belongs in `docs/decisions/` as a
recorded deviation, not as a silent edit that the next upgrade will overwrite
or diverge from without anyone noticing.

For a new path whose group is `merge`, go to Step 3 instead — a wholesale copy
would discard the destination's own configuration.

## Step 3 — merge changed `merge`-owned files without lowering anything

For each file Step 1 showed as changed (not new), read the diff and decide
line by line. Two situations recur on every template upgrade and are the ones
most likely to be merged backwards by mistake:

- **A raised threshold.** If the template's `vitest.config.ts` or
  `stryker.config.json` moves a coverage or mutation floor up (for example
  80% → 95%), take the higher number. If the destination's own floor is
  already at or above the new one, leave the destination's alone — the
  template sets a floor, not a target, and merging a diff naively can pull a
  repository's stricter setting back down to the template's.
- **A new required script.** If `package.json`'s `scripts` block gained an
  entry (a new `check:*` step, for instance), add it and wire it into
  `check`, in the same relative position the template uses. A script present
  in the template's `package.json` but missing from the destination's is
  exactly what `check:gate-contract`'s required-scripts list exists to catch
  in Step 5 — but only if it is added here first.

After merging, confirm nothing regressed by eye: `git diff` the merged files
against what the destination had before this upgrade, not just against the
template, and check that no number went down and no required script went
missing.

## Step 4 — reconcile the GitHub settings layer if it changed

If `infra/github/**` appeared in Step 1's diff, treat it with the same care
as a first adoption's Step 5 in `adopt-node-starter`: `repository-settings.json`
and `rulesets/main.json` are destination-specific once applied (branch name,
required reviewers, ruleset bypass actors), so copying the template's file
outright can silently revert a destination's own settings decisions. Diff by
hand, and re-run before applying anything live:

```sh
pnpm github:settings
node scripts/github-settings.ts --check --remote
```

## Step 5 — run the gate the way an upgrade needs to be run

```sh
mise trust && mise install
pnpm install
pnpm check:manifest
pnpm check:scope
pnpm verify
pnpm test:mutation
pnpm install --frozen-lockfile
```

`check:manifest` and `check:scope` are listed first, ahead of the full
`verify`, on purpose: they are the two checks most likely to fail immediately
after an upgrade — the first because Step 2 might have missed a file, the
second because a raised or retargeted scope (Step 3) might now point at
nothing. Finding that here is faster than finding it as a Stryker failure at
the end of `test:mutation`, or not finding it at all because jscpd and
coverage `include` do not fail on an empty scope, they just stop measuring
anything.

If `test:coverage` or `test:mutation` now fails on a file that was fine before
this upgrade, that file's own tests are what closed the gap on the template
side too (see `docs/code-quality-gate.md` if the destination wants the same
history) — strengthen the destination's tests rather than opting the file out
of the new threshold.

## Step 6 — prove nothing regressed

```sh
pnpm check:manifest
scripts/diff-upstream.sh main
```

Both should report clean, or only intentional differences. If
`diff-upstream.sh` still shows a `not present locally` line, Step 2 missed it.
If it shows an unexpected `=== <file>` diff on something Step 3 was supposed
to finish, the merge was incomplete.

## Step 7 — record and protect

- Record any deviation this upgrade introduced or preserved deliberately in
  `docs/decisions/`, same as a first adoption — a threshold the destination
  keeps lower than the template's new floor, a GitHub setting the template
  changed that the destination did not follow, and why.
- If branch protection lists required checks by name and the upgrade renamed
  or added a job, update the ruleset and confirm
  `checkRequiredStatusChecksMatchJobs` (`pnpm check:gate-contract`) agrees.

## Completion

- [ ] `scripts/diff-upstream.sh main` — run against the union of both
      manifests — shows only intentional differences.
- [ ] `pnpm check:manifest` passes.
- [ ] `pnpm check:scope` passes.
- [ ] No coverage or mutation threshold went down; every one that the
      template raised is now at least as high in the destination.
- [ ] Every script name in the template's `package.json` exists in the
      destination's, wired into `check`.
- [ ] `pnpm verify` and `pnpm test:mutation` pass.
- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `node scripts/github-settings.ts --check --remote` has been run if
      `infra/github/**` changed, and its output has been read.
- [ ] Deviations are recorded in `docs/decisions/`.
