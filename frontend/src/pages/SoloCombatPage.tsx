import {actorHasConsciousVitality} from '../engine/lifePolicies';
import {maximumActorLongJumpFt} from '../solo-combat/jump';
import { combatActorDisplayName } from '../character/familiarLabels';
import {combatRollInfluences,resolveCombatDeathSave,finalizeCombatOutcome} from '../solo-combat/engine';
import {persistedRollPresentation} from '../solo-combat/persistedRollPresentation';
import RollInfluenceActions from '../components/RollInfluenceActions';
import {isLooseTelekineticObject, telekineticHeldObjects} from '../rules-core/telekineticMovement';
import {effectiveArmorClass} from '../rules-core/actorArmorClass';
import type {Action} from '../types';
import {availableCheckManeuvers, checkManeuverChoice} from '../character/checkManeuvers';
import SheetActionLine from '../components/SheetActionLine';
import { getDamageLabel } from '../utils/damageTypes';
import type { RoguelikeCombatIntent } from '../roguelike/combatWorker';
import type { RoguelikeRun } from '../roguelike/api';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {decisionOfferVisible, decisionPolicyToggles, offeredRollInfluences} from '../solo-combat/decisionPolicies';
import DecisionPolicyToggles from '../components/DecisionPolicyToggles';
import AttackRollEquation from '../components/AttackRollEquation';
import RollCalculationDetails from '../components/RollCalculationDetails';
import {previewAttackDefense} from '../rules-core/handler';
import {availableCombatSpellLevels} from '../solo-combat/spellCastChoices';
import {useSiteSettings} from '../settings';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { actionsApi, effectsApi, spellsApi, ApiRequestError } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import {
  runtimeInventoryPayload,
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';

function combatBootstrapError(reason: unknown): string {
  if (reason instanceof ApiRequestError) {
    return reason.code ? `${reason.code}: ${reason.message}` : reason.message;
  }
  return reason instanceof Error ? reason.message : 'Не удалось начать бой';
}
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import { sheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import {sheetCombatDeclarationPolicy} from '../character/sheetCombatDeclaration';
import type { ForgeCharacter } from '../character/types';
import CombatHotbar, { combatActionAvailability } from '../components/CombatHotbar';
import { WorkspaceExpandButton } from '../components/WorkspaceNavigation';
import CombatTriggeredActionPanel from '../components/CombatTriggeredActionPanel';
import CombatActorInspector from '../components/CombatActorInspector';
import CombatCharacterSidebar from '../components/CombatCharacterSidebar';
import CombatLogPanel from '../components/CombatLogPanel';
import CombatSceneConstructor from '../components/CombatSceneConstructor';
import MonsterTurnController from '../components/MonsterTurnController';
import SheetPendingCombatPanel, { sheetReactionDecisionOptions } from '../components/SheetPendingCombatPanel';
import TacticalBattleMap from '../components/TacticalBattleMap';
import CombatPresentationDialog from '../components/CombatPresentationDialog';
import CombatDeathSaveDialog from '../components/CombatDeathSaveDialog';
import CombatRewardDialog from '../components/CombatRewardDialog';
import SheetSettingsDialog from '../components/SheetSettingsDialog';
import { useCombatPresentation } from '../solo-combat/useCombatPresentation';
import {useAutomaticCombatDecision} from '../solo-combat/useAutomaticCombatDecision';
import {useAutomaticTurnStartAction} from '../solo-combat/useAutomaticTurnStartAction';
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
  approachAndExecuteCombatAction,
  executeCombatTouchSpellThroughFamiliar,
  executeCombatRemoteManipulator,
  moveCombatDancingLights,
  moveActorAlongRoute,
  selectCombatMovementMode,
  selectCombatFacing,
  executeConditionAction, escapeActorGrapple,
  refreshSoloCombatParticipants,
  revealCombatMagicAura,
  resolvePlayerReaction,
  resolvePlayerSlotRecovery, resolvePlayerActionCostPolicy, resolvePlayerShoveOutcome, resolvePlayerSavingThrow,
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
import {useCombatAudio} from '../audio/useCombatAudio';
import { writeDedicatedCombatTurnState } from '../solo-combat/turnState';
import {
  controlledCharacterIds,
  combatRelation,
  spatialFacts,
  isControlledCharacter,
  isPlayerControlledCombatActor,
  type GridPosition,
  type SoloCombatState,
} from '../solo-combat/types';
import {
  collectSoloCombatActionChoices,
  combatPassiveTogglesForAction,
  resolveCombatPassiveChoices,
  immediateSoloCombatTargetIds,
} from '../solo-combat/actionChoices';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { getCardsIndex } from '../utils/cardsIndex';
import { combatActorMovementMode, combatActorMovementSpeeds, effectiveActorSpeedFt, gridDistanceFt } from '../solo-combat/tacticalGrid';
import { combatActionForActor, combatActionIsAttack, combatApproachRoute, defaultCombatAttackAction,combatActionRangeFt } from '../solo-combat/defaultInteraction';
import { combatIdentity } from '../solo-combat/combatIdentity';
import { canonicalTouchSpell, familiarActorsOwnedBy } from '../rules-core/familiarRuntime';
import { familiarFormLabel } from '../character/familiarLabels';
import type { ActionWorldInput } from '../rules-core/domain';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { bindCombatWorldInputFacts } from '../solo-combat/worldInput';
import { roguelikeApi } from '../roguelike/api';
import { commandCombatInteraction } from '../roguelike/combatInteraction';
import { runEncounterSelection, runSheetURL,runCharacters,runHasCharacter } from '../roguelike/navigation';
import './CharacterForge.css';
import './CharacterSheetV2.css';
import './SoloCombatPage.css';

const FAMILIAR_TOUCH_DELIVERY_CHOICE_ID = 'combat_familiar_touch_delivery';
const MOVEMENT_MODE_CHOICE_ID = 'combat_movement_mode';
const movementModeLabels = {walk: 'Ходьба', climb: 'Лазание', fly: 'Полёт', swim: 'Плавание', burrow: 'Рытьё',jump:'Прыжок'} as const;
function hasManualTargetSlots(action:SoloCombatState['catalogActions'][number],castLevel?:number,actorLevel?:number):boolean {
  const targeting=action.mechanics.targeting as Record<string,unknown>|undefined;
  return Boolean(action.targeting&&sheetCombatDeclarationPolicy(action,castLevel,actorLevel).maxTargets>1)&&targeting?.domain!=='world'&&targeting?.actor_targets!==false
    &&targeting?.shape!=='area'&&targeting?.shape!=='self';
}


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
  const [monsterPortraits, setMonsterPortraits] = useState<Record<string, string>>({});
  const monsterTemplateKey = [...new Set(Object.values(state?.tokens ?? {}).flatMap(token => token.templateId ? [token.templateId] : []))].sort().join('|');
  useEffect(() => {
    if (!monsterTemplateKey) { setMonsterPortraits({}); return; }
    let live = true;
    Promise.all(monsterTemplateKey.split('|').map(async templateId => {
      try { return [templateId, (await monstersApi.get(templateId)).token_url] as const; }
      catch { return [templateId, ''] as const; }
    })).then(rows => {
      if (live) setMonsterPortraits(Object.fromEntries(rows.filter((row): row is readonly [string, string] => Boolean(row[1]))));
    });
    return () => { live = false; };
  }, [monsterTemplateKey]);
  const [openingState, setOpeningState] = useState<SoloCombatState | null>(null);
  const [rewardRun, setRewardRun] = useState<RoguelikeRun | null>(null);
  const [rewardTransitionFailed, setRewardTransitionFailed] = useState(false);
  const autoRewardStartedRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logHidden, setLogHidden] = useState(true);
  const presentation = useCombatPresentation(state, openingState);
  useCombatAudio(state,presentation.playing,presentation.initiative,presentation.blocked);
  const presentationBlockedRef = useRef(false);
  presentationBlockedRef.current = presentation.blocked;
  const [secondaryActionId, setSecondaryActionId] = useState<string | null>(null);
  const [selectedMovementTargetId, setSelectedMovementTargetId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedActionChoices, setSelectedActionChoices] = useState<Record<string, string[]>>({});
  const [selectedMultiTargetIds,setSelectedMultiTargetIds]=useState<string[]>([]);
  const [selectedMissileDarts,setSelectedMissileDarts]=useState<Record<string,number>>({});
  const [movementMode, setMovementMode] = useState(false);
  const [dancingLightsMoveGroupId, setDancingLightsMoveGroupId] = useState<string | null>(null);
  const [inspectedActorId, setInspectedActorId] = useState<string | null>(null);
  const [hoveredActorId, setHoveredActorId] = useState<string | null>(null);
  const hoveredActorIdRef = useRef<string | null>(null);
  const setCombatHoveredActorId = useCallback((actorId: string | null) => {
    // Keyboard inspection may follow pointer entry in the same frame. Keep a
    // synchronous authority so the key handler never waits for React state.
    hoveredActorIdRef.current = actorId;
    setHoveredActorId(actorId);
  }, []);
  const [combatPassiveEnabled, setCombatPassive] = usePassivePreferences();
  const siteSettings = useSiteSettings();
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
    next = finalizeCombatOutcome(next);
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
        if (loadedRun && loadedRun.character_id !== id) {
          throw new Error('Этот лист не участвует в активной встрече забега');
        }
        if (!active) return;
        if (loadedRun && loadedRun.phase !== 'combat') {
          navigate(`/roguelike/${loadedRun.id}`); return;
        }
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
          participantCharactersRef.current = Object.fromEntries(runCharacters(accepted).map(c=>[c.id,c]));
          setParticipantCharacters(participantCharactersRef.current);
          if (!loadedRun.combat_state) setOpeningState(accepted.combat_opening_state ?? accepted.combat_state);
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
        setOpeningState(created);
        setState(created);
        await persist(created);
        initialRequestedRef.current = [];
        initialAlliesRef.current = [];
        navigate(
          `/characters-v3/${id}/combat${roguelikeRunId ? `?roguelike=${encodeURIComponent(roguelikeRunId)}` : ''}`,
          { replace: true },
        );
      } catch (reason) {
        if (active) {
          setStaleRulesSnapshot(isIncompatibleCombatRulesError(reason));
          setError(combatBootstrapError(reason)); setBusy(false);
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
    // An open held-roll dialog owns this continuation. Cosmetic map feedback
    // must not swallow its decision; the engine still validates the pending id.
    if (presentationBlockedRef.current && intent.type !== 'd20_interrupt' && intent.type !== 'death_save') return;
    const run = trustedRunRef.current;
    if (!run) {
      try { apply(resumePendingMovement(local())); }
      catch (reason) { setError(playerFacingSheetActionError(reason)); }
      return;
    }
    if (trustedBusyRef.current) return;
    trustedBusyRef.current = true;
    setBusy(true); setError(null);
    void commandCombatInteraction(run, intent, (current, command) =>
      roguelikeApi.command(current.id, current.revision, 'combat_intent', {intent: command})).then(accepted => {
      if (!accepted.combat_state || !accepted.character) throw new Error('Сервер не вернул состояние боя');
      trustedRunRef.current = accepted;
      characterRef.current = accepted.character;
      setCharacter(accepted.character);
      participantCharactersRef.current = Object.fromEntries(runCharacters(accepted).map(c=>[c.id,c]));
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
          participantCharactersRef.current = Object.fromEntries(runCharacters(current).map(c=>[c.id,c]));
          setParticipantCharacters(participantCharactersRef.current);
          setState(current.combat_state);
        }
      } catch { /* Keep the last confirmed state; revision checks prevent overwrite. */ }
      setError(playerFacingSheetActionError(reason));
    }).finally(() => {
      trustedBusyRef.current = false; setBusy(false);
    });
  }, [apply]);

  const heldDecision = persistedRollPresentation(state?.pendingD20Interrupt);
  const rollInfluencePolicies=decisionPolicyToggles('roll_influence');
  const influenceOfferVisible = decisionOfferVisible(rollInfluencePolicies,
    combatPassiveEnabled, {roll: heldDecision?.held?.roll});
  const availableHeldInfluences=state&&heldDecision?.held
    ? combatRollInfluences(state,heldDecision.command.actorId,heldDecision.held.kind,heldDecision.held.roll,heldDecision.influenceContext):[];
  const offeredHeldInfluences=heldDecision?.held
    ? offeredRollInfluences(availableHeldInfluences,rollInfluencePolicies,combatPassiveEnabled,heldDecision.held.kind):[];
  const policyReactionOptions = useMemo(() => {
    const pending = state?.world.pendingResolution;
    if (!state || pending?.request.type !== 'reaction' || !isControlledCharacter(state, pending.request.actorId)) return [];
    return sheetReactionDecisionOptions(pending.request.options).map(option => {
      const action = state.catalogActions.find(row => row.id === option.response.actionId);
      const toggles = action ? decisionPolicyToggles('reaction', action) : [];
      const preview = action && toggles.length && pending.type === 'attack_reaction' && !pending.attackAdjustment
        ? previewAttackDefense(state.world.actors[pending.request.actorId], action, pending.attackRoll, option.response.spell)
        : undefined;
      return {...option, toggles, preview, visible: decisionOfferVisible(toggles, combatPassiveEnabled,
        {changesOutcome: preview?.changesOutcome})};
    });
  }, [state, combatPassiveEnabled]);
  // A provisional window is useful only when there is an actionable choice to
  // make. Continue stale/empty offers through the normal revision-checked
  // command so the saved roll proceeds to its confirmed presentation.
  const skipInfluence = Boolean(heldDecision?.held && (!influenceOfferVisible
    || offeredHeldInfluences.length===0));
  const skipReaction = policyReactionOptions.length > 0 && policyReactionOptions.every(option => !option.visible);
  useAutomaticCombatDecision(state, skipInfluence ? 'roll_influence' : skipReaction ? 'reaction' : null,
    busy || Boolean(error) || presentation.blocked, kind => {
    if (!state) return;
    // Only decline through the normal revision-checked command. Never pay or
    // simulate an authoritative outcome on the client; archived workers work too.
    try {
      if (kind === 'roll_influence') applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null));
      else applyIntent({type: 'reaction', response: {kind: 'reaction', actionId: null}},
        () => resolvePlayerReaction(state, {kind: 'reaction', actionId: null}));
    } catch (reason) { setError(playerFacingSheetActionError(reason)); }
  });

  const requestSpellCastLevel = async (action: SoloCombatState['catalogActions'][number], actorId: string): Promise<Record<string, string[]> | null> => {
    if (!state || action.kind !== 'spell' || action.spell.level === 0 || !state.world.actors[actorId].spellcastingAccess) return {};
    const levels = availableCombatSpellLevels(state.world.actors[actorId], action);
    if (!levels.length) throw new Error(`Для «${action.name}» нет доступной ячейки или свободного использования`);
    if (levels.length === 1) return {spell_cast_level: [String(levels[0])]};
    return choiceDialog.request([{id: 'spell_cast_level', prompt: 'На каком уровне наложить заклинание?', count: 1,
      source: 'explicit', context: 'in_play', origin: {kind: 'other', id: action.id, name: action.name},
      items: levels.map(level => ({id: String(level), name: `${level}-й уровень`}))}], action.name);
  };

  const resolveTriggeredChoice = async (actionId: string | null) => {
    if (!state?.pendingTriggeredAction || busy) return;
    try {
      const action = state.catalogActions.find(candidate => candidate.id === actionId);
      const spellLevelChoice = action ? await requestSpellCastLevel(action, state.pendingTriggeredAction.sourceActorId) : {};
      if (!spellLevelChoice) return;
      const required = action ? collectSoloCombatActionChoices(
        state.world.actors[state.pendingTriggeredAction.sourceActorId], action,
        state.actionPresentation?.[action.id]?.actionRef?.card_number,
        state.world.actors[state.pendingTriggeredAction.targetIds[0]],
        state.world,
      ) : [];
      const toggles = action ? combatPassiveTogglesForAction(
        state.world.actors[state.pendingTriggeredAction.sourceActorId], action,
        state.actionPresentation?.[action.id]?.actionRef?.card_number,
      ) : [];
      const passiveChoices = resolveCombatPassiveChoices(required, toggles, combatPassiveEnabled);
      const manualChoices = passiveChoices.pending.length
        ? await choiceDialog.request(passiveChoices.pending, action!.name) : {};
      if (!manualChoices) return;
      const choices = {...spellLevelChoice, ...passiveChoices.automatic, ...manualChoices};
      if (action && triggeredSecondaryTargetIds(state, action.id).length) {
        setSelectedActionId(null); setMovementMode(false); setSelectedActionChoices(choices);
        setSecondaryActionId(action.id); return;
      }
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
  const playerTurn = state ? isPlayerControlledCombatActor(state, activeActor(state).id) && actorHasConsciousVitality(activeActor(state)) && !state.pendingDeathSave : false;
  useAutomaticTurnStartAction(state,combatPassiveEnabled,busy||Boolean(error)||presentation.blocked||!playerTurn,
    (actorId,actionId)=>{
      if(!state)return;
      applyIntent(state.conditionActionSchemaVersion===1?{type:'condition_action',actorId,actionId}:{type:'stand',actorId},
        ()=>executeConditionAction(state,actorId,actionId));
    });
  const deathResumeKey=useRef<string|null>(null);
  useEffect(()=>{
    if(!state||state.deathSavesVersion!==1||state.outcome!=='active'||busy||error||presentation.blocked
      ||state.pendingDeathSave||state.world.pendingResolution||state.pendingD20Interrupt
      ||!isPlayerControlledCombatActor(state,activeActor(state).id)||activeActor(state).runtime.hp.current>0)return;
    const key=`${state.world.id}:${state.world.revision}`;
    if(deathResumeKey.current===key)return;
    deathResumeKey.current=key;
    applyIntent({type:'resume'},()=>autoResolveSystemDecisions(state));
  },[state,busy,error,presentation.blocked,applyIntent]);
  useEffect(() => {
    const inspectHoveredEnemy = (event: KeyboardEvent) => {
      const hoveredId = hoveredActorIdRef.current;
      if (!state || !hoveredId || !['i', 'ш'].includes(event.key.toLocaleLowerCase('ru-RU'))) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (combatRelation(state, activeControlledActorId, hoveredId) !== 'enemy') return;
      event.preventDefault();
      setInspectedActorId(hoveredId);
    };
    window.addEventListener('keydown', inspectHoveredEnemy);
    return () => window.removeEventListener('keydown', inspectHoveredEnemy);
  }, [activeControlledActorId, state]);


  const requestCombatChoices = async (
    action: SoloCombatState['catalogActions'][number],
    targetActorId?: string,
  ): Promise<Record<string, string[]> | null> => {
    if (!state) return null;
    const actor = state.world.actors[activeControlledActorId];
    const cardNumber = state.actionPresentation?.[action.id]?.actionRef?.card_number;
    const required = collectSoloCombatActionChoices(
      actor, action, cardNumber,
      targetActorId ? state.world.actors[targetActorId] : undefined,
      state.world,
    );
    const toggles = combatPassiveTogglesForAction(actor, action, cardNumber);
    const {automatic, pending} = resolveCombatPassiveChoices(required, toggles, combatPassiveEnabled);
    const manual = pending.length ? await choiceDialog.request(pending, action.name) : {};
    return manual ? {...automatic, ...manual} : null;
  };
  const chooseEscapeGrapple = async () => {
    if (!state || busy) return;
    const grapples = Object.values(state.world.grapples).filter(grapple => grapple.targetActorId === activeControlledActorId);
    if (!grapples.length) return;
    try {
      const origin = {kind: 'other' as const, id: 'escape-grapple', name: 'Освобождение из захвата'};
      const selection = await choiceDialog.request([
        ...(grapples.length > 1 ? [{id: 'escape_grapple', prompt: 'Из какого захвата освободиться?', count: 1,
          source: 'explicit' as const, context: 'in_play' as const, origin,
          items: grapples.map(grapple => ({id: grapple.id, name: state.world.actors[grapple.grapplerActorId]?.name ?? 'Противник'})),
        }] : []),
        {id: 'escape_skill', prompt: 'Как освободиться?', count: 1, source: 'explicit' as const, context: 'in_play' as const, origin,
          items: [{id: 'athletics', name: 'Атлетика (Сила)'}, {id: 'acrobatics', name: 'Акробатика (Ловкость)'}]},
      ], 'Освобождение из захвата');
      if (!selection) return;
      const grappleId = grapples.length === 1 ? grapples[0].id : selection.escape_grapple?.[0];
      const skill = selection.escape_skill?.[0];
      if (!grappleId || (skill !== 'athletics' && skill !== 'acrobatics')) return;
      setMovementMode(false); setSelectedActionId(null); setSelectedActionChoices({});
      applyIntent({type: 'escape_grapple', actorId: activeControlledActorId, grappleId, skill},
        () => escapeActorGrapple(state, activeControlledActorId, grappleId, skill));
    } catch (reason) { setError(playerFacingSheetActionError(reason)); }
  };
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
    setSelectedMultiTargetIds([]);setSelectedMissileDarts({});
    if (wasSelected) return;
    try {
      const actor = state.world.actors[activeControlledActorId];
      const spellLevelChoice = await requestSpellCastLevel(action, activeControlledActorId);
      if (!spellLevelChoice) return;
      const variantIds=action.kind==='spell'?action.mechanics.spell_variant_ids:action.mechanics.action_variant_ids;
      if(Array.isArray(variantIds)&&variantIds.length){
        if(variantIds.some(id=>typeof id!=='string'))throw Error('Некорректные варианты заклинания');
        const scope=action.id.startsWith(action.sourceEntityIds[0])?action.id.slice(action.sourceEntityIds[0].length):'';
        const variants=variantIds.map(id=>state.catalogActions.find(candidate=>candidate.id===`${id}${scope}`)
          ??state.catalogActions.find(candidate=>candidate.id===id));
        if(variants.some(candidate=>candidate?.kind!==action.kind))throw Error('Варианты отсутствуют в боевом каталоге');
        const previewEntities=await Promise.all(variantIds.map(id=>action.kind==='spell'?spellsApi.getSpell(id as string):actionsApi.getAction(id as string)));
        const variantChoiceId=action.kind==='spell'?'spell_variant':'action_variant';
        const picked=await choiceDialog.request([{id:variantChoiceId,prompt:action.kind==='spell'?'Выберите вариант заклинания':'Выберите вариант действия',count:1,source:'explicit',context:'in_play',
          origin:{kind:'other',id:action.id,name:action.name},items:variants.map((candidate,index)=>({id:candidate!.id,name:candidate!.name,
            ...(action.kind==='spell'?{previewSpell:previewEntities[index] as import('../types').Spell}:{previewAction:previewEntities[index] as Action})}))}],action.name);
        if(!picked)return;
        const selected=variants.find(candidate=>candidate?.id===picked[variantChoiceId]?.[0]);
        if(!selected)throw Error('Выбранный вариант недоступен');
        action=selected;
      }
      const familiarDeliveryChoices = canonicalTouchSpell(action)
        ? familiarActorsOwnedBy(state.world, activeControlledActorId).filter((familiar) => (
          familiar.familiarState?.presence === 'present'
            && familiar.familiarState.reactionAvailable
            && Boolean(state.tokens[familiar.id])
        ))
        : [];
      const cardNumber = state.actionPresentation?.[action.id]?.actionRef?.card_number;
      const baseChoices = collectSoloCombatActionChoices(
        state.world.actors[activeControlledActorId],
        action,
        cardNumber,
        undefined, state.world,
      );
      const passiveChoices = resolveCombatPassiveChoices(
        baseChoices,
        combatPassiveTogglesForAction(actor, action, cardNumber),
        combatPassiveEnabled,
      );
      const requiredChoices = [
        ...passiveChoices.pending,
        ...(familiarDeliveryChoices.length ? [{
          id: FAMILIAR_TOUCH_DELIVERY_CHOICE_ID,
          prompt: 'Откуда доставить контактное заклинание?',
          count: 1,
          source: 'explicit' as const,
          context: 'in_play' as const,
          origin: {kind: 'other' as const, id: action.id, name: action.name},
          items: [
            {id: 'self', name: 'Самостоятельно'},
            ...familiarDeliveryChoices.map((familiar) => ({
              id: familiar.id,
              name: `Через фамильяра: ${familiarFormLabel(familiar.familiarState!.form.id)}`,
            })),
          ],
          recommended: ['self'],
        }] : []),
      ];
      const selectedChoices = requiredChoices.length
        ? await choiceDialog.request(requiredChoices, action.name)
        : {};
      if (!selectedChoices) return;
      const choices = {...spellLevelChoice,...passiveChoices.automatic, ...selectedChoices};
      const immediateTargets = immediateSoloCombatTargetIds(action, activeControlledActorId, state);
      if (immediateTargets) {
        const familiarActorId = choices[FAMILIAR_TOUCH_DELIVERY_CHOICE_ID]?.[0];
        const actionChoices = Object.fromEntries(Object.entries(choices).filter(([key]) => key !== FAMILIAR_TOUCH_DELIVERY_CHOICE_ID));
        if (familiarActorId && familiarActorId !== 'self') {
          if (immediateTargets.length !== 1) throw new Error('Контактное заклинание через фамильяра требует одну цель');
          applyIntent({type: 'familiar_touch', actorId: activeControlledActorId, familiarActorId,
            spellActionId: action.id, targetActorId: immediateTargets[0], choices: actionChoices},
          () => autoResolveSystemDecisions(executeCombatTouchSpellThroughFamiliar({
            state, ownerActorId: activeControlledActorId, familiarActorId,
            actionId: action.id, targetActorId: immediateTargets[0], choices: actionChoices,
          })));
          return;
        }
        applyIntent({type: 'action', actorId: activeControlledActorId, actionId: action.id, targetIds: immediateTargets, choices: actionChoices}, () => autoResolveSystemDecisions(executeCombatAction({
          state,
          actorId: activeControlledActorId,
          actionId: action.id,
          targetIds: immediateTargets,
          choices: actionChoices,
        })));
        return;
      }
      setSelectedActionId(action.id);
      setSelectedActionChoices(choices);
    } catch (reason) { setError(playerFacingSheetActionError(reason)); }
  };

  const confirmMultipleTargets=()=>{
    if(!state||!selectedActionId||busy)return;
    const template=state.catalogActions.find(candidate=>candidate.id===selectedActionId);
    const action=template&&combatActionForActor(state,activeControlledActorId,template);
    if(!action||!hasManualTargetSlots(action,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level))return;
    try{
      const policy=sheetCombatDeclarationPolicy(action,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level);
      if(selectedMultiTargetIds.length<policy.minTargets||selectedMultiTargetIds.length>policy.maxTargets)
        throw Error(`Выберите от ${policy.minTargets} до ${policy.maxTargets} целей`);
      const choices={...selectedActionChoices};
      if(policy.dartCount!==undefined){
        const allocated=selectedMultiTargetIds.reduce((sum,id)=>sum+(selectedMissileDarts[id]??0),0);
        if(allocated!==policy.dartCount)throw Error(`Распределите ровно ${policy.dartCount} дротика(ов)`);
        choices[policy.allocationChoiceId!]=selectedMultiTargetIds.flatMap(id=>Array(selectedMissileDarts[id]).fill(id) as string[]);
      }
      const targetIds=[...selectedMultiTargetIds];
      const next=()=>autoResolveSystemDecisions(executeCombatAction({state,actorId:activeControlledActorId,actionId:action.id,targetIds,choices}));
      applyIntent({type:'action',actorId:activeControlledActorId,actionId:action.id,targetIds,choices},next);
      setSelectedActionId(null);setSelectedActionChoices({});setSelectedMultiTargetIds([]);setSelectedMissileDarts({});
    }catch(reason){setError(playerFacingSheetActionError(reason));}
  };

  const clickCell = async (position: GridPosition, actorId?: string) => {
    if (presentationBlockedRef.current) return;
    if (state?.pendingTriggeredAction && secondaryActionId && !busy) {
      if (!actorId || !triggeredSecondaryTargetIds(state, secondaryActionId).includes(actorId)) {
        setError(state.pendingTriggeredAction.event === 'commanded_attack' ? 'Выберите доступную цель атаки союзника' : 'Выберите другую цель в 5 футах от первой и в досягаемости атаки'); return;
      }
      const targetIds = [actorId];
      try {
        applyIntent({type: 'triggered_action', actionId: secondaryActionId, targetIds, choices: selectedActionChoices}, () => autoResolveSystemDecisions(
          resolveTriggeredCombatAction(state, secondaryActionId, Math.random, selectedActionChoices, targetIds),
        ));
        setSecondaryActionId(null); setSelectedActionChoices({});
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
      if (!selectedActionId) {
        if (!actorId) {
          applyIntent({type: 'move', actorId: activeControlledActorId, destination: position},
            () => moveActorAlongRoute({state, actorId: activeControlledActorId, destination: position}));
          return;
        }
        if (combatRelation(state, activeControlledActorId, actorId) !== 'enemy') return;
        if (!actorHasConsciousVitality(state.world.actors[actorId])) return;
        const action = defaultCombatAttackAction(state, activeControlledActorId);
        if (!action) throw new Error('Нет доступной атаки оружием или безоружного удара');
        const availability = combatActionAvailability(state, action, activeControlledActorId);
        if (!availability.enabled) throw new Error(availability.reason ?? 'Атака сейчас недоступна');
        const route = combatApproachRoute(state, activeControlledActorId, actorId, combatActionRangeFt(state,activeControlledActorId,action));
        if (!route) throw new Error('На поле нет доступной точки для атаки');
        if (!route.available) throw new Error(`Для атаки нужно пройти ${route.costFt} фт., доступно ${route.availableFt} фт.`);
        const choices = await requestCombatChoices(action, actorId);
        if (!choices) return;
        applyIntent({
          type: 'approach_action', actorId: activeControlledActorId,
          actionId: action.id, targetActorId: actorId, choices,
        }, () => autoResolveSystemDecisions(approachAndExecuteCombatAction({
          state, actorId: activeControlledActorId, actionId: action.id,
          targetActorId: actorId, choices,
        })));
        return;
      }
      const selectedAction=combatActionForActor(state,activeControlledActorId,state.catalogActions.find(row=>row.id===selectedActionId)!);
      if (!actorId && combatActionIsAttack(state, selectedAction)
        && selectedAction.targeting?.maxTargets === 1
        && !combatWorldInputContext(state, activeControlledActorId, selectedAction)) {
        applyIntent({type: 'move', actorId: activeControlledActorId, destination: position},
          () => moveActorAlongRoute({state, actorId: activeControlledActorId, destination: position}));
        return;
      }
      if((selectedAction.mechanics.activation as Record<string,unknown>|undefined)?.telekinetic_movement===true){
        if(!selectedMovementTargetId){
          if (actorId && actorId !== activeControlledActorId && isControlledCharacter(state, actorId)) {
            setSelectedMovementTargetId(actorId); return;
          }
          const candidates = [...Object.values(state.world.objects), ...telekineticHeldObjects(state.world, activeControlledActorId).filter(object => !state.world.objects[object.id])];
          const objects = candidates.filter(object => {
            const point = state.worldObjectPositions?.[object.id];
            return (isLooseTelekineticObject(object) && point?.x === position.x && point?.y === position.y)
              || (actorId === activeControlledActorId && object.size === 'tiny' && object.heldByActorId === actorId);
          });
          if (!objects.length) throw new Error('Выберите согласного союзника или свободный предмет на поле');
          const items = objects.map(object => {
            const card = Object.values(state.world.actors).flatMap(actor => [...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])]).find(card => card.id === object.itemCardId);
            return {id: object.id, name: object.name, ...(card ? {previewCard: card} : {})};
          });
          const choice = objects.length === 1 ? {telekinetic_object_id: [objects[0].id]}
            : await choiceDialog.request([{id: 'telekinetic_object_id', prompt: 'Какой предмет переместить?', count: 1, source: 'explicit', context: 'in_play', origin: {kind: 'other', id: selectedAction.id, name: selectedAction.name}, items, recommended: [items[0].id]}], selectedAction.name);
          if (!choice) return;
          const selectedObject = objects.find(object => object.id === choice.telekinetic_object_id[0])!;
          setSelectedActionChoices({...selectedActionChoices, ...choice, ...(selectedObject.heldByActorId === activeControlledActorId ? {telekinetic_hand_mode: ['from_hand'], telekinetic_hand: [selectedObject.heldInHand!]} : {})});
          setSelectedMovementTargetId(activeControlledActorId); return;
        }
        let choices = selectedActionChoices;
        const object = state.world.objects[choices.telekinetic_object_id?.[0]];
        if (actorId === activeControlledActorId && object?.size === 'tiny' && !choices.telekinetic_hand_mode) {
          const hands = (['main_hand', 'off_hand'] as const).filter(hand => !state.world.actors[actorId].runtime.equipment[hand]
            && !Object.values(state.world.objects).some(row => row.heldByActorId === actorId && row.heldInHand === hand));
          if (!hands.length) throw new Error('Обе руки заняты');
          const chosen = hands.length === 1 ? {telekinetic_hand: [hands[0]]} : await choiceDialog.request([{id: 'telekinetic_hand', prompt: 'В какую руку?', count: 1, source: 'explicit', context: 'in_play', origin: {kind: 'other', id: selectedAction.id, name: selectedAction.name}, items: hands.map(hand => ({id: hand, name: hand === 'main_hand' ? 'Основная рука' : 'Вторая рука'})), recommended: [hands[0]]}], selectedAction.name);
          if (!chosen) return;
          choices = {...choices, ...chosen, telekinetic_hand_mode: ['to_hand']};
        } else if(actorId) throw new Error('Выберите свободную клетку для перемещения');
        const targetIds=[selectedMovementTargetId];
        const next=()=>autoResolveSystemDecisions(executeCombatAction({state,actorId:activeControlledActorId,actionId:selectedActionId,targetIds,worldPosition:position,choices}));
        applyIntent({type:'action',actorId:activeControlledActorId,actionId:selectedActionId,targetIds,worldPosition:position,choices},next);
        setSelectedActionId(null);setSelectedMovementTargetId(null);setSelectedActionChoices({});return;
      }
      if(hasManualTargetSlots(selectedAction,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level)){
        if(!actorId)throw Error('Выберите существо на поле');
        const policy=sheetCombatDeclarationPolicy(selectedAction,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level);
        const candidates=selectedTargetsForAction({state,actorId:activeControlledActorId,actionId:selectedAction.id,clickedActorId:actorId,clickedPosition:position});
        if(candidates.length!==1||candidates[0]!==actorId)throw Error('Эта цель недоступна');
        const facts=spatialFacts(state,activeControlledActorId,actorId);
        if(facts.distanceFt>policy.rangeFt||policy.requiresLineOfSight&&!facts.canSeeTarget||facts.cover==='total')
          throw Error('Цель вне дальности или закрыта от заклинания');
        if(selectedMultiTargetIds.length&&policy.additionalTargetsWithinFtOfFirst!==undefined){
          const first=state.tokens[selectedMultiTargetIds[0]]?.position,target=state.tokens[actorId]?.position;
          if(!first||!target||gridDistanceFt(first,target)>policy.additionalTargetsWithinFtOfFirst)
            throw Error(`Дополнительная цель должна быть в пределах ${policy.additionalTargetsWithinFtOfFirst} фт. от первой`);
        }
        if(selectedMultiTargetIds.length>=policy.maxTargets)throw Error('Все цели уже выбраны');
        if(!policy.allowRepeatTargets&&selectedMultiTargetIds.includes(actorId))throw Error('Это существо уже выбрано');
        setSelectedMultiTargetIds([...selectedMultiTargetIds,actorId]);
        if(policy.dartCount!==undefined)setSelectedMissileDarts(current=>({...current,[actorId]:current[actorId]??1}));
        return;
      }
      const familiarActorId = selectedActionChoices[FAMILIAR_TOUCH_DELIVERY_CHOICE_ID]?.[0];
      const deliveryActorId = familiarActorId && familiarActorId !== 'self' ? familiarActorId : null;
      if (actorId && !deliveryActorId
        && combatRelation(state, activeControlledActorId, actorId) === 'enemy'
        && combatActionIsAttack(state, selectedAction)
        && selectedAction.targeting?.maxTargets === 1
        && !combatWorldInputContext(state, activeControlledActorId, selectedAction)) {
        const actionChoices = Object.fromEntries(Object.entries(selectedActionChoices)
          .filter(([key]) => key !== FAMILIAR_TOUCH_DELIVERY_CHOICE_ID));
        setSelectedActionId(null); setSelectedActionChoices({});
        applyIntent({
          type: 'approach_action', actorId: activeControlledActorId,
          actionId: selectedActionId, targetActorId: actorId, choices: actionChoices,
        }, () => autoResolveSystemDecisions(approachAndExecuteCombatAction({
          state, actorId: activeControlledActorId, actionId: selectedActionId,
          targetActorId: actorId, choices: actionChoices,
        })));
        return;
      }
      const targetIds = selectedTargetsForAction({
        state,
        actorId: deliveryActorId ?? activeControlledActorId,
        actionId: selectedActionId,
        clickedActorId: actorId,
        clickedPosition: position,
      });
      const action = selectedAction;
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
      const actionChoices = Object.fromEntries(Object.entries(selectedActionChoices)
        .filter(([key]) => key !== FAMILIAR_TOUCH_DELIVERY_CHOICE_ID));
      if (deliveryActorId) {
        if (targetIds.length !== 1) throw new Error('Контактное заклинание через фамильяра требует одну цель');
        const next = () => autoResolveSystemDecisions(executeCombatTouchSpellThroughFamiliar({
          state, ownerActorId: activeControlledActorId, familiarActorId: deliveryActorId,
          actionId: selectedActionId, targetActorId: targetIds[0], choices: actionChoices,
        }));
        setSelectedActionId(null); setSelectedActionChoices({});
        applyIntent({type: 'familiar_touch', actorId: activeControlledActorId,
          familiarActorId: deliveryActorId, spellActionId: selectedActionId,
          targetActorId: targetIds[0], choices: actionChoices}, next);
        return;
      }
      const next = () => autoResolveSystemDecisions(executeCombatAction({
        state,
        actorId: activeControlledActorId,
        actionId: selectedActionId,
        targetIds,
        worldPosition: position,
        worldInput,
        scenarioObjects,
        choices: actionChoices,
      }));
      setSelectedActionId(null); setSelectedActionChoices({});
      applyIntent({type: 'action', actorId: activeControlledActorId, actionId: selectedActionId, targetIds, worldPosition: position, worldInput, choices: actionChoices}, next);
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
    setRewardTransitionFailed(false);
    try {
      if (roguelikeRunId) {
        const run = await roguelikeApi.get(roguelikeRunId);
        const completed = run.phase === 'combat' ? await roguelikeApi.command(run.id, run.revision, 'complete_encounter') : run;
        if (completed.status === 'defeat') {
          const retried = await roguelikeApi.command(completed.id, completed.revision, 'retry');
          navigate(`/roguelike/${retried.id}`, {replace: true});
          return;
        }
        setRewardRun(completed); setBusy(false);
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
    } catch (reason) {
      if (roguelikeRunId && state.outcome === 'victory') setRewardTransitionFailed(true);
      setError(reason instanceof Error ? reason.message : 'Не удалось завершить бой'); setBusy(false);
    }
  };

  useEffect(() => {
    if (state?.outcome === 'active') autoRewardStartedRef.current = false;
    if (!state || state.outcome !== 'victory' || !roguelikeRunId || !character || !id || rewardRun || busy || presentation.blocked || autoRewardStartedRef.current) return;
    autoRewardStartedRef.current = true;
    void finish();
  }, [state?.outcome, roguelikeRunId, character, id, rewardRun, busy, presentation.blocked, finish]);

  if (!state || !character) {
    return <main className="solo-combat-loading"><h1>Подготовка поля боя</h1><p>{error ?? 'Компилируем лист, монстров и инициативу…'}</p>{staleRulesSnapshot && <button type="button" onClick={() => void resetStaleCombat()}>Сбросить устаревший бой</button>}{error && <Link to={`/characters-v3/${id}`}>Вернуться в лист</Link>}</main>;
  }
  const pending = state.world.pendingResolution;
  const pendingTriggered = state.pendingTriggeredAction;
  const pendingD20Interrupt = persistedRollPresentation(state.pendingD20Interrupt);
  const interruptActions = (pendingD20Interrupt?.responders ?? []).map(responder => {
    const source = state.world.actors[responder.actorId]?.passives?.find(row => row.id === responder.effectId) ?? {};
    return {id:`${responder.actorId}:${responder.effectId}`, name:responder.effectName,
      description:String(source.description ?? ''), imageUrl:typeof source.image_url === 'string' ? source.image_url : undefined,
      mechanics:source};
  });
  const useInterruptAction = (id: string) => {
    const responder = pendingD20Interrupt?.responders.find(row => `${row.actorId}:${row.effectId}` === id);
    if (responder) applyIntent({type:'d20_interrupt',actorId:responder.actorId,effectId:responder.effectId},
      () => resolveD20Interrupt(state,responder.actorId,Math.random,responder.effectId));
  };
  const pendingTurnStart = state.pendingTurnStartGrappleDamage;
  const implicitAttackCandidate = defaultCombatAttackAction(state, activeControlledActorId);
  const implicitAttackAction = implicitAttackCandidate
    && combatActionAvailability(state, implicitAttackCandidate, activeControlledActorId).enabled
    ? implicitAttackCandidate
    : undefined;
  const implicitActionsEnabled = playerTurn && !busy && !presentation.blocked
    && !secondaryActionId && !dancingLightsMoveGroupId && !state.pendingAdditionalMovement
    && !pending && !pendingTriggered && !pendingTurnStart && !state.pendingAlertSwapActorIds?.length
    && !state.pendingInterception && !pendingD20Interrupt && state.outcome === 'active';
  // On a failed automatic decline keep controls available for an explicit retry.
  const reactionOptions = policyReactionOptions.filter(option => option.visible || error);
  const controlledSavePending = (pending?.request.type === 'saving_throw' || pending?.request.type === 'shove_outcome' || pending?.request.type==='action_cost_policy' || pending?.request.type==='slot_recovery')
    && isControlledCharacter(state, pending.request.actorId)
    ? pending
    : null;
  const reactionTitle = pending?.type === 'check_boost' ? 'Проверка провалена' : pending?.type === 'attack_reaction' && pending.attackAdjustment
    ? 'Промах — применить приём?'
    : pending?.type === 'damage_reaction'
    ? 'Реакция на урон'
    : pending?.request.type === 'reaction'
      && pending.request.trigger.type === 'hit_by_attack'
      ? 'По вам попали'
      : 'Открыто окно реакции';
  const reactionDetails = pending?.type === 'check_boost' ? pending.roll.text : pending?.type === 'attack_reaction' && pending.attackAdjustment
    ? pending.attackRoll.text
    : pending?.type === 'damage_reaction'
    ? `Входящий урон: ${pending.damage.reduce((sum, packet) => sum + packet.amount, 0)}${pending.damage.length
      ? ` · ${[...new Set(pending.damage.map((packet) => getDamageLabel(packet.damageType).toLocaleLowerCase('ru-RU')))].join(', ')}`
      : ''}`
    : null;
  const heldForDisplay = (influenceOfferVisible && offeredHeldInfluences.length>0) || error
    ? heldDecision : undefined;
  // Animation and refreshed portraits are display-only; commands keep the authoritative state.
  const presentedState = presentation.displayState ?? state;
  const displayState = {...presentedState,tokens:Object.fromEntries(Object.entries(presentedState.tokens).map(([actorId,token]) => [actorId,
    {...token,tokenUrl:participantCharacters[actorId]?.avatar_url || (token.templateId && monsterPortraits[token.templateId]) || token.tokenUrl}]))};
  const displayActor = activeActor(displayState);
  return (
    <main className={`solo-combat-page forge${presentation.blocked ? ' combat-input-blocked' : ''}${siteSettings.combat3d ? ' is-3d-field' : ''}`}>
      {rewardRun && <CombatRewardDialog run={rewardRun} onClose={() => navigate(`/roguelike/${rewardRun.id}`)} />}
      {presentation.initiative && <CombatPresentationDialog initiative={presentation.initiative} onClose={presentation.closeInitiative} />}
      <CombatDeathSaveDialog state={state} busy={busy} blocked={presentation.blocked} error={Boolean(error)}
        preferences={combatPassiveEnabled}
        onResolve={effectId => {
          const death = state.pendingDeathSave;
          if (death) applyIntent({type:'death_save',actorId:death.actorId,phase:death.phase,effectId},
            () => resolveCombatDeathSave(state,effectId));
        }}/>
      {(heldForDisplay?.held || presentation.beat) && <CombatPresentationDialog
        modeOverride={heldForDisplay?.held ? 'standard' : undefined}
        beat={heldForDisplay?.held ? {id: 'roll-influence-pending', sourceId: heldForDisplay.command.actorId,
          sourceName: state.world.actors[heldForDisplay.command.actorId]?.name ?? '',
          targetName: heldForDisplay.held.targetId
            ? state.world.actors[heldForDisplay.held.targetId]?.name
            : heldForDisplay.command.targetIds.map(id => state.world.actors[id]?.name).filter(Boolean).join(', '),
          actionName: `${state.catalogActions.find(action => action.id === heldForDisplay.command.actionId)?.name ?? 'Бросок к20'}${heldForDisplay.held.targetSlotIndex!==undefined?` · атака ${heldForDisplay.held.targetSlotIndex} из ${heldForDisplay.held.targetSlotCount}`:''}`,
          rollKind: heldForDisplay.held.kind, roll: heldForDisplay.held.roll, cues: []} : presentation.beat}
        onClose={heldForDisplay?.held ? () => applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null)) : presentation.closeAttack}
        busy={busy} provisional={Boolean(heldForDisplay?.held)}
        influences={heldForDisplay?.held ? offeredHeldInfluences : []}
        onInfluence={heldForDisplay?.held ? effectId => {const owner=heldForDisplay.responders.find(row=>row.effectId===effectId)?.actorId; if(owner) applyIntent({type: 'd20_interrupt', actorId: owner, effectId}, () => resolveD20Interrupt(state, owner, Math.random, effectId));} : undefined}
      />}
      {settingsOpen && <SheetSettingsDialog initialPage="combat" onClose={() => setSettingsOpen(false)} />}
      <MonsterTurnController state={state} disabled={presentation.blocked || Boolean(trustedRunRef.current) || busy || Boolean(pendingTurnStart) || Boolean(state.pendingAlertSwapActorIds?.length) || Boolean(state.pendingInterception) || Boolean(pendingD20Interrupt)} onTransition={apply} onError={setError} />
      <header className="combat-topbar">
        <div className="combat-topbar__navigation"><Link to={roguelikeRunId ? `/roguelike/${roguelikeRunId}` : `/characters-v3/${id}`}><ArrowLeft size={18} /> {roguelikeRunId ? 'Забег' : 'Лист'}</Link>{!roguelikeRunId && <button type="button" onClick={() => setSceneConstructorOpen(true)}><SlidersHorizontal size={16} /> Сцена</button>}</div>
        <div className="initiative-ribbon initiative-ribbon--tokens-only" aria-label="Порядок инициативы">
          {displayState.initiative.map((entry) => {
            const participant = displayState.world.actors[entry.actorId];
            if (!participant) return null;
            const identity = combatIdentity(displayState, entry.actorId);
            return <button type="button" key={entry.actorId}
              className={`initiative-card is-${identity.side}${!actorHasConsciousVitality(participant) ? ' is-dead' : ''}${hoveredActorId === entry.actorId ? ' is-linked-highlight' : ''}`}
              style={{'--combat-accent': identity.accent} as CSSProperties}
              aria-description={`${identity.displayName} · инициатива: ${initiativeLabel(entry)}`}
              aria-label={identity.displayName}
              onMouseEnter={() => setCombatHoveredActorId(entry.actorId)} onMouseLeave={() => setCombatHoveredActorId(null)}
              onFocus={() => setCombatHoveredActorId(entry.actorId)} onBlur={() => setCombatHoveredActorId(null)}>
              <span className="initiative-card__portrait">{displayState.tokens[entry.actorId]?.tokenUrl ? <img src={displayState.tokens[entry.actorId].tokenUrl} alt="" /> : combatActorDisplayName(participant).slice(0, 1)}</span>
            </button>;
          })}
        </div>
        <div className="combat-topbar__right"><div className="combat-round">Раунд {displayState.world.scene.mode === 'encounter' ? displayState.world.scene.round : 1}<b>{busy ? 'Сохраняем…' : `Ход: ${combatActorDisplayName(displayActor)}`}</b></div><div className="combat-topbar__actions"><button type="button" className="combat-settings-button" onClick={() => setSettingsOpen(true)} aria-label="Настройки боя"><SlidersHorizontal size={16} /></button><WorkspaceExpandButton className="combat-settings-button" iconOnly /></div></div>
      </header>
      {error && <div className="combat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={16} /></button></div>}
      <section className={`combat-stage${logHidden ? ' is-log-hidden' : ''}`}>
        <div className={`combat-map-wrap${secondaryActionId && state.pendingTriggeredAction ? ' is-selecting-secondary' : ''}`}>
          <TacticalBattleMap
            state={displayState}
            actionsDisabled={presentation.blocked}
            feedback={presentation.playing}
            selectedActionChoices={selectedActionChoices}
            actorId={activeControlledActorId}
            targetingActorId={selectedActionChoices[FAMILIAR_TOUCH_DELIVERY_CHOICE_ID]?.[0] !== 'self'
              ? selectedActionChoices[FAMILIAR_TOUCH_DELIVERY_CHOICE_ID]?.[0]
              : undefined}
            selectedActionId={secondaryActionId ?? selectedActionId}
            defaultActionId={implicitAttackAction?.id}
            implicitActionsEnabled={implicitActionsEnabled}
            eligibleTargetIds={secondaryActionId ? triggeredSecondaryTargetIds(state, secondaryActionId) : undefined}
            movementMode={movementMode || Boolean(state.pendingAdditionalMovement)}
            worldObjectMoveMode={dancingLightsMoveGroupId === activeDancingLightsGroup}
            inspectedActorId={inspectedActorId}
            highlightedActorId={hoveredActorId}
            onActorHover={setCombatHoveredActorId}
            onCell={clickCell}
            onFacing={!busy&&!presentation.blocked&&playerTurn&&!pending&&!pendingTriggered&&!pendingD20Interrupt?facing=>applyIntent({type:'facing',actorId:activeControlledActorId,facing},()=>selectCombatFacing(state,activeControlledActorId,facing)):undefined}
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
          {selectedActionId&&(()=>{
            const template=state.catalogActions.find(row=>row.id===selectedActionId);
            const action=template&&combatActionForActor(state,activeControlledActorId,template);
            if(!action||!hasManualTargetSlots(action,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level))return null;
            const policy=sheetCombatDeclarationPolicy(action,selectedActionChoices.spell_cast_level?.[0]===undefined?undefined:Number(selectedActionChoices.spell_cast_level[0]),state.world.actors[activeControlledActorId]?.character.level);
            const selected=selectedMultiTargetIds.length;
            return <section className="combat-world-control combat-world-control--selection" aria-label="Выбор целей заклинания">
              <span aria-live="polite">Выбрано {selected} из {policy.maxTargets}; осталось {Math.max(0,policy.maxTargets-selected)}.</span>
              <ol>{selectedMultiTargetIds.map((id,index)=><li key={`${id}:${index}`}>
                {index+1}. {state.world.actors[id]?.name??id}{' '}
                <button type="button" disabled={busy} onClick={()=>{
                  const next=selectedMultiTargetIds.filter((_,slot)=>slot!==index);
                  setSelectedMultiTargetIds(next);
                  if(!next.includes(id))setSelectedMissileDarts(current=>{const copy={...current};delete copy[id];return copy;});
                }} aria-label={`Убрать цель ${index+1}`}>×</button>
              </li>)}</ol>
              {policy.dartCount!==undefined&&<div>Распределите {policy.dartCount} дротика(ов): {[...new Set(selectedMultiTargetIds)].map(id=><label key={id}>{state.world.actors[id]?.name??id}{' '}
                <input type="number" min={1} max={policy.dartCount} step={1} value={selectedMissileDarts[id]??1}
                  onChange={event=>setSelectedMissileDarts(current=>({...current,[id]:Number(event.target.value)}))}/>
              </label>)}</div>}
              <button type="button" disabled={busy||selected<policy.minTargets} onClick={confirmMultipleTargets}>Применить к выбранным</button>
              <button type="button" disabled={busy} onClick={()=>{setSelectedActionId(null);setSelectedActionChoices({});setSelectedMultiTargetIds([]);setSelectedMissileDarts({});}}>Отмена</button>
            </section>;
          })()}
          {selectedActionId && (state.catalogActions.find(row=>row.id===selectedActionId)?.mechanics.activation as Record<string,unknown>|undefined)?.telekinetic_movement===true && <section className="combat-world-control combat-world-control--selection" aria-label="Выбор перемещения">
            <em>{selectedMovementTargetId ? `Выберите свободную клетку в пределах 30 фт. от ${selectedActionChoices.telekinetic_object_id ? 'предмета' : 'цели'}.${state.world.objects[selectedActionChoices.telekinetic_object_id?.[0]]?.size === 'tiny' && !selectedActionChoices.telekinetic_hand_mode ? ' Чтобы взять предмет в руку, выберите себя.' : ''}` : 'Выберите согласного союзника или свободный предмет в пределах 30 фт. Для переноса из своей руки выберите себя.'}</em>
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
                <small aria-description={activeDetectMagic.sensedObjectNames.join(', ')}>
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
        {logHidden ? <button type="button" className="combat-log-toggle combat-log-restore" onClick={() => setLogHidden(false)} aria-label="Показать журнал боя"><ChevronLeft size={18} /></button> : <CombatLogPanel state={displayState} onCollapse={() => setLogHidden(true)} />}
      </section>
      {inspectedActorId && state.world.actors[inspectedActorId] && (
        <CombatActorInspector state={displayState} actorId={inspectedActorId} onClose={() => setInspectedActorId(null)} />
      )}
      {sceneConstructorOpen && <CombatSceneConstructor
        state={state}
        busy={busy}
        onApply={apply}
        onAddCharacter={addSceneCharacter}
        onAddMonster={addSceneMonster}
        onClose={() => setSceneConstructorOpen(false)}
      />}
      <CombatHotbar onEscape={() => { void chooseEscapeGrapple(); }} onConditionAction={actionId => { setMovementMode(false); applyIntent(state.conditionActionSchemaVersion === 1 ? {type: 'condition_action', actorId: activeControlledActorId, actionId} : {type: 'stand', actorId: activeControlledActorId}, () => executeConditionAction(state, activeControlledActorId, actionId)); }} state={state} displayState={displayState} actorId={activeControlledActorId} selectedActionId={selectedActionId} movementMode={movementMode} passiveEnabled={combatPassiveEnabled} onPassiveToggle={setCombatPassive} disabled={presentation.blocked || !playerTurn || Boolean(state.pendingAdditionalMovement) || busy || Boolean(pending) || Boolean(pendingTriggered) || Boolean(pendingTurnStart) || Boolean(state.pendingAlertSwapActorIds?.length) || Boolean(state.pendingInterception) || Boolean(pendingD20Interrupt) || state.outcome !== 'active'} onAction={(action) => { void chooseAction(action); }} onMove={() => { void (async () => {
        setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null);
        if (movementMode) { setMovementMode(false); return; }
        try {
          const actorSpeeds = combatActorMovementSpeeds(state.world.actors[activeControlledActorId]);
          const availableModes = Object.entries(actorSpeeds).filter(([, speed]) => speed > 0) as Array<[keyof typeof movementModeLabels, number]>;
          const currentMode = combatActorMovementMode(state, activeControlledActorId);
          let selectedMode = currentMode;
          if (availableModes.length > 1) {
            const selection = await choiceDialog.request([{
              id: MOVEMENT_MODE_CHOICE_ID,
              prompt: 'Как перемещаться?',
              count: 1,
              source: 'explicit',
              context: 'in_play',
              origin: {kind: 'other', id: 'combat-movement', name: 'Перемещение'},
              items: availableModes.map(([mode, speed]) => {
                const actorId = activeControlledActorId;
                const distance = mode === 'jump' ? Math.min(state.movementRemainingFt[actorId] ?? speed,
                  maximumActorLongJumpFt(state.world.actors[actorId], state.tokens[actorId].position,
                    state.recentStraightMovementByActor?.[actorId], state.world.scene.mode === 'encounter' ? state.world.scene.round : 0)) : speed;
                return {id: mode, name: `${movementModeLabels[mode]} · ${mode === 'jump' ? 'до ' : ''}${distance} фт.`};
              }),
              recommended: [currentMode],
            }], 'Перемещение');
            if (!selection) return;
            selectedMode = selection[MOVEMENT_MODE_CHOICE_ID]?.[0] as keyof typeof movementModeLabels;
            if (!selectedMode) return;
          }
          if (selectedMode !== currentMode) {
            applyIntent({type: 'movement_mode', actorId: activeControlledActorId, mode: selectedMode},
              () => selectCombatMovementMode(state, activeControlledActorId, selectedMode));
          }
          setMovementMode(true);
        } catch (reason) { setError(playerFacingSheetActionError(reason)); }
      })(); }} onEndTurn={() => { setSelectedActionId(null); setSelectedActionChoices({}); setDancingLightsMoveGroupId(null); applyIntent({type: 'end_turn', actorId: activeControlledActorId}, () => advanceTurn(state)); }} onSheet={() => {
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
        const drawerRun = trustedRunRef.current;
        return <aside className="combat-sheet-drawer"><button type="button" className="combat-sheet-drawer__close" onClick={() => setSheetOpen(false)} aria-label="Закрыть"><X /></button><header><h2>{combatActorDisplayName(drawerActor)}</h2><p>Уровень {drawerCharacter.level} · КД {effectiveArmorClass(drawerActor)} · скорость {effectiveActorSpeedFt(drawerActor)} фт.</p></header><CombatCharacterSidebar
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
        /><Link className="combat-sheet-drawer__full" target="_blank" to={drawerRun && runHasCharacter(drawerRun,drawerActorId) ? runSheetURL(drawerRun,drawerActorId) : `/characters-v3/${drawerActorId}`}>Открыть полный лист ↗</Link></aside>;
      })()}
      {reactionOptions.length > 0 && <div className="combat-reaction-backdrop"><section role="dialog" aria-modal="true" aria-label={reactionTitle}>
        <p>{pending?.type === 'check_boost' ? 'ПОСЛЕ БРОСКА' : pending?.type === 'attack_reaction' && pending.attackAdjustment ? 'ПРИЁМ' : 'РЕАКЦИЯ'}</p><h2>{reactionTitle}</h2>{pending?.type === 'damage_reaction' && <p>{state.world.actors[pending.request.actorId]?.name} · Цель: {state.world.actors[pending.targetActorId]?.name}</p>}{reactionDetails && <p>{reactionDetails}</p>}
        {pending?.type === 'attack_reaction' && pending.request.trigger.type === 'hit_by_attack' && <div className="combat-reaction-attack-summary">
          <p>{state.world.actors[pending.sourceActorId]?.name} → {state.world.actors[pending.targetActorId]?.name}</p>
          <AttackRollEquation roll={{...pending.attackRoll, target: {...pending.attackRoll.target, type:'ac', value:pending.request.trigger.originalAc}}}/>
          {pending.attackRoll.outcome === 'crit' && <p>Критическое попадание — увеличение КД не отменяет его.</p>}
          <RollCalculationDetails roll={pending.attackRoll}/>
        </div>}
        <div className="combat-reaction-actions">{reactionOptions.map(option => {
          const presentation = state.actionPresentation?.[option.response.actionId ?? ''];
          return <div key={option.id}><SheetActionLine name={option.label}
            imageUrl={presentation?.imageUrl} description={presentation?.description}
            actionRef={presentation?.actionRef} spellRef={presentation?.spellRef}
            variant={presentation?.spellRef ? siteSettings.entityDisplay.spells : siteSettings.entityDisplay.actions}
            sourceLabel={pending ? state.world.actors[pending.request.actorId]?.name : undefined}
            disabled={busy} onActivate={() => applyIntent({type: 'reaction', response: option.response}, () => resolvePlayerReaction(state, option.response))} />
            {option.preview && <p>КД после реакции: {option.preview.ac} · {option.preview.changesOutcome ? 'Удар будет отражён' : 'Попадание сохранится'}</p>}
            <DecisionPolicyToggles toggles={option.toggles} preferences={combatPassiveEnabled} onChange={setCombatPassive}
              parent={{name: presentation?.spellRef?.name ?? presentation?.actionRef?.name,
                imageUrl: presentation?.imageUrl || presentation?.spellRef?.image_url || presentation?.actionRef?.image_url}}/>
          </div>;
        })}</div>
        <button type="button" disabled={busy} onClick={() => applyIntent({type: 'reaction', response: {kind: 'reaction', actionId: null}}, () => resolvePlayerReaction(state, { kind: 'reaction', actionId: null }))}>Пропустить</button>
      </section></div>}

      {controlledSavePending && <div className="combat-reaction-backdrop"><section>
        <SheetPendingCombatPanel
          systemRollsOnly={Boolean(trustedRunRef.current)}
          pending={controlledSavePending}
          viewingCharacterId={controlledSavePending.request.actorId}
          actorNames={Object.fromEntries(Object.values(state.world.actors).map((entry) => [entry.id, combatActorDisplayName(entry)]))}
          decidingRuntime={state.world.actors[controlledSavePending.request.actorId].runtime}
          busy={busy}
          onResolve={(response) => {
            if(response.kind==='slot_recovery')applyIntent({type:'slot_recovery',slotLevels:response.slotLevels},()=>resolvePlayerSlotRecovery(state,response.slotLevels));
            else if(response.kind==='action_cost_policy')applyIntent({type:'action_cost_policy',policyId:response.policyId},()=>resolvePlayerActionCostPolicy(state,response.policyId));
            if (response.kind === 'shove_outcome') applyIntent({type: 'shove_outcome', outcome: response.outcome}, () => resolvePlayerShoveOutcome(state, response.outcome));
            if (response.kind === 'roll') applyIntent({type: 'saving_throw', selectedAbility: response.selectedAbility, boonEffectId: response.boonEffectId}, () => resolvePlayerSavingThrow(state, response));
          }}
        />
      </section></div>}
      {state.pendingAlertSwapActorIds?.length && !presentation.blocked ? (() => {
        const alertActorId = state.pendingAlertSwapActorIds[0];
        const alertActor = state.world.actors[alertActorId];
        const allies = controlledCharacterIds(state).filter((actorId) => actorId !== alertActorId);
        return <div className="combat-reaction-backdrop"><section><p>БДИТЕЛЬНЫЙ</p><h2>{alertActor.name}: обменять инициативу?</h2><p>Сразу после броска инициативы можно обменяться местами с согласным союзником. Итоговые значения не меняются.</p><div>{allies.map((allyId) => <button type="button" key={allyId} disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: allyId}, () => resolveSoloCombatAlertSwap(state, alertActorId, allyId))}>Обменяться с {state.world.actors[allyId].name}</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: null}, () => resolveSoloCombatAlertSwap(state, alertActorId, null))}>Оставить порядок</button></div></section></div>;
      })() : null}
      {state.pendingInterception ? <div className="combat-reaction-backdrop"><section><p>РЕАКЦИЯ</p><h2>Перехватить удар по {state.world.actors[state.pendingInterception.targetActorId].name}?</h2><p>Входящий урон: {state.pendingInterception.incomingDamage}. Перехват снизит его на 1к10 + Бонус владения и потратит реакцию.</p><div>{state.pendingInterception.interceptorActorIds.map((actorId) => <button type="button" key={actorId} disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: actorId}, () => resolveSoloCombatInterception(state, actorId))}>{state.world.actors[actorId].name} · использовать Перехват</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: null}, () => resolveSoloCombatInterception(state, null))}>Пропустить</button></div></section></div> : null}
{pendingD20Interrupt && pendingD20Interrupt.operation !== 'roll_influence' ? <div className="combat-reaction-backdrop"><section><p>{pendingD20Interrupt.timing === 'before_roll' ? 'ДО БРОСКА К20' : 'ПОСЛЕ РЕЗУЛЬТАТА'}</p><h2>{pendingD20Interrupt.operation === 'roll_choice' ? 'Выберите влияние до броска' : pendingD20Interrupt.operation === 'impose_disadvantage' ? 'Наложить Помеху на бросок?' : 'Попытаться изменить успешный бросок?'}</h2>{pendingD20Interrupt.preview && <p>Показанный результат: {pendingD20Interrupt.preview.total} · {pendingD20Interrupt.preview.rollKind === 'attack_roll' ? 'попадание' : 'успех'}. Сохранённый бросок будет продолжен без переброса.</p>}<div><RollInfluenceActions actions={interruptActions} disabled={busy} onUse={useInterruptAction}/><button type="button" disabled={busy} onClick={() => applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null))}>Пропустить</button></div></section></div> : null}
      {!secondaryActionId && <CombatTriggeredActionPanel state={state} busy={busy} onChoose={resolveTriggeredChoice} />}
      {pendingTurnStart && <div className="combat-reaction-backdrop"><section><p>НАЧАЛО ХОДА</p><h2>Нанести 1к4 урона существу в захвате?</h2><div>{pendingTurnStart.targetActorIds.map((targetActorId) => <button type="button" key={targetActorId} disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: targetActorId}, () => resolveSoloCombatTurnStart(state, targetActorId))}>{state.world.actors[targetActorId]?.name ?? 'Цель'} · 1к4 дробящего урона</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: null}, () => resolveSoloCombatTurnStart(state, null))}>Пропустить</button></div></section></div>}
      {worldInputDialog.dialog}
      {!rewardRun && !presentation.blocked && shouldShowSoloCombatOutcome(state) && !(roguelikeRunId && state.outcome === 'victory' && !rewardTransitionFailed) && <div className="combat-outcome"><section><p>БОЙ ЗАВЕРШЁН</p><h1>{state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><p>{state.outcome === 'victory' ? rewardTransitionFailed ? 'Не удалось открыть награды. Можно повторить попытку.' : 'Все противники уничтожены.' : controlledCharacterIds(state).some(actorId => {
        const actor = state.world.actors[actorId];
        return actor?.runtime.deathSaves?.dead || (actor?.runtime.deathSaves?.failures ?? 0) >= 3 || actor?.lifecycle?.status === 'dead';
      }) ? 'Один из участников погиб. Забег завершён поражением.' : 'Никто из участников не может продолжать бой.'}</p><button type="button" disabled={busy} onClick={finish}>{roguelikeRunId ? state.outcome === 'victory' ? 'Повторить получение наград' : 'Повторить с контрольной точки' : 'Завершить и вернуться в лист'}</button><button type="button" onClick={() => navigate(roguelikeRunId ? `/roguelike/${roguelikeRunId}` : `/characters-v3/${id}`)}><RotateCcw size={16} /> {roguelikeRunId ? 'Вернуться в забег' : 'Оставить запись боя'}</button></section></div>}
    </main>
  );
}
import {usePassivePreferences} from '../character/passivePreferences';
