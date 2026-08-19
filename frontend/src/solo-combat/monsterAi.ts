import type { ActorState } from '../rules-core/domain';
import { gridDistanceFt, occupiedPositions, pathToward } from './tacticalGrid';
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
): MonsterTurnPlan {
  const start = state.tokens[monster.id]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!start || !target) throw new Error('ИИ не видит участника на тактической сетке');
  if (gridDistanceFt(start, target) <= 5) {
    return { firstMove: [], dashMove: [], usesDash: false, attacks: true };
  }
  const speed = Number(monster.character.characterSpeed ?? 30);
  const occupied = occupiedPositions(state, monster.id);
  const firstMove = pathToward({ start, target, maxFeet: speed, occupied });
  const afterMove = firstMove.at(-1) ?? start;
  if (gridDistanceFt(afterMove, target) <= 5) {
    return { firstMove, dashMove: [], usesDash: false, attacks: true };
  }
  const dashMove = pathToward({ start: afterMove, target, maxFeet: speed, occupied });
  return { firstMove, dashMove, usesDash: true, attacks: false };
}
