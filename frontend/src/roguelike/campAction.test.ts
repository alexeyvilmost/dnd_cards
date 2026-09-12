import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inputJson from './pinnedFighter.fixture.json';
import type { ForgeCharacter } from '../character/types';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';
import { executeRoguelikeCampAction } from './campAction';
import { castFindFamiliar } from '../rules-core/findFamiliar';
import { materializeCanonicalFamiliarActor } from '../rules-core/familiarRuntime';
import { writeSheetCanonicalWorld } from '../character/sheetCanonicalWorld';
const fixture = inputJson as unknown as { character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[] };
async function input() {
  const request = structuredClone(fixture);
  request.character.current_hp = 4;
  request.character.resources!['uses_ACT-second-wind'] = 1;
  const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
  if (prepared.status !== 'ready') throw new Error('Incomplete fixture');
  const action = prepared.participant.canonical.actions.find((entry) => entry.name === 'Второе дыхание');
  if (!action) throw new Error('Second Wind unavailable');
  return { ...request, commandId: 'camp-action-test', seed: 'private-test-seed', actionId: action.id };
}
describe('authoritative self actions in camp', () => {
  it('passes declared familiar appearance facts to the shared rules without inventing visibility or space', async () => {
    const request = await input();
    const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
    if (prepared.status !== 'ready') throw new Error('Not ready');
    const canonical = prepared.participant.canonical;
    const owner = canonical.world.actors[canonical.actorId];
    // A pre-existing companion isolates transport; actual spell casting and
    // preparation removal are covered by findFamiliarRuntime.integration.
    const familiar = castFindFamiliar({ familiarActorId: 'camp-owl', ownerActorId: owner.id,
      summoningActionId: request.actionId, policy: { kind: 'base', sourceEntityId: 'fixture:summoning' },
      method: 'ritual', formId: 'owl', spiritType: 'fey', existingFamiliar: null,
      resources: { level1SpellSlots: 1, incenseGp: 10 }, incenseOfferingGp: 10, materialCostGp: 10,
      baseCastingTimeSeconds: 3600, mechanicsPolicy: { connectionRangeFt: 100, reappearRangeFt: 30, ritualCastingAddedSeconds: 600 } }).familiar;
    canonical.world.actors[familiar.actorId] = materializeCanonicalFamiliarActor({ familiar, owner, summoningActionId: request.actionId });
    canonical.world.actors[familiar.actorId].familiarState!.presence = 'pocket_dimension';
    canonical.world.actors[familiar.actorId].lifecycle = { status: 'alive' };
    request.character.turn_state = writeSheetCanonicalWorld({}, owner.id, canonical.world, canonical.resourceBindings);
    const appearance = { ...request, actionId: undefined,
      companion: { type: 'ReappearFamiliar' as const, distanceFt: 5, lineOfSight: false, unoccupiedSpace: true } };
    const before = structuredClone(appearance);
    await expect(executeRoguelikeCampAction({ ...appearance, companion: { ...appearance.companion, unoccupiedSpace: false } }))
      .rejects.toThrow(/unoccupied/);
    const result = await executeRoguelikeCampAction(appearance);
    if (result.status !== 'ready') throw new Error('Not ready');
    expect(result.patch.resources.action).toBe(owner.runtime.resources.action - 1);
    expect(result.goldSpent).toBe(0);
    expect(appearance).toEqual(before);
  });

  it('executes Second Wind with deterministic dice and no client HP patch', async () => {
    const request = await input(); const before = structuredClone(request);
    const result = await executeRoguelikeCampAction(request);
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(result.patch.current_hp).toBeGreaterThan(4);
    expect(result.patch.current_hp).toBeLessThanOrEqual(16);
    expect(result.patch.resources['uses_ACT-second-wind']).toBe(0);
    expect(result.patch.resources.bonus_action).toBe(0);
    expect(await executeRoguelikeCampAction(request)).toEqual(result);
    expect(request).toEqual(before);
  });
  it('rejects unavailable actions and exhausted resources without modifying input', async () => {
    const request = await input(); request.character.resources!['uses_ACT-second-wind'] = 0;
    const before = structuredClone(request);
    await expect(executeRoguelikeCampAction(request)).rejects.toThrow();
    await expect(executeRoguelikeCampAction({ ...request, actionId: 'not-owned' })).rejects.toThrow(/нет выбранного/);
    expect(request).toEqual(before);
  });
  it('starts a new exploration turn without restoring class charges or healing', async () => {
    const request = await input();
    const used = await executeRoguelikeCampAction(request);
    if (used.status !== 'ready') throw new Error('Not ready');
    const next = { ...request, actionId: undefined, nextTurn: true,
      character: { ...request.character, ...used.patch }, commandId: 'camp-next-turn' };
    const result = await executeRoguelikeCampAction(next);
    if (result.status !== 'ready') throw new Error('Not ready');
    expect(result.patch.current_hp).toBe(used.patch.current_hp);
    expect(result.patch.resources.bonus_action).toBe(1);
    expect(result.patch.resources.action).toBe(1);
    expect(result.patch.resources.reaction).toBe(1);
    expect(result.patch.resources['uses_ACT-second-wind']).toBe(0);
    expect(result.patch.resources.hit_dice_d10).toBe(used.patch.resources.hit_dice_d10);
    expect(result.patch.turn_state.attunement_unlocked).toBe(false);
    await expect(executeRoguelikeCampAction({ ...next, actionId: request.actionId })).rejects.toThrow(/Новый ход/);
  });
  it('restores Telekinetic Movement by paying one psi die, without resting', async () => {
    const request = await input();
    const action = structuredClone(request.catalog.entities.action[0]);
    action.id = '23300000-0000-4000-8000-000000000002';
    action.card_number = 'ACT-psi-warrior-restore-movement';
    action.mechanics = JSON.parse(readFileSync(new URL('../../../backend/migrations/psi_warrior_movement_233.go', import.meta.url), 'utf8').match(/const psiWarriorMovementRestore233 = `([^`]+)`/)![1]);
    request.catalog.entities.action.push(action);
    request.character.action_ids = [action.id];
    request.character.resources = { ...request.character.resources, psi_warrior_energy_die: 2, psi_warrior_telekinetic_movement: 0 };
    request.character.max_resources = { ...request.character.max_resources, psi_warrior_energy_die: 4, psi_warrior_telekinetic_movement: 1 };
    const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
    if (prepared.status !== 'ready') throw new Error('Not ready');
    request.actionId = prepared.participant.canonical.actions.find((entry) => entry.sourceEntityIds.includes(action.id))!.id;
    const result = await executeRoguelikeCampAction(request);
    if (result.status !== 'ready') throw new Error('Not ready');
    expect(result.patch.resources.psi_warrior_energy_die).toBe(1);
    expect(result.patch.resources.psi_warrior_telekinetic_movement).toBe(1);
    expect(result.patch.current_hp).toBe(4);
    expect(result.patch.resources.action).toBe(request.character.resources.action);
    expect(result.patch.resources.bonus_action).toBe(request.character.resources.bonus_action);
  });
  it('projects a material debit once and removes the currency alias from persisted pools', async () => {
    const request = await input();
    request.character.currency = { gold: 18, silver: 2, copper: 3 };
    const action = structuredClone(request.catalog.entities.action[0]);
    action.id = '24200000-0000-4000-8000-000000000001'; action.card_number = 'test-material-action'; action.name = 'Material action';
    action.mechanics = { activation: { mode: 'active', cost: [{ resource: 'material_gold', amount: 10, recharge: 'never', binding: { kind: 'currency', currency: 'gold' } }] },
      targeting: { shape: 'self', min_targets: 0, max_targets: 1, allowed_relations: ['self'] },
      effects: [{ resolution: 'auto', result: [{kind: 'narrative', description: 'Material paid'}] }] };
    request.catalog.entities.action.push(action); request.character.action_ids = [action.id];
    const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
    if (prepared.status !== 'ready') throw new Error('Not ready');
    request.actionId = prepared.participant.canonical.actions.find((entry) => entry.sourceEntityIds.includes(action.id))!.id;
    const result = await executeRoguelikeCampAction(request);
    if (result.status !== 'ready') throw new Error('Not ready');
    expect(result.goldSpent).toBe(10);
    expect(result.patch.resources.material_gold).toBeUndefined();
    expect(result.patch.max_resources.material_gold).toBeUndefined();
    expect(request.character.currency).toEqual({gold:18,silver:2,copper:3});
    const removed = await executeRoguelikeCampAction({ ...request, actionId: undefined, nextTurn: true,
      commandId: 'after-removing-material-action', character: { ...request.character, ...result.patch,
        action_ids: [], currency: { gold: 8, silver: 2, copper: 3 } } });
    if (removed.status !== 'ready') throw new Error('Not ready after removal');
    expect(removed.goldSpent).toBe(0);
    expect(removed.patch.resources.material_gold).toBeUndefined();
    expect(removed.patch.max_resources.material_gold).toBeUndefined();
    await expect(executeRoguelikeCampAction({ ...request, character: { ...request.character, ...result.patch, currency: {gold:8,silver:2,copper:3} } })).rejects.toThrow();
  });
  it('ages existing actor and world durations before a long camp cast resolves', async () => {
    const request = await input();
    const initial = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
    if (initial.status !== 'ready') throw new Error('Not ready');
    const owned = initial.participant.canonical.actions.find((entry) => entry.id === request.actionId)!;
    const action = request.catalog.entities.action.find((entry) => owned.sourceEntityIds.includes(entry.id))!;
    action.mechanics = structuredClone(action.mechanics ?? {});
    action.mechanics.activation = { ...(action.mechanics?.activation as Record<string, unknown>), cast_time: { unit: 'hour', amount: 1 } };
    request.character.active_effects = [{ id: 'old-effect', name: 'Old effect', source: 'test', mechanics: {}, roundsLeft: 700 }];
    const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, request.basicActionIds);
    if (prepared.status !== 'ready') throw new Error('Not ready');
    const canonical = prepared.participant.canonical;
    canonical.world.objects.clock = { id: 'clock', name: 'Old light', kind: 'item', size: 'tiny',
      illumination: { id: 'old-light', sourceActorId: canonical.actorId, sourceActionId: request.actionId,
        brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 700 } };
    request.character.turn_state = writeSheetCanonicalWorld(request.character.turn_state, canonical.actorId, canonical.world, canonical.resourceBindings);
    request.actionId = canonical.actions.find((entry) => entry.sourceEntityIds.includes(action.id))!.id;
    const result = await executeRoguelikeCampAction(request);
    if (result.status !== 'ready') throw new Error('Not ready');
    expect(result.elapsedSeconds).toBe(3600);
    expect(result.patch.active_effects).toEqual([expect.objectContaining({ id: 'old-effect', roundsLeft: 100 })]);
    const envelope = result.patch.turn_state.canonical_rules_world_v1 as { world: typeof canonical.world };
    expect(envelope.world.objects.clock).toMatchObject({ illumination: { roundsLeft: 100 } });
  });
  it('resolves missing content before any execution', async () => {
    const request = await input(); request.catalog.entities.class = [];
    expect((await executeRoguelikeCampAction(request)).status).toBe('needs_content');
  });
});
