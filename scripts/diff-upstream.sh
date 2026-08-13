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

# The files the template owns come from infra/template-manifest.json, which
# `pnpm check:manifest` keeps in step with the repository. This script used to
# carry its own copy of the list; the copy went stale, and every adoption made
# from it silently omitted the files that had been added since.
#
# Paths whose ownership is "project" are excluded by --list: the owners in
# CODEOWNERS and the accepted exceptions in infra/policy/dependency-policy.json
# are your decisions, so a diff against the template's copy would only be noise.

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFEST="${REPO_ROOT}/infra/template-manifest.json"

if [ ! -f "${MANIFEST}" ]; then
  echo "error: ${MANIFEST} not found; this repository has not adopted the template inventory" >&2
  exit 1
fi

if ! git remote get-url template >/dev/null 2>&1; then
  echo "Adding 'template' remote -> ${TEMPLATE_REMOTE}"
  git remote add template "${TEMPLATE_REMOTE}"
fi

git fetch --quiet template "${REF}"

echo "Comparing against template/${REF}"
echo

# The local manifest alone is not enough: a repository that adopted an older
# template version has a manifest that predates any file the template added
# since, so that file would never appear as missing -- the exact gap this
# script exists to close. Union in the upstream manifest's own list so a file
# neither side's history agrees to look for still surfaces here.
UPSTREAM_MANIFEST="$(mktemp)"
trap 'rm -f "${UPSTREAM_MANIFEST}"' EXIT
UPSTREAM_PATHS=""
if git cat-file -e "FETCH_HEAD:infra/template-manifest.json" 2>/dev/null; then
  git show "FETCH_HEAD:infra/template-manifest.json" >"${UPSTREAM_MANIFEST}"
  UPSTREAM_PATHS="$(node "${REPO_ROOT}/scripts/check-template-manifest.ts" --list --manifest "${UPSTREAM_MANIFEST}")"
fi
LOCAL_PATHS="$(node "${REPO_ROOT}/scripts/check-template-manifest.ts" --list)"

TRACKED_PATHS=()
while IFS= read -r line; do
  [ -n "${line}" ] && TRACKED_PATHS+=("${line}")
done < <(printf '%s\n%s\n' "${LOCAL_PATHS}" "${UPSTREAM_PATHS}" | sort -u)

status=0
for file in "${TRACKED_PATHS[@]}"; do
  # A manifest entry ending in / covers a whole directory, so presence is
  # tested with ls-tree rather than cat-file, which only resolves blobs.
  if [ -z "$(git ls-tree -r --name-only FETCH_HEAD -- "${file%/}" 2>/dev/null)" ]; then
    echo "--- ${file}: not present upstream (local addition)"
    continue
  fi
  # A path the union above found only in the upstream manifest -- the case an
  # older adoption's own manifest could never have listed -- and that the
  # working tree does not have at all is called out on its own, rather than
  # left to show up as an unlabeled full-file deletion in the diff below.
  if [ ! -e "${REPO_ROOT}/${file%/}" ]; then
    echo "+++ ${file}: not present locally (upstream addition) -- copy it from the template"
    status=1
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

exit "${status}"
