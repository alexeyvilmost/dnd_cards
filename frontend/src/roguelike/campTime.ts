import type { EngineEvent } from '../mvp/contracts';
import type { WorldState } from '../rules-core/domain';
import { migrateWorldState } from '../rules-core/worldMigration';
import { advanceWorldObjectRounds } from '../rules-core/worldObjects';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Advance deterministic six-second durations while the run is outside combat. */
export function advanceRoguelikeCampTime(input: {
  world: WorldState;
  elapsedSeconds: number;
  actorIds?: readonly string[];
  ageObjects?: boolean;
}): { world: WorldState; events: EngineEvent[] } {
  if (!Number.isSafeInteger(input.elapsedSeconds) || input.elapsedSeconds < 0) {
    throw new Error('Некорректная длительность лагерного действия');
  }
  const rounds = Math.floor(input.elapsedSeconds / 6);
  const world = clone(input.world);
  const events: EngineEvent[] = [];
  if (!rounds) return { world, events };

  const selectedActors = input.actorIds ? new Set(input.actorIds) : null;
  for (const actor of Object.values(world.actors)) {
    if (selectedActors && !selectedActors.has(actor.id)) continue;
    actor.runtime.activeEffects = actor.runtime.activeEffects.flatMap((effect) => {
      if (effect.roundsLeft == null) return [effect];
      if (effect.roundsLeft <= rounds) {
        events.push({ type: 'effect_expired', name: effect.name });
        return [];
      }
      return [{ ...effect, roundsLeft: effect.roundsLeft - rounds }];
    });
  }

  if (input.ageObjects !== false) {
    const advanced = advanceWorldObjectRounds({ objects: world.objects, rounds });
    world.objects = advanced.objects;
  }

  // A timed concentration marker owns every linked effect and spell object.
  // If time removed any link, finish the whole concentration atomically.
  for (const [sourceActorId, concentration] of Object.entries(world.concentrations)) {
    const linkExpired = concentration.effectLinks.some(({ actorId, effectId }) => (
      !world.actors[actorId]?.runtime.activeEffects.some((effect) => effect.id === effectId)
    ));
    if (!linkExpired) continue;
    for (const { actorId, effectId } of concentration.effectLinks) {
      const actor = world.actors[actorId];
      if (actor) actor.runtime.activeEffects = actor.runtime.activeEffects.filter((effect) => effect.id !== effectId);
    }
    world.objects = Object.fromEntries(Object.entries(world.objects).filter(([, object]) => (
      object.sourceActorId !== concentration.sourceActorId
      || object.sourceActionId !== concentration.actionId
    )));
    delete world.concentrations[sourceActorId];
  }

  return { world: migrateWorldState(world), events };
}
