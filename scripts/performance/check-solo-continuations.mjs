import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {soloContinuationCases} from '../testing/solo-continuation-cases.mjs';

export async function checkSoloContinuations(stack,_options={},tools={}) {
  const context=await localAcceptanceContext(stack.env),cases=soloContinuationCases();
  assert.equal(context.registry.runId,stack.registry.runId);
  assert.match(stack.registry.artifactHash,/^sha256:[a-f0-9]{64}$/);
  const file=path.join(context.registry.directory,'solo-durable-inputs.json');
  await writeFile(file,JSON.stringify({artifactHash:stack.registry.artifactHash,cases}),{mode:0o600,flag:'wx'});
  const required=await runRequiredGo({...stack,env:{...stack.env,SOLO_DURABLE_CASES_FILE:file}},
    {tests:['TestSoloDurableContinuationsActualWorkerReceipts'],go:tools.go});
  const report=JSON.parse(await readFile(path.join(context.registry.directory,'solo-durable-receipts.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.cases,222);assert.equal(report.accepted,220);assert.equal(report.boundaryRejections,2);
  assert.equal(Object.keys(report.acceptedPhases).length,17);assert.equal(report.receiptReplaysPerAcceptedCase,2);
  assert.equal(report.artifactHash,stack.registry.artifactHash);
  return {...report,required,report:path.join(context.registry.directory,'solo-durable-receipts.json')};
}
