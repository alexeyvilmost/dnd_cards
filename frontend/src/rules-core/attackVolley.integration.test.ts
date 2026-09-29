import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type RuleActionDefinition,type RulesCatalog,type SpatialFacts} from './domain';
import {createLogicalClock,createSequentialIdFactory,createStrictRngTape} from './determinism';
import {InMemoryRulesSession} from './session';
import {foldEvents} from './reducer';
import {migrateWorldState} from './worldMigration';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'volley@1',contentHash:'sha256:volley',errataVersion:'test'};
function volley(id:string,dice:string,maxTargets:number,repeat:boolean):RuleActionDefinition{return {
  id,name:id,kind:'nonSpell',sourceEntityIds:[id],
  targeting:{minTargets:maxTargets,maxTargets,rangeFt:120,requiresLineOfSight:true,allowedRelations:['enemy'],
    ...(repeat?{allowRepeatTargets:true as const}:{})},
  mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{
    resolution:'attack_roll',ability:'int',attack_kind:'spell_ranged',vs:'ac',
    on_hit:[{kind:'damage',dice,type:'force',ability:'none'}],
  }]},
};}
const threeRays=volley('test:three-rays','1d6',3,true);
const twoStrikes=volley('test:two-strikes','1d4',2,false);
const spellRays:RuleActionDefinition={...volley('test:spell-rays','2d6',3,true),
  kind:'spell',spell:{level:2,sourceClass:'wizard',components:{verbal:true,somatic:true,material:false}},
  targeting:{...volley('temp','2d6',3,true).targeting!,additionalTargetSlotsPerSpellSlotAboveBase:1},
  mechanics:{activation:{mode:'active',cost:[{resource:'action'},{resource:'spell_slot_2'}]},effects:[{
    resolution:'attack_roll',ability:'int',attack_kind:'spell_ranged',vs:'ac',
    on_hit:[{kind:'damage',dice:'2d6',type:'fire',ability:'none'}],
  }]},
};
const spellStrikes:RuleActionDefinition={...volley('test:spell-strikes','1d4',2,false),
  kind:'spell',spell:{level:1,sourceClass:'wizard',components:{verbal:true,somatic:true,material:false}},
  mechanics:{activation:{mode:'active',cost:[{resource:'action'},{resource:'spell_slot_1'}]},effects:[{
    resolution:'attack_roll',ability:'int',attack_kind:'spell_ranged',vs:'ac',
    on_hit:[{kind:'damage',dice:'1d4',type:'cold',ability:'none'}],
  }]},
};
const levelRays:RuleActionDefinition={...volley('test:level-rays','1d10',1,true),
  kind:'spell',spell:{level:0,sourceClass:'warlock',components:{verbal:true,somatic:true,material:false}},
  targeting:{...volley('temp','1d10',1,true).targeting!,targetSlotsByCharacterLevel:{1:1,5:2,11:3,17:4}}};
const linkedStrikes:RuleActionDefinition={...volley('test:linked-strikes','1d4',2,false),
  targeting:{...volley('temp','1d4',2,false).targeting!,additionalTargetsWithinFtOfFirst:30}};
