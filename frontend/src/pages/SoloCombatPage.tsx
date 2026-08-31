import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { actionsApi, effectsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import { sheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import type { ForgeCharacter } from '../character/types';
import CombatHotbar from '../components/CombatHotbar';
import CombatActorInspector from '../components/CombatActorInspector';
import CombatCharacterSidebar from '../components/CombatCharacterSidebar';
import CombatLogPanel from '../components/CombatLogPanel';
import CombatSceneConstructor from '../components/CombatSceneConstructor';
import MonsterTurnController from '../components/MonsterTurnController';
import { sheetReactionDecisionOptions } from '../components/SheetPendingCombatPanel';
import TacticalBattleMap from '../components/TacticalBattleMap';
import { useSheetWorldInputDialog } from '../components/SheetWorldInputDialog';
import { monstersApi } from '../monsters/api';
import {
  activeActor,
  addSoloCombatCharacter,
  addSoloCombatMonster,
  advanceTurn,
  autoResolveSystemDecisions,
  combatDetectMagicStatus,
  createSoloCombatState,
  executeCombatAction,
  executeCombatRemoteManipulator,
  moveCombatDancingLights,
  moveActor,
  revealCombatMagicAura,
  resolvePlayerReaction,
  resolveSoloCombatTurnStart,
  resolveTriggeredCombatAction,
  selectedTargetsForAction,
} from '../solo-combat/engine';
import {
  readSoloCombatState,
  rebaseSoloCombatParticipantRuntimeRevisions,
} from '../solo-combat/persistence';
import { writeDedicatedCombatTurnState } from '../solo-combat/turnState';
import {
  controlledCharacterIds,
  isControlledCharacter,
  type GridPosition,
  type SoloCombatState,
} from '../solo-combat/types';
import {
  collectSoloCombatActionChoices,
  immediateSoloCombatTargetIds,
} from '../solo-combat/actionChoices';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { getCardsIndex } from '../utils/cardsIndex';
import { gridDistanceFt } from '../solo-combat/tacticalGrid';
import type { ActionWorldInput } from '../rules-core/domain';
import { bindCombatWorldInputFacts } from '../solo-combat/worldInput';
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
  return `${entry.die}${entry.bonus >= 0 ? '+' : ''}${entry.bonus} = ${entry.total}`;
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
  const choiceDialog = useChoiceDialog();
  const worldInputDialog = useSheetWorldInputDialog();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [participantCharacters, setParticipantCharacters] = useState<Record<string, ForgeCharacter>>({});
  const participantCharactersRef = useRef<Record<string, ForgeCharacter>>({});
  const characterRef = useRef<ForgeCharacter | null>(null);
  const [state, setState] = useState<SoloCombatState | null>(null);
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
      });
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
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const loadedCharacter = await charactersV3Api.get(id);
        if (!active) return;
        characterRef.current = loadedCharacter;
        setCharacter(loadedCharacter);
        participantCharactersRef.current = { [loadedCharacter.id]: loadedCharacter };
        setParticipantCharacters(participantCharactersRef.current);
        const requested = initialRequestedRef.current;
        if (!requested.length) {
          const restored = readSoloCombatState(
            loadedCharacter.turn_state, id, Number(loadedCharacter.runtime_revision ?? 0),
          );
          if (!restored) throw new Error('Сохранённый бой не найден. Запустите проверку из листа персонажа.');
          const allyIds = controlledCharacterIds(restored).filter((actorId) => actorId !== loadedCharacter.id);
          const allyRows = await Promise.all(allyIds.map((allyId) => charactersV3Api.get(allyId)));
          const loadedRows = [loadedCharacter, ...allyRows];
          participantCharactersRef.current = Object.fromEntries(
            loadedRows.map((row) => [row.id, row]),
          );
          setParticipantCharacters(participantCharactersRef.current);
          setState(rebaseSoloCombatParticipantRuntimeRevisions(
            restored,
            Object.fromEntries(loadedRows.map((row) => [
              row.id,
              Number(row.runtime_revision ?? 0),
            ])),
          ));
          setBusy(false); return;
        }
        const [monsters, allyCharacters] = await Promise.all([
          Promise.all(requested.map(({ id: monsterId }) => monstersApi.get(monsterId))),
          Promise.all(initialAlliesRef.current.map((allyId) => charactersV3Api.get(allyId))),
        ]);
        if (allyCharacters.some((ally) => ally.user_id !== loadedCharacter.user_id)) {
          throw new Error('Союзник должен принадлежать тому же пользователю');
        }
        const actionIds = [...new Set(monsters.flatMap((monster) => monster.action_ids))];
        const effectIds = [...new Set(monsters.flatMap((monster) => monster.effect_ids))];
        const [actionRows, effectRows, basicResponse, cards] = await Promise.all([
          Promise.all(actionIds.map((actionId) => actionsApi.getAction(actionId))),
          Promise.all(effectIds.map((effectId) => effectsApi.getEffect(effectId))),
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
        navigate(`/characters-v3/${id}/combat`, { replace: true });
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : 'Не удалось начать бой'); setBusy(false); }
      }
    })();
    return () => { active = false; };
  }, [id, navigate, persist]);

  const apply = useCallback((next: SoloCombatState) => {
    setError(null);
    void persist(next).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить ход'));
  }, [persist]);

  const activeControlledActorId = state && isControlledCharacter(state, activeActor(state).id)
    ? activeActor(state).id
    : state?.characterId ?? '';
  const playerTurn = state ? isControlledCharacter(state, activeActor(state).id) : false;
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
      const immediateTargets = immediateSoloCombatTargetIds(action, activeControlledActorId);
      if (immediateTargets) {
        apply(autoResolveSystemDecisions(executeCombatAction({
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
    if (!state || !playerTurn || busy || state.world.pendingResolution
      || state.pendingTriggeredAction || state.pendingTurnStartGrappleDamage) return;
    try {
      if (movementMode) {
        if (actorId) throw new Error('Для перемещения выберите свободную клетку');
        const next = moveActor({ state, actorId: activeControlledActorId, destination: position, voluntary: true });
        setMovementMode(false); setSelectedActionChoices({}); apply(next); return;
      }
      if (dancingLightsMoveGroupId) {
        if (dancingLightsMoveGroupId !== activeDancingLightsGroup) {
          setDancingLightsMoveGroupId(null);
          throw new Error('Активные Танцующие огоньки не найдены.');
        }
        const next = moveCombatDancingLights({
          state,
          actorId: activeControlledActorId,
          groupId: dancingLightsMoveGroupId,
          destination: position,
        });
        setDancingLightsMoveGroupId(null);
        setSelectedActionChoices({});
        apply(next);
        return;
      }
      if (!selectedActionId) return;
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
        worldInput = bindCombatWorldInputFacts(result.worldInput, {
          factsSource: 'board',
          boardRevision: state.boardRevision,
          distanceFt,
          lineOfSight: true,
        });
      }
      const next = autoResolveSystemDecisions(executeCombatAction({
        state,
        actorId: activeControlledActorId,
        actionId: selectedActionId,
        targetIds,
        worldPosition: position,
        worldInput,
        choices: selectedActionChoices,
      }));
      setSelectedActionId(null); setSelectedActionChoices({}); apply(next);
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
    return <main className="solo-combat-loading"><h1>Подготовка поля боя</h1><p>{error ?? 'Компилируем лист, монстров и инициативу…'}</p>{error && <Link to={`/characters-v3/${id}`}>Вернуться в лист</Link>}</main>;
  }
  const actor = activeActor(state);
  const pending = state.world.pendingResolution;
  const pendingTriggered = state.pendingTriggeredAction;
  const pendingTurnStart = state.pendingTurnStartGrappleDamage;
  const reactionOptions = pending?.request.type === 'reaction'
    && isControlledCharacter(state, pending.request.actorId)
    ? sheetReactionDecisionOptions(pending.request.options) : [];
  const reactionTitle = pending?.type === 'damage_reaction'
    ? 'Вам нанесен урон'
    : pending?.request.type === 'reaction'
      && pending.request.trigger.type === 'hit_by_attack'
      ? 'По вам попали'
      : 'Открыто окно реакции';
  const reactionDetails = pending?.type === 'damage_reaction'
    ? `Получено урона: ${pending.damage.reduce((sum, packet) => sum + packet.amount, 0)}${pending.damage.length
      ? ` · ${[...new Set(pending.damage.map((packet) => packet.damageType))].join(', ')}`
      : ''}`
    : null;
  return (
    <main className="solo-combat-page forge">
      <MonsterTurnController state={state} disabled={busy || Boolean(pendingTurnStart)} onTransition={apply} onError={setError} />
      <header className="combat-topbar">
        <div className="combat-topbar__navigation"><Link to={`/characters-v3/${id}`}><ArrowLeft size={18} /> Лист</Link><button type="button" onClick={() => setSceneConstructorOpen(true)}><SlidersHorizontal size={16} /> Сцена</button></div>
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
        <div className="combat-map-wrap">
          <TacticalBattleMap
            state={state}
            actorId={activeControlledActorId}
            selectedActionId={selectedActionId}
            movementMode={movementMode}
            worldObjectMoveMode={dancingLightsMoveGroupId === activeDancingLightsGroup}
            inspectedActorId={inspectedActorId}
            onCell={clickCell}
            onInspectActor={(actorId) => {
              if (isControlledCharacter(state, actorId)) {
                setSheetActorId(actorId);
                setSheetOpen(true);
                return;
              }
              setInspectedActorId((current) => current === actorId ? null : actorId);
            }}
          />
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
                    apply(revealCombatMagicAura({ state, actorId: activeControlledActorId }));
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
      <CombatHotbar state={state} actorId={activeControlledActorId} selectedActionId={selectedActionId} movementMode={movementMode} disabled={!playerTurn || busy || Boolean(pending) || Boolean(pendingTriggered) || Boolean(pendingTurnStart) || state.outcome !== 'active'} onAction={(action) => { void chooseAction(action); }} onMove={() => { setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null); setMovementMode((value) => !value); }} onEndTurn={() => { setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null); apply(advanceTurn(state)); }} onSheet={() => { setSheetActorId(activeControlledActorId); setSheetOpen(true); }} />
      {sheetOpen && (() => {
        const drawerActorId = sheetActorId && isControlledCharacter(state, sheetActorId)
          ? sheetActorId
          : activeControlledActorId;
        const drawerCharacter = participantCharacters[drawerActorId] ?? character;
        const drawerActor = state.world.actors[drawerActorId];
        return <aside className="combat-sheet-drawer"><button type="button" className="combat-sheet-drawer__close" onClick={() => setSheetOpen(false)} aria-label="Закрыть"><X /></button><header><h2>{drawerActor.name}</h2><p>Уровень {drawerCharacter.level} · КЗ {drawerActor.ac} · скорость {drawerCharacter.speed} фт.</p></header><CombatCharacterSidebar
          character={drawerCharacter}
          state={state}
          actorId={drawerActorId}
          remoteManipulatorDisabled={!playerTurn || busy || drawerActorId !== activeControlledActorId}
          onRemoteManipulator={(command) => {
            const next = executeCombatRemoteManipulator({ state, actorId: drawerActorId, command });
            apply(next);
          }}
        /><Link className="combat-sheet-drawer__full" target="_blank" to={`/characters-v3/${drawerActorId}`}>Открыть полный лист ↗</Link></aside>;
      })()}
      {reactionOptions.length > 0 && <div className="combat-reaction-backdrop"><section><p>РЕАКЦИЯ</p><h2>{reactionTitle}</h2>{reactionDetails && <p>{reactionDetails}</p>}<div>{reactionOptions.map((option) => <button type="button" key={option.id} disabled={busy} onClick={() => apply(resolvePlayerReaction(state, option.response))}>{option.label}</button>)}<button type="button" onClick={() => apply(resolvePlayerReaction(state, { kind: 'reaction', actionId: null }))}>Пропустить</button></div></section></div>}
      {pendingTriggered && <div className="combat-reaction-backdrop"><section><p>ПОПАДАНИЕ</p><h2>Применить дополнительную способность?</h2><div>{pendingTriggered.optionActionIds.map((actionId) => {
        const option = state.catalogActions.find((action) => action.id === actionId);
        return option ? <button type="button" key={actionId} disabled={busy} onClick={() => apply(resolveTriggeredCombatAction(state, actionId))}>{option.name}</button> : null;
      })}<button type="button" disabled={busy} onClick={() => apply(resolveTriggeredCombatAction(state, null))}>Пропустить</button></div></section></div>}
      {pendingTurnStart && <div className="combat-reaction-backdrop"><section><p>НАЧАЛО ХОДА</p><h2>Нанести 1к4 урона существу в захвате?</h2><div>{pendingTurnStart.targetActorIds.map((targetActorId) => <button type="button" key={targetActorId} disabled={busy} onClick={() => apply(resolveSoloCombatTurnStart(state, targetActorId))}>{state.world.actors[targetActorId]?.name ?? 'Цель'} · 1к4 дробящего урона</button>)}<button type="button" disabled={busy} onClick={() => apply(resolveSoloCombatTurnStart(state, null))}>Пропустить</button></div></section></div>}
      {worldInputDialog.dialog}
      {state.outcome !== 'active' && <div className="combat-outcome"><section><p>БОЙ ЗАВЕРШЁН</p><h1>{state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><p>{state.outcome === 'victory' ? 'Все противники уничтожены.' : `${character.name} потерял все хиты.`}</p><button type="button" onClick={finish}>Завершить и вернуться в лист</button><button type="button" onClick={() => navigate(`/characters-v3/${id}`)}><RotateCcw size={16} /> Оставить запись боя</button></section></div>}
    </main>
  );
}
