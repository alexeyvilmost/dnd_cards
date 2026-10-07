import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readSuites, selectGroups, catalogTests, resolveGoTests, verifyVitestResult, verifyNodeResult, verifyPlaywrightResult, matches, manifestPath} from './suites.mjs';
import {classifyPath} from '../release/plan-components.mjs';
import {repositoryRoot,cleanEnvironment} from './runtime.mjs';
import {assertRequiredGoResults} from './guards.mjs';
import {spawnSync} from 'node:child_process';

function plan(...paths) {
  return {components: Object.fromEntries(['frontend','backend','worker','infrastructure'].map(component => [component, paths.some(file => classifyPath(file).components.includes(component))]))};
}
const selected = (...paths) => selectGroups(readSuites().manifest, plan(...paths)).selected.map(group => group.id);
test('manifest resolves every required selector to a real file before execution', () => {
  const {manifest, hash} = readSuites(); assert.ok(manifest.groups.length > 5); assert.match(hash, /^[a-f0-9]{64}$/);
  const directory = mkdtempSync(path.join(tmpdir(), 'suite-negative-'));
  try {
    const bad = JSON.parse(readFileSync(manifestPath, 'utf8')); bad.groups[0].files = ['scripts/testing/does-not-exist.test.mjs'];
    const file = path.join(directory, 'bad.json'); writeFileSync(file, JSON.stringify(bad));
    assert.throws(() => readSuites(file), /Missing required test file/);
    bad.groups[0].files = []; writeFileSync(file, JSON.stringify(bad)); assert.throws(() => readSuites(file), /Empty required selector/);
  } finally {
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith('suite-negative-'));
    rmSync(directory, {recursive: true, force: true});
  }
});
test('implementation and shared input changes select worker without a changed test file', () => {
  for (const file of ['frontend/src/engine/execute.ts','backend/animationpresentation/catalog.json','frontend/package-lock.json','frontend/tsconfig.json']) {
    assert.ok(selected(file).includes('worker-contracts'), file);
    assert.ok(selected(file).includes('runtime-core'), file);
  }
});
test('unknown changes select all core and docs-only remains explicit', () => {
  const {manifest} = readSuites();
  assert.equal(selected('unknown-new-source.data').length, manifest.groups.length);
  assert.deepEqual(selected('docs/readme.md'), ['selection-security']);
  assert.equal(selectGroups(manifest, plan('docs/readme.md'), {suite:'extended'}).selected.length, manifest.groups.length);
  const ui = selected('frontend/src/pages/CharacterForgePage.tsx');
  assert.ok(ui.includes('backend-auth-ownership')); assert.ok(ui.includes('ui-auth')); assert.ok(ui.includes('local-api-spine'));
});
test('removal/rename uses both source component boundaries supplied by common planner', () => {
  const removed = selected('frontend/src/engine/removed.ts'); assert.ok(removed.includes('worker-contracts'));
  const renamed = selected('frontend/src/engine/moved.ts', 'frontend/src/pages/moved.tsx');
  assert.ok(renamed.includes('runtime-core')); assert.ok(renamed.includes('worker-contracts'));
});
test('legacy diagnostics require explicit ID and external/quarantined suites cannot run', () => {
  const {manifest} = readSuites();
  assert.throws(() => selectGroups(manifest, plan(), {suite:'nonexistent'}), /Unknown suite/);
  assert.throws(() => selectGroups(manifest, plan(), {suite:'legacy-manual'}), /explicit known/);
  for (const select of ['live-probes','python-http-quarantine']) assert.throws(() => selectGroups(manifest, plan(), {suite:'legacy-manual',select}), /unavailable/);
  assert.equal(selectGroups(manifest, plan(), {suite:'legacy-manual', select:'entity-certificates'}).selected[0].selection_reason, 'explicit-legacy-diagnostic');
  assert.ok(matches('frontend/src/rules-core/coverage/a.test.ts','frontend/src/rules-core/coverage/**'));
  assert.ok(!manifest.legacy_manual.some(group => group.patterns.some(pattern => matches('frontend/src/mvp/execute.test.ts', pattern))));
  const external=manifest.legacy_manual.find(group=>group.id==='live-probes');
  assert.ok(external.patterns.some(pattern=>matches('frontend/src/mvp/autoBuild.canon.mvp.test.ts',pattern)));
  assert.ok(!external.patterns.some(pattern=>matches('frontend/src/canon/liveMicroMvpCompiledCertification.test.ts',pattern)), 'Pure local compiler contract remains mandatory despite live in its name');
});
test('Go selection rejects each empty mandatory prefix and resolves exact names', () => {
  assert.deepEqual(resolveGoTests(['TestA1','TestA2','TestB','BenchmarkA'], ['TestA']), ['TestA1','TestA2']);
  assert.throws(() => resolveGoTests(['TestA1'], ['TestA','TestMissing']), /zero tests/);
  assert.throws(() => resolveGoTests(['TestA1'], []), /Empty/);
});

