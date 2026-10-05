import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {safeNodeFailureDiagnostics} from './node-failure-diagnostics.mjs';
import {cleanEnvironment} from './runtime.mjs';

const file = 'scripts/testing/example.test.mjs';
const tap = (location, extra = '') => `not ok 2 - private title must never escape\n  ---\n  duration_ms: 1\n  location: '${location}'\n  failureType: 'testCodeFailure'\n  error: 'private prompt and credential canary'\n  code: 'ERR_ASSERTION'\n${extra}  ...\n`;
test('safe Node diagnostics retain only selected test locations and static classifications', () => {
  const result = safeNodeFailureDiagnostics(tap('/repo/' + file + ':14:3'), {files: [file], root: '/repo'});
  assert.deepEqual(result, {schemaVersion: 1, kind: 'safe-node-test-locations', failures: [{file, line: 14, column: 3, failureType: 'testCodeFailure', code: 'ERR_ASSERTION'}], rawOutputIncluded: false});
  assert.doesNotMatch(JSON.stringify(result), /private|prompt|credential|duration/);
});
test('Windows and file URL locations normalize to the exact selected relative source', () => {
  for (const location of ['C:\\repo\\scripts\\testing\\example.test.mjs:2:8', 'file:///C:/repo/scripts/testing/example.test.mjs:2:8']) {
    const result = safeNodeFailureDiagnostics(tap(location), {files: [file], root: 'C:\\repo'});
    assert.equal(result.failures[0]?.file, file);
  }
});
test('unselected, traversal and private paths never enter public diagnostics', () => {
  for (const location of ['/repo/.env:1:1', '/other/scripts/testing/example.test.mjs:1:1', '/repo/scripts/testing/other.test.mjs:1:1', '../scripts/testing/example.test.mjs:1:1']) assert.deepEqual(safeNodeFailureDiagnostics(tap(location), {files: [file], root: '/repo'}).failures, []);
});
test('nested assertion data and unknown error codes cannot impersonate diagnostic fields', () => {
  const input = tap('/repo/' + file + ':4:2', "  actual: |\n    location: '/repo/scripts/testing/secret.test.mjs:1:1'\n    code: 'PRIVATE'\n").replace("code: 'ERR_ASSERTION'", "code: 'private-secret-value'");
  const result = safeNodeFailureDiagnostics(input, {files: [file], root: '/repo'});
  assert.deepEqual(result.failures, [{file, line: 4, column: 2, failureType: 'testCodeFailure'}]);
  assert.doesNotMatch(JSON.stringify(result), /secret|PRIVATE|actual/);
});
test('real failing Node TAP yields a location without exposing the assertion contents', () => {
  const root=mkdtempSync(path.join(tmpdir(),'node-diagnostics-'));
  try {
    mkdirSync(path.join(root,'scripts/testing'),{recursive:true});
    writeFileSync(path.join(root,file),"import test from 'node:test';import assert from 'node:assert/strict';test('private fixture title',()=>assert.equal('private fixture value','different private value'));\n");
    let output;
    try {execFileSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:root,env:cleanEnvironment(),stdio:['ignore','pipe','pipe'],encoding:'utf8'});assert.fail('Fixture must fail');}
    catch(error){assert.equal(error.status,1);output=error.stdout;}
    const result=safeNodeFailureDiagnostics(output,{files:[file],root});
    assert.equal(result.failures.length,1);assert.equal(result.failures[0].file,file);assert.equal(result.failures[0].code,'ERR_ASSERTION');
    assert.doesNotMatch(JSON.stringify(result),/private fixture|different private/);
  } finally {assert.ok(path.basename(root).startsWith('node-diagnostics-'));rmSync(root,{recursive:true,force:true});}
});
