/**
 * Verifies that the quality gate's own configuration still matches the shape
 * `docs/code-quality-gate.md` requires: the required scripts exist, coverage
 * and mutation testing still measure `src/` and `scripts/lib/`, their
 * thresholds have not been lowered, the lint rules central to "no warnings"
 * are still errors, the architecture rules central to the enforcement-layer
 * split are still present, and the CI jobs a pull request depends on still
 * exist and still run.
 *
 * Every check here reads a file's *declared* shape rather than executing it,
 * so it cannot see a threshold that is literally 80 but fed from a variable a
 * later line reassigns. That is a narrower claim than "the gate works" --
 * proven instead by the rest of this repository's checks -- but it is still
 * worth making on its own: a change that edits one of these files to quietly
 * widen the gate should fail before it merges, not after someone notices
 * coverage stopped meaning anything. This is the gate checking that it is
 * still the gate.
 */

import {
  checkCiWorkflowContract,
  checkRequiredStatusChecksMatchJobs,
} from './gate-contract-ci.ts';

const ERROR = 'error';
const GATE_GLOBS = ['src/**/*.ts', 'scripts/lib/**/*.ts'] as const;

const REQUIRED_SCRIPTS = [
  'check',
  'verify',
  'fix',
  'format',
  'format:check',
  'lint',
  'lint:fix',
  'typecheck',
  'deadcode',
  'architecture',
  'duplication',
  'test',
  'test:watch',
  'test:coverage',
  'test:mutation',
  'secret:scan',
  'check:toolchain',
  'check:workflows',
  'check:deps',
] as const;

const REQUIRED_ERROR_RULES = [
  'complexity',
  'sonarjs/cognitive-complexity',
  'vitest/no-focused-tests',
  'vitest/no-disabled-tests',
  'vitest/expect-expect',
  '@eslint-community/eslint-comments/require-description',
] as const;

const REQUIRED_ARCHITECTURE_RULES = [
  'no-circular',
  'no-production-to-test',
  'no-orphans',
  'no-lib-to-entry-point',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

// --- package.json ------------------------------------------------------------

export function checkRequiredScripts(packageJson: unknown): readonly string[] {
  if (!isRecord(packageJson) || !isRecord(packageJson['scripts'])) {
    return ['package.json has no scripts object.'];
  }
  const scripts = packageJson['scripts'];
  return REQUIRED_SCRIPTS.filter(
    (name) => typeof scripts[name] !== 'string' || scripts[name].length === 0,
  ).map(
    (name) =>
      `package.json is missing the required script "${name}"; the quality gate can no longer run it.`,
  );
}

// --- vitest.config.ts ---------------------------------------------------------

/** Reads the content of the first balanced `{ ... }` block after `marker`. */
function extractBlock(source: string, marker: string): string | undefined {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }
  const braceStart = source.indexOf('{', markerIndex);
  if (braceStart === -1) {
    return undefined;
  }
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, index);
      }
    }
  }
  return undefined;
}

function checkCoverageThresholds(coverageBlock: string): readonly string[] {
  const thresholdsBlock = extractBlock(coverageBlock, 'thresholds:') ?? '';
  const problems: string[] = [];
  if (!/perFile:\s*true/.test(thresholdsBlock)) {
    problems.push(
      'vitest.config.ts coverage.thresholds.perFile must be true; a repository-wide ' +
        'average lets a well-tested file cover for an untested one.',
    );
  }
  for (const metric of [
    'lines',
    'functions',
    'branches',
    'statements',
  ] as const) {
    const match = new RegExp(`${metric}:\\s*(\\d+)`).exec(thresholdsBlock);
    const value = match?.[1] === undefined ? undefined : Number(match[1]);
    if (value === undefined || value < 80) {
      problems.push(
        `vitest.config.ts coverage.thresholds.${metric} is ` +
          `${value === undefined ? 'missing' : String(value)}; the quality gate requires at least 80.`,
      );
    }
  }
  return problems;
}

export function checkCoverageContract(
  vitestConfigSource: string,
): readonly string[] {
  const coverageBlock = extractBlock(vitestConfigSource, 'coverage:');
  if (coverageBlock === undefined) {
    return ['vitest.config.ts has no coverage block.'];
  }
  const missingGlobs = GATE_GLOBS.filter(
    (glob) => !coverageBlock.includes(glob),
  ).map(
    (glob) =>
      `vitest.config.ts coverage.include is missing "${glob}"; the quality gate would stop measuring it.`,
  );
  return [...missingGlobs, ...checkCoverageThresholds(coverageBlock)];
}

