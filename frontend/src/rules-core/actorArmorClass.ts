import type {ActorState} from './domain';
import {armorClassValue} from './legacy/engineAdapter';

/** Equipped/stat-block baseline plus current transient effects, shared by combat and UI. */
export function effectiveArmorClass(actor: Pick<ActorState, 'character' | 'runtime' | 'ac' | 'passives'>, runtime = actor.runtime): number {
  return effectiveArmorClassBreakdown(actor, runtime).value;
}

export function effectiveArmorClassBreakdown(actor: Pick<ActorState, 'character' | 'runtime' | 'ac' | 'passives'>, runtime = actor.runtime) {
  const withoutTransient = { ...runtime, activeEffects: [] };
  const originalCharacter = { ...actor.character, spatialObservations: undefined,
    ...(actor.character.combatSpatialBase ?? {}) };
  const baseline = armorClassValue(originalCharacter, withoutTransient, (actor.passives ?? []).filter(passive => passive.combat_aura_projection !== true)).value;
  const projected = armorClassValue(actor.character, runtime, actor.passives ?? []);
  const offset = (actor.ac ?? baseline) - baseline;
  return {...projected, value: projected.value + offset,
    parts: [...projected.parts, ...(offset ? [{value: offset, source: 'КД профиля / обстоятельства', reason: 'Отличие профиля цели от расчёта экипировки'}] : [])]};
}
