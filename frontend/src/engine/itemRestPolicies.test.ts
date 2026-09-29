import { describe, expect, it, vi } from 'vitest';
import { FIGHTER_CTX_EQUIPPED, equippedFighterState } from '../mvp/fixtures';
import { longRest, shortRest } from './turn';
import { createWorld, type ActorState, type TakeLongRestCommand } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { foldEvents } from '../rules-core/reducer';
import { readPendingRestCommit, writePendingRestCommit } from '../character/pendingRestCommit';
import { prepareSheetRestCommit } from '../character/sheetRestCommit';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';

const id = '11111111-1111-4111-8111-111111111111';
const commandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'rest-tests', contentHash: `sha256:${'a'.repeat(64)}`, errataVersion: '2024' };
const policy = (die: number, equals: number[]) => ({ id: `rest-${die}`, name: `Rest ${die}`,
  effects: [{ resolution: 'auto', result: [{ kind: 'rest_policy', rests: ['short','long'], failure_chance: { die, equals } }] }] });
function state() {
  const initial = equippedFighterState(); initial.hp = { current: 4, max: 30, temp: 2 };
  initial.resources.charges = 0; initial.maxResources.charges = 6;
  initial.activeEffects = [{ id: 'short-effect', name: 'Short effect', source: 'test', mechanics: {}, roundsLeft: 5 }];
  return initial;
}
function setup(die: number, equals: number[], rng: () => number) {
  const context = { ...FIGHTER_CTX_EQUIPPED, passives: [policy(die, equals)], rng,
    resourceRecovery: { charges: { short_rest: { mode: 'none' as const }, long_rest: { mode: 'dice' as const, dice: '1d6' } } } };
  const actor: ActorState = { id, name: 'Resting actor', kind: 'playerCharacter', controllerId: id, ac: 12,
    character: JSON.parse(JSON.stringify(context)), runtime: state(), passives: context.passives, capabilities: { actionIds: [] } };
  return { context, actor, world: createWorld({ id: 'rest-world', ruleset, actors: [actor] }) };
}

describe('confirmed rest policies and random resource recovery', () => {
  it.each([[2,[1]],[6,[1,2,3]]])('keeps preview/cancel/reopen free of RNG for d%s policy', (die, failures) => {
    const rng = vi.fn(() => 0); const { context, actor } = setup(die as number, failures as number[], rng);
    for (let reopen = 0; reopen < 3; reopen++) {
      shortRest(actor.runtime, context, { preview: true });
      expect(longRest(actor.runtime, context, { preview: true }).state.resources.charges).toBe(0);
    }
    expect(rng).not.toHaveBeenCalled();
    const denied = longRest(actor.runtime, context);
    expect(rng).toHaveBeenCalledTimes(1);
    expect(denied.restBenefitsDenied).toBe(true);
    expect(denied.state.hp).toEqual(actor.runtime.hp);
    expect(denied.state.resources).toEqual(actor.runtime.resources);
    expect(denied.state.activeEffects).toEqual([]);
    expect(denied.events.filter(event => event.type === 'roll')).toHaveLength(1);
  });

  it.each([[2,[1]],[6,[1,2,3]]])('draws chance and recharge once and preserves the exact command through reload for d%s', (die, failures) => {
    const rng = vi.fn().mockReturnValueOnce(0.9).mockReturnValueOnce(0.5);
    const { context, actor, world } = setup(die as number, failures as number[], rng);
    const confirmed = longRest(actor.runtime, context);
    expect(confirmed.state.resources.charges).toBe(4);
    expect(confirmed.state.hp.current).toBe(30);
    expect(rng).toHaveBeenCalledTimes(2);
    const participant = { character: { id, name: 'Resting actor', access_mode: 'owner', system_id: 'dnd5e-2024', runtime_revision: 4, turn_state: {} },
      canonical: { actorId: id, world, resourceBindings: {} } } as unknown as SheetCombatParticipantSeed;
    const prepared = prepareSheetRestCommit({ commandId, participant, result: confirmed });
    const values = new Map<string,string>(); const store = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    writePendingRestCommit(id, { kind: 'sheet', restType: 'long_rest', granted: true, prepared }, store);
    const reloaded = readPendingRestCommit(id, store);
    expect(reloaded?.kind).toBe('sheet');
    if (reloaded?.kind !== 'sheet') throw Error('Missing persisted request');
    expect(reloaded.prepared.request).toEqual(prepared.request);
    expect(reloaded.prepared.request.events.filter(event => event.type === 'roll')).toHaveLength(2);
    expect(rng).toHaveBeenCalledTimes(2);
  });

  it('records the canonical denial once and rejects command replay without another draw', () => {
    const rng = vi.fn(() => 0); const { world } = setup(2, [1], rng);
    const command: TakeLongRestCommand = { schemaVersion: 1, type: 'TakeLongRest', actorId: id, commandId,
      expectedRevision: 0, rulesetContentHash: ruleset.contentHash, durationHours: 8 };
    const environment = { rng, nextId: () => 'event', clock: () => 1 };
    const result = handleCommand(world, command, { getAction: () => undefined }, environment);
    expect(result.status, JSON.stringify(result)).toBe('accepted');
    if (result.status !== 'accepted') throw Error('Rejected rest');
    expect(foldEvents(world, result.events)).toEqual(result.nextState);
    expect(result.nextState.actors[id].runtime.hp.current).toBe(4);
    expect(handleCommand(JSON.parse(JSON.stringify(result.nextState)), command, { getAction: () => undefined }, environment).status).toBe('rejected');
    expect(rng).toHaveBeenCalledTimes(1);
  });
});
