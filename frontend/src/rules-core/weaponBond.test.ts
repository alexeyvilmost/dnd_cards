import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState } from './domain';
import { foldWorldObjectEvents } from './worldObjects';
import { prepareWeaponBond, weaponBondProtectsHand } from './weaponBond';
import type { Card } from '../types';
function world() {
  const card = { id: 'sword', name: 'Sword', type: 'weapon' } as Card;
  const actor = { id: 'owner', name: 'Owner', ac: 12, passives: [{ weapon_bond: { maximum: 2, ritual_minutes: 60 } }],
    character: { knownCards: [card] }, runtime: { hp: { current: 10, max: 10, temp: 0 },
      resources: {}, maxResources: {}, inventory: [{ cardId: 'sword', qty: 3 }], equipment: { main_hand: 'sword' }, activeEffects: [] } } as unknown as ActorState;
  return createWorld({ id: 'bond-test', ruleset: { systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: 'test' }, actors: [actor] });
}
describe('Fighter physical weapon bonds', () => {
  it('binds an equipped physical weapon and another identical copy without changing quantity', () => {
    const state = world();
    state.objects = foldWorldObjectEvents(state.objects, prepareWeaponBond(state,'owner','sword','first'));
    state.objects = foldWorldObjectEvents(state.objects, prepareWeaponBond(state,'owner','sword','second'));
    expect(state.objects.first.heldInHand).toBe('main_hand');
    expect(state.objects.second.heldInHand).toBeUndefined();
    expect(state.actors.owner.runtime.inventory[0].qty).toBe(3);
    expect(() => prepareWeaponBond(state,'owner','sword','third')).toThrow(/двух/);
    state.objects = foldWorldObjectEvents(state.objects, prepareWeaponBond(state,'owner','sword','third','first'));
    expect(state.objects.first.weaponBondActorId).toBeUndefined();
    expect(state.objects.third.weaponBondActorId).toBe('owner');
    expect(Object.keys(state.objects)).toHaveLength(3);
  });
  it('reuses a real existing unbound held instance and rejects foreign attunement', () => {
    const state = world();
    state.objects.existing = { id:'existing',name:'Sword',kind:'item',size:'small',itemCardId:'sword',
      carriedByActorId:'owner',heldByActorId:'owner',heldInHand:'main_hand',attunedToActorId:'someone-else' };
    expect(() => prepareWeaponBond(state,'owner','sword','new')).toThrow(/настроено/);
    delete state.objects.existing.attunedToActorId;
    state.objects = foldWorldObjectEvents(state.objects, prepareWeaponBond(state,'owner','sword','new'));
    expect(Object.keys(state.objects)).toEqual(['existing']);
  });
  it('requires a granted policy, a weapon, an accessible copy and an owned replacement', () => {
    const state = world();
    expect(() => prepareWeaponBond(state,'owner','missing','new')).toThrow();
    expect(() => prepareWeaponBond(state,'owner','sword','new','foreign')).toThrow();
    state.actors.owner.runtime.inventory = []; state.actors.owner.runtime.equipment = {};
    expect(() => prepareWeaponBond(state,'owner','sword','new')).toThrow();
    state.actors.owner.passives = [];
    expect(() => prepareWeaponBond(state,'owner','sword','new')).toThrow(/недоступна/);
  });
  it('protects the bonded hand, except when incapacitated', () => {
    const state = world();
    state.objects = foldWorldObjectEvents(state.objects, prepareWeaponBond(state,'owner','sword','first'));
    expect(weaponBondProtectsHand(state,'owner','main_hand')).toBe(true);
    expect(weaponBondProtectsHand(state,'owner','off_hand')).toBe(false);
    state.actors.owner.runtime.activeEffects.push({ id:'stunned',name:'Stunned',source:'test',mechanics:{kind:'condition',value:'stunned'} });
    expect(weaponBondProtectsHand(state,'owner','main_hand')).toBe(false);
  });
});
