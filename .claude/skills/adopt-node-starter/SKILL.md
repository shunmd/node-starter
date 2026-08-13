---
name: adopt-node-starter
description: Install this repository's enforcement layer -- the pinned toolchain, pnpm verify, the mutation job, the workflow and dependency policies, the declared GitHub repository settings, and the agent context files -- into another repository, in one pass and with the result verified. Use when adopting node-starter into an existing project, when re-running an adoption that turned out to be incomplete, or when auditing a destination repository for pieces of the gate that were never copied. For the framework-specific reconciliation that follows, see adopt-nextjs-quality-gate.
---

# Adopting node-starter into a repository

`docs/adoption-guide.md` explains the ownership model and the decisions the
migration requires. This skill is the executable pass over it: what to copy,
in what order, and how to prove afterwards that nothing was left behind.

The failure this exists to prevent is a partial adoption. It does not announce
itself — `pnpm verify` passes in the destination because the checks that were
never copied cannot fail. `scripts/github-settings.ts`, `scripts/lib/`, and
`scripts/check-gate-contract.ts` were each missed this way. Step 2 and the
verification step are the parts that close it; do not skip them because the
copy "looked complete".

## Step 0 — establish the two repositories

Work in the destination on a dedicated branch, with the template available as
a remote:

```sh
git switch -c chore/adopt-node-starter
git remote get-url template >/dev/null 2>&1 || git remote add template https://github.com/shunmd/node-starter.git
git fetch --quiet template main
```

Record the destination's current checks and whether they pass. A failure that
existed before the migration must not be reported as a migration failure.

## Step 1 — take the inventory from the manifest, not from memory

`infra/template-manifest.json` is the template's list of the files it owns,
grouped by how a destination adopts them. `pnpm check:manifest` fails in the
template whenever a tracked file is missing from it, so it is the only list
that cannot be out of date.

