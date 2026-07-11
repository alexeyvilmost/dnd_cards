/**
 * Живая динамическая сверка через общий autoBuild (0.5): собирает Варвара на разных
 * УРОВНЯХ с ПОДКЛАССОМ реальным конвейером кузницы и проверяет динамические значения
 * (переменные по уровню, выбор подкласса, разрешимость всех не-спелл выборов).
 * Дополняет офлайн-пилот (barbarian.canon.test.ts), который проверяет структуру по снапшоту.
 *
 * Запуск: MVP_CONTENT=1 npm run test:mvp
 */
import { beforeAll, describe, expect, it } from 'vitest';

// заглушка localStorage ДО импорта apiClient-цепочки (loadBundle → axios-интерсептор)
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(), key: () => null, get length() { return store.size; },
  } as Storage;
}
import { autoBuildAt, type BuildContent } from '../canon/autoBuild';
import type { Background, CharacterClass, Feat, Race } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const d = describe.skipIf(!RUN);

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=200`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    if (batch.length < 200) break;
  }
  return items;
}

d('Живой autoBuild: Варвар по уровням с подклассом', () => {
  let content: BuildContent;
  let barbId = '', humanId = '', bgId = '';

  beforeAll(async () => {
    const [classes, races, backgrounds, feats] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
    ]);
    content = { classes, races, backgrounds, feats };
    barbId = classes.find((c) => c.name === 'Варвар' && !c.is_subclass)!.id;
    humanId = races.find((r) => r.name === 'Человек')!.id;
    bgId = (backgrounds.find((b) => b.name === 'Солдат') ?? backgrounds[0]).id;
  }, 120_000);

  it('уровень 1: собирается, rage_damage_modifier = 2, подкласс ещё не выбран', async () => {
    const r = await autoBuildAt({ classId: barbId, raceId: humanId, backgroundId: bgId, level: 1 }, content);
    expect(r.assembled.klass, 'класс не загрузился (сеть?)').toBeTruthy();
    expect(r.ruleState.variables.rage_damage_modifier).toBe(2);
    expect(r.draft.subclassId, 'подкласс не должен выбираться на 1 ур.').toBeFalsy();
    expect(r.unresolvedNonSpell, r.unresolvedNonSpell.join('; ')).toHaveLength(0);
  }, 120_000);

  it('уровень 5: подкласс выбран, его фича 3 ур. в сборке, rage_damage_modifier = 2', async () => {
    const r = await autoBuildAt({ classId: barbId, raceId: humanId, backgroundId: bgId, level: 5 }, content);
    expect(r.draft.subclassId, 'подкласс должен выбраться на 5 ур.').toBeTruthy();
    expect(r.ruleState.variables.rage_damage_modifier).toBe(2);
    // хотя бы одна фича подкласса (EFFECT-002x/003x) попала в сборку.
    // assembled.effects — массив {effect, origin}; card_number лежит в .effect.
    const effNums = (r.assembled.effects || []).map((e) => (e as { effect?: { card_number?: string } }).effect?.card_number || '');
    const hasSubFeature = effNums.some((n) => /^EFFECT-00(2[3-9]|3[0-9]|40)$/.test(n));
    expect(hasSubFeature, `фич подкласса нет в сборке; есть: ${effNums.filter((n) => n.startsWith('EFFECT-00')).join(',')}`).toBe(true);
    expect(r.unresolvedNonSpell, r.unresolvedNonSpell.join('; ')).toHaveLength(0);
  }, 120_000);

  it('уровень 9: rage_damage_modifier = 3 (прогрессия урона Ярости)', async () => {
    const r = await autoBuildAt({ classId: barbId, raceId: humanId, backgroundId: bgId, level: 9 }, content);
    expect(r.ruleState.variables.rage_damage_modifier).toBe(3);
  }, 120_000);
});
