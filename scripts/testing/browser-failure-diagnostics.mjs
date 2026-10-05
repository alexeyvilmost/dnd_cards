import path from 'node:path';

const sourcePattern = /^frontend\/(?:e2e|e2e-local)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.spec\.ts$/;
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);
const positive = value => Number.isSafeInteger(value) && value > 0;

/** Diagnostics only: never publish titles, errors, assertion values, traces or attachments. */
export function safeBrowserFailureDiagnostics(report, {files, root, testDirectory}) {
  if (!report || !Array.isArray(report.suites)) throw Error('Invalid browser diagnostic report');
  if (!['frontend/e2e', 'frontend/e2e-local'].includes(testDirectory)) throw Error('Invalid browser diagnostic directory');
  const api = /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path.posix;
  const allowed = new Set(files.filter(file => sourcePattern.test(file)));
  const failures = [];
  function normalize(value) {
    if (typeof value !== 'string') return null;
    const relative = (api.isAbsolute(value) ? api.relative(root, value) : value).replaceAll('\\', '/');
    const candidates = [relative, path.posix.normalize(`${testDirectory}/${relative}`)];
    return candidates.find(file => allowed.has(file) && sourcePattern.test(file)) ?? null;
  }
  function visit(suite) {
    if (!suite || typeof suite !== 'object' || suite.specs !== undefined && !Array.isArray(suite.specs)
      || suite.suites !== undefined && !Array.isArray(suite.suites)) throw Error('Invalid browser diagnostic suite');
    for (const spec of suite.specs ?? []) {
      if (!spec || typeof spec !== 'object' || !Array.isArray(spec.tests)) throw Error('Invalid browser diagnostic spec');
      const file = normalize(spec.file);
      for (const test of spec.tests) {
        if (!test || !Array.isArray(test.results)) throw Error('Invalid browser diagnostic results');
        for (const result of test.results) {
          if (!result || typeof result !== 'object') throw Error('Invalid browser diagnostic result');
          if (!file || !positive(spec.line) || !positive(spec.column) || !failureStatuses.has(result.status)) continue;
          const row = {file, line: spec.line, column: spec.column, status: result.status};
          if (!failures.some(previous => JSON.stringify(previous) === JSON.stringify(row))) failures.push(row);
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  return {schemaVersion: 1, kind: 'safe-browser-source-locations', failures, rawOutputIncluded: false};
}
