import { describe, expect, it } from 'vitest';
import manifest from '../../../backend/migrations/data/catalog-audit-20260929/spells.json';
import { validateMechanics } from './validateMechanics';
import { executeAction, applyIncomingDamage } from './execute';
import { collectModifiers } from './modifiers';
import { rollDeathSaveDie } from './deathSaves';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { playerActionIdsFor } from '../solo-combat/types';
import { createWorld, type RuleActionDefinition } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { startTurn } from './turn';
import { dropConcentration, startConcentration } from './concentration';
import { loadEffectGrantedActionClosure } from '../character/effectGrantedActions';
import type { Action, PassiveEffect } from '../types';

type Dict = Record<string, unknown>;
const rows = manifest.entities as unknown as Array<{ entity_type: string; id: string; card_number: string; name: string; preimage: Dict | null; patch: Dict; review: { status: string } }>;
const mechanics = (ref: string): Dict => {
  const row = rows.find(row => row.card_number === ref)!;
  return (row.patch.mechanics ?? row.preimage?.mechanics) as Dict;
};
const character: CharacterContext = { level: 9, profBonus: 4, spellcastingMod: 5, abilityMods: { str: 0, dex: 0, con: 0, int: 5, wis: 0, cha: 0 } };
const state = (): RuntimeState => ({ hp: { current: 1000, max: 1000, temp: 0 }, resources: { action: 1, bonus_action: 1, reaction: 1, ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`spell_slot_${index + 1}`, 3])) }, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });
const effect = (ref: string) => { const row = rows.find(row => row.card_number === ref)!; return { id: row.id, card_number: ref, name: row.name, mechanics: mechanics(ref) }; };

