import { describe, expect, it } from 'vitest';
import { readWeaponBondObjects, writeWeaponBondObjects, hydrateWeaponBondObjects, WEAPON_BONDS_KEY } from './weaponBondPersistence';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from '../roguelike/combatCatalog';
import type { ForgeCharacter } from './types';
import inputJson from '../roguelike/pinnedFighter.fixture.json';
const fixture = inputJson as unknown as { character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[] };
const weapon: WorldObjectState = { id: 'physical-weapon', name: 'Weapon', kind: 'item', size: 'small',
  itemCardId: 'card-weapon', weaponBondActorId: 'owner', ownerActorId: 'owner', unattended: true };
describe('durable weapon bond instances', () => {
  it('retains two distinct instances of the same card after JSON round trip', () => {
    const objects = { a: weapon, b: { ...weapon, id: 'second-physical-copy' } };
    const saved = writeWeaponBondObjects({ unrelated: true }, 'owner', objects);
    const read = readWeaponBondObjects(JSON.parse(JSON.stringify(saved)), 'owner');
    expect(read.map((object) => object.id)).toEqual(['physical-weapon','second-physical-copy']);
    expect(read.every((object) => object.itemCardId === 'card-weapon')).toBe(true);
    read[0].name = 'changed'; expect(weapon.name).toBe('Weapon');
    expect(saved.unrelated).toBe(true);
  });
  it('does not copy another actor bonds and clears a released bond', () => {
    const saved = writeWeaponBondObjects({}, 'owner', { a: weapon, other: { ...weapon, id: 'other', weaponBondActorId: 'other' } });
    expect(readWeaponBondObjects(saved, 'owner')).toHaveLength(1);
    const cleared = writeWeaponBondObjects(saved, 'owner', {});
    expect(readWeaponBondObjects(cleared, 'owner')).toEqual([]);
    expect(hydrateWeaponBondObjects({ a: weapon }, cleared, 'owner')).toEqual({});
  });
  it('preserves exact held or ground identity and rejects collisions', () => {
    const held = { ...weapon, heldByActorId: 'owner', carriedByActorId: 'owner', heldInHand: 'main_hand' as const, unattended: false };
    const saved = writeWeaponBondObjects({}, 'owner', { a: held });
    expect(hydrateWeaponBondObjects({}, saved, 'owner')[held.id]).toEqual(held);
    expect(() => hydrateWeaponBondObjects({ [weapon.id]: { ...weapon, weaponBondActorId: undefined } }, saved, 'owner')).toThrow(/collides/);
  });
  it('rejects wrong owner, duplicate IDs, excess bonds and invalid holders', () => {
    const envelope = (objects: unknown[]) => ({ [WEAPON_BONDS_KEY]: { schemaVersion: 1, objects } });
    expect(() => readWeaponBondObjects(envelope([weapon]), 'other')).toThrow();
    expect(() => readWeaponBondObjects(envelope([weapon,weapon]), 'owner')).toThrow();
    expect(() => readWeaponBondObjects(envelope([weapon,{...weapon,id:'b'},{...weapon,id:'c'}]), 'owner')).toThrow();
    expect(() => readWeaponBondObjects(envelope([{...weapon,heldByActorId:'owner'}]), 'owner')).toThrow();
  });
  it('rebuilds the exact ground instance when the content hash changes', async () => {
    const input = structuredClone(fixture);
    const object = { ...weapon, weaponBondActorId: input.character.id, ownerActorId: input.character.id,
      itemCardId: input.catalog.entities.card[0].id };
    input.character.turn_state = writeWeaponBondObjects({}, input.character.id, { [object.id]: object });
    const first = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(first.status).toBe('ready'); if (first.status !== 'ready') return;
    const previous = first.participant.canonical;
    input.catalog.entities.action[0].name += ' revised';
    const second = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(second.status).toBe('ready'); if (second.status !== 'ready') return;
    expect(second.contentManifestHash).not.toBe(first.contentManifestHash);
    expect(second.participant.canonical.world.objects[object.id]).toEqual(previous.world.objects[object.id]);
    expect(second.participant.canonical.world.actors[input.character.id].runtime.inventory)
      .toEqual(previous.world.actors[input.character.id].runtime.inventory);
  });
});
