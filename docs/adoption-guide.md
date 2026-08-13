# Adopting the Template in an Existing Project

This guide is for adding the node-starter enforcement layer to a repository
that already contains application code, dependencies, CI, and project-specific
documentation. For a new repository, use the template flow in `README.md`
instead.

The migration is deliberately a merge, not a blind file copy. Application
behaviour, deployment jobs, and project-specific architecture remain owned by
the destination repository. The template supplies the reproducible toolchain,
quality checks, agent context boundaries, and their documentation.

## 1. Prepare a migration branch

Start from a clean branch and record the existing baseline before changing
anything:

```sh
git switch -c chore/adopt-node-starter
git status --short
```

Run the destination project's current checks, or record why they cannot run.
This separates migration failures from pre-existing failures. Do not delete or
overwrite existing configuration until its current owner and purpose are known.

## 2. Inventory the template-owned surface

`infra/template-manifest.json` is the list of files the template owns, grouped
by how a destination adopts them. It is not prose: `pnpm check:manifest` fails
in the template whenever a tracked file below its declared roots is missing
from it, so a file added to the enforcement layer cannot escape the inventory
the way `scripts/github-settings.ts` and `scripts/lib/` once did.

Read it from the template before anything has been copied:

```sh
TEMPLATE_REMOTE=https://github.com/shunmd/node-starter.git
git remote get-url template >/dev/null 2>&1 || \
  git remote add template "${TEMPLATE_REMOTE}"
git fetch --quiet template main
git show template/main:infra/template-manifest.json
```

Once the manifest is in the destination, `scripts/diff-upstream.sh` reads the
same list and shows the differences. Neither path synchronizes files
automatically; review each difference before adopting it.

## 3. Merge by ownership

The manifest gives each path one of three ownerships, and the ownership decides
the action:

| Ownership | Action                                       | Applies to                                                  |
| --------- | -------------------------------------------- | ----------------------------------------------------------- |
| `adopt`   | Copy from the template as-is                 | `scripts/`, `infra/github/`                                 |
| `merge`   | Combine with the destination's existing file | Toolchain, quality config, CI, agent context                |
| `project` | Keep the destination's own content           | `.github/CODEOWNERS`, `infra/policy/dependency-policy.json` |

Take the `adopt` group as whole directories rather than as a remembered list of
files — an enforcement script that is present but unreferenced, or absent
entirely, produces a gate that passes because part of it is not there.

For the `merge` group, use the following order; the toolchain is first because
everything after it runs under it. Keep one clear source of truth for every
setting.

| Area              | Merge                                                                                              | Destination-specific decision                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Toolchain         | `mise.toml`, `mise.lock`, `pnpm-workspace.yaml`                                                    | Whether the project can move to the pinned Node and pnpm versions              |
| Package metadata  | `package.json`, `pnpm-lock.yaml`                                                                   | Project name, runtime dependencies, scripts, package publication settings      |
| Type and style    | `tsconfig.json`, `eslint.config.js`, `prettier.config.js`, `.prettierignore`                       | Existing compiler options and generated-file boundaries                        |
| Tests and quality | `vitest.config.ts`, `stryker.config.json`, `knip.jsonc`, `.dependency-cruiser.json`, `.jscpd.json` | Test roots, application entrypoints, mutation scope, and dependency boundaries |
| CI                | `.github/workflows/ci.yml`, `.github/dependabot.yml`                                               | Existing deployment, release, preview, and environment-specific jobs           |
| Agent context     | `AGENTS.md`, `CLAUDE.md`, `docs/index.md`                                                          | Durable project rules and documentation ownership                              |

The full `scripts` block from `package.json` is part of this merge.
`scripts/lib/gate-contract.ts` names the scripts that must exist, so a
half-copied `package.json` fails `pnpm check:gate-contract` rather than
producing a gate that quietly runs fewer checks.

Do not replace an existing workflow wholesale. Merge the `check` and required
`mutation` jobs into the current workflow, preserving deployment and release
jobs. The protected-file notice should also cover every setting that can weaken
the checks, while remaining informational rather than blocking.

## 4. Resolve project-specific configuration

After the shared files are merged:

1. Keep application code and tests in the project's existing layout, or update
   `vitest.config.ts`, `knip.jsonc`, and `.dependency-cruiser.json` together if
   the layout differs.
