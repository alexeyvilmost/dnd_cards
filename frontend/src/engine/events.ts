/**
 * Протокол событий движка (фаза B1): фабрики и сериализация.
 */
import type { EngineEvent, RollLog } from '../mvp/contracts';

export type { EngineEvent, RollLog };

export interface StoredCharacterEvent {
  id?: string;
  character_id?: string;
  ts?: string;
  type: string;
  payload: EngineEvent;
}

// ─── Фабрики ───────────────────────────────────────────────────────────────

export function rollEvent(label: string, roll: RollLog): EngineEvent {
  return { type: 'roll', label, roll };
}

export function damageEvent(amount: number, damageType: string, roll?: RollLog): EngineEvent {
  return { type: 'damage', amount, damageType, roll };
}

export function healingEvent(amount: number, roll?: RollLog): EngineEvent {
  return { type: 'healing', amount, roll };
}

export function narrativeEvent(text: string): EngineEvent {
  return { type: 'narrative', text };
}

export function resourceSpentEvent(resource: string, amount: number, remaining: number): EngineEvent {
  return { type: 'resource_spent', resource, amount, remaining };
}

export function turnStartedEvent(): EngineEvent {
  return { type: 'turn_started' };
}

// ─── Сериализация ──────────────────────────────────────────────────────────

export function serializeEngineEvent(event: EngineEvent): string {
  return JSON.stringify(event);
}

export function deserializeEngineEvent(json: string): EngineEvent {
  const parsed = JSON.parse(json) as EngineEvent;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('Невалидное событие движка');
  }
  return parsed;
}

export function serializeStoredEvent(row: StoredCharacterEvent): string {
  return JSON.stringify({
    ...row,
    payload: row.payload,
  });
}

export function deserializeStoredEvent(json: string): StoredCharacterEvent {
  const parsed = JSON.parse(json) as StoredCharacterEvent;
  if (!parsed?.type || !parsed.payload) throw new Error('Невалидная запись лога');
  deserializeEngineEvent(JSON.stringify(parsed.payload));
  return parsed;
}

/** Развёрнутая разбивка броска для панели журнала. */
export function formatRollBreakdown(roll: RollLog): string {
  const kept = roll.dice.filter((d) => !d.discarded);
  const discarded = roll.dice.filter((d) => d.discarded);
  const segments: string[] = [];

  if (kept.length === 1) segments.push(`к20: ${kept[0].result}`);
  else if (kept.length > 0) segments.push(`к20: ${kept.map((d) => d.result).join(', ')}`);
  if (discarded.length) segments.push(`отброшено ${discarded.map((d) => d.result).join(', ')}`);
  for (const m of roll.modifiers) {
    const sign = m.value >= 0 ? '+' : '';
    const reason = m.reason ? ` (${m.reason})` : '';
    segments.push(`${sign}${m.value} ${m.source}${reason}`);
  }
  let text = segments.join(' → ');
  if (roll.modifiers.length) text += ` = ${roll.total}`;
  if (roll.target) {
    const label = roll.target.type === 'ac' ? 'КЗ' : 'СЛ';
    text += ` vs ${label} ${roll.target.value}`;
    if (roll.outcome === 'crit') text += ' — крит';
    else if (roll.outcome === 'hit') text += ' — попадание';
    else if (roll.outcome === 'miss') text += ' — промах';
    else if (roll.outcome === 'success') text += ' — успех';
    else if (roll.outcome === 'fail') text += ' — провал';
  }
  return text;
}

/** Текстовое описание события для UI журнала. */
export function describeEngineEvent(event: EngineEvent): string {
  switch (event.type) {
    case 'roll':
      return `${event.label}: ${event.roll.text}`;
    case 'damage':
      return `Урон ${event.amount} (${event.damageType})${event.roll ? ` · ${event.roll.text}` : ''}`;
    case 'healing':
      return `Лечение ${event.amount}${event.roll ? ` · ${event.roll.text}` : ''}`;
    case 'temp_hp':
      return `Временные HP +${event.amount}`;
    case 'resource_spent':
      return `Потрачено ${event.resource}: ${event.amount} (осталось ${event.remaining})`;
    case 'resource_restored':
      return `Восстановлено ${event.resource}: +${event.amount} (сейчас ${event.current})`;
    case 'effect_applied':
      return `Эффект: ${event.name}${event.sourceAction ? ` (${event.sourceAction})` : ''}`;
    case 'effect_expired':
      return `Эффект снят: ${event.name}`;
    case 'condition_applied':
      return `Состояние: ${event.condition}`;
    case 'turn_started':
      return 'Начало хода';
    case 'short_rest':
      return 'Короткий отдых';
    case 'long_rest':
      return 'Длинный отдых';
    case 'narrative':
      return event.text;
    default:
      return JSON.stringify(event);
  }
}
