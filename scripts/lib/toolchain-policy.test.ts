import { describe, expect, it } from 'vitest';

import {
  COOLDOWN_MS,
  ageInDays,
  checkAge,
  checkCooldownPolicy,
  checkPinsAgree,
  readDeclaredPins,
  readMisePins,
  readNodeReleaseDate,
  readNpmPublishTime,
  tomlSection,
  tomlString,
} from './toolchain-policy.ts';

const NODE_VERSION = '24.19.0';
const PNPM_VERSION = '11.20.0';

const MISE_TOML = `min_version = "2025.1.0"

[tools]
node = "${NODE_VERSION}"
pnpm = "${PNPM_VERSION}"
gitleaks = "8.29.1"

[settings]
node = "not-the-pin"
lockfile = true
`;

const COMPLIANT_WORKSPACE = `minimumReleaseAge: 7200
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
trustPolicy: no-downgrade
allowBuilds: {}
`;

function packageJson(node = NODE_VERSION, pnpm = PNPM_VERSION): unknown {
  return {
    devEngines: {
      runtime: { name: 'node', version: node },
      packageManager: { name: 'pnpm', version: pnpm },
    },
  };
}

describe('tomlSection', () => {
  it('returns only the requested table', () => {
    expect(tomlSection(MISE_TOML, 'tools')).toStrictEqual(
      'node = "24.19.0"\npnpm = "11.20.0"\ngitleaks = "8.29.1"\n',
    );
  });

  it('matches a table header padded with surrounding whitespace', () => {
    expect(tomlSection('  [tools]  \nnode = "24.19.0"\n', 'tools')).toBe(
      'node = "24.19.0"\n',
    );
  });

  it('returns nothing for a table that is not present', () => {
    expect(tomlSection(MISE_TOML, 'env')).toBe('');
  });

  it('reads a table that runs to the end of the file', () => {
    expect(tomlSection(MISE_TOML, 'settings')).toContain('lockfile = true');
  });

  it('stops a table at the next header, even one padded with whitespace', () => {
    expect(
      tomlSection(
        '[tools]\nnode = "24.19.0"\n  [settings]  \nlockfile = true\n',
        'tools',
      ),
    ).toBe('node = "24.19.0"');
  });
});

describe('tomlString', () => {
  it('reads a quoted value', () => {
    expect(tomlString('node = "24.19.0"', 'node')).toBe('24.19.0');
  });

  it('reads a quoted value indented with leading whitespace', () => {
    expect(tomlString('  node = "24.19.0"', 'node')).toBe('24.19.0');
  });

  it('ignores a commented-out assignment', () => {
    expect(tomlString('# node = "23.0.0"\nnode = "24.19.0"', 'node')).toBe(
      '24.19.0',
    );
  });

  it('ignores a commented-out assignment indented with leading whitespace', () => {
    expect(tomlString('  # node = "23.0.0"\nnode = "24.19.0"', 'node')).toBe(
      '24.19.0',
    );
  });

  it('returns undefined for a key that is absent', () => {
    expect(tomlString('node = "24.19.0"', 'deno')).toBeUndefined();
  });
});

describe('readMisePins', () => {
  it('reads the pins from the tools table, not from a later table', () => {
    expect(readMisePins(MISE_TOML)).toStrictEqual({
      node: NODE_VERSION,
      pnpm: PNPM_VERSION,
    });
  });

  it('rejects a file that pins only one of the two', () => {
    expect(() => readMisePins('[tools]\nnode = "24.19.0"\n')).toThrow(
      'must pin both node and pnpm',
    );
  });

  it('rejects a file with no tools table', () => {
    expect(() => readMisePins('min_version = "2025.1.0"\n')).toThrow(
      'must pin both node and pnpm',
    );
  });

  it('rejects a file that pins only pnpm', () => {
    expect(() => readMisePins('[tools]\npnpm = "11.20.0"\n')).toThrow(
      'must pin both node and pnpm',
    );
  });
});

