import { describe, expect, it } from 'vitest';

import {
  type Advisory,
  type DependencyPolicy,
  type LicenseUsage,
  evaluateLicenses,
  evaluateVulnerabilities,
  parseAuditReport,
  parseDependencyPolicy,
  parseLicenseReport,
} from './dependency-policy.ts';

const ADVISORY_ID = 'GHSA-q8mj-m7cp-5q26';
const OWNER = 'repository maintainer';
const REASON = 'not reachable from shipped code';

function policy(overrides: Partial<DependencyPolicy> = {}): DependencyPolicy {
  return {
    allowedLicenses: ['MIT'],
    licenseExceptions: [],
    vulnerabilityExceptions: [],
    ...overrides,
  };
}

function advisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: ADVISORY_ID,
    module: 'qs',
    severity: 'moderate',
    title: 'denial of service',
    url: 'https://github.com/advisories/GHSA-q8mj-m7cp-5q26',
    paths: ['.>stryker>qs'],
    ...overrides,
  };
}

function usage(overrides: Partial<LicenseUsage> = {}): LicenseUsage {
  return {
    package: 'left-pad',
    license: 'MIT',
    versions: ['1.0.0'],
    ...overrides,
  };
}

describe('parseDependencyPolicy', () => {
  const valid = {
    licenses: { allowed: ['MIT'], exceptions: [] },
    vulnerabilities: { exceptions: [] },
  };

  it('reads a well-formed policy document', () => {
    expect(parseDependencyPolicy(valid)).toStrictEqual(policy());
  });

  it('reads the exception lists', () => {
    const parsed = parseDependencyPolicy({
      licenses: {
        allowed: ['MIT'],
        exceptions: [
          { package: 'p', license: 'MPL-2.0', reason: REASON, owner: OWNER },
        ],
      },
      vulnerabilities: {
        exceptions: [
          {
            advisory: ADVISORY_ID,
            package: 'qs',
            paths: ['.>stryker>qs'],
            reason: REASON,
            owner: OWNER,
            reviewBy: '2026-11-30',
          },
        ],
      },
    });
    expect(parsed.licenseExceptions).toHaveLength(1);
    expect(parsed.vulnerabilityExceptions[0]?.paths).toStrictEqual([
      '.>stryker>qs',
    ]);
    expect(parsed.vulnerabilityExceptions[0]?.reviewBy).toBe('2026-11-30');
  });

  it('rejects a document that is not an object', () => {
    expect(() => parseDependencyPolicy([])).toThrow(
      /^dependency-policy\.json must be a JSON object$/,
    );
  });

  it('rejects a null document without crashing', () => {
    expect(() => parseDependencyPolicy(null)).not.toThrow(TypeError);
    expect(() => parseDependencyPolicy(null)).toThrow(
      /^dependency-policy\.json must be a JSON object$/,
    );
  });

  it('rejects a missing licences section', () => {
    expect(() =>
      parseDependencyPolicy({ vulnerabilities: { exceptions: [] } }),
    ).toThrow('dependency-policy.licenses');
  });

  it('rejects a missing vulnerabilities section', () => {
    expect(() =>
      parseDependencyPolicy({ licenses: { allowed: [], exceptions: [] } }),
    ).toThrow(/^dependency-policy\.vulnerabilities must be a JSON object$/);
  });

  it('rejects an allowed list that is not an array', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: 'MIT', exceptions: [] },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow('must be an array');
  });

  it('rejects an empty SPDX identifier in the allowed list', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [''], exceptions: [] },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.allowed\[0\] must be a non-empty SPDX identifier$/,
    );
  });

  it('rejects a non-string entry in the allowed list', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: ['MIT', 5], exceptions: [] },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.allowed\[1\] must be a non-empty SPDX identifier$/,
    );
  });

  it('rejects an exception with no stated reason, so silence cannot become approval', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: {
          allowed: [],
          exceptions: [{ package: 'p', license: 'MPL-2.0', owner: OWNER }],
        },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.exceptions\[0\]\.reason must be a non-empty string$/,
    );
  });

  it('rejects an exception whose reason is an empty string', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: {
          allowed: [],
          exceptions: [
            { package: 'p', license: 'MPL-2.0', reason: '', owner: OWNER },
          ],
        },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.exceptions\[0\]\.reason must be a non-empty string$/,
    );
  });

  it('rejects an exception with no owner', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: {
          allowed: [],
          exceptions: [{ package: 'p', license: 'MPL-2.0', reason: REASON }],
        },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.exceptions\[0\]\.owner must be a non-empty string$/,
    );
  });

  it('rejects a review date that is not a calendar date', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              paths: ['.>stryker>qs'],
              reason: REASON,
              owner: OWNER,
              reviewBy: 'next quarter',
            },
          ],
        },
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects a date-shaped string that is not a real calendar date', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              paths: ['.>stryker>qs'],
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-99-30',
            },
          ],
        },
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects a day that does not exist in that month', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              paths: ['.>stryker>qs'],
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-02-30',
            },
          ],
        },
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects a review date with trailing content after the date', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              paths: ['.>stryker>qs'],
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-11-30x',
            },
          ],
        },
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects a review date with leading content before the date', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              paths: ['.>stryker>qs'],
              reason: REASON,
              owner: OWNER,
              reviewBy: 'x2026-11-30',
            },
          ],
        },
      }),
    ).toThrow('YYYY-MM-DD');
  });

  it('rejects an exception entry that is not an object', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: ['MPL-2.0'] },
        vulnerabilities: { exceptions: [] },
      }),
    ).toThrow(
      /^dependency-policy\.licenses\.exceptions\[0\] must be a JSON object$/,
    );
  });

  it('rejects a vulnerability exception without reviewed dependency paths', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-11-30',
              paths: [],
            },
          ],
        },
      }),
    ).toThrow(
      /^dependency-policy\.vulnerabilities\.exceptions\[0\]\.paths must contain non-empty dependency paths$/,
    );
  });

  it('rejects a vulnerability exception with a non-string entry among its paths', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-11-30',
              paths: ['.>stryker>qs', 5],
            },
          ],
        },
      }),
    ).toThrow(
      /^dependency-policy\.vulnerabilities\.exceptions\[0\]\.paths must contain non-empty dependency paths$/,
    );
  });

  it('rejects a vulnerability exception with an empty-string path among valid ones', () => {
    expect(() =>
      parseDependencyPolicy({
        licenses: { allowed: [], exceptions: [] },
        vulnerabilities: {
          exceptions: [
            {
              advisory: ADVISORY_ID,
              package: 'qs',
              reason: REASON,
              owner: OWNER,
              reviewBy: '2026-11-30',
              paths: ['.>stryker>qs', ''],
            },
          ],
        },
      }),
    ).toThrow(
      /^dependency-policy\.vulnerabilities\.exceptions\[0\]\.paths must contain non-empty dependency paths$/,
    );
  });
});