describe('reviewed spell catalog', () => {
  it('includes each active snapshot spell exactly once without full verification claims', () => {
    const spells = rows.filter(row => row.entity_type === 'spell');
    expect(spells).toHaveLength(394);
    expect(new Set(spells.map(row => row.id)).size).toBe(394);
    expect(rows.filter(row => ['verified', 'partial_narrative_verified'].includes(row.review.status))).toEqual([]);
    for (const row of rows.filter(row => row.preimage === null)) {
      if (row.entity_type === 'action') {
        expect(['base_action', 'class_feature', 'item_property', 'species_ability']).toContain(row.patch.action_type);
        expect(['action', 'bonus_action', 'reaction', 'free_action']).toContain(row.patch.resource);
      }
      if (row.entity_type === 'effect') expect(row.patch.effect_type).toBe('spell_effect');
    }
  });

  it('validates every retained and changed declaration through the canonical schema', () => {
    const errors: string[] = [];
    for (const row of rows) {
      const mechanics = (row.patch.mechanics ?? row.preimage?.mechanics) as Dict | undefined;
      if (!mechanics) continue;
      const validation = validateMechanics(mechanics, { id: row.card_number, name: row.name, kind: 'spell' });
      if (!validation.valid) errors.push(`${row.card_number}: ${validation.errors.join('; ')}`);
    }
    expect(errors).toEqual([]);
  });

  it('freezes all five selectable breath capabilities before the choice exists', async () => {
    const closure = await loadEffectGrantedActionClosure({ roots: [mechanics('SPELL-0197')], grantedActions: [], characterLevel: 9,
      resolveAction: async ref => rows.find(row => row.card_number === ref)!.patch as unknown as Action,
      resolveEffect: async ref => rows.find(row => row.card_number === ref)!.patch as unknown as PassiveEffect,
    });
    expect(closure.effects.size).toBe(5);
    expect(closure.grantedActions.map(row => row.action.card_number).sort()).toEqual(['acid', 'cold', 'fire', 'lightning', 'poison'].map(type => `ACT-spell-audit-dragon-breath-${type}`).sort());
    for (const row of closure.grantedActions) expect(() => executeAction(state(), row.action.mechanics!, { character, rng: () => { throw Error('Inactive RNG'); } })).toThrow('предоставляющий');
  });

  it.each(['vitriolic_sphere', 'ice_storm', 'cone_of_cold', 'flame_strike', 'circle_of_death', 'chain_lightning', 'fire_storm', 'incendiary_cloud', 'meteor_swarm'])('uses exactly half of the same damage dice after a successful save: %s', ref => {
    const declaration = mechanics(ref);
    const row = rows.find(row => row.card_number === ref)!;
    const level = Number(row.preimage!.level);
    const ctx = { character, selfId: 'caster', rng: () => 0.5, spell: { baseLevel: level, castLevel: level }, target: { id: 'target', runtimeState: state(), saveMods: { dex: 0, con: 0, wis: 0 }, ac: 12 } };
    const fail = executeAction(state(), declaration, { ...ctx, forceSaveOutcome: 'fail' });
    const success = executeAction(state(), declaration, { ...ctx, forceSaveOutcome: 'success' });
    const failedDamage = fail.events.filter(event => event.type === 'damage').map(event => event.amount);
    const successfulDamage = success.events.filter(event => event.type === 'damage').map(event => event.amount);
    expect(failedDamage.length).toBeGreaterThan(0);
    expect(successfulDamage).toEqual(failedDamage.map(amount => Math.floor(amount / 2)));
    expect(success.targetState?.hp.current).toBe(1000 - successfulDamage.reduce((sum, amount) => sum + amount, 0));
    expect(success.state.resources.action).toBe(0);
  });

  it('persists the two distinct defenses without granting resistance to other damage', () => {
    const applied = executeAction(state(), mechanics('mind_blank'), { character, selfId: 'caster', rng: () => 0.5, spell: { baseLevel: 8 }, target: { id: 'recipient', runtimeState: state() } }).targetState!;
    const restored = JSON.parse(JSON.stringify(applied)) as RuntimeState;
    expect(applyIncomingDamage(restored, 20, { character, rng: () => 0.5 }, { damageType: 'psychic' }).state.hp.current).toBe(1000);
    expect(applyIncomingDamage(restored, 20, { character, rng: () => 0.5 }, { damageType: 'fire' }).state.hp.current).toBe(980);
    const charm = { effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'condition', value: 'charmed', op: 'apply', duration: { type: 'rounds', amount: 1 } }] }] };
    expect(executeAction(state(), charm, { character, rng: () => 0.5, target: { id: 'recipient', runtimeState: restored } }).targetState?.activeEffects.some(effect => effect.mechanics.kind === 'condition')).not.toBe(true);
    expect(restored.activeEffects.every(effect => effect.roundsLeft === 14400)).toBe(true);
  });

  it('beacon targets wisdom and death saves, and maximizes recipient healing dice', () => {
    const recipient = { ...state(), hp: { current: 1, max: 1000, temp: 0 } };
    const applied = executeAction(state(), mechanics('beacon_of_hope'), { character, rng: () => 0.1, spell: { baseLevel: 3 }, target: { id: 'recipient', runtimeState: recipient } }).targetState!;
    expect(collectModifiers(applied, [], { roll: 'saving_throw', filter: { ability: 'wis' } }).hasAdvantage).toBe(true);
    expect(collectModifiers(applied, [], { roll: 'saving_throw', filter: { ability: 'dex' } }).hasAdvantage).toBe(false);
    expect(rollDeathSaveDie(applied, [], {}, () => 0.1).advantage).toBe('advantage');
    const heal = { effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'healing', amount: '2d8 + 3' }] }] };
    expect(executeAction(state(), heal, { character, rng: () => 0.1, target: { id: 'recipient', runtimeState: applied } }).targetState?.hp.current).toBe(20);
  });

  it.each(['fire', 'cold'])('a foreign recipient uses the frozen %s breath after reload, and loses it with its grant', type => {
    const ref = `ACT-spell-audit-dragon-breath-${type}`, effectRef = `EFFECT-spell-audit-dragon-breath-${type}`;
    const definition: RuleActionDefinition = { id: ref, name: ref, kind: 'nonSpell', sourceEntityIds: [ref], targeting: { minTargets: 1, maxTargets: 64, rangeFt: 15, requiresLineOfSight: true, allowedRelations: ['enemy'] }, mechanics: { ...mechanics(ref), requires_runtime_action_grant: [ref] } };
    const cast = mechanics('SPELL-0197');
    const recipient = executeAction(state(), cast, { character, selfId: 'caster', rng: () => 0.5, spell: { baseLevel: 2, castLevel: 4 }, choices: { dragon_breath_type: type }, grantedEffects: { [effectRef]: effect(effectRef) }, target: { id: 'recipient', runtimeState: state() } }).targetState!;
    const recipientCharacter = { ...character, level: 1, profBonus: 2, spellcastingMod: 0 };
    const world = createWorld({ id: 'foreign-breath', ruleset: { systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'sha256:breath-test', errataVersion: '1' }, actors: [
      { id: 'recipient', name: 'Recipient', kind: 'playerCharacter', controllerId: 'player', capabilities: { actionIds: [] }, character: recipientCharacter, runtime: JSON.parse(JSON.stringify(recipient)) },
      { id: 'target', name: 'Target', kind: 'playerCharacter', controllerId: 'player', capabilities: { actionIds: [] }, character: recipientCharacter, runtime: state(),
        passives: [{ effects: [{ resolution: 'auto', result: [{ kind: 'modifier', op: 'advantage', applies_to: { roll: 'saving_throw', filter: { saveSource: 'spell' } } }] }] }] },
    ] });
    expect(playerActionIdsFor({ characterId: 'recipient', playerActionIds: [], world, catalogActions: [definition] }, 'recipient')).toEqual([ref]);
    const command = { schemaVersion: 1 as const, commandId: 'breath', expectedRevision: 0, rulesetContentHash: world.ruleset.contentHash, actorId: 'recipient', type: 'UseAction' as const, actionId: ref, targetIds: ['target'], factsByTarget: { target: { factsSource: 'scenario' as const, boardRevision: 1, distanceFt: 10, lineOfSight: true, cover: 'none' as const, relation: 'enemy' as const } } };
    const outcome = handleCommand(world, command, { getAction: id => id === ref ? definition : undefined }, { rng: () => 0.1, clock: () => 1, nextId: () => 'breath-id' });
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error(outcome.message);
    const pending = outcome.nextState.pendingResolution;
    if (!pending || pending.type !== 'target_save') throw Error('Expected deferred breath save');
    expect(pending.request.dc).toBe(17);
    expect(pending.spell?.castLevel).toBe(4);
    const restored = JSON.parse(JSON.stringify(outcome.nextState));
    const resolved = handleCommand(restored, { ...command, type: 'ResolveDecision', commandId: 'breath-save', expectedRevision: restored.revision,
      actorId: 'target', resolutionId: pending.id, requestId: pending.request.id, response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }, { sides: 20, value: 1 }] } } },
    { getAction: () => definition }, { rng: () => 0.1, clock: () => 1, nextId: () => 'resolved-id' });
    expect(resolved.status).toBe('accepted');
    if (resolved.status !== 'accepted') throw Error(resolved.message);
    expect(resolved.events.some(event => event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'roll' && event.payload.event.roll.advantage === 'advantage')).toBe(true);
    expect(resolved.nextState.actors.target.runtime.hp.current).toBe(995); // five d6 rolled 1
    expect(outcome.nextState.actors.recipient.runtime.resources.action).toBe(0);
    expect(handleCommand(outcome.nextState, command, { getAction: () => definition }, { rng: () => { throw Error('replayed RNG'); }, clock: () => 1, nextId: () => 'id' }).status).not.toBe('accepted');
    world.actors.recipient.runtime.activeEffects = [];
    expect(playerActionIdsFor({ characterId: 'recipient', playerActionIds: [], world, catalogActions: [definition] }, 'recipient')).toEqual([]);
    expect(handleCommand(world, { ...command, commandId: 'revoked' }, { getAction: () => definition }, { rng: () => { throw Error('revoked RNG'); }, clock: () => 1, nextId: () => 'id' })).toMatchObject({ status: 'rejected', code: 'ActionNotGranted' });
  });

  it.each([
    { spell: 'SPELL-0297', key: 'produce-flame', baseLevel: 0, castLevel: 0, expected: 10 },
    { spell: 'SPELL-0184', key: 'flame-blade', baseLevel: 2, castLevel: 4, expected: 25 },
  ])('$spell creates a timed capability without attacking, and freezes later attack scaling', row => {
    const effectRef = `EFFECT-spell-audit-${row.key}`, actionRef = `ACT-spell-audit-${row.key}`;
    const cast = executeAction(state(), mechanics(row.spell), { character, selfId: 'caster', rng: () => { throw Error('Casting must not roll an attack'); }, spell: { baseLevel: row.baseLevel, castLevel: row.castLevel }, grantedEffects: { [effectRef]: effect(effectRef) } });
    expect(cast.events.some(event => event.type === 'damage')).toBe(false);
    expect(cast.state.activeEffects[0].roundsLeft).toBe(100);
    const saved = JSON.parse(JSON.stringify(cast.state));
    const ctx = { character: { ...character, level: 17, spellcastingMod: 0 }, selfId: 'caster', rng: () => 0.5, target: { id: 'target', runtimeState: state(), ac: 10 } };
    const used = executeAction(saved, mechanics(actionRef), ctx);
    expect(used.targetState?.hp.current).toBe(1000 - row.expected);
    expect(used.state.resources.action).toBe(0);
    expect(used.state.activeEffects[0].roundsLeft).toBe(100);
    let expired = saved;
    for (let turn = 0; turn < 100; turn++) expired = startTurn(expired).state;
    expect(() => executeAction(expired, mechanics(actionRef), ctx)).toThrow('предоставляющий');
    if (row.baseLevel > 0) {
      const concentration = startConcentration(saved, 'Flame', saved.activeEffects.map((effect: { id: string }) => effect.id)).state;
      expect(() => executeAction(dropConcentration(concentration, 'test').state, mechanics(actionRef), ctx)).toThrow('предоставляющий');
    }
  });

  it('witch bolt grants its later damage on a miss, binds the original target and never spends another slot', () => {
    const effectRef = 'EFFECT-spell-audit-witch-bolt', actionRef = 'ACT-spell-audit-witch-bolt';
    const target = { id: 'original', runtimeState: state(), ac: 30 };
    const cast = executeAction(state(), mechanics('SPELL-0167'), { character, selfId: 'caster', rng: () => 0, spell: { baseLevel: 1, castLevel: 3 }, grantedEffects: { [effectRef]: effect(effectRef) }, target });
    expect(cast.events.some(event => event.type === 'damage')).toBe(false);
    expect(cast.state.activeEffects).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(cast.state));
    const repeat = executeAction(saved, mechanics(actionRef), { character, selfId: 'caster', rng: () => 0.5, target });
    expect(repeat.targetState?.hp.current).toBe(993);
    expect(repeat.state.resources.spell_slot_3).toBe(saved.resources.spell_slot_3);
    expect(repeat.state.resources.bonus_action).toBe(0);
    expect(() => executeAction(saved, mechanics(actionRef), { character, rng: () => { throw Error('Wrong target RNG'); }, target: { ...target, id: 'other' } })).toThrow('первоначальной');
  });
});
