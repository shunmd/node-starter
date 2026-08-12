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

Before the helper exists in the destination repository, compare the template
surface directly. Add a remote only if the name is not already in use, then
inspect the differences without applying them:

```sh
TEMPLATE_REMOTE=https://github.com/shunmd/node-starter.git
git remote get-url template >/dev/null 2>&1 || \
  git remote add template "${TEMPLATE_REMOTE}"
git fetch --quiet template main
git diff --name-status HEAD template/main -- \
  mise.toml pnpm-workspace.yaml tsconfig.json eslint.config.js \
  prettier.config.js vitest.config.ts stryker.config.json knip.jsonc \
  .dependency-cruiser.json .jscpd.json .editorconfig .gitattributes .prettierignore \
  .github/workflows/ci.yml scripts/check-toolchain-age.ts \
  scripts/secret-scan.sh AGENTS.md
```

Exit status 1 means that differences were found; it is an inventory result, not
an automatic migration failure. After the helper is adopted, use
`scripts/diff-upstream.sh` for the same review loop. Neither path synchronizes
files automatically; review each difference before adopting it.

## 3. Merge by ownership

Use the following order. Keep one clear source of truth for every setting.

| Area              | Adopt or merge                                                                                     | Destination-specific decision                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Toolchain         | `mise.toml`, `mise.lock`, `pnpm-workspace.yaml`                                                    | Whether the project can move to the pinned Node and pnpm versions              |
| Package metadata  | `package.json`, `pnpm-lock.yaml`                                                                   | Project name, runtime dependencies, scripts, package publication settings      |
| Type and style    | `tsconfig.json`, `eslint.config.js`, `prettier.config.js`, `.prettierignore`                       | Existing compiler options and generated-file boundaries                        |
| Tests and quality | `vitest.config.ts`, `stryker.config.json`, `knip.jsonc`, `.dependency-cruiser.json`, `.jscpd.json` | Test roots, application entrypoints, mutation scope, and dependency boundaries |
| Security and CI   | `scripts/secret-scan.sh`, `.github/workflows/ci.yml`                                               | Existing deployment, release, preview, and environment-specific jobs           |
| Agent context     | `AGENTS.md`, `CLAUDE.md`, `docs/index.md`                                                          | Durable project rules and documentation ownership                              |

Do not replace an existing workflow wholesale. Merge the `check` and required
`mutation` jobs into the current workflow, preserving deployment and release
jobs. The protected-file notice should also cover every setting that can weaken
the checks, while remaining informational rather than blocking.

## 4. Resolve project-specific configuration

After the shared files are merged:

1. Keep application code and tests in the project's existing layout, or update
   `vitest.config.ts`, `knip.jsonc`, and `.dependency-cruiser.json` together if
   the layout differs.
2. Remove the template's placeholder `src/index.ts` and test only after the
   destination entrypoints and tests are covered by the new configuration.
3. Set Stryker's `mutate` scope to real production code. Do not claim a
   mutation score for files that are excluded from the scope without recording
   the reason.
4. Add the project's build, integration, E2E, or deployment checks only when
   the project has the application and commands those checks exercise.
5. Keep `AGENTS.md` limited to durable rules that tools cannot enforce. Put
   current procedures in the appropriate document routed from `docs/index.md`.

## 5. Install and validate

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

## 6. Protect the gate

Before merging the migration:

- require the `check` and `mutation` jobs in branch protection for `main`;
- retain a protected-file notice for changes to the enforcement layer;
- retain existing deployment approvals and environment protection rules;
- document intentional deviations in `docs/decisions/`, including the reason,
  scope, and follow-up owner.

## 7. Maintain the adoption

After the first migration, compare shared files periodically:

```sh
TEMPLATE_REMOTE=https://github.com/shunmd/node-starter.git \
  scripts/diff-upstream.sh main
```

Adopt changes in a separate pull request, run both required gates, and record
rejected changes when the reason is durable. There is no automatic sync because
application repositories are expected to diverge from the template.

## Completion checklist

- [ ] Existing baseline and migration branch are recorded.
- [ ] Toolchain, package manager, and dependency policy are intentional.
- [ ] All quality tools point at the destination project's real source and test
      layout.
- [ ] Existing CI and deployment jobs remain intact.
- [ ] `pnpm verify` passes.
- [ ] `pnpm test:mutation` passes with the configured scope.
- [ ] `pnpm install --frozen-lockfile` passes on a clean dependency state.
- [ ] Branch protection requires `check` and `mutation`.
- [ ] Intentional deviations are recorded in an ADR.
