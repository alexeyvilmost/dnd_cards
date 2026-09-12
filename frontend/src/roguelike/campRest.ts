import { handleCommand } from '../rules-core/handler';
import { validateMasteryRestSelection } from './masteryRest';
import { characterToDraft } from '../character/forgeHelpers';
import { prepareWeaponBond } from '../rules-core/weaponBond';
import { foldWorldObjectEvents } from '../rules-core/worldObjects';
import type { ForgeCharacter } from '../character/types';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { clearSheetCombatSession } from '../character/sheetCombatSession';
import { emptyDeathSaves } from '../character/death';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { shortRest, longRest, spendHitDie } from '../engine/turn';
import { hitDieSides, hitDiceResourceKey } from '../engine/resources';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';
import { applySheetSlotRecoverySelections } from '../character/sheetRestDecisions';
import { preparedSpellSelectionIssues } from '../mechanics/collectChoices';
import { writeSheetSpellPreparation } from '../character/sheetSpellPreparation';
import { applySheetPreparedSpellSwap, preparedSpellSwapDeclaration, type PreparedSpellSwapSelection, type SheetPreparedSpellSwapPolicy } from '../character/sheetSpellPreparationRest';
import { synchronizeSheetCanonicalRuntime, writeSheetCanonicalWorld } from '../character/sheetCanonicalWorld';
import { advanceRoguelikeCampTime } from './campTime';

