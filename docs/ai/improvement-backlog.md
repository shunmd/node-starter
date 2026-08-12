# Improvement backlog

Proposed changes to the enforcement layer — lint rules, tsconfig flags, CI
steps, scripts. Agents may not edit those files directly (see `AGENTS.md` rule
4), so proposals land here and a human applies them.

A proposal is only useful if it is concrete. Include:

- **What** — the exact configuration change, as a diff or a code block.
- **Why** — the specific problem it caught or would have caught, ideally a real
  incident in this repository rather than a general principle.
- **Cost** — what it will make noisier, slower, or more annoying. A proposal
  with no stated cost has not been thought through and will be rejected.

Delete accepted proposals once applied (the ADR or the config diff is the
record). Delete rejected ones with a one-line note saying why, so the same idea
is not re-proposed every month.

---

## Open

_(none yet)_

## Rejected

### Enable `eslint-plugin-unicorn` recommended

**Why not:** it is a large set of opinionated rules with a high false-positive
rate on ordinary Node code (`prevent-abbreviations` in particular renames
well-understood identifiers). The cost — reflexive `eslint-disable` comments and
generated code contorted to satisfy style rules — outweighs the defect-finding
value. Individual unicorn rules may still be worth enabling one at a time, with
a concrete reason each.

### Add a coverage threshold to `vitest.config.ts`

**Why not:** a number chosen by a template is arbitrary, and an arbitrary
threshold gets lowered the first time it blocks something rather than being
treated as a real bar. Worth revisiting once the project has a body of tests and
can pick a number that reflects them.