test('fixture unit tests containing playwright in their filename still run in Vitest', () => {
  const {manifest}=readSuites();
  const row=catalogTests(manifest).find(row=>row.file==='frontend/test-fixtures/playwright-certified-condition-release.test.ts');
  assert.equal(row?.runner,'vitest');assert.equal(row?.tier,'extended');
});
test('full-stack Go cases are mandatory dedicated gates, not retired diagnostics', () => {
  const {manifest}=readSuites();
  const route=manifest.dedicated_go_routes.find(row=>row.test==='TestCatalogBatchActualWorkerEquivalentForOwnedFixtures');
  assert.equal(route?.tier,'extended');
  assert.equal(route?.gate,'catalog-equivalence');
  assert.ok(!manifest.legacy_manual.flatMap(row=>row.go_cases??[]).some(row=>row.test===route.test));
  const cache=manifest.dedicated_go_routes.find(row=>row.test==='TestPreparationCatalogActualWorkerColdWarmAndEvictedEquality');
  assert.equal(cache?.gate,'preparation-cache-equivalence');
  for(const dedicated of manifest.dedicated_go_routes) {
    const gate=manifest.extended_gates.find(gate=>gate.id===dedicated.gate);
    assert.equal(gate?.script,dedicated.script);
    assert.ok(!manifest.legacy_manual.flatMap(row=>row.go_cases??[]).some(row=>row.test===dedicated.test));
  }
});
test('ordinary extended workload requires the complete historical chain and authentic input guards', () => {
  const {manifest}=readSuites();
  const gate=manifest.extended_gates.find(row=>row.id==='historical-fresh-chain');
  assert.equal(gate?.script,'scripts/performance/check-historical-fresh.mjs');
  assert.equal(gate?.export,'checkHistoricalFresh');
  const catalog=catalogTests(manifest);
  const input=catalog.find(row=>row.file==='scripts/testing/historical-revocation-source.test.mjs');
  assert.equal(input?.tier,'core');
  assert.equal(input?.suite,'selection-security');
  assert.ok(!manifest.legacy_manual.some(row=>row.patterns.some(pattern=>matches(gate.script,pattern))));
});
test('Vitest receipts reject missing files, zero tests and skipped assertions', () => {
  const file = 'frontend/src/api/imageErrors.test.ts';
  const report = {success:true, numTotalTests:1, numPassedTests:1, testResults:[{name:path.join(repositoryRoot,file), assertionResults:[{status:'passed'}]}]};
  assert.equal(verifyVitestResult(report, [file]).passed, 1);
  assert.throws(() => verifyVitestResult({...report, numTotalTests:0}, [file]));
  assert.throws(() => verifyVitestResult({...report, numPendingTests:1}, [file]));
  assert.throws(() => verifyVitestResult({...report, testResults:[]}, [file]));
  assert.throws(() => verifyVitestResult({...report, testResults:[{...report.testResults[0],assertionResults:[{status:'pending'}]}]}, [file]));
});
test('Node receipts reject zero, skipped, cancelled and failed tests', () => {
  const pass = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(verifyNodeResult(pass), {tests:1,passed:1,skipped:0});
  for (const changed of [pass.replace('# tests 1','# tests 0'), pass.replace('# skipped 0','# skipped 1'), pass.replace('# fail 0','# fail 1'), pass.replace('# cancelled 0','# cancelled 1'), '']) assert.throws(() => verifyNodeResult(changed));
});
test('browser receipts reject missing files, skipped outcomes and retries', () => {
  const file='frontend/e2e-local/main-flows.spec.ts';
  const report={config:{rootDir:path.join(repositoryRoot,'frontend/e2e-local'),projects:[{name:'owned'}]},
    suites:[{file:'main-flows.spec.ts',specs:[{file:'main-flows.spec.ts',tests:[{expectedStatus:'passed',status:'expected',results:[{status:'passed'}]}]}]}]};
  assert.equal(verifyPlaywrightResult(report,[file]).tests,1);
  assert.throws(()=>verifyPlaywrightResult({...report,suites:[]},[file]));
  assert.throws(()=>verifyPlaywrightResult(report,['frontend/e2e-local/missing.spec.ts']));
  for (const test of [
    {expectedStatus:'skipped',status:'skipped',results:[{status:'skipped'}]},
    {expectedStatus:'passed',status:'expected',results:[{status:'failed'},{status:'passed'}]},
    {expectedStatus:'failed',status:'expected',results:[{status:'failed'}]},
  ]) assert.throws(()=>verifyPlaywrightResult({...report,suites:[{file:'main-flows.spec.ts',specs:[{tests:[test]}]}]},[file]));
});

