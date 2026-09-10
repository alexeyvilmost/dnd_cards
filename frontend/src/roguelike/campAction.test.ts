import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inputJson from './pinnedFighter.fixture.json';
import type { ForgeCharacter } from '../character/types';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';
import { executeRoguelikeCampAction } from './campAction';
const fixture = inputJson as unknown as { character: ForgeCharacter; catalog: FrozenCombatCatalog };
async function input() {
  const request = structuredClone(fixture);
  request.character.current_hp = 4;
  request.character.resources!['uses_ACT-second-wind'] = 1;
  const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, []);
  if (prepared.status !== 'ready') throw new Error('Incomplete fixture');
  const action = prepared.participant.canonical.actions.find((entry) => entry.name === 'Второе дыхание');
  if (!action) throw new Error('Second Wind unavailable');
  return { ...request, commandId: 'camp-action-test', seed: 'private-test-seed', actionId: action.id };
}
describe('authoritative self actions in camp', () => {
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
    const prepared = await prepareRoguelikeCombatParticipant(request.character, request.catalog, []);
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
  it('resolves missing content before any execution', async () => {
    const request = await input(); request.catalog.entities.class = [];
    expect((await executeRoguelikeCampAction(request)).status).toBe('needs_content');
  });
});
