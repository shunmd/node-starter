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

`pnpm verify` runs `check:toolchain`, `check:workflows`, `check:gate-contract`,
`check:manifest`, `check:scope`, `format:check`, `lint`, `typecheck`, `deadcode`, `architecture`, `duplication`,
`secret:scan`, `check:deps` and `test:coverage` in that order, stopping at the
first failure. `pnpm check` is a compatibility alias. Individual steps exist as
separate scripts when you want a faster loop.

### Targeted validation during edits

Do not run the repository-wide gate after every small edit. For changed source
or script files, use the smallest applicable checks first:

```sh
pnpm exec prettier --check path/to/changed-file.ts
pnpm exec eslint path/to/changed-file.ts
pnpm typecheck
pnpm test -- --changed
git diff --check
```

Pass all formatter-supported changed files to Prettier and all lintable changed
files to ESLint when more than one file is in scope. Use `git diff --check` for
files such as `.gitignore` and `.prettierignore` that have no Prettier parser.
These checks shorten the edit loop; they do not replace the final `pnpm verify`.
Changes to quality, toolchain, workflow or dependency policy files require the
full gate because targeted checks cannot cover their policy impact.

There is intentionally no `ci` script. CI runs `pnpm verify` and
`pnpm test:mutation` as separate required jobs. Pull requests pass changed
production files to Stryker; a pull request with no changed production files
exits successfully without running mutation testing. Pushes to `main` and
scheduled runs use the complete mutation scope.

The policy behind the gate is in
[`docs/code-quality-gate.md`](code-quality-gate.md). It distinguishes the
standard application gate from checks that this unconfigured Node template
cannot execute yet.

## Static analysis and security checks

The fast gate includes these checks beyond formatting, linting and types:

- `pnpm deadcode` runs Knip for unused files, dependencies, exports and exported
  types. The entry points are explicit in `knip.jsonc`; do not add ignores just
  to make a report green.
- `pnpm architecture` runs dependency-cruiser. It rejects cycles, unresolved
  imports and imports from production code into tests. No layer rule is added
  because this template has no application architecture yet.
- `pnpm duplication` runs jscpd against `src` and `scripts`. It limits
  repository-wide duplicated lines to 2%; it is not a changed-lines metric.
- `pnpm lint` also runs selected `eslint-plugin-sonarjs` rules for cognitive
  complexity and structural duplication. This is local ESLint analysis, not a
  SonarQube server or a severity-ranked changed-code report.
- `pnpm secret:scan` runs Gitleaks twice: over the working tree, and over the
  commit history. The second one is the one that matters -- deleting a committed
  credential does not rotate it, and the key stays in every clone. It needs a
  full clone, so it fails loudly in a shallow one rather than passing on the few
  commits it can see. Do not store credentials or add broad allowlists.
- `pnpm check:workflows` treats `.github/workflows/**` as reviewable code:
  actions pinned to a commit sha, a timeout on each ordinary job, top-level
  `permissions`, no `pull_request_target`, no `${{ }}` expression interpolated
  into a `run:` block, and `persist-credentials: false` on every checkout.
  External reusable workflows must also use a full commit sha; local reusable
  workflows are checked when they live under `.github/workflows/`. OIDC is
  allowed only as a job-scoped `id-token: write` permission.
- `pnpm check:gate-contract` reads `package.json`, `vitest.config.ts`,
  `stryker.config.json`, `eslint.config.js`, `.dependency-cruiser.json`,
  `.github/workflows/ci.yml` and `infra/github/rulesets/main.json` and fails if
  their _declared_ shape no longer matches this document: a missing required
  script, a coverage or mutation threshold below the configured floor, `src/` or `scripts/lib/`
  dropped from coverage or mutation scope, a required lint rule downgraded from
  `error`, a dependency-cruiser rule removed or downgraded, a required CI job
  missing, disabled, or exempted with `continue-on-error: true`, or a mismatch
  between the ruleset's required status checks and the CI job names. It checks
  configuration shape, not runtime behaviour -- see
  `scripts/lib/gate-contract.ts` for what that does and does not prove.