describe('readDeclaredPins', () => {
  it('reads both devEngines versions', () => {
    expect(readDeclaredPins(packageJson())).toStrictEqual({
      node: NODE_VERSION,
      pnpm: PNPM_VERSION,
    });
  });

  it('rejects a manifest that is not an object', () => {
    expect(() => readDeclaredPins('{}')).toThrow('did not parse to an object');
  });

  it('rejects a null manifest without crashing', () => {
    expect(() => readDeclaredPins(null)).not.toThrow(TypeError);
    expect(() => readDeclaredPins(null)).toThrow('did not parse to an object');
  });

  it('rejects a manifest with no devEngines block', () => {
    expect(() => readDeclaredPins({})).toThrow('no devEngines block');
  });

  it('rejects devEngines that declares only the runtime', () => {
    expect(() =>
      readDeclaredPins({ devEngines: { runtime: { version: NODE_VERSION } } }),
    ).toThrow('both runtime and packageManager');
  });

  it('rejects a version that is not a string', () => {
    expect(() =>
      readDeclaredPins({
        devEngines: {
          runtime: { version: 24 },
          packageManager: { version: '1' },
        },
      }),
    ).toThrow('must be strings');
  });

  it('rejects a pnpm version that is not a string, even when node is', () => {
    expect(() =>
      readDeclaredPins({
        devEngines: {
          runtime: { version: NODE_VERSION },
          packageManager: { version: 11 },
        },
      }),
    ).toThrow('must be strings');
  });
});

describe('checkPinsAgree', () => {
  it('passes when mise.toml and package.json say the same thing', () => {
    expect(
      checkPinsAgree(readMisePins(MISE_TOML), readDeclaredPins(packageJson())),
    ).toStrictEqual([]);
  });

  it('reports a Node pin that drifted', () => {
    const problems = checkPinsAgree(
      readMisePins(MISE_TOML),
      readDeclaredPins(packageJson('24.18.0')),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('Node pin mismatch'),
    ]);
  });

  it('reports a pnpm pin that drifted', () => {
    const problems = checkPinsAgree(
      readMisePins(MISE_TOML),
      readDeclaredPins(packageJson(NODE_VERSION, '11.19.0')),
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('pnpm pin mismatch'),
    ]);
  });

  it('reports both pins when both drifted', () => {
    expect(
      checkPinsAgree(
        readMisePins(MISE_TOML),
        readDeclaredPins(packageJson('24.18.0', '11.19.0')),
      ),
    ).toHaveLength(2);
  });
});

describe('checkCooldownPolicy', () => {
  it('passes on the settings the policy was written against', () => {
    expect(checkCooldownPolicy(COMPLIANT_WORKSPACE)).toStrictEqual([]);
  });

  it('rejects a shortened cooldown', () => {
    const problems = checkCooldownPolicy(
      COMPLIANT_WORKSPACE.replace('7200', '1440'),
    );
    expect(problems).toStrictEqual([
      'pnpm-workspace.yaml sets minimumReleaseAge to 1440; expected 7200 ' +
        '(5 days) to match the toolchain cooldown enforced by this script.',
    ]);
  });

  it('rejects a cooldown left in loose mode', () => {
    const problems = checkCooldownPolicy(
      COMPLIANT_WORKSPACE.replace('minimumReleaseAgeStrict: true', ''),
    );
    expect(problems).toStrictEqual([
      'pnpm-workspace.yaml must set minimumReleaseAgeStrict: true. Without ' +
        'it pnpm auto-approves immature versions into ' +
        'minimumReleaseAgeExclude instead of refusing them.',
    ]);
  });

  it('rejects installing packages that carry no publish time', () => {
    const problems = checkCooldownPolicy(
      COMPLIANT_WORKSPACE.replace(
        'minimumReleaseAgeIgnoreMissingTime: false',
        'minimumReleaseAgeIgnoreMissingTime: true',
      ),
    );
    expect(problems).toStrictEqual([
      'pnpm-workspace.yaml must set minimumReleaseAgeIgnoreMissingTime: ' +
        'false, so a package without a registry publish time is refused ' +
        'rather than treated as mature.',
    ]);
  });

  it('rejects a weakened registry trust policy', () => {
    const problems = checkCooldownPolicy(
      COMPLIANT_WORKSPACE.replace('trustPolicy: no-downgrade', ''),
    );
    expect(problems).toStrictEqual([
      'pnpm-workspace.yaml must set trustPolicy: no-downgrade, so a ' +
        'package whose registry trust signals got weaker than the ' +
        'lockfile recorded is refused.',
    ]);
  });

  it('rejects a missing allowBuilds declaration', () => {
    const problems = checkCooldownPolicy(
      COMPLIANT_WORKSPACE.replace('allowBuilds: {}', ''),
    );
    expect(problems).toStrictEqual([
      'pnpm-workspace.yaml must declare allowBuilds, which lists the ' +
        'dependencies permitted to run install-time lifecycle scripts. An ' +
        'empty map means none may run.',
    ]);
  });

  it('accepts allowBuilds written as an empty value', () => {
    expect(
      checkCooldownPolicy(
        COMPLIANT_WORKSPACE.replace('allowBuilds: {}', 'allowBuilds:'),
      ),
    ).toStrictEqual([]);
  });

  it('reports a file that is not a mapping instead of passing it', () => {
    expect(checkCooldownPolicy('- a\n')).toStrictEqual([
      expect.stringContaining('did not parse to a mapping'),
    ]);
  });

  it('reports a null document without crashing', () => {
    expect(() => checkCooldownPolicy('null\n')).not.toThrow();
    expect(checkCooldownPolicy('null\n')).toStrictEqual([
      'pnpm-workspace.yaml did not parse to a mapping.',
    ]);
  });
});

