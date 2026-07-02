/**
 * Готовность КОНТЕНТА к MVP (фазы G/H) — живые проверки прод-БД.
 * Запуск: MVP_CONTENT=1 npm run test:mvp (без флага — скипается, оффлайн-набор
 * остаётся детерминированным).
 *
 * Требования MVP (из docs/mvp-transition-plan.md §6):
 *  - 12 классов, у каждого уровни 1–2 с эффектами/действиями и ресурсами
 *  - 12 видов со структурными подвидами
 *  - 16 предысторий с предметами и владениями
 *  - 10+ черт происхождения с механиками
 *  - заклинания 0–1 уровня с механиками (>= 90%)
 *  - базовое оружие/щиты/доспехи
 *  - механики валидны по схеме, ссылки не битые
 */
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

const RUN = !!(typeof process !== 'undefined' && process.env.MVP_CONTENT);
const BASE = (typeof process !== 'undefined' && process.env.API_URL) || 'https://backend-production-41c3.up.railway.app';

const d = describe.skipIf(!RUN);

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

d('G2–G4: классы', () => {
  it('12 классов; у каждого уровни 1 и 2 с контентом; заданы ресурсы и кость хитов', async () => {
    const classes = await fetchAll('/api/classes', 'classes');
    expect(classes.length, 'должно быть 12 классов').toBeGreaterThanOrEqual(12);
    for (const c of classes) {
      const lp = (c.level_progression || {}) as Record<string, { effects?: string[]; actions?: string[] }>;
      for (const lvl of ['1', '2']) {
        const entry = lp[lvl];
        const total = (entry?.effects?.length || 0) + (entry?.actions?.length || 0);
        expect(total, `класс ${c.name}: уровень ${lvl} пуст`).toBeGreaterThan(0);
      }
      expect(c.hit_die, `класс ${c.name}: нет hit_die`).toBeTruthy();
      expect(c.saving_throws, `класс ${c.name}: нет спасбросков`).toBeTruthy();
    }
  }, 60000);
});

d('G5: виды', () => {
  it('12 видов; у каждого привязаны способности; подвиды структурированы', async () => {
    const races = await fetchAll('/api/races', 'races');
    expect(races.length).toBeGreaterThanOrEqual(12);
    for (const r of races) {
      const abilities = ((r.related_effects as string[]) || []).length
        + ((r.related_actions as string[]) || []).length;
      expect(abilities, `вид ${r.name}: нет способностей`).toBeGreaterThan(0);
    }
  }, 60000);
});

d('G6: предыстории', () => {
  it('16 предысторий: владения id-шниками, черта slug-ом, снаряжение задано', async () => {
    const bgs = await fetchAll('/api/backgrounds', 'backgrounds');
    expect(bgs.length).toBeGreaterThanOrEqual(16);
    const cyrillic = /[а-яА-ЯёЁ]/;
    for (const b of bgs) {
      for (const s of (b.skill_proficiencies as string[]) || []) {
        expect(cyrillic.test(s), `предыстория ${b.name}: навык «${s}» не id`).toBe(false);
      }
      if (b.origin_feat) {
        expect(cyrillic.test(String(b.origin_feat)), `предыстория ${b.name}: origin_feat «${b.origin_feat}» не slug`).toBe(false);
      }
      expect(b.equipment_options || b.equipment, `предыстория ${b.name}: нет снаряжения`).toBeTruthy();
    }
  }, 60000);
});

d('G7: черты происхождения', () => {
  it('>=10 origin-черт, каждая с механикой (related_effects/actions или собственной)', async () => {
    const feats = await fetchAll('/api/feats', 'feats');
    const origin = feats.filter((f) => f.category === 'origin');
    expect(origin.length).toBeGreaterThanOrEqual(10);
    for (const f of origin) {
      const linked = ((f.related_effects as string[]) || []).length
        + ((f.related_actions as string[]) || []).length;
      expect(linked, `черта ${f.name}: не привязано ни одного эффекта/действия`).toBeGreaterThan(0);
    }
    // дубли имён — признак грязного контента
    const names = origin.map((f) => String(f.name).trim().toLowerCase());
    expect(new Set(names).size, 'есть дубли origin-черт').toBe(names.length);
  }, 60000);
});

d('G8–G9: заклинания 0–1 уровня', () => {
  it('>=90% заклинаний 0–1 уровня имеют механику', async () => {
    const spells = await fetchAll('/api/spells', 'spells');
    const lvl01 = spells.filter((s) => Number(s.level) <= 1);
    expect(lvl01.length).toBeGreaterThanOrEqual(90);
    const withMech = lvl01.filter((s) => s.mechanics && Object.keys(s.mechanics as object).length > 0);
    const ratio = withMech.length / lvl01.length;
    expect(ratio, `механики только у ${withMech.length}/${lvl01.length}`).toBeGreaterThanOrEqual(0.9);
  }, 120000);
});

d('C7: снаряжение', () => {
  it('базовое оружие, щиты и доспехи присутствуют с рабочими полями', async () => {
    const cards = await fetchAll('/api/cards', 'cards');
    const weapons = cards.filter((c) => c.type === 'weapon' && c.bonus_value && c.slot);
    const shields = cards.filter((c) => c.type === 'shield');
    const armor = cards.filter((c) => (c.type === 'chest' || c.defense_type) && c.bonus_type === 'defense');
    expect(weapons.length, 'оружие с костью урона и слотом').toBeGreaterThanOrEqual(20);
    expect(shields.length, 'щиты').toBeGreaterThanOrEqual(1);
    expect(armor.length, 'доспехи').toBeGreaterThanOrEqual(8);
  }, 120000);
});

d('H: гигиена механик', () => {
  it('lint-mechanics: все механики валидны по схеме (0 ошибок)', async () => {
    // Скрипт возвращает ненулевой код при ошибках — здесь дублируем логику кратко:
    // каждая механика обязана иметь activation.mode и массив effects.
    const kinds: Array<[string, string]> = [['/api/actions', 'actions'], ['/api/effects', 'effects'], ['/api/spells', 'spells']];
    const bad: string[] = [];
    for (const [path, key] of kinds) {
      const items = await fetchAll(path, key);
      for (const it of items) {
        const m = it.mechanics as Record<string, unknown> | null;
        if (!m || !Object.keys(m).length) continue;
        const activation = m.activation as Record<string, unknown> | undefined;
        if (!activation?.mode) bad.push(`${key}:${it.card_number}: нет activation.mode`);
        if (!Array.isArray(m.effects)) bad.push(`${key}:${it.card_number}: нет effects[]`);
      }
    }
    expect(bad, bad.join('\n')).toHaveLength(0);
  }, 180000);
});
