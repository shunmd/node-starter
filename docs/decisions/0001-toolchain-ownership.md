# 1. mise owns the toolchain; Corepack is not used

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Something has to decide which `node` and which `pnpm` run. Three mechanisms
compete for the job, and using more than one produces a repository where the
answer depends on how you invoked the command:

- **Corepack** — the historical answer, driven by the `packageManager` field.
- **`devEngines.packageManager` in package.json** — pnpm 11's own replacement
  for `packageManager`; pnpm downloads and switches to the declared version
  itself, controlled by the `pmOnFail` setting.
- **mise** — installs pinned versions of both Node and pnpm from `mise.toml`.

Corepack is a dead end: the Node.js TSC voted to stop distributing it, and it is
absent from Node 25 and later. Building a template on it in 2026 means building
on something already scheduled for removal.

That leaves a real question between the other two, because both work.

## Decision

**mise installs both Node and pnpm** from exact pins in `mise.toml`, verified
against checksums in `mise.lock`. This is what CI uses too, via
`jdx/mise-action`.

**`devEngines` in package.json mirrors those versions** and is set to
`onFail: "error"`, with `pmOnFail: error` in `pnpm-workspace.yaml`. It is not a
second installer — it is an assertion. If the pnpm that is running is not the
pnpm this repository expects, the command fails instead of proceeding.

**`scripts/check-toolchain-age.ts` fails if the two disagree**, so the mirror
cannot silently rot.

The legacy `packageManager` field is deliberately absent: pnpm 11 supersedes it
with `devEngines.packageManager`, and keeping both invites them to drift.

## Alternatives considered

**`devEngines` alone, no mise.** pnpm can install pnpm, but it cannot install
Node — something must already have put a Node on PATH, and that something would
be unmanaged. Reproducibility would stop at the runtime, which is the part most
likely to differ between a laptop and CI.

**mise alone, no `devEngines`.** Simpler, and honestly close. Rejected because
mise activation is easy to bypass — a shell without the mise shim, an editor
task, a CI step that forgot the action — and in that case pnpm would run happily
with whatever version it found. The `devEngines` assertion closes that hole from
inside pnpm, where no PATH trick can get around it.

**`pmOnFail: download`** (pnpm's default: fetch and switch to the declared
version automatically). Convenient, and pnpm does verify the download's registry
signature. Rejected because it turns a mismatch into a silent network fetch;
`error` turns it into a question for a human, which is what a mismatch is.

## Consequences

- A pnpm bump is a three-file change (`mise.toml`, `package.json`, `mise.lock`).
  This is friction on purpose — see [ADR 3](./0003-release-cooldown.md).
- mise installs pnpm through the aqua registry, which has lagged pnpm's release
  asset renaming before. Because we pin an older, already-cooled version rather
  than chasing latest, this lag is bounded and shows up as a clear install error
  rather than a wrong version.
- Contributors must have mise. `README.md` treats that as the one prerequisite.

## Revisit when

Corepack's replacement (if the Node project ships one) reaches stable status, or
mise gains first-class knowledge of `devEngines` such that the mirror becomes
unnecessary.
