import { afterEach, describe, expect, it } from 'vitest';
import { groupCombatSaveBeats, presentCombatEntries } from './presentation';
import type { CombatLogEntry, SoloCombatState } from './types';
import type { EngineEvent, RollLog } from '../mvp/contracts';
import compiled from '../pages/rulesLabFixture.generated.json';
import { builtInAnimationCatalog, setCombatAnimationCatalog, type CombatAnimationProfile } from './animationProfiles';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import { MECH_WEAPON_ATTACK, MECH_OFFHAND_ATTACK, CARD_LONGSWORD } from '../mvp/fixtures';
import type { RuleActionDefinition } from '../rules-core/domain';

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
  it.each(['thunder-rider', 'unrelated-force-rider'])('does not deliver a second hit for the same damage-then-save cast (%s)', id => {
    const definition = {id, name: 'Дополнительное воздействие', kind: 'spell', sourceEntityIds: [id], spell: {level: 1},
      mechanics: {effects: [{resolution: 'auto', result: [{kind: 'damage', type: 'thunder', dice: '2d6'}]},
        {resolution: 'save', ability: 'str', dc: 13, on_fail: [{kind: 'movement', value: 'push', distance_ft: 10}]}]}} as RuleActionDefinition;
    const damage: CombatLogEntry = {id: 'cast', round: 1, actorId: 'hero', text: 'Сохранённое применение', records: [
      {kind: 'action', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'], actionId: id},
      {kind: 'engine', ordinal: 1, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'], actionId: id,
        event: {type: 'damage', amount: 5, damageType: 'thunder'}},
    ]};
    const saved: CombatLogEntry = {id: 'save', round: 1, actorId: 'enemy', text: 'Сохранённый спасбросок', records: [
      {kind: 'engine', ordinal: 0, sourceActorId: 'enemy', actorId: 'enemy', targetIds: ['hero'], actionId: id,
        event: {type: 'roll', label: 'Спасбросок СИЛ', roll: {...roll, kind: 'save', outcome: 'fail', target: {type: 'dc', value: 13}}}},
      {kind: 'engine', ordinal: 1, sourceActorId: 'hero', actorId: 'enemy', targetIds: ['enemy'], actionId: id,
        event: {type: 'movement', mode: 'forced', distanceFt: 10, recipientActorId: 'enemy'}, movement: {from: {x: 3, y: 2}, to: {x: 5, y: 2}}},
    ]};
    const laterCast = {...damage, id: 'second-cast'};
    const laterSave = {...saved, id: 'second-save'};
    const combat = {...state, catalogActions: [definition], log: [damage, saved, laterCast, laterSave]};
    const before = JSON.stringify(combat);
    const beats = presentCombatEntries(combat, combat.log);
    expect(beats.filter(beat => beat.rollKind === 'save').map(beat => beat.suppressAnimation)).toEqual([true, true]);
    expect(beats.filter(beat => beat.damage?.length).map(beat => Boolean(beat.suppressAnimation))).toEqual([false, false]);
    expect(beats[1].presentationChanges).toContainEqual(expect.objectContaining({kind: 'movement', actorId: 'enemy', position: {x: 5, y: 2}}));
    expect(JSON.stringify(combat)).toBe(before);
  });
  it.each([
    {id: 'unrelated-critical-blade', primitive: 'melee_slash' as const, visual: 'slashing' as const},
    {id: 'unrelated-critical-launcher', primitive: 'weapon_throw' as const, visual: 'ranged' as const, weaponShape: 'axe' as const},
  ])('replays only the saved confirmed critical result for $id and retains its weapon and damage palette', data => {
    const base: CombatAnimationProfile = {key: `${data.id}.base`, primitive: data.primitive, casterCircle: false,
      palette: {primary: '#135790', secondary: '#abcdef'}, motion: {durationMs: 900, scale: 1},
      ...('weaponShape' in data ? {weaponShape: data.weaponShape} : {})};
    const critical: CombatAnimationProfile = {...base, key: `${data.id}.heavy`, strikeStyle: 'critical', baseProfileKey: base.key,
      motion: {durationMs: 1400, scale: 1.4, launchRatio: .25, contactRatio: .48}};
    const definition: RuleActionDefinition = {id: data.id, name: 'Не зависит от названия', kind: 'nonSpell', sourceEntityIds: [data.id], mechanics: {}};
    setCombatAnimationCatalog({...builtInAnimationCatalog, profiles: [...builtInAnimationCatalog.profiles, base, critical],
      bindings: [{entity_type: 'action', entity_id: definition.id, profile_key: base.key}],
      defaults: {...builtInAnimationCatalog.defaults, criticalProfile: {[base.key]: critical.key}}});
    const makeLog = (id: string, outcome: RollLog['outcome'], face: number, label = 'Атака'): CombatLogEntry => ({
      id, round: 1, actorId: 'hero', text: 'Сохранённая команда', records: [{kind: 'engine', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'],
      actionId: definition.id, attackPresentation: {visual: data.visual, damageType: 'slashing'},
      event: {type: 'roll', label, roll: {...roll, dice: [{sides: 20, result: face}], outcome}}}]});
    // A recorded natural 20 does not determine delivery; an actual expanded-range
    // critical on 19 does. Pending defensive influence withholds either visual.
    const before = makeLog('before', 'crit', 19, 'Атака — до реакции');
    const after = makeLog('after', 'crit', 19, 'Атака — после реакции');
    after.records!.push({kind: 'engine', ordinal: 1, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'],
      actionId: definition.id, event: {type: 'damage', amount: 12, damageType: 'force'}});
    const logs = [makeLog('ordinary-20', 'hit', 20), makeLog('critical-miss', 'crit_miss', 1), before, after];
    const combat = {...state, catalogActions: [definition], log: logs};
    const saved = JSON.stringify(combat);
    const beats = presentCombatEntries(combat, logs);
    expect(beats.map(beat => beat.animation?.key)).toEqual([base.key, base.key, undefined, critical.key]);
    expect(beats[2]).toMatchObject({rollPhase: 'before-reaction', cues: []});
    expect(beats[3]).toMatchObject({rollPhase: 'after-reaction', animation: {primitive: data.primitive, strikeStyle: 'critical',
      palette: builtInAnimationCatalog.profiles.find(profile => profile.key === 'spell.force')!.palette}, damage: [{amount: 12, damageType: 'force'}]});
    expect(beats[3].animation?.weaponShape).toBe(base.weaponShape);
    expect(beats[3].roll?.dice).toEqual(beats[2].roll?.dice);
    const reloaded = JSON.parse(saved) as SoloCombatState;
    expect(presentCombatEntries(reloaded, reloaded.log)).toEqual(beats);
    expect(JSON.stringify(combat)).toBe(saved);
  });
  it.each([
    {id: 'unrelated-main', damage: 'slashing', hand: 'main_hand', mechanics: MECH_WEAPON_ATTACK, primitive: 'melee_slash'},
    {id: 'unrelated-off', damage: 'piercing', hand: 'off_hand', mechanics: MECH_OFFHAND_ATTACK, primitive: 'melee_pierce'},
    {id: 'pact-main', damage: 'slashing', hand: 'main_hand', mechanics: MECH_WEAPON_ATTACK, primitive: 'melee_slash', pactDamage: 'necrotic'},
    {id: 'pact-off', damage: 'piercing', hand: 'off_hand', mechanics: MECH_OFFHAND_ATTACK, primitive: 'melee_pierce', pactDamage: 'radiant'},
    {id: 'pact-force', damage: 'slashing', hand: 'main_hand', mechanics: MECH_WEAPON_ATTACK, primitive: 'melee_slash', pactDamage: 'force'},
  ])('resolves a canonical weapon entry through concrete provenance and the committed $hand card', data => {
    const weapon = withDeclaredTestWeaponProfile({...CARD_LONGSWORD, id: data.id, name: 'Переименовано'}, {
      weaponType: 'arbitrary', proficiencyCategory: 'martial', attackAbility: 'str', damageLines: [{dice: '1d8', type: data.damage}],
      defaultAttackMode: 'melee', attackModes: [{kind: 'melee', reach_ft: 5}], properties: [], masteryEffectId: 'test-mastery',
    });
    const definition = {id: `sheet-${data.id}`, name: 'Не связано с именем оружия', kind: 'nonSpell', sourceEntityIds: [`sheet-${data.id}`],
      mechanics: data.mechanics} as RuleActionDefinition;
    // The currently equipped card has already changed; the event selects its own card.
    const character = {...state.world.actors.hero.character, knownCards: [weapon], equippedCards: []};
    const combat = {...state, catalogActions: [definition], world: {...state.world, actors: {...state.world.actors,
      hero: {...state.world.actors.hero, character, runtime: {...state.world.actors.hero.runtime, equipment: {main_hand: 'later-item', off_hand: null}}}}}};
    const log = entry([{type: 'roll', label: 'Атака', roll: {...roll, outcome: 'miss'}}], 'Произвольный текст');
    log.records = log.records!.map(record => ({...record, actionId: 'canonical-attack-entry',
      sourceEntityIds: [definition.id, `card:${weapon.id}`], facts: {weaponCardId: weapon.id,
        ...('pactDamage' in data ? {pactBlade: {damageType: data.pactDamage}} : {})}}));
    const previous = JSON.stringify({combat, log});
    const beat = presentCombatEntries(combat, [log])[0];
    expect(beat).toMatchObject({actionId: definition.id, visual: data.damage, animation: {primitive: data.primitive}});
    if ('pactDamage' in data && data.pactDamage === 'force') expect(beat.animation?.palette).toEqual(builtInAnimationCatalog.profiles.find(profile => profile.key === 'spell.force')?.palette);
    expect(JSON.stringify({combat, log})).toBe(previous);
  });
  it.each([
    {id: 'arbitrary-fang', profile: 'natural.bite', damage: 'fire', primitive: 'bite'},
    {id: 'arbitrary-pincer', profile: 'natural.claws', damage: 'slashing', primitive: 'claws'},
  ])('preserves an assigned natural attack for a derived reaction regardless of its damage ($id)', data => {
    setCombatAnimationCatalog({...builtInAnimationCatalog, bindings: [{entity_type: 'action', entity_id: data.id, profile_key: data.profile}]});
    const definition = {id: `${data.id}:reaction`, name: 'Произвольное имя', kind: 'nonSpell', sourceEntityIds: [data.id], mechanics: {
      effects: [{resolution: 'attack_roll', attack_kind: 'weapon_melee', attack_bonus_override: 5,
        on_hit: [{kind: 'damage', type: data.damage, amount: '2d6'}]}]}} as RuleActionDefinition;
    const log = entry([{type: 'roll', label: 'Атака', roll}], 'Действие');
    log.records![0].actionId = definition.id;
    expect(presentCombatEntries({...state, catalogActions: [definition]}, [log])[0].animation?.primitive).toBe(data.primitive);
  });
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
  it('starts the turn silently and keeps actual later damage delivery separate', () => {
    const [turn, damage] = presentCombatEntries(state, [entry([{type: 'turn_started'}, {type: 'damage', amount: 4, damageType: 'fire'}], 'Начало')]);
    expect(turn).toMatchObject({sourceId: 'hero', targetId: 'hero', actionName: 'Начало хода',
      blocksInput: false, cues: [], suppressAnimation: true, presentationDurationMs: 0,
      from: {x: 2, y: 2}, to: {x: 2, y: 2}});
    expect(turn.animation).toBeUndefined();
    expect(turn.damage).toBeUndefined();
    expect(damage).toMatchObject({targetId: 'enemy', damage: [{amount: 4, damageType: 'fire'}]});
  });
  it.each(['turn_started','turn_ended'] as const)('does not invent a spell delivery for a %s boundary', type => {
    const boundary = entry([{type}], 'Граница хода');
    const [beat] = presentCombatEntries(state, [boundary]);
    expect(beat).toMatchObject({suppressAnimation: true, presentationDurationMs: 0, cues: []});
    expect(beat.animation).toBeUndefined(); expect(beat.visual).toBeUndefined();
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
    expect(beats[0].cues.map(cue => cue.text)).toEqual(['+7 врем. HP', 'Стабилизирован']);
    expect(beats[0].cues.every(cue => cue.kind === 'effect')).toBe(true);
    expect(beats[0].animation).toBeDefined();
    expect(beats[1]).toMatchObject({suppressAnimation: true, cues: [{actorId: 'enemy', text: 'Защита: завершено', kind: 'effect'}]});
    expect(beats[1].animation).toBeUndefined(); expect(beats[1].visual).toBeUndefined();
    expect(beats[2]).toMatchObject({targetId: 'enemy', animation: {primitive: 'death'}, cues: [{actorId: 'enemy', text: 'Погибает'}]});
  });
  it.each(['Защита', 'Другое состояние'])('does not replay healing when %s expires after a real heal', name => {
    const log = entry([{type: 'healing', amount: 4}, {type: 'effect_expired', name}], 'Обновление');
    const beats = presentCombatEntries(state, [log]);
    expect(beats[0].cues).toMatchObject([{kind: 'healing', text: '+4'}]);
    expect(beats[1]).toMatchObject({suppressAnimation: true, cues: [{kind: 'effect', text: `${name}: завершено`}]});
    expect(beats[1].animation).toBeUndefined(); expect(beats[1].visual).toBeUndefined();
  });
  it('uses movement coordinates captured by the log after the token has moved again', () => {
    const log: CombatLogEntry = {id: 'move', round: 1, actorId: 'hero', text: 'Произвольный текст', records: [{
      kind: 'movement', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['hero'],
      movement: {from: {x: 0, y: 0}, to: {x: 1, y: 0}},
    }]};
    expect(presentCombatEntries(state, [log])[0]).toMatchObject({from: {x: 0, y: 0}, to: {x: 1, y: 0}, animation: {primitive: 'move'}});
  });
  it('uses each attacking and defending cell before subsequent movements in the same response', () => {
    const first = {...entry([{type: 'roll', label: 'Атака', roll}]), id: 'first-hit'};
    const movement: CombatLogEntry = {id: 'later-movement', round: 1, actorId: 'hero', text: 'Сохранено', records: [
      {kind: 'movement', ordinal: 0, sourceActorId: 'hero', actorId: 'hero', targetIds: ['hero'], movement: {from: {x: 2, y: 2}, to: {x: 5, y: 2}}},
      {kind: 'engine', ordinal: 1, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'],
        event: {type: 'movement', recipientActorId: 'enemy', mode: 'push', distanceFt: 5}, movement: {from: {x: 3, y: 2}, to: {x: 6, y: 2}}},
    ]};
    const second = {...first, id: 'second-hit'};
    const combat = {...state, log: [first, movement, second], tokens: {...state.tokens,
      hero: {...state.tokens.hero, position: {x: 5, y: 2}}, enemy: {...state.tokens.enemy, position: {x: 6, y: 2}}}};
    const beats = presentCombatEntries(combat, combat.log).filter(beat => beat.roll);
    expect(beats[0]).toMatchObject({from: {x: 2, y: 2}, to: {x: 3, y: 2}});
    expect(beats[1]).toMatchObject({from: {x: 5, y: 2}, to: {x: 6, y: 2}});
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
  it('colors a confirmed chosen damage type while retaining the physical attack primitive', () => {
    const [beat] = presentCombatEntries(state, [entry([{type: 'roll', label: 'Атака', roll},
      {type: 'damage', amount: 4, damageType: 'force'}])]);
    expect(beat.animation?.primitive).toBe('melee_slash');
    expect(beat.animation?.palette).toEqual(builtInAnimationCatalog.profiles.find(profile => profile.key === 'spell.force')?.palette);
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
