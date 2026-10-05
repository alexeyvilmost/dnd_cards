import {startTestStack} from '../testing/stack.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI,createRunFixture} from './scenarios.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function checkCatalog(stack,{unitOnly=false}={}) {
  let testStack=stack;
  if(!unitOnly){
    if(!stack.env.TEST_WORKER_TOKEN)throw Error('Owned full stack worker credentials are required for catalog differential');
    const context=await localAcceptanceContext(stack.env),api=await createScenarioAPI(context),ids=[];
    for(const partySize of [1,2,6]){const fixture=await createRunFixture(context,{partySize,api});await fixture.command('start_encounter');ids.push(fixture.run.id);}
    testStack={...stack,env:{...stack.env,PERFORMANCE_CATALOG_RUN_IDS:JSON.stringify(ids),RULES_WORKER_URL:stack.env.TEST_WORKER_ORIGIN,RULES_WORKER_TOKEN:stack.env.TEST_WORKER_TOKEN}};
  }
  return runRequiredGo(testStack,{tests:['TestCatalogBatchWaveMatchesLegacyAndDeduplicatesSQL','TestCatalogBatchMissingUnknownAliasesAndEmptyCompleteness','TestRoguelikeCatalogSpellAliasesAreUniqueAndExactReferencesWin',...(!unitOnly?['TestCatalogBatchActualWorkerEquivalentForOwnedFixtures']:[])]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const unitOnly=process.argv.includes('--unit-only');
  const stack=await startTestStack({dbOnly:unitOnly,profile:'integration',reuseBuild:true});
  try {console.log(JSON.stringify({runId:stack.registry.runId,result:await checkCatalog(stack,{unitOnly})}));}
  finally{await stack.cleanup();}
}
