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
