import type { ForgeCharacter } from '../character/types';
import type { GameCommand } from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { writeSheetCanonicalWorld, projectSheetCanonicalPersistence } from '../character/sheetCanonicalWorld';
import { clearSheetCombatSession, mergeSheetCombatParticipantWorlds } from '../character/sheetCombatSession';
import {projectSheetCompanionParticipantWorld} from '../character/sheetCompanionInteraction';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { prepareRoguelikeCombatParticipant, type FrozenCombatCatalog } from './combatCatalog';
import { createRoguelikeCombatRandom } from './combatWorker';
import { advanceRoguelikeCampTime } from './campTime';
import { parseActivationCastTime } from '../rules-core/activationCastTime';

type UseAction = Extract<GameCommand, { type: 'UseAction' }>;
export interface RoguelikeCampActionInput {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds?: string[];
  characters?: ForgeCharacter[]; targetIds?: string[];
  commandId: string; seed: string; actionId?: string; itemCardId?: string; nextTurn?: boolean;
  companion?: { type: 'DismissFamiliar'; mode: 'temporary' | 'forever' } | { type: 'ReappearFamiliar'; distanceFt: number; lineOfSight: boolean; unoccupiedSpace: boolean };
  choices?: UseAction['choices']; spell?: UseAction['spell']; worldInput?: UseAction['worldInput'];
}

/** Execute an owned camp action from its immutable declaration, never from a client patch. */
export async function executeRoguelikeCampAction(input: RoguelikeCampActionInput) {
  if (input.character.current_hp < 1) throw new Error('Действие недоступно при 0 хитов');
  const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds ?? []);
  if (prepared.status !== 'ready') return prepared;
  const canonical = {...prepared.participant.canonical};
  const participants=[prepared.participant];
  if(input.characters){
    if(input.characters.length>6||new Set(input.characters.map(c=>c.id)).size!==input.characters.length
      ||!input.characters.some(c=>c.id===input.character.id))throw Error('Некорректная группа');
    for(const character of input.characters.filter(c=>c.id!==input.character.id)){
      const ally=await prepareRoguelikeCombatParticipant(character,input.catalog,input.basicActionIds??[]);
      if(ally.status!=='ready')return ally;participants.push(ally.participant);
    }
    canonical.world=mergeSheetCombatParticipantWorlds({seeds:participants,ruleset:canonical.world.ruleset,
      worldId:`camp:${input.character.id}`,sceneMode:'exploration'});
  }
  const action = canonical.actions.find((entry) => entry.id === input.actionId || (input.itemCardId
    && entry.sourceEntityIds.includes(input.itemCardId)
    && ((entry.mechanics.activation as Record<string, unknown> | undefined)?.cost as Record<string, unknown>[] | undefined)?.some((cost) => cost.bound_self_item === true)));
  if (!action && !input.nextTurn && !input.companion) throw new Error('У персонажа нет выбранного действия');
  const activation = action?.mechanics.activation as Record<string, unknown> | undefined;
  if (activation?.mode === 'reaction' || activation?.mode === 'triggered' || activation?.trigger || activation?.mode === 'passive') throw new Error('Способность требует соответствующего события');
  const declaredCastTime = action ? parseActivationCastTime(action.mechanics) : { status: 'none' as const };
  if (declaredCastTime.status === 'invalid') throw new Error(declaredCastTime.issue);
  const castSeconds = declaredCastTime.status === 'valid'
    ? declaredCastTime.policy.seconds + (input.spell?.mode === 'ritual' ? 600 : 0)
    : 0;
  let elapsedEvents = [] as ReturnType<typeof advanceRoguelikeCampTime>['events'];
  if (castSeconds > 6) {
    const advanced = advanceRoguelikeCampTime({ world: canonical.world, elapsedSeconds: castSeconds });
    canonical.world = advanced.world;
    elapsedEvents = advanced.events;
  }
  const targetIds = input.targetIds ?? (!action || action.targeting?.maxTargets === 0 ? [] : [canonical.actorId]);
  if(new Set(targetIds).size!==targetIds.length || targetIds.some(id=>!participants.some(p=>p.character.id===id)))throw Error('Цель не состоит в группе');
  if(targetIds.some(id=>!action?.targeting?.allowedRelations.includes(id===canonical.actorId?'self':'ally')))throw Error('Действие не позволяет выбрать эту цель');
  const random = createRoguelikeCombatRandom(input.seed, 0);
  const mergedBefore=canonical.world;
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
    factsByTarget: Object.fromEntries(targetIds.map(id=>[id, {
      relation: id===canonical.actorId?'self':'ally', distanceFt: id===canonical.actorId?0:5, lineOfSight: true, cover: 'none', willing: true,
      factsSource: 'scenario', boardRevision: canonical.world.revision,
    }])),
    ...(input.choices ? { choices: input.choices } : {}),
    ...(input.spell ? { spell: input.spell } : {}),
    ...(input.worldInput ? { worldInput: input.worldInput } : {}),
  } as UseAction, canonical.catalog, environment);
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
  const participantWorld=(participant:typeof prepared.participant)=>participants.length>1
    ? projectSheetCompanionParticipantWorld({participant,mergedBefore,mergedAfter:result.nextState,commandId:input.commandId}) : result.nextState;
  const turnState = writeSheetCanonicalWorld(clearSheetCombatSession(writeSoloCombatState(input.character.turn_state, null)),
    canonical.actorId, participantWorld(prepared.participant), canonical.resourceBindings);
  // Turn-sized actions share the current six-second turn; longer casts advance
  // by their rules-owned duration including the ritual addition.
  const elapsedSeconds = input.nextTurn ? 6 : castSeconds > 6 ? castSeconds : 0;
  const events = [...elapsedEvents, ...result.events.flatMap((event) => event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : [])];
  const patches=Object.fromEntries(participants.filter(p=>p.character.id!==input.character.id).map(p=>{
    const ally=result.nextState.actors[p.character.id];
    const projection=projectSheetCanonicalPersistence({runtime:ally.runtime,currency:p.character.currency,resourceBindings:p.canonical.resourceBindings});
    const rt=projection.runtime;
    const turn=writeSheetCanonicalWorld(clearSheetCombatSession(writeSoloCombatState(p.character.turn_state,null)),p.character.id,participantWorld(p),p.canonical.resourceBindings);
    return [p.character.id,{current_hp:rt.hp.current,resources:rt.resources,max_resources:rt.maxResources,active_effects:rt.activeEffects,
      equipment:rt.equipment,inventory_items:runtimeInventoryPayload(rt),turn_state:writeRulesEngineRuntimeTurnState(turn,rt),runtime_revision:Number(p.character.runtime_revision)+1}];
  }));
  return { status: 'ready' as const, contentManifestHash: prepared.contentManifestHash, events, goldSpent, elapsedSeconds,
    patches,
    patch: { current_hp: runtime.hp.current, resources: runtime.resources, max_resources: runtime.maxResources,
      active_effects: runtime.activeEffects, equipment: runtime.equipment, inventory_items: runtimeInventoryPayload(runtime),
      turn_state: writeRulesEngineRuntimeTurnState(turnState, runtime,
        input.nextTurn ? { attunement_unlocked: false } : {}), runtime_revision: revision },
  };
}
