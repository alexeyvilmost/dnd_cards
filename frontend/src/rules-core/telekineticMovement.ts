import type {ActorState, SpatialFacts, UncommittedRuleEvent, WorldState} from './domain';
import type {Card} from '../types';
import type {WorldObjectState} from './worldObjects';

/** Only concrete loose objects qualify; ownership alone is not physical possession. */
export function isLooseTelekineticObject(object: WorldObjectState | undefined): object is WorldObjectState {
  return Boolean(object && object.kind !== 'spell_effect' && object.unattended === true
    && object.secured !== true && !object.heldByActorId && !object.carriedByActorId
    && ['tiny', 'small', 'medium', 'large'].includes(object.size));
}


/** Existing hand slots become physical instances lazily, without inventing a new card. */
export function telekineticHeldObjects(world: WorldState, actorId: string): WorldObjectState[] {
  const actor = world.actors[actorId]; if (!actor) return [];
  const held = Object.values(world.objects).filter(object => object.size === 'tiny' && object.heldByActorId === actorId);
  for (const hand of ['main_hand', 'off_hand'] as const) {
    if (Object.values(world.objects).some(object => object.heldByActorId === actorId && object.heldInHand === hand)) continue;
    const cardId = actor.runtime.equipment[hand];
    const card = cardId ? findPhysicalCard(world, cardId) : undefined;
    if (!card || card.mechanics?.object_size !== 'tiny') continue;
    let id = `telekinetic-held:${actorId}:${hand}:${card.id}:${world.revision}`;
    while (world.objects[id]) id += ':next';
    held.push({id, name: card.name, kind: 'item', size: 'tiny',
      itemCardId: card.id, heldByActorId: actorId, heldInHand: hand, carriedByActorId: actorId, ownerActorId: actorId, unattended: false});
  }
  return held;
}

export function telekineticObjectIssue(world: WorldState, actorId: string, facts: SpatialFacts): string | null {
  const object = world.objects[facts.telekineticObjectId ?? ''] ?? (facts.telekineticHandMode === 'from_hand' ? telekineticHeldObjects(world, actorId).find(row => row.id === facts.telekineticObjectId) : undefined);
  const actor = world.actors[actorId];
  const hand = facts.telekineticHand;
  if (!facts.telekineticHandMode) return isLooseTelekineticObject(object) ? null : 'Выберите свободный предмет';
  if (!object || object.size !== 'tiny' || !actor || (hand !== 'main_hand' && hand !== 'off_hand')) return 'Для переноса в руку нужен Крошечный предмет и выбранная рука';
  if (facts.telekineticHandMode === 'to_hand') {
    if (!isLooseTelekineticObject(object)) return 'Предмет должен быть свободен';
    if (actor.runtime.equipment[hand] || Object.values(world.objects).some(row => row.heldByActorId === actorId && row.heldInHand === hand)) return 'Выбранная рука занята';
    if (!object.itemCardId || !findPhysicalCard(world, object.itemCardId)) return 'В снимке боя отсутствует описание предмета';
    return null;
  }
  if (facts.telekineticHandMode !== 'from_hand' || object.heldByActorId !== actorId || object.heldInHand !== hand
    || object.carriedByActorId !== actorId || !object.itemCardId || actor.runtime.equipment[hand] !== object.itemCardId) return 'Предмет отсутствует в выбранной руке';
  return null;
}

function findPhysicalCard(world: WorldState, cardId: string): Card | undefined {
  return Object.values(world.actors).flatMap(actor => [...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])]).find(card => card.id === cardId);
}

/** Physical hand transfer is committed with the paid action and replayed as ordinary events. */
export function telekineticHandEvents(world: WorldState, actor: ActorState, facts: SpatialFacts): Omit<UncommittedRuleEvent, 'ordinal'>[] {
  if (!facts.telekineticHandMode) return [];
  const issue = telekineticObjectIssue(world, actor.id, facts); if (issue) throw new Error(issue);
  const object = world.objects[facts.telekineticObjectId!] ?? telekineticHeldObjects(world, actor.id).find(row => row.id === facts.telekineticObjectId)!;
  const hand = facts.telekineticHand!;
  const envelope = {sourceActorId: actor.id, obligationIds: ['system:telekinetic-hand-transfer']};
  if (facts.telekineticHandMode === 'to_hand') {
    const card = findPhysicalCard(world, object.itemCardId!)!;
    return [
      {...envelope, payload: {type: 'ActorItemContentRecorded', actorId: actor.id, card}},
      {...envelope, payload: {type: 'ActorRuntimePatched', actorId: actor.id, reason: 'action', patch: {equipment: {...actor.runtime.equipment, [hand]: card.id}}}},
      {...envelope, payload: {type: 'WorldObjectMutationRecorded', event: {type: 'WorldObjectPatched', objectId: object.id,
        patch: {kind: 'item', itemCardId: card.id, heldByActorId: actor.id, carriedByActorId: actor.id, heldInHand: hand, unattended: false}, reason: 'telekinetic_to_hand'}}},
    ];
  }
  return [
    ...(world.objects[object.id] ? [] : [{...envelope, payload: {type: 'WorldObjectMutationRecorded' as const, event: {type: 'WorldObjectCreated' as const, object}}}]),
    {...envelope, payload: {type: 'ActorRuntimePatched', actorId: actor.id, reason: 'action', patch: {equipment: {...actor.runtime.equipment, [hand]: null}}}},
    {...envelope, payload: {type: 'WorldObjectMutationRecorded', event: {type: 'WorldObjectPatched', objectId: object.id, patch: {unattended: true, secured: false}, unset: ['heldByActorId', 'heldInHand', 'carriedByActorId'], reason: 'telekinetic_from_hand'}}},
  ];
}
