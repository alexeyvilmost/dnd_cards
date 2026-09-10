import type { Card } from '../types';
import { cardPropertyList } from '../utils/cardProperties';
import type { RuntimeState } from '../mvp/contracts';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { worldObjectLedgerIssue } from '../rules-core/worldObjects';

export const WEAPON_BONDS_KEY = 'weapon_bonds_v1';

/** Durable item identity is independent of a cached combat ruleset hash. */
export function readWeaponBondObjects(turnState: Record<string, unknown> | null | undefined, actorId: string): WorldObjectState[] {
  const raw = turnState?.[WEAPON_BONDS_KEY];
  if (raw == null) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid weapon bond state');
  const envelope = raw as { schemaVersion?: unknown; objects?: unknown };
  if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.objects) || envelope.objects.length > 2) throw new Error('Invalid weapon bond ledger');
  const ids = new Set<string>();
  const objects = envelope.objects.map((value): WorldObjectState => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bonded weapon');
    const object = value as WorldObjectState;
    if (typeof object.id !== 'string' || !object.id.trim() || ids.has(object.id)
      || typeof object.name !== 'string' || !object.name.trim()
      || object.kind !== 'item' || typeof object.itemCardId !== 'string' || !object.itemCardId.trim()
      || object.weaponBondActorId !== actorId
      || !['tiny','small','medium','large','huge','gargantuan'].includes(object.size)) throw new Error('Invalid bonded weapon identity');
    ids.add(object.id);
    return structuredClone(object);
  });
  const issue = worldObjectLedgerIssue(Object.fromEntries(objects.map((object) => [object.id, object])));
  if (issue) throw new Error(issue);
  return objects;
}

export function writeWeaponBondObjects(
  turnState: Record<string, unknown> | null | undefined, actorId: string,
  objects: Readonly<Record<string, WorldObjectState>>,
): Record<string, unknown> {
  const selected = Object.values(objects).filter((object) => object.weaponBondActorId === actorId)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!selected.length && turnState?.[WEAPON_BONDS_KEY] == null) return { ...turnState };
  const next = { ...turnState, [WEAPON_BONDS_KEY]: { schemaVersion: 1, objects: selected.map((object) => structuredClone(object)) } };
  readWeaponBondObjects(next, actorId);
  return next;
}

export function hydrateWeaponBondObjects(
  objects: Readonly<Record<string, WorldObjectState>>, turnState: Record<string, unknown> | null | undefined, actorId: string,
): Record<string, WorldObjectState> {
  if (turnState?.[WEAPON_BONDS_KEY] == null) return { ...objects };
  const next = Object.fromEntries(Object.entries(objects).filter(([, object]) => object.weaponBondActorId !== actorId));
  for (const object of readWeaponBondObjects(turnState, actorId)) {
    if (next[object.id]) throw new Error('Bonded weapon identity collides with another world object');
    next[object.id] = object;
  }
  const issue = worldObjectLedgerIssue(next);
  if (issue) throw new Error(issue);
  return next;
}

/** Inventory placement owns hand assignment; moving gear in camp cannot duplicate a bonded instance. */
export function reconcileWeaponBondHands(
  objects: Readonly<Record<string, WorldObjectState>>, actorId: string, runtime: RuntimeState, cards: readonly Card[] = [],
): Record<string, WorldObjectState> {
  const next = { ...objects };
  const bonded = Object.values(objects).filter((object) => object.weaponBondActorId === actorId && object.carriedByActorId === actorId)
    .sort((left,right) => left.id.localeCompare(right.id));
  const occupied = new Set(Object.values(objects).filter((object) => object.heldByActorId === actorId && object.weaponBondActorId !== actorId).map((object) => object.heldInHand));
  for (const original of bonded) {
    const object = { ...original };
    const preferred = object.heldInHand;
    delete object.heldByActorId; delete object.heldInHand;
    const hands = preferred ? [preferred, ...(['main_hand','off_hand'] as const).filter((hand) => hand !== preferred)] : ['main_hand','off_hand'] as const;
    const card = cards.find((entry) => entry.id === object.itemCardId);
    const twoHanded = card?.slot === 'two_hands' || cardPropertyList(card?.properties).some((property) => property === 'two_handed' || property === 'two-handed');
    const hand = hands.find((slot) => !occupied.has(slot) && runtime.equipment[slot] === object.itemCardId
      && !(slot === 'off_hand' && twoHanded && runtime.equipment.main_hand === runtime.equipment.off_hand));
    if (hand) { object.heldByActorId = actorId; object.heldInHand = hand; occupied.add(hand); }
    next[object.id] = object;
  }
  return next;
}
