/**
 * Детерминированная регрессия бага «Оборона не даёт +1 КЗ».
 *
 * Тест берёт канонический контент из прода, но создаёт персонажа в памяти:
 * ему не нужна и не создаётся историческая запись characters_v3.
 */
import { beforeAll, describe, expect, it } from 'vitest';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

import { assemble, loadBundle } from '../character/assemble';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { collectPassiveMechanics } from '../character/resourceInit';
import { collectEquippedCards } from '../character/inventory';
import { buildCharacterContext } from '../character/runtime';
import { breakdownValue } from '../engine/breakdown';
import type { RuntimeState } from './contracts';
import type { Background, Card, CharacterClass, Feat, Race } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    const data = await response.json();
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

let fighter: CharacterClass | undefined;
let human: Race | undefined;
let background: Background | undefined;
let defenseFeat: Feat | undefined;
let armor: Card | undefined;

describe.skipIf(!RUN)('Репро: Воин со стилем «Оборона» (+1 КЗ)', () => {
  beforeAll(async () => {
    const [classes, races, backgrounds, feats, cards] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
      fetchAll<Feat>('/api/feats', 'feats'),
      fetchAll<Card>('/api/cards', 'cards'),
    ]);
    fighter = classes.find((item) => item.card_number === 'CLASS-warrior');
    human = races.find((item) => item.name === 'Человек');
    background = backgrounds.find((item) => item.name === 'Стражник') ?? backgrounds[0];
    defenseFeat = feats.find((item) => item.category === 'fighting_style' && item.name === 'Оборона');
    armor = cards.find((item) => item.name === 'Наборный доспех'
      && item.type === 'chest' && item.slot === 'body' && item.bonus_type === 'defense');
  }, 120_000);

  it('единый breakdown даёт +1 в доспехе и не даёт бонус без него', async () => {
    expect(fighter && human && background && defenseFeat && armor).toBeTruthy();
    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'Регрессия Обороны',
      raceId: human!.id,
      classId: fighter!.id,
      backgroundId: background!.id,
      abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    };

    let bundle = await loadBundle(draft);
    let assembled = assemble({ ...bundle, spells: [] }, draft);
    const choice = assembled.pendingChoices.find((item) =>
      item.source === 'feat' && item.origin.kind === 'class' && item.filter === 'fighting_style');
    expect(choice, 'у Воина 1-го уровня есть выбор боевого стиля').toBeTruthy();

    draft.resolvedChoices[choice!.id] = [defenseFeat!.id];
    bundle = await loadBundle(draft);
    assembled = assemble({ ...bundle, spells: [] }, draft);
    const styleEffect = assembled.effects.find((item) => item.effect.card_number === 'fs_defense');
    expect(styleEffect, 'эффект fs_defense должен прийти из черты').toBeTruthy();

    const ruleState = resolveCharacterRules({ draft, assembled });
    const runtimeState: RuntimeState = {
      hp: { current: ruleState.maxHP, max: ruleState.maxHP, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: { body: armor!.id },
      inventory: [],
      activeEffects: [],
    };
    const cardMap = new Map([[armor!.id, armor!]]);
    const equipped = collectEquippedCards(runtimeState.equipment, cardMap);
    const passives = collectPassiveMechanics(assembled);
    const ctx = buildCharacterContext(ruleState, draft, equipped, assembled.klass);
    const ac = breakdownValue('ac', ctx, runtimeState, passives);

    const panelCtx = buildCharacterContext(ruleState, draft, equipped, null);
    const panelAc = breakdownValue('ac', panelCtx, runtimeState, passives);
    const nakedState = { ...runtimeState, equipment: {} };
    const nakedCtx = buildCharacterContext(ruleState, draft, [], assembled.klass);
    const nakedAc = breakdownValue('ac', nakedCtx, nakedState, passives);

    expect(ac.parts.some((part) => part.source === 'Боевой стиль: Оборона' && part.value === 1)).toBe(true);
    expect(nakedAc.parts.some((part) => part.source === 'Боевой стиль: Оборона')).toBe(false);
    expect(nakedAc.value).toBe(ruleState.armorClass);
    expect(panelAc.value).toBe(ac.value);
  }, 120_000);
});
