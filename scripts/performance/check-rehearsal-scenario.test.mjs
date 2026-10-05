import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRehearsalScenarioReport} from './check-rehearsal-scenario.mjs';
const fixture=()=>({schemaVersion:1,status:'passed',execution:'native-owned-api',runId:'test_fixture',checks:['canonical-pending-choice','read-without-mutation','decode-accepted-receipt','duplicate-accepted-twice','continue-pending-choice','duplicate-continuation'],...Object.fromEntries(['pendingHash','acceptedHash','continuedHash','invariantHash'].map(key=>[key,`sha256:${'a'.repeat(64)}`]))});
test('native candidate scenario receipt requires every real contract and exact owned run',()=>{
  assert.equal(verifyRehearsalScenarioReport(fixture(),'test_fixture').checks.length,6);
  for(const mutate of [r=>{r.checks=[];},r=>{r.checks.pop();},r=>{r.checks[3]='duplicate-continuation';},r=>{r.runId='another';},r=>{r.execution='docker';},r=>{r.status='skipped';},r=>{r.invariantHash='missing';}]){
    const bad=fixture();mutate(bad);assert.throws(()=>verifyRehearsalScenarioReport(bad,'test_fixture'));
  }
});
