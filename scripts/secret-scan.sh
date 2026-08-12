#!/usr/bin/env bash

set -euo pipefail

# Scan staged content when called from a commit workflow. In CI and an ordinary
# working tree there is no index diff, so scan the files that are present.
if git diff --cached --quiet; then
  gitleaks dir --no-banner --redact .
else
  git diff --cached --binary | gitleaks stdin --no-banner --redact
fi
