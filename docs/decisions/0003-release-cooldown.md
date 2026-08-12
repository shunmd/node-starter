# 3. Nothing installs until it is 5 days old

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

The npm supply-chain attacks that matter in practice follow one shape: a
maintainer account is compromised, a malicious version is published, and it is
detected and unpublished within hours to a couple of days. The window of danger
is short. Anyone who installed during it is affected; anyone who waited is not.

Delay is therefore an unusually cheap defence — it costs nothing but freshness,
and freshness is rarely urgent.

The requirement was a 5-day wait. Implementing it means recognising that "what
pnpm installs" and "which pnpm runs" are two different problems with two
different mechanisms, and that only one of them has native support.

## Decision

**Dependencies** — enforced by pnpm, in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 7200 # minutes = 5 days
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
minimumReleaseAgeExclude: []
```

The last three lines are what make the first line real:

- Without `minimumReleaseAgeStrict: true`, pnpm runs the cooldown in loose mode.
  When a range can only be satisfied by an immature version, pnpm _appends that
  version to `minimumReleaseAgeExclude` and installs it anyway_. The policy
  records violations instead of preventing them. With strict mode, an
  interactive shell prompts and CI aborts.
- `minimumReleaseAgeIgnoreMissingTime` defaults to `true`, meaning a package
  whose registry metadata carries no publish time is treated as mature. Setting
  it to `false` makes the check fail closed.
- An empty `minimumReleaseAgeExclude` establishes that exceptions are
  `name@version` entries added by a human, not a list pnpm maintains itself.

**The toolchain** — enforced by `scripts/check-toolchain-age.ts`, because
nothing native covers it. Node and pnpm are not resolved as dependencies;
`minimumReleaseAge` has no opinion about either. The script asserts that the
versions pinned in `mise.toml` were published at least 5 days ago, and that
`mise.toml` and `package.json` agree. It runs inside `pnpm check`, so a pull
request that bumps a pin too eagerly cannot go green.

## Alternatives considered

**Renovate's `minimumReleaseAge`.** Would cover both dependencies and the
toolchain in one place, and is the usual answer. Rejected because this project
does not use an update bot: a bot-side policy only constrains updates the bot
proposes, and constrains nothing a human or an agent does by hand.

**5 days for dependencies, longer for pnpm itself.** Defensible — pnpm is
higher-value to an attacker than a leaf package. Rejected for coherence: one
number that everybody knows beats two that must be looked up. The script asserts
the two policies use the same constant, so they cannot drift apart later without
someone noticing.

**Trusting `pnpm-lock.yaml` alone.** The lockfile pins what was resolved, but it
does not stop the next `pnpm add` from resolving something published an hour
ago. It is a floor, not a policy.

## Consequences

- `pnpm add some-brand-new-package` fails until the package matures. This is the
  feature.
- The pinned pnpm will usually be one or two releases behind latest. pnpm ships
  every few days, so "latest" is frequently inside the cooldown window.
- `pnpm check` needs network access to verify publish dates, and fails closed if
  it cannot reach the registry. An unverifiable pin is treated as unapproved.

## Known bypasses

Stated plainly, because a control whose gaps are undocumented gets trusted
further than it deserves:

- **`pnpm self-update`** ignores the cooldown settings entirely — pnpm excludes
  the `minimumReleaseAge*` and `trustPolicy*` settings from self-update. Do not
  run it in this repository; change `mise.toml` instead.
- **`--no-save`** cannot be combined with strict mode (pnpm errors), but
  lowering `minimumReleaseAge` in a local `~/.config/pnpm/config.yaml` would
  weaken the check locally. CI is the backstop: it runs from a clean checkout
  with only the committed configuration.
- **Anything installed outside pnpm** — a global npm install, a curl-to-shell
  tool — is outside this policy by construction.
- A malicious version that survives undetected for more than 5 days defeats the
  cooldown completely. This buys time against fast-detected attacks. It is not a
  substitute for review of what you depend on.

## Revisit when

pnpm gains a native cooldown for its own version, or the 5-day figure proves
wrong in practice — either because a real compromise stayed undetected longer,
or because the delay causes friction with no corresponding benefit.