describe('parseAuditReport', () => {
  it('flattens advisories and the paths they were reached through', () => {
    const parsed = parseAuditReport({
      advisories: {
        '1119502': {
          github_advisory_id: ADVISORY_ID,
          module_name: 'qs',
          severity: 'moderate',
          title: 'denial of service',
          url: 'https://example.test/a',
          findings: [{ paths: ['.>stryker>qs'] }, { paths: ['.>other>qs'] }],
        },
      },
    });
    expect(parsed).toStrictEqual([
      {
        id: ADVISORY_ID,
        module: 'qs',
        severity: 'moderate',
        title: 'denial of service',
        url: 'https://example.test/a',
        paths: ['.>stryker>qs', '.>other>qs'],
      },
    ]);
  });

  it('reads a clean audit as no advisories', () => {
    expect(parseAuditReport({ advisories: {} })).toStrictEqual([]);
  });

  it('tolerates an advisory with no findings', () => {
    const parsed = parseAuditReport({
      advisories: {
        a: {
          github_advisory_id: ADVISORY_ID,
          module_name: 'qs',
          severity: 'low',
          title: 't',
          url: 'u',
        },
      },
    });
    expect(parsed[0]?.paths).toStrictEqual([]);
  });

  it('skips a finding whose paths are not an array', () => {
    const parsed = parseAuditReport({
      advisories: {
        a: {
          github_advisory_id: ADVISORY_ID,
          module_name: 'qs',
          severity: 'low',
          title: 't',
          url: 'u',
          findings: [{ paths: 'not-an-array' }, { paths: ['.>a>qs'] }],
        },
      },
    });
    expect(parsed[0]?.paths).toStrictEqual(['.>a>qs']);
  });

  it('skips a finding entry that is not a record', () => {
    const parsed = parseAuditReport({
      advisories: {
        a: {
          github_advisory_id: ADVISORY_ID,
          module_name: 'qs',
          severity: 'low',
          title: 't',
          url: 'u',
          findings: ['not-a-record', { paths: ['.>a>qs'] }],
        },
      },
    });
    expect(parsed[0]?.paths).toStrictEqual(['.>a>qs']);
  });

  it('drops a non-string entry from a finding path array', () => {
    const parsed = parseAuditReport({
      advisories: {
        a: {
          github_advisory_id: ADVISORY_ID,
          module_name: 'qs',
          severity: 'low',
          title: 't',
          url: 'u',
          findings: [{ paths: ['.>a>qs', 5] }],
        },
      },
    });
    expect(parsed[0]?.paths).toStrictEqual(['.>a>qs']);
  });

  it('rejects a report that is not a JSON object', () => {
    expect(() => parseAuditReport([])).toThrow(
      /^pnpm audit output must be a JSON object$/,
    );
  });

  it('rejects output with no advisories map rather than reporting nothing found', () => {
    expect(() => parseAuditReport({})).toThrow(
      /^pnpm audit output\.advisories must be a JSON object$/,
    );
  });

  it('rejects an advisory missing its identifier', () => {
    expect(() =>
      parseAuditReport({ advisories: { a: { module_name: 'qs' } } }),
    ).toThrow(
      /^pnpm audit advisory a\.github_advisory_id must be a non-empty string$/,
    );
  });
});

