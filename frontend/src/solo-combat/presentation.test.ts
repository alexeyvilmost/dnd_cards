import { afterEach, describe, expect, it } from 'vitest';
import { groupCombatSaveBeats, presentCombatEntries } from './presentation';
import type { CombatLogEntry, SoloCombatState } from './types';
import type { EngineEvent, RollLog } from '../mvp/contracts';
import compiled from '../pages/rulesLabFixture.generated.json';
import { builtInAnimationCatalog, setCombatAnimationCatalog } from './animationProfiles';

const roll: RollLog = {kind: 'd20', dice: [{sides: 20, result: 15}], total: 20,
  modifiers: [{source: 'Атака', value: 5}], advantage: 'none', outcome: 'hit', target: {type: 'ac', value: 14}, text: 'к20: 15 +5 = 20'};
const actor = compiled.roots.magicInitiateFighter.actor;
const state = {world: {actors: {hero: {...actor, id: 'hero', name: 'Герой'}, enemy: {...actor, id: 'enemy', name: 'Враг'}}},
  tokens: {hero: {position: {x: 2, y: 2}}, enemy: {position: {x: 3, y: 2}}},
  catalogActions: [{id: 'sword', name: 'Удар', mechanics: {effects: [{resolution: 'attack_roll', on_hit: [{kind: 'damage', type: 'slashing'}]}]}},
    {id: 'dash', name: 'Рывок', mechanics: {activation: {counts_as: 'dash'}}}], dashActionId: 'dash'} as unknown as SoloCombatState;
