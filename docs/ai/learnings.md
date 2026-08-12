# Learnings

Facts about this codebase that were not obvious, discovered while working in it.
Use this file only as a temporary maintenance queue; it is not authoritative
and it is not an append-only archive.

**Format:** `YYYY-MM-DD — one-line claim`, then a short paragraph if the claim
needs support. Newest first.

**Pruning is part of the job.** Save a discovery only when it is likely to help
another task. When an entry stops being true, delete it in the same change that
makes it untrue. Promote durable current facts to their owning document and
historical rationale to an ADR. If this file passes roughly 50 entries, prune
or promote it before adding more.

---

2026-08-12 — `pnpm install` failing with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
is the policy working, not a broken environment.

The repository requires npm packages to be at least 5 days old. Do not fix this
by lowering `minimumReleaseAge`, adding a bare package name to
`minimumReleaseAgeExclude`, or passing `--no-save`. See
`docs/development-guide.md#adding-a-dependency` for the supported escape hatch.