describe('checkAge', () => {
  const now = new Date('2026-08-12T00:00:00.000Z');

  it('accepts a release older than the cooldown', () => {
    const published = new Date(now.getTime() - COOLDOWN_MS - 1);
    expect(checkAge('pnpm', PNPM_VERSION, published, now)).toStrictEqual([]);
  });

  it('accepts a release exactly at the cooldown boundary', () => {
    const published = new Date(now.getTime() - COOLDOWN_MS);
    expect(checkAge('pnpm', PNPM_VERSION, published, now)).toStrictEqual([]);
  });

  it('rejects a release published inside the cooldown window', () => {
    const published = new Date('2026-08-11T00:00:00.000Z');
    expect(checkAge('node', NODE_VERSION, published, now)).toStrictEqual([
      'node@24.19.0 was published 1.0 days ago; the cooldown is 5 days. ' +
        'Pin an older release, or wait until 2026-08-16T00:00:00.000Z.',
    ]);
  });
});

describe('ageInDays', () => {
  it('measures whole days between two instants', () => {
    expect(
      ageInDays(
        new Date('2026-08-07T00:00:00.000Z'),
        new Date('2026-08-12T00:00:00.000Z'),
      ),
    ).toBe(5);
  });
});

describe('readNpmPublishTime', () => {
  it('reads the publish time of the requested version', () => {
    const time = readNpmPublishTime(
      { time: { [PNPM_VERSION]: '2026-07-01T10:00:00.000Z' } },
      'pnpm',
      PNPM_VERSION,
    );
    expect(time.toISOString()).toBe('2026-07-01T10:00:00.000Z');
  });

  it('rejects a packument with no time map', () => {
    expect(() => readNpmPublishTime({}, 'pnpm', PNPM_VERSION)).toThrow(
      'no usable "time" field',
    );
  });

  it('rejects a version the registry does not list', () => {
    expect(() =>
      readNpmPublishTime({ time: {} }, 'pnpm', PNPM_VERSION),
    ).toThrow('does not list a publish time');
  });
});

describe('readNodeReleaseDate', () => {
  const index = [{ version: `v${NODE_VERSION}`, date: '2026-07-01' }];

  it('reads the release date of the requested version', () => {
    expect(readNodeReleaseDate(index, NODE_VERSION).toISOString()).toBe(
      '2026-07-01T23:59:59.999Z',
    );
  });

  it('rejects a response that is not a list', () => {
    expect(() => readNodeReleaseDate({}, NODE_VERSION)).toThrow(
      'did not return an array',
    );
  });

  it('rejects a version the dist index does not list', () => {
    expect(() => readNodeReleaseDate(index, '25.0.0')).toThrow(
      'does not list a release',
    );
  });

  it('skips an earlier entry for a different version before finding the match', () => {
    const multiIndex = [
      { version: 'v99.0.0', date: '2020-01-01' },
      { version: `v${NODE_VERSION}`, date: '2026-07-01' },
    ];
    expect(readNodeReleaseDate(multiIndex, NODE_VERSION).toISOString()).toBe(
      '2026-07-01T23:59:59.999Z',
    );
  });

  it('skips an entry with the right version but no date string', () => {
    const multiIndex = [
      { version: `v${NODE_VERSION}` },
      { version: `v${NODE_VERSION}`, date: '2026-07-01' },
    ];
    expect(readNodeReleaseDate(multiIndex, NODE_VERSION).toISOString()).toBe(
      '2026-07-01T23:59:59.999Z',
    );
  });
});
