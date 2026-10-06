import { ArrowLeft, ChevronLeft, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { actionsApi, effectsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { combatActorDisplayName } from '../character/familiarLabels';
import {
  runtimeInventoryPayload,
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import CombatDecisionDialogs from '../components/CombatDecisionDialogs';
import CombatRollDialogs from '../components/CombatRollDialogs';
import { actorHasConsciousVitality } from '../engine/lifePolicies';
import { FAMILIAR_TOUCH_DELIVERY_CHOICE_ID, hasManualTargetSlots, useCombatTargetSelection } from '../hooks/useCombatTargetSelection';
import { useSoloCombatBootstrap } from '../hooks/useSoloCombatBootstrap';
import { useSoloCombatPersistence } from '../hooks/useSoloCombatPersistence';
import type { RoguelikeRun } from '../roguelike/api';
import { effectiveArmorClass } from '../rules-core/actorArmorClass';
import { previewAttackDefense } from '../rules-core/handler';
import { useSiteSettings } from '../settings';
import { decisionOfferVisible, decisionPolicyToggles, offeredRollInfluences } from '../solo-combat/decisionPolicies';
import { combatDisplayState } from '../solo-combat/displayState';
import { combatRollInfluences } from '../solo-combat/engine';
import { maximumActorLongJumpFt } from '../solo-combat/jump';
import { persistedRollPresentation } from '../solo-combat/persistedRollPresentation';
import { availableCombatSpellLevels } from '../solo-combat/spellCastChoices';

import { useCombatAudio } from '../audio/useCombatAudio';
import { usePassivePreferences } from '../character/passivePreferences';
import { sheetCombatDeclarationPolicy } from '../character/sheetCombatDeclaration';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import CombatActorInspector from '../components/CombatActorInspector';
import CombatCharacterSidebar from '../components/CombatCharacterSidebar';
import CombatHotbar, { combatActionAvailability } from '../components/CombatHotbar';
import CombatLogPanel from '../components/CombatLogPanel';
import CombatRewardDialog from '../components/CombatRewardDialog';
import CombatSceneConstructor from '../components/CombatSceneConstructor';
import MonsterTurnController from '../components/MonsterTurnController';
import { sheetReactionDecisionOptions } from '../components/SheetPendingCombatPanel';
import SheetSettingsDialog from '../components/SheetSettingsDialog';
import TacticalBattleMap from '../components/TacticalBattleMap';
import { WorkspaceExpandButton } from '../components/WorkspaceNavigation';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { useCombatCommandDispatch } from '../hooks/useCombatCommandDispatch';
import { monstersApi } from '../monsters/api';
import { roguelikeApi } from '../roguelike/api';
import { runCharacters, runHasCharacter, runSheetURL } from '../roguelike/navigation';
import {
  collectSoloCombatActionChoices,
  combatPassiveTogglesForAction,
  resolveCombatPassiveChoices
} from '../solo-combat/actionChoices';
import { combatIdentity } from '../solo-combat/combatIdentity';
import { combatActionForActor, defaultCombatAttackAction } from '../solo-combat/defaultInteraction';
import {
  activateCombatBoon,
  activeActor,
  addSoloCombatCharacter,
  addSoloCombatMonster,
  advanceTurn,
  autoResolveSystemDecisions,
  combatDetectMagicStatus,
  declineAdditionalMovement,
  escapeActorGrapple,
  executeCombatRemoteManipulator,
  executeConditionAction,
  resolveD20Interrupt,
  resolvePlayerReaction,
  resolveTriggeredCombatAction,
  revealCombatMagicAura,
  selectCombatFacing,
  selectCombatMovementMode,
  triggeredSecondaryTargetIds
} from '../solo-combat/engine';
import { shouldShowSoloCombatOutcome } from '../solo-combat/outcomeVisibility';
import { combatActorMovementMode, combatActorMovementSpeeds, effectiveActorSpeedFt } from '../solo-combat/tacticalGrid';
import { writeDedicatedCombatTurnState } from '../solo-combat/turnState';
import {
  combatRelation,
  controlledCharacterIds,
  isControlledCharacter,
  isPlayerControlledCombatActor,
  type SoloCombatState
} from '../solo-combat/types';
import { useAutomaticCombatDecision } from '../solo-combat/useAutomaticCombatDecision';
import { useAutomaticTurnStartAction } from '../solo-combat/useAutomaticTurnStartAction';
import { useCombatPresentation } from '../solo-combat/useCombatPresentation';
import './CharacterForge.css';
import './CharacterSheet.css';
import './SoloCombatPage.css';

const MOVEMENT_MODE_CHOICE_ID = 'combat_movement_mode';
const movementModeLabels = {walk: 'Ходьба', climb: 'Лазание', fly: 'Полёт', swim: 'Плавание', burrow: 'Рытьё',jump:'Прыжок'} as const;


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


export default function SoloCombatPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roguelikeRunId = searchParams.get('roguelike');
  const choiceDialog = useChoiceDialog();
  const [character, setCharacter] = useState<ForgeCharacter | null>(null);
  const [participantCharacters, setParticipantCharacters] = useState<Record<string, ForgeCharacter>>({});
  const participantCharactersRef = useRef<Record<string, ForgeCharacter>>({});
  const characterRef = useRef<ForgeCharacter | null>(null);
  const trustedRunRef = useRef<RoguelikeRun | null>(null);
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
  const displayState=useMemo(()=>combatDisplayState(presentation.displayState??state,participantCharacters,monsterPortraits),
    [presentation.displayState,state,participantCharacters,monsterPortraits]);
  useCombatAudio(state,presentation.playing,presentation.initiative,presentation.blocked);
  const presentationBlockedRef = useRef(false);
  presentationBlockedRef.current = presentation.blocked;
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

  const {persist, apply, resetStaleCombat} = useSoloCombatPersistence({id, roguelikeRunId, characterRef, participantCharactersRef, setCharacter, setParticipantCharacters, setState, setBusy, setError, navigate});

  useSoloCombatBootstrap({id, roguelikeRunId, navigate, persist, requestChoice: choiceDialog.request, initialRequestedRef, initialAlliesRef, characterRef, trustedRunRef, participantCharactersRef, setCharacter, setParticipantCharacters, setOpeningState, setState, setBusy, setStaleRulesSnapshot, setError});

  const acceptCombatRun = useCallback((accepted: RoguelikeRun) => {
    if (!accepted.combat_state || !accepted.character) throw new Error('Сервер не вернул состояние боя');
    trustedRunRef.current = accepted;
    characterRef.current = accepted.character;
    setCharacter(accepted.character);
    participantCharactersRef.current = Object.fromEntries(runCharacters(accepted).map(c=>[c.id,c]));
    setParticipantCharacters(participantCharactersRef.current);
    setState(accepted.combat_state);
  }, []);
  const applyIntent = useCombatCommandDispatch({sessionKey: `${id ?? ''}:${roguelikeRunId ?? ''}`, runRef: trustedRunRef, presentationBlockedRef,
    applyLocal: apply, onAccepted: acceptCombatRun, setBusy, setError});

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
  const {secondaryActionId, setSecondaryActionId, selectedMovementTargetId, setSelectedMovementTargetId, selectedActionId, setSelectedActionId, selectedActionChoices, setSelectedActionChoices, selectedMultiTargetIds, setSelectedMultiTargetIds, selectedMissileDarts, setSelectedMissileDarts, movementMode, setMovementMode, dancingLightsMoveGroupId, setDancingLightsMoveGroupId, chooseAction, confirmMultipleTargets, clickCell, worldInputDialog} = useCombatTargetSelection({state, busy, playerTurn, activeControlledActorId, activeDancingLightsGroup, presentationBlockedRef, combatPassiveEnabled, applyIntent, requestSpellCastLevel, setError});

  const addSceneCharacter = async (characterId: string) => {
    if (!state || !character) throw new Error('Сцена ещё не загружена');
    const [row, basicResponse] = await Promise.all([
      charactersV3Api.get(characterId),
      actionsApi.getActions({ type: 'basic', limit: 100 }),
    ]);
    if (row.user_id !== character.user_id) throw new Error('Можно добавить только своего персонажа');
    const participant = await loadSheetCombatParticipant({
      character: row,
      basicActions: basicResponse.actions,
      cards: new Map(),
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

  if (!state || !character || !displayState) {
    return <main className="solo-combat-loading"><h1>Подготовка поля боя</h1><p>{error ?? 'Компилируем лист, монстров и инициативу…'}</p>{staleRulesSnapshot && <button type="button" onClick={() => void resetStaleCombat()}>Сбросить устаревший бой</button>}{error && <Link to={`/characters-v3/${id}`}>Вернуться в лист</Link>}</main>;
  }
  const pending = state.world.pendingResolution;
  const pendingTriggered = state.pendingTriggeredAction;
  const pendingD20Interrupt = persistedRollPresentation(state.pendingD20Interrupt);
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
  // Animation and refreshed portraits are display-only; commands keep the authoritative state.
  const displayActor = activeActor(displayState);
  return (
    <main className={`solo-combat-page forge${presentation.blocked ? ' combat-input-blocked' : ''}${siteSettings.combat3d ? ' is-3d-field' : ''}`}>
      {rewardRun && <CombatRewardDialog run={rewardRun} onClose={() => navigate(`/roguelike/${rewardRun.id}`)} />}
      <CombatRollDialogs {...{state, busy, error, presentation, heldDecision, influenceOfferVisible, offeredHeldInfluences, combatPassiveEnabled, applyIntent}} />
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
      <CombatDecisionDialogs {...{state, busy, error, policyReactionOptions, combatPassiveEnabled, setCombatPassive, secondaryActionId, resolveTriggeredChoice, applyIntent}} trusted={Boolean(trustedRunRef.current)} presentationBlocked={presentation.blocked} />
      {worldInputDialog.dialog}
      {!rewardRun && !presentation.blocked && shouldShowSoloCombatOutcome(state) && !(roguelikeRunId && state.outcome === 'victory' && !rewardTransitionFailed) && <div className="combat-outcome"><section><p>БОЙ ЗАВЕРШЁН</p><h1>{state.outcome === 'victory' ? 'Победа' : 'Поражение'}</h1><p>{state.outcome === 'victory' ? rewardTransitionFailed ? 'Не удалось открыть награды. Можно повторить попытку.' : 'Все противники уничтожены.' : controlledCharacterIds(state).some(actorId => {
        const actor = state.world.actors[actorId];
        return actor?.runtime.deathSaves?.dead || (actor?.runtime.deathSaves?.failures ?? 0) >= 3 || actor?.lifecycle?.status === 'dead';
      }) ? 'Один из участников погиб. Забег завершён поражением.' : 'Никто из участников не может продолжать бой.'}</p><button type="button" disabled={busy} onClick={finish}>{roguelikeRunId ? state.outcome === 'victory' ? 'Повторить получение наград' : 'Повторить с контрольной точки' : 'Завершить и вернуться в лист'}</button><button type="button" onClick={() => navigate(roguelikeRunId ? `/roguelike/${roguelikeRunId}` : `/characters-v3/${id}`)}><RotateCcw size={16} /> {roguelikeRunId ? 'Вернуться в забег' : 'Оставить запись боя'}</button></section></div>}
    </main>
  );
}
