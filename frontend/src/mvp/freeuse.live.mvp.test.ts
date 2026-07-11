/**
 * Живая сверка freeuse на прод-контенте: Высший эльф (подвид sub-high_elf) на 5 уровне
 * реальным конвейером кузницы → ruleState.freeuseSpells и пулы freeuse-<spell> для
 * Обнаружения магии (1×) и Туманного шага (1×). Проверяет засеянный freeuse end-to-end.
 *
 * Запуск: MVP_CONTENT=1 npm run test:mvp
 */
import { beforeAll, describe, expect, it } from 'vitest';

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
import { buildCharacterContext } from '../character/runtime';
import { syncRuntimeResources } from '../character/resourceInit';
import { freeuseKey } from '../engine/freeuse';
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

d('freeuse вживую: Высший эльф выдаёт бесплатные касты', () => {
  let content: BuildContent;
  let elfId = '', highElfId = '', warriorId = '', bgId = '';

  beforeAll(async () => {
    const [classes, races, backgrounds, feats] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
    ]);
    content = { classes, races, backgrounds, feats };
    elfId = races.find((r) => r.name === 'Эльф' && !(r as { is_subrace?: boolean }).is_subrace)!.id;
    highElfId = races.find((r) => (r as { card_number?: string }).card_number === 'sub-high_elf')!.id;
    warriorId = classes.find((c) => c.name === 'Воин' && !c.is_subclass)!.id;
    bgId = (backgrounds.find((b) => b.name === 'Солдат') ?? backgrounds[0]).id;
  }, 120_000);

  it('на 5 уровне: freeuseSpells = misty_step + detect_magic (по 1×/долгий отдых)', async () => {
    const r = await autoBuildAt(
      { classId: warriorId, raceId: elfId, lineageId: highElfId, backgroundId: bgId, level: 5 },
      content,
    );
    expect(r.assembled.race, 'подвид не загрузился').toBeTruthy();
    const byspell = Object.fromEntries(r.ruleState.freeuseSpells.map((s) => [s.spell, s]));
    expect(byspell['misty_step'], 'нет freeuse у Туманного шага').toMatchObject({ count: 1, recharge: 'long_rest' });
    expect(byspell['detect_magic'], 'нет freeuse у Обнаружения магии').toMatchObject({ count: 1, recharge: 'long_rest' });
  }, 120_000);

  it('пулы freeuse-<spell> сидируются в ресурсы', async () => {
    const r = await autoBuildAt(
      { classId: warriorId, raceId: elfId, lineageId: highElfId, backgroundId: bgId, level: 5 },
      content,
    );
    const ctx = buildCharacterContext(r.ruleState, r.draft, [], r.assembled.klass);
    const { maxResources } = syncRuntimeResources(ctx, r.assembled, undefined, r.ruleState.freeuseSpells);
    expect(maxResources[freeuseKey('misty_step')]).toBe(1);
    expect(maxResources[freeuseKey('detect_magic')]).toBe(1);
  }, 120_000);

  it('на 1 уровне гейт закрыт: misty_step (круг 2, gate 5) ещё не выдан', async () => {
    const r = await autoBuildAt(
      { classId: warriorId, raceId: elfId, lineageId: highElfId, backgroundId: bgId, level: 1 },
      content,
    );
    expect(r.ruleState.freeuseSpells.some((s) => s.spell === 'misty_step')).toBe(false);
  }, 120_000);
});
