<!--
The checks decide whether this change is correct, formatted, typed, covered,
non-duplicating and free of known-vulnerable dependencies. Do not repeat any of
that here.

This template asks only for the things `pnpm verify` cannot know: what problem
the change solves, and what a reader would otherwise have to reverse-engineer
from the diff.
-->

## What changes and why

<!-- The problem, then the change. One or two paragraphs is usually right. -->

## Behaviour a reader cannot see in the diff

<!--
Anything a green build does not prove: a decision between two workable designs,
an interface other code depends on, a migration or ordering requirement, a
deliberate omission. Write "none" if there genuinely is none.
-->

## Enforcement layer

<!--
Delete this section unless the pull request touches a protected path
(package.json, pnpm-lock.yaml, the tool configs, .github/, infra/, scripts/).

If it does, the title must contain TOOLCHAIN-CHANGE-APPROVED or the pull
request must carry the `toolchain` label, and a code owner has to approve it.
Say which rule is being added, relaxed, or removed, and what a reviewer should
check that the new configuration itself does not.
-->

## Exceptions

<!--
Delete unless this pull request adds an ESLint disable, a Knip ignore, a
dependency-cruiser exclusion, a coverage exclusion, or an entry in
infra/policy/dependency-policy.json.

Per docs/code-quality-gate.md section 6, record: the reason, the blast radius,
the condition under which it is removed, and who owns that decision.
-->
