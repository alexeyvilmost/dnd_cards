import {describe, expect, it, vi} from 'vitest';
import {createWorld, type ActorState, type RuleActionDefinition} from '../rules-core/domain';
import {CARD_LONGSWORD, MECH_WEAPON_ATTACK} from '../mvp/fixtures';
import {withDeclaredTestWeaponProfile} from '../testing/weaponProfileFixtures';
import {autoResolveSystemDecisions, executeCombatAction} from './engine';
import {areaEffectOrigin, areaPositionsForAction} from './tacticalGrid';
import {presentCombatEntries, groupCombatSaveBeats} from './presentation';
import type {SoloCombatState} from './types';
import speciesPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import {projectRuleAction} from '../canon/ruleActionProjection';
import {actionUsesKey} from '../engine/actionUses';
import type {Action, Spell} from '../types';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CombatMapFeedback from '../components/CombatMapFeedback';
import {builtInAnimationCatalog} from './animationProfiles';

function actor(id: string, actionId: string): ActorState {
  return {id, name: id, kind: id === 'source' ? 'playerCharacter' : 'monster', controllerId: id, ac: 12,
    capabilities: {actionIds: [actionId]}, character: {baseSize: 1, baseSpeed: 30,
      abilityMods: {str: 2, dex: 2, con: 0, int: 0, wis: 0, cha: 0}, profBonus: 2, level: 1},
    runtime: {hp: {current: 20, max: 20, temp: 0}, resources: {action: 1, reaction: 1}, maxResources: {action: 1, reaction: 1},
      inventory: [], equipment: {}, activeEffects: []}};
}
function setup(action: RuleActionDefinition): SoloCombatState {
  const world = createWorld({id: 'animation-snapshot', ruleset: {systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: 'test'},
    actors: ['source', 'one', 'two'].map(id => actor(id, action.id))});
  world.scene = {mode: 'encounter', round: 1, activeIndex: 0, initiative: ['source', 'one', 'two'], turnStarted: true};
  return {schemaVersion: 1, characterId: 'source', controlledCharacterIds: ['source'], runtimeRevision: 0, world,
    tokens: Object.fromEntries(Object.entries({source: {x: 2, y: 2}, one: {x: 3, y: 2}, two: {x: 4, y: 2}}).map(([id, position]) => [id, {actorId: id, position}])),
    sideByActorId: {source: 'party', one: 'enemy', two: 'enemy'}, combatAreas: {}, boardRevision: 0,
    catalogActions: [action], playerActionIds: [action.id], certifiedPlayerActionIds: [], movementRemainingFt: {source: 30},
    log: [], outcome: 'active', actionPresentation: {}} as unknown as SoloCombatState;
}
const targeting = {rangeFt: 60, minTargets: 1, maxTargets: 8, requiresLineOfSight: false, allowedRelations: ['enemy' as const]};

