import {hideEligibilityIssue} from '../rules-core/hide';
import type {HideEligibilityFacts} from '../rules-core/domain';
import {spatialFacts, type SoloCombatState} from './types';

/** Facts come from the persisted board, never from the player's action payload. */
export function combatHideFacts(state: SoloCombatState, actorId: string): HideEligibilityFacts {
  const position = state.tokens[actorId]?.position;
  if (!position || !state.world.actors[actorId]) throw new Error('На поле отсутствует участник действия');
  const heavilyObscured = Object.values(state.combatAreas ?? {}).some(area => area.heavilyObscured
    && area.cells.some(cell => cell.x === position.x && cell.y === position.y));
  const visibleToAnyEnemy = Object.values(state.world.actors).some(enemy => enemy.id !== actorId
    && enemy.runtime.hp.current > 0 && state.tokens[enemy.id]
    && spatialFacts(state, enemy.id, actorId, false).relation === 'enemy'
    && spatialFacts(state, enemy.id, actorId, false).canSeeTarget === true);
  return {factsSource: 'board', boardRevision: state.boardRevision, heavilyObscured,
    cover: 'none', visibleToAnyEnemy};
}

export function combatHideIssue(state: SoloCombatState, actorId: string): string | null {
  const facts = combatHideFacts(state, actorId);
  if (!hideEligibilityIssue(facts)) return null;
  return facts.visibleToAnyEnemy ? 'Нельзя спрятаться, пока вас видит враг'
    : 'Для Засады требуется сильная заслонённость или укрытие на три четверти';
}
