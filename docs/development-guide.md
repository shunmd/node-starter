# Development guide

Procedures for humans. The startup navigation for agents lives in `AGENTS.md`;
rules for code live in the tool configs. This file covers recurring tasks and
the enforcement-layer boundary where knowing the procedure is most of the work.

## Daily loop

```sh
pnpm fix             # format + autofixable lint
pnpm verify          # standard gate; same command as the CI check job
pnpm test:mutation   # required mutation gate; same command as the CI mutation job
```

`pnpm verify` runs `check:toolchain`, `format:check`, `lint`, `typecheck`,
`deadcode`, `architecture`, `secret:scan` and `test:coverage` in that order,
stopping at the first failure. `pnpm check` is a compatibility alias. Individual
steps exist as separate scripts when you want a faster loop.

There is intentionally no `ci` script. CI runs `pnpm verify` and
`pnpm test:mutation` as separate required jobs, so each job uses the same command
developers run locally.

The policy behind the gate is in
[`docs/code-quality-gate.md`](code-quality-gate.md). It distinguishes the
standard application gate from checks that this unconfigured Node template
cannot execute yet.

## Static analysis and security checks

The fast gate includes four checks beyond formatting, linting and types:

- `pnpm deadcode` runs Knip for unused files, dependencies, exports and exported
  types. The entry points are explicit in `knip.jsonc`; do not add ignores just
  to make a report green.
- `pnpm architecture` runs dependency-cruiser. It rejects cycles, unresolved
  imports and imports from production code into tests. No layer rule is added
  because this template has no application architecture yet.
- `pnpm lint` also runs selected `eslint-plugin-sonarjs` rules for cognitive
  complexity and structural duplication. This is local ESLint analysis, not a
  SonarQube server or a severity-ranked changed-code report.
- `pnpm secret:scan` runs Gitleaks. With staged changes it scans the staged diff;
  otherwise it scans the working tree. Do not store credentials or add broad
  allowlists.
- `pnpm test:coverage` keeps a starting floor of 80% for lines, functions,
  branches and statements. Increase it when the generated project has measured
  business logic; do not add meaningless tests to satisfy a number.
- `pnpm test:mutation` runs StrykerJS separately from `pnpm verify`. It requires
  a mutation score of at least 80% and fails below 80%.

Mutation testing is intentionally a separate, heavy check and is not part of
`pnpm verify`. StrykerJS is configured with the Vitest runner. Its Babel
instrumenter chain requires the exact `trustPolicyExclude` entry for
`semver@6.3.1`; this is a documented, human-approved supply-chain exception.
The exception must be removed when the upstream dependency chain no longer
requires that version or its trust evidence is repaired.

This is a Node template rather than a web application, so Playwright is not
installed. A generated web application should add it only after it has an
application start command and a critical user flow to exercise.

## Local static analysis

SonarQube is intentionally not used. The repository uses `pnpm lint`, which
includes selected `eslint-plugin-sonarjs` rules for cognitive complexity and
structural duplication. It does not provide SonarQube's severity classification
or changed-code duplication percentage.

## AI-assisted change loop

Agents are useful implementation tools, not authorities on whether a change is
correct or safe. Keep each change bounded and make the decision points visible:

1. Write the intent, acceptance criteria, constraints and expected tests.
2. Give the agent one small task and one isolated branch. Keep the task's scope
   and acceptance criteria stable while it is being implemented.
3. Have the agent inspect the existing code, state a plan, implement the change,
   update tests and run `pnpm verify`.
4. Review the diff against the acceptance criteria and architecture. A separate
   review agent can provide another signal, but an agent review does not replace
   CI or human judgment.
5. Merge only after the required CI checks pass. The agent's completion message
   is not evidence that the gate passed.
6. For an application with a deployment pipeline, run staging smoke or E2E
   checks before production and keep production approval with a human.

The review depth follows risk. Always involve a human for authentication,
authorization, database migrations, payments, secrets, IAM and production
infrastructure. For low-risk changes, keep the same task, branch and CI
boundaries while using a proportionate review.

This template currently provides the standard local/CI gate (`pnpm verify`) and
the required separate Mutation gate (`pnpm test:mutation`), but does not provide
an issue tracker, staging environment, E2E suite or deployment workflow. A
generated application must document and enforce those parts itself.
The rationale and the boundary between reusable principles and project-specific
steps are recorded in [ADR 5](decisions/0005-bounded-ai-assisted-development.md).

## Protected enforcement layer

The following paths define how quality is enforced and require explicit human
approval for pull requests that change them:

```text
eslint.config.js
package.json
tsconfig.json
prettier.config.js
.prettierignore
vitest.config.ts
stryker.config.json
knip.jsonc
.dependency-cruiser.json
mise.toml
mise.lock
pnpm-workspace.yaml
.github/workflows/
scripts/check-toolchain-age.ts
scripts/secret-scan.sh
scripts/github-settings.ts
infra/github/
```