```sh
git show template/main:infra/template-manifest.json > infra/template-manifest.json
node -e 'const m=JSON.parse(require("fs").readFileSync("infra/template-manifest.json","utf8"));for(const g of m.groups)console.log(`\n# ${g.title} [${g.ownership}]\n`+g.paths.join("\n"))'
```

Ownership decides the action, and there are only three:

- **adopt** — copy from the template as-is. These are the enforcement scripts
  and the GitHub settings tool. They have no project-specific content, and
  editing them during adoption is how a destination ends up with a gate that
  no longer matches the one it claims to run.
- **merge** — combine with the destination's existing file. Config and CI:
  the destination keeps its own application-shaped decisions, and gains the
  template's checks.
- **project** — the file exists in both, and its content is the destination's
  decision. Copy the template's version only if the destination has none.

Copy the `adopt` group wholesale before touching anything else:

```sh
git checkout template/main -- scripts/ infra/github/
```

Then work through the `merge` group file by file. `scripts/` and
`infra/github/` are the two directories previous adoptions truncated; taking
them as whole directories rather than as a remembered list of files is the
point of this step.

## Step 2 — merge the configuration

Order matters: the toolchain first, because everything after it runs under it.

1. **Toolchain** — `mise.toml`, `mise.lock`, `pnpm-workspace.yaml`. Decide
   whether the destination can move to the pinned Node and pnpm versions; if
   not, stop and record why, because the rest of the gate assumes them.
2. **package.json** — merge the `scripts` block in full and the
   `devDependencies` the gate needs, keeping the destination's name, version,
   runtime dependencies and its own scripts. `scripts/lib/gate-contract.ts`
   lists the scripts that must exist; a missing one fails
   `pnpm check:gate-contract`, which is the fastest way to find a half-copied
   `package.json`.
3. **Type, style and quality config** — `tsconfig.json`, `eslint.config.js`,
   `prettier.config.js`, `.prettierignore`, `vitest.config.ts`,
   `stryker.config.json`, `knip.jsonc`, `.dependency-cruiser.json`,
   `.jscpd.json`, `.editorconfig`, `.gitattributes`. Point every path at the
   destination's real source and test layout. A check aimed at a directory
   that does not exist passes by measuring nothing.
4. **CI** — merge the `check`, `mutation` and `github-settings` jobs, and the
   `protected-file-notice` job, into the destination's existing workflow.
   Never replace a workflow wholesale: deployment, release and preview jobs
   belong to the destination. Copy `.github/workflows/github-settings.yml`
   as-is.
5. **Agent context** — `AGENTS.md`, `CLAUDE.md`, `docs/index.md` and the
   documents it routes to. Rewrite `docs/architecture.md` to describe the
   destination; left unedited it describes a repository with no application,
   which is worse than having no file at all.

Only after the destination's own entry points and tests are covered by the new
configuration, remove the template's placeholder `src/index.ts` and its test.

## Step 3 — the GitHub settings layer

This is the layer adoptions omit most often, because nothing in the
destination fails without it. `infra/github/**` is the declared desired state
for the repository's own settings, and `scripts/github-settings.ts` validates,
compares and applies it.

Copied as-is, then reconciled with the destination's reality:

- `infra/github/repository-settings.json` — merge behaviour and branch
  defaults. Check `default_branch` against the destination's actual default.
- `infra/github/rulesets/main.json` — the required status checks are named
  `check`, `mutation` and `github-settings`. If Step 2 gave those jobs
  different names, the names must agree here, and
  `pnpm check:gate-contract` compares the two directions for you.
  The template's ruleset requires no approving review, which is a deliberate
  solo-repository policy (ADR 0008). A destination with more than one
  maintainer should raise `required_approving_review_count` here rather than
  inherit it by accident.
- `infra/github/environments/production.json` — `reviewers` is empty in the
  template. Fill in the destination's reviewer IDs, or delete the environment
  file if the destination has no deployment environment; do not leave an
  unreviewed `production` environment in place because it was in the copy.
- `infra/github/secrets-manifest.json` — declares `GH_ADMIN_TOKEN`. The
  destination must actually create that secret, with repository administration
  and secret-metadata read permissions, or the scheduled drift job fails on
  its first run.

Validate locally without credentials, then compare against the live
repository:

```sh
pnpm github:settings
node scripts/github-settings.ts --check --remote
```

The remote check reads the repository from `GITHUB_REPOSITORY` or the `origin`
remote, so run it in the destination clone and confirm it names the right
repository before reading its output. Applying is a separate, deliberate act:

```sh
ALLOW_GITHUB_SETTINGS_APPLY=1 GH_TOKEN="$(gh auth token)" node scripts/github-settings.ts --apply
```

Apply only after the drift output has been read. On a repository whose plan
does not support rulesets, the tool skips them rather than failing; that skip
is a real gap in enforcement, so record it if it happens.

## Step 4 — resolve every declared scope before running the slow checks

`pnpm check:scope` resolves every path or glob a quality tool is scoped to --
Stryker's `mutate`, Vitest's `include` and `coverage.include`, jscpd's `path`,
the directories `pnpm architecture` scans -- against the destination's actual
files, and fails on the first one that matches nothing.

```sh
pnpm check:scope
```

Run this before `pnpm test:mutation`, not after. A scope left over from the
template's own layout, or copied from a different source repository's
`src/application/**/*.ts`, either stops Stryker outright — a failure that only
shows up at the end of the gate — or, for jscpd and coverage `include`, does
not fail at all: it reports success over an empty set. `check:scope` turns
both into one named error, up front, naming the file and the exact pattern
that matched nothing.

## Step 5 — install and run the gate

```sh
mise trust && mise install
pnpm install
pnpm verify
pnpm test:mutation
pnpm install --frozen-lockfile
git diff --check
```

`pnpm verify` is the standard gate; the complete required gate also needs
`pnpm test:mutation`. An adoption where only the fast checks ran is not done.

## Step 6 — prove the adoption is complete

A green gate is not evidence that the gate is whole. Two checks answer that,
and both are cheap:

```sh
pnpm check:manifest
scripts/diff-upstream.sh main
```

`check:manifest` fails when a path the manifest claims is absent from the
destination — which is exactly what a truncated copy looks like.
`diff-upstream.sh` reads the same manifest and shows every remaining
difference against the template. Read the output as three categories:

- a file shown as deleted — it was never copied. Copy it.
- a difference you made on purpose — keep it, and record durable ones in
  `docs/decisions/`.
- a difference you did not intend — the merge in Step 2 lost something.

Then confirm the checks are pointed at real code rather than passing on an
empty scope: the coverage report lists the destination's modules, Knip reports
its entry points, and `pnpm duplication` reports a file count consistent with
the project's size.

## Step 7 — protect and record

- Require `check`, `mutation` and `github-settings` in branch protection, and
  confirm the required names match the job names in the merged workflow.
- Keep the protected-file notice, and extend its path list to any
  enforcement-layer directory the destination added.
- Write an ADR from `docs/decisions/0000-adr-template.md` for every check
  whose scope was narrowed, every template default that was changed, and any
  ruleset or environment that could not be applied. An unrecorded deviation is
  indistinguishable from a mistake six months later.

## Completion

- [ ] `infra/template-manifest.json` is present and `pnpm check:manifest`
      passes.
- [ ] `pnpm check:scope` passes: every declared mutation, coverage, jscpd and
      architecture scope matches at least one destination file.
- [ ] Every `adopt` path is byte-identical to the template.
- [ ] `pnpm verify` and `pnpm test:mutation` pass, over the destination's real
      source.
- [ ] `pnpm install --frozen-lockfile` passes.
- [ ] `node scripts/github-settings.ts --check --remote` runs against the
      destination and its output has been read.
- [ ] `GH_ADMIN_TOKEN` exists, or its absence is recorded.
- [ ] Branch protection requires the three jobs by their real names.
- [ ] `scripts/diff-upstream.sh main` shows only intended differences.
- [ ] Deviations are recorded in `docs/decisions/`.
