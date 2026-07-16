/**
 * Гейт экипировки на РЕАЛЬНЫХ прод-картах (план 2026-07-15, задача 0.3 / KB-002).
 *
 * Почему отдельный файл, а не кейс в equipment.test.ts: тот работает на синтетических
 * фикстурах (`CARD_SHIELD` из mvp/fixtures), у которых `type='shield'` проставлен руками.
 * Именно поэтому баг и жил незамеченным — фикстуры описывали idealized-данные, а прод
 * отдавал `type=null`, и движок классифицировал щит как НАГРУДНИК:
 *   isShield()    (equipment.ts:28) → false
 *   isBodyArmor() (equipment.ts:32) → !!defense_type && !isShield → TRUE
 * Латы (КЗ 18) + «Щит +2» давали КЗ 11 вместо 20: щит вытеснял доспех из слота тела
 * и при этом не давал собственный бонус (shieldFromState ищет только isShield в руках).
 *
 * Этот гейт читает снапшот прода — он краснеет, если данные снова разъедутся с движком.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { equipItem, isShieldCard } from './equipment';
import { computeAC } from './ac';
import { clearCardRegistry } from './cardRegistry';
import { FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';
import { REPO_ROOT } from '../canon/reports';
import type { Card } from '../types';
import type { CharacterContext } from '../mvp/contracts';

const readSnap = (name: string): unknown =>
  JSON.parse(readFileSync(join(REPO_ROOT, `officials/canon/prod-snapshot/${name}.json`), 'utf8'));

const asList = <T>(raw: unknown): T[] =>
  (Array.isArray(raw) ? raw : (Object.values(raw as Record<string, unknown>).find(Array.isArray) as T[])) ?? [];

const PROD_CARDS: Card[] = asList<Card>(readSnap('cards'));
type ProdEffect = { id: string; name?: string; mechanics?: Record<string, unknown> | null };
const PROD_EFFECTS: ProdEffect[] = asList<ProdEffect>(readSnap('effects'));

const byId = (id: string): Card => {
  const c = PROD_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`Карта ${id} исчезла из прод-снапшота`);
  return c;
};

const effById = (id: string): ProdEffect => {
  const e = PROD_EFFECTS.find((x) => x.id === id);
  if (!e) throw new Error(`Эффект ${id} исчез из прод-снапшота`);
  return e;
};

const PLATE = 'd6c302f9-3a73-482a-9113-9510fcc937fe'; // Латы, КЗ 18
const SHIELD_PHB = 'b0a5fd06-4b35-480a-8a99-02aa2a60fd6b'; // Щит (базовый PHB), +2

beforeEach(() => clearCardRegistry());

describe('прод-данные: щиты', () => {
  it('Латы + базовый Щит PHB → КЗ 20, доспех НЕ вытеснен', () => {
    const plate = byId(PLATE);
    const shield = byId(SHIELD_PHB);

    let { state } = equipItem(freshFighterState(), plate);
    ({ state } = equipItem(state, shield));

    expect(state.equipment.body, 'доспех остался в слоте тела').toBe(plate.id);
    expect(
      [state.equipment.main_hand, state.equipment.off_hand],
      'щит занял руку, а не слот тела',
    ).toContain(shield.id);
    expect(computeAC(FIGHTER_CTX, state, []).value, '18 (латы) + 2 (щит)').toBe(20);
  });

  it('каждая карта со свойством shield опознаётся движком как щит', () => {
    const props = (c: Card): string[] => (Array.isArray(c.properties) ? c.properties.map(String) : []);
    const shields = PROD_CARDS.filter((c) => props(c).includes('shield'));
    expect(shields.length, 'щиты в проде есть').toBeGreaterThan(0);

    const misclassified = shields.filter((c) => !isShieldCard(c)).map((c) => `${c.name} (type=${c.type})`);
    expect(misclassified, 'щит с type≠shield уедет в слот тела и вытеснит доспех').toEqual([]);
  });

  it('ни один щит не классифицируется как нагрудник', () => {
    const wrong = PROD_CARDS.filter((c) => isShieldCard(c))
      .filter((c) => {
        const { state } = equipItem(freshFighterState(), c);
        return state.equipment.body === c.id;
      })
      .map((c) => c.name);
    expect(wrong).toEqual([]);
  });
});

/**
 * Задача 0.1 / KB-004. Инвариант данных: токенизатор формул понимает только ASCII, кириллица
 * в bonus_value бросает FormulaError и (до ErrorBoundary) роняла лист в белый экран. Держим
 * данные чистыми — движок кириллице не учим (иначе два словаря).
 */
describe('прод-данные: формулы bonus_value только ASCII', () => {
  it('ни одна карта не несёт кириллицу в bonus_value', () => {
    const offenders = PROD_CARDS
      .filter((c) => /[А-Яа-я]/.test(String((c as { bonus_value?: unknown }).bonus_value ?? '')))
      .map((c) => `${c.name}: «${(c as { bonus_value?: unknown }).bonus_value}»`);
    expect(offenders, 'кириллица в формуле → FormulaError при расчёте КЗ/урона').toEqual([]);
  });
});

/**
 * Задача 0.4 / KB-005. Эффекты несли только narrative-текст «КД = 10 + ЛВК + ТЕЛ» —
 * человек читал, движок игнорировал. Гейт держит исполнимый payload на месте.
 */
describe('прод-данные: Защита без доспехов', () => {
  const BARBARIAN_UNARMORED = 'f39414a1-9ad6-42c2-ab83-f5fb57004798';
  const MONK_UNARMORED = 'e18cf12b-63e3-4da0-b5cd-be2dc2072082';

  const ctx = (mods: Partial<CharacterContext['abilityMods']>): CharacterContext => ({
    ...FIGHTER_CTX,
    abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, ...mods },
  });

  const acWith = (effectId: string, mods: Partial<CharacterContext['abilityMods']>): number => {
    const mech = effById(effectId).mechanics as Record<string, unknown>;
    return computeAC(ctx(mods), freshFighterState(), [mech]).value;
  };

  it('Варвар: ЛВК+2, ТЕЛ+3, без доспеха → КЗ 15 (10 + ЛВК + ТЕЛ)', () => {
    expect(acWith(BARBARIAN_UNARMORED, { dex: 2, con: 3 })).toBe(15);
  });

  it('Монах: ЛВК+3, МДР+2, без доспеха → КЗ 15 (10 + ЛВК + МДР)', () => {
    expect(acWith(MONK_UNARMORED, { dex: 3, wis: 2 })).toBe(15);
  });

  it('метод-кандидат проигрывает, когда обычный КЗ выше (парадигма №3: берётся максимум)', () => {
    // ЛВК+4, ТЕЛ 0 → «Защита без доспехов» даёт 14, безоружная база 10+ЛВК — тоже 14.
    // Ничего не ломается: берётся максимум, а не первый попавшийся метод.
    expect(acWith(BARBARIAN_UNARMORED, { dex: 4, con: 0 })).toBe(14);
  });
});
