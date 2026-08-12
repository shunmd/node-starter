/**
 * Treats GitHub Actions workflows as code that has to pass review, because
 * nothing else in this repository did.
 *
 * A workflow is the most privileged code here: it runs with a token, on a
 * runner, against the repository itself. The failure modes are not the ones
 * ESLint looks for -- a mutable action tag that is re-pointed at new code, a
 * pull request title interpolated straight into a shell, a checkout that
 * leaves a credential behind for later steps. Each rule below is one of those,
 * expressed as a property of the parsed workflow rather than as a sentence in
 * a document.
 *
 * Composite actions under `.github/actions/` are checked with the same step
 * rules and by the same run. A local `uses: ./...` reference is only accepted
 * when the manifest it points at was one of the files scanned -- otherwise the
 * rules would stop at the workflow boundary, and an unpinned action one level
 * down would run in CI having passed the gate.
 *
 * The rules are deliberately absolute. Every one of them has a supported
 * alternative that is no harder to write, so there is no case for a per-file
 * escape hatch.
 */

import { parse } from 'yaml';

import {
  checkJob,
  checkSteps,
  checkWorkflowTriggersAndPermissions,
  type WorkflowReferences,
} from './workflow-rules.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseYaml(source: string): unknown {
  return parse(source) as unknown;
}

// --- Documents --------------------------------------------------------------

export interface PolicySource {
  readonly path: string;
  readonly source: string;
}

interface DocumentResult {
  readonly problems: readonly string[];
  readonly localReferences: ReadonlySet<string>;
  readonly localWorkflowReferences: ReadonlySet<string>;
}

function parseDocument(
  source: string,
): Record<string, unknown> | readonly string[] {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error: unknown) {
    return [
      `is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (!isRecord(document)) {
    return ['does not contain a YAML mapping at the top level'];
  }
  return document;
}

/** Returns one message per violation, each phrased to follow the file's path. */
export function checkWorkflow(source: string): DocumentResult {
  const parsed = parseDocument(source);
  if (Array.isArray(parsed)) {
    return {
      problems: parsed,
      localReferences: new Set(),
      localWorkflowReferences: new Set(),
    };
  }
  const workflow = parsed as Record<string, unknown>;

  const problems: string[] = [];
  const references: WorkflowReferences = {
    localActionReferences: new Set(),
    localWorkflowReferences: new Set(),
  };

  checkWorkflowTriggersAndPermissions(workflow, problems);

  const jobs = workflow['jobs'];
  if (!isRecord(jobs)) {
    problems.push('declares no `jobs` mapping');
    return {
      problems,
      localReferences: references.localActionReferences,
      localWorkflowReferences: references.localWorkflowReferences,
    };
  }
  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isRecord(job)) {
      problems.push(`job \`${jobName}\` is not a mapping`);
      continue;
    }
    checkJob(jobName, job, problems, references);
  }
  return {
    problems,
    localReferences: references.localActionReferences,
    localWorkflowReferences: references.localWorkflowReferences,
  };
}

/** The same step rules, applied to a composite action's `runs.steps`. */
export function checkActionManifest(source: string): DocumentResult {
  const parsed = parseDocument(source);
  if (Array.isArray(parsed)) {
    return {
      problems: parsed,
      localReferences: new Set(),
      localWorkflowReferences: new Set(),
    };
  }
  const manifest = parsed as Record<string, unknown>;

  const problems: string[] = [];
  const localReferences = new Set<string>();
  const localWorkflowReferences = new Set<string>();
  const runs = manifest['runs'];
  if (!isRecord(runs)) {
    problems.push('declares no `runs` mapping');
    return { problems, localReferences, localWorkflowReferences };
  }
  checkSteps('this action', runs, problems, localReferences);
  return { problems, localReferences, localWorkflowReferences };
}

interface ScanResult {
  readonly problems: string[];
  readonly referencedActions: Set<string>;
  readonly referencedWorkflows: Set<string>;
}

function scanDocuments(
  documents: readonly PolicySource[],
  scannedActions: ReadonlySet<string>,
): ScanResult {
  const result: ScanResult = {
    problems: [],
    referencedActions: new Set(),
    referencedWorkflows: new Set(),
  };
  for (const document of documents) {
    const parsed = scannedActions.has(document.path)
      ? checkActionManifest(document.source)
      : checkWorkflow(document.source);
    for (const problem of parsed.problems) {
      result.problems.push(`${document.path} ${problem}`);
    }
    for (const reference of parsed.localReferences) {
      result.referencedActions.add(reference);
    }
    for (const reference of parsed.localWorkflowReferences) {
      result.referencedWorkflows.add(reference);
    }
  }
  return result;
}

function missingActionProblems(
  references: ReadonlySet<string>,
  scanned: ReadonlySet<string>,
): readonly string[] {
  return [...references]
    .filter((reference) => !scanned.has(reference))
    .map(
      (reference) =>
        `A workflow references the local action \`./${reference}\`, which was not among the ` +
        `scanned manifests. Its steps would run in CI without passing these rules; put the ` +
        `action under .github/actions/ so it is checked too.`,
    );
}

function missingWorkflowProblems(
  references: ReadonlySet<string>,
  scanned: ReadonlySet<string>,
): readonly string[] {
  return [...references]
    .filter((reference) => !scanned.has(reference))
    .map(
      (reference) =>
        `A workflow references local reusable workflow \`./${reference}\`, which ` +
        `was not among the scanned workflow files. Its jobs would run in CI ` +
        `without passing these rules; put the workflow under .github/workflows/.`,
    );
}

/**
 * @param workflows - every file under `.github/workflows`.
 * @param actions - every `action.yml` under `.github/actions`, keyed by the
 *   directory a workflow would reference (`.github/actions/setup`).
 */
export function checkWorkflows(
  workflows: readonly PolicySource[],
  actions: readonly PolicySource[] = [],
): readonly string[] {
  if (workflows.length === 0) {
    return ['No workflow files were found under .github/workflows.'];
  }

  const scannedActions = new Set(actions.map((action) => action.path));
  const scannedWorkflows = new Set(workflows.map((workflow) => workflow.path));
  const scanned = scanDocuments([...workflows, ...actions], scannedActions);
  return [
    ...scanned.problems,
    ...missingActionProblems(scanned.referencedActions, scannedActions),
    ...missingWorkflowProblems(scanned.referencedWorkflows, scannedWorkflows),
  ];
}
