/**
 * Ручное управление HP (фаза F3).
 */
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { damageEvent, healingEvent, narrativeEvent, tempHpEvent } from './events';

function clone(state: RuntimeState): RuntimeState {
  return { ...state, hp: { ...state.hp } };
}

export function applyDamage(
  state: RuntimeState,
  amount: number,
  damageType = 'ручной',
): { state: RuntimeState; events: EngineEvent[] } {
  const next = clone(state);
  let remaining = Math.max(0, amount);
  const events: EngineEvent[] = [];

  if (next.hp.temp > 0) {
    const fromTemp = Math.min(next.hp.temp, remaining);
    next.hp.temp -= fromTemp;
    remaining -= fromTemp;
  }
  if (remaining > 0) {
    next.hp.current = Math.max(0, next.hp.current - remaining);
  }

  events.push(damageEvent(amount, damageType));
  if (next.hp.current === 0) {
    events.push(narrativeEvent('Без сознания (0 HP)'));
  }
  return { state: next, events };
}

export function applyHealing(
  state: RuntimeState,
  amount: number,
): { state: RuntimeState; events: EngineEvent[] } {
  const next = clone(state);
  const before = next.hp.current;
  next.hp.current = Math.min(next.hp.max, next.hp.current + amount);
  const healed = next.hp.current - before;
  const events: EngineEvent[] = healed > 0 ? [healingEvent(healed)] : [];
  return { state: next, events };
}

export function applyTempHp(
  state: RuntimeState,
  amount: number,
): { state: RuntimeState; events: EngineEvent[] } {
  const next = clone(state);
  next.hp.temp = Math.max(next.hp.temp, amount);
  return { state: next, events: [tempHpEvent(amount)] };
}
