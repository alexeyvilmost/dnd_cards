import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {checkCanonicalReceiptScenario} from '../release/rehearsal-scenarios-local.mjs';

const required=['canonical-pending-choice','read-without-mutation','decode-accepted-receipt','duplicate-accepted-twice','continue-pending-choice','duplicate-continuation'];
export function verifyRehearsalScenarioReport(report,runId){
  assert.equal(report?.schemaVersion,1);
  assert.equal(report.status,'passed');
  assert.equal(report.execution,'native-owned-api');
  assert.equal(report.runId,runId);
  assert.deepEqual(report.checks,required);
  for(const key of ['pendingHash','acceptedHash','continuedHash','invariantHash'])assert.match(report[key],/^sha256:[a-f0-9]{64}$/);
  return report;
}

// Uses the runner's already-started stack. Never builds/starts/stops a second
// environment, and never upgrades this native evidence to an OCI receipt.
export async function checkRehearsalScenario(stack){
  const report=verifyRehearsalScenarioReport(await checkCanonicalReceiptScenario(stack),stack.registry.runId);
  await writeFile(path.join(stack.registry.directory,'rehearsal-scenario-native.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