/** Recalculate camp rest with the same context and engine as the character sheet. */
export async function executeRoguelikeCampRest(input: {
  character: ForgeCharacter; catalog: FrozenCombatCatalog;
  long: boolean; hitDieRolls?: number[];
  elapsedSeconds?: number;
  slotRecoverySelections?: unknown;
  spellSwapSelections?: unknown;
  spellPreparation?: unknown;
  masteryChoices?: unknown;
  recallWeapon?: { objectId: string; hand: string; commandId: string };
  bindWeapon?: { cardId: string; instanceId: string; replaceObjectId?: string };
}) {
  if (typeof input.long !== 'boolean' || input.character.current_hp < 1) throw new Error('Отдых недоступен');
  const rolls = input.hitDieRolls ?? [];
  if (!Array.isArray(rolls) || rolls.length > 20 || (input.long && rolls.length)) throw new Error('Некорректные кости хитов');
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, []);
  if (prepared.status !== 'ready') return prepared;
  const { canonical, restContext } = prepared.participant;
  const baseElapsedSeconds = input.recallWeapon ? 0 : input.long ? 8 * 3600 : 3600;
  const elapsedSeconds = input.elapsedSeconds ?? baseElapsedSeconds;
  if (!Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < baseElapsedSeconds || elapsedSeconds > 24 * 3600
    || (!input.long && elapsedSeconds !== baseElapsedSeconds)) throw new Error('Некорректная длительность отдыха');
  const mastery = input.masteryChoices == null ? undefined : (() => {
    if (!input.long) throw new Error('Заменять искусность можно только на долгом отдыхе');
    return validateMasteryRestSelection(prepared.participant.buildChoices ?? [],
      characterToDraft(input.character).resolvedChoices, input.masteryChoices);
  })();
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
  const slotSelections = input.slotRecoverySelections == null ? {} : input.slotRecoverySelections;
  if (!slotSelections || typeof slotSelections !== 'object' || Array.isArray(slotSelections)) throw new Error('Некорректный выбор восстановления');
  const slotPolicies = canonical.actions.flatMap((action) => action.restDecision
    ? [{ actionId: action.id, name: action.name, policy: action.restDecision }] : []);
  const knownSlotDecisions = new Set(slotPolicies.map(({ policy }) => policy.decisionType));
  if (knownSlotDecisions.size !== slotPolicies.length) throw new Error('Неоднозначный выбор восстановления');
  if (Object.keys(slotSelections).some((key) => !knownSlotDecisions.has(key))) throw new Error('Недоступный выбор восстановления');
  if (input.long && Object.keys(slotSelections).length) throw new Error('Восстановление ячеек доступно только на коротком отдыхе');
  if (!input.long && !input.recallWeapon) {
    const recovery = applySheetSlotRecoverySelections({
      state, classLevels: restContext.classLevels, policies: slotPolicies,
      selections: slotSelections as Record<string, number[]>,
    });
    state = recovery.state; events.push(...recovery.events);
  }

  let turnState = input.character.turn_state;
  const preparation = input.spellPreparation == null ? {} : input.spellPreparation;
  if (!preparation || typeof preparation !== 'object' || Array.isArray(preparation)) throw new Error('Некорректная подготовка заклинаний');
  const preparedChoices = (prepared.participant.buildChoices ?? []).filter((choice) => choice.source === 'prepared_spell');
  const preparedChoiceIds = new Set(preparedChoices.map((choice) => choice.id));
  if (Object.keys(preparation).some((key) => !preparedChoiceIds.has(key))) throw new Error('Недоступный выбор подготовки заклинаний');
  if (!input.long && Object.keys(preparation).length) throw new Error('Подготовка заклинаний доступна только на долгом отдыхе');
  if (input.long && preparedChoices.length) {
    for (const choice of preparedChoices) {
      const selection = (preparation as Record<string, unknown>)[choice.id];
      if (!Array.isArray(selection) || selection.some((entry) => typeof entry !== 'string')) throw new Error('Выберите подготовленные заклинания');
      const issues = preparedSpellSelectionIssues(choice, selection as string[]);
      if (issues.length) throw new Error(`Подготовка заклинаний некорректна: ${issues.join('; ')}`);
    }
    turnState = writeSheetSpellPreparation(turnState, preparation as Record<string, string[]>);
  }

  const swapSelections = input.spellSwapSelections == null ? {} : input.spellSwapSelections;
  if (!swapSelections || typeof swapSelections !== 'object' || Array.isArray(swapSelections)) throw new Error('Некорректная замена заклинания');
  const swapDeclarations = (canonical.world.actors[canonical.actorId].passives ?? []).flatMap((mechanics, index) => {
    const declaration = preparedSpellSwapDeclaration(mechanics);
    return declaration ? [{ declaration, index }] : [];
  });
  const knownSwapDecisions = new Set(swapDeclarations.map(({ declaration }) => declaration.decisionType));
  if (knownSwapDecisions.size !== swapDeclarations.length) throw new Error('Неоднозначная замена заклинания');
  if (Object.keys(swapSelections).some((key) => !knownSwapDecisions.has(key))) throw new Error('Недоступная замена заклинания');
  if (input.long && Object.keys(swapSelections).length) throw new Error('Замена заклинания доступна только на коротком отдыхе');
  if (!input.long && !input.recallWeapon && swapDeclarations.length) {
    if (preparedChoices.length !== 1) throw new Error('Для замены нужен один список подготовленных заклинаний');
    const choice = preparedChoices[0];
    const current = (input.character.turn_state?.sheet_spell_preparation_v1 as {choices?: Record<string,string[]>} | undefined)?.choices?.[choice.id]
      ?? input.character.resolved_choices?.[choice.id] ?? [];
    const issues = preparedSpellSelectionIssues(choice, current);
    if (issues.length) throw new Error(`Текущая подготовка заклинаний некорректна: ${issues.join('; ')}`);
    for (const { declaration, index } of swapDeclarations) {
      const currentSet = new Set(current);
      const policy: SheetPreparedSpellSwapPolicy = {
        sourceEffectId: `canonical-passive:${index}`, sourceName: 'Подготовка заклинаний', declaration, preparedChoice: choice,
        current: current.map((reference) => ({ reference, name: reference, level: 1 })),
        replacements: (choice.allowedOptionIds ?? []).filter((reference) => !currentSet.has(reference)).map((reference) => ({ reference, name: reference, level: 1 })),
      };
      const applied = applySheetPreparedSpellSwap({ turnState, policy,
        selection: ((swapSelections as Record<string, unknown>)[declaration.decisionType] ?? {}) as PreparedSpellSwapSelection });
      turnState = applied.turnState;
      if (applied.changed) events.push({ type: 'narrative', text: 'Подготовленное заклинание заменено во время короткого отдыха.' });
    }
  }

  canonical.world = synchronizeSheetCanonicalRuntime(canonical.world, canonical.actorId, state);
  const otherActorIds = Object.keys(canonical.world.actors).filter((id) => id !== canonical.actorId);
  const agedWorld = advanceRoguelikeCampTime({ world: canonical.world, elapsedSeconds, actorIds: otherActorIds });
  canonical.world = agedWorld.world; events.push(...agedWorld.events);
  if (elapsedSeconds > baseElapsedSeconds) {
    const extra = advanceRoguelikeCampTime({ world: canonical.world,
      elapsedSeconds: elapsedSeconds - baseElapsedSeconds, actorIds: [canonical.actorId], ageObjects: false });
    canonical.world = extra.world; events.push(...extra.events);
    state = canonical.world.actors[canonical.actorId].runtime;
  }
  const revision = Number(input.character.runtime_revision) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Некорректная ревизия листа');
  turnState = writeSheetCanonicalWorld(clearSheetCombatSession(writeSoloCombatState(turnState, null)), canonical.actorId, canonical.world, canonical.resourceBindings);
  return { status: 'ready' as const, contentManifestHash: prepared.contentManifestHash, events,
    patch: { current_hp: state.hp.current, resources: state.resources, max_resources: state.maxResources,
      active_effects: state.activeEffects, inventory_items: runtimeInventoryPayload(state), equipment: state.equipment,
      turn_state: writeRulesEngineRuntimeTurnState(mastery ? { ...turnState,
        inPlayChoices: { ...(turnState?.inPlayChoices as Record<string, string[]> ?? {}), ...mastery },
      } : turnState, state, input.recallWeapon ? {} : { attunement_unlocked: true, death_saves: emptyDeathSaves() }),
      runtime_revision: revision },
  };
}
