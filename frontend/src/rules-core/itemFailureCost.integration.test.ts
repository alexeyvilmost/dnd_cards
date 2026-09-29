import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {handleCommand} from './handler';
import {createSequentialIdFactory,createStrictRngTape} from './determinism';
import {migrateWorldState} from './worldMigration';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'wear',contentHash:'wear',errataVersion:'test'};
describe('tool failures commit wear only after a failed canonical check',()=>{
 it.each([{card:'picks',threshold:2},{card:'probe',threshold:3}])('preserves $card for $threshold failures across reload and consumes exactly one stack unit',({card,threshold})=>{
  const actor:ActorState={id:'owner',name:'Owner',kind:'playerCharacter',controllerId:'owner',ac:10,capabilities:{actionIds:['use']},
   character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},passives:[{kind:'item_failure_policy',card_id:card,break_after_failures:threshold}],
   runtime:{hp:{current:10,max:10,temp:0},resources:{},maxResources:{},equipment:{},inventory:[{cardId:card,qty:2}],activeEffects:[]}};
  const action:RuleActionDefinition={id:'use',name:'Use tool',kind:'nonSpell',sourceEntityIds:['tool'],mechanics:{activation:{mode:'active',cost:[]},effects:[{resolution:'ability_check',ability:'dex',dc:12,
   on_success:[{kind:'narrative',text:'Открыто'}],on_fail:[{kind:'spend_cost',cause:'tool_failure',cost:[{resource:'item',card_id:card,amount:1}]}]}]}};
  let world=createWorld({id:'wear',ruleset,actors:[actor]});
  const tape=createStrictRngTape(Array.from({length:threshold+1},(_,index)=>({label:'check',sides:20,value:index===0?15:5}))),env={rng:tape.rng,nextId:createSequentialIdFactory('wear'),clock:()=>1};
  for(let index=0;index<=threshold;index++){
   const command:GameCommand={schemaVersion:1,type:'UseAction',commandId:`attempt-${index}`,expectedRevision:world.revision,rulesetContentHash:'wear',actorId:'owner',actionId:'use',targetIds:[]};
   const result=handleCommand(world,command,{getAction:()=>action},env);if(result.status!=='accepted')throw Error(result.message);
   world=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
   expect(world.actors.owner.runtime.inventory[0].qty).toBe(index===threshold?1:2);
   expect(world.actors.owner.runtime.activeEffects.find(row=>row.id===`item-failure:${card}`)?.mechanics.failures).toBe(index>0&&index<threshold?index:undefined);
   expect(handleCommand(world,command,{getAction:()=>action},env)).toMatchObject({status:'rejected',code:'DuplicateCommand'});
  }
  tape.assertExhausted();
 });
});
