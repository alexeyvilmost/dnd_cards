/**
 * Концентрация (PHB 2024): одно концентрируемое заклинание за раз; каст нового
 * прерывает предыдущее; при получении урона — спасбросок ТЕЛ СЛ max(10, урон/2);
 * недееспособность прерывает концентрацию.
 */
import type { ActiveEffectEntry, EngineEvent, RuntimeState } from '../mvp/contracts';

export function concentrationEntry(state: RuntimeState): ActiveEffectEntry | null {
  return state.activeEffects.find((e) => (e.mechanics as Record<string, unknown>)?.kind === 'concentration') ?? null;
}

/** Начать концентрацию на заклинании: снять прежнюю, повесить чип. */
export function startConcentration(
  state: RuntimeState,
  spellName: string,
): { state: RuntimeState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  let effects = state.activeEffects;
  const prev = concentrationEntry(state);
  if (prev) {
    effects = effects.filter((e) => e.id !== prev.id);
    events.push({ type: 'effect_expired', name: prev.name });
    events.push({ type: 'narrative', text: `Концентрация прервана: новое заклинание вытесняет «${prev.name.replace(/^Концентрация: /, '')}».` });
  }
  const entry: ActiveEffectEntry = {
    id: `conc-${Date.now()}`,
    name: `Концентрация: ${spellName}`,
    mechanics: { kind: 'concentration', spell: spellName },
    expiry: 'manual',
    source: spellName,
  };
  events.push({ type: 'effect_applied', name: entry.name });
  return { state: { ...state, activeEffects: [...effects, entry] }, events };
}

/** Сбросить концентрацию (провал спасброска, недееспособность, вручную). */
export function dropConcentration(
  state: RuntimeState,
  reason: string,
): { state: RuntimeState; events: EngineEvent[] } {
  const prev = concentrationEntry(state);
  if (!prev) return { state, events: [] };
  return {
    state: { ...state, activeEffects: state.activeEffects.filter((e) => e.id !== prev.id) },
    events: [
      { type: 'effect_expired', name: prev.name },
      { type: 'narrative', text: `Концентрация потеряна (${reason}).` },
    ],
  };
}

/** СЛ проверки концентрации от урона. */
export function concentrationDC(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}
