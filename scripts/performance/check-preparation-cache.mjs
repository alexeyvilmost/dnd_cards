import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {repositoryRoot} from '../testing/runtime.mjs';
import {startTestStack} from '../testing/stack.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI} from './scenarios.mjs';

export async function checkPreparationCache(stack,{unitOnly=false}={}) {
  let testStack=stack;
  if(!unitOnly){
    const context=await localAcceptanceContext(stack.env),api=await createScenarioAPI(context),admin=await createScenarioAPI(context,{role:'admin'}),fixtures=[];
    const templates=(await api.request('GET','/character-templates')).templates;
    for(const [index,preset]of ['line','wizard'].entries()){
      let character;
      if(preset==='line'){
        const template=templates.find(row=>row.preset_key===preset);assert.ok(template);
        character=await api.request('POST',`/character-templates/${template.id}/copies`,{name:'Owned preparation cache fixture'},{status:201});
      }else{
        // Persist the existing canonical wizard build through the real API.
        // This is a fixture shape adapter, not a second assembler: the actual
        // worker reloads every declaration and derives all command mechanics.
        const root=JSON.parse(await readFile(path.join(repositoryRoot,'frontend/src/pages/rulesLabFixture.generated.json'),'utf8')).roots.wizard;
        const draft=root.draft,actor=root.actor,body={name:'Owned canonical wizard cache fixture'};
        for(const [source,target]of Object.entries({systemId:'system_id',rulesetVersion:'ruleset_version',characterType:'character_type',characterSchemaVersion:'character_schema_version',raceId:'race_id',lineageId:'lineage_id',classId:'class_id',subclassIds:'subclass_ids',backgroundId:'background_id',level:'level',featIds:'feat_ids',spellIds:'spell_ids',actionIds:'action_ids',effectIds:'effect_ids',resourceIds:'resource_ids',abilities:'abilities'}))body[target]=draft[source];
        body.class_levels={[draft.classId]:draft.level};
        body.resolved_choices={...draft.resolvedChoices,'builder:ability_method':[draft.abilityMethod],
          'builder:ability_bonus':[`mode:${draft.abilityBonuses.mode}`,...Object.entries(draft.abilityBonuses.assignments).map(([key,value])=>`${key}:${value}`)],
          'builder:class_skills':draft.classSkillChoices,'builder:equipment_option':[draft.equipmentOption],'builder:class_equipment':[draft.classEquipmentOption]};
        Object.assign(body,{max_hp:actor.runtime.hp.max,current_hp:actor.runtime.hp.current,speed:actor.character.characterSpeed,
          proficiency_bonus:actor.character.profBonus,armor_class:actor.ac,equipment:{},inventory_items:[],
          resources:actor.runtime.resources,max_resources:actor.runtime.maxResources,active_effects:[],turn_state:{}});
        character=await api.request('POST','/characters-v3',body,{status:201});
      }
      const cards=[];
      for(const amount of [0,index?5:3])cards.push(await admin.request('POST','/cards',{name:'Owned cache item',description:'Disposable local fixture',rarity:'common',type:'ring',weight:.1,
        mechanics:amount?{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:`owned_cache_capacity_${index}`,amount}]}]}:{}},{status:201}));
      await admin.request('PATCH',`/characters-v3/${character.id}/runtime`,{expected_runtime_revision:character.runtime_revision,inventory_items:[...(character.inventory_items??[]),...cards.map(card=>({card_id:card.id,qty:1}))]});
      fixtures.push({characterId:character.id,cardIds:cards.map(row=>row.id)});
    }
    const classIDs=await Promise.all(fixtures.map(async fixture=>(await api.request('GET',`/characters-v3/${fixture.characterId}`)).class_id));
    assert.equal(new Set(classIDs).size,2,'Cache corpus must exercise two different classes, not two builds of one class');
    testStack={...stack,env:{...stack.env,PERFORMANCE_PREPARATION_FIXTURES:JSON.stringify(fixtures),RULES_WORKER_URL:stack.env.TEST_WORKER_ORIGIN,RULES_WORKER_TOKEN:stack.env.TEST_WORKER_TOKEN}};
  }
  return runRequiredGo(testStack,{tests:['TestPreparationCatalogWorkerHashPreservesHistoricalJSKeyOrder','TestPreparationCatalogContentProofTracksMembershipAndRights','TestPreparationCatalogBoundedEvictionAndIdentity','TestPreparationCatalogCandidateCannotPinNewArtifact','TestPreparationCatalogFlightsShareOnlyImmutableProcessing','TestPreparationCatalogFlightsBoundDistinctProofsAndRetryFailure','TestPreparationCatalogFlightsCancelJoinedWaiterWithoutCancelingOwner','TestPreparationCatalogFlightsShareFailureAndAllowFreshRetry',...(!unitOnly?['TestPreparationCatalogActualWorkerColdWarmAndEvictedEquality']:[])]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const unitOnly=process.argv.includes('--unit-only'),stack=await startTestStack({profile:'integration',dbOnly:unitOnly,reuseBuild:true,performance:true,preparationCache:true});
  try{console.log(JSON.stringify({runId:stack.registry.runId,result:await checkPreparationCache(stack,{unitOnly})}));}finally{await stack.cleanup();}
}
