/**
 * Концентрация (PHB 2024): одно концентрируемое заклинание за раз; каст нового
 * прерывает предыдущее; при получении урона — спасбросок ТЕЛ СЛ max(10, урон/2);
 * недееспособность прерывает концентрацию.
 */
import type { ActiveEffectEntry, EngineEvent, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export function concentrationEntry(state: RuntimeState): ActiveEffectEntry | null {
  return state.activeEffects.find((e) => (e.mechanics as Record<string, unknown>)?.kind === 'concentration') ?? null;
}

function storedEffectIds(entry: ActiveEffectEntry): string[] {
  const ids = (entry.mechanics as Dict).effectIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function fallbackLinkedEffects(
  state: RuntimeState,
  entry: ActiveEffectEntry,
  preserveIds: Set<string> = new Set(),
): ActiveEffectEntry[] {
  return state.activeEffects.filter((effect) => {
    if (effect.id === entry.id || preserveIds.has(effect.id)) return false;
    const duration = (effect.mechanics as Dict).duration as Dict | undefined;
    return duration?.concentration === true && effect.source === entry.source;
  });
}

function linkedEffects(
  state: RuntimeState,
  entry: ActiveEffectEntry,
  preserveIds: Set<string> = new Set(),
): ActiveEffectEntry[] {
  const ids = storedEffectIds(entry);
  if (ids.length) {
    const linked = new Set(ids);
    return state.activeEffects.filter((effect) => linked.has(effect.id) && !preserveIds.has(effect.id));
  }
  // Совместимость с концентрацией, сохранённой до появления явной связи effectIds.
  return fallbackLinkedEffects(state, entry, preserveIds);
}

function removeConcentrationGroup(
  state: RuntimeState,
  entry: ActiveEffectEntry,
  preserveIds: Set<string> = new Set(),
): { state: RuntimeState; removed: ActiveEffectEntry[] } {
  const removed = linkedEffects(state, entry, preserveIds);
  const removedIds = new Set([entry.id, ...removed.map((effect) => effect.id)]);
  return {
    state: {
      ...state,
      activeEffects: state.activeEffects.filter((effect) => !removedIds.has(effect.id)),
    },
    removed,
  };
}

/** Начать концентрацию на заклинании: снять прежнюю, повесить чип. */
export function startConcentration(
  state: RuntimeState,
  spellName: string,
  effectIds: string[] = [],
): { state: RuntimeState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  let next = state;
  const prev = concentrationEntry(state);
  if (prev) {
    const removed = removeConcentrationGroup(next, prev, new Set(effectIds));
    next = removed.state;
    events.push({ type: 'effect_expired', name: prev.name });
    for (const effect of removed.removed) {
      events.push({ type: 'effect_expired', name: effect.name });
    }
    events.push({ type: 'narrative', text: `Концентрация прервана: новое заклинание вытесняет «${prev.name.replace(/^Концентрация: /, '')}».` });
  }
  const linked = next.activeEffects.filter((effect) => effectIds.includes(effect.id));
  const roundsLeft = linked.reduce<number | undefined>((max, effect) => (
    effect.roundsLeft == null ? max : Math.max(max ?? 0, effect.roundsLeft)
  ), undefined);
  const entry: ActiveEffectEntry = {
    id: `conc-${Date.now()}`,
    name: `Концентрация: ${spellName}`,
    mechanics: { kind: 'concentration', spell: spellName, effectIds },
    ...(roundsLeft != null ? { roundsLeft } : { expiry: 'manual' }),
    source: spellName,
  };
  events.push({ type: 'effect_applied', name: entry.name });
  return { state: { ...next, activeEffects: [...next.activeEffects, entry] }, events };
}

/** Сбросить концентрацию (провал спасброска, недееспособность, вручную). */
export function dropConcentration(
  state: RuntimeState,
  reason: string,
): { state: RuntimeState; events: EngineEvent[] } {
  const prev = concentrationEntry(state);
  if (!prev) return { state, events: [] };
  const removed = removeConcentrationGroup(state, prev);
  return {
    state: removed.state,
    events: [
      { type: 'effect_expired', name: prev.name },
      ...removed.removed.map((effect): EngineEvent => ({ type: 'effect_expired', name: effect.name })),
      { type: 'narrative', text: `Концентрация потеряна (${reason}).` },
    ],
  };
}

/** СЛ проверки концентрации от урона (PHB 2024): max(10, урон/2), потолок 30. */
export function concentrationDC(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}
