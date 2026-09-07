import type { ActorState } from '../rules-core/domain';
import { effectiveActorSpeedFt, gridDistanceFt, reachablePositions } from './tacticalGrid';
import { spatialFacts, type GridPosition, type SoloCombatState } from './types';

export interface MonsterTurnPlan {
  firstMove: GridPosition[];
  dashMove: GridPosition[];
  usesDash: boolean;
  attacks: boolean;
}

function movementSteps(start: GridPosition, end: GridPosition): GridPosition[] {
  const steps = gridDistanceFt(start, end) / 5;
  return Array.from({ length: steps }, (_, index) => ({
    x: Math.round(start.x + (end.x - start.x) * (index + 1) / steps),
    y: Math.round(start.y + (end.y - start.y) * (index + 1) / steps),
  }));
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
    [origin, ...reachablePositions(at(origin), monster.id, feet)].sort((left, right) => (
      compare(left, right)
      || gridDistanceFt(origin, left) - gridDistanceFt(origin, right)
      || left.y - right.y || left.x - right.x
    ))[0]
  );
  const afterMove = choose(start, available);
  const firstMove = movementSteps(start, afterMove);
  if (canAttack(afterMove)) {
    return { firstMove, dashMove: [], usesDash: false, attacks: true };
  }
  const afterDash = choose(afterMove, speed);
  const usefulDash = compare(afterDash, afterMove) < 0;
  return {
    firstMove,
    dashMove: usefulDash ? movementSteps(afterMove, afterDash) : [],
    usesDash: usefulDash,
    attacks: false,
  };
}
