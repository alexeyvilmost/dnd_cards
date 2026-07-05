/**
 * Проверка и трата стоимости действий (фаза D2).
 */
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { resourceSpentEvent } from './events';

type Dict = Record<string, unknown>;

function costAmount(entry: Dict): number {
  const raw = entry.amount;
  if (raw == null) return 1;
  return typeof raw === 'number' ? raw : Number(raw) || 1;
}

/** Ключ ресурса: канон схемы {resource:'spell_slot', level:N} → spell_slot_N. */
export function costKey(entry: Dict): string {
  const resource = String(entry.resource ?? '');
  if (resource === 'spell_slot' && entry.level != null) return `spell_slot_${entry.level}`;
  return resource;
}

export function canPay(state: RuntimeState, cost: Dict[]): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const entry of cost) {
    const key = costKey(entry);
    const need = costAmount(entry);
    const have = state.resources[key] ?? 0;
    if (have < need) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}

export function pay(state: RuntimeState, cost: Dict[]): { state: RuntimeState; events: EngineEvent[] } {
  const check = canPay(state, cost);
  if (!check.ok) return { state, events: [] };

  const resources = { ...state.resources };
  const events: EngineEvent[] = [];

  for (const entry of cost) {
    const key = costKey(entry);
    const need = costAmount(entry);
    resources[key] = (resources[key] ?? 0) - need;
    events.push(resourceSpentEvent(key, need, resources[key]));
  }

  return { state: { ...state, resources }, events };
}
