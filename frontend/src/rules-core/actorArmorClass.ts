import type {ActorState} from './domain';
import {armorClassValue} from './legacy/engineAdapter';

/** Equipped/stat-block baseline plus current transient effects, shared by combat and UI. */
export function effectiveArmorClass(actor: Pick<ActorState, 'character' | 'runtime' | 'ac' | 'passives'>, runtime = actor.runtime): number {
  return effectiveArmorClassBreakdown(actor, runtime).value;
}

export function effectiveArmorClassBreakdown(actor: Pick<ActorState, 'character' | 'runtime' | 'ac' | 'passives'>, runtime = actor.runtime) {
  const withoutTransient = { ...runtime, activeEffects: [] };
  const baseline = armorClassValue(actor.character, withoutTransient, actor.passives ?? []).value;
  const projected = armorClassValue(actor.character, runtime, actor.passives ?? []);
  const offset = (actor.ac ?? baseline) - baseline;
  return {...projected, value: projected.value + offset,
    parts: [...projected.parts, ...(offset ? [{value: offset, source: 'КД профиля / обстоятельства', reason: 'Отличие профиля цели от расчёта экипировки'}] : [])]};
}
