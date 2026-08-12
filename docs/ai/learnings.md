# Learnings

Facts about this codebase that were not obvious, discovered while working in it.
Agents append here freely; no human approval needed.

**Format:** `YYYY-MM-DD — one-line claim`, then a short paragraph if the claim
needs support. Newest first.

**Pruning is part of the job.** When an entry stops being true, delete it in the
same change that makes it untrue. A learnings file that only grows stops being
read, and an unread file is worse than no file — it looks like documentation
while functioning as clutter. If this file passes roughly 50 entries, that is a
signal that several of them belong in `docs/architecture.md` or an ADR instead.

---

2026-08-12 — `pnpm install` failing with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
is the policy working, not a broken environment.

The repository requires npm packages to be at least 5 days old. Do not fix this
by lowering `minimumReleaseAge`, adding a bare package name to
`minimumReleaseAgeExclude`, or passing `--no-save`. See
`docs/development-guide.md#adding-a-dependency` for the supported escape hatch.
