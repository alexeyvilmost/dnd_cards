import type { ActorState } from '../rules-core/domain';
import {singleAttackDefenseBonus} from '../rules-core/attackDefenseRuntime';
import { effectiveActorSpeedFt, gridDistanceFt, reachableRoutes } from './tacticalGrid';
import { spatialFacts, type GridPosition, type SoloCombatState } from './types';

export interface MonsterTurnPlan {
  firstMove: GridPosition[];
  dashMove: GridPosition[];
  usesDash: boolean;
  attacks: boolean;
}

/** Spend a reaction only when its declared defense turns this known hit into a
 * miss. Critical hits cannot be parried; no speculative RNG or hidden rolls. */
export function chooseMonsterReaction(state: SoloCombatState): string | null {
  const pending = state.world.pendingResolution;
  if (pending?.type !== 'attack_reaction' || pending.attackRoll.outcome === 'crit'
    || pending.request.type !== 'reaction' || pending.request.trigger.type !== 'hit_by_attack') return null;
  const trigger = pending.request.trigger;
  return pending.request.options.flatMap(option => {
    const action = state.catalogActions.find(row => row.id === option.actionId);
    const bonus = action ? singleAttackDefenseBonus(action) : 0;
    return bonus > 0 && trigger.attackTotal < trigger.originalAc + bonus ? [{id: option.actionId, bonus}] : [];
  }).sort((a, b) => a.bonus - b.bonus || a.id.localeCompare(b.id))[0]?.id ?? null;
}

/** Pure controller using the same reachable destinations and sight as player actions. */
export function planMonsterTurn(
  state: SoloCombatState,
  monster: ActorState,
  targetActorId: string,
  attackRangeFt = 5,
  preferredRangeFt = attackRangeFt,
): MonsterTurnPlan {
  const start = state.tokens[monster.id]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!start || !target) throw new Error('ИИ не видит участника на тактической сетке');
  const range = Math.max(5, attackRangeFt);
  const preferred = Math.max(5, Math.min(range, preferredRangeFt));
  const grappled = Object.values(state.world.grapples ?? {}).some((grapple) => (
    grapple.targetActorId === monster.id
  ));
  const speed = grappled ? 0 : effectiveActorSpeedFt(monster);
  const available = Math.max(0, Math.min(speed, state.movementRemainingFt?.[monster.id] ?? speed));
  const at = (position: GridPosition): SoloCombatState => ({
    ...state,
    tokens: { ...state.tokens, [monster.id]: { ...state.tokens[monster.id], position } },
  });
  const canAttack = (position: GridPosition) => gridDistanceFt(position, target) <= range
    && spatialFacts(at(position), monster.id, targetActorId).lineOfSight;
  const rating = (position: GridPosition) => {
    const distance = gridDistanceFt(position, target);
    // Legal attacks come first; then close to the profile's normal range.
    return [canAttack(position) ? 0 : 1, Math.max(0, distance - preferred)];
  };
  const compare = (left: GridPosition, right: GridPosition) => {
    const a = rating(left);
    const b = rating(right);
    return a[0] - b[0] || a[1] - b[1];
  };
  const choose = (origin: GridPosition, feet: number) => (
    [{destination: origin, path: [] as GridPosition[], costFt: 0}, ...reachableRoutes(at(origin), monster.id, feet)].sort((left, right) => (
      compare(left.destination, right.destination)
      || left.costFt - right.costFt
      || left.destination.y - right.destination.y || left.destination.x - right.destination.x
    ))[0]
  );
  const movement = choose(start, available);
  const afterMove = movement.destination;
  const firstMove = movement.path;
  if (canAttack(afterMove)) {
    return { firstMove, dashMove: [], usesDash: false, attacks: true };
  }
  const dash = choose(afterMove, speed);
  const usefulDash = compare(dash.destination, afterMove) < 0;
  return {firstMove, dashMove: usefulDash ? dash.path : [], usesDash: usefulDash, attacks: false};
}
