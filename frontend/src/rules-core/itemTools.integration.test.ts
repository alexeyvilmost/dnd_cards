import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {compileMechanicsTargeting} from './actionTargeting';
import {createSequentialIdFactory,createStrictRngTape} from './determinism';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';
import {migrateWorldState} from './worldMigration';
import {buildSheetWorldInput,initialSheetWorldInputDraft,sheetWorldInputFormContext} from '../character/sheetWorldInputForm';
import type {SheetCanonicalRuntime} from '../character/sheetCanonicalWorld';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import cards from '../testing/fixtures/item-catalog.cards.json';
import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'tools',contentHash:'tools',errataVersion:'2024'};
function actor():ActorState{return {id:'owner',name:'Owner',kind:'playerCharacter',controllerId:'owner',ac:10,capabilities:{actionIds:['tool']},character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
  runtime:{hp:{current:10,max:10,temp:0},resources:{action:2},maxResources:{action:2},inventory:[],equipment:{},activeEffects:[]}};}
function action(operation:'unlock'|'map'|'forge_text'):RuleActionDefinition{
 const parameters={};const mutation={kind:'world_interaction',operation:'item_tool',parameters};
 const mechanics={primitive:{type:'item_tool',policy:{operation,...(operation==='forge_text'?{max_words:10}:{})}},
   activation:{mode:'active',cost:[{resource:'action',amount:1}]},targeting:{domain:'world',actor_targets:false,shape:'single',range_ft:5,min_targets:0,max_targets:0,allowed_relations:[],requires_line_of_sight:true},
   effects:operation==='forge_text'?[{resolution:'auto',result:[mutation]}]:[{resolution:'ability_check',ability:operation==='unlock'?'dex':'wis',dc:15,on_success:[mutation]}]};
 return {id:'tool',name:operation,kind:'nonSpell',sourceEntityIds:['catalog-tool'],mechanics,targeting:compileMechanicsTargeting(mechanics)};
}
describe('item tools use canonical checks and durable object consequences',()=>{
 it.each([{key:'ignite-easy',easy:true},{key:'ignite-slow',easy:false}] as const)('lights $key objects only with matching exposed fuel and persists ignition',({key,easy})=>{
   const item=cards.find(card=>card.card_number==='CARD-0820')!;
   const row=related.entities.find(entry=>entry.card_number===`ACT-item-completion-high-820-${key}`)!;
   const definition=projectRuleAction(row.patch as unknown as Action);
   const hero=actor();hero.capabilities.actionIds=[definition.id];hero.character.knownCards=[item as never];hero.runtime.inventory=[{cardId:item.id,qty:1}];hero.runtime.resources.action=1;
   const world=createWorld({id:'tinderbox',ruleset,actors:[hero]});
   const empty=createWorld({id:'tinderbox-new-target',ruleset,actors:[hero]});
   const context=sheetWorldInputFormContext({runtime:{world:empty,actorId:'owner'} as SheetCanonicalRuntime,action:definition})!;
   const draft=initialSheetWorldInputDraft(context,'new-fuel');
   expect(draft.newObjectProfile).toBe(easy?'fuel_easy':'fuel_slow');
   const prepared=buildSheetWorldInput(context,{...draft,createObject:true,newObjectName:'Fuel'});
   expect(prepared.issues).toEqual([]);
   expect(prepared.result?.scenarioObjects[0]).toMatchObject({flammable:true,easyIgnition:easy});
   world.objects.fuel={id:'fuel',name:'Fuel',kind:'environment',size:'small',flammable:true,easyIgnition:easy};
   const catalog={getAction:(id:string)=>id===definition.id?definition:undefined};
   const env={rng:()=>{throw Error('No roll');},nextId:createSequentialIdFactory('tinderbox'),clock:()=>1};
   const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'ignite',actorId:'owner',expectedRevision:0,rulesetContentHash:'tools',actionId:definition.id,targetIds:[],worldInput:{type:'item_tool',objectId:'fuel',description:'Fuel',facts:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true}}};
   const result=handleCommand(world,command,catalog,env);if(result.status==='rejected')throw Error(`${result.code}: ${result.message}`);
   expect(result.nextState.objects.fuel.ignited).toBe(true);
   expect(result.nextState.actors.owner.runtime.resources.action).toBe(0);
   expect(handleCommand(migrateWorldState(JSON.parse(JSON.stringify(result.nextState))),command,catalog,env).status).toBe('rejected');
   if(!easy){world.objects.fuel.easyIgnition=true;const wrong=related.entities.find(entry=>entry.card_number==='ACT-item-completion-high-820-ignite-easy')!;
     const quick=projectRuleAction(wrong.patch as unknown as Action);world.objects.fuel.easyIgnition=false;hero.capabilities.actionIds=[quick.id];
     expect(handleCommand(world,{...command,actionId:quick.id}, {getAction:(id:string)=>id===quick.id?quick:undefined},env).status).toBe('rejected');}
 });
 it.each([{operation:'force_open',advantage:true,check_bonus:0,rolls:[2,16],dc:15},{operation:'inspect',advantage:false,check_bonus:4,rolls:[11],dc:15}] as const)('applies the declared check rule for $operation against the object difficulty',row=>{
   const definition=action('unlock');definition.mechanics.primitive={type:'item_tool',policy:{operation:row.operation,check_from_object:true}};
   definition.mechanics.effects=[{resolution:'ability_check',ability:'str',advantage:row.advantage,check_bonus:row.check_bonus,dc:'object_dc',on_success:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}];
   const world=createWorld({id:'tools',ruleset,actors:[actor()]});
   world.objects.target={id:'target',name:'Door',kind:'environment',size:'medium',secured:true,toolState:{locked:true,jammed:true,checkDc:row.dc}};
   const tape=createStrictRngTape(row.rolls.map(value=>({label:'check',sides:20,value}))),env={rng:tape.rng,nextId:createSequentialIdFactory('tool'),clock:()=>1};
   const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'check',actorId:'owner',expectedRevision:0,rulesetContentHash:'tools',actionId:'tool',targetIds:[],worldInput:{type:'item_tool',objectId:'target',description:'Следы тонкой гравировки',facts:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true}}};
   const result=handleCommand(world,command,{getAction:()=>definition},env);if(result.status!=='accepted')throw Error(result.message);
   const reloaded=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
   if(row.operation==='force_open')expect(reloaded.objects.target).toMatchObject({secured:false,toolState:{locked:false,jammed:false}});
   else expect(reloaded.objects.target.toolState?.observations).toEqual([{sourceActorId:'owner',text:'Следы тонкой гравировки'}]);
   expect(handleCommand(reloaded,command,{getAction:()=>definition},env).status).toBe('rejected');tape.assertExhausted();
 });
 it.each(['unlock','map'] as const)('persists %s only after a successful check; reload/replay cannot reroll or spend twice',operation=>{
   const definition=action(operation),initial=createWorld({id:'tools',ruleset,actors:[actor()]});
   initial.objects.target={id:'target',name:'Object',kind:'environment',size:'small',toolState:{locked:true}};
   const tape=createStrictRngTape([{label:'tool-check',sides:20,value:16}]),env={rng:tape.rng,nextId:createSequentialIdFactory('tool'),clock:()=>1},catalog={getAction:(id:string)=>id===definition.id?definition:undefined};
   const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'use',actorId:'owner',expectedRevision:0,rulesetContentHash:'tools',actionId:'tool',targetIds:[],worldInput:{type:'item_tool',objectId:'target',description:'План небольшой комнаты',facts:{factsSource:'scenario',boardRevision:0,distanceFt:5,lineOfSight:true}}};
   const result=handleCommand(initial,command,catalog,env);if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
   expect(foldEvents(initial,result.events)).toEqual(result.nextState);expect(result.nextState.actors.owner.runtime.resources.action).toBe(1);
   const restored=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
   if(operation==='unlock')expect(restored.objects.target.toolState?.locked).toBe(false);
   else expect(restored.objects.target.toolState?.document).toMatchObject({kind:'map',text:'План небольшой комнаты'});
   expect(handleCommand(restored,command,catalog,env).status).toBe('rejected');tape.assertExhausted();
 });
 it('uses the existing object form and rejects forgery words before cost or RNG',()=>{
   const definition=action('forge_text'),world=createWorld({id:'tools',ruleset,actors:[actor()]});
   const runtime={world,actorId:'owner'} as SheetCanonicalRuntime;
   const context=sheetWorldInputFormContext({runtime,action:definition})!;
   expect(context.form).toBe('item_tool');
   const draft={...initialSheetWorldInputDraft(context,'paper'),newObjectName:'Письмо',description:'один два три четыре пять шесть семь восемь девять десять одиннадцать'};
   expect(buildSheetWorldInput(context,draft).issues[0].message).toContain('10');
   const valid=buildSheetWorldInput(context,{...draft,description:'Приходите завтра'});
   expect(valid.issues).toEqual([]);expect(valid.result?.worldInput).toMatchObject({type:'item_tool',description:'Приходите завтра'});
 });
 it.each([['fragile-picks','item'],['costly-ink','ink']] as const)('settles %s failure only after the saved optional influence',(_name,resource)=>{
   for(const boost of [null,1,10]){
     const hero=actor();hero.runtime.inventory=[{cardId:'fragile-picks',qty:1}];hero.runtime.resources.ink=2;hero.runtime.maxResources.ink=2;
     hero.capabilities.actionIds.push('boost');
     hero.grantedEffects={die:{id:'die',name:'Die',mechanics:{kind:'boon',die:'1d10',applies_to:['ability_check'],timing:['after_failure']}}};
     const definition=action('map'),check=(definition.mechanics.effects as Record<string,unknown>[])[0];
     check.on_fail=[{kind:'spend_cost',cost:[resource==='item'?{resource:'item',card_id:'fragile-picks',amount:1}:{resource:'ink',amount:1}]}];
     const influence:RuleActionDefinition={id:'boost',name:'Boost',kind:'nonSpell',sourceEntityIds:['different-source'],mechanics:{activation:{mode:'triggered',cost:[],trigger:{events:['ability_check_failed']}},effects:[{resolution:'auto',result:[{kind:'grant_effect',value:'die'}]}]}};
     const catalog={getAction:(id:string)=>id==='tool'?definition:id==='boost'?influence:undefined},world=createWorld({id:'tools',ruleset,actors:[hero]});
     world.objects.target={id:'target',name:'Paper',kind:'item',size:'tiny'};
     const tape=createStrictRngTape([{label:'check',sides:20,value:5},...(boost===null?[]:[{label:'boost',sides:10,value:boost}])]),env={rng:tape.rng,nextId:createSequentialIdFactory('tools'),clock:()=>1};
     const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'use',actorId:'owner',expectedRevision:0,rulesetContentHash:'tools',actionId:'tool',targetIds:[],worldInput:{type:'item_tool',objectId:'target',description:'Карта',facts:{factsSource:'scenario',boardRevision:0,distanceFt:0,lineOfSight:true}}};
     const first=handleCommand(world,command,catalog,env);if(first.status!=='accepted')throw Error(first.message);
     expect(first.nextState.pendingResolution?.type).toBe('check_boost');expect(first.nextState.actors.owner.runtime.inventory[0].qty).toBe(1);expect(first.nextState.actors.owner.runtime.resources.ink).toBe(2);
     const restored=migrateWorldState(JSON.parse(JSON.stringify(first.nextState))),pending=restored.pendingResolution!;
     const decision:GameCommand={schemaVersion:1,type:'ResolveDecision',commandId:'choose',actorId:'owner',expectedRevision:restored.revision,rulesetContentHash:'tools',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'reaction',actionId:boost===null?null:'boost'}};
     const result=handleCommand(restored,decision,catalog,env);if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
     const final=result.nextState;
     expect(final.objects.target.toolState?.document?.text).toBe(boost===10?'Карта':undefined);
     expect(final.actors.owner.runtime.inventory.find(row=>row.cardId==='fragile-picks')?.qty??0).toBe(resource==='item'&&boost!==10?0:1);
     expect(final.actors.owner.runtime.resources.ink).toBe(resource==='ink'&&boost!==10?1:2);
     expect(handleCommand(final,decision,catalog,env).status).toBe('rejected');tape.assertExhausted();
   }
 });
});