// --- stryker.config.json -------------------------------------------------------

export function checkMutationContract(
  strykerConfig: unknown,
): readonly string[] {
  if (!isRecord(strykerConfig)) {
    return ['stryker.config.json did not parse to an object.'];
  }
  const problems: string[] = [];
  const mutate = strykerConfig['mutate'];
  if (!isStringArray(mutate)) {
    problems.push(
      'stryker.config.json.mutate must be an array of glob patterns.',
    );
  } else {
    for (const glob of GATE_GLOBS.filter((entry) => !mutate.includes(entry))) {
      problems.push(
        `stryker.config.json.mutate is missing "${glob}"; mutation testing would stop covering it.`,
      );
    }
  }
  const thresholds = strykerConfig['thresholds'];
  const breakThreshold = isRecord(thresholds) ? thresholds['break'] : undefined;
  if (typeof breakThreshold !== 'number' || breakThreshold < 80) {
    problems.push(
      'stryker.config.json.thresholds.break must be a number of at least 80.',
    );
  }
  return problems;
}

// --- eslint.config.js -----------------------------------------------------------

function ruleSeverity(source: string, ruleName: string): string | undefined {
  const escaped = ruleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|[\\s,{])['"]?${escaped}['"]?\\s*:\\s*\\[?\\s*['"]?(${ERROR}|warn|off)['"]?`,
  );
  return pattern.exec(source)?.[1];
}

export function checkLintContract(
  eslintConfigSource: string,
): readonly string[] {
  return REQUIRED_ERROR_RULES.filter(
    (rule) => ruleSeverity(eslintConfigSource, rule) !== ERROR,
  ).map(
    (rule) =>
      `eslint.config.js rule "${rule}" is not set to "error"; the quality gate runs ` +
      `with --max-warnings 0, so anything less strict is silently disabled.`,
  );
}

// --- .dependency-cruiser.json -----------------------------------------------------

export function checkArchitectureContract(
  dependencyCruiserConfig: unknown,
): readonly string[] {
  if (!isRecord(dependencyCruiserConfig)) {
    return ['.dependency-cruiser.json did not parse to an object.'];
  }
  const forbidden = dependencyCruiserConfig['forbidden'];
  if (!Array.isArray(forbidden)) {
    return ['.dependency-cruiser.json has no forbidden array.'];
  }
  const rules = forbidden.filter(isRecord);
  const problems: string[] = [];
  for (const name of REQUIRED_ARCHITECTURE_RULES) {
    const rule = rules.find((candidate) => candidate['name'] === name);
    if (rule === undefined) {
      problems.push(
        `.dependency-cruiser.json is missing the required forbidden rule "${name}".`,
      );
    } else if (rule['severity'] !== ERROR) {
      problems.push(
        `.dependency-cruiser.json rule "${name}" has severity "${String(rule['severity'])}"; it must be "${ERROR}".`,
      );
    }
  }
  return problems;
}

// --- Composition ---------------------------------------------------------------
//
// checkCiWorkflowContract and checkRequiredStatusChecksMatchJobs, imported
// above, read .github/workflows/ci.yml and infra/github/rulesets/main.json;
// see ./gate-contract-ci.ts.

export interface GateContractDocuments {
  readonly packageJson: unknown;
  readonly vitestConfigSource: string;
  readonly strykerConfig: unknown;
  readonly eslintConfigSource: string;
  readonly dependencyCruiserConfig: unknown;
  readonly ciWorkflowSource: string;
  readonly mainRulesetConfig: unknown;
}

export function checkGateContract(
  documents: GateContractDocuments,
): readonly string[] {
  return [
    ...checkRequiredScripts(documents.packageJson),
    ...checkCoverageContract(documents.vitestConfigSource),
    ...checkMutationContract(documents.strykerConfig),
    ...checkLintContract(documents.eslintConfigSource),
    ...checkArchitectureContract(documents.dependencyCruiserConfig),
    ...checkCiWorkflowContract(documents.ciWorkflowSource),
    ...checkRequiredStatusChecksMatchJobs(
      documents.mainRulesetConfig,
      documents.ciWorkflowSource,
    ),
  ];
}
