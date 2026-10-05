import path from 'node:path';

const sourcePattern = /^frontend\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:test|spec)\.tsx?$/;
const statuses = new Set(['failed', 'pending', 'todo']);
const positive = value => Number.isSafeInteger(value) && value > 0;

// Public diagnostics retain selected source files and coordinates only. The
// original JSON remains private because failure messages may contain DOM/data.
export function safeVitestFailureDiagnostics(report, {files, root}) {
  if (!report || !Array.isArray(report.testResults)) throw Error('Invalid Vitest diagnostic report');
  const api = /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path.posix;
  const allowed = new Set(files.filter(file => sourcePattern.test(file)));
  function normalize(value) {
    if (typeof value !== 'string') return null;
    const relative = (api.isAbsolute(value) ? api.relative(root, value) : value).replaceAll('\\', '/');
    const candidates = [relative, path.posix.normalize(`frontend/${relative}`)];
    return candidates.find(file => allowed.has(file) && sourcePattern.test(file)) ?? null;
  }
  const failures = [];
  for (const suite of report.testResults) {
    if (!suite || typeof suite !== 'object' || !Array.isArray(suite.assertionResults)) throw Error('Invalid Vitest diagnostic suite');
    const file = normalize(suite.name);
    if (!file) continue;
    const assertions = suite.assertionResults.filter(assertion => statuses.has(assertion?.status));
    if (suite.status !== 'failed' && !assertions.length) continue;
    const locations = [];
    for (const assertion of assertions) {
      for (const message of Array.isArray(assertion.failureMessages) ? assertion.failureMessages : []) {
        if (typeof message !== 'string') continue;
        const plain = message.replace(/\x1b\[[0-9;]*m/g, '');
        for (const line of plain.split(/\r?\n/)) {
          const match = /(?:^\s*❯\s+|^\s*at\s+(?:.*?\()?)(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
          if (!match || normalize(match[1]) !== file) continue;
          const sourceLine = Number(match[2]), column = Number(match[3]);
          if (positive(sourceLine) && positive(column)) locations.push({file, line: sourceLine, column});
        }
      }
    }
    const row = {file, status: 'failed', failedAssertions: assertions.filter(assertion => assertion.status === 'failed').length};
    if (locations.length) row.errorLocations = [...new Map(locations.map(location => [JSON.stringify(location), location])).values()].slice(0, 100);
    failures.push(row);
    if (failures.length === 100) break;
  }
  return {schemaVersion: 1, kind: 'safe-vitest-source-locations', failures, rawOutputIncluded: false};
}
