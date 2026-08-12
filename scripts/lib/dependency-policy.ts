/**
 * Pure evaluation of the dependency policy: known vulnerabilities and licences.
 *
 * The two reports this module consumes come from `pnpm audit --json` and
 * `pnpm licenses list --json`. Fetching them needs a network and a package
 * store, so that lives in `scripts/check-dependencies.ts`. Everything that
 * decides pass or fail lives here, where it is testable without either.
 *
 * Both gates fail closed and are escaped the same way: an entry in
 * `infra/policy/dependency-policy.json` that names the exact finding, says why
 * it is accepted, and names an owner. An exception that no longer matches
 * anything is itself a failure, so the file cannot silently accumulate
 * approvals for problems that are already gone.
 */

interface LicenseException {
  readonly package: string;
  readonly license: string;
  readonly reason: string;
  readonly owner: string;
}

interface VulnerabilityException {
  readonly advisory: string;
  readonly package: string;
  readonly reason: string;
  readonly owner: string;
  /** `YYYY-MM-DD`. After this date the exception fails instead of suppressing. */
  readonly reviewBy: string;
}

export interface DependencyPolicy {
  readonly allowedLicenses: readonly string[];
  readonly licenseExceptions: readonly LicenseException[];
  readonly vulnerabilityExceptions: readonly VulnerabilityException[];
}

export interface Advisory {
  readonly id: string;
  readonly module: string;
  readonly severity: string;
  readonly title: string;
  readonly url: string;
  readonly paths: readonly string[];
}

