import { cardPropertyList } from '../utils/cardProperties';
import type { WorldState, UncommittedRuleEvent } from './domain';
import type { WorldObjectMutationEvent, WorldObjectState } from './worldObjects';
import { activeConditionsOf } from './legacy/engineAdapter';

export function hasWeaponBondPolicy(passives: readonly Record<string, unknown>[] = []): boolean {
  return passives.some((passive) => {
    const policy = passive.weapon_bond as Record<string, unknown> | undefined;
    return policy?.maximum === 2 && policy.ritual_minutes === 60;
  });
}

export function weaponBondProtectsHand(world: WorldState, actorId: string, hand: string): boolean {
  const actor = world.actors[actorId];
  return Boolean(actor && !activeConditionsOf(actor.runtime).has('incapacitated')
    && Object.values(world.objects).some((object) => object.weaponBondActorId === actorId
      && object.heldByActorId === actorId && object.heldInHand === hand
      && object.itemCardId === actor.runtime.equipment[hand]));
}

/** The caller commits these events only with the hour-long ritual/rest. */
export function prepareWeaponBond(world: WorldState, actorId: string, cardId: string, instanceId: string, replaceObjectId?: string): WorldObjectMutationEvent[] {
  const actor = world.actors[actorId];
  if (!actor || !hasWeaponBondPolicy(actor.passives) || activeConditionsOf(actor.runtime).has('incapacitated')) throw new Error('Связь с оружием недоступна');
  const card = actor.character.knownCards?.find((entry) => entry.id === cardId);
  if (!card || card.type !== 'weapon') throw new Error('Выберите принадлежащее оружие');
  const twoHanded = card.slot === 'two_hands' || cardPropertyList(card.properties).some((property) => property === 'two_handed' || property === 'two-handed');
  const heldQuantity = Number(actor.runtime.equipment.main_hand === cardId) + Number(actor.runtime.equipment.off_hand === cardId && !(twoHanded && actor.runtime.equipment.main_hand === cardId));
  const quantity = heldQuantity + actor.runtime.inventory.filter((row) => row.cardId === cardId && row.containerId == null).reduce((sum,row) => sum + row.qty,0);
  const carried = Object.values(world.objects).filter((object) => object.itemCardId === cardId && object.carriedByActorId === actorId);
  const existing = carried.find((object) => !object.weaponBondActorId);
  if (!quantity || (!existing && quantity <= carried.length)) throw new Error('Нет свободного экземпляра этого оружия');
  if (existing?.attunedToActorId && existing.attunedToActorId !== actorId) throw new Error('Оружие настроено на другое существо');
  const bonds = Object.values(world.objects).filter((object) => object.weaponBondActorId === actorId);
  const replaced = replaceObjectId ? bonds.find((object) => object.id === replaceObjectId) : undefined;
  if (replaceObjectId && !replaced) throw new Error('Нельзя разорвать чужую связь');
  if (bonds.length >= 2 && !replaced) throw new Error('Выберите одну из двух связей для замены');
  const events: WorldObjectMutationEvent[] = replaced
    ? [{ type: 'WorldObjectPatched', objectId: replaced.id, patch: {}, unset: ['weaponBondActorId'], reason: 'weapon_bond_replaced' }] : [];
  if (existing) {
    events.push({ type: 'WorldObjectPatched', objectId: existing.id, patch: { weaponBondActorId: actorId }, reason: 'weapon_bond_created' });
    return events;
  }
  if (!instanceId.trim() || world.objects[instanceId]) throw new Error('Идентификатор оружия уже занят');
  const hand = (['main_hand','off_hand'] as const).find((slot) => actor.runtime.equipment[slot] === cardId
    && !Object.values(world.objects).some((object) => object.heldByActorId === actorId && object.heldInHand === slot));
  const object: WorldObjectState = { id: instanceId, name: card.name, kind: 'item', size: 'small',
    itemCardId: cardId, ownerActorId: actorId, weaponBondActorId: actorId, planeId: actor.planeId ?? 'material', carriedByActorId: actorId, unattended: false,
    ...(hand ? { heldByActorId: actorId, heldInHand: hand } : {}),
  };
  events.push({ type: 'WorldObjectCreated', object });
  return events;
}