The `guard-enforcement-layer` CI job checks these paths. Approval is expressed
by the `toolchain` label or `TOOLCHAIN-CHANGE-APPROVED` in the pull request
title. Proposed improvements belong in
[`docs/ai/improvement-backlog.md`](ai/improvement-backlog.md) until a human
applies them. This boundary prevents ordinary changes from silently weakening
their own checks.

GitHub repository settings have a separate declarative source of truth under
`infra/github/`. Validate it with `node scripts/github-settings.ts --check`;
compare it with the live repository using `node scripts/github-settings.ts
--check --remote`. Applying the settings
is a protected `workflow_dispatch` operation on `main` or an explicitly opted-in
local command. For local application, use the authenticated GitHub CLI token:

```sh
ALLOW_GITHUB_SETTINGS_APPLY=1 \
GH_TOKEN="$(gh auth token)" \
node scripts/github-settings.ts --apply
```

The token must have the repository administration and secret metadata read
permissions required by the GitHub API. The script never manages secret values.

## Adding a dependency

```sh
pnpm add -D some-package
```

Expect this to fail if the newest matching version is less than 5 days old, and
expect that to be correct behaviour rather than a bug. pnpm will resolve to the
newest version that has cooled down; if the range can only be satisfied by an
immature version, the install aborts.

If you genuinely need a version younger than 5 days — realistically, only for a
security fix — add the exact version to `minimumReleaseAgeExclude` in
`pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - 'some-package@1.2.3'
```

Use `name@version`, never a bare `name`: a bare name exempts that package
forever, including from every future compromise. Remove the entry once the
version has matured.

If a dependency needs to run an install script, add it to `allowBuilds`:

```yaml
allowBuilds:
  esbuild: true
```

Both of these are decisions, not configuration chores. Note why in the commit
message.

## Updating the toolchain

Node and pnpm are pinned to exact patch versions in `mise.toml`, mirrored in
`package.json` under `devEngines`, and checksummed in `mise.lock`. All three
must agree, and the version must have been public for at least 5 days;
`pnpm check:toolchain` fails otherwise.

To bump pnpm:

1. Pick a version at least 5 days old. Check the publish date:
   ```sh
   npm view pnpm time --json | tail -20
   ```
2. Update `mise.toml` (`[tools] pnpm`) and `package.json`
   (`devEngines.packageManager.version`) to the same value.
3. `mise install && mise lock` to refresh `mise.lock`.
4. `pnpm check` — `check:toolchain` verifies the age and that the pins agree.
5. Open the pull request with `TOOLCHAIN-CHANGE-APPROVED` in the title, or the
   `toolchain` label. Without it, `guard-enforcement-layer` fails the build.
   Adding either afterwards is fine — the workflow listens for `edited` and
   `labeled` as well, so the check re-runs without needing a new commit.

Bumping Node is the same, using `nodejs.org/dist/index.json` for the release
date, and updating `engines.node` and `devEngines.runtime.version` as well.
Stay on the Active LTS line unless there is a reason not to.

## Updating dependencies

There is no update bot in this template. Run updates deliberately:

```sh
pnpm outdated        # what has moved
pnpm update --latest # interactive-ish; review the diff before committing
pnpm check
```

The 5-day cooldown applies here too, which is the point: routine batch updates
never pick up a package published in the last few days.

`pnpm audit` is available but is not part of `pnpm check`. Advisory databases
change without your code changing, so an audit failure would make CI red for
reasons unrelated to the commit under test. Run it on a schedule you control.

## Building and publishing

This template does not build, because a generic template cannot know what the
output should be. `tsconfig.json` sets `noEmit: true` and `pnpm typecheck` only
checks types.

When the project needs a build, add a `tsconfig.build.json` that extends the
base config, narrows `include` to `src`, and turns off `noEmit`:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"],
}
```

and a `"build": "tsc -p tsconfig.build.json"` script. Add `build` to `check`
only if a broken build should block every commit — usually it should.

## Comparing against the template

For the initial migration into an existing repository, use the
[`docs/adoption-guide.md`](adoption-guide.md). This section covers the later
comparison loop after adoption.

```sh
scripts/diff-upstream.sh
```

Shows how this project's shared config differs from the template it came from.
Nothing syncs automatically; adopt what you want, and record what you
deliberately rejected in `docs/decisions/`.

## TypeScript version

TypeScript is pinned to the 6.0.x line (`~6.0.3`), not 7.x. This is not
conservatism for its own sake — typescript-eslint declares
`typescript: ">=4.8.4 <6.1.0"`, and every type-aware lint rule in this repo
depends on it. See `docs/decisions/0002-typescript-6-for-type-aware-lint.md` for
the revisit condition.
