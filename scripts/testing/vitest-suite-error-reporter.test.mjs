import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import Reporter, {safeVitestSuiteErrors, supplementVitestFailureDiagnostics} from './vitest-suite-error-reporter.mjs';
import {safeVitestFailureDiagnostics} from './vitest-failure-diagnostics.mjs';

const file = 'frontend/src/example.test.ts', other = 'frontend/src/other.test.ts';
const settings = {root: '/work/project', files: [file, other], runId: '12345678-1234-1234-1234-123456789abc'};
const fakeModule = (moduleId, errors, nested = []) => {
  const module = {type: 'module', moduleId, errors: () => errors};
  module.children = {allSuites: function* () {for (const values of nested) yield {type: 'suite', module, name: 'PRIVATE suite', errors: () => values};}};
  return module;
};
const jsonResult = count => ({testResults: [{name: `${settings.root}/${file}`, status: 'failed', message: '', assertionResults: Array.from({length: count}, () => ({status: 'failed', failureMessages: []}))}]});

test('nested public suite API errors retain only selected same-file coordinates and fixed categories', () => {
  const module = fakeModule(`${settings.root}/${file}`, [], [[], [{name: 'PRIVATE name', message: 'Hook timed out in 20ms. PRIVATE secret', stack: `PRIVATE value\n at /work/project/${file}:12:8\n at /work/project/${other}:99:1\n at /private/.env:3:4`}]]);
  const result = safeVitestSuiteErrors([module], settings);
  assert.deepEqual(result, {schemaVersion: 1, kind: 'safe-vitest-suite-errors', runId: settings.runId, failures: [{file, failureKinds: ['hook-timeout'], errorLocations: [{file, line: 12, column: 8}]}], rawOutputIncluded: false});
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('module identity requires an absolute exact selected root path and validates the suite API', () => {
  const error = {message: 'PRIVATE unknown value', stack: ' at /work/project/frontend/src/example.test.ts:5:2'};
  for (const moduleId of [file, '/outside/frontend/src/example.test.ts', '/work/project/frontend/src/not-selected.test.ts']) assert.deepEqual(safeVitestSuiteErrors([fakeModule(moduleId, [error])], settings).failures, []);
  assert.deepEqual(safeVitestSuiteErrors([fakeModule('C:\\work\\project\\frontend\\src\\example.test.ts', [{message: 'Worker exited unexpectedly PRIVATE', stack: ' at C:\\work\\project\\frontend\\src\\example.test.ts:4:3'}])], {...settings, root: 'C:\\work\\project'}).failures, [{file, failureKinds: ['worker-exit'], errorLocations: [{file, line: 4, column: 3}]}]);
  for (const invalid of [{...settings, root: 'relative'}, {...settings, files: ['frontend/../example.test.ts']}, {...settings, files: [file, file]}, {...settings, runId: 'PRIVATE'}]) assert.throws(() => safeVitestSuiteErrors([], invalid), /Invalid Vitest suite diagnostics/);
  assert.throws(() => safeVitestSuiteErrors([{moduleId: `${settings.root}/${file}`, type: 'module'}], settings), /Invalid Vitest suite diagnostics/);
});

test('supplement validates its nonce and entire safe shape without replacing JSON assertion counts or authority', () => {
  const result = safeVitestSuiteErrors([fakeModule(`${settings.root}/${file}`, [{message: 'Hook timed out in 20ms PRIVATE'}])], settings);
  const merged = supplementVitestFailureDiagnostics(jsonResult(2), result, settings);
  assert.deepEqual(merged.failures, [{file, status: 'failed', failedAssertions: 2, failureKinds: ['hook-timeout']}]);
  for (const value of [null, {...result, runId: randomUUID()}, {...result, rawOutputIncluded: true}, {...result, message: 'PRIVATE'}, {...result, failures: [{file, failureKinds: ['PRIVATE']}]}, {...result, failures: [{file, errorLocations: [{file: other, line: 1, column: 2}]}]}, {...result, failures: [{file, errorLocations: [{file, line: 1, column: 2, raw: 'PRIVATE'}]}]}, {...result, failures: [{file, errorLocations: [{file, line: 0, column: 2}]}]}]) assert.throws(() => supplementVitestFailureDiagnostics(jsonResult(0), value, settings), /Invalid Vitest suite diagnostics/);
  assert.throws(() => supplementVitestFailureDiagnostics(null, result, settings), /Invalid Vitest diagnostic report/);
  assert.deepEqual(safeVitestSuiteErrors([fakeModule(`${settings.root}/${file}`, [])], settings).failures, []);
});

function actualChild(source, inspect) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dnd-vitest-nested-'));
  const root = process.env.TEST_VITEST_RUNTIME_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
  const testFile = path.join(directory, file), resultFile = path.join(directory, 'result.json'), outputFile = path.join(directory, 'suite-errors.json');
  try {
    mkdirSync(path.dirname(testFile), {recursive: true});
    writeFileSync(testFile, source);
    const config = path.join(directory, 'vitest.config.mjs'), settingsFile = path.join(directory, 'settings.json');
    const selected = {...settings, root: directory, outputFile, runId: randomUUID()};
    writeFileSync(settingsFile, JSON.stringify(selected));
    writeFileSync(config, 'export default '+JSON.stringify({test: {include: [testFile.replaceAll('\\', '/')], environment: 'node', globals: true, maxWorkers: 1, fileParallelism: false}})+';\n');
    const child = spawnSync(process.execPath, [path.join(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', `--reporter=${fileURLToPath(new URL('./vitest-suite-error-reporter.mjs', import.meta.url))}`, `--outputFile=${resultFile}`], {cwd: path.join(root, 'frontend'), env: {...process.env, TEST_VITEST_DIAGNOSTICS_SETTINGS: settingsFile}, encoding: 'utf8', timeout: 30000});
    assert.equal(child.status, 1, 'Actual deliberately failing child must remain failed');
    const report = JSON.parse(readFileSync(resultFile, 'utf8')), supplement = JSON.parse(readFileSync(outputFile, 'utf8'));
    inspect({report, supplement, selected, old: safeVitestFailureDiagnostics(report, selected), merged: supplementVitestFailureDiagnostics(report, supplement, selected)});
  } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('dnd-vitest-nested-'));
    rmSync(target, {recursive: true, force: true});
  }
}

test('actual nested describe beforeAll timeout is lost by JSON and recovered from the public suite API', () => {
  actualChild("describe('PRIVATE outer',()=>{describe('PRIVATE nested',()=>{beforeAll(()=>new Promise(()=>{}),20);test('PRIVATE case',()=>expect(true).toBe(true));});});\n", ({old, merged, report, supplement}) => {
    assert.equal(report.success, false);
    assert.equal(old.failures[0].failedAssertions, 0);
    assert.equal(old.failures[0].failureKinds, undefined, 'Pinned Vitest JSON loss is the red baseline');
    assert.deepEqual(merged.failures[0].failureKinds, ['hook-timeout']);
    assert.equal(merged.failures[0].failedAssertions, 0);
    assert.ok(merged.failures[0].errorLocations?.some(location => location.file === file && location.line === 1));
    for (const value of [supplement, merged]) assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  });
});

test('actual nested arbitrary private error cannot export names, messages, values or another selected file stack', () => {
  actualChild("describe('PRIVATE outer',()=>{describe('PRIVATE nested',()=>{beforeAll(()=>{const error=new Error('PRIVATE password SQL user payload');error.stack='PRIVATE stack\\n at /private/.env:3:4\\n at frontend/src/other.test.ts:9:2';throw error;});test('PRIVATE case',()=>expect(true).toBe(true));});});\n", ({supplement, merged}) => {
    assert.deepEqual(supplement.failures, [{file}]);
    assert.deepEqual(merged.failures, [{file, status: 'failed', failedAssertions: 0}]);
    for (const token of ['PRIVATE', 'password', 'SQL', 'payload', '.env', 'other.test']) assert.ok(!JSON.stringify(merged).includes(token));
  });
});

test('reporter refuses stale output and invalid settings instead of overwriting or inventing a success result', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dnd-vitest-nested-'));
  const previous = process.env.TEST_VITEST_DIAGNOSTICS_SETTINGS;
  try {
    const settingsFile = path.join(directory, 'settings.json'), outputFile = path.join(directory, 'safe.json');
    process.env.TEST_VITEST_DIAGNOSTICS_SETTINGS = settingsFile;
    writeFileSync(settingsFile, JSON.stringify({...settings, root: directory, outputFile}));
    const reporter = new Reporter();
    reporter.onTestRunEnd([]);
    const bytes = readFileSync(outputFile, 'utf8');
    assert.throws(() => reporter.onTestRunEnd([]), {code: 'EEXIST'});
    assert.equal(readFileSync(outputFile, 'utf8'), bytes);
    writeFileSync(settingsFile, '{PRIVATE malformed');
    assert.throws(() => new Reporter(), /^Error: Invalid Vitest suite diagnostics$/);
  } finally {
    if (previous === undefined) delete process.env.TEST_VITEST_DIAGNOSTICS_SETTINGS; else process.env.TEST_VITEST_DIAGNOSTICS_SETTINGS = previous;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('dnd-vitest-nested-'));
    rmSync(directory, {recursive: true, force: true});
  }
});
