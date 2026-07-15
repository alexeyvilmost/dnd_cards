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

const cardsRaw = JSON.parse(
  readFileSync(join(REPO_ROOT, 'officials/canon/prod-snapshot/cards.json'), 'utf8'),
) as unknown;
const PROD_CARDS: Card[] = (Array.isArray(cardsRaw)
  ? cardsRaw
  : (Object.values(cardsRaw as Record<string, unknown>).find(Array.isArray) as Card[])) ?? [];

const byId = (id: string): Card => {
  const c = PROD_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`Карта ${id} исчезла из прод-снапшота`);
  return c;
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
