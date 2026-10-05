import {describe,expect,it,vi} from 'vitest';
import {dispatchCommand,type CommandExecutors} from './commandDispatch';
import {dispatchDecision,type DecisionExecutors} from './decisionDispatch';
import {createWorld,type GameCommand,type PendingResolution,type ActorState,type RulesCatalog,type DeterministicEnvironment} from './domain';

const kinds = {
  "ChangeEquipment": true,
  "StartEncounter": true,
  "DeathSavingThrow": true,
  "StartTurn": true,
  "EndTurn": true,
  "TakeShortRest": true,
  "TakeLongRest": true,
  "UseAttackReplacement": true,
  "BeginAttackAction": true,
  "PerformWeaponAttack": true,
  "PerformLightWeaponExtraAttack": true,
  "PerformWeaponMasteryCleaveAttack": true,
  "PerformUnarmedStrike": true,
  "PerformPactChainFamiliarAttack": true,
  "BondPactBlade": true,
  "ObservePactBladeDistance": true,
  "AdjudicateActorDeath": true,
  "ForfeitAttackAction": true,
  "EscapeGrapple": true,
  "ReleaseGrapple": true,
  "BreakGrappleRange": true,
  "ObserveProtectionProximity": true,
  "UseReactionAction": true,
  "UseTriggeredAction": true,
  "UseAction": true,
  "ArmBoon": true,
  "AbilityCheck": true,
  "AttemptHide": true,
  "MakeNoise": true,
  "FindHiddenActor": true,
  "SwapInitiative": true,
  "TriggerHazard": true,
  "SavingThrow": true,
  "StudyWorldObject": true,
  "PhysicallyInteractWorldObject": true,
  "RevealMagicAura": true,
  "MoveDancingLights": true,
  "ObservePoisonDisease": true,
  "DonArmor": true,
  "UseFamiliarSharedSenses": true,
  "DismissFamiliar": true,
  "ReappearFamiliar": true,
  "DeliverTouchSpellThroughFamiliar": true,
  "ResolveDecision": true
} satisfies Record<GameCommand['type'],true>;
const phases = {action_cost_policy:true,attack_reaction:true,check_boost:true,concentration_save:true,damage_reaction:true,escape_grapple:true,event_reaction:true,hazard_save:true,magic_missile_reaction:true,mastery_save:true,protection_reaction:true,shove_outcome:true,slot_recovery:true,target_save:true,unarmed_save:true} satisfies Record<PendingResolution['type'],true>;
const actor:ActorState={id:'a',name:'Dispatch actor',kind:'playerCharacter',controllerId:'a',ac:12,
  capabilities:{actionIds:[]},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1},
  runtime:{hp:{current:10,max:10,temp:0},resources:{action:1},maxResources:{action:1},inventory:[],equipment:{},activeEffects:[]}};
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'dispatch-test',contentHash:'sha256:synthetic',errataVersion:'2024'};
const world=()=>createWorld({id:'dispatch',ruleset,actors:[structuredClone(actor)]});
const catalog={getAction:vi.fn()} as RulesCatalog;
const env={rng:()=>{throw Error('Router consumed RNG');},nextId:()=>{throw Error('Router generated ID');},clock:()=>{throw Error('Router read clock');}} satisfies DeterministicEnvironment;
const command=(type:GameCommand['type'])=>({schemaVersion:1,type,actorId:'a',commandId:'c',expectedRevision:0,rulesetContentHash:ruleset.contentHash}) as GameCommand;

describe('typed canonical command and continuation routing',()=>{
  it('dispatches every supported command once with unchanged arguments and return identity',()=>{
    for(const type of Object.keys(kinds) as GameCommand['type'][]){
      const state=world(),input=command(type),result:never[]=[],calls:string[]=[];
      const executors=Object.fromEntries(Object.keys(kinds).map(key=>[key,(...args:unknown[])=>{
        calls.push(key);expect(args).toEqual([state,input,catalog,env]);
        expect(args[0]).toBe(state);expect(args[1]).toBe(input);return result;
      }])) as unknown as CommandExecutors;
      const reject=()=>{throw Error('Unexpected rejection');};
      expect(dispatchCommand(state,input,catalog,env,executors,reject)).toBe(result);
      expect(calls).toEqual([type]);
    }
  });
  it('keeps the item initiative guard ahead of every phase owner',()=>{
    const state=world();state.actors.a.itemTurn={ownerActorId:'owner',itemCardId:'item',actionId:'strike'};
    const executed:string[]=[],rejected:string[]=[];
    const executors=Object.fromEntries(Object.keys(kinds).map(key=>[key,()=>{executed.push(key);return [];}])) as unknown as CommandExecutors;
    for(const type of Object.keys(kinds) as GameCommand['type'][]){
      dispatchCommand(state,command(type),catalog,env,executors,(_world,code)=>{
        rejected.push(type);expect(code).toBe('InvalidActionTiming');return {status:'rejected',code,message:'held',revision:0} as never;
      });
    }
    expect(executed).toEqual(['StartTurn','EndTurn','UseAction']);
    expect(rejected).toHaveLength(Object.keys(kinds).length-3);
  });
  it('dispatches every saved phase once and preserves absent/unknown save rejection routing',()=>{
    for(const phase of [...Object.keys(phases),undefined,'future-unsupported']){
      const state=world();if(phase)state.pendingResolution={type:phase} as PendingResolution;
      const input=command('ResolveDecision') as Extract<GameCommand,{type:'ResolveDecision'}>,result:never[]=[],calls:string[]=[];
      const executors=Object.fromEntries(Object.keys(phases).map(key=>[key,(...args:unknown[])=>{
        calls.push(key);expect(args).toEqual([state,input,catalog,env]);return result;
      }])) as unknown as DecisionExecutors;
      expect(dispatchDecision(state,input,catalog,env,executors)).toBe(result);
      expect(calls).toEqual([phase&&Object.hasOwn(phases,phase)?phase:'target_save']);
    }
  });
});
