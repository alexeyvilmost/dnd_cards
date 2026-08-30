import type { WorldState } from '../rules-core/domain';

export interface CombatGrappleStatusRow {
  key: string;
  name: string;
  instructions: string[];
}

function partLabel(part: string): string {
  if (part === 'main_hand') return 'основная рука';
  if (part === 'off_hand') return 'свободная рука';
  return part;
}

/** Human-readable projection of canonical grapple relations for combat inspection. */
export function combatGrappleStatusRows(
  world: Pick<WorldState, 'actors' | 'grapples'>,
  actorId: string,
): CombatGrappleStatusRow[] {
  return Object.values(world.grapples).flatMap((grapple) => {
    if (grapple.targetActorId === actorId) {
      const source = world.actors[grapple.grapplerActorId];
      return [{
        key: `grappled:${grapple.id}`,
        name: 'Схвачен',
        instructions: [
          `Захватил: ${source?.name ?? 'неизвестное существо'}.`,
          `Скорость — 0; освобождение — действием против Сл ${grapple.escapeDc}.`,
        ],
      }];
    }
    if (grapple.grapplerActorId === actorId) {
      const target = world.actors[grapple.targetActorId];
      return [{
        key: `grappling:${grapple.id}`,
        name: 'Удерживает захват',
        instructions: [
          `Цель: ${target?.name ?? 'неизвестное существо'}.`,
          `Занята: ${partLabel(grapple.sourcePart)}.`,
        ],
      }];
    }
    return [];
  }).sort((left, right) => left.key.localeCompare(right.key));
}
