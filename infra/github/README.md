# GitHub infrastructure

The JSON files in this directory are the desired state for repository-level
GitHub settings. `scripts/github-settings.ts` validates the files and can
compare or apply the settings through the GitHub REST API.

```sh
node scripts/github-settings.ts --check
node scripts/github-settings.ts --check --remote
```

`check` is local and does not need credentials. `drift` reads the repository
from `GITHUB_REPOSITORY` or the `origin` remote and compares managed settings,
rulesets, environments, and required secret names with GitHub. Secret values
are never read or written.

Mutation is deliberately restricted to an explicit local opt-in or the
protected `workflow_dispatch` run on `main`:

```sh
ALLOW_GITHUB_SETTINGS_APPLY=1 node scripts/github-settings.ts --apply
```

The required `GH_ADMIN_TOKEN` secret is used by drift checks and the apply
workflow. It must have the repository administration and secret metadata read
permissions required by the GitHub API. The `production` reviewer list is
empty until concrete GitHub user or team IDs are selected; no reviewer is
inferred from a repository login.

The script manages only named rulesets and environments. It does not delete
unmanaged GitHub settings, rulesets, environments, or secrets.