describe('animation snapshots of committed combat', () => {
  it.each([
    {cardNumber: 'fire_bolt', profileKey: 'spell.fire-bolt', primitive: 'projectile'},
    {cardNumber: 'SPELL-0218', profileKey: 'spell.frost-ray', primitive: 'charged_beam'},
  ])('executes canon $cardNumber and replays its confirmed magical critical without new rolls', data => {
    const row = speciesPatch.mechanicsPatches.spells.find(row => row.cardNumber === data.cardNumber)!;
    const entity = {id: row.entityId, card_number: row.cardNumber, name: 'Произвольное имя заклинания', level: 0, mechanics: row.mechanics} as unknown as Spell;
    const action = projectRuleAction(entity, {grantScopeId: 'unrelated-spell-grant', sourceEntityIds: ['unrelated-spell-grant']});
    const state = setup(action);
    state.world.actors.source.spellcastingAccess = {grants: [{grantId: 'unrelated-spell-grant', sourceId: 'unrelated-spell-grant',
      actionId: action.id, access: 'cantrip', level: 0, spellcastingAbility: 'int'}], preparedSources: {}};
    const before = JSON.stringify(state), rng = vi.fn(() => .99);
    const after = autoResolveSystemDecisions(executeCombatAction({state, actorId: 'source', actionId: action.id, targetIds: ['one'], rng}), rng);
    const callsAfterCommand = rng.mock.calls.length;
    expect(callsAfterCommand).toBeGreaterThan(0);
    const saved = JSON.stringify(after);
    const live = presentCombatEntries(after, after.log);
    const attack = live.find(beat => beat.roll?.target?.type === 'ac');
    expect(attack).toMatchObject({actionId: action.id, roll: {outcome: 'crit'}, animation: {
      key: builtInAnimationCatalog.defaults.criticalProfile![data.profileKey], baseProfileKey: data.profileKey,
      primitive: data.primitive, strikeStyle: 'critical', criticalEffect: 'magic', casterCircle: true}});
    expect(attack?.roll?.dice.every(die => die.result === 20)).toBe(true);
    expect(attack?.rollPhase).not.toBe('before-reaction');
    expect(attack?.damage?.length).toBeGreaterThan(0);
    const reloaded = JSON.parse(saved) as SoloCombatState;
    expect(presentCombatEntries(reloaded, reloaded.log)).toEqual(live);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(after)).toBe(saved);
    expect(JSON.stringify(reloaded)).toBe(saved);
    expect(rng).toHaveBeenCalledTimes(callsAfterCommand);
  });
  it.each(['ACT-breath-fire', 'ACT-breath-acid'].flatMap(cardNumber => [1, 2].map(targets => ({cardNumber, targets}))))(
    'renders the catalog $cardNumber through Attack replacement with $targets targets', ({cardNumber, targets}) => {
    const row = speciesPatch.mechanicsPatches.actions.find(row => row.cardNumber === cardNumber)!;
    const entity = {id: row.entityId, card_number: row.cardNumber, name: `Дыхание ${cardNumber}`, mechanics: row.mechanics} as unknown as Action;
    const action = projectRuleAction(entity, {grantScopeId: 'ancestry-scope', sourceEntityIds: ['ancestry-scope']});
    const state = setup(action);
    if (targets === 1) state.tokens.two.position = {x: 10, y: 8};
    const uses = actionUsesKey(cardNumber);
    state.world.actors.source.runtime.resources[uses] = 2;
    state.world.actors.source.runtime.maxResources[uses] = 2;
    const after = autoResolveSystemDecisions(executeCombatAction({state, actorId: 'source', actionId: action.id,
      targetIds: ['one'], worldPosition: {x: 4, y: 2}, rng: () => .1}), () => .1);
    const beats = groupCombatSaveBeats(presentCombatEntries(after, after.log));
    const cast = beats.find(beat => beat.actionId === action.id && !beat.suppressAnimation);
    expect(cast, JSON.stringify(beats)).toMatchObject({animation: {primitive: 'area_cone', casterCircle: false},
      area: {geometry: {kind: 'cone', sizeFt: 15}, origin: {x: 2, y: 2}, aim: {x: 4, y: 2}}});
    expect(cast!.saveRows ?? [cast]).toHaveLength(targets);
    expect(after.world.actors.source.runtime.resources[uses]).toBe(1);
    const html = renderToStaticMarkup(createElement(CombatMapFeedback, {state: after, beat: cast ?? null}));
    expect(html).toContain('data-area-kind="cone"');
    expect(html.match(/data-animation-profile=/g)).toHaveLength(1);
    expect(html).not.toContain('data-ring-count=');
    // Simulate prior pinned artifacts: accepted point persists, area FX fields do not.
    const legacy = JSON.parse(JSON.stringify(after)) as SoloCombatState;
    for (const entry of legacy.log) for (const record of entry.records ?? []) delete record.area;
    const legacyCast = groupCombatSaveBeats(presentCombatEntries(legacy, legacy.log)).find(beat => beat.actionId === action.id && !beat.suppressAnimation);
    const legacyHtml = renderToStaticMarkup(createElement(CombatMapFeedback, {state: legacy, beat: legacyCast ?? null}));
    expect(legacyHtml).toContain('data-area-kind="cone"');
    expect(legacyHtml.match(/data-animation-profile=/g)).toHaveLength(1);
  });
  it.each([
    {id: 'different-blade', weaponType: 'longsword', properties: [], damage: 'slashing', mode: 'melee' as const, primitive: 'melee_slash', criticalBase: 'weapon.slash'},
    {id: 'different-bow', weaponType: 'shortbow', properties: ['ammunition'], damage: 'piercing', mode: 'ranged' as const, primitive: 'ranged_arrow', criticalBase: 'weapon.arrow'},
    {id: 'different-projector', weaponType: 'pistol', properties: ['ammunition'], damage: 'piercing', mode: 'ranged' as const, primitive: 'firearm'},
    {id: 'different-thrower', weaponType: 'handaxe', properties: ['thrown'], damage: 'slashing', mode: 'ranged' as const, primitive: 'weapon_throw'},
  ])('persists $id mode and damage before the source changes equipment', data => {
    const action = {id: data.id, name: 'Произвольное имя', kind: 'nonSpell', sourceEntityIds: [data.id], targeting: {...targeting, maxTargets: 1},
      mechanics: {...MECH_WEAPON_ATTACK, targeting: {domain: 'actor', shape: 'single', range_ft: 60, actor_targets: true, min_targets: 1, max_targets: 1,
        allowed_relations: ['enemy'], requires_line_of_sight: false}, effects: [{resolution: 'attack_roll', attack_kind: `weapon_${data.mode}`, ability: 'auto', vs: 'ac',
        on_hit: [{kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto'}]}]}} as RuleActionDefinition;
    const state = setup(action);
    const weapon = withDeclaredTestWeaponProfile({...CARD_LONGSWORD, id: `${data.id}-item`}, {
      weaponType: data.weaponType, proficiencyCategory: 'martial', attackAbility: 'str', damageLines: [{dice: '1d8', type: data.damage}],
      defaultAttackMode: data.mode, attackModes: data.mode === 'melee' ? [{kind: 'melee', reach_ft: 5}] : [{kind: 'ranged', normal_ft: 80, long_ft: 320}],
      properties: data.properties, masteryEffectId: 'test-mastery', ...((data.properties as string[]).includes('ammunition') ? {ammo: {card_id: 'test-ammo'}} : {}),
    });
    state.world.actors.source.character.knownCards = [weapon];
    state.world.actors.source.runtime.equipment = {main_hand: weapon.id};
    const before = JSON.stringify(state);
    const rng = vi.fn(() => 'criticalBase' in data ? .99 : .1);
    const after = autoResolveSystemDecisions(executeCombatAction({state, actorId: 'source', actionId: action.id, targetIds: ['one'], rng}), rng);
    const record = after.log.flatMap(entry => entry.records ?? []).find(record => record.event?.type === 'roll' && record.event.roll.target?.type === 'ac');
    expect(record?.attackPresentation).toMatchObject({damageType: data.damage, weaponCardId: weapon.id});
    expect(JSON.stringify(state)).toBe(before);
    const callsAfterCommand = rng.mock.calls.length;
    expect(callsAfterCommand).toBeGreaterThan(0);
    const live = presentCombatEntries(after, after.log);
    if ('criticalBase' in data) {
      expect(record?.event).toMatchObject({type: 'roll', roll: {outcome: 'crit'}});
      if (record?.event?.type === 'roll') expect(record.event.roll.dice.every(die => die.result === 20)).toBe(true);
      const attack = live.find(beat => beat.roll?.target?.type === 'ac');
      expect(attack?.animation).toMatchObject({key: builtInAnimationCatalog.defaults.criticalProfile![data.criticalBase!],
        primitive: data.primitive, strikeStyle: 'critical', baseProfileKey: data.criticalBase});
      expect(attack?.animation?.key).not.toBe(data.criticalBase);
      expect(attack?.rollPhase).not.toBe('before-reaction');
    }
    after.world.actors.source.runtime.equipment = {};
    after.world.actors.source.character.knownCards = [];
    const saved = JSON.stringify(after);
    const reloaded = JSON.parse(saved) as SoloCombatState;
    const replay = presentCombatEntries(reloaded, reloaded.log);
    expect(replay.find(beat => beat.roll?.target?.type === 'ac')?.animation?.primitive).toBe(data.primitive);
    expect(replay).toEqual(live);
    expect(JSON.stringify(reloaded)).toBe(saved);
    expect(rng).toHaveBeenCalledTimes(callsAfterCommand);
  });

  it.each([
    {id: 'unrelated-flame', area: {kind: 'cone', size_ft: 15}, type: 'fire'},
    {id: 'unrelated-splash', area: {kind: 'sphere', radius_ft: 5}, type: 'acid'},
    {id: 'unrelated-wave', area: {kind: 'cube', size_ft: 15}, type: 'thunder'},
  ])('persists exact $id geometry once through deferred saves and reload', data => {
    const action = {id: data.id, name: 'Другое имя', kind: 'nonSpell', sourceEntityIds: [data.id], targeting,
      mechanics: {activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
        targeting: {domain: 'actor', shape: 'area', actor_targets: true, area: data.area},
        effects: [{resolution: 'save', who: 'target', ability: 'dex', dc: 12, on_fail: [{kind: 'damage', type: data.type, amount: '3'}], on_success: []}]}} as RuleActionDefinition;
    const state = setup(action), aimPosition = {x: 3, y: 2};
    const areaInput = {board: state, action, sourcePosition: state.tokens.source.position, aimPosition};
    const before = JSON.stringify(state);
    const after = autoResolveSystemDecisions(executeCombatAction({state, actorId: 'source', actionId: action.id, targetIds: ['one'], worldPosition: aimPosition, rng: () => .1}), () => .1);
    const declaration = after.log.flatMap(entry => entry.records ?? []).find(record => record.kind === 'action' && record.actionId === action.id);
    expect(declaration?.area).toMatchObject({sourcePosition: {x: 2, y: 2}, origin: areaEffectOrigin(areaInput), aim: aimPosition, cells: areaPositionsForAction(areaInput)});
    expect(JSON.stringify(state)).toBe(before);
    after.tokens.source.position = {x: 10, y: 8};
    const reloaded = JSON.parse(JSON.stringify(after)) as SoloCombatState;
    const beats = presentCombatEntries(reloaded, reloaded.log).filter(beat => beat.rollKind === 'save');
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({area: declaration!.area, from: {x: 2, y: 2}});
    expect(beats.filter(beat => beat.area && !beat.suppressAnimation)).toHaveLength(1);
    expect(presentCombatEntries(reloaded, [reloaded.log.find(entry => entry.id === beats[1].sourceEntryId)!])[0].suppressAnimation).toBe(true);
    expect(groupCombatSaveBeats(beats)).toHaveLength(1);
    const deathAndMovement = {...reloaded.log.find(entry => entry.id === beats[0].sourceEntryId)!, id: 'death-and-movement'};
    deathAndMovement.records = [...deathAndMovement.records!,
      {kind: 'death', ordinal: 900, sourceActorId: 'source', actorId: 'one', targetIds: ['one']},
      {kind: 'movement', ordinal: 901, sourceActorId: 'source', actorId: 'source', targetIds: ['source'], movement: {from: {x: 2, y: 2}, to: {x: 2, y: 3}}}];
    const otherBeats = presentCombatEntries(reloaded, [deathAndMovement]).filter(beat => ['death', 'move'].includes(beat.animation?.primitive ?? ''));
    expect(otherBeats).toHaveLength(2);
    for (const beat of otherBeats) {
      expect(beat.area).toBeUndefined();
      expect(beat.suppressAnimation).not.toBe(true);
    }
    // A legacy pinned artifact has the accepted point, but no new area snapshot.
    // A later recorded move still establishes where this cast originated.
    for (const entry of reloaded.log) for (const record of entry.records ?? []) delete record.area;
    reloaded.log.push({id: 'later-move', round: 1, actorId: 'source', text: 'Перемещение', records: [{kind: 'movement', ordinal: 0,
      sourceActorId: 'source', actorId: 'source', targetIds: ['source'], movement: {from: {x: 2, y: 2}, to: {x: 10, y: 8}}}]});
    const oldBytes = JSON.stringify(reloaded);
    expect(presentCombatEntries(reloaded, reloaded.log).find(beat => beat.rollKind === 'save')?.area).toEqual(declaration!.area);
    expect(JSON.stringify(reloaded)).toBe(oldBytes);
  });
});
