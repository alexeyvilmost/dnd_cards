import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {safeBrowserFailureDiagnostics} from './browser-failure-diagnostics.mjs';

const file = 'frontend/e2e/battle-3d.spec.ts';
const settings = {files: [file], root: '/work/project', testDirectory: 'frontend/e2e'};
const spec = (file, status = 'failed') => ({file, line: 17, column: 1, tests: [{results: [{status}]}]});

test('browser diagnostics retain selected source locations and fixed failure statuses only', () => {
  const data = spec('battle-3d.spec.ts', 'timedOut');
  data.title = 'private title';
  data.tests[0].projectName = 'private project';
  data.tests[0].results[0].errors = [{message: 'private SQL, credentials and assertion values', stack: 'private stack'}];
  data.tests[0].results[0].attachments = [{path: '/private/screenshot.png', body: 'private body'}];
  const actual = safeBrowserFailureDiagnostics({suites: [{suites: [{specs: [data]}]}], errors: [{message: 'private global error'}]}, settings);
  assert.deepEqual(actual, {schemaVersion: 1, kind: 'safe-browser-source-locations', failures: [{file, line: 17, column: 1, status: 'timedOut'}], rawOutputIncluded: false});
  assert.ok(!JSON.stringify(actual).includes('private'));
});

test('browser diagnostics normalize actual Linux and Windows source paths and reject other files', () => {
  for (const root of ['/work/project', 'C:\\work\\project']) {
    const absolute = root.startsWith('C:') ? `${root}\\frontend\\e2e\\battle-3d.spec.ts` : `${root}/${file}`;
    const suites = [{specs: [spec(absolute), spec('../../.env'), spec('other.spec.ts'), spec('battle-3d.spec.ts', 'passed'), spec('battle-3d.spec.ts', 'private-status')]}];
    assert.deepEqual(safeBrowserFailureDiagnostics({suites}, {...settings, root}).failures, [{file, line: 17, column: 1, status: 'failed'}]);
  }
});

test('browser diagnostics cannot turn missing or malformed results into pass evidence', () => {
  for (const report of [null, {}, {suites: null}, {suites: [{specs: {}}]}, {suites: [{specs: [{file}]}]}]) {
    assert.throws(() => safeBrowserFailureDiagnostics(report, settings), /Invalid browser diagnostic/);
  }
  assert.deepEqual(safeBrowserFailureDiagnostics({suites: []}, settings).failures, []);
  const data = spec('battle-3d.spec.ts');
  data.line = 'private';
  assert.deepEqual(safeBrowserFailureDiagnostics({suites: [{specs: [data]}]}, settings).failures, []);
});

test('an actual failing Playwright process produces safe locations without exposing assertion text', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dnd-browser-diagnostics-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const packageEntry = path.join(root, 'frontend/node_modules/@playwright/test/index.js').replaceAll('\\', '/');
  const resultFile = path.join(directory, 'result.json');
  try {
    writeFileSync(path.join(directory, 'playwright.config.mjs'), `export default ${JSON.stringify({testDir: directory, workers: 1, retries: 0, reporter: [['json', {outputFile: resultFile}]]})};`);
    writeFileSync(path.join(directory, 'example.spec.ts'), `import {test,expect} from ${JSON.stringify(packageEntry)};\ntest('private test name',()=>{expect('private assertion value').toBe('different value');});\n`);
    const result = spawnSync(process.execPath, [path.join(root, 'frontend/node_modules/@playwright/test/cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')], {cwd: directory, encoding: 'utf8', timeout: 30000});
    assert.equal(result.status, 1);
    const actualReport = JSON.parse(readFileSync(resultFile, 'utf8'));
    const diagnostics = safeBrowserFailureDiagnostics(actualReport, {root, files: ['frontend/e2e/example.spec.ts'], testDirectory: 'frontend/e2e'});
    assert.deepEqual(diagnostics.failures, [{file: 'frontend/e2e/example.spec.ts', line: 2, column: 5, status: 'failed'}]);
    assert.ok(!JSON.stringify(diagnostics).includes('private'));
  } finally {
    // mkdtemp returns a new absolute directory beneath the fixed task prefix.
    const target = path.resolve(directory), expectedParent = path.resolve(tmpdir());
    assert.equal(path.dirname(target), expectedParent);
    assert.ok(path.basename(target).startsWith('dnd-browser-diagnostics-'));
    rmSync(target, {recursive: true, force: true});
  }
});
