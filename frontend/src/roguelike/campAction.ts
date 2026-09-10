import type { ForgeCharacter } from '../character/types';
import type { GameCommand } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { writeSheetCanonicalWorld, projectSheetCanonicalPersistence } from '../character/sheetCanonicalWorld';
import { clearSheetCombatSession } from '../character/sheetCombatSession';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';
import { createRoguelikeCombatRandom } from './combatWorker';

type UseAction = Extract<GameCommand, { type: 'UseAction' }>;
export interface RoguelikeCampActionInput {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds?: string[];
  commandId: string; seed: string; actionId?: string; itemCardId?: string; nextTurn?: boolean;
  companion?: { type: 'DismissFamiliar'; mode: 'temporary' | 'forever' } | { type: 'ReappearFamiliar'; distanceFt: number; lineOfSight: boolean; unoccupiedSpace: boolean };
  choices?: UseAction['choices']; spell?: UseAction['spell']; worldInput?: UseAction['worldInput'];
}

/** Execute an owned camp action from its immutable declaration, never from a client patch. */
export async function executeRoguelikeCampAction(input: RoguelikeCampActionInput) {
  if (input.character.current_hp < 1) throw new Error('Действие недоступно при 0 хитов');
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds ?? []);
  if (prepared.status !== 'ready') return prepared;
  const canonical = prepared.participant.canonical;
  const action = canonical.actions.find((entry) => entry.id === input.actionId || (input.itemCardId
    && entry.sourceEntityIds.includes(input.itemCardId)
    && ((entry.mechanics.activation as Record<string, unknown> | undefined)?.cost as Record<string, unknown>[] | undefined)?.some((cost) => cost.bound_self_item === true)));
  if (!action && !input.nextTurn && !input.companion) throw new Error('У персонажа нет выбранного действия');
  const activation = action?.mechanics.activation as Record<string, unknown> | undefined;
  if (activation?.mode === 'reaction' || activation?.mode === 'triggered' || activation?.trigger || activation?.mode === 'passive') throw new Error('Способность требует соответствующего события');
  const targetIds = !action || action.targeting?.maxTargets === 0 ? [] : [canonical.actorId];
  if (targetIds.length && !action?.targeting?.allowedRelations.includes('self')) throw new Error('Для действия нужна цель на поле боя');
  const random = createRoguelikeCombatRandom(input.seed, 0);
  const environment = { rng: random.rng, clock: () => 0, nextId: () => input.commandId };
  const common = { schemaVersion: 1 as const, commandId: input.commandId, actorId: canonical.actorId, expectedRevision: canonical.world.revision, rulesetContentHash: canonical.world.ruleset.contentHash };
  let result;
  if (input.companion) {
    if (input.actionId || input.itemCardId || input.spell || input.worldInput || input.choices || input.nextTurn) throw new Error('Команда фамильяра не может содержать другое действие');
    const familiars = Object.values(canonical.world.actors).filter((actor) => actor.familiarState?.ownerActorId === canonical.actorId);
    if (familiars.length !== 1) throw new Error('У персонажа нет единственного фамильяра');
    const familiarActorId = familiars[0].id;
    if (input.companion.type === 'DismissFamiliar' && ['temporary','forever'].includes(input.companion.mode)) {
      result = handleCommand(canonical.world, { ...common, type:'DismissFamiliar', familiarActorId, mode:input.companion.mode }, canonical.catalog, environment);
    } else if (input.companion.type === 'ReappearFamiliar' && Number.isFinite(input.companion.distanceFt) && input.companion.distanceFt >= 0) {
      result = handleCommand(canonical.world, { ...common, type:'ReappearFamiliar', familiarActorId,
        facts:{factsSource:'scenario',boardRevision:canonical.world.revision,distanceFt:input.companion.distanceFt,
          lineOfSight:input.companion.lineOfSight,unoccupiedSpace:input.companion.unoccupiedSpace} }, canonical.catalog, environment);
    } else throw new Error('Неизвестная команда фамильяра');
  } else if (input.nextTurn) {
    if (input.actionId || input.itemCardId || input.spell || input.worldInput || input.choices) throw new Error('Новый ход не может содержать действие');
    const ended = handleCommand(canonical.world, { ...common, type: 'EndTurn', commandId: input.commandId + ':end' }, canonical.catalog, environment);
    if (ended.status !== 'accepted') throw new Error(ended.message);
    result = handleCommand(ended.nextState, { ...common, expectedRevision: ended.nextState.revision, type: 'StartTurn', commandId: input.commandId + ':start' }, canonical.catalog, environment);
    if (result.status === 'accepted') result = { ...result, events: [...ended.events, ...result.events] };
  } else result = handleCommand(canonical.world, {
    schemaVersion: 1, type: 'UseAction', commandId: input.commandId,
    actorId: canonical.actorId, expectedRevision: canonical.world.revision,
    rulesetContentHash: canonical.world.ruleset.contentHash, actionId: action!.id, targetIds,
    factsByTarget: targetIds.length ? { [canonical.actorId]: {
      relation: 'self', distanceFt: 0, lineOfSight: true, cover: 'none', willing: true,
      factsSource: 'scenario', boardRevision: canonical.world.revision,
    } } : {},
    ...(input.choices ? { choices: input.choices } : {}),
    ...(input.spell ? { spell: input.spell } : {}),
    ...(input.worldInput ? { worldInput: input.worldInput } : {}),
  }, canonical.catalog, environment);
  if (result.status !== 'accepted') throw new Error(result.message);
  if (result.nextState.pendingResolution) throw new Error('Действие требует незавершённого решения');
  const actor = result.nextState.actors[canonical.actorId];
  const projected = projectSheetCanonicalPersistence({ runtime: actor.runtime,
    currency: input.character.currency, resourceBindings: canonical.resourceBindings });
  // The worker declares a validated material debit; the API owns its atomic run payment.
  const beforeCurrency = input.character.currency ?? {};
  const afterCurrency = projected.currency ?? beforeCurrency;
  const goldSpent = (beforeCurrency.gold ?? 0) - (afterCurrency.gold ?? 0);
  if (!Number.isSafeInteger(goldSpent) || goldSpent < 0
    || Object.keys({ ...beforeCurrency, ...afterCurrency }).some((key) => key !== 'gold' && (beforeCurrency[key] ?? 0) !== (afterCurrency[key] ?? 0))) {
    throw new Error('Недопустимое изменение кошелька забега');
  }
  const runtime = projected.runtime;
  const revision = Number(input.character.runtime_revision) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Некорректная ревизия листа');
  const turnState = writeSheetCanonicalWorld(clearSheetCombatSession(writeSoloCombatState(input.character.turn_state, null)),
    canonical.actorId, result.nextState, canonical.resourceBindings);
  const declared = result.events.find((event) => event.payload.type === 'ActionDeclared' && event.payload.actorId === canonical.actorId);
  const spellTiming = declared?.payload.type === 'ActionDeclared' ? declared.payload.spell : undefined;
  // Turn-sized actions share the current six-second turn; longer casts advance
  // by their rules-owned duration including the ritual addition.
  const castSeconds = (spellTiming?.baseCastingTimeSeconds ?? 0) + (spellTiming?.castingTimeAddedSeconds ?? 0);
  const elapsedSeconds = input.nextTurn ? 6 : castSeconds > 6 ? castSeconds : 0;
  const events = result.events.flatMap((event) => event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []);
  return { status: 'ready' as const, contentManifestHash: prepared.contentManifestHash, events, goldSpent, elapsedSeconds,
    patch: { current_hp: runtime.hp.current, resources: runtime.resources, max_resources: runtime.maxResources,
      active_effects: runtime.activeEffects, equipment: runtime.equipment, inventory_items: runtimeInventoryPayload(runtime),
      turn_state: writeRulesEngineRuntimeTurnState(turnState, runtime), runtime_revision: revision },
  };
}