- `pnpm check:manifest` compares `infra/template-manifest.json` with the files
  the repository tracks, in both directions: a file below one of the declared
  roots that no group lists, and a listed path that matches nothing. The
  manifest is what `scripts/diff-upstream.sh` and the adoption procedure read,
  so a stale entry means the next repository to adopt the template silently
  goes without that file. Adding a script under `scripts/`, a settings file
  under `infra/github/`, or a workflow means adding it here too.
- `pnpm check:scope` resolves every scope declared for the quality tools --
  Stryker's `mutate`, Vitest's `include` and `coverage.include`, jscpd's
  `path`, and the directories `pnpm architecture` scans -- against the
  repository's actual files, and fails if any of them matches nothing. This is
  what an adoption most often gets wrong: a scope merged from another
  repository's layout (`src/application/**/*.ts` in a project whose source is
  `src/**/*.ts`) either stops Stryker outright or, for jscpd and coverage,
  silently reports success over an empty set. See
  `scripts/lib/scope-contract.ts`.
- `pnpm check:deps` fails on any `pnpm audit` advisory and on any licence
  outside the allow list in `infra/policy/dependency-policy.json`. See
  "Accepting a dependency exception" below.
- `pnpm test:coverage` keeps a floor of 95% for lines, functions, branches and
  statements, applied **per file** rather than across the repository, over
  `src/**` and `scripts/lib/**`. Increase it when the generated project has
  measured business logic; do not add meaningless tests to satisfy a number.
- `pnpm test:mutation` runs StrykerJS separately from `pnpm verify`. It requires
  a mutation score of at least 95% and fails below 95%. Stryker stores an
  incremental report under `reports/`; CI caches that report between commits,
  so unchanged mutants are reused while a cache miss still performs a full
  mutation run.

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
or changed-code duplication percentage. Nor does anything here do
interprocedural taint analysis; the proposal to add CodeQL for that is in
[`docs/ai/improvement-backlog.md`](ai/improvement-backlog.md).

Shell scripts under `scripts/` have no static analysis at all. ESLint does not
read shell and ShellCheck is not in the pinned toolchain. Same backlog.

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

The following paths define how quality is enforced and deserve focused review
when a pull request changes them:

```text
eslint.config.js
package.json
pnpm-lock.yaml
tsconfig.json
prettier.config.js
.prettierignore
vitest.config.ts
stryker.config.json
knip.jsonc
.dependency-cruiser.json
.jscpd.json
mise.toml
mise.lock
pnpm-workspace.yaml
.github/
infra/
scripts/
.editorconfig
.gitattributes
AGENTS.md
CLAUDE.md
.claude/
```

The `protected-file-notice` CI job reports these paths in an informational pull
request comment. It does not block merging or require a title marker or label.
The `check`, `mutation` and `github-settings` jobs remain the required quality
gates. Proposed
changes to the enforcement layer belong in
[`docs/ai/improvement-backlog.md`](ai/improvement-backlog.md) until a human
reviews and applies them. This notice makes changes visible without turning
metadata-only updates into blocked builds. The comment is best effort: a
read-only token on a fork pull request can prevent it from being posted, and
that permission failure remains a warning.

`src/` and `docs/` are deliberately absent from CODEOWNERS. Changes there are
judged by the checks, which is the point of the whole arrangement.

