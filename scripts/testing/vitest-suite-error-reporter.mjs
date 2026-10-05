import path from 'node:path';
import {readFileSync, writeFileSync} from 'node:fs';
import {safeVitestFailureDiagnostics} from './vitest-failure-diagnostics.mjs';

const sourcePattern = /^frontend\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:test|spec)\.tsx?$/;
const kinds = new Set(['hook-timeout', 'test-timeout', 'worker-exit', 'import-resolution']);
const invalid = () => Error('Invalid Vitest suite diagnostics');
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => names.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;

function selection(settings) {
  const {root, files, runId} = settings ?? {};
  const api = typeof root === 'string' && /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path.posix;
  if (typeof root !== 'string' || !api.isAbsolute(root) || !Array.isArray(files) || !files.length || files.length > 10000
    || files.some(file => typeof file !== 'string' || !sourcePattern.test(file) || file.split('/').some(part => part === '.' || part === '..'))
    || new Set(files).size !== files.length || typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId)) throw invalid();
  const absolute = new Map(files.map(file => [api.resolve(root, file), file]));
  return {api, files: new Set(files), resolve: moduleId => typeof moduleId === 'string' && api.isAbsolute(moduleId) ? absolute.get(api.resolve(moduleId)) : undefined};
}

// Vitest 4 TestModule.children.allSuites() includes every nested describe.
// errors() is its public serialized-error API. Names, values and raw errors
// remain in memory; only the existing safe diagnostic projection is written.
export function safeVitestSuiteErrors(modules, settings) {
  const selected = selection(settings);
  if (!Array.isArray(modules)) throw invalid();
  const failures = [];
  for (const module of modules) {
    const file = selected.resolve(module?.moduleId);
    if (!file) continue;
    if (module.type !== 'module' || typeof module.errors !== 'function' || typeof module.children?.allSuites !== 'function') throw invalid();
    const messages = [];
    for (const entity of [module, ...module.children.allSuites()]) {
      if (entity !== module && (entity?.type !== 'suite' || entity.module !== module)) throw invalid();
      const errors = entity.errors();
      if (!Array.isArray(errors)) throw invalid();
      for (const error of errors) for (const field of ['message', 'stack']) if (typeof error?.[field] === 'string') messages.push(error[field]);
    }
    if (!messages.length) continue;
    const safe = safeVitestFailureDiagnostics({testResults: [{name: module.moduleId, status: 'failed', assertionResults: [], message: messages.join('\n')}]}, settings).failures[0];
    if (safe) failures.push({file, ...(safe.failureKinds ? {failureKinds: safe.failureKinds} : {}), ...(safe.errorLocations ? {errorLocations: safe.errorLocations} : {})});
    if (failures.length === 100) break;
  }
  return {schemaVersion: 1, kind: 'safe-vitest-suite-errors', runId: settings.runId, failures, rawOutputIncluded: false};
}

// Called only in the runner's failure branch. This supplement cannot replace
// the JSON result verifier, process exit code, counts or coverage requirements.
export function supplementVitestFailureDiagnostics(report, supplemental, settings) {
  const selected = selection(settings);
  const safe = safeVitestFailureDiagnostics(report, settings);
  if (!exactKeys(supplemental, ['schemaVersion', 'kind', 'runId', 'failures', 'rawOutputIncluded'])
    || supplemental.schemaVersion !== 1 || supplemental.kind !== 'safe-vitest-suite-errors' || supplemental.runId !== settings.runId
    || supplemental.rawOutputIncluded !== false || !Array.isArray(supplemental.failures) || supplemental.failures.length > 100) throw invalid();
  const rows = new Map(safe.failures.map(row => [row.file, row]));
  const seen = new Set();
  for (const row of supplemental.failures) {
    if (!exactKeys(row, ['file', 'failureKinds', 'errorLocations']) || !selected.files.has(row.file) || seen.has(row.file)
      || (row.failureKinds !== undefined && (!Array.isArray(row.failureKinds) || row.failureKinds.length > 4 || row.failureKinds.some(kind => !kinds.has(kind))))
      || (row.errorLocations !== undefined && (!Array.isArray(row.errorLocations) || row.errorLocations.length > 100 || row.errorLocations.some(location => !exactKeys(location, ['file', 'line', 'column']) || location.file !== row.file || !positive(location.line) || !positive(location.column))))) throw invalid();
    seen.add(row.file);
    const existing = rows.get(row.file) ?? {file: row.file, status: 'failed', failedAssertions: 0};
    const mergedKinds = [...new Set([...(existing.failureKinds ?? []), ...(row.failureKinds ?? [])])];
    const locations = [...new Map([...(existing.errorLocations ?? []), ...(row.errorLocations ?? [])].map(location => [JSON.stringify(location), location])).values()].slice(0, 100);
    if (mergedKinds.length) existing.failureKinds = mergedKinds;
    if (locations.length) existing.errorLocations = locations;
    rows.set(row.file, existing);
  }
  return {...safe, failures: [...rows.values()].slice(0, 100)};
}

export default class SafeVitestSuiteErrorReporter {
  constructor() {
    try {
      this.settings = JSON.parse(readFileSync(process.env.TEST_VITEST_DIAGNOSTICS_SETTINGS, 'utf8'));
      const selected = selection(this.settings);
      if (typeof this.settings.outputFile !== 'string' || !selected.api.isAbsolute(this.settings.outputFile)) throw invalid();
    } catch { throw invalid(); }
  }
  onTestRunEnd(modules) {
    const safe = safeVitestSuiteErrors(modules, this.settings);
    // The runner allocates a fresh path and nonce; an old file is never reused.
    writeFileSync(this.settings.outputFile, JSON.stringify(safe), {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  }
}
