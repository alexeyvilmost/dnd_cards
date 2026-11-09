// The receipt may expose only fixed internal identifiers, never exception text,
// addresses, paths, request bodies or caller-provided object properties.
const details = new WeakMap();
const phases = new Set([
  'identity-fixture', 'candidate-start', 'previous-start', 'identity-cleanup',
  'candidate-observation', 'previous-observation', 'ownership', 'retained-history',
  'probe-fixture', 'probe-preflight', 'probe-execution', 'probe-cleanup',
  'outcome', 'candidate-restore', 'final-validation',
]);
const outcomes = new Set([
  'compact-receipt-cross-image-retry', 'image-job-cross-image-retry',
  'frontend-pending-job-reload', 'expanded-data-dump-restore',
  'enabled-off-enabled-rollback',
]);

export function markWriterFailure(error, { phase, outcome, cleanupFailed = false, candidateRestoreFailed = false } = {}) {
  // Preserve branded Docker/request errors and their original causes unchanged.
  const failure = error instanceof Error ? error : new Error('Writer compatibility step failed');
  const previous = details.get(failure) ?? {};
  const next = { ...previous };
  if (!next.phase && phases.has(phase)) next.phase = phase;
  if (!next.outcome && outcomes.has(outcome)) next.outcome = outcome;
  if (cleanupFailed === true) next.cleanupFailed = true;
  if (candidateRestoreFailed === true) next.candidateRestoreFailed = true;
  if (Object.keys(next).length) details.set(failure, Object.freeze(next));
  return failure;
}

export function safeWriterFailure(error) {
  const value = error instanceof Error ? details.get(error) : undefined;
  return value ? { ...value } : undefined;
}