2. Declare the entry points a framework loads by convention. Next.js `app/` and
   `pages/`, SvelteKit `routes/` and Nuxt `pages/` are reached by a router
   rather than by an import, and three checks read that as a defect:
   - `knip.jsonc` reports them as unused files. Add the framework's entry
     patterns, or enable Knip's plugin for it. Ignoring the reported paths
     instead also stops the check finding genuinely dead files beside them.
   - `.dependency-cruiser.json` reports them as orphan modules. Add them to the
     `no-orphans` rule's `pathNot`.
   - `vitest.config.ts` sets `environment: 'node'`, which has no DOM. Component
     tests need `jsdom` or `happy-dom`, and the component file extensions added
     to `include`.

   `.jscpd.json` names `src` and `scripts` directly, so it measures nothing in
   a framework's source directory until that path is added.

3. Remove the template's placeholder `src/index.ts` and test only after the
   destination entrypoints and tests are covered by the new configuration.
4. Set Stryker's `mutate` scope to real production code. Do not claim a
   mutation score for files that are excluded from the scope without recording
   the reason. A `mutate` glob left over from the template's own layout
   (`src/**/*.ts`, `scripts/lib/**/*.ts`) or from a different source repository
   is the single most common adoption mistake: it either matches nothing, or
   matches the wrong tree entirely. `pnpm check:scope` catches the first case
   for every declared scope, not only Stryker's; it cannot catch the second,
   so confirm by eye that each scope points at code that exists and is the
   code meant to be measured.
5. Add the project's build, integration, E2E, or deployment checks only when
   the project has the application and commands those checks exercise. A
   framework's own build is one of these: it is the step that fails on a broken
   route or a bad server/client boundary, none of which `pnpm typecheck` sees.
6. Keep `AGENTS.md` limited to durable rules that tools cannot enforce. Put
   current procedures in the appropriate document routed from `docs/index.md`.
   Update `docs/architecture.md` where the destination contradicts it: it
   describes a repository with no application layers, web framework, cloud
   integration or build output, and left unedited it routes agents to a
   description of a project that no longer exists.

The steps above name the decisions without making them, because the answers
depend on the destination. For Next.js, where those decisions recur in the same
order every time, `.claude/skills/adopt-nextjs-quality-gate/` carries them as a
worked procedure.

## 5. Reconcile the declared GitHub settings

`infra/github/**` and `scripts/github-settings.ts` are marked `template-only` in
`infra/template-manifest.json`. They remain available for this template's own
repository, but `scripts/diff-upstream.sh` and an adoption must not copy or
compare them. This is intentional because the repository settings automation
is not generally usable for private repositories. Do not carry over the
`github:settings` package script, the `github-settings` CI job, or
`.github/workflows/github-settings.yml` either.

If a destination explicitly supports and wants this automation, adopt the
template-only group as a separate, deliberate decision and record that choice
in an ADR. The settings layer has four parts to reconcile:

1. `repository-settings.json` — `default_branch` and the merge behaviour must
   match the destination's actual repository, not the template's.
2. `rulesets/main.json` — the required status checks are named `check`,
   `mutation` and `github-settings`. If the merged workflow named those jobs
   differently, the ruleset must use the destination's names;
   `pnpm check:gate-contract` compares the ruleset against the workflow in
   both directions. The template requires no approving review by deliberate
   solo-repository policy (see
   [ADR 0008](decisions/0008-no-required-human-approval-solo-repo.md)); a
   destination with more than one maintainer decides that again rather than
   inheriting it.
3. `environments/production.json` — `reviewers` is empty in the template. Fill
   it in, or remove the environment when the destination deploys nothing.
4. `secrets-manifest.json` — declares `GH_ADMIN_TOKEN`. The secret has to
   exist in the destination with repository administration and secret-metadata
   read permissions, or the scheduled drift workflow fails on its first run.

```sh
pnpm github:settings                              # local validation, no credentials
node scripts/github-settings.ts --check --remote  # compare with the live repository
```

Applying is a separate, deliberate act, and only after the drift output has
been read; `infra/github/README.md` documents the opt-in. On a repository whose
plan does not support rulesets the tool skips them rather than failing, which
leaves a real gap in enforcement — record it when it happens.

## 6. Install and validate

Merge the dependency declarations first, then resolve the lockfile with the
repository's pinned toolchain:

```sh
mise trust
mise install
pnpm install
pnpm verify
pnpm test:mutation
git diff --check
```

Review the lockfile and dependency-policy output from `pnpm install`. Once the
dependency set is accepted, commit `pnpm-lock.yaml` and verify that a clean
install works without resolution:

```sh
pnpm install --frozen-lockfile
```

The standard gate is `pnpm verify`; the complete required gate also needs
`pnpm test:mutation`. A migration is not complete when only the fast checks
pass.

## 7. Prove the adoption is complete

