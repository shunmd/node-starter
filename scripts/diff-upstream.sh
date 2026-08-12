#!/usr/bin/env bash
# Shows what this project's shared configuration looks like compared with the
# template it was generated from.
#
# There is deliberately no automatic sync. A project diverges from its template
# for good reasons, and a bot that keeps "fixing" that produces noise nobody
# reads. This script gives you the diff; you decide, file by file.
#
# Usage:
#   scripts/diff-upstream.sh                 # diff against the template's default branch
#   scripts/diff-upstream.sh <git-ref>       # diff against a specific tag or commit
#
# Set TEMPLATE_REMOTE to your own template URL after generating a project.

set -euo pipefail

TEMPLATE_REMOTE="${TEMPLATE_REMOTE:-https://github.com/shunmd/node-starter.git}"
REF="${1:-main}"

# Files the template owns. Application code is never compared.
TRACKED_PATHS=(
  mise.toml
  pnpm-workspace.yaml
  tsconfig.json
  eslint.config.js
  prettier.config.js
  vitest.config.ts
  .editorconfig
  .gitattributes
  .prettierignore
  .github/workflows/ci.yml
  scripts/check-toolchain-age.ts
  AGENTS.md
)

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

if ! git remote get-url template >/dev/null 2>&1; then
  echo "Adding 'template' remote -> ${TEMPLATE_REMOTE}"
  git remote add template "${TEMPLATE_REMOTE}"
fi

git fetch --quiet template "${REF}"

echo "Comparing against template/${REF}"
echo

status=0
for file in "${TRACKED_PATHS[@]}"; do
  if ! git cat-file -e "FETCH_HEAD:${file}" 2>/dev/null; then
    echo "--- ${file}: not present upstream (local addition)"
    continue
  fi
  if ! git diff --quiet FETCH_HEAD -- "${file}" 2>/dev/null; then
    echo "=== ${file}"
    git --no-pager diff FETCH_HEAD -- "${file}"
    echo
    status=1
  fi
done

if [ "${status}" -eq 0 ]; then
  echo "No differences in template-owned files."
else
  echo "Review the diffs above. Anything you adopt should be committed like any"
  echo "other change; anything you reject is worth a note in docs/decisions/."
fi
