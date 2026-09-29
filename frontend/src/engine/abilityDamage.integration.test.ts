import {describe,it,expect} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type GameCommand} from '../rules-core/domain';
import {handleCommand} from '../rules-core/handler';
import {createStrictRngTape,createSequentialIdFactory} from '../rules-core/determinism';
import {migrateWorldState} from '../rules-core/worldMigration';
import {projectRuntimeCharacter} from './runtimeCharacterProjection';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'ability-damage',contentHash:'ability-damage',errataVersion:'2024'};
describe('captured ability damage',()=>{
 it.each(['str','wis'] as const)('persists the actual %s reduction once, including death at the declared threshold',ability=>{
  const actor:ActorState={id:'owner',name:'Owner',kind:'playerCharacter',controllerId:'user',ac:10,capabilities:{actionIds:['drain']},
   character:{...FIGHTER_CTX_EQUIPPED,abilityScores:{...FIGHTER_CTX_EQUIPPED.abilityScores,[ability]:4}},runtime:equippedFighterState(),lifecycle:{status:'alive'}};
  actor.runtime.resources.action=1;
  const action:RuleActionDefinition={id:'drain',name:'Drain',kind:'nonSpell',sourceEntityIds:['source'],mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',who:'self',result:[{kind:'ability_damage',ability,amount:'1d4',fatal_at:0,duration:{type:'permanent'}}]}]}};
  const catalog={getAction:(id:string)=>id==='drain'?action:undefined};
  const tape=createStrictRngTape([{sides:4,value:4,label:'drain'}]);const env={rng:tape.rng,nextId:createSequentialIdFactory('ability'),clock:()=>1};
  const world=createWorld({id:'ability',ruleset,actors:[actor]});
  const command:GameCommand={schemaVersion:1,commandId:'drain-once',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'owner',type:'UseAction',actionId:'drain',targetIds:[]};
  const result=handleCommand(world,command,catalog,env);expect(result.status,JSON.stringify(result)).toBe('accepted');if(result.status!=='accepted')throw Error('Rejected');
  const restored=migrateWorldState(JSON.parse(JSON.stringify(result.nextState)));
  const current=restored.actors.owner;expect(projectRuntimeCharacter(current.character,current.runtime).abilityScores?.[ability]).toBe(0);
  expect(current.lifecycle?.status).toBe('dead');expect(current.runtime.resources.action).toBe(0);
  expect(current.runtime.activeEffects.filter(effect=>effect.mechanics.ability_fatal_threshold)).toHaveLength(1);
  expect(handleCommand(restored,command,catalog,env).status).toBe('rejected');
  expect(actor.character.abilityScores?.[ability]).toBe(4);
 });
});
