/**
 * Покрытие правил, детектор №0 — «тихо инертные» фичи классов/видов.
 * (docs/rules-coverage-plan-2026-07-11.md, этап 0.6.)
 *
 * Ловит то, что НЕ ловит ни один прежний инструмент: фичу, привязанную к классу/виду
 * через level_progression или related_effects, у которой mechanics пусты (или ссылка
 * битая). content.readiness проверяет только НЕПУСТОТУ уровней 1–2 базовых классов;
 * forge.sweep собирает только уровень 1 и НЕ трогает 48 подклассов; mechanics.sweep
 * исполняет механику, а у инертной фичи исполнять нечего. Поэтому фича с mechanics:null
 * на уровне 3+ подкласса проходит все гейты незамеченной.
 *
 * Модель как в mechanics.sweep (baseline KNOWN_INERT):
 *  - битая ссылка (id фичи не резолвится) → ЖЁСТКИЙ провал, допускается 0;
 *  - инертная фича (резолвится, но mechanics пусты) → провал, ЕСЛИ её нет в baseline;
 *  - baseline-фича, у которой ПОЯВИЛАСЬ механика (или которая исчезла) → провал
 *    «убери из baseline» — так список честно сокращается к нулю по мере покрытия.
 *
 * Запуск: MVP_CONTENT=1 npm run test:mvp (без флага — скипается).
 */
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

const RUN = !!(typeof process !== 'undefined' && process.env.MVP_CONTENT);
const BASE = (typeof process !== 'undefined' && process.env.API_URL) || 'https://backend-production-41c3.up.railway.app';
const d = describe.skipIf(!RUN);

/**
 * BASELINE осознанно-инертных фич (card_number). Каждая — реальная дыра покрытия,
 * ждущая классификации (full/partial/needs_engine/narrative) в реестре канона.
 * ПРАВИЛО: когда фиче добавили механику ИЛИ подтвердили как narrative в реестре —
 * убрать отсюда. Цель — пустой список.
 */
const KNOWN_INERT: Record<string, string> = {
  'EFFECT-0064': 'Специалист школы Воплощения (Воплотитель L3) — классифицировать',
  'EFFECT-0069': 'Специалист школы Иллюзии (Иллюзионист L3) — классифицировать',
  'EFFECT-0074': 'Специалист школы Ограждения (Оградитель L3) — классифицировать',
  'EFFECT-0079': 'Специалист школы Прорицания (Прорицатель L3) — классифицировать',
  'EFFECT-0206': 'Знания охотника (Охотник L3) — вероятно narrative',
  'EFFECT-0218': 'Заманивающий трюк (Странник фей L7) — классифицировать',
  'EFFECT-0230': 'Психическая защита (Аберрантное L6) — needs mechanics: сопротивление психике',
};

type Entity = { id?: string; card_number?: string; name?: string; mechanics?: unknown };
type ClassRow = { name?: string; level_progression?: Record<string, { effects?: string[]; actions?: string[] }>; related_effects?: string[]; related_actions?: string[] };
type RaceRow = ClassRow;

async function fetchAll(path: string, key: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=200`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = (data[key] || []) as Record<string, unknown>[];
    items.push(...batch);
    if (batch.length < 200) break;
    page++;
  }
  return items;
}

function hasMechanics(e?: Entity): boolean {
  return !!(e && e.mechanics && typeof e.mechanics === 'object' && Object.keys(e.mechanics as object).length > 0);
}

d('Покрытие: детектор инертных фич классов/видов', () => {
  it('нет битых ссылок; инертные фичи ⊆ baseline; baseline не «протух»', async () => {
    const [classes, races, effects, actions] = await Promise.all([
      fetchAll('/api/classes', 'classes') as Promise<ClassRow[]>,
      fetchAll('/api/races', 'races') as Promise<RaceRow[]>,
      fetchAll('/api/effects', 'effects') as Promise<Entity[]>,
      fetchAll('/api/actions', 'actions') as Promise<Entity[]>,
    ]);
    // страховка от «пустой БД / тест вхолостую»
    expect(classes.length, 'классов не получено').toBeGreaterThanOrEqual(12);
    expect(effects.length, 'эффектов не получено').toBeGreaterThanOrEqual(100);

    const byId = new Map<string, Entity>();
    for (const e of effects) if (e.id) byId.set(e.id, e);
    for (const a of actions) if (a.id) byId.set(a.id, a);

    // id фичи → откуда сослались (для читаемого отчёта)
    const refs = new Map<string, string>();
    const ref = (id: string | undefined, src: string) => {
      if (id && !refs.has(id)) refs.set(id, src);
    };
    for (const c of classes) {
      const lp = c.level_progression || {};
      for (const lvl of Object.keys(lp)) {
        for (const e of lp[lvl].effects || []) ref(e, `${c.name} L${lvl}`);
        for (const a of lp[lvl].actions || []) ref(a, `${c.name} L${lvl} (действие)`);
      }
      for (const e of c.related_effects || []) ref(e, `${c.name} (related)`);
      for (const a of c.related_actions || []) ref(a, `${c.name} (related-действие)`);
    }
    for (const r of races) {
      for (const e of r.related_effects || []) ref(e, `${r.name}`);
      for (const a of r.related_actions || []) ref(a, `${r.name} (действие)`);
      const lp = r.level_progression || {};
      for (const lvl of Object.keys(lp)) for (const e of lp[lvl].effects || []) ref(e, `${r.name} L${lvl}`);
    }

    const broken: string[] = [];
    const inertNow = new Map<string, { name: string; src: string }>(); // card_number → инфо
    for (const [id, src] of refs) {
      const ent = byId.get(id);
      if (!ent) { broken.push(`битая ссылка ${id} ← ${src}`); continue; }
      if (!hasMechanics(ent)) {
        inertNow.set(ent.card_number || id, { name: ent.name || '?', src });
      }
    }

    // 1) битые ссылки недопустимы вовсе
    expect(broken, `битые ссылки фич:\n${broken.join('\n')}`).toHaveLength(0);

    // 2) новые инертные фичи (не в baseline) = регрессия покрытия
    const newInert = [...inertNow.entries()]
      .filter(([num]) => !(num in KNOWN_INERT))
      .map(([num, info]) => `${num} «${info.name}» ← ${info.src}`);
    expect(
      newInert,
      `НОВЫЕ инертные фичи (mechanics пусты, привязаны к классу/виду) — добавь механику или, если narrative, внеси в KNOWN_INERT с причиной:\n${newInert.join('\n')}`,
    ).toHaveLength(0);

    // 3) baseline не должен «протухать»: фича из KNOWN_INERT, у которой появилась
    //    механика (или которую удалили) — сигнал убрать её из baseline.
    const stale = Object.keys(KNOWN_INERT).filter((num) => !inertNow.has(num));
    expect(
      stale,
      `протухший baseline: эти фичи больше НЕ инертны (получили механику/удалены) — убери из KNOWN_INERT:\n${stale.join('\n')}`,
    ).toHaveLength(0);
  }, 120000);
});
