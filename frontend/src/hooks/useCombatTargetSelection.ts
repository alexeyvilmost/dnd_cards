import { useState } from 'react';
import { actionsApi, spellsApi } from '../api/client';
import { familiarFormLabel } from '../character/familiarLabels';
import { playerFacingSheetActionError } from '../character/sheetActionError';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import { sheetCombatDeclarationPolicy } from '../character/sheetCombatDeclaration';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import { sheetWorldInputFormContext } from '../character/sheetWorldInputForm';
import { combatActionAvailability } from '../components/CombatHotbar';
import { useSheetWorldInputDialog } from '../components/SheetWorldInputDialog';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { actorHasConsciousVitality } from '../engine/lifePolicies';
import { useCombatCommandDispatch } from '../hooks/useCombatCommandDispatch';
import type { ActionWorldInput } from '../rules-core/domain';
import { canonicalTouchSpell, familiarActorsOwnedBy } from '../rules-core/familiarRuntime';
import { isLooseTelekineticObject, telekineticHeldObjects } from '../rules-core/telekineticMovement';
import type { WorldObjectState } from '../rules-core/worldObjects';
import {
  collectSoloCombatActionChoices,
  combatPassiveTogglesForAction,
  immediateSoloCombatTargetIds,
  resolveCombatPassiveChoices,
} from '../solo-combat/actionChoices';
import { combatActionForActor, combatActionIsAttack, combatActionRangeFt, combatApproachRoute, defaultCombatAttackAction } from '../solo-combat/defaultInteraction';
import {
  approachAndExecuteCombatAction,
  autoResolveSystemDecisions,
  executeCombatAction,
  executeCombatTouchSpellThroughFamiliar,
  moveActorAlongRoute,
  moveCombatDancingLights,
  resolveTriggeredCombatAction,
  selectedTargetsForAction,
  triggeredSecondaryTargetIds
} from '../solo-combat/engine';
import { gridDistanceFt } from '../solo-combat/tacticalGrid';
import {
  combatRelation,
  isControlledCharacter,
  spatialFacts,
  type GridPosition,
  type SoloCombatState
} from '../solo-combat/types';
import { bindCombatWorldInputFacts } from '../solo-combat/worldInput';
import type { Action } from '../types';

export const FAMILIAR_TOUCH_DELIVERY_CHOICE_ID = 'combat_familiar_touch_delivery';
export function hasManualTargetSlots(action:SoloCombatState['catalogActions'][number],castLevel?:number,actorLevel?:number):boolean {
  const targeting=action.mechanics.targeting as Record<string,unknown>|undefined;
  return Boolean(action.targeting&&sheetCombatDeclarationPolicy(action,castLevel,actorLevel).maxTargets>1)&&targeting?.domain!=='world'&&targeting?.actor_targets!==false
    &&targeting?.shape!=='area'&&targeting?.shape!=='self';
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

interface CombatTargetSelectionOptions {
  state: SoloCombatState | null;
  busy: boolean;
  playerTurn: boolean;
  activeControlledActorId: string;
  activeDancingLightsGroup: string | undefined;
  presentationBlockedRef: import('react').RefObject<boolean>;
  combatPassiveEnabled: Record<string, boolean>;
  applyIntent: ReturnType<typeof useCombatCommandDispatch>;
  requestSpellCastLevel: (action: SoloCombatState['catalogActions'][number], actorId: string) => Promise<Record<string,string[]> | null>;
  setError: (message: string | null) => void;
}

/** UI selection and intent assembly only; range, cost, targets and execution remain canonical. */
export function useCombatTargetSelection({state, busy, playerTurn, activeControlledActorId, activeDancingLightsGroup, presentationBlockedRef, combatPassiveEnabled, applyIntent, requestSpellCastLevel, setError}: CombatTargetSelectionOptions) {
  const choiceDialog = useChoiceDialog();
  const worldInputDialog = useSheetWorldInputDialog();
  const [secondaryActionId, setSecondaryActionId] = useState<string | null>(null);
  const [selectedMovementTargetId, setSelectedMovementTargetId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedActionChoices, setSelectedActionChoices] = useState<Record<string, string[]>>({});
  const [selectedMultiTargetIds,setSelectedMultiTargetIds]=useState<string[]>([]);
  const [selectedMissileDarts,setSelectedMissileDarts]=useState<Record<string,number>>({});
  const [movementMode, setMovementMode] = useState(false);
  const [dancingLightsMoveGroupId, setDancingLightsMoveGroupId] = useState<string | null>(null);
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

  return {secondaryActionId, setSecondaryActionId, selectedMovementTargetId, setSelectedMovementTargetId, selectedActionId, setSelectedActionId, selectedActionChoices, setSelectedActionChoices, selectedMultiTargetIds, setSelectedMultiTargetIds, selectedMissileDarts, setSelectedMissileDarts, movementMode, setMovementMode, dancingLightsMoveGroupId, setDancingLightsMoveGroupId, chooseAction, confirmMultipleTargets, clickCell, worldInputDialog};
}
