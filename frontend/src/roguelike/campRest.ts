import { handleCommand } from '../rules-core/handler';
import { prepareWeaponBond } from '../rules-core/weaponBond';
import { foldWorldObjectEvents } from '../rules-core/worldObjects';
import { writeWeaponBondObjects } from '../character/weaponBondPersistence';
import type { ForgeCharacter } from '../character/types';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { clearSheetCombatSession } from '../character/sheetCombatSession';
import { emptyDeathSaves } from '../character/death';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { shortRest, longRest, spendHitDie } from '../engine/turn';
import { hitDieSides, hitDiceResourceKey } from '../engine/resources';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';

/** Recalculate camp rest with the same context and engine as the character sheet. */
export async function executeRoguelikeCampRest(input: {
  character: ForgeCharacter; catalog: FrozenCombatCatalog;
  long: boolean; hitDieRolls?: number[];
  recallWeapon?: { objectId: string; hand: string; commandId: string };
  bindWeapon?: { cardId: string; instanceId: string; replaceObjectId?: string };
}) {
  if (typeof input.long !== 'boolean' || input.character.current_hp < 1) throw new Error('Отдых недоступен');
  const rolls = input.hitDieRolls ?? [];
  if (!Array.isArray(rolls) || rolls.length > 20 || (input.long && rolls.length)) throw new Error('Некорректные кости хитов');
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, []);
  if (prepared.status !== 'ready') return prepared;
  const { canonical, restContext } = prepared.participant;
  if (!restContext) throw new Error('Нет контекста отдыха');
  const actor = canonical.world.actors[canonical.actorId];
  if (input.bindWeapon) {
    if (input.long) throw new Error('Ритуал связи выполняется в течение короткого отдыха');
    canonical.world.objects = foldWorldObjectEvents(canonical.world.objects, prepareWeaponBond(
      canonical.world, canonical.actorId, input.bindWeapon.cardId, input.bindWeapon.instanceId, input.bindWeapon.replaceObjectId,
    ));
  }
  let result;
  if (input.recallWeapon) {
    if (input.long || input.bindWeapon || rolls.length) throw new Error('Призыв нельзя совмещать с отдыхом');
    const action = canonical.actions.find((entry) => (entry.mechanics.activation as Record<string, unknown> | undefined)?.weapon_bond_recall === true);
    if (!action) throw new Error('Призыв связанного оружия недоступен');
    const recalled = handleCommand(canonical.world, {
      schemaVersion: 1, type: 'UseAction', commandId: input.recallWeapon.commandId,
      expectedRevision: canonical.world.revision, rulesetContentHash: canonical.world.ruleset.contentHash,
      actorId: canonical.actorId, actionId: action.id, targetIds: [canonical.actorId],
      factsByTarget: { [canonical.actorId]: { relation: 'self', distanceFt: 0, lineOfSight: true, cover: 'none', factsSource: 'scenario', boardRevision: canonical.world.revision } },
      choices: { weapon_bond_object: [input.recallWeapon.objectId], weapon_bond_hand: [input.recallWeapon.hand] },
    }, canonical.catalog, { rng: () => { throw new Error('Призыв не требует броска'); }, clock: () => 0, nextId: () => input.recallWeapon!.commandId });
    if (recalled.status !== 'accepted') throw new Error(recalled.message);
    canonical.world = recalled.nextState;
    result = { state: recalled.nextState.actors[canonical.actorId].runtime, events: [], pendingReactions: [] };
  } else result = input.long ? longRest(actor.runtime, restContext) : shortRest(actor.runtime, restContext);
  if (result.pendingReactions?.length) throw new Error('Отдых требует разрешения реакции');
  let state = result.state;
  const events = [...result.events];
  const sides = hitDieSides(restContext.hitDie);
  const key = hitDiceResourceKey(restContext.hitDie);
  for (const roll of rolls) {
    if (!sides || !key || !Number.isInteger(roll) || roll < 1 || roll > sides
      || (state.resources[key] ?? 0) < 1 || state.hp.current >= state.hp.max) throw new Error('Недопустимый расход кости хитов');
    const spent = spendHitDie(state, restContext, roll);
    state = spent.state; events.push(...spent.events);
  }
  const revision = Number(input.character.runtime_revision) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Некорректная ревизия листа');
  const turnState = writeWeaponBondObjects(clearSheetCombatSession(writeSoloCombatState(input.character.turn_state, null)), canonical.actorId, canonical.world.objects);
  return { status: 'ready' as const, contentManifestHash: prepared.contentManifestHash, events,
    patch: { current_hp: state.hp.current, resources: state.resources, max_resources: state.maxResources,
      active_effects: state.activeEffects, inventory_items: runtimeInventoryPayload(state), equipment: state.equipment,
      turn_state: writeRulesEngineRuntimeTurnState(turnState, state, input.recallWeapon ? {} : { attunement_unlocked: true, death_saves: emptyDeathSaves() }),
      runtime_revision: revision },
  };
}