export interface LicenseUsage {
  readonly package: string;
  readonly license: string;
  readonly versions: readonly string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const LICENSES_CONTEXT = 'dependency-policy.licenses';
const STALE_EXCEPTION_HINT = 'Delete the stale exception.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  container: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = container[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function requireArray(
  container: Record<string, unknown>,
  key: string,
  context: string,
): readonly unknown[] {
  const value = container[key];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${key} must be an array`);
  }
  return value;
}

function requireObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value;
}

function parseLicenseException(
  value: unknown,
  context: string,
): LicenseException {
  const entry = requireObject(value, context);
  return {
    package: requireString(entry, 'package', context),
    license: requireString(entry, 'license', context),
    reason: requireString(entry, 'reason', context),
    owner: requireString(entry, 'owner', context),
  };
}

function parseVulnerabilityException(
  value: unknown,
  context: string,
): VulnerabilityException {
  const entry = requireObject(value, context);
  const reviewBy = requireString(entry, 'reviewBy', context);
  if (!DATE_PATTERN.test(reviewBy)) {
    throw new Error(`${context}.reviewBy must be a YYYY-MM-DD date`);
  }
  return {
    advisory: requireString(entry, 'advisory', context),
    package: requireString(entry, 'package', context),
    reason: requireString(entry, 'reason', context),
    owner: requireString(entry, 'owner', context),
    reviewBy,
  };
}

export function parseDependencyPolicy(value: unknown): DependencyPolicy {
  const root = requireObject(value, 'dependency-policy.json');
  const licenses = requireObject(root['licenses'], LICENSES_CONTEXT);
  const vulnerabilities = requireObject(
    root['vulnerabilities'],
    'dependency-policy.vulnerabilities',
  );

  const allowed = requireArray(licenses, 'allowed', LICENSES_CONTEXT);
  for (const [index, entry] of allowed.entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(
        `dependency-policy.licenses.allowed[${String(index)}] must be a non-empty SPDX identifier`,
      );
    }
  }

  return {
    allowedLicenses: allowed as readonly string[],
    licenseExceptions: requireArray(
      licenses,
      'exceptions',
      LICENSES_CONTEXT,
    ).map((entry, index) =>
      parseLicenseException(
        entry,
        `dependency-policy.licenses.exceptions[${String(index)}]`,
      ),
    ),
    vulnerabilityExceptions: requireArray(
      vulnerabilities,
      'exceptions',
      'dependency-policy.vulnerabilities',
    ).map((entry, index) =>
      parseVulnerabilityException(
        entry,
        `dependency-policy.vulnerabilities.exceptions[${String(index)}]`,
      ),
    ),
  };
}

/** Reads the advisory list out of a `pnpm audit --json` document. */
export function parseAuditReport(value: unknown): readonly Advisory[] {
  const root = requireObject(value, 'pnpm audit output');
  const advisories = requireObject(
    root['advisories'],
    'pnpm audit output.advisories',
  );
  return Object.entries(advisories).map(([key, entry]) => {
    const context = `pnpm audit advisory ${key}`;
    const advisory = requireObject(entry, context);
    const findings = advisory['findings'];
    const paths = Array.isArray(findings)
      ? findings.flatMap((finding) =>
          isRecord(finding) && Array.isArray(finding['paths'])
            ? finding['paths'].filter(
                (path): path is string => typeof path === 'string',
              )
            : [],
        )
      : [];
    return {
      id: requireString(advisory, 'github_advisory_id', context),
      module: requireString(advisory, 'module_name', context),
      severity: requireString(advisory, 'severity', context),
      title: requireString(advisory, 'title', context),
      url: requireString(advisory, 'url', context),
      paths,
    };
  });
}

/** Flattens a `pnpm licenses list --json` document into one row per package. */
export function parseLicenseReport(value: unknown): readonly LicenseUsage[] {
  const root = requireObject(value, 'pnpm licenses output');
  if (isRecord(root['error'])) {
    throw new Error(
      `pnpm licenses list failed: ${
        typeof root['error']['message'] === 'string'
          ? root['error']['message']
          : 'unknown error'
      }`,
    );
  }
  return Object.entries(root).flatMap(([license, entries]) => {
    if (!Array.isArray(entries)) {
      throw new Error(`pnpm licenses output.${license} must be an array`);
    }
    return entries.map((entry) => {
      const context = `pnpm licenses output.${license}`;
      const usage = requireObject(entry, context);
      const versions = Array.isArray(usage['versions'])
        ? usage['versions'].filter(
            (version): version is string => typeof version === 'string',
          )
        : [];
      return {
        package: requireString(usage, 'name', context),
        license,
        versions,
      };
    });
  });
}

function describeAdvisory(advisory: Advisory): string {
  const via = advisory.paths[0];
  return (
    `${advisory.severity} vulnerability in ${advisory.module} (${advisory.id}): ${advisory.title}. ` +
    (via === undefined ? '' : `Reached via ${via}. `) +
    `See ${advisory.url}. Upgrade the dependency, or record a reviewed exception ` +
    `in infra/policy/dependency-policy.json.`
  );
}

/**
 * @param today - `YYYY-MM-DD` in UTC. Passed in rather than read from the clock
 *   so the expiry behaviour is testable.
 */
export function evaluateVulnerabilities(
  advisories: readonly Advisory[],
  policy: DependencyPolicy,
  today: string,
): readonly string[] {
  const problems: string[] = [];
  const used = new Set<VulnerabilityException>();

  for (const advisory of advisories) {
    const exception = policy.vulnerabilityExceptions.find(
      (candidate) =>
        candidate.advisory === advisory.id &&
        candidate.package === advisory.module,
    );
    if (exception === undefined) {
      problems.push(describeAdvisory(advisory));
      continue;
    }
    used.add(exception);
    if (exception.reviewBy < today) {
      problems.push(
        `The accepted exception for ${advisory.id} (${advisory.module}) was due for review on ` +
          `${exception.reviewBy} and is now expired. Owner: ${exception.owner}. ` +
          `Re-confirm the assessment and move the date, or remove the dependency.`,
      );
    }
  }

  for (const exception of policy.vulnerabilityExceptions) {
    if (!used.has(exception)) {
      problems.push(
        `dependency-policy.json accepts advisory ${exception.advisory} for ${exception.package}, ` +
          `but pnpm audit no longer reports it. ${STALE_EXCEPTION_HINT}`,
      );
    }
  }

  return problems;
}

export function evaluateLicenses(
  usages: readonly LicenseUsage[],
  policy: DependencyPolicy,
): readonly string[] {
  const problems: string[] = [];
  const allowed = new Set(policy.allowedLicenses);
  const used = new Set<LicenseException>();

  for (const usage of usages) {
    if (allowed.has(usage.license)) {
      continue;
    }
    const exception = policy.licenseExceptions.find(
      (candidate) =>
        candidate.package === usage.package &&
        candidate.license === usage.license,
    );
    if (exception === undefined) {
      problems.push(
        `${usage.package}@${usage.versions.join(', ')} is licensed ${usage.license}, which is not ` +
          `in the allowed list. Replace the dependency, or record a reviewed exception in ` +
          `infra/policy/dependency-policy.json.`,
      );
      continue;
    }
    used.add(exception);
  }

  for (const exception of policy.licenseExceptions) {
    if (!used.has(exception)) {
      problems.push(
        `dependency-policy.json accepts ${exception.license} for ${exception.package}, but no ` +
          `installed package matches. ${STALE_EXCEPTION_HINT}`,
      );
    }
  }

  return problems;
}
