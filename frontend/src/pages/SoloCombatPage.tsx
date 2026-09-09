import {effectiveArmorClass} from '../rules-core/actorArmorClass';
import type {Action} from '../types';
import {availableCheckManeuvers, checkManeuverChoice} from '../character/checkManeuvers';
import SheetActionLine from '../components/SheetActionLine';
import { getDamageLabel } from '../utils/damageTypes';
import type { RoguelikeCombatIntent } from '../roguelike/combatWorker';
import type { RoguelikeRun } from '../roguelike/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { actionsApi, effectsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import {
  runtimeInventoryPayload,
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import { sheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import type { ForgeCharacter } from '../character/types';
import CombatHotbar from '../components/CombatHotbar';
import CombatTriggeredActionPanel from '../components/CombatTriggeredActionPanel';
import CombatActorInspector from '../components/CombatActorInspector';
import CombatCharacterSidebar from '../components/CombatCharacterSidebar';
import CombatLogPanel from '../components/CombatLogPanel';
import CombatSceneConstructor from '../components/CombatSceneConstructor';
import MonsterTurnController from '../components/MonsterTurnController';
import SheetPendingCombatPanel, { sheetReactionDecisionOptions } from '../components/SheetPendingCombatPanel';
import TacticalBattleMap from '../components/TacticalBattleMap';
import { useSheetWorldInputDialog } from '../components/SheetWorldInputDialog';
import { monstersApi } from '../monsters/api';
import {
  declineAdditionalMovement, activeActor,
  activateCombatBoon,
  addSoloCombatCharacter,
  addSoloCombatMonster,
  advanceTurn,
  autoResolveSystemDecisions, resumePendingMovement,
  combatDetectMagicStatus,
  createSoloCombatState,
  executeCombatAction,
  executeCombatRemoteManipulator,
  moveCombatDancingLights,
  moveActorAlongRoute,
  standActor,
  refreshSoloCombatParticipants,
  revealCombatMagicAura,
  resolvePlayerReaction,
  resolvePlayerShoveOutcome, resolvePlayerSavingThrow,
  resolveD20Interrupt,
  resolveSoloCombatAlertSwap,
  resolveSoloCombatInterception,
  resolveSoloCombatTurnStart,
  resolveTriggeredCombatAction,
  triggeredSecondaryTargetIds,
  selectedTargetsForAction,
} from '../solo-combat/engine';
import { readSoloCombatState } from '../solo-combat/persistence';
import { clearIncompatibleCombatSnapshot, isIncompatibleCombatRulesError } from '../solo-combat/rulesUpgrade';
import { shouldShowSoloCombatOutcome } from '../solo-combat/outcomeVisibility';
import { writeDedicatedCombatTurnState } from '../solo-combat/turnState';
import {
  controlledCharacterIds,
  isControlledCharacter,
  isPlayerControlledCombatActor,
  type GridPosition,
  type SoloCombatState,
} from '../solo-combat/types';
import {
  collectSoloCombatActionChoices,
  immediateSoloCombatTargetIds,
} from '../solo-combat/actionChoices';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { getCardsIndex } from '../utils/cardsIndex';
import { effectiveActorSpeedFt, gridDistanceFt } from '../solo-combat/tacticalGrid';
import type { ActionWorldInput } from '../rules-core/domain';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { bindCombatWorldInputFacts } from '../solo-combat/worldInput';
import { roguelikeApi } from '../roguelike/api';
import { runEncounterSelection } from '../roguelike/navigation';
import './CharacterForge.css';
import './CharacterSheetV2.css';
import './SoloCombatPage.css';

function querySelection(params: URLSearchParams): Array<{ id: string; quantity: number }> {
  return [...params.entries()].flatMap(([id, raw]) => {
    const quantity = Number(raw);
    return /^[0-9a-f-]{36}$/i.test(id) && Number.isInteger(quantity) && quantity > 0
      ? [{ id, quantity: Math.min(quantity, 6) }]
      : [];
  });
}

function queryAllies(params: URLSearchParams, characterId?: string): string[] {
  return [...new Set(params.getAll('ally'))].filter((allyId) => (
    /^[0-9a-f-]{36}$/i.test(allyId) && allyId !== characterId
  )).slice(0, 3);
}

function initiativeLabel(entry: SoloCombatState['initiative'][number]): string {
  return entry.roll?.text ?? `${entry.die}${entry.bonus >= 0 ? '+' : ''}${entry.bonus} = ${entry.total}`;
}

function combatWorldInputContext(
  state: SoloCombatState,
  actorId: string,
  action: SoloCombatState['catalogActions'][number],
) {
  const actions = state.catalogActions;
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  const runtime: SheetCanonicalRuntime = {
    actorId,
    world: state.world,
    actions,
    catalog: {
      getAction: (actionId) => byId.get(actionId),
      listActions: () => [...actions],
    },
    cards: [],
    resourceBindings: state.resourceBindingsByActor?.[actorId]
      ?? (actorId === state.characterId ? state.resourceBindings : {}),
    actionFor: () => action,
  };
  return sheetWorldInputFormContext({ runtime, action });
}

export default function SoloCombatPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roguelikeRunId = searchParams.get('roguelike');
  const choiceDialog = useChoiceDialog();
  const worldInputDialog = useSheetWorldInputDialog();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [participantCharacters, setParticipantCharacters] = useState<Record<string, ForgeCharacter>>({});
  const participantCharactersRef = useRef<Record<string, ForgeCharacter>>({});
  const characterRef = useRef<ForgeCharacter | null>(null);
  const trustedRunRef = useRef<RoguelikeRun | null>(null);
  const trustedBusyRef = useRef(false);
  const [state, setState] = useState<SoloCombatState | null>(null);
  const [secondaryActionId, setSecondaryActionId] = useState<string | null>(null);
  const [selectedMovementTargetId, setSelectedMovementTargetId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedActionChoices, setSelectedActionChoices] = useState<Record<string, string[]>>({});
  const [movementMode, setMovementMode] = useState(false);
  const [dancingLightsMoveGroupId, setDancingLightsMoveGroupId] = useState<string | null>(null);
  const [inspectedActorId, setInspectedActorId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sceneConstructorOpen, setSceneConstructorOpen] = useState(false);
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleRulesSnapshot, setStaleRulesSnapshot] = useState(false);
  characterRef.current = character;
  participantCharactersRef.current = participantCharacters;
  // The setup query is consumed exactly once. Removing it from the URL after
  // creation must not start a second initialization against the persisted fight.
  const initialRequestedRef = useRef(querySelection(searchParams));
  const initialAlliesRef = useRef(queryAllies(searchParams, id));

  const persist = useCallback(async (next: SoloCombatState) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter || !id) throw new Error('Лист персонажа не загружен');
    setBusy(true);
    const actor = next.world.actors[id];
    const participantIds = controlledCharacterIds(next).sort();
    if (participantIds.length > 1) {
      const rows = participantCharactersRef.current;
      const expectedRevisions = Object.fromEntries(participantIds.map((actorId) => {
        const row = rows[actorId];
        if (!row) throw new Error(`Лист участника ${actorId} не загружен`);
        return [actorId, Number(next.participantRuntimeRevisions?.[actorId] ?? row.runtime_revision ?? 0)];
      }));
      const nextRevisions = Object.fromEntries(participantIds.map((actorId) => [
        actorId,
        expectedRevisions[actorId] + 1,
      ]));
      const predicted = {
        ...next,
        runtimeRevision: nextRevisions[id],
        participantRuntimeRevisions: nextRevisions,
      };
      try {
        const ruleset = next.world.ruleset;
        const response = await charactersV3Api.postRuntimeCommand({
          command_id: newSheetRuntimeCommandId(),
			roguelike_run_id: roguelikeRunId ?? undefined,
          ruleset_ref: {
            system_id: ruleset.systemId,
            release_id: ruleset.releaseId,
            content_hash: ruleset.contentHash,
            errata_version: ruleset.errataVersion,
          },
          participants: participantIds.map((actorId) => {
            const row = rows[actorId];
            const participantActor = next.world.actors[actorId];
            return {
              character_id: actorId,
              expected_runtime_revision: expectedRevisions[actorId],
              patch: {
                current_hp: participantActor.runtime.hp.current,
                resources: participantActor.runtime.resources,
                max_resources: participantActor.runtime.maxResources,
                active_effects: participantActor.runtime.activeEffects,
                inventory_items: runtimeInventoryPayload(participantActor.runtime),
                turn_state: actorId === id
                  ? writeDedicatedCombatTurnState(row.turn_state, participantActor.runtime, predicted)
                  : writeRulesEngineRuntimeTurnState(row.turn_state, participantActor.runtime),
              },
            };
          }),
          events: [],
        });
        const acceptedRows = Object.fromEntries(response.participants.map((entry) => [
          entry.character_id,
          entry.character,
        ]));
        const acceptedRevisions = Object.fromEntries(response.participants.map((entry) => [
          entry.character_id,
          Number(entry.runtime_revision),
        ]));
        const accepted = {
          ...predicted,
          runtimeRevision: acceptedRevisions[id] ?? predicted.runtimeRevision,
          participantRuntimeRevisions: { ...nextRevisions, ...acceptedRevisions },
        };
        const mergedRows = { ...rows, ...acceptedRows };
        participantCharactersRef.current = mergedRows;
        setParticipantCharacters(mergedRows);
        characterRef.current = mergedRows[id];
        setCharacter(mergedRows[id]);
        setState(accepted);
      } finally {
        setBusy(false);
      }
      return;
    }
    const nextRevision = next.runtimeRevision + 1;
    const predicted = {
      ...next,
      runtimeRevision: nextRevision,
      participantRuntimeRevisions: {
        ...(next.participantRuntimeRevisions ?? {}),
        [id]: nextRevision,
      },
    };
    const turnState = writeDedicatedCombatTurnState(
      currentCharacter.turn_state,
      actor.runtime,
      predicted,
    );
    try {
		const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: next.runtimeRevision,
        current_hp: actor.runtime.hp.current,
        resources: actor.runtime.resources,
        max_resources: actor.runtime.maxResources,
        active_effects: actor.runtime.activeEffects,
        inventory_items: runtimeInventoryPayload(actor.runtime),
        turn_state: turnState,
		}, roguelikeRunId ? { runId: roguelikeRunId, intent: 'combat' } : undefined);
      const acceptedRevision = Number(saved.runtime_revision ?? predicted.runtimeRevision);
      const accepted = {
        ...predicted,
        runtimeRevision: acceptedRevision,
        participantRuntimeRevisions: {
          ...(predicted.participantRuntimeRevisions ?? {}),
          [id]: acceptedRevision,
        },
      };
      characterRef.current = saved;
      setCharacter(saved);
      const mergedRows = { ...participantCharactersRef.current, [saved.id]: saved };
      participantCharactersRef.current = mergedRows;
      setParticipantCharacters(mergedRows);
      setState(accepted);
    } finally {
      setBusy(false);
    }
	}, [id, roguelikeRunId]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const [loadedCharacter, loadedRun] = await Promise.all([
          charactersV3Api.get(id),
          roguelikeRunId ? roguelikeApi.get(roguelikeRunId) : Promise.resolve(null),
        ]);
        if (loadedRun && (loadedRun.character_id !== id || loadedRun.phase !== 'combat')) {
          throw new Error('Этот лист не участвует в активной встрече забега');
        }
        if (!active) return;
        characterRef.current = loadedCharacter;
        setCharacter(loadedCharacter);
        participantCharactersRef.current = { [loadedCharacter.id]: loadedCharacter };
        setParticipantCharacters(participantCharactersRef.current);
        if (loadedRun?.combat_state || (loadedRun?.trusted_combat_available && !loadedCharacter.turn_state?.solo_combat_v1)) {
          let initiativeManeuverActionId: string | undefined;
          if (!loadedRun.combat_state) {
            const preview = await loadSheetCombatParticipant({character: loadedCharacter, cards: new Map()});
            if (!active) return;
            const actor = preview.canonical.world.actors[loadedCharacter.id];
            const owned = preview.canonical.actions.map(action => ({...preview.actionPresentation?.[action.id]?.actionRef, id: action.id, name: action.name,
              mechanics: action.mechanics}) as Action);
            const options = availableCheckManeuvers(owned, actor.runtime, 'initiative', {});
            if (options.length) {
              const selection = await choiceDialog.request([checkManeuverChoice(options, 'Инициатива')], 'Инициатива');
              if (!active) return;
              if (!selection) { navigate(`/roguelike/${loadedRun.id}`); return; }
              const selectedId = selection.check_maneuver?.[0];
              if (selectedId !== 'none') {
                if (!options.some(action => action.id === selectedId)) throw Error('Выберите приём инициативы или обычный бросок.');
                initiativeManeuverActionId = selectedId;
              }
            }
          }
          const accepted = loadedRun.combat_state ? loadedRun
            : await roguelikeApi.command(loadedRun.id, loadedRun.revision, 'initialize_combat',
              initiativeManeuverActionId ? {initiative_maneuver_action_id: initiativeManeuverActionId} : {}).catch(async reason => {
              const current = await roguelikeApi.get(loadedRun.id);
              if (current.combat_state) return current;
              throw reason;
            });
          if (!active) return;
          if (!accepted.combat_state || !accepted.character) throw new Error('Сервер не вернул состояние боя');
          trustedRunRef.current = accepted;
          characterRef.current = accepted.character;
          setCharacter(accepted.character);
          participantCharactersRef.current = {[accepted.character.id]: accepted.character};
          setParticipantCharacters(participantCharactersRef.current);
          setState(accepted.combat_state);
          setBusy(false);
          return;
        }
        const requested = loadedRun
          ? loadedCharacter.turn_state?.solo_combat_v1 ? [] : runEncounterSelection(loadedRun.encounter)
          : initialRequestedRef.current;
        const pinnedCatalog = loadedRun?.encounter.catalog;
        if (pinnedCatalog && pinnedCatalog.version !== 1) throw new Error('Версия сохранённого каталога встречи не поддерживается');
        if (!requested.length) {
          const restored = readSoloCombatState(
            loadedCharacter.turn_state, id, Number(loadedCharacter.runtime_revision ?? 0),
          );
          if (!restored) throw new Error('Сохранённый бой не найден. Запустите проверку из листа персонажа.');
          const allyIds = controlledCharacterIds(restored).filter((actorId) => actorId !== loadedCharacter.id);
          const [allyRows, basicResponse, cards] = await Promise.all([
            Promise.all(allyIds.map((allyId) => charactersV3Api.get(allyId))),
            actionsApi.getActions({ type: 'basic', limit: 100 }),
            getCardsIndex(),
          ]);
          const loadedRows = [loadedCharacter, ...allyRows];
          participantCharactersRef.current = Object.fromEntries(
            loadedRows.map((row) => [row.id, row]),
          );
          setParticipantCharacters(participantCharactersRef.current);
          const participants = await Promise.all(loadedRows.map((row) => (
            loadSheetCombatParticipant({
              character: row,
              basicActions: basicResponse.actions,
              cards,
            })
          )));
          setState(await refreshSoloCombatParticipants({ state: restored, participants }));
          setBusy(false); return;
        }
        const [monsters, allyCharacters] = await Promise.all([
          pinnedCatalog ? Promise.resolve(pinnedCatalog.monsters)
            : Promise.all(requested.map(({ id: monsterId }) => monstersApi.get(monsterId))),
          Promise.all((loadedRun ? [] : initialAlliesRef.current).map((allyId) => charactersV3Api.get(allyId))),
        ]);
        if (allyCharacters.some((ally) => ally.user_id !== loadedCharacter.user_id)) {
          throw new Error('Союзник должен принадлежать тому же пользователю');
        }
        const actionIds = [...new Set(monsters.flatMap((monster) => monster.action_ids))];
        const effectIds = [...new Set(monsters.flatMap((monster) => monster.effect_ids))];
        const [actionRows, effectRows, basicResponse, cards] = await Promise.all([
          pinnedCatalog ? Promise.resolve(pinnedCatalog.actions)
            : Promise.all(actionIds.map((actionId) => actionsApi.getAction(actionId))),
          pinnedCatalog ? Promise.resolve(pinnedCatalog.effects)
            : Promise.all(effectIds.map((effectId) => effectsApi.getEffect(effectId))),
          actionsApi.getActions({ type: 'basic', limit: 100 }),
          getCardsIndex(),
        ]);
        const basicActions = basicResponse.actions;
        const allActions = [...new Map([...actionRows, ...basicActions].map((action) => [action.id, action])).values()];
        const participants = await Promise.all([loadedCharacter, ...allyCharacters].map((row) => (
          loadSheetCombatParticipant({ character: row, basicActions, cards })
        )));
        const participant = participants[0];
        const selected = requested.map(({ id: monsterId, quantity }) => ({
          monster: monsters.find((monster) => monster.id === monsterId)!, quantity,
        }));
        const created = await createSoloCombatState({
          character: loadedCharacter, participant, allies: participants.slice(1), selected,
          actions: allActions, effects: effectRows,
          dashAction: basicActions.find((action) => action.card_number === 'action_basic_dash'),
        });
        if (!active) return;
        participantCharactersRef.current = Object.fromEntries(
          [loadedCharacter, ...allyCharacters].map((row) => [row.id, row]),
        );
        setParticipantCharacters(participantCharactersRef.current);
        setState(created);
        await persist(created);
        navigate(
          `/characters-v3/${id}/combat${roguelikeRunId ? `?roguelike=${encodeURIComponent(roguelikeRunId)}` : ''}`,
          { replace: true },
        );
      } catch (reason) {
        if (active) {
          setStaleRulesSnapshot(isIncompatibleCombatRulesError(reason));
          setError(reason instanceof Error ? reason.message : 'Не удалось начать бой'); setBusy(false);
        }
      }
    })();
    return () => { active = false; };
  }, [id, navigate, persist, roguelikeRunId, choiceDialog.request]);

  const resetStaleCombat = useCallback(async () => {
    const current = characterRef.current;
    if (!current || !id) return;
    setBusy(true);
    try {
      const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: Number(current.runtime_revision ?? 0),
        turn_state: clearIncompatibleCombatSnapshot(current.turn_state),
	  }, roguelikeRunId ? { runId: roguelikeRunId, intent: 'combat' } : undefined);
      characterRef.current = saved;
      setCharacter(saved);
      navigate(`/characters-v3/${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сбросить устаревший бой');
      setBusy(false);
    }
	}, [id, navigate, roguelikeRunId]);

  const apply = useCallback((next: SoloCombatState) => {
    setError(null);
    void persist(next).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ход'));
  }, [persist]);

  const applyIntent = useCallback((intent: RoguelikeCombatIntent, local: () => SoloCombatState) => {
    const run = trustedRunRef.current;
    if (!run) { apply(resumePendingMovement(local())); return; }
    if (trustedBusyRef.current) return;
    trustedBusyRef.current = true;
    setBusy(true); setError(null);
    void roguelikeApi.command(run.id, run.revision, 'combat_intent', {intent}).then(accepted => {
      if (!accepted.combat_state || !accepted.character) throw new Error('Сервер не вернул состояние боя');
      trustedRunRef.current = accepted;
      characterRef.current = accepted.character;
      setCharacter(accepted.character);
      participantCharactersRef.current = {[accepted.character.id]: accepted.character};
      setParticipantCharacters(participantCharactersRef.current);
      setState(accepted.combat_state);
    }).catch(async reason => {
      // A response can be lost after commit. Reconcile before accepting another
      // click so retrying cannot accidentally repeat an already applied action.
      try {
        const current = await roguelikeApi.get(run.id);
        if (current.combat_state && current.character) {
          trustedRunRef.current = current;
          characterRef.current = current.character;
          setCharacter(current.character);
          participantCharactersRef.current = {[current.character.id]: current.character};
          setParticipantCharacters(participantCharactersRef.current);
          setState(current.combat_state);
        }
      } catch { /* Keep the last confirmed state; revision checks prevent overwrite. */ }
      setError(playerFacingSheetActionError(reason));
    }).finally(() => {
      trustedBusyRef.current = false; setBusy(false);
    });
  }, [apply]);

  const resolveTriggeredChoice = async (actionId: string | null) => {
    if (!state?.pendingTriggeredAction || busy) return;
    try {
      const action = state.catalogActions.find(candidate => candidate.id === actionId);
      if (action && triggeredSecondaryTargetIds(state, action.id).length) {
        setSelectedActionId(null); setMovementMode(false); setSecondaryActionId(action.id); return;
      }
      const required = action ? collectSoloCombatActionChoices(
        state.world.actors[state.pendingTriggeredAction.sourceActorId], action,
        state.actionPresentation?.[action.id]?.actionRef?.card_number,
        state.world.actors[state.pendingTriggeredAction.targetIds[0]],
      ) : [];
      const choices = required.length ? await choiceDialog.request(required, action!.name) : {};
      if (!choices) return;
      applyIntent({type: 'triggered_action', actionId, choices}, () => autoResolveSystemDecisions(
        resolveTriggeredCombatAction(state, actionId, Math.random, choices),
      ));
    } catch (reason) {
      setError(playerFacingSheetActionError(reason));
    }
  };

  const activeControlledActorId = state?.pendingAdditionalMovement?.actorId ?? (state && isPlayerControlledCombatActor(state, activeActor(state).id)
    ? activeActor(state).id
    : state?.characterId ?? '');
  const playerTurn = state ? isPlayerControlledCombatActor(state, activeActor(state).id) : false;
  const activeDancingLights = state ? Object.values(state.world.objects).filter((object) => {
    const concentration = state.world.concentrations[activeControlledActorId];
    return object.sourceActorId === activeControlledActorId
      && object.sourceActionId === concentration?.actionId
      && object.dancingLight;
  }).sort((left, right) => left.id.localeCompare(right.id)) : [];
  const activeDancingLightsGroup = activeDancingLights[0]?.dancingLight?.groupId;
  const activeDetectMagic = state
    ? combatDetectMagicStatus(state, activeControlledActorId)
    : null;
  const chooseAction = async (action: SoloCombatState['catalogActions'][number]) => {
    if (!state || !playerTurn || busy) return;
    const wasSelected = selectedActionId === action.id;
    setSelectedMovementTargetId(null);
    setError(null);
    setMovementMode(false);
    setDancingLightsMoveGroupId(null);
    setSelectedActionId(null);
    setSelectedActionChoices({});
    if (wasSelected) return;
    try {
      const requiredChoices = collectSoloCombatActionChoices(
        state.world.actors[activeControlledActorId],
        action,
        state.actionPresentation?.[action.id]?.actionRef?.card_number,
      );
      const choices = requiredChoices.length
        ? await choiceDialog.request(requiredChoices, action.name)
        : {};
      if (!choices) return;
      const immediateTargets = immediateSoloCombatTargetIds(action, activeControlledActorId, state);
      if (immediateTargets) {
        applyIntent({type: 'action', actorId: activeControlledActorId, actionId: action.id, targetIds: immediateTargets, choices}, () => autoResolveSystemDecisions(executeCombatAction({
          state,
          actorId: activeControlledActorId,
          actionId: action.id,
          targetIds: immediateTargets,
          choices,
        })));
        return;
      }
      setSelectedActionId(action.id);
      setSelectedActionChoices(choices);
    } catch (reason) { setError(playerFacingSheetActionError(reason)); }
  };

  const clickCell = async (position: GridPosition, actorId?: string) => {
    if (state?.pendingTriggeredAction && secondaryActionId && !busy) {
      if (!actorId || !triggeredSecondaryTargetIds(state, secondaryActionId).includes(actorId)) {
        setError(state.pendingTriggeredAction.event === 'commanded_attack' ? 'Выберите доступную цель атаки союзника' : 'Выберите другую цель в 5 футах от первой и в досягаемости атаки'); return;
      }
      const targetIds = [actorId];
      try {
        applyIntent({type: 'triggered_action', actionId: secondaryActionId, targetIds}, () => autoResolveSystemDecisions(
          resolveTriggeredCombatAction(state, secondaryActionId, Math.random, undefined, targetIds),
        ));
        setSecondaryActionId(null);
      } catch (reason) { setError(playerFacingSheetActionError(reason)); }
      return;
    }
    if (!state || (!playerTurn && !state.pendingAdditionalMovement) || busy || state.world.pendingResolution
      || state.pendingTriggeredAction || state.pendingTurnStartGrappleDamage) return;
    try {
      if (movementMode || state.pendingAdditionalMovement) {
        if (actorId) throw new Error('Для перемещения выберите свободную клетку');
        setMovementMode(false); setSelectedActionChoices({});
        applyIntent({type: 'move', actorId: activeControlledActorId, destination: position}, () => moveActorAlongRoute({state, actorId: activeControlledActorId, destination: position})); return;
      }
      if (dancingLightsMoveGroupId) {
        if (dancingLightsMoveGroupId !== activeDancingLightsGroup) {
          setDancingLightsMoveGroupId(null);
          throw new Error('Активные Танцующие огоньки не найдены.');
        }
        const next = () => moveCombatDancingLights({
          state,
          actorId: activeControlledActorId,
          groupId: dancingLightsMoveGroupId,
          destination: position,
        });
        setDancingLightsMoveGroupId(null);
        setSelectedActionChoices({});
        applyIntent({type: 'dancing_lights', actorId: activeControlledActorId, groupId: dancingLightsMoveGroupId, destination: position}, next);
        return;
      }
      if (!selectedActionId) return;
      const selectedAction=state.catalogActions.find(row=>row.id===selectedActionId)!;
      if((selectedAction.mechanics.activation as Record<string,unknown>|undefined)?.telekinetic_movement===true){
        if(!selectedMovementTargetId){
          if(!actorId || actorId===activeControlledActorId || !isControlledCharacter(state,actorId))throw new Error('Выберите другое согласное существо');
          setSelectedMovementTargetId(actorId);return;
        }
        if(actorId)throw new Error('Выберите свободную клетку для перемещения');
        const targetIds=[selectedMovementTargetId];
        const next=()=>autoResolveSystemDecisions(executeCombatAction({state,actorId:activeControlledActorId,actionId:selectedActionId,targetIds,worldPosition:position,choices:selectedActionChoices}));
        applyIntent({type:'action',actorId:activeControlledActorId,actionId:selectedActionId,targetIds,worldPosition:position,choices:selectedActionChoices},next);
        setSelectedActionId(null);setSelectedMovementTargetId(null);setSelectedActionChoices({});return;
      }
      const targetIds = selectedTargetsForAction({
        state,
        actorId: activeControlledActorId,
        actionId: selectedActionId,
        clickedActorId: actorId,
        clickedPosition: position,
      });
      const action = state.catalogActions.find((candidate) => candidate.id === selectedActionId)!;
      if (!targetIds.length && (action.targeting?.minTargets ?? 0) > 0) throw new Error('В выбранной области нет допустимой цели');
      let worldInput: ActionWorldInput | undefined;
      let scenarioObjects: WorldObjectState[] = [];
      const worldInputContext = combatWorldInputContext(state, activeControlledActorId, action);
      if (worldInputContext) {
        const sourcePosition = state.tokens[activeControlledActorId]?.position;
        if (!sourcePosition) throw new Error('Персонаж отсутствует на поле боя.');
        const distanceFt = gridDistanceFt(sourcePosition, position);
        if (action.targeting?.rangeFt !== undefined && distanceFt > action.targeting.rangeFt) {
          throw new Error(`${action.name}: выбранная клетка дальше ${action.targeting.rangeFt} фт.`);
        }
        const boardFacts = {
          factsSource: 'board' as const,
          boardRevision: String(state.boardRevision),
          distanceFt: String(distanceFt),
          lineOfSight: true,
        };
        const result = await worldInputDialog.request(
          worldInputContext,
          `${action.name}: форма и факты`,
          newSheetRuntimeCommandId(),
          { facts: boardFacts },
        );
        if (!result) return;
        scenarioObjects = result.scenarioObjects;
        worldInput = bindCombatWorldInputFacts(result.worldInput, {
          factsSource: 'board',
          boardRevision: state.boardRevision,
          distanceFt,
          lineOfSight: true,
        });
      }
      const next = () => autoResolveSystemDecisions(executeCombatAction({
        state,
        actorId: activeControlledActorId,
        actionId: selectedActionId,
        targetIds,
        worldPosition: position,
        worldInput,
        scenarioObjects,
        choices: selectedActionChoices,
      }));
      setSelectedActionId(null); setSelectedActionChoices({});
      applyIntent({type: 'action', actorId: activeControlledActorId, actionId: selectedActionId, targetIds, worldPosition: position, worldInput, choices: selectedActionChoices}, next);
    } catch (reason) { setError(playerFacingSheetActionError(reason)); }
  };

  const addSceneCharacter = async (characterId: string) => {
    if (!state || !character) throw new Error('Сцена ещё не загружена');
    const [row, basicResponse, cards] = await Promise.all([
      charactersV3Api.get(characterId),
      actionsApi.getActions({ type: 'basic', limit: 100 }),
      getCardsIndex(),
    ]);
    if (row.user_id !== character.user_id) throw new Error('Можно добавить только своего персонажа');
    const participant = await loadSheetCombatParticipant({
      character: row,
      basicActions: basicResponse.actions,
      cards,
    });
    const next = await addSoloCombatCharacter({ state, participant });
    const rows = { ...participantCharactersRef.current, [row.id]: row };
    participantCharactersRef.current = rows;
    setParticipantCharacters(rows);
    apply(next);
  };

  const addSceneMonster = async (monsterId: string) => {
    if (!state) throw new Error('Сцена ещё не загружена');
    const monster = await monstersApi.get(monsterId);
    const [actions, effects] = await Promise.all([
      Promise.all(monster.action_ids.map((actionId) => actionsApi.getAction(actionId))),
      Promise.all(monster.effect_ids.map((effectId) => effectsApi.getEffect(effectId))),
    ]);
    apply(addSoloCombatMonster({ state, monster, actions, effects }));
  };

  const finish = async () => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter || !state || !id) return;
    setBusy(true);
    try {
      if (roguelikeRunId) {
        const run = await roguelikeApi.get(roguelikeRunId);
        await roguelikeApi.command(run.id, run.revision, 'complete_encounter');
        navigate(`/roguelike/${run.id}`);
        return;
      }
      const participantIds = controlledCharacterIds(state).sort();
      if (participantIds.length > 1) {
        const rows = participantCharactersRef.current;
        const ruleset = state.world.ruleset;
        await charactersV3Api.postRuntimeCommand({
          command_id: newSheetRuntimeCommandId(),
          ruleset_ref: {
            system_id: ruleset.systemId,
            release_id: ruleset.releaseId,
            content_hash: ruleset.contentHash,
            errata_version: ruleset.errataVersion,
          },
          participants: participantIds.map((actorId) => {
            const row = rows[actorId];
            const participantActor = state.world.actors[actorId];
            if (!row || !participantActor) throw new Error(`Лист участника ${actorId} не загружен`);
            return {
              character_id: actorId,
              expected_runtime_revision: Number(
                state.participantRuntimeRevisions?.[actorId] ?? row.runtime_revision ?? 0,
              ),
              patch: {
                current_hp: participantActor.runtime.hp.current,
                resources: participantActor.runtime.resources,
                max_resources: participantActor.runtime.maxResources,
                active_effects: participantActor.runtime.activeEffects,
                inventory_items: runtimeInventoryPayload(participantActor.runtime),
                turn_state: actorId === id
                  ? writeDedicatedCombatTurnState(row.turn_state, participantActor.runtime, null)
                  : writeRulesEngineRuntimeTurnState(row.turn_state, participantActor.runtime),
              },
            };
          }),
          events: [],
        });
        navigate(`/characters-v3/${id}`);
        return;
      }
      const actor = state.world.actors[id];
      const saved = await charactersV3Api.patchRuntime(id, {
        expected_runtime_revision: state.runtimeRevision,
        current_hp: actor.runtime.hp.current,
        resources: actor.runtime.resources,
        max_resources: actor.runtime.maxResources,
        active_effects: actor.runtime.activeEffects,
        turn_state: writeDedicatedCombatTurnState(
          currentCharacter.turn_state,
          actor.runtime,
          null,
        ),
      });
      characterRef.current = saved;
      navigate(`/characters-v3/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось завершить бой'); setBusy(false); }
  };

  if (!state || !character) {
    return <main className="solo-combat-loading"><h1>Подготовка поля боя</h1><p>{error ?? 'Компилируем лист, монстров и инициативу…'}</p>{staleRulesSnapshot && <button type="button" onClick={() => void resetStaleCombat()}>Сбросить устаревший бой</button>}{error && <Link to={`/characters-v3/${id}`}>Вернуться в лист</Link>}</main>;
  }
  const actor = activeActor(state);
  const pending = state.world.pendingResolution;
  const pendingTriggered = state.pendingTriggeredAction;
  const pendingD20Interrupt = state.pendingD20Interrupt;
  const pendingTurnStart = state.pendingTurnStartGrappleDamage;
  const reactionOptions = pending?.request.type === 'reaction'
    && isControlledCharacter(state, pending.request.actorId)
    ? sheetReactionDecisionOptions(pending.request.options) : [];
  const controlledSavePending = (pending?.request.type === 'saving_throw' || pending?.request.type === 'shove_outcome')
    && isControlledCharacter(state, pending.request.actorId)
    ? pending
    : null;
  const reactionTitle = pending?.type === 'attack_reaction' && pending.attackAdjustment
    ? 'Промах — применить приём?'
    : pending?.type === 'damage_reaction'
    ? 'Реакция на урон'
    : pending?.request.type === 'reaction'
      && pending.request.trigger.type === 'hit_by_attack'
      ? 'По вам попали'
      : 'Открыто окно реакции';
  const reactionDetails = pending?.type === 'attack_reaction' && pending.attackAdjustment
    ? pending.attackRoll.text
    : pending?.type === 'damage_reaction'
    ? `Входящий урон: ${pending.damage.reduce((sum, packet) => sum + packet.amount, 0)}${pending.damage.length
      ? ` · ${[...new Set(pending.damage.map((packet) => getDamageLabel(packet.damageType).toLocaleLowerCase('ru-RU')))].join(', ')}`
      : ''}`
    : null;
  return (
    <main className="solo-combat-page forge">
      <MonsterTurnController state={state} disabled={Boolean(trustedRunRef.current) || busy || Boolean(pendingTurnStart) || Boolean(state.pendingAlertSwapActorIds?.length) || Boolean(state.pendingInterception) || Boolean(pendingD20Interrupt)} onTransition={apply} onError={setError} />
      <header className="combat-topbar">
        <div className="combat-topbar__navigation"><Link to={roguelikeRunId ? `/roguelike/${roguelikeRunId}` : `/characters-v3/${id}`}><ArrowLeft size={18} /> {roguelikeRunId ? 'Забег' : 'Лист'}</Link>{!roguelikeRunId && <button type="button" onClick={() => setSceneConstructorOpen(true)}><SlidersHorizontal size={16} /> Сцена</button>}</div>
        <div className="initiative-ribbon" aria-label="Порядок инициативы">
          {state.initiative.map((entry) => {
            const participant = state.world.actors[entry.actorId];
            const isActive = actor.id === entry.actorId;
            return <div key={entry.actorId} className={`${isActive ? 'is-active ' : ''}${participant.runtime.hp.current <= 0 ? 'is-dead' : ''}`} title={`Инициатива: ${initiativeLabel(entry)}`}><span>{state.tokens[entry.actorId]?.tokenUrl ? <img src={state.tokens[entry.actorId].tokenUrl} alt="" /> : participant.name.slice(0, 1)}</span><b>{entry.total}</b><small>{participant.name}</small></div>;
          })}
        </div>
        <div className="combat-round">Раунд {state.world.scene.mode === 'encounter' ? state.world.scene.round : 1}<b>{busy ? 'Сохраняем…' : `Ход: ${actor.name}`}</b></div>
      </header>
      {error && <div className="combat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={16} /></button></div>}
      <section className="combat-stage">
        <div className={`combat-map-wrap${secondaryActionId && state.pendingTriggeredAction ? ' is-selecting-secondary' : ''}`}>
          <TacticalBattleMap
            state={state}
            actorId={activeControlledActorId}
            selectedActionId={secondaryActionId ?? selectedActionId}
            eligibleTargetIds={secondaryActionId ? triggeredSecondaryTargetIds(state, secondaryActionId) : undefined}
            movementMode={movementMode || Boolean(state.pendingAdditionalMovement)}
            worldObjectMoveMode={dancingLightsMoveGroupId === activeDancingLightsGroup}
            inspectedActorId={inspectedActorId}
            onCell={clickCell}
            onDeclineAdditionalMovement={state.pendingAdditionalMovement && !state.playerMovement
              && !busy && !pending && !pendingTriggered && !pendingD20Interrupt && !state.pendingInterception ? () => {
                setMovementMode(false);
                applyIntent({type: 'decline_movement', actorId: state.pendingAdditionalMovement!.actorId}, () => declineAdditionalMovement(state));
              } : undefined}
            onInspectActor={(actorId) => {
              if (isControlledCharacter(state, actorId)) {
                setSheetActorId(actorId);
                setSheetOpen(true);
                return;
              }
              setInspectedActorId((current) => current === actorId ? null : actorId);
            }}
          />
          {selectedActionId && (state.catalogActions.find(row=>row.id===selectedActionId)?.mechanics.activation as Record<string,unknown>|undefined)?.telekinetic_movement===true && <section className="combat-world-control combat-world-control--selection" aria-label="Выбор перемещения">
            <em>{selectedMovementTargetId ? `Куда переместить ${state.world.actors[selectedMovementTargetId]?.name}? Выберите свободную клетку в пределах 30 фт. от цели.` : 'Выберите согласного союзника в пределах 30 фт.'}</em>
            <button type="button" onClick={()=>{setSelectedActionId(null);setSelectedMovementTargetId(null);}}>Отмена</button>
          </section>}
          {secondaryActionId && state.pendingTriggeredAction && (
            <section className="combat-world-control combat-world-control--selection" aria-label="Выбор второй цели">
              <em>{state.pendingTriggeredAction.event === 'commanded_attack' ? 'Выберите цель атаки союзника.' : ((state.catalogActions.find(row=>row.id===secondaryActionId)?.mechanics.activation as Record<string,unknown> | undefined)?.trigger as Record<string,unknown> | undefined)?.maneuvering_movement ? 'Выберите союзника для перемещения.' : 'Выберите другую цель рядом с первой и в досягаемости атаки.'}</em>
              <button type="button" disabled={busy} onClick={() => setSecondaryActionId(null)}>Отмена</button>
            </section>
          )}
          {activeDancingLightsGroup && (
            <section className="combat-world-control" aria-label="Управление Танцующими огоньками">
              <span><b>✦ Танцующие огоньки</b><small>{activeDancingLights.length} · тусклый свет {activeDancingLights[0].dancingLight?.dimRadiusFt} фт. · концентрация · {activeDancingLights[0].roundsLeft} раундов</small></span>
              <button
                type="button"
                disabled={busy || !playerTurn || (state.world.actors[activeControlledActorId].runtime.resources.bonus_action ?? 0) < 1}
                onClick={() => {
                  setSelectedActionId(null);
                  setSelectedActionChoices({});
                  setMovementMode(false);
                  setDancingLightsMoveGroupId((current) => current === activeDancingLightsGroup ? null : activeDancingLightsGroup);
                }}
              >
                {dancingLightsMoveGroupId === activeDancingLightsGroup ? 'Отмена' : 'Переместить · бонусное действие'}
              </button>
              {dancingLightsMoveGroupId === activeDancingLightsGroup && <em>Выберите клетку в пределах 60 фт.</em>}
            </section>
          )}
          {activeDetectMagic && (
            <section className="combat-world-control" aria-label="Обнаружение магии">
              <span>
                <b>✦ {activeDetectMagic.actionName}</b>
                <small title={activeDetectMagic.sensedObjectNames.join(', ')}>
                  Концентрация · {activeDetectMagic.radiusFt} фт. · {activeDetectMagic.sensedObjectNames.length
                    ? `ощущается магия: ${activeDetectMagic.sensedObjectNames.length}`
                    : 'магия не ощущается'}
                </small>
              </span>
              <button
                type="button"
                disabled={busy || !playerTurn
                  || (state.world.actors[activeControlledActorId].runtime.resources.action ?? 0) < 1}
                onClick={() => {
                  try {
                    setSelectedActionId(null);
                    setSelectedActionChoices({});
                    setMovementMode(false);
                    setDancingLightsMoveGroupId(null);
                    applyIntent({type: 'detect_magic', actorId: activeControlledActorId}, () => revealCombatMagicAura({ state, actorId: activeControlledActorId }));
                  } catch (reason) {
                    setError(playerFacingSheetActionError(reason));
                  }
                }}
              >
                Проявить ауры · действие
              </button>
            </section>
          )}
        </div>
        <CombatLogPanel state={state} />
      </section>
      {inspectedActorId && state.world.actors[inspectedActorId] && (
        <CombatActorInspector state={state} actorId={inspectedActorId} onClose={() => setInspectedActorId(null)} />
      )}
      {sceneConstructorOpen && <CombatSceneConstructor
        state={state}
        busy={busy}
        onApply={apply}
        onAddCharacter={addSceneCharacter}
        onAddMonster={addSceneMonster}
        onClose={() => setSceneConstructorOpen(false)}
      />}
      <CombatHotbar onStand={() => { setMovementMode(false); applyIntent({type: 'stand', actorId: activeControlledActorId}, () => standActor(state, activeControlledActorId)); }} state={state} actorId={activeControlledActorId} selectedActionId={selectedActionId} movementMode={movementMode} disabled={!playerTurn || Boolean(state.pendingAdditionalMovement) || busy || Boolean(pending) || Boolean(pendingTriggered) || Boolean(pendingTurnStart) || Boolean(state.pendingAlertSwapActorIds?.length) || Boolean(state.pendingInterception) || Boolean(pendingD20Interrupt) || state.outcome !== 'active'} onAction={(action) => { void chooseAction(action); }} onMove={() => { setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null); setMovementMode((value) => !value); }} onEndTurn={() => { setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null); applyIntent({type: 'end_turn', actorId: activeControlledActorId}, () => advanceTurn(state)); }} onSheet={() => {
        if (isControlledCharacter(state, activeControlledActorId)) {
          setSheetActorId(activeControlledActorId);
          setSheetOpen(true);
        } else {
          setInspectedActorId(activeControlledActorId);
        }
      }} />
      {sheetOpen && (() => {
        const drawerActorId = sheetActorId && isControlledCharacter(state, sheetActorId)
          ? sheetActorId
          : activeControlledActorId;
        const drawerCharacter = participantCharacters[drawerActorId] ?? character;
        const drawerActor = state.world.actors[drawerActorId];
        return <aside className="combat-sheet-drawer"><button type="button" className="combat-sheet-drawer__close" onClick={() => setSheetOpen(false)} aria-label="Закрыть"><X /></button><header><h2>{drawerActor.name}</h2><p>Уровень {drawerCharacter.level} · КЗ {effectiveArmorClass(drawerActor)} · скорость {effectiveActorSpeedFt(drawerActor)} фт.</p></header><CombatCharacterSidebar
          character={drawerCharacter}
          state={state}
          actorId={drawerActorId}
          remoteManipulatorDisabled={!playerTurn || busy || drawerActorId !== activeControlledActorId}
          onRemoteManipulator={(command) => {
            applyIntent({type: 'remote_manipulator', actorId: drawerActorId, command}, () => executeCombatRemoteManipulator({state, actorId: drawerActorId, command}));
          }}
          boonDisabled={!playerTurn || busy || drawerActorId !== activeControlledActorId}
          onActivateBoon={(effectId, rollKind, timing) => {
            applyIntent({type: 'boon', actorId: drawerActorId, effectId, rollKind, timing}, () => activateCombatBoon(state, drawerActorId, effectId, rollKind, timing));
          }}
        /><Link className="combat-sheet-drawer__full" target="_blank" to={`/characters-v3/${drawerActorId}`}>Открыть полный лист ↗</Link></aside>;
      })()}
      {reactionOptions.length > 0 && <div className="combat-reaction-backdrop"><section aria-label={reactionTitle}>
        <p>{pending?.type === 'attack_reaction' && pending.attackAdjustment ? 'ПРИЁМ' : 'РЕАКЦИЯ'}</p><h2>{reactionTitle}</h2>{pending?.type === 'damage_reaction' && <p>{state.world.actors[pending.request.actorId]?.name} · Цель: {state.world.actors[pending.targetActorId]?.name}</p>}{reactionDetails && <p>{reactionDetails}</p>}
        <div className="combat-reaction-actions">{reactionOptions.map(option => {
          const presentation = state.actionPresentation?.[option.response.actionId ?? ''];
          return <SheetActionLine key={option.id} name={option.label}
            imageUrl={presentation?.imageUrl} description={presentation?.description}
            actionRef={presentation?.actionRef} spellRef={presentation?.spellRef}
            sourceLabel={pending ? state.world.actors[pending.request.actorId]?.name : undefined}
            disabled={busy} onActivate={() => applyIntent({type: 'reaction', response: option.response}, () => resolvePlayerReaction(state, option.response))} />;
        })}</div>
        <button type="button" disabled={busy} onClick={() => applyIntent({type: 'reaction', response: {kind: 'reaction', actionId: null}}, () => resolvePlayerReaction(state, { kind: 'reaction', actionId: null }))}>Пропустить</button>
      </section></div>}

      {controlledSavePending && <div className="combat-reaction-backdrop"><section>
        <SheetPendingCombatPanel
          systemRollsOnly={Boolean(trustedRunRef.current)}
          pending={controlledSavePending}
          viewingCharacterId={controlledSavePending.request.actorId}
          actorNames={Object.fromEntries(Object.values(state.world.actors).map((entry) => [entry.id, entry.name]))}
          decidingRuntime={state.world.actors[controlledSavePending.request.actorId].runtime}
          busy={busy}
          onResolve={(response) => {
            if (response.kind === 'shove_outcome') applyIntent({type: 'shove_outcome', outcome: response.outcome}, () => resolvePlayerShoveOutcome(state, response.outcome));
            if (response.kind === 'roll') applyIntent({type: 'saving_throw', selectedAbility: response.selectedAbility, boonEffectId: response.boonEffectId}, () => resolvePlayerSavingThrow(state, response));
          }}
        />
      </section></div>}
      {state.pendingAlertSwapActorIds?.length ? (() => {
        const alertActorId = state.pendingAlertSwapActorIds[0];
        const alertActor = state.world.actors[alertActorId];
        const allies = controlledCharacterIds(state).filter((actorId) => actorId !== alertActorId);
        return <div className="combat-reaction-backdrop"><section><p>БДИТЕЛЬНЫЙ</p><h2>{alertActor.name}: обменять инициативу?</h2><p>Сразу после броска инициативы можно обменяться местами с согласным союзником. Итоговые значения не меняются.</p><div>{allies.map((allyId) => <button type="button" key={allyId} disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: allyId}, () => resolveSoloCombatAlertSwap(state, alertActorId, allyId))}>Обменяться с {state.world.actors[allyId].name}</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: null}, () => resolveSoloCombatAlertSwap(state, alertActorId, null))}>Оставить порядок</button></div></section></div>;
      })() : null}
      {state.pendingInterception ? <div className="combat-reaction-backdrop"><section><p>РЕАКЦИЯ</p><h2>Перехватить удар по {state.world.actors[state.pendingInterception.targetActorId].name}?</h2><p>Входящий урон: {state.pendingInterception.incomingDamage}. Перехват снизит его на 1к10 + Бонус владения и потратит реакцию.</p><div>{state.pendingInterception.interceptorActorIds.map((actorId) => <button type="button" key={actorId} disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: actorId}, () => resolveSoloCombatInterception(state, actorId))}>{state.world.actors[actorId].name} · использовать Перехват</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: null}, () => resolveSoloCombatInterception(state, null))}>Пропустить</button></div></section></div> : null}
      {pendingD20Interrupt ? <div className="combat-reaction-backdrop"><section><p>{pendingD20Interrupt.timing === 'before_roll' ? 'ДО БРОСКА АТАКИ' : 'ПОСЛЕ РЕЗУЛЬТАТА'}</p><h2>{pendingD20Interrupt.operation === 'impose_disadvantage' ? 'Наложить Помеху на бросок?' : 'Попытаться изменить успешный бросок?'}</h2>{pendingD20Interrupt.preview && <p>Показанный результат: {pendingD20Interrupt.preview.total} · {pendingD20Interrupt.preview.rollKind === 'attack_roll' ? 'попадание' : 'успех'}. Сохранённый бросок будет продолжен без переброса.</p>}<div>{pendingD20Interrupt.responders.map((responder) => <button type="button" key={`${responder.actorId}:${responder.effectId}`} disabled={busy} onClick={() => applyIntent({type: 'd20_interrupt', actorId: responder.actorId}, () => resolveD20Interrupt(state, responder.actorId))}>{state.world.actors[responder.actorId]?.name ?? responder.actorId} · {responder.effectName}</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null))}>Пропустить</button></div></section></div> : null}
      {!secondaryActionId && <CombatTriggeredActionPanel state={state} busy={busy} onChoose={resolveTriggeredChoice} />}
      {pendingTurnStart && <div className="combat-reaction-backdrop"><section><p>НАЧАЛО ХОДА</p><h2>Нанести 1к4 урона существу в захвате?</h2><div>{pendingTurnStart.targetActorIds.map((targetActorId) => <button type="button" key={targetActorId} disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: targetActorId}, () => resolveSoloCombatTurnStart(state, targetActorId))}>{state.world.actors[targetActorId]?.name ?? 'Цель'} · 1к4 дробящего урона</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: null}, () => resolveSoloCombatTurnStart(state, null))}>Пропустить</button></div></section></div>}
      {worldInputDialog.dialog}
      {shouldShowSoloCombatOutcome(state) && <div className="combat-outcome"><section><p>БОЙ ЗАВЕРШЁН</p><h1>{state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><p>{state.outcome === 'victory' ? 'Все противники уничтожены.' : `${character.name} потерял все хиты.`}</p><button type="button" disabled={busy} onClick={finish}>{roguelikeRunId ? 'Получить результат и вернуться в лагерь' : 'Завершить и вернуться в лист'}</button><button type="button" onClick={() => navigate(roguelikeRunId ? `/roguelike/${roguelikeRunId}` : `/characters-v3/${id}`)}><RotateCcw size={16} /> {roguelikeRunId ? 'Вернуться в забег' : 'Оставить запись боя'}</button></section></div>}
    </main>
  );
}