const entry = (events: EngineEvent[], text = 'Герой: Удар: выполнено'): CombatLogEntry => ({id: 'entry', round: 1, actorId: 'hero', text,
  records: events.map((event, ordinal) => ({kind: 'engine', ordinal, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'], event}))});

describe('combat presentation from committed events', () => {
  afterEach(() => setCombatAnimationCatalog(builtInAnimationCatalog));
  it.each([
    {id: 'arbitrary-lantern', name: 'Световой знак', entityId: 'lamp-entity', baseLevel: 0, castLevel: 0, profile: 'spell.light', position: {x: 9, y: 4}},
    {id: 'arbitrary-protection', name: 'Другая защита', entityId: 'protection-entity', baseLevel: 1, castLevel: 5, profile: 'spell.blade-ward', position: {x: 0, y: 1}},
  ])('animates a utility entity from its declaration, independent of log names ($id)', data => {
    setCombatAnimationCatalog({...builtInAnimationCatalog, bindings: [{entity_type: 'spell', entity_id: data.entityId, profile_key: data.profile}]});
    const utility = {id: data.id, name: data.name, kind: 'spell' as const, sourceEntityIds: [data.entityId] as [string],
      spell: {level: data.baseLevel, entityId: data.entityId}, mechanics: {}};
    const log: CombatLogEntry = {id: 'utility', round: 1, actorId: 'hero', text: 'Произвольный текст без названия', records: [{
      kind: 'action', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: [],
      actionId: utility.id, actionKind: 'spell', sourceEntityIds: [data.entityId], spell: {baseLevel: data.baseLevel, castLevel: data.castLevel},
      targetPosition: data.position,
    }, {kind: 'engine', ordinal: 1, sourceActorId: 'hero', actorId: 'hero', targetIds: [], actionId: utility.id,
      sourceEntityIds: [data.entityId], spell: {baseLevel: data.baseLevel, castLevel: data.castLevel},
      event: {type: 'world_interaction', operation: 'visual_effect', parameters: {}}}]};
    const [beat] = presentCombatEntries({...state, catalogActions: [utility]}, [log]);
    expect(beat).toMatchObject({actionId: data.id, actionName: data.name, spellLevel: data.castLevel,
      sourceEntityIds: [data.entityId], entityRef: {kind: 'spell', id: data.entityId}, from: {x: 2, y: 2}, to: data.position, targetIsPoint: true});
    expect(beat.animation?.key).toBe(data.profile);
    expect(beat.roll).toBeUndefined();
  });
  it('starts the turn with a quiet nonblocking self pulse and keeps later damage separate', () => {
    const [turn, damage] = presentCombatEntries(state, [entry([{type: 'turn_started'}, {type: 'damage', amount: 4, damageType: 'fire'}], 'Начало')]);
    expect(turn).toMatchObject({sourceId: 'hero', targetId: 'hero', actionName: 'Начало хода',
      blocksInput: false, cues: [], animation: {key: 'action.effect'}, from: {x: 2, y: 2}, to: {x: 2, y: 2}});
    expect(turn.damage).toBeUndefined();
    expect(damage).toMatchObject({targetId: 'enemy', damage: [{amount: 4, damageType: 'fire'}]});
  });
  it('does not turn a declaration awaiting a save into a completed utility animation', () => {
    const spell = {id: 'spell', name: 'Ожидание', kind: 'spell' as const, sourceEntityIds: ['spell'] as [string], spell: {level: 0}, mechanics: {}};
    const log: CombatLogEntry = {id: 'waiting', round: 1, actorId: 'hero', text: 'Произвольный текст', records: [{
      kind: 'action', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'], actionId: spell.id,
    }]};
    const waiting = {...state, catalogActions: [spell], world: {...state.world,
      pendingResolution: {type: 'target_save', actionId: spell.id, sourceActorId: 'hero'}}} as unknown as SoloCombatState;
    expect(presentCombatEntries(waiting, [log])).toEqual([]);
  });
  it('retains temporary HP, stabilization, expiry and death as committed visual results', () => {
    const log = entry([{type: 'temp_hp', amount: 7}, {type: 'stabilized'}, {type: 'effect_expired', name: 'Защита'}], 'Обновление');
    log.records!.push({kind: 'death', ordinal: 3, sourceActorId: 'hero', actorId: 'enemy', targetIds: ['enemy']});
    const beats = presentCombatEntries(state, [log]);
    expect(beats[0].cues.map(cue => cue.text)).toEqual(['+7 врем. HP', 'Стабилизирован', 'Защита: завершено']);
    expect(beats[0].animation).toBeDefined();
    expect(beats[1]).toMatchObject({targetId: 'enemy', animation: {primitive: 'death'}, cues: [{actorId: 'enemy', text: 'Погибает'}]});
  });
  it('uses movement coordinates captured by the log after the token has moved again', () => {
    const log: CombatLogEntry = {id: 'move', round: 1, actorId: 'hero', text: 'Произвольный текст', records: [{
      kind: 'movement', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['hero'],
      movement: {from: {x: 0, y: 0}, to: {x: 1, y: 0}},
    }]};
    expect(presentCombatEntries(state, [log])[0]).toMatchObject({from: {x: 0, y: 0}, to: {x: 1, y: 0}, animation: {primitive: 'move'}});
  });
  it('withholds miss cues as well as the strike before a defensive reaction', () => {
    const [beat] = presentCombatEntries(state, [entry([{type: 'roll', label: 'Атака — до реакции', roll: {...roll, outcome: 'miss'}}])]);
    expect(beat.rollPhase).toBe('before-reaction');
    expect(beat.cues).toEqual([]); expect(beat.animation).toBeUndefined();
  });
  it.each(['success','fail'] as const)('presents a defender-owned %s save followed by the caster-owned damage',outcome=>{
    const save={...roll,kind:'save' as const,outcome,target:{type:'dc' as const,value:15}};
    const log:CombatLogEntry={id:'save',round:1,actorId:'enemy',text:'Разрешение спасброска',records:[
      {kind:'engine',ordinal:0,sourceActorId:'enemy',actorId:'enemy',targetIds:['hero'],event:{type:'roll',label:'Дыхание дракона: спасбросок Ловкости',roll:save}},
      {kind:'engine',ordinal:1,sourceActorId:'hero',actorId:'hero',targetIds:['enemy'],event:{type:'damage',amount:outcome==='success'?3:6,damageType:'fire',roll:{...roll,kind:'damage',dice:[{sides:6,result:6}],total:6}}},
    ]};
    const result=presentCombatEntries({...state,characterId:'hero',sideByActorId:{hero:'party',enemy:'enemy'}},[log]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({sourceId:'hero',targetId:'enemy',rollKind:'save',rollerName:'Враг',audience:'own',actionName:'Дыхание дракона',damage:[{amount:outcome==='success'?3:6}]});
  });
  it('keeps different saving targets and their damage separate',()=>{
    const logs:CombatLogEntry={id:'area',round:1,actorId:'hero',text:'Герой: Удар:',records:['enemy','hero'].flatMap((target,i)=>[
      {kind:'engine' as const,ordinal:i*2,actorId:target,sourceActorId:target,targetIds:['hero'],event:{type:'roll' as const,label:'Дыхание дракона: спасбросок',roll:{...roll,kind:'save' as const,outcome:'fail' as const}}},
      {kind:'engine' as const,ordinal:i*2+1,actorId:'hero',sourceActorId:'hero',targetIds:[target],event:{type:'damage' as const,amount:i+2,damageType:'fire'}},
    ])};
    const result=presentCombatEntries(state,[logs]);
    expect(result.map(beat=>[beat.targetId,beat.damage?.[0].amount])).toEqual([['enemy',2],['hero',3]]);
    const grouped=groupCombatSaveBeats(result);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].saveRows?.map(row=>row.damage?.[0].amount)).toEqual([2,3]);
    expect(grouped[0].cues).toHaveLength(4);
    expect(groupCombatSaveBeats([result[0],{...result[1],saveGroupId:'different-cast'}])).toHaveLength(2);
    expect(groupCombatSaveBeats([result[0],result[0]])).toHaveLength(2);
  });
  it('classifies the actual attacking source, including opportunity attacks and allies',()=>{
    const combat={...state,characterId:'hero',sideByActorId:{hero:'party',ally:'party',enemy:'hostile'}};
    for (const [source,audience] of [['hero','own'],['ally','own'],['enemy','enemy']]) {
      // The log's main actor can differ from the reaction's source actor.
      const log=entry([{type:'roll',label:'Атака',roll}]);
      log.records=log.records!.map(record=>({...record,sourceActorId:source}));
      expect(presentCombatEntries(combat,[log])[0]).toMatchObject({sourceId:source,audience});
    }
  });
  it.each(['Атака — после реакции', 'Атака'])('waits for a defensive reaction or its decline before impact (%s)', (label) => {
    const before = entry([{type: 'roll', label: 'Атака — до реакции', roll}]);
    const after = {...entry([{type: 'roll', label, roll: {...roll, target: {type: 'ac', value: 21}, outcome: 'miss'}}], 'Герой: Разрешение реакции/спасброска: выполнено'), id: 'after'};
    const beats = presentCombatEntries({...state, log: [before, after]}, [before, after]);
    expect(beats[0]).toMatchObject({rollPhase: 'before-reaction', cues: []});
    expect(beats[0].visual).toBeUndefined();
    expect(beats[1]).toMatchObject({actionName: 'Удар', rollPhase: 'after-reaction', visual: 'slashing', cues: [{actorId: 'enemy', kind: 'miss', text: 'Промах (20)'}]});
    expect(beats[1].roll?.dice).toEqual(beats[0].roll?.dice);
  });
  it('retains equal damage packets and associates statuses with the correct target', () => {
    const beats = presentCombatEntries(state, [entry([
      {type: 'roll', label: 'Атака', roll},
      {type: 'damage', amount: 3, damageType: 'slashing'}, {type: 'damage', amount: 3, damageType: 'slashing'},
      {type: 'effect_applied', name: 'Скорость снижена', sourceAction: 'Луч холода', ownerActorId: 'enemy'},
      {type: 'effect_applied', name: 'Уклонение', ownerActorId: 'hero'},
    ])]);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({sourceId: 'hero', targetId: 'enemy', visual: 'slashing'});
    expect(beats[0].cues.filter(cue => cue.kind === 'damage')).toHaveLength(2);
    expect(beats[0].cues).toContainEqual({actorId: 'enemy', text: 'Скорость снижена (Луч холода)', kind: 'effect'});
    expect(beats[0].cues).toContainEqual({actorId: 'hero', text: 'Уклонение', kind: 'effect'});
  });
  it('keeps multiattack rolls separate and displays misses', () => {
    const beats = presentCombatEntries(state, [entry([{type: 'roll', label: 'Атака', roll}, {type: 'damage', amount: 6, damageType: 'piercing'},
      {type: 'roll', label: 'Атака', roll: {...roll, outcome: 'miss', total: 8}}])]);
    expect(beats).toHaveLength(2);
    expect(beats[0].visual).toBe('piercing');
    expect(beats[1].cues).toEqual([{actorId: 'enemy', kind: 'miss', text: 'Промах (8)'}]);
  });
  it('keeps the committed damage dice and resistance calculation on a successful attack beat', () => {
    const damageRoll: RollLog = {kind: 'damage', dice: [{sides: 8, result: 6}], total: 9,
      modifiers: [{source: 'Сила', value: 3}], advantage: 'none', text: 'к8: 6 +3 [Сила] = 9'};
    const [beat] = presentCombatEntries(state, [entry([
      {type: 'roll', label: 'Атака', roll},
      {type: 'damage', amount: 4, damageType: 'slashing', roll: damageRoll,
        calculation: {beforeResistance: 9, adjustments: [{level: 'resistance', sourceEntityIds: ['armor']}] }},
    ])]);
    expect(beat.damage).toEqual([expect.objectContaining({
      amount: 4, damageType: 'slashing', roll: damageRoll,
      beforeResistance: 9, adjustment: 'resistance',
    })]);
  });
  it('displays Dash without inventing an attack roll', () => {
    const beats = presentCombatEntries(state, [entry([], 'Герой: Рывок: выполнено')]);
    expect(beats[0].roll).toBeUndefined();
    expect(beats[0].cues).toEqual([{actorId: 'hero', kind: 'effect', text: 'Рывок'}]);
  });
});
