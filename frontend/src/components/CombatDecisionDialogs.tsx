import { combatActorDisplayName } from '../character/familiarLabels';
import AttackRollEquation from '../components/AttackRollEquation';
import CombatTriggeredActionPanel from '../components/CombatTriggeredActionPanel';
import DecisionPolicyToggles from '../components/DecisionPolicyToggles';
import RollCalculationDetails from '../components/RollCalculationDetails';
import RollInfluenceActions from '../components/RollInfluenceActions';
import SheetActionLine from '../components/SheetActionLine';
import SheetPendingCombatPanel, { sheetReactionDecisionOptions } from '../components/SheetPendingCombatPanel';
import { useCombatCommandDispatch } from '../hooks/useCombatCommandDispatch';
import { previewAttackDefense } from '../rules-core/handler';
import { useSiteSettings } from '../settings';
import { decisionPolicyToggles } from '../solo-combat/decisionPolicies';
import {
  resolveD20Interrupt,
  resolvePlayerActionCostPolicy,
  resolvePlayerReaction,
  resolvePlayerSavingThrow,
  resolvePlayerShoveOutcome,
  resolvePlayerSlotRecovery,
  resolveSoloCombatAlertSwap,
  resolveSoloCombatInterception,
  resolveSoloCombatTurnStart
} from '../solo-combat/engine';
import { persistedRollPresentation } from '../solo-combat/persistedRollPresentation';
import {
  controlledCharacterIds,
  isControlledCharacter,
  type SoloCombatState
} from '../solo-combat/types';
import { getDamageLabel } from '../utils/damageTypes';

export type CombatPolicyReactionOption = ReturnType<typeof sheetReactionDecisionOptions>[number] & {
  toggles: ReturnType<typeof decisionPolicyToggles>;
  preview: ReturnType<typeof previewAttackDefense> | undefined;
  visible: boolean;
};
interface CombatDecisionDialogsProps {
  state: SoloCombatState;
  busy: boolean;
  error: string | null;
  trusted: boolean;
  presentationBlocked: boolean;
  policyReactionOptions: CombatPolicyReactionOption[];
  combatPassiveEnabled: Record<string, boolean>;
  setCombatPassive: (id:string,enabled:boolean) => void;
  secondaryActionId: string | null;
  resolveTriggeredChoice: (id:string|null) => Promise<void>;
  applyIntent: ReturnType<typeof useCombatCommandDispatch>;
}

/** Rendering and player callbacks only: options and accepted state are supplied by the canonical pipeline. */
export default function CombatDecisionDialogs({state, busy, error, trusted, presentationBlocked, policyReactionOptions, combatPassiveEnabled, setCombatPassive, secondaryActionId, resolveTriggeredChoice, applyIntent}: CombatDecisionDialogsProps) {
  const siteSettings=useSiteSettings();
  const pending=state.world.pendingResolution;
  const pendingD20Interrupt=persistedRollPresentation(state.pendingD20Interrupt);
  const pendingTurnStart=state.pendingTurnStartGrappleDamage;
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
  return <>
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
          systemRollsOnly={trusted}
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
      {state.pendingAlertSwapActorIds?.length && !presentationBlocked ? (() => {
        const alertActorId = state.pendingAlertSwapActorIds[0];
        const alertActor = state.world.actors[alertActorId];
        const allies = controlledCharacterIds(state).filter((actorId) => actorId !== alertActorId);
        return <div className="combat-reaction-backdrop"><section><p>БДИТЕЛЬНЫЙ</p><h2>{alertActor.name}: обменять инициативу?</h2><p>Сразу после броска инициативы можно обменяться местами с согласным союзником. Итоговые значения не меняются.</p><div>{allies.map((allyId) => <button type="button" key={allyId} disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: allyId}, () => resolveSoloCombatAlertSwap(state, alertActorId, allyId))}>Обменяться с {state.world.actors[allyId].name}</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'alert_swap', actorId: alertActorId, allyActorId: null}, () => resolveSoloCombatAlertSwap(state, alertActorId, null))}>Оставить порядок</button></div></section></div>;
      })() : null}
      {state.pendingInterception ? <div className="combat-reaction-backdrop"><section><p>РЕАКЦИЯ</p><h2>Перехватить удар по {state.world.actors[state.pendingInterception.targetActorId].name}?</h2><p>Входящий урон: {state.pendingInterception.incomingDamage}. Перехват снизит его на 1к10 + Бонус владения и потратит реакцию.</p><div>{state.pendingInterception.interceptorActorIds.map((actorId) => <button type="button" key={actorId} disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: actorId}, () => resolveSoloCombatInterception(state, actorId))}>{state.world.actors[actorId].name} · использовать Перехват</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'interception', actorId: null}, () => resolveSoloCombatInterception(state, null))}>Пропустить</button></div></section></div> : null}
{pendingD20Interrupt && pendingD20Interrupt.operation !== 'roll_influence' ? <div className="combat-reaction-backdrop"><section><p>{pendingD20Interrupt.timing === 'before_roll' ? 'ДО БРОСКА К20' : 'ПОСЛЕ РЕЗУЛЬТАТА'}</p><h2>{pendingD20Interrupt.operation === 'roll_choice' ? 'Выберите влияние до броска' : pendingD20Interrupt.operation === 'impose_disadvantage' ? 'Наложить Помеху на бросок?' : 'Попытаться изменить успешный бросок?'}</h2>{pendingD20Interrupt.preview && <p>Показанный результат: {pendingD20Interrupt.preview.total} · {pendingD20Interrupt.preview.rollKind === 'attack_roll' ? 'попадание' : 'успех'}. Сохранённый бросок будет продолжен без переброса.</p>}<div><RollInfluenceActions actions={interruptActions} disabled={busy} onUse={useInterruptAction}/><button type="button" disabled={busy} onClick={() => applyIntent({type: 'd20_interrupt', actorId: null}, () => resolveD20Interrupt(state, null))}>Пропустить</button></div></section></div> : null}
      {!secondaryActionId && <CombatTriggeredActionPanel state={state} busy={busy} onChoose={resolveTriggeredChoice} />}
      {pendingTurnStart && <div className="combat-reaction-backdrop"><section><p>НАЧАЛО ХОДА</p><h2>Нанести 1к4 урона существу в захвате?</h2><div>{pendingTurnStart.targetActorIds.map((targetActorId) => <button type="button" key={targetActorId} disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: targetActorId}, () => resolveSoloCombatTurnStart(state, targetActorId))}>{state.world.actors[targetActorId]?.name ?? 'Цель'} · 1к4 дробящего урона</button>)}<button type="button" disabled={busy} onClick={() => applyIntent({type: 'turn_start', targetActorId: null}, () => resolveSoloCombatTurnStart(state, null))}>Пропустить</button></div></section></div>}
  </>;
}
