import {afterEach,describe,expect,it} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {registerConditions,resetConditionsToOfflineFixture} from '../engine/conditions';
import {conditionGrantedActions} from '../engine/conditionActions';
import type {SoloCombatState} from '../solo-combat/types';
import {stepRoguelikeCombat,type RoguelikeCombatEnvelope,type RoguelikeCombatIntent} from './combatWorker';

const hash=`sha256:${'c'.repeat(64)}`;
const envelope=(condition='prone'):RoguelikeCombatEnvelope=>{
  const actors=['hero','enemy'].map((id):ActorState=>({id,name:id,controllerId:id,kind:id==='hero'?'playerCharacter':'monster',ac:12,
    capabilities:{actionIds:[]},character:{baseSpeed:31,level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
    runtime:{hp:{current:10,max:10,temp:0},resources:{action:1,bonus_action:1,reaction:1,movement:99},maxResources:{action:1,bonus_action:1,reaction:1,movement:99},
      inventory:[],equipment:{},activeEffects:id==='hero'?[{id:`condition:${condition}`,name:condition,source:'test',mechanics:{kind:'condition',value:condition}}]:[]}}));
  const world=createWorld({id:'turn-start-condition',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
  world.scene={mode:'encounter',round:1,initiative:['hero','enemy'],activeIndex:0,turnStarted:true};
  const state={schemaVersion:1,conditionActionSchemaVersion:1,characterId:'hero',controlledCharacterIds:['hero'],runtimeRevision:0,world,log:[],outcome:'active',
    tokens:{hero:{actorId:'hero',position:{x:1,y:1}},enemy:{actorId:'enemy',position:{x:8,y:8}}},sideByActorId:{hero:'party',enemy:'enemy'},
    movementRemainingFt:{hero:31},boardRevision:0,combatAreas:{},catalogActions:[],playerActionIds:[],certifiedPlayerActionIds:[],actionPresentation:{}} as unknown as SoloCombatState;
  return{schemaVersion:1,artifactHash:hash,entropy:{seed:'condition-command-replay',cursor:17},state};
};

describe('authoritative worker condition actions at turn start',()=>{
  afterEach(()=>resetConditionsToOfflineFixture('condition worker test finished'));

  it.each(['condition_action','stand'] as const)('uses the existing %s command and prevents a second movement payment after reload',type=>{
    const before=envelope();if(type==='stand')delete before.state.conditionActionSchemaVersion;
    const declared=conditionGrantedActions(before.state.world.actors.hero.runtime)[0];
    const intent:RoguelikeCombatIntent=type==='stand'?{type,actorId:'hero'}:{type,actorId:'hero',actionId:declared.id};
    const serialized=JSON.stringify(before),first=stepRoguelikeCombat(before,intent,hash);
    expect(first.randomValues).toEqual([]);expect(first.envelope.entropy).toEqual(before.entropy);
    expect(first.envelope.state.movementRemainingFt.hero).toBe(16);
    expect(first.envelope.state.world.actors.hero.runtime.activeEffects).toEqual([]);
    expect(first.envelope.state.world.actors.hero.runtime.resources).toEqual(before.state.world.actors.hero.runtime.resources);
    expect(first.envelope.state.log).toHaveLength(1);
    expect(first.envelope.state.log[0].records?.some(record=>record.event?.type==='resource_spent'&&record.event.resource==='movement'&&record.event.amount===15)).toBe(true);
    expect(JSON.stringify(before)).toBe(serialized);
    expect(stepRoguelikeCombat(JSON.parse(serialized),intent,hash)).toEqual(first);
    const reloaded=JSON.parse(JSON.stringify(first.envelope)) as RoguelikeCombatEnvelope,reloadedSaved=JSON.stringify(reloaded);
    expect(()=>stepRoguelikeCombat(reloaded,intent,hash)).toThrow();
    expect(JSON.stringify(reloaded)).toBe(reloadedSaved);
  });

  it('pays a different data-owned condition action with a quarter-speed cost through the same worker',()=>{
    registerConditions([{id:'sticky-floor',label:'Липкий пол',modifiers:[],worldFacts:{granted_actions:[{
      id:'clear-feet',name:'Освободить ноги',description:'Quarter current speed',movementFraction:.25,
      decisionPolicies:['turn-start.auto-stand'],effects:[{resolution:'auto',result:[{kind:'condition',value:'$granting_condition',op:'remove'}]}],
    }]}}]);
    const before=envelope('sticky-floor'),declared=conditionGrantedActions(before.state.world.actors.hero.runtime)[0];
    const first=stepRoguelikeCombat(before,{type:'condition_action',actorId:'hero',actionId:declared.id},hash);
    expect(first.envelope.state.movementRemainingFt.hero).toBe(24);
    expect(first.envelope.state.world.actors.hero.runtime.activeEffects).toEqual([]);
    expect(first.randomValues).toEqual([]);expect(first.envelope.entropy).toEqual(before.entropy);
    expect(before.state.world.actors.hero.runtime.activeEffects).toHaveLength(1);
  });

  it.each(['insufficient','zero-speed','pending','enemy','not-turn','foreign-action'] as const)('rejects %s without changing inventory, conditions, movement, history or entropy',mode=>{
    const input=envelope(),declared=conditionGrantedActions(input.state.world.actors.hero.runtime)[0];
    const intent:RoguelikeCombatIntent={type:'condition_action',actorId:mode==='enemy'?'enemy':'hero',actionId:mode==='foreign-action'?'not-granted':declared.id};
    if(mode==='insufficient')input.state.movementRemainingFt.hero=14;
    if(mode==='zero-speed')input.state.world.actors.hero.character.baseSpeed=0;
    if(mode==='pending')input.state.pendingTriggeredAction={event:'hit',sourceActorId:'hero',sourceActionId:'attack',targetIds:[],optionActionIds:[]};
    if(mode==='not-turn'&&input.state.world.scene.mode==='encounter')input.state.world.scene.activeIndex=1;
    const saved=JSON.stringify(input);expect(()=>stepRoguelikeCombat(input,intent,hash)).toThrow();expect(JSON.stringify(input)).toBe(saved);
  });
});