const shield:RuleActionDefinition={id:'test:shield',name:'Shield response',kind:'nonSpell',sourceEntityIds:['test:shield'],
  mechanics:{activation:{mode:'reaction',trigger:{event:'hit_by_attack'},cost:[{resource:'reaction'}]},
    effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',applies_to:{roll:'ac'},op:'add',value:'+5',duration:{type:'until_start_of_next_turn'}}]}]}};
const actions=[threeRays,twoStrikes,spellRays,spellStrikes,levelRays,linkedStrikes,shield];
const catalog:RulesCatalog={getAction:id=>actions.find(action=>action.id===id)};
function actor(id:string,actionsOwned:string[]=[],level=5):ActorState{return {
  id,name:id,kind:'playerCharacter',controllerId:`${id}:controller`,ac:12,
  capabilities:{actionIds:actionsOwned},
  character:{abilityMods:{str:0,dex:0,con:0,int:3,wis:0,cha:0},profBonus:2,level,saveProficiencies:[]},
  runtime:{hp:{current:30,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1,spell_slot_1:1,spell_slot_2:1,spell_slot_3:1},
    maxResources:{action:1,bonus_action:1,reaction:1,spell_slot_1:1,spell_slot_2:1,spell_slot_3:1},equipment:{},inventory:[],activeEffects:[]},
};}
function fact():SpatialFacts{return {factsSource:'board',boardRevision:0,distanceFt:20,lineOfSight:true,cover:'none',relation:'enemy'};}
function sessionFor(action:RuleActionDefinition,rng:()=>number,reactive=false,actorLevel=5){
  const caster=actor('caster',[action.id],actorLevel);
  if(action.kind==='spell')caster.passives=[{id:'test:cast-audit',name:'Cast audit',
    activation:{mode:'triggered',trigger:{event:'spell_cast'}},
    effects:[{resolution:'auto',result:[{kind:'temp_hp',amount:'1'}]}]}];
  return new InMemoryRulesSession(
  createWorld({id:'volley-test',ruleset,actors:[caster,actor('one',reactive?[shield.id]:[]),actor('two')]}),catalog,
  {rng,clock:createLogicalClock(),nextId:createSequentialIdFactory('unused')},
);}
function use(session:InMemoryRulesSession,action:RuleActionDefinition,targetIds:string[]){return session.dispatch({
  schemaVersion:1,type:'UseAction',commandId:'volley-command',expectedRevision:0,
  rulesetContentHash:ruleset.contentHash,actorId:'caster',actionId:action.id,targetIds,
  factsByTarget:Object.fromEntries([...new Set(targetIds)].map(id=>[id,fact()])),
});}

describe('persisted ordered attack volley',()=>{
  it('rolls and applies three independent attacks against the same actor, paying Action once',()=>{
    const tape=createStrictRngTape([
      {label:'ray 1 attack',sides:20,value:12},{label:'ray 1 damage',sides:6,value:2},
      {label:'ray 2 attack',sides:20,value:13},{label:'ray 2 damage',sides:6,value:3},
      {label:'ray 3 attack',sides:20,value:14},{label:'ray 3 damage',sides:6,value:4},
    ]);
    const session=sessionFor(threeRays,tape.rng);
    const before=session.getState();
    const result=use(session,threeRays,['one','one','one']);
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    tape.assertExhausted();
    expect(session.getState().actors.one.runtime.hp.current).toBe(21);
    expect(session.getState().actors.caster.runtime.resources.action).toBe(0);
    expect(session.getState().attackVolley).toBeNull();
    expect(result.events.filter(entry=>entry.payload.type==='ActionDeclared')).toHaveLength(1);
    expect(result.events.flatMap(entry=>entry.payload.type==='EngineEventRecorded'&&entry.payload.event.type==='roll'
      &&entry.payload.event.roll.kind==='d20'?[entry.payload.event.roll]:[])).toHaveLength(3);
    expect(foldEvents(before,session.getEvents())).toEqual(session.getState());
    expect(migrateWorldState(JSON.parse(JSON.stringify(session.getState())))).toEqual(session.getState());
  });

  it('uses the same primitive for two distinct targets and rejects repeated slots without permission',()=>{
    const rejectedSession=sessionFor(twoStrikes,()=>0.5);
    expect(use(rejectedSession,twoStrikes,['one','one'])).toMatchObject({status:'rejected',code:'InvalidTargets'});
    const tape=createStrictRngTape([
      {label:'strike 1 attack',sides:20,value:12},{label:'strike 1 damage',sides:4,value:2},
      {label:'strike 2 attack',sides:20,value:13},{label:'strike 2 damage',sides:4,value:3},
    ]);
    const session=sessionFor(twoStrikes,tape.rng);
    const result=use(session,twoStrikes,['one','two']);
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    tape.assertExhausted();
    expect(session.getState().actors.one.runtime.hp.current).toBe(28);
    expect(session.getState().actors.two.runtime.hp.current).toBe(27);
  });

  it('checks the distance between secondary and first target authoritatively',()=>{
    const missing=sessionFor(linkedStrikes,()=>0.5);
    const request=(distanceToFirstTargetFt?:number)=>({schemaVersion:1 as const,type:'UseAction' as const,
      commandId:'linked-targets',expectedRevision:0,rulesetContentHash:ruleset.contentHash,
      actorId:'caster',actionId:linkedStrikes.id,targetIds:['one','two'],
      factsByTarget:{one:fact(),two:{...fact(),...(distanceToFirstTargetFt===undefined
        ?{}:{distanceToFirstTargetFt})}}});
    expect(missing.dispatch(request())).toMatchObject({status:'rejected',code:'MissingSpatialFacts'});
    expect(missing.dispatch(request(35))).toMatchObject({status:'rejected',code:'OutOfRange'});
    const tape=createStrictRngTape([
      {label:'linked 1 attack',sides:20,value:12},{label:'linked 1 damage',sides:4,value:2},
      {label:'linked 2 attack',sides:20,value:13},{label:'linked 2 damage',sides:4,value:3},
    ]);
    const accepted=sessionFor(linkedStrikes,tape.rng);
    expect(accepted.dispatch(request(30))).toMatchObject({status:'accepted'});
    tape.assertExhausted();
    expect(accepted.getState().actors.one.runtime.hp.current).toBe(28);
    expect(accepted.getState().actors.two.runtime.hp.current).toBe(27);
  });

  it('uses actor level for independent cantrip beams while each hit remains 1d10',()=>{
    const levelOne=sessionFor(levelRays,()=>0.5,false,1);
    expect(levelOne.dispatch({schemaVersion:1,type:'UseAction',commandId:'too-many',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:'caster',actionId:levelRays.id,
      targetIds:['one','one'],factsByTarget:{one:fact()},spell:{baseLevel:0}}))
      .toMatchObject({status:'rejected',code:'InvalidTargets'});
    const tape=createStrictRngTape([
      {label:'beam 1 attack',sides:20,value:12},{label:'beam 1 damage',sides:10,value:2},
      {label:'beam 2 attack',sides:20,value:13},{label:'beam 2 damage',sides:10,value:3},
    ]);
    const levelFive=sessionFor(levelRays,tape.rng,false,5);
    expect(levelFive.dispatch({schemaVersion:1,type:'UseAction',commandId:'two-beams',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:'caster',actionId:levelRays.id,
      targetIds:['one','one'],factsByTarget:{one:fact()},spell:{baseLevel:0}}))
      .toMatchObject({status:'accepted'});
    tape.assertExhausted();
    expect(levelFive.getState().actors.one.runtime.hp.current).toBe(25);
    const levelEleven=sessionFor(levelRays,()=>0.5,false,11);
    expect(levelEleven.dispatch({schemaVersion:1,type:'UseAction',commandId:'too-few',expectedRevision:0,
      rulesetContentHash:ruleset.contentHash,actorId:'caster',actionId:levelRays.id,
      targetIds:['one','one'],factsByTarget:{one:fact()},spell:{baseLevel:0}}))
      .toMatchObject({status:'rejected',code:'InvalidTargets'});
  });

  it('persists the next repeated target through a defender reaction and JSON reload',()=>{
    const tape=createStrictRngTape([
      {label:'ray 1 attack',sides:20,value:12},{label:'ray 1 damage',sides:6,value:2},
      {label:'ray 2 attack',sides:20,value:13},{label:'ray 2 damage',sides:6,value:3},
      {label:'ray 3 attack',sides:20,value:14},{label:'ray 3 damage',sides:6,value:4},
    ]);
    const original=sessionFor(threeRays,tape.rng,true);
    const opened=use(original,threeRays,['one','one','one']);
    if(opened.status!=='accepted')throw Error(`${opened.code}: ${opened.message}`);
    expect(original.getState().pendingResolution?.type).toBe('attack_reaction');
    expect(original.getState().attackVolley).toMatchObject({nextSlotIndex:1,targetIds:['one','one','one']});
    const restored=migrateWorldState(JSON.parse(JSON.stringify(original.getState())));
    const session=new InMemoryRulesSession(restored,catalog,
      {rng:tape.rng,clock:createLogicalClock(),nextId:createSequentialIdFactory('unused')});
    for(let index=0;index<3;index++){
      const pending=session.getState().pendingResolution;
      if(!pending||pending.type!=='attack_reaction')throw Error('Expected held attack reaction');
      const result=session.dispatch({schemaVersion:1,type:'ResolveDecision',commandId:`decline-${index}`,
        expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,
        actorId:'one',resolutionId:pending.id,requestId:pending.request.id,
        response:{kind:'reaction',actionId:null}});
      if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
      if(index<2)expect(session.getState().attackVolley).toMatchObject({nextSlotIndex:index+2});
    }
    tape.assertExhausted();
    expect(session.getState().pendingResolution).toBeNull();
    expect(session.getState().attackVolley).toBeNull();
    expect(session.getState().actors.one.runtime.hp.current).toBe(21);
    expect(session.getState().actors.caster.runtime.resources.action).toBe(0);
  });

  it('casts one spell while resolving separate rays against repeated targets',()=>{
    const tape=createStrictRngTape([
      {label:'ray 1 attack',sides:20,value:12},{label:'ray 1 damage A',sides:6,value:2},{label:'ray 1 damage B',sides:6,value:2},
      {label:'ray 2 attack',sides:20,value:13},{label:'ray 2 damage A',sides:6,value:3},{label:'ray 2 damage B',sides:6,value:3},
      {label:'ray 3 attack',sides:20,value:14},{label:'ray 3 damage A',sides:6,value:4},{label:'ray 3 damage B',sides:6,value:4},
    ]);
    const session=sessionFor(spellRays,tape.rng);
    const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'spell-volley',
      expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'caster',
      actionId:spellRays.id,targetIds:['one','one','one'],factsByTarget:{one:fact()},
      spell:{baseLevel:2},
    });
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    tape.assertExhausted();
    expect(session.getState().actors.one.runtime.hp.current).toBe(12);
    expect(session.getState().actors.caster.runtime.resources.spell_slot_2).toBe(0);
    const recorded=result.events.flatMap(entry=>entry.payload.type==='EngineEventRecorded'?[entry.payload.event]:[]);
    expect(recorded.filter(event=>event.type==='narrative'&&event.text==='Сработало: Cast audit')).toHaveLength(1);
    expect(recorded.filter(event=>event.type==='roll'&&event.roll.kind==='d20')).toHaveLength(3);
  });

  it('does not recast a spell when each ray pauses for a reaction',()=>{
    const tape=createStrictRngTape([
      {label:'ray 1 attack',sides:20,value:12},{label:'ray 1 damage A',sides:6,value:2},{label:'ray 1 damage B',sides:6,value:2},
      {label:'ray 2 attack',sides:20,value:13},{label:'ray 2 damage A',sides:6,value:3},{label:'ray 2 damage B',sides:6,value:3},
      {label:'ray 3 attack',sides:20,value:14},{label:'ray 3 damage A',sides:6,value:4},{label:'ray 3 damage B',sides:6,value:4},
    ]);
    const session=sessionFor(spellRays,tape.rng,true);
    const eventBatches=[];
    const opened=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'reactive-spell-volley',
      expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'caster',
      actionId:spellRays.id,targetIds:['one','one','one'],factsByTarget:{one:fact()},spell:{baseLevel:2}});
    if(opened.status!=='accepted')throw Error(`${opened.code}: ${opened.message}`);
    eventBatches.push(opened.events);
    for(let index=0;index<3;index++){
      const pending=session.getState().pendingResolution;
      if(!pending||pending.type!=='attack_reaction')throw Error('Expected held spell attack');
      const result=session.dispatch({schemaVersion:1,type:'ResolveDecision',commandId:`spell-decline-${index}`,
        expectedRevision:session.getState().revision,rulesetContentHash:ruleset.contentHash,
        actorId:'one',resolutionId:pending.id,requestId:pending.request.id,
        response:{kind:'reaction',actionId:null}});
      if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
      eventBatches.push(result.events);
    }
    tape.assertExhausted();
    const castAudit=eventBatches.flat().flatMap(entry=>entry.payload.type==='EngineEventRecorded'?[entry.payload.event]:[])
      .filter(event=>event.type==='narrative'&&event.text==='Сработало: Cast audit');
    expect(castAudit).toHaveLength(1);
    expect(session.getState().actors.caster.runtime.resources.spell_slot_2).toBe(0);
    expect(session.getState().actors.one.runtime.hp.current).toBe(12);
  });

  it('resolves a second spell with different target rules and dice through the same queue',()=>{
    const denied=sessionFor(spellStrikes,()=>0.5);
    expect(denied.dispatch({schemaVersion:1,type:'UseAction',commandId:'deny-duplicate',
      expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'caster',
      actionId:spellStrikes.id,targetIds:['one','one'],factsByTarget:{one:fact()},spell:{baseLevel:1}}))
      .toMatchObject({status:'rejected',code:'InvalidTargets'});
    const tape=createStrictRngTape([
      {label:'cold 1 attack',sides:20,value:12},{label:'cold 1 damage',sides:4,value:2},
      {label:'cold 2 attack',sides:20,value:13},{label:'cold 2 damage',sides:4,value:3},
    ]);
    const session=sessionFor(spellStrikes,tape.rng);
    const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:'two-spell-targets',
      expectedRevision:0,rulesetContentHash:ruleset.contentHash,actorId:'caster',
      actionId:spellStrikes.id,targetIds:['one','two'],factsByTarget:{one:fact(),two:fact()},spell:{baseLevel:1}});
    if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
    tape.assertExhausted();
    expect(session.getState().actors.one.runtime.hp.current).toBe(28);
    expect(session.getState().actors.two.runtime.hp.current).toBe(27);
    expect(session.getState().actors.caster.runtime.resources.spell_slot_1).toBe(0);
    expect(result.events.flatMap(entry=>entry.payload.type==='EngineEventRecorded'?[entry.payload.event]:[])
      .filter(event=>event.type==='narrative'&&event.text==='Сработало: Cast audit')).toHaveLength(1);
  });
});
