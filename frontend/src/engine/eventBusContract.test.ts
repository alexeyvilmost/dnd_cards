/**
 * C3 — контракт шины событий. Гарантирует, что словарь событий движка
 * (EMITTED_EVENTS ∪ PLANNED_EVENTS) точно совпадает с enum `trigger.event` схемы механик.
 * Защита от дрейфа: добавили событие в схему — обязаны решить, эмитим его или планируем
 * (иначе движок молча проигнорирует триггер, который конструктор разрешает авторить).
 */
import { describe, expect, it } from 'vitest';
import { EMITTED_EVENTS, PLANNED_EVENTS } from './execute';
import schema from '../schemas/mechanics.schema.json';

function findEventEnum(node: unknown): string[] | null {
  if (!node || typeof node !== 'object') return null;
  const o = node as Record<string, unknown>;
  const ev = (o.properties as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
  if (ev && Array.isArray(ev.enum)) return ev.enum as string[];
  for (const k of Object.keys(o)) {
    const r = findEventEnum(o[k]);
    if (r) return r;
  }
  return null;
}

describe('C3 — контракт шины событий', () => {
  const schemaEnum = findEventEnum(schema);

  it('в схеме найден enum trigger.event', () => {
    expect(schemaEnum, 'trigger.event.enum должен существовать в схеме').toBeTruthy();
    expect(schemaEnum!.length).toBeGreaterThan(0);
  });

  it('каждое событие схемы либо эмитится (EMITTED), либо запланировано (PLANNED)', () => {
    const covered = new Set<string>([...EMITTED_EVENTS, ...PLANNED_EVENTS]);
    const missing = (schemaEnum ?? []).filter((e) => !covered.has(e));
    expect(missing, `не покрыты в EMITTED/PLANNED: ${missing.join(', ')}`).toEqual([]);
  });

  it('нет лишних событий: EMITTED ∪ PLANNED ⊆ enum схемы', () => {
    const enumSet = new Set(schemaEnum ?? []);
    const extra = [...EMITTED_EVENTS, ...PLANNED_EVENTS].filter((e) => !enumSet.has(e));
    expect(extra, `нет в схеме: ${extra.join(', ')}`).toEqual([]);
  });

  it('EMITTED и PLANNED не пересекаются', () => {
    const planned = new Set<string>(PLANNED_EVENTS);
    const overlap = EMITTED_EVENTS.filter((e) => planned.has(e));
    expect(overlap, `дубли: ${overlap.join(', ')}`).toEqual([]);
  });
});
