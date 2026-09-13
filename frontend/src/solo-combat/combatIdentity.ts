import { combatActorDisplayName } from '../character/familiarLabels';
import type { SoloCombatState } from './types';
import { combatRelation } from './types';

const ALLY_ACCENTS = ['#4fa56d', '#64b77c', '#3e9364', '#78c68c'];
const ENEMY_ACCENTS = ['#d8584d', '#e06f49', '#c74660', '#b84d78', '#e24b3e', '#c96a42'];

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

export interface CombatIdentity {
  side: 'ally' | 'enemy';
  accent: string;
  duplicateIndex?: number;
  duplicateCount: number;
  displayName: string;
}

export function combatIdentity(
  state: Pick<SoloCombatState, 'characterId' | 'sideByActorId' | 'tokens' | 'world'>,
  actorId: string,
): CombatIdentity {
  const relation = combatRelation(state, state.characterId, actorId);
  const side = relation === 'enemy' ? 'enemy' : 'ally';
  const token = state.tokens[actorId];
  const actor = state.world.actors[actorId];
  const duplicateKey = token?.templateId ?? (side === 'enemy' ? actor?.name : undefined);
  const duplicates = duplicateKey ? Object.values(state.tokens)
    .filter((candidate) => {
      if (candidate.templateId && token?.templateId) return candidate.templateId === token.templateId;
      return side === 'enemy' && state.world.actors[candidate.actorId]?.name === actor?.name;
    })
    .map((candidate) => candidate.actorId)
    .sort() : [actorId];
  const duplicateCount = duplicates.length;
  const duplicateIndex = duplicateCount > 1 ? duplicates.indexOf(actorId) + 1 : undefined;
  const palette = side === 'enemy' ? ENEMY_ACCENTS : ALLY_ACCENTS;
  const accent = duplicateIndex
    ? palette[(duplicateIndex - 1) % palette.length]
    : palette[stableIndex(actorId, palette.length)];
  const baseName = actor ? combatActorDisplayName(actor) : actorId;
  return {
    side,
    accent,
    duplicateIndex,
    duplicateCount,
    displayName: duplicateIndex ? `${baseName} · ${duplicateIndex}` : baseName,
  };
}