describe('parseLicenseReport', () => {
  it('rejects a report that is not a JSON object', () => {
    expect(() => parseLicenseReport([])).toThrow(
      /^pnpm licenses output must be a JSON object$/,
    );
  });

  it('turns the licence-keyed document into one row per package', () => {
    expect(
      parseLicenseReport({
        MIT: [{ name: 'left-pad', versions: ['1.0.0'] }],
        'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'] }],
      }),
    ).toStrictEqual([
      { package: 'left-pad', license: 'MIT', versions: ['1.0.0'] },
      { package: 'lightningcss', license: 'MPL-2.0', versions: ['1.33.0'] },
    ]);
  });

  it('surfaces pnpm’s own error instead of reporting an empty licence set', () => {
    expect(() =>
      parseLicenseReport({ error: { message: 'store is incomplete' } }),
    ).toThrow(/^pnpm licenses list failed: store is incomplete$/);
  });

  it('reports an unknown error when the error object has no message', () => {
    expect(() => parseLicenseReport({ error: {} })).toThrow(
      /^pnpm licenses list failed: unknown error$/,
    );
  });

  it('rejects a licence key whose value is not a list', () => {
    expect(() => parseLicenseReport({ MIT: 'left-pad' })).toThrow(
      /^pnpm licenses output\.MIT must be an array$/,
    );
  });

  it('tolerates a package with no recorded versions', () => {
    expect(
      parseLicenseReport({ MIT: [{ name: 'left-pad' }] })[0],
    ).toStrictEqual({ package: 'left-pad', license: 'MIT', versions: [] });
  });

  it('drops a non-string entry from a package versions array', () => {
    expect(
      parseLicenseReport({
        MIT: [{ name: 'left-pad', versions: ['1.0.0', 5] }],
      })[0],
    ).toStrictEqual({
      package: 'left-pad',
      license: 'MIT',
      versions: ['1.0.0'],
    });
  });

  it('rejects a package entry missing its name, naming the licence and index', () => {
    expect(() =>
      parseLicenseReport({ MIT: [{ versions: ['1.0.0'] }] }),
    ).toThrow(/^pnpm licenses output\.MIT\.name must be a non-empty string$/);
  });
});

