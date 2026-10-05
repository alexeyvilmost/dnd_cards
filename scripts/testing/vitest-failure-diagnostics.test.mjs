import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {safeVitestFailureDiagnostics} from './vitest-failure-diagnostics.mjs';

const file = 'frontend/src/example.test.ts';
const settings = {files: [file], root: '/work/project'};
const suite = (name = `/work/project/${file}`) => ({name, status: 'failed', message: 'private suite message', assertionResults: [{status: 'failed', title: 'private name', fullName: 'private full name', failureMessages: ['private assertion values\n ❯ src/example.test.ts:12:8\n at /private/.env:42:1']} ]});

test('Vitest diagnostics publish only selected failure source coordinates', () => {
  const result = safeVitestFailureDiagnostics({testResults: [suite(), suite('/private/.env'), suite('/work/project/frontend/src/other.test.ts')], private: 'secret'}, settings);
  assert.deepEqual(result, {schemaVersion: 1, kind: 'safe-vitest-source-locations', failures: [{file, status: 'failed', failedAssertions: 1, errorLocations: [{file, line: 12, column: 8}]}], rawOutputIncluded: false});
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('Vitest diagnostics handle Linux and Windows stacks, runtime suite failures and invalid coordinates', () => {
  const value = suite('C:\\work\\project\\frontend\\src\\example.test.ts');
  value.assertionResults[0].failureMessages = [' at Object.run (C:\\work\\project\\frontend\\src\\example.test.ts:23:4)\n ❯ src/example.test.ts:0:1\n ❯ src/other.test.ts:2:3'];
  assert.deepEqual(safeVitestFailureDiagnostics({testResults: [value]}, {...settings, root: 'C:\\work\\project'}).failures,
    [{file, status: 'failed', failedAssertions: 1, errorLocations: [{file, line: 23, column: 4}]}]);
  assert.deepEqual(safeVitestFailureDiagnostics({testResults: [{...suite(), assertionResults: []}]}, settings).failures,
    [{file, status: 'failed', failedAssertions: 0}]);
});

test('missing or malformed Vitest diagnostic data cannot provide a success receipt', () => {
  for (const report of [null, {}, {testResults: null}, {testResults: [null]}, {testResults: [{name: file}]}]) assert.throws(() => safeVitestFailureDiagnostics(report, settings), /Invalid Vitest diagnostic/);
  assert.deepEqual(safeVitestFailureDiagnostics({testResults: [{...suite(), status: 'passed', assertionResults: [{status: 'passed', failureMessages: ['private']}]}]}, settings).failures, []);
});

test('suite errors preserve only fixed failure categories and selected coordinates', () => {
  const value = {...suite(), assertionResults: [], message: 'Hook timed out in 30000ms. PRIVATE fixture\n ❯ src/example.test.ts:44:3\n at /private/.env:1:2'};
  assert.deepEqual(safeVitestFailureDiagnostics({testResults: [value]}, settings).failures,
    [{file, status: 'failed', failedAssertions: 0, failureKinds: ['hook-timeout'], errorLocations: [{file, line: 44, column: 3}]}]);
  for (const [message, kind] of [['Test timed out in 30000ms. PRIVATE','test-timeout'], ['Worker exited unexpectedly PRIVATE','worker-exit'], ['Cannot find module PRIVATE','import-resolution']]) {
    const result = safeVitestFailureDiagnostics({testResults: [{...value, message}]}, settings);
    assert.deepEqual(result.failures[0].failureKinds, [kind]);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('an actual failed Vitest child report yields a selected source without private values', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dnd-vitest-diagnostics-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const testFile = path.join(directory, file), resultFile = path.join(directory, 'result.json');
  try {
    mkdirSync(path.dirname(testFile), {recursive: true});
    writeFileSync(testFile, "test('private title',()=>{expect('private assertion value').toBe('different value');});\n");
    const config = path.join(directory, 'vitest.config.mjs');
    writeFileSync(config, 'export default '+JSON.stringify({test: {include: [testFile.replaceAll('\\', '/')], environment: 'node', globals: true, maxWorkers: 1, fileParallelism: false}})+';\n');
    const child = spawnSync(process.execPath, [path.join(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', `--outputFile=${resultFile}`], {cwd: path.join(root, 'frontend'), encoding: 'utf8', timeout: 30000});
    assert.equal(child.status, 1);
    const report = JSON.parse(readFileSync(resultFile, 'utf8'));
    const result = safeVitestFailureDiagnostics(report, {root: directory, files: [file]});
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].file, file);
    assert.equal(result.failures[0].failedAssertions, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
  } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('dnd-vitest-diagnostics-'));
    rmSync(target, {recursive: true, force: true});
  }
});

test('an actual beforeAll timeout is classified without publishing the hook error', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dnd-vitest-hook-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const testFile = path.join(directory, file), resultFile = path.join(directory, 'result.json');
  try {
    mkdirSync(path.dirname(testFile), {recursive: true});
    writeFileSync(testFile, "beforeAll(()=>new Promise(()=>{}),20); test('PRIVATE title',()=>{expect(true).toBe(true);});\n");
    const config = path.join(directory, 'vitest.config.mjs');
    writeFileSync(config, 'export default '+JSON.stringify({test: {include: [testFile.replaceAll('\\', '/')], environment: 'node', globals: true, maxWorkers: 1, fileParallelism: false}})+';\n');
    const child = spawnSync(process.execPath, [path.join(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', `--outputFile=${resultFile}`], {cwd: path.join(root, 'frontend'), encoding: 'utf8', timeout: 30000});
    assert.equal(child.status, 1);
    const result = safeVitestFailureDiagnostics(JSON.parse(readFileSync(resultFile, 'utf8')), {root: directory, files: [file]});
    assert.deepEqual(result.failures[0].failureKinds, ['hook-timeout']);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('dnd-vitest-hook-'));
    rmSync(target, {recursive: true, force: true});
  }
});
