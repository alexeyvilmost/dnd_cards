/**
 * Живой тест боевых стилей (гейт MVP_CONTENT=1, ходит в прод):
 * выбор боевого стиля у Воина 1 уровня — это choice(source:"feat",
 * filter:"fighting_style"); выбранная черта «Оборона» попадает в bundle.feats,
 * её эффект fs_defense — в сборку, и КЗ получает +1.
 */
import { beforeAll, describe, expect, it } from 'vitest';

// apiClient (axios) читает localStorage в интерсепторе токена — в node его нет.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}
import { assemble, loadBundle } from '../character/assemble';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext } from '../character/runtime';
import { breakdownValue } from '../engine/breakdown';
import type { RuntimeState } from './contracts';
import type { Background, CharacterClass, Feat, Race } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

let fighter: CharacterClass | undefined;
let human: Race | undefined;
let bg: Background | undefined;
let defenseFeat: Feat | undefined;
let stylesCount = 0;

const emptyRuntime = (): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: {},
  maxResources: {},
  equipment: {},
  inventory: [],
  activeEffects: [],
});

describe.skipIf(!RUN)('Боевой стиль воина — выбор из черт fighting_style (живой прод)', () => {
  beforeAll(async () => {
    const [classes, races, backgrounds, feats] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
    ]);
    fighter = classes.find((c) => c.card_number === 'CLASS-warrior');
    human = races.find((r) => r.name === 'Человек');
    bg = backgrounds.find((b) => b.name === 'Стражник') ?? backgrounds[0];
    const styles = feats.filter((f) => f.category === 'fighting_style');
    stylesCount = styles.length;
    defenseFeat = styles.find((f) => f.name === 'Оборона');
  }, 120_000);

  it('выбор «Оборона»: черта в bundle.feats, эффект fs_defense в сборке, КЗ +1', async () => {
    expect(fighter && human && bg && defenseFeat).toBeTruthy();
    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'Тест боевого стиля',
      raceId: human!.id,
      classId: fighter!.id,
      backgroundId: bg!.id,
      abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    };

    // 1) До выбора: pending-выбор боевого стиля пришёл как source:"feat" с фильтром категории.
    let bundle = await loadBundle(draft);
    let assembled = assemble({ ...bundle, spells: [] }, draft);
    const pc = assembled.pendingChoices.find((p) => p.source === 'feat' && p.origin.kind === 'class');
    expect(pc, 'у Воина 1 уровня должен быть choice(source:"feat") от класса').toBeTruthy();
    expect(pc!.filter).toBe('fighting_style');
    expect(pc!.items ?? []).toHaveLength(0); // явного списка больше нет
    expect(stylesCount, 'в проде есть черты категории fighting_style').toBeGreaterThanOrEqual(6);

    // 2) Выбираем стиль «Оборона» (+1 КЗ в доспехе).
    draft.resolvedChoices[pc!.id] = [defenseFeat!.id];
    bundle = await loadBundle(draft);
    assembled = assemble({ ...bundle, spells: [] }, draft);

    expect(bundle.feats.map((f) => f.id), 'черта из choice попала в bundle.feats').toContain(defenseFeat!.id);
    const styleEffect = assembled.effects.find((e) => e.effect.card_number === 'fs_defense');
    expect(styleEffect, 'эффект стиля пришёл через related_effects черты').toBeTruthy();
    expect(styleEffect!.origin.kind).toBe('feat');

    // 3) Правила: грант черты зафиксирован, ошибок-конфликтов нет.
    const ruleState = resolveCharacterRules({ draft, assembled });
    expect(ruleState.appliedGrants.some((g) => g.kind === 'feat' && g.value === defenseFeat!.id)).toBe(true);
    expect(ruleState.conflicts.filter((c) => c.severity === 'error')).toHaveLength(0);

    // 4) КЗ листа учитывает +1 от стиля (модификатор в пассивках).
    const passives = collectPassiveMechanics(assembled);
    const ctx = buildCharacterContext(ruleState, draft as { level: number; abilities: Record<string, number> }, [], assembled.klass);
    const ac = breakdownValue('ac', ctx, emptyRuntime(), passives);
    expect(ac.value).toBe(ruleState.armorClass + 1);
    expect(ac.parts.some((p) => p.value === 1 && p.reason === 'эффект')).toBe(true);

    // eslint-disable-next-line no-console
    console.log('[live] стиль «Оборона»:',
      `feats=[${bundle.feats.map((f) => f.name).join(', ')}]`,
      `эффект=${styleEffect!.effect.name}`,
      `КЗ ${ruleState.armorClass} → ${ac.value}`,
      `грантов=${ruleState.appliedGrants.length}, конфликтов=${ruleState.conflicts.length}`);
  }, 120_000);
});