GitHub repository settings have a separate declarative source of truth under
`infra/github/`. The `main` ruleset requires no approving review and grants
no bypass actor -- a deliberate solo-repository policy explained in
[ADR 0008](decisions/0008-no-required-human-approval-solo-repo.md), including
when a generated project should turn that back on. `github-settings` is
itself a required CI status check (`.github/workflows/ci.yml`), so a
regression in that policy fails before it reaches GitHub. Validate the
declared state with `node scripts/github-settings.ts --check`; compare it
with the live repository using `node scripts/github-settings.ts
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

`pnpm check:deps` then applies two further gates to whatever you added,
including its transitive graph: no `pnpm audit` advisory, and no licence outside
the allow list. Both are worth checking before you get attached to a package:

```sh
pnpm check:deps
```

`package.json` and `pnpm-lock.yaml` are protected paths. The
`protected-file-notice` comment makes such changes visible, while CODEOWNERS
retains ownership metadata for projects that choose to enable code-owner
review. The template's ruleset requires no title marker, label, or approval.
That is deliberate -- a new dependency is a supply-chain change, whoever wrote
the diff, but solo development must remain mergeable.

## Accepting a dependency exception

Sometimes the right answer is to ship with a known finding: the advisory is not
reachable from your code, or the licence is fine for a build-time tool. Record
it in `infra/policy/dependency-policy.json` rather than lowering a threshold.

```json
{
  "advisory": "GHSA-xxxx-xxxx-xxxx",
  "package": "some-package",
  "paths": [".>parent-package>some-package"],
  "reason": "Reached only through <path>, which never receives untrusted input. No patched release exists yet.",
  "owner": "who decided this",
  "reviewBy": "2026-11-30"
}
```

Four properties are enforced by the check itself, not by convention:

- The exception names the **exact** finding. An advisory exception matches one
  advisory id, one package name, and the explicitly reviewed dependency paths;
  a licence exception matches one package and one licence. Nothing is exempted
  in general. If a new path reaches the vulnerable package, the exception fails
  closed until the path is reviewed and added.
- `reason` and `owner` are required. An exception with no stated reason fails to
  parse.
- `reviewBy` is required for advisories. Past that date the exception stops
  suppressing and starts failing, so an accepted risk gets revisited instead of
  becoming permanent.
- An exception that no longer matches anything **fails**. Approvals for solved
  problems cannot accumulate in the file.

Licence exceptions have no expiry, because a package's licence does not drift
quietly: the exception pins the licence too, so a change to it fails the check.

`infra/policy/` is in CODEOWNERS. Accepting a known vulnerability is not a
decision a machine makes alone.

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
5. Open the pull request and review the protected-file notice if one appears.
   The notice is informational; the required `check`, `mutation` and
   `github-settings` jobs still need to pass.

Bumping Node is the same, using `nodejs.org/dist/index.json` for the release
date, and updating `engines.node` and `devEngines.runtime.version` as well.
Stay on the Active LTS line unless there is a reason not to.

## Updating dependencies

Dependabot proposes updates weekly for npm packages and GitHub Actions, grouped
into one pull request per ecosystem rather than one per package. Its cooldown is
set to the same 5 days as pnpm's, so it does not propose versions that
`pnpm install` is then required to refuse. Nothing merges itself: every proposal
still has to pass `pnpm verify` and the mutation job. The template does not
require an approving review.

To update by hand:

```sh
pnpm outdated        # what has moved
pnpm update --latest # review the diff before committing
pnpm check
```

The 5-day cooldown applies here too, which is the point: routine batch updates
never pick up a package published in the last few days.

`pnpm audit` **is** part of `pnpm check`, via `pnpm check:deps`. This is a
deliberate reversal of the earlier position that an advisory database changing
without your code changing would make CI red for unrelated reasons. It does, and
that is the correct outcome: a newly published advisory means the dependency
graph you already merged is now known to be vulnerable, and the CI workflow
runs the standard gate daily as well as on pushes and pull requests. The escape
hatch is a recorded exception with reviewed dependency paths and a re-evaluation
date, not a permanently ignored advisory.

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
comparison loop after adoption; the full periodic-upgrade procedure is
`docs/adoption-guide.md` §9, or `.claude/skills/upgrade-node-starter/` for an
agent to run end to end.

```sh
scripts/diff-upstream.sh
```

Shows how this project's shared config differs from the template it came from.
The file list comes from `infra/template-manifest.json` unioned with the
upstream template's own copy, not from a list kept by hand — the union matters
because a repository's manifest can only list files that existed at its own
adoption; without it, a file the template added afterwards would be invisible
to a diff that trusted only the local list. Nothing syncs automatically; adopt
what you want, and record what you deliberately rejected in
`docs/decisions/`.

## TypeScript version

TypeScript is pinned to the 6.0.x line (`~6.0.3`), not 7.x. This is not
conservatism for its own sake — typescript-eslint declares
`typescript: ">=4.8.4 <6.1.0"`, and every type-aware lint rule in this repo
depends on it. See `docs/decisions/0002-typescript-6-for-type-aware-lint.md` for
the revisit condition.
