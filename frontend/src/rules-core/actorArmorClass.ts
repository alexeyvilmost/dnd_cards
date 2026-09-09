import type {ActorState} from './domain';
import {armorClassValue} from './legacy/engineAdapter';

/** Equipped/stat-block baseline plus current transient effects, shared by combat and UI. */
export function effectiveArmorClass(actor: Pick<ActorState, 'character' | 'runtime' | 'ac' | 'passives'>, runtime = actor.runtime): number {
  const withoutTransient = { ...runtime, activeEffects: [] };
  const baseline = armorClassValue(actor.character, withoutTransient, actor.passives ?? []).value;
  const projected = armorClassValue(actor.character, runtime, actor.passives ?? []).value;
  return (actor.ac ?? baseline) + (projected - baseline);
}

