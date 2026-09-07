import type { ActorState } from '../rules-core/domain';
import {
  effectiveActorSpeedFt,
  gridDistanceFt,
  occupiedPositions,
  pathToward,
} from './tacticalGrid';
import type { GridPosition, SoloCombatState } from './types';

export interface MonsterTurnPlan {
  firstMove: GridPosition[];
  dashMove: GridPosition[];
  usesDash: boolean;
  attacks: boolean;
}
/** Pure, deterministic controller. It decides intent; the engine still owns costs and attacks. */
export function planMonsterTurn(
  state: SoloCombatState,
  monster: ActorState,
  targetActorId: string,
  attackRangeFt = 5,
): MonsterTurnPlan {
  const start = state.tokens[monster.id]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!start || !target) throw new Error('ИИ не видит участника на тактической сетке');
  const range = Math.max(5, attackRangeFt);
  if (gridDistanceFt(start, target) <= range) {
    return { firstMove: [], dashMove: [], usesDash: false, attacks: true };
  }
  const grappled = Object.values(state.world.grapples ?? {}).some((grapple) => (
    grapple.targetActorId === monster.id
  ));
  const speed = grappled ? 0 : effectiveActorSpeedFt(monster);
  const occupied = occupiedPositions(state, monster.id);
  const firstPath = pathToward({ start, target, maxFeet: speed, occupied });
  const firstInRange = firstPath.findIndex((position) => gridDistanceFt(position, target) <= range);
  const firstMove = firstInRange >= 0 ? firstPath.slice(0, firstInRange + 1) : firstPath;
  const afterMove = firstMove.at(-1) ?? start;
  if (gridDistanceFt(afterMove, target) <= range) {
    return { firstMove, dashMove: [], usesDash: false, attacks: true };
  }
  const dashMove = pathToward({ start: afterMove, target, maxFeet: speed, occupied });
  return { firstMove, dashMove, usesDash: true, attacks: false };
}
