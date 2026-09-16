import type {RoguelikeRun} from './api';
import type {RoguelikeCombatIntent} from './combatWorker';
import {combatActionIsAttack, combatApproachRoute, combatMovementRoute,combatActionRangeFt} from '../solo-combat/defaultInteraction';
import type {SoloCombatState} from '../solo-combat/types';

type Send = (run: RoguelikeRun, intent: RoguelikeCombatIntent) => Promise<RoguelikeRun>;

function paused(state: SoloCombatState, actorId: string, additional: boolean) {
  return state.outcome !== 'active' || (state.world.actors[actorId]?.runtime.hp.current ?? 0) <= 0
    || state.playerMovement || state.pendingMovementStep || state.pendingReachEntry
    || (!additional && state.pendingAdditionalMovement) || state.world.pendingResolution
    || state.pendingD20Interrupt || state.pendingInterception || state.pendingTriggeredAction
    || state.pendingTurnStartGrappleDamage || state.pendingAlertSwapActorIds?.length;
}

/** Transport compatibility for pinned battles. Use only the original move/action
 * protocol, with adjacent destinations so even archived pathfinders follow the
 * preview exactly. Each step has its own durable receipt/revision. Never retry
 * an uncertain response or continue an attack across a decision window. */
export async function commandCombatInteraction(run: RoguelikeRun, intent: RoguelikeCombatIntent, send: Send): Promise<RoguelikeRun> {
  const state = run.combat_state;
  if (!state || (intent.type !== 'move' && intent.type !== 'approach_action')) return send(run, intent);
  // Explicit executable capability. Legacy encounters retain their saved
  // compatibility protocol; do not infer it from a date, name or artifact hash.
  if (state.routeCommandVersion === 1) return send(run, intent);
  const action = intent.type === 'approach_action' ? state.catalogActions.find(a => a.id === intent.actionId) : undefined;
  if (intent.type === 'approach_action' && !combatActionIsAttack(state, action)) throw Error('Для автоматического подхода выберите атаку');
  const route = intent.type === 'move'
    ? combatMovementRoute(state, intent.actorId, intent.destination)
    : combatApproachRoute(state, intent.actorId, intent.targetActorId, combatActionRangeFt(state,intent.actorId,action!));
  if (!route) throw Error('На поле нет доступного пути');
  if (!route.available) throw Error(`Нужно пройти ${route.costFt} фт., доступно ${route.availableFt} фт.`);
  const additional = intent.type === 'move' && state.pendingAdditionalMovement?.actorId === intent.actorId;
  let current = run;
  for (const destination of route.path) {
    current = await send(current, {type: 'move', actorId: intent.actorId, destination});
    const next = current.combat_state;
    if (!next) throw Error('Сервер не вернул состояние боя');
    const position = next.tokens[intent.actorId]?.position;
    if (paused(next, intent.actorId, additional) || position?.x !== destination.x || position.y !== destination.y
      || (additional && next.pendingAdditionalMovement?.actorId !== intent.actorId)) return current;
  }
  if (intent.type === 'move') return current;
  try {
    return await send(current, {type: 'action', actorId: intent.actorId, actionId: intent.actionId,
      targetIds: [intent.targetActorId], choices: intent.choices});
  } catch (cause) {
    // Movement was already committed. The caller reconciles before another click.
    if (current !== run) throw Error(`Перемещение сохранено. Не удалось подтвердить удар; состояние обновлено с сервера. ${cause instanceof Error ? cause.message : ''}`);
    throw cause;
  }
}
