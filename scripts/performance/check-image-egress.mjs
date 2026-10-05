import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {startTestStack} from '../testing/stack.mjs';
import {createScenarioAPI,createRunFixture,assertSame} from './scenarios.mjs';

export async function checkImageEgress(stack,_options={},tools={}) {
  const context=await localAcceptanceContext(stack.env),api=await createScenarioAPI(context);
  const fixture=await createRunFixture(context,{api});
  const before=await api.request('GET',`/characters-v3/${fixture.sources[0].id}`);
  const required=await runRequiredGo({...stack,env:{...stack.env,
    PERFORMANCE_EGRESS_FIXTURE:JSON.stringify({RunID:fixture.run.id,UserID:api.user.id}),
  }},{tests:['TestImageEgressFailureDoesNotBlockActualGameplay'],go:tools.go});
  assertSame(await api.request('GET',`/characters-v3/${fixture.sources[0].id}`),before,'Egress isolation scenario changed source character');
  const report=JSON.parse(await readFile(path.join(context.registry.directory,'image-egress-isolation.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.gameplayCommands,3);assert.equal(report.exactReceiptReplays,3);
  assert.equal(report.externalProviderRequests,0);assert.equal(report.directAttempts,0);assert.ok(report.workerCalls>=3);
  return {...report,required,sourceUnchanged:true,artifactHash:stack.registry.artifactHash};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const stack=await startTestStack({profile:'integration',reuseBuild:true});
  try {console.log(JSON.stringify({runId:stack.registry.runId,result:await checkImageEgress(stack)}));}
  finally {await stack.cleanup();}
}
