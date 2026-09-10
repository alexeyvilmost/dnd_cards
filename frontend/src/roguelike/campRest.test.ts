import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inputJson from './pinnedFighter.fixture.json';
import type { ForgeCharacter } from '../character/types';
import type { FrozenCombatCatalog } from './combatCatalog';
import { executeRoguelikeCampRest } from './campRest';
const fixture = inputJson as unknown as { character: ForgeCharacter; catalog: FrozenCombatCatalog };
function input(long = false) {
  const value = structuredClone(fixture);
  value.character.current_hp = 4;
  value.character.resources!['uses_RE-dwarf-4'] = 0;
  value.character.turn_state = { preserved: { instance: 'physical-object' }, solo_combat_v1: { old: true } };
  return { ...value, long };
}
describe('authoritative camp rest', () => {
  it('recovers one Second Wind and Action Surge, without long-rest dwarf recovery', async () => {
    const request = input();
    const before = structuredClone(request);
    const result = await executeRoguelikeCampRest(request);
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(result.patch.current_hp).toBe(4);
    expect(result.patch.resources['uses_ACT-second-wind']).toBe(1);
    expect(result.patch.resources['uses_ACT-action-surge']).toBe(1);
    expect(result.patch.resources['uses_RE-dwarf-4']).toBe(0);
    expect(result.patch.resources.hit_dice_d10).toBe(2);
    expect(result.patch.turn_state.preserved).toEqual({ instance: 'physical-object' });
    expect(result.patch.turn_state.solo_combat_v1).toBeUndefined();
    expect(request).toEqual(before);
  });
  it('spends exact hit dice using the character Constitution modifier', async () => {
    const result = await executeRoguelikeCampRest({ ...input(), hitDieRolls: [5,6] });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(result.patch.current_hp).toBe(19);
    expect(result.patch.resources.hit_dice_d10).toBe(0);
  });
  it('fully recovers on long rest', async () => {
    const result = await executeRoguelikeCampRest(input(true));
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(result.patch.current_hp).toBe(22);
    expect(result.patch.resources['uses_ACT-second-wind']).toBe(2);
    expect(result.patch.resources['uses_RE-dwarf-4']).toBe(2);
  });
  it.each([[0],[11],[1.5],[1,1,1]])('rejects invalid or excessive hit dice %j', async (...rolls) => {
    await expect(executeRoguelikeCampRest({ ...input(), hitDieRolls: rolls })).rejects.toThrow();
  });
  it('rejects rest at zero HP and unnecessary dice at full HP', async () => {
    const zero = input(); zero.character.current_hp = 0;
    await expect(executeRoguelikeCampRest(zero)).rejects.toThrow();
    const full = input(); full.character.current_hp = 22;
    await expect(executeRoguelikeCampRest({ ...full, hitDieRolls: [5] })).rejects.toThrow();
    await expect(executeRoguelikeCampRest({ ...input(true), hitDieRolls: [5] })).rejects.toThrow();
  });
  it('reports missing content before applying anything', async () => {
    const request = input(); request.catalog.entities.class = [];
    expect((await executeRoguelikeCampRest(request)).status).toBe('needs_content');
  });
});


describe('authoritative Weapon Bond camp actions', () => {
  function bondedInput() {
    const request = input();
    const effect = structuredClone(request.catalog.entities.effect[0]);
    effect.id = '23800000-0000-4000-8000-000000000001'; effect.card_number = 'test-weapon-bond';
    effect.mechanics = { weapon_bond: { maximum: 2, ritual_minutes: 60 } };
    request.catalog.entities.effect.push(effect);
    request.character.effect_ids = [effect.id];
    const action = structuredClone(request.catalog.entities.action[0]);
    action.id = '23800000-0000-4000-8000-000000000002'; action.card_number = 'test-weapon-recall';
    action.mechanics = JSON.parse(readFileSync(new URL('../../../backend/migrations/warrior_weapon_bond_238.go', import.meta.url), 'utf8').match(/UPDATE actions SET mechanics='([^']+)'::jsonb/)![1]);
    request.catalog.entities.action.push(action); request.character.action_ids = [action.id];
    return request;
  }
  it('binds an owned weapon during rest, then recalls from inventory without resting or duplicating', async () => {
    const request = bondedInput();
    const card = request.catalog.entities.card.find((row) => row.type === 'weapon')!;
    request.character.equipment = {};
    request.character.inventory_items = [{ card_id: card.id, qty: 1 }];
    const bound = await executeRoguelikeCampRest({ ...request, bindWeapon: { cardId: card.id, instanceId: 'bonded' } });
    expect(bound.status).toBe('ready'); if (bound.status !== 'ready') return;
    request.character = { ...request.character, ...bound.patch };
    request.character.resources!['uses_ACT-second-wind'] = 0;
    const recalled = await executeRoguelikeCampRest({ ...request, recallWeapon: { objectId: 'bonded', hand: 'main_hand', commandId: 'recall-test' } });
    expect(recalled.status).toBe('ready'); if (recalled.status !== 'ready') return;
    expect(recalled.patch.equipment.main_hand).toBe(card.id);
    expect(recalled.patch.resources['uses_ACT-second-wind']).toBe(0);
    expect(recalled.patch.current_hp).toBe(4);
    expect(recalled.patch.inventory_items.filter((row) => row.card_id === card.id)).toHaveLength(0);
    expect(recalled.patch.turn_state.weapon_bonds_v1).toMatchObject({ objects: [{ id: 'bonded', heldInHand: 'main_hand' }] });
  });
});