A green gate is not evidence that the gate is whole: the checks that were never
copied cannot fail. Two commands answer the separate question of whether
anything is missing.

```sh
pnpm check:manifest
pnpm check:scope
scripts/diff-upstream.sh main
```

`check:manifest` fails when a path the manifest claims is absent, which is what
a truncated copy looks like from inside the destination. `check:scope` fails
when a scope inherited from the template or from another source
repository -- `stryker.config.json`'s `mutate`, Vitest's `coverage.include`,
jscpd's `path`, the directories `pnpm architecture` scans -- resolves to no
file in the destination; run it before `pnpm test:mutation` rather than
discovering the same mismatch as a Stryker failure at the end of the gate.
`diff-upstream.sh` reads the same manifest and shows the rest: a file reported
as deleted was never copied, and a difference nobody intended means the merge
in step 3 lost something.

Then confirm each check is aimed at real code rather than passing on an empty
scope — the coverage report lists the destination's modules, Knip reports its
entry points, and `pnpm duplication` reports a file count consistent with the
project's size.

`.claude/skills/adopt-node-starter/` carries this whole procedure as an
executable pass for an agent.

## 8. Protect the gate

Before merging the migration:

- require the `check`, `mutation` and `github-settings` jobs in branch
  protection for `main`, under the names the merged workflow actually uses;
- retain a protected-file notice for changes to the enforcement layer;
- retain existing deployment approvals and environment protection rules;
- document intentional deviations in `docs/decisions/`, including the reason,
  scope, and follow-up owner.

## 9. Maintain the adoption

After the first migration, compare shared files periodically, in a separate
pull request from ordinary application work:

```sh
TEMPLATE_REMOTE=https://github.com/shunmd/node-starter.git \
  scripts/diff-upstream.sh main
```

This reads two manifests, not one: the destination's own
`infra/template-manifest.json`, and the template's copy at `template/main`,
unioned together. The union matters because the destination's own manifest can
only list files that existed when it last adopted the template — a file the
template added afterwards is invisible to a diff that trusts only the local
list. Unioning in the upstream manifest's paths means a file neither side's
history alone would think to look for still shows up, labelled
`not present locally (upstream addition)`.

Two situations need more care than "adopt or reject the diff":

- A path whose ownership is `adopt` (under `scripts/`, excluding the
  `template-only` GitHub settings paths)
  should be copied wholesale with `git checkout template/main -- <path>`, not
  hand-merged; an `adopt`-owned file that was edited locally is a decision to
  record in `docs/decisions/`, not a diff to reconcile line by line.
- A raised threshold — coverage, mutation, or anything else the template
  tightens over time — should never be merged down to the template's new
  number if the destination is already stricter. The template sets a floor;
  taking the diff literally can pull a repository's own stricter setting back
  down to it.

Run `pnpm check:manifest` and `pnpm check:scope` before the full gate: they
are the two checks most likely to fail right after adopting an upstream
change, and cheaper to read here than as a `pnpm test:mutation` failure or,
worse, a silently empty jscpd or coverage scope that does not fail at all.
Then run both required gates, and record rejected changes when the reason is
durable. There is no automatic sync because application repositories are
expected to diverge from the template.

`.claude/skills/upgrade-node-starter/` carries this whole procedure as an
executable pass for an agent, including the two failure modes above.

## Completion checklist

- [ ] Existing baseline and migration branch are recorded.
- [ ] `infra/template-manifest.json` is present and `pnpm check:manifest`
      passes.
- [ ] Every `adopt` path is present and unmodified; `template-only` GitHub
      settings paths are intentionally absent.
- [ ] Toolchain, package manager, and dependency policy are intentional.
- [ ] All quality tools point at the destination project's real source and test
      layout, and `pnpm check:scope` passes.
- [ ] Convention-loaded entry points are declared to Knip and
      dependency-cruiser rather than ignored.
- [ ] Existing CI and deployment jobs remain intact.
- [ ] `docs/architecture.md` describes the destination's actual shape.
- [ ] `pnpm verify` passes.
- [ ] `pnpm test:mutation` passes with the configured scope.
- [ ] `pnpm install --frozen-lockfile` passes on a clean dependency state.
- [ ] `node scripts/github-settings.ts --check --remote` runs against the
      destination and its output has been read.
- [ ] `GH_ADMIN_TOKEN` exists in the destination, or its absence is recorded.
- [ ] `scripts/diff-upstream.sh main` shows only intended differences.
- [ ] Branch protection requires `check`, `mutation` and `github-settings`.
- [ ] Intentional deviations are recorded in an ADR.
