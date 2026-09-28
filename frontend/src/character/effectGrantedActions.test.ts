import { describe, expect, it, vi } from 'vitest';
import type { Action, PassiveEffect } from '../types';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from '../engine/execute';
import { startTurn } from '../engine/turn';
import { activeEffectRequirementIssue } from '../engine/actionRequirements';
import { loadEffectGrantedActionClosure } from './effectGrantedActions';
import { createWorld, type RuleActionDefinition, type WorldState } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';

const character: CharacterContext = { level: 5, profBonus: 3, abilityMods: { str: 0, dex: 0, con: 0, int: 4, wis: 1, cha: 2 } };
const runtime = (): RuntimeState => ({ hp: { current: 10, max: 10, temp: 0 }, resources: { action: 1, bonus_action: 1 },
  maxResources: { action: 1, bonus_action: 1 }, equipment: {}, inventory: [], activeEffects: [] });
const declarations = [
  { ref: 'ACT-ember', effect: 'EFFECT-ember', cost: 'action', payload: { kind: 'temp_hp', amount: '3' } },
  { ref: 'ACT-wind', effect: 'EFFECT-wind', cost: 'bonus_action', payload: { kind: 'movement', value: 'additional', distance: 30 } },
];

describe('temporary library action closure', () => {
  it.each(declarations)('freezes $ref before casting, enforces its grant after reload and revokes it on expiry', async row => {
    const action = { id: `${row.ref}-uuid`, card_number: row.ref, name: row.ref,
      mechanics: { activation: { mode: 'active', cost: [{ resource: row.cost }] },
        effects: [{ resolution: 'auto', result: [row.payload] }] } } as unknown as Action;
    const effect = { id: `${row.effect}-uuid`, card_number: row.effect, name: row.effect,
      mechanics: { duration: { type: 'rounds', amount: 2 },
        effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: row.ref }] }] } } as unknown as PassiveEffect;
    const cast = { activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: row.effect }] }] };
    const input = { roots: [cast], grantedActions: [], characterLevel: 5,
      resolveAction: vi.fn(async () => action), resolveEffect: vi.fn(async () => effect) };
    const closure = await loadEffectGrantedActionClosure(input);
    expect(closure.grantedActions).toHaveLength(1);
    const mechanics = closure.grantedActions[0].action.mechanics!;
    const rng = vi.fn(() => 0.5);
    const ctx = { character, selfId: 'caster', rng };
    const initial = runtime();
    expect(() => executeAction(initial, mechanics, ctx)).toThrow('предоставляющий');
    expect(initial.resources[row.cost]).toBe(1);
    expect(rng).not.toHaveBeenCalled();
    const castResult = executeAction(initial, cast, { ...ctx, grantedEffects: { [row.effect]: effect } });
    let saved = JSON.parse(JSON.stringify(castResult.state)) as RuntimeState;
    expect(activeEffectRequirementIssue(mechanics, saved, character)).toBeNull();
    const afterReload = await loadEffectGrantedActionClosure({ ...input, activeEffects: saved.activeEffects });
    expect(afterReload.grantedActions).toEqual(closure.grantedActions);
    const used = executeAction(saved, mechanics, ctx);
    expect(used.state.resources[row.cost]).toBe(0);
    if (row.ref === 'ACT-ember') expect(used.state.hp.temp).toBe(3);
    else expect(used.events).toContainEqual(expect.objectContaining({ type: 'movement', distanceFt: 30 }));
    saved = startTurn(startTurn(saved).state).state;
    expect(() => executeAction(saved, mechanics, ctx)).toThrow('предоставляющий');
    expect(saved.resources[row.cost]).toBe(1);
    const revoked = { ...castResult.state, activeEffects: [] };
    expect(activeEffectRequirementIssue(mechanics, revoked)).toBeTruthy();
  });

  it('keeps permanent grants permanent and resolves transitive dependencies once, including cycles', async () => {
    const action = { id: 'action-id', card_number: 'ACT-shared', name: 'Shared', mechanics: {
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: 'EFFECT-loop' }] }],
    } } as unknown as Action;
    const effect = { id: 'effect-id', name: 'Loop', card_number: 'EFFECT-loop', mechanics: {
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: 'ACT-shared' },
        { kind: 'grant_effect', value: 'EFFECT-loop' }] }],
    } } as unknown as PassiveEffect;
    const resolver = vi.fn(async () => effect);
    const permanent = { action, group: 'class' as const, sourceLabel: 'Permanent' };
    const closure = await loadEffectGrantedActionClosure({ roots: [], grantedActions: [permanent], characterLevel: 1,
      resolveAction: async () => action, resolveEffect: resolver });
    expect(closure.grantedActions).toEqual([permanent]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a same-name effect or expired grant for authority', () => {
    const state = runtime();
    const mechanics = { requires_runtime_action_grant: ['ACT-right'] };
    state.activeEffects = [{ id: 'wrong', name: 'ACT-right', source: 'test', mechanics: {
      effects: [{ kind: 'grant_action', value: 'ACT-wrong' }],
    } }];
    expect(activeEffectRequirementIssue(mechanics, state)).toBeTruthy();
    state.activeEffects[0].mechanics = { kind: 'grant_action', value: 'ACT-right' };
    state.activeEffects[0].roundsLeft = 0;
    expect(activeEffectRequirementIssue(mechanics, state)).toBeTruthy();
  });

  it.each(declarations)('authoritative commands retain $ref across reload and reject it after a revoked grant', row => {
    const guarded: RuleActionDefinition = { id: row.ref, name: row.ref, kind: 'nonSpell', sourceEntityIds: [row.ref],
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 0, requiresLineOfSight: false, allowedRelations: ['self'] },
      mechanics: { requires_runtime_action_grant: [row.ref], activation: { mode: 'active', cost: [{ resource: row.cost }] },
        effects: [{ resolution: 'auto', result: [row.payload] }] } };
    const world = createWorld({ id: 'temporary-action-world', ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'temporary-action-test', contentHash: 'sha256:grant-test', errataVersion: '1',
    }, actors: [{ id: 'actor', name: 'Actor', kind: 'playerCharacter', controllerId: 'player',
      capabilities: { actionIds: [row.ref] }, character, runtime: runtime() }] });
    const rng = vi.fn(() => 0.5);
    const env = { rng, clock: () => 1, nextId: () => 'id' };
    const catalog = { getAction: (id: string) => id === row.ref ? guarded : undefined };
    const command = { schemaVersion: 1 as const, commandId: 'repeat-action', expectedRevision: 0,
      rulesetContentHash: world.ruleset.contentHash, actorId: 'actor', type: 'UseAction' as const,
      actionId: row.ref, targetIds: ['actor'], factsByTarget: { actor: {
        factsSource: 'scenario' as const, boardRevision: 1, distanceFt: 0, lineOfSight: true, cover: 'none' as const, relation: 'self' as const,
      } } };
    expect(handleCommand(world, command, catalog, env)).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(rng).not.toHaveBeenCalled();
    world.actors.actor.runtime.activeEffects = [{ id: 'grant', name: row.effect, source: 'cast', roundsLeft: 2,
      mechanics: { effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: row.ref }] }] } }];
    const restored = JSON.parse(JSON.stringify(world)) as WorldState;
    const used = handleCommand(restored, command, catalog, env);
    expect(used.status).toBe('accepted');
    if (used.status !== 'accepted') throw new Error(used.message);
    expect(used.nextState.actors.actor.runtime.resources[row.cost]).toBe(0);
    const repeated = handleCommand(used.nextState, command, catalog, env);
    expect(repeated.status).not.toBe('accepted');
    expect(used.nextState.actors.actor.runtime.resources[row.cost]).toBe(0);
    restored.actors.actor.runtime.activeEffects = [];
    expect(handleCommand(restored, { ...command, commandId: 'after-revoke' }, catalog, env))
      .toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
  });
});