type RecallChoices = Record<string, string | string[]> | undefined;
function selected(choices: RecallChoices, key: string): string | undefined {
  const value = choices?.[key];
  return Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value;
}
export function weaponBondRecallIssue(world: WorldState, actorId: string, choices: RecallChoices): string | null {
  const actor = world.actors[actorId];
  const object = world.objects[selected(choices,'weapon_bond_object') ?? ''];
  const hand = selected(choices,'weapon_bond_hand');
  if (!actor || !hasWeaponBondPolicy(actor.passives) || activeConditionsOf(actor.runtime).has('incapacitated')) return 'Призыв связанного оружия недоступен';
  if (!object || object.weaponBondActorId !== actorId || !object.itemCardId) return 'Выберите своё связанное оружие';
  if ((object.planeId ?? 'material') !== (actor.planeId ?? 'material')) return 'Оружие находится на другом плане существования';
  if (hand !== 'main_hand' && hand !== 'off_hand') return 'Выберите свободную руку';
  if (actor.runtime.equipment[hand] || Object.values(world.objects).some((entry) => entry.heldByActorId === actorId && entry.heldInHand === hand)) return 'Выбранная рука занята';
  if (!actor.character.knownCards?.some((card) => card.id === object.itemCardId && card.type === 'weapon')) return 'В снимке отсутствует механика связанного оружия';
  if (object.carriedByActorId) {
    const carrier = world.actors[object.carriedByActorId];
    if (!carrier || (object.heldInHand ? carrier.runtime.equipment[object.heldInHand] !== object.itemCardId : !carrier.runtime.inventory.some((row) => row.cardId === object.itemCardId && row.qty > 0))) return 'Не удалось подтвердить положение связанного оружия';
  }
  return null;
}

export function weaponBondRecallEvents(world: WorldState, actorId: string, choices: RecallChoices): Array<Omit<UncommittedRuleEvent,'ordinal'>> {
  const issue = weaponBondRecallIssue(world,actorId,choices); if (issue) throw new Error(issue);
  const object = world.objects[selected(choices,'weapon_bond_object')!];
  const actor = world.actors[actorId];
  const hand = selected(choices,'weapon_bond_hand') as 'main_hand' | 'off_hand';
  const events: Array<Omit<UncommittedRuleEvent,'ordinal'>> = [];
  const envelope = { sourceActorId: actorId, obligationIds: ['class:fighter:weapon-bond'] };
  let inventory = actor.runtime.inventory.map((row) => ({ ...row }));
  let equipment = { ...actor.runtime.equipment };
  if (object.carriedByActorId) {
    const carrier = world.actors[object.carriedByActorId];
    let removed = false;
    const remaining = carrier.runtime.inventory.flatMap((row) => {
      if (!object.heldInHand && !removed && row.cardId === object.itemCardId && row.qty > 0) { removed = true; return row.qty > 1 ? [{ ...row, qty: row.qty - 1 }] : []; }
      return [{ ...row }];
    });
    const carrierEquipment = { ...carrier.runtime.equipment };
    if (object.heldInHand) {
      carrierEquipment[object.heldInHand] = null;
      const card = actor.character.knownCards?.find((entry) => entry.id === object.itemCardId);
      if (card?.slot === 'two_hands' || cardPropertyList(card?.properties).some((property) => property === 'two_handed' || property === 'two-handed')) {
        if (carrierEquipment.main_hand === object.itemCardId) carrierEquipment.main_hand = null;
        if (carrierEquipment.off_hand === object.itemCardId) carrierEquipment.off_hand = null;
      }
    }
    if (carrier.id === actorId) { inventory = remaining; equipment = carrierEquipment; }
    else events.push({ ...envelope, payload: { type: 'ActorRuntimePatched', actorId: carrier.id, reason: 'action', patch: { inventory: remaining, equipment: carrierEquipment } } });
  }
  equipment[hand] = object.itemCardId!;
  events.push({ ...envelope, payload: { type: 'ActorRuntimePatched', actorId, reason: 'action', patch: { inventory, equipment } } });
  events.push({ ...envelope, payload: { type: 'WorldObjectMutationRecorded', event: { type: 'WorldObjectPatched', objectId: object.id,
    patch: { carriedByActorId: actorId, heldByActorId: actorId, heldInHand: hand, unattended: false, secured: false }, reason: 'weapon_bond_recalled' } } });
  return events;
}
