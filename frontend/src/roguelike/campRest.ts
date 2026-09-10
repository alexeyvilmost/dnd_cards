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
}) {
  if (typeof input.long !== 'boolean' || input.character.current_hp < 1) throw new Error('Отдых недоступен');
  const rolls = input.hitDieRolls ?? [];
  if (!Array.isArray(rolls) || rolls.length > 20 || (input.long && rolls.length)) throw new Error('Некорректные кости хитов');
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, []);
  if (prepared.status !== 'ready') return prepared;
  const { canonical, restContext } = prepared.participant;
  if (!restContext) throw new Error('Нет контекста отдыха');
  const actor = canonical.world.actors[canonical.actorId];
  const result = input.long ? longRest(actor.runtime, restContext) : shortRest(actor.runtime, restContext);
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
  const turnState = clearSheetCombatSession(writeSoloCombatState(input.character.turn_state, null));
  return { status: 'ready' as const, contentManifestHash: prepared.contentManifestHash, events,
    patch: { current_hp: state.hp.current, resources: state.resources, max_resources: state.maxResources,
      active_effects: state.activeEffects, inventory_items: runtimeInventoryPayload(state), equipment: state.equipment,
      turn_state: writeRulesEngineRuntimeTurnState(turnState, state, { attunement_unlocked: true, death_saves: emptyDeathSaves() }),
      runtime_revision: revision },
  };
}
