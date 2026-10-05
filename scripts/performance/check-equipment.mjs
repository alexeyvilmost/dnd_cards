import {startTestStack} from '../testing/stack.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {runEquipmentLatency} from './equipment.mjs';
import {summarize} from './scenarios.mjs';

export async function checkEquipmentTransactions(stack) {
  return runRequiredGo(stack, {tests: [
    'TestEquipmentIntentStrictIdentityOnlySchema',
    'TestEquipmentCatalogStampTracksQueriesAndRightsWithoutUnrelatedRows',
    'TestEquipmentIntentPreparesWithoutRowLockAndReplaysWithoutWorker',
    'TestEquipmentIntentRejectsChangedBuildCatalogAndOwnershipAfterPreparation',
    'TestEquipmentIntentConcurrentRequestsHaveOneAtomicEffect',
    'TestEquipmentIntentRejectsRunPhaseAndPrivateStateChanges',
    'TestInitiativeOptionsAreOwnedReadOnlyAndRevisionBound',
  ]});
}

export async function checkEquipmentFlow(stack, {repetitions=1, compare=false}={}) {
  const context=await localAcceptanceContext(stack.env),output=path.join(stack.registry.directory,'equipment-intent');
  await mkdir(output,{recursive:true});
  const reports=[];
  for(const intent of compare?[false,true]:[true]) {
    const samples=[],result=await runEquipmentLatency(context,{repetitions,onSample:sample=>samples.push(sample),output,intent});
    const report={runId:stack.registry.runId,fixture:stack.registry.fixture,artifactHash:stack.registry.artifactHash,result,samples,summary:summarize(samples)};
    await writeFile(path.join(output,intent?'result.json':'compatibility.json'),JSON.stringify(report,null,2));
    reports.push({authority:result.authority,committedCommands:result.committedCommands,replayRequests:result.replayRequests,sourceIsolated:result.sourceIsolated,samples:samples.length});
  }
  return reports;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const full=process.argv.includes('--full');
  const stack = await startTestStack({dbOnly: !full, profile: 'integration', reuseBuild: true, equipmentIntent:full,performance:full});
  try {
    const transactions=await checkEquipmentTransactions(stack);
    const flow=full?await checkEquipmentFlow(stack,{repetitions:process.argv.includes('--measure')?30:1,compare:process.argv.includes('--compare')}):null;
    console.log(JSON.stringify({runId: stack.registry.runId, result:transactions,full,flow}));
  }
  finally {await stack.cleanup();}
}
