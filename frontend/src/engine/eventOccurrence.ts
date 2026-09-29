import type { RuntimeState } from '../mvp/contracts';
import type { DomainEvent } from './dispatch';

export const OCCURRENCE_PERIODS = ['turn', 'round', 'encounter', 'short_rest', 'long_rest', 'lifetime'] as const;
export type OccurrencePeriod = typeof OCCURRENCE_PERIODS[number];
export interface EventOccurrence {
  /** Exactly this occurrence, or every Nth occurrence; exactly one is required. */
  at?: number;
  every?: number;
  per: OccurrencePeriod;
  group_by?: 'target';
}

export function eventOccurrenceCount(state: RuntimeState | undefined, id: string, per: OccurrencePeriod, target?: string): number {
  if (!state || !id || !OCCURRENCE_PERIODS.includes(per)) return 0;
  return state.eventOccurrences?.[JSON.stringify([id, per, target ?? null])]?.count ?? 0;
}

export function validateEventOccurrence(value: unknown): value is EventOccurrence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const occurrence = value as EventOccurrence;
  const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0;
  return OCCURRENCE_PERIODS.includes(occurrence.per)
    && (occurrence.group_by === undefined || occurrence.group_by === 'target')
    && ((positive(occurrence.at) && occurrence.every === undefined)
      || (positive(occurrence.every) && occurrence.at === undefined));
}

/** Count a matching event once, before deciding whether its effects are due.
 * No resource/RNG work happens here. The caller persists the returned state in
 * the same authoritative command as the effect; replay uses that receipt. */
export function advanceEventOccurrence(
  state: RuntimeState,
  listener: { id: string; occurrence?: EventOccurrence },
  event: DomainEvent,
): { state: RuntimeState; eligible: boolean; ordinal: number } {
  const occurrence = listener.occurrence;
  if (occurrence === undefined) return { state, eligible: true, ordinal: 0 };
  if (!listener.id || !validateEventOccurrence(occurrence)) throw new Error('Invalid event occurrence declaration');
  const target = event.target ?? event.data?.targetId;
  if (occurrence.group_by === 'target' && (typeof target !== 'string' || !target)) {
    return { state, eligible: false, ordinal: 0 };
  }
  // JSON tuple avoids collisions between ids and arbitrary actor identifiers.
  const key = JSON.stringify([listener.id, occurrence.per, occurrence.group_by === 'target' ? target : null]);
  const previous = state.eventOccurrences?.[key];
  const eventId = typeof event.data?.eventId === 'string' ? event.data.eventId : undefined;
  if (eventId && previous?.lastEventId === eventId) return { state, eligible: false, ordinal: previous.count };
  const ordinal = (previous?.count ?? 0) + 1;
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Event occurrence counter overflow');
  const next = { ...state, eventOccurrences: { ...state.eventOccurrences,
    [key]: { count: ordinal, period: occurrence.per, ...(eventId ? { lastEventId: eventId } : {}) },
  } };
  return { state: next, ordinal,
    eligible: occurrence.at !== undefined ? ordinal === occurrence.at : ordinal % occurrence.every! === 0 };
}

/** Reset only a declared cadence. Long rest also renews short-rest rules, but
 * never lifetime rules; combat entry similarly never erases lifetime ordinals. */
export function resetEventOccurrences(state: RuntimeState, period: Exclude<OccurrencePeriod, 'lifetime'>): RuntimeState {
  const reset = new Set<string>(period === 'long_rest' ? ['long_rest', 'short_rest'] : [period]);
  const entries = Object.entries(state.eventOccurrences ?? {});
  const retained = entries.filter(([, value]) => !reset.has(value.period));
  if (retained.length === entries.length && (period !== 'turn' || state.turnMovementFt === 0)) return state;
  return { ...state, eventOccurrences: Object.fromEntries(retained), ...(period === 'turn' ? { turnMovementFt: 0 } : {}) };
}

/** Record observed travel, separately from movement-budget costs and teleports. */
export function recordTurnMovement(state: RuntimeState, distanceFt: number): RuntimeState {
  if (!Number.isFinite(distanceFt) || distanceFt < 0) throw new Error('Travel distance must be finite and non-negative');
  const total = (state.turnMovementFt ?? 0) + distanceFt;
  if (!Number.isFinite(total)) throw new Error('Travel distance overflow');
  return { ...state, turnMovementFt: total };
}
