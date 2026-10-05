import test from 'node:test';
import assert from 'node:assert/strict';
import {isWindowsGoListCleanup, isWindowsGoCompileCleanup, listGoTests, compileGoPackages} from './go-test-list.mjs';

const env = {TEMP: 'C:\\fixture\\Temp'};
const packageName = 'dnd-cards-backend/itemsource';
const output = 'TestAlpha\nTestBeta\nok  \tdnd-cards-backend/itemsource\t8.280s\ngo: unlinkat C:\\fixture\\Temp\\go-build2490738091\\b001\\itemsource.test.exe: Access is denied.\n';
const failure = () => Object.assign(Error('go.exe exited 1'), {code: 1, output});
const context = {platform: 'win32', packageName, env};
const options = invoke => ({invoke, id: 'go-itemsource', go: 'go.exe', packagePath: './itemsource', packageName,
  settings: {cwd: 'C:\\fixture\\backend', env}, platform: 'win32', wait: async () => {}});

test('only the exact Windows list cleanup failure is eligible, never test or compiler failures', () => {
  assert.equal(isWindowsGoListCleanup(failure(), context), true);
  for (const [error, settings] of [
    [failure(), {...context, platform: 'linux'}],
    [failure(), {...context, packageName: 'different/package'}],
    [failure(), {...context, env: {TEMP: 'C:\\other'}}],
    [Object.assign(failure(), {code: 2}), context],
    [Object.assign(failure(), {output: output + 'FAIL\n'}), context],
    [Object.assign(failure(), {output: output + 'panic: failed\n'}), context],
    [Object.assign(failure(), {output: output + '# package\nfile.go:1: syntax error\n'}), context],
    [Object.assign(failure(), {output: output.replace('itemsource.test.exe', 'data.json')}), context],
    [Object.assign(failure(), {output: output.replace('go-build2490738091', '..\\private')}), context],
    [Object.assign(failure(), {output: output.replace('Access is denied.', 'The system cannot find the file specified.')}), context],
    [Object.assign(failure(), {output: output.replace('TestBeta\n', 'TestAlpha\n')}), context],
  ]) assert.equal(isWindowsGoListCleanup(error, settings), false);
});

test('one successful real-command retry replaces failed discovery names and keeps both log identifiers', async () => {
  const calls = [], fresh = 'TestFresh\nok  \tdnd-cards-backend/itemsource\t0.020s\n';
  const configuration = options(async (...args) => {calls.push(args); if (calls.length === 1) throw failure(); return fresh;});
  let waits = 0; configuration.wait = async () => {waits++;};
  const result = await listGoTests(configuration);
  assert.deepEqual(result, {output: fresh, attempts: 2, retryReason: 'windows-go-list-cleanup'});
  assert.deepEqual(calls.map(row => row[0]), ['go-itemsource-list', 'go-itemsource-list-retry-2']);
  assert.deepEqual(calls.map(row => row.slice(1)), [
    ['go.exe', ['test', './itemsource', '-list', '^Test'], configuration.settings],
    ['go.exe', ['test', './itemsource', '-list', '^Test'], configuration.settings],
  ]);
  assert.equal(waits, 1);
});

test('a second cleanup failure remains failure, and other errors never retry', async () => {
  let calls = 0;
  await assert.rejects(listGoTests(options(async () => {calls++; throw failure();})), /exited 1/);
  assert.equal(calls, 2);
  for (const error of [Object.assign(failure(), {output: output + 'FAIL\n'}), Object.assign(Error('aborted'), {code: 'ABORT_ERR'})]) {
    calls = 0;
    await assert.rejects(listGoTests(options(async () => {calls++; throw error;})), value => value === error);
    assert.equal(calls, 1);
  }
});

test('successful discovery is not retried; cancellation prevents a retry', async () => {
  let calls = 0;
  assert.deepEqual(await listGoTests(options(async () => {calls++; return 'TestFresh\n';})), {output: 'TestFresh\n', attempts: 1});
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort(); calls = 0;
  const configuration = options(async () => {calls++; throw failure();}); configuration.settings.signal = controller.signal;
  await assert.rejects(listGoTests(configuration), /exited 1/); assert.equal(calls, 1);
});

const compileOutput = 'ok  \tdnd-cards-backend\t0.707s [no tests to run]\n'
  + 'ok  \tdnd-cards-backend/itemsource\t(cached) [no tests to run]\n'
  + '?  \tdnd-cards-backend/passivepresentation\t[no test files]\n'
  + output.split('\n').find(line => line.startsWith('go:')) + '\n';
const packages = ['dnd-cards-backend', packageName, 'dnd-cards-backend/passivepresentation'];
const compileFailure = () => Object.assign(failure(), {output: compileOutput});

test('compile-only retry requires the complete exact package set and explicit no-tests outcomes', () => {
  const context = {platform: 'win32', env, packages};
  assert.equal(isWindowsGoCompileCleanup(compileFailure(), context), true);
  for (const [error, config] of [
    [compileFailure(), {...context, packages: [...packages, 'dnd-cards-backend/missing']}],
    [compileFailure(), {...context, packages: packages.slice(1)}],
    [compileFailure(), {...context, packages: [...packages, packages[0]]}],
    [compileFailure(), {...context, platform: 'linux'}],
    [Object.assign(compileFailure(), {output: compileOutput.replace(' [no tests to run]', '')}), context],
    [Object.assign(compileFailure(), {output: compileOutput + 'FAIL\n'}), context],
    [Object.assign(compileFailure(), {output: compileOutput + '? unknown [build failed]\n'}), context],
  ]) assert.equal(isWindowsGoCompileCleanup(error, config), false);
});

test('compile-only retry enumerates packages and runs the real fixed command again once', async () => {
  const calls = [], settings = {env}, invoke = async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw compileFailure();
    return calls.length === 2 ? packages.join('\n') : compileOutput.split('\ngo:')[0];
  };
  const result = await compileGoPackages({invoke, go: 'go.exe', settings, platform: 'win32', wait: async () => {}});
  assert.deepEqual(result, {attempts: 2, retryReason: 'windows-go-compile-cleanup'});
  assert.deepEqual(calls, [
    ['backend-compile', 'go.exe', ['test', './...', '-run', '^$'], settings],
    ['go-packages-before-compile-retry', 'go.exe', ['list', './...'], settings],
    ['backend-compile-retry-2', 'go.exe', ['test', './...', '-run', '^$'], settings],
  ]);
});

test('compile-only missing packages, package-list failure and second cleanup failure remain failures', async () => {
  for (const failureMode of ['missing-package', 'list-failed', 'second-cleanup']) {
    let calls = 0;
    const invoke = async () => {
      calls++;
      if (calls === 1 || calls === 3) throw compileFailure();
      if (failureMode === 'list-failed') throw Error('go list failed');
      return (failureMode === 'missing-package' ? [...packages, 'dnd-cards-backend/missing'] : packages).join('\n');
    };
    await assert.rejects(compileGoPackages({invoke, go: 'go.exe', settings: {env}, platform: 'win32', wait: async () => {}}));
    assert.equal(calls, failureMode === 'second-cleanup' ? 3 : 2);
  }
});
