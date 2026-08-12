#!/usr/bin/env bash

set -euo pipefail

# Secret scanning has two jobs, and the working tree only answers the first.
#
#   1. Is a credential present right now?  -> scan the files on disk.
#   2. Was a credential ever committed?    -> scan the commit history.
#
# The second matters more. A key that was pushed and then deleted in the next
# commit is still a leaked key: it is in the objects, in every clone, and in
# GitHub's API. Deleting the line does not rotate the credential, and a human
# reading the pull request diff sees only the deletion.
#
# CI checks out with fetch-depth: 0 so the history scan has something to read.
# In a shallow clone the history scan is skipped loudly rather than silently
# reporting success on the two commits it happens to have.

echo "Scanning the working tree..."
gitleaks dir --no-banner --redact .

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository; skipping the history scan."
  exit 0
fi

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo
  echo "error: this clone is shallow, so the commit history cannot be scanned." >&2
  echo "Run 'git fetch --unshallow', or set fetch-depth: 0 on the checkout step." >&2
  exit 1
fi

echo "Scanning the commit history..."
gitleaks git --no-banner --redact .
