/**
 * Регресс-тесты движковых багов черт (гейт MVP_CONTENT=1, живой прод):
 *  1. «Крепкий» (Tough) увеличивает макс. HP на 2×уровень (modifier max_hp).
 *  2. Origin-черта предыстории попадает в сборку БЕЗ «Сменить черту» (overview).
 *  3. Повторяемую черту можно взять из двух источников (вид + предыстория).
 */
import { beforeAll, describe, expect, it } from 'vitest';

// apiClient (axios) читает localStorage в интерсепторе — в node его нет.
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
import { computeMaxHP } from '../character/derive';
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

const emptyRuntime = (): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [],
});

let classes: CharacterClass[] = [];
let races: Race[] = [];
let backgrounds: Background[] = [];
let feats: Feat[] = [];

describe.skipIf(!RUN)('Движок черт: HP Крепкого, origin-черта, повторяемость (живой прод)', () => {
  beforeAll(async () => {
    [classes, races, backgrounds, feats] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
    ]);
  }, 120_000);

  it('«Крепкий» даёт +2×уровень к максимуму HP (modifier max_hp)', async () => {
    const wizard = classes.find((c) => c.name === 'Волшебник' && !c.is_subclass)!;
    const human = races.find((r) => r.name === 'Человек')!;
    const bg = backgrounds[0];
    const tough = feats.find((f) => f.name === 'Крепкий')!;
    expect(wizard && human && bg && tough).toBeTruthy();

    const level = 3;
    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'HP-тест', raceId: human.id, classId: wizard.id, backgroundId: bg.id,
      level, swapFeat: true, featIds: [tough.id],
      abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 10, cha: 13 },
    };
    const bundle = await loadBundle(draft);
    const assembled = assemble({ ...bundle, spells: [] }, draft);
    expect(bundle.feats.some((f) => f.id === tough.id), 'Крепкий в сборке').toBe(true);

    const ruleState = resolveCharacterRules({ draft, assembled });
    const baseHP = computeMaxHP(wizard.hit_die, 12, level); // без Крепкого
    // 2 × 3 уровня = +6
    expect(ruleState.maxHP).toBe(baseHP + 2 * level);

    // Лист считает то же через breakdownValue('max_hp').
    const ctx = buildCharacterContext(ruleState, { level, abilities: draft.abilities }, [], assembled.klass);
    const passives = collectPassiveMechanics(assembled);
    const bd = breakdownValue('max_hp', ctx, emptyRuntime(), passives as Record<string, unknown>[]);
    expect(bd.value).toBe(baseHP + 2 * level);
    expect(bd.parts.some((p) => p.reason === 'эффект' && p.value === 2 * level)).toBe(true);
  }, 60_000);

  it('origin-черта предыстории попадает в сборку без «Сменить черту»', async () => {
    const wizard = classes.find((c) => c.name === 'Волшебник' && !c.is_subclass)!;
    const human = races.find((r) => r.name === 'Человек')!;
    // предыстория с заданной origin_feat, которую можно найти среди черт
    const bg = backgrounds.find((b) => b.origin_feat
      && feats.some((f) => f.card_number === b.origin_feat || f.id === b.origin_feat))!;
    expect(bg, 'есть предыстория с origin_feat').toBeTruthy();
    const originFeat = feats.find((f) => f.card_number === bg.origin_feat || f.id === bg.origin_feat)!;

    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'Origin-тест', raceId: human.id, classId: wizard.id, backgroundId: bg.id,
      swapFeat: false, // НЕ меняем черту
      abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 10, cha: 13 },
    };
    const bundle = await loadBundle(draft);
    expect(bundle.feats.some((f) => f.id === originFeat.id),
      `origin-черта «${originFeat.name}» предыстории в сборке без swap`).toBe(true);
  }, 60_000);

  it('повторяемую черту можно взять из вида и предыстории (двойной грант)', async () => {
    const wizard = classes.find((c) => c.name === 'Волшебник' && !c.is_subclass)!;
    const human = races.find((r) => r.name === 'Человек')!;
    const bg = backgrounds[0];
    const repeat = feats.find((f) => f.repeatable && f.category === 'origin')
      ?? feats.find((f) => f.repeatable)!;
    expect(repeat, 'есть повторяемая черта').toBeTruthy();

    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'Repeat-тест', raceId: human.id, classId: wizard.id, backgroundId: bg.id,
      swapFeat: true, featIds: [repeat.id], // «предыстория» — заменена на повторяемую
      abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 10, cha: 13 },
    };
    // Найти choice(source:feat) Человека и выбрать ту же повторяемую черту.
    let bundle = await loadBundle(draft);
    let assembled = assemble({ ...bundle, spells: [] }, draft);
    const humanFeatChoice = assembled.pendingChoices.find(
      (pc) => pc.source === 'feat' && pc.origin.kind === 'race',
    );
    expect(humanFeatChoice, 'у Человека есть choice(source:feat)').toBeTruthy();
    draft.resolvedChoices[humanFeatChoice!.id] = [repeat.id];

    bundle = await loadBundle(draft);
    assembled = assemble({ ...bundle, spells: [] }, draft);
    const count = assembled.feats.filter((f) => f.id === repeat.id).length;
    expect(count, `повторяемая «${repeat.name}» присутствует дважды`).toBe(2);
  }, 60_000);
});
