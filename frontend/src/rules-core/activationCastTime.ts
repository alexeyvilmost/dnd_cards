import type { JsonObject } from './domain';

export type ActivationCastTimeUnit =
  | 'action'
  | 'bonus_action'
  | 'reaction'
  | 'round'
  | 'minute'
  | 'hour';

export interface ActivationCastTimePolicy {
  unit: ActivationCastTimeUnit;
  amount: number;
  seconds: number;
  atomicInEncounter: boolean;
}

export type ActivationCastTimeParseResult =
  | { status: 'none' }
  | { status: 'invalid'; issue: string }
  | { status: 'valid'; policy: ActivationCastTimePolicy };

const UNIT_SECONDS: Record<ActivationCastTimeUnit, number> = {
  action: 6,
  bonus_action: 6,
  reaction: 6,
  round: 6,
  minute: 60,
  hour: 3_600,
};

/** Parse the data-owned casting duration without looking at spell/card identity or display text. */
export function parseActivationCastTime(mechanics: JsonObject): ActivationCastTimeParseResult {
  const activation = mechanics.activation;
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
    return activation === undefined
      ? { status: 'none' }
      : { status: 'invalid', issue: 'activation must be an object' };
  }
  const raw = (activation as JsonObject).cast_time;
  if (raw === undefined) return { status: 'none' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'invalid', issue: 'activation.cast_time must be an object' };
  }
  const value = raw as JsonObject;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['amount', 'unit'])) {
    return { status: 'invalid', issue: 'activation.cast_time must declare exactly amount and unit' };
  }
  if (!Object.hasOwn(UNIT_SECONDS, String(value.unit ?? ''))) {
    return { status: 'invalid', issue: 'activation.cast_time.unit is invalid' };
  }
  if (!Number.isInteger(value.amount) || Number(value.amount) < 1) {
    return { status: 'invalid', issue: 'activation.cast_time.amount must be a positive integer' };
  }
  const unit = value.unit as ActivationCastTimeUnit;
  const amount = Number(value.amount);
  const seconds = UNIT_SECONDS[unit] * amount;
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    return { status: 'invalid', issue: 'activation.cast_time duration is outside the supported range' };
  }
  return {
    status: 'valid',
    policy: {
      unit,
      amount,
      seconds,
      atomicInEncounter: amount === 1
        && (unit === 'action' || unit === 'bonus_action' || unit === 'reaction'),
    },
  };
}
