import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {createSequentialIdFactory,createStrictRngTape} from './determinism';
import {handleCommand} from './handler';
import {migrateWorldState} from './worldMigration';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'recovery',contentHash:'recovery',errataVersion:'2024'};
describe('replacement recovery owns one amount roll, one chance and durable damage',()=>{
 it.each([{kind:'healing',die:6,amount:4,type:'untyped',self:true},{kind:'temp_hp',die:8,amount:8,type:'cold',self:false}] as const)('converts $kind into damage only on its declared chance',row=>{
  for(const replaced of [true,false]){
   const actor=(id:string):ActorState=>({id,name:id,kind:'playerCharacter',controllerId:id,ac:12,capabilities:{actionIds:['recover']},character:FIGHTER_CTX_EQUIPPED,
    runtime:{...equippedFighterState(),hp:{current:20,max:40,temp:0},activeEffects:[],resources:{action:1},maxResources:{action:1}}});
   const owner=actor('owner'),target=row.self?owner:actor('target');
   target.passives=[{kind:'recovery_policy',kinds:[row.kind],chance:{die:2,equals:[1]},replace_with:'damage',damage_type:row.type},
     ...(row.type==='cold'?[{kind:'resistance',damage_type:'cold',value:'resistance'}]:[])];
   const definition:RuleActionDefinition={id:'recover',name:'Recover',kind:'nonSpell',sourceEntityIds:['different-recovery-source'],
    mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1}]},targeting:{target:row.self?'self':'single'},effects:[{resolution:'auto',who:row.self?'self':'target',result:[{kind:row.kind,amount:`1d${row.die}`}]}]}};
   const world=createWorld({id:'replacement',ruleset,actors:row.self?[owner]:[owner,target]});
   world.actors[target.id].runtime.activeEffects.push({id:'concentrating',name:'Concentration',source:'test',mechanics:{kind:'concentration',effectIds:[]}});
   world.concentrations[target.id]={id:'held-concentration',sourceActorId:target.id,actionId:'maintained-spell',startedAtRevision:0,effectLinks:[]};
   const tape=createStrictRngTape([{label:'amount',sides:row.die,value:row.amount},{label:'chance',sides:2,value:replaced?1:2}]);
   const env={rng:tape.rng,nextId:createSequentialIdFactory('recover'),clock:()=>1},catalog={getAction:()=>definition};
   const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'recover',actorId:owner.id,expectedRevision:0,rulesetContentHash:'recovery',actionId:'recover',targetIds:row.self?[]:[target.id],factsByTarget:{target:{factsSource:'scenario',boardRevision:0,distanceFt:0,lineOfSight:true,cover:'none',relation:'ally'}}};
   const result=handleCommand(world,command,catalog,env);if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
   const restored=migrateWorldState(JSON.parse(JSON.stringify(result.nextState))),hp=restored.actors[target.id].runtime.hp;
   expect(hp.current).toBe(replaced?20-(row.type==='cold'?row.amount/2:row.amount):row.kind==='healing'?20+row.amount:20);
   expect(hp.temp).toBe(!replaced&&row.kind==='temp_hp'?row.amount:0);
   if(!row.self)expect(restored.actors.owner.runtime.hp.current).toBe(20);
   if(replaced){
    expect(restored.pendingResolution?.type).toBe('concentration_save');
    const pending=restored.pendingResolution!;
    const decision:GameCommand={schemaVersion:1,type:'ResolveDecision',commandId:'maintain',actorId:target.id,expectedRevision:restored.revision,rulesetContentHash:'recovery',resolutionId:pending.id,requestId:pending.request.id,response:{kind:'roll',roll:{mode:'manual',dice:[{sides:20,value:20}]}}};
    const resolved=handleCommand(restored,decision,catalog,env);if(resolved.status!=='accepted')throw Error(resolved.message);
    expect(resolved.nextState.concentrations[target.id]?.id).toBe('held-concentration');
    expect(resolved.nextState.actors[target.id].runtime.hp).toEqual(hp);
   }else expect(restored.pendingResolution==null).toBe(true);
   expect(handleCommand(restored,command,catalog,env).status).toBe('rejected');tape.assertExhausted();
  }
 });
});