describe('evaluateVulnerabilities', () => {
  const today = '2026-08-12';

  it('passes when there are no advisories and no exceptions', () => {
    expect(evaluateVulnerabilities([], policy(), today)).toStrictEqual([]);
  });

  it('fails on an advisory nobody has accepted', () => {
    const problems = evaluateVulnerabilities([advisory()], policy(), today);
    expect(problems).toStrictEqual([
      expect.stringContaining('moderate vulnerability in qs'),
    ]);
  });

  it('names the path the vulnerable package was reached through', () => {
    expect(evaluateVulnerabilities([advisory()], policy(), today)[0]).toContain(
      '.>stryker>qs',
    );
  });

  it('omits the path when the advisory records none', () => {
    const problems = evaluateVulnerabilities(
      [advisory({ paths: [] })],
      policy(),
      today,
    );
    expect(problems[0]).not.toContain('Reached via');
  });

  const accepted = policy({
    vulnerabilityExceptions: [
      {
        advisory: ADVISORY_ID,
        package: 'qs',
        paths: ['.>stryker>qs'],
        reason: REASON,
        owner: OWNER,
        reviewBy: '2026-11-30',
      },
    ],
  });

  it('suppresses an advisory an unexpired exception names exactly', () => {
    expect(
      evaluateVulnerabilities([advisory()], accepted, today),
    ).toStrictEqual([]);
  });

  it('stops suppressing once the review date has passed', () => {
    const problems = evaluateVulnerabilities(
      [advisory()],
      accepted,
      '2026-12-01',
    );
    expect(problems).toStrictEqual([expect.stringContaining('expired')]);
  });

  it('still suppresses on the review date itself', () => {
    expect(
      evaluateVulnerabilities([advisory()], accepted, '2026-11-30'),
    ).toStrictEqual([]);
  });

  it('does not let an exception cover a different package with the same advisory', () => {
    const problems = evaluateVulnerabilities(
      [advisory({ module: 'body-parser' })],
      accepted,
      today,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('body-parser');
    expect(problems[1]).toContain('stale');
  });

  it('fails on an exception that no longer matches any advisory', () => {
    expect(evaluateVulnerabilities([], accepted, today)).toStrictEqual([
      expect.stringContaining('Delete the stale exception'),
    ]);
  });

  it('fails when an advisory gains a path outside the accepted exception', () => {
    const problems = evaluateVulnerabilities(
      [advisory({ paths: ['.>stryker>qs', '.>production>qs'] })],
      accepted,
      today,
    );
    expect(problems).toStrictEqual([expect.stringContaining('does not cover')]);
  });

  it('fails closed when an accepted advisory has no path data', () => {
    const problems = evaluateVulnerabilities(
      [advisory({ paths: [] })],
      accepted,
      today,
    );
    expect(problems).toStrictEqual([
      expect.stringContaining('path data unavailable'),
    ]);
  });
});

describe('evaluateLicenses', () => {
  it('passes when every licence is on the allowed list', () => {
    expect(evaluateLicenses([usage()], policy())).toStrictEqual([]);
  });

  it('fails on a licence that is neither allowed nor excepted', () => {
    const problems = evaluateLicenses(
      [usage({ package: 'sonar', license: 'LGPL-3.0-only' })],
      policy(),
    );
    expect(problems).toStrictEqual([
      'sonar@1.0.0 is licensed LGPL-3.0-only, which is not in the allowed ' +
        'list. Replace the dependency, or record a reviewed exception in ' +
        'infra/policy/dependency-policy.json.',
    ]);
  });

  const accepted = policy({
    licenseExceptions: [
      {
        package: 'sonar',
        license: 'LGPL-3.0-only',
        reason: REASON,
        owner: OWNER,
      },
    ],
  });

  it('suppresses a licence an exception names exactly', () => {
    expect(
      evaluateLicenses(
        [usage({ package: 'sonar', license: 'LGPL-3.0-only' })],
        accepted,
      ),
    ).toStrictEqual([]);
  });

  it('does not let an exception cover the same package under a different licence', () => {
    const problems = evaluateLicenses(
      [usage({ package: 'sonar', license: 'GPL-3.0-only' })],
      accepted,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('GPL-3.0-only');
  });

  it('fails on an exception that no installed package matches', () => {
    expect(evaluateLicenses([usage()], accepted)).toStrictEqual([
      'dependency-policy.json accepts LGPL-3.0-only for sonar, but no ' +
        'installed package matches. Delete the stale exception.',
    ]);
  });

  it('lets a trailing * cover a package name prefix', () => {
    const prefixed = policy({
      licenseExceptions: [
        {
          package: 'lightningcss*',
          license: 'MPL-2.0',
          reason: REASON,
          owner: OWNER,
        },
      ],
    });
    expect(
      evaluateLicenses(
        [
          usage({ package: 'lightningcss', license: 'MPL-2.0' }),
          usage({ package: 'lightningcss-darwin-arm64', license: 'MPL-2.0' }),
        ],
        prefixed,
      ),
    ).toStrictEqual([]);
  });

  it('does not treat a prefix exception as stale when only some variants are installed', () => {
    const prefixed = policy({
      licenseExceptions: [
        {
          package: 'lightningcss*',
          license: 'MPL-2.0',
          reason: REASON,
          owner: OWNER,
        },
      ],
    });
    expect(
      evaluateLicenses(
        [usage({ package: 'lightningcss-linux-x64-gnu', license: 'MPL-2.0' })],
        prefixed,
      ),
    ).toStrictEqual([]);
  });

  it('still requires the licence to match, prefix or not', () => {
    const prefixed = policy({
      licenseExceptions: [
        {
          package: 'lightningcss*',
          license: 'MPL-2.0',
          reason: REASON,
          owner: OWNER,
        },
      ],
    });
    const problems = evaluateLicenses(
      [
        usage({
          package: 'lightningcss-darwin-arm64',
          license: 'GPL-3.0-only',
        }),
      ],
      prefixed,
    );
    expect(problems[0]).toContain('GPL-3.0-only');
  });

  it('does not let a prefix exception match on just its first character', () => {
    const prefixed = policy({
      licenseExceptions: [
        {
          package: 'sonar*',
          license: 'LGPL-3.0-only',
          reason: REASON,
          owner: OWNER,
        },
      ],
    });
    const problems = evaluateLicenses(
      [usage({ package: 'soap', license: 'LGPL-3.0-only' })],
      prefixed,
    );
    expect(problems).toStrictEqual([
      'soap@1.0.0 is licensed LGPL-3.0-only, which is not in the allowed ' +
        'list. Replace the dependency, or record a reviewed exception in ' +
        'infra/policy/dependency-policy.json.',
      'dependency-policy.json accepts LGPL-3.0-only for sonar*, but no ' +
        'installed package matches. Delete the stale exception.',
    ]);
  });

  it('requires an exact match when the exception has no trailing *', () => {
    const exact = policy({
      licenseExceptions: [
        { package: 'left', license: 'MPL-2.0', reason: REASON, owner: OWNER },
      ],
    });
    const problems = evaluateLicenses(
      [usage({ package: 'left-pad', license: 'MPL-2.0' })],
      exact,
    );
    expect(problems).toStrictEqual([
      'left-pad@1.0.0 is licensed MPL-2.0, which is not in the allowed ' +
        'list. Replace the dependency, or record a reviewed exception in ' +
        'infra/policy/dependency-policy.json.',
      'dependency-policy.json accepts MPL-2.0 for left, but no installed ' +
        'package matches. Delete the stale exception.',
    ]);
  });

  it('reports every offending package rather than only the first', () => {
    const problems = evaluateLicenses(
      [
        usage({ package: 'a', license: 'GPL-3.0-only' }),
        usage({ package: 'b', license: 'AGPL-3.0-only' }),
      ],
      policy(),
    );
    expect(problems).toHaveLength(2);
  });

  it('joins multiple installed versions with a comma in the report', () => {
    const problems = evaluateLicenses(
      [usage({ license: 'LGPL-3.0-only', versions: ['1.0.0', '2.0.0'] })],
      policy(),
    );
    expect(problems).toStrictEqual([
      'left-pad@1.0.0, 2.0.0 is licensed LGPL-3.0-only, which is not in the ' +
        'allowed list. Replace the dependency, or record a reviewed ' +
        'exception in infra/policy/dependency-policy.json.',
    ]);
  });
});