test('required Go parent PASS cannot conceal a skipped required subtest', () => {
  const output = [{Test:'TestRequired/second_entity',Action:'skip'}, {Test:'TestRequired',Action:'pass'}].map(JSON.stringify).join('\n');
  assert.throws(() => assertRequiredGoResults(output, ['TestRequired']), /second_entity/);
});

test('Urvin entry guards are ordinary local tests and the real scenarios remain mandatory', () => {
  const {manifest}=readSuites();
  assert.ok(manifest.extended_gates.some(gate=>gate.id==='urvin-owned-journey'&&gate.export==='checkUrvinAcceptance'));
  for (const file of ['scripts/roguelike/urvin-local.test.mjs','scripts/roguelike/urvin-rooms-local.test.mjs']) {
    assert.ok(!manifest.legacy_manual.some(group=>group.patterns.some(pattern=>matches(file,pattern))));
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:repositoryRoot,env:cleanEnvironment(),encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);assert.equal(verifyNodeResult(result.stdout).passed,1);
    assert.doesNotMatch(result.stderr,/fetch failed|ECONNREFUSED/);
  }
});


test('observed full-schema adoption runs through its required owned gate and runtime bulk regressions remain core', () => {
  const {manifest}=readSuites();
  const name='TestSupportedObservedLegacyBaseline';
  const routes=manifest.dedicated_go_routes.filter(row=>row.test===name);
  assert.equal(routes.length,1);
  assert.deepEqual({package:routes[0].package,file:routes[0].file,tier:routes[0].tier,gate:routes[0].gate},
    {package:'./migrations',file:'backend/migrations/release_baseline_test.go',tier:'extended',gate:'observed-legacy-baseline'});
  const gates=manifest.extended_gates.filter(row=>row.id===routes[0].gate);
  assert.equal(gates.length,1);assert.equal(gates[0].script,routes[0].script);assert.equal(gates[0].export,'checkObservedBaseline');
  assert.ok(!manifest.legacy_manual.flatMap(row=>row.go_cases??[]).some(row=>row.test===name));
  const bulk=catalogTests(manifest).find(row=>row.file==='frontend/src/api/runtimeCards.test.ts');
  assert.equal(bulk?.runner,'vitest');assert.equal(bulk?.tier,'core');
  const selectedGroups=selectGroups(manifest,plan('frontend/src/api/client.ts')).selected;
  assert.ok(selectedGroups.some(group=>(group.files??[]).includes(bulk.file)));
});
