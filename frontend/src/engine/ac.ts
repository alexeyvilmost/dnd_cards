/**
 * Конвейер КЗ (фаза C4).
 */
import type { Card } from '../types';
import type { CharacterContext, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import type { RollModifier } from '../mvp/contracts';
import { evaluate } from './formula';
import { getCard } from './cardRegistry';

type Dict = Record<string, unknown>;

function formulaCtx(character: CharacterContext) {
  return {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
  };
}

function evalNum(formula: string, character: CharacterContext): number {
  const v = evaluate(formula, formulaCtx(character));
  if (typeof v !== 'number') throw new Error(`Формула КЗ «${formula}» должна быть числом`);
  return v;
}

function parseFlatBonus(raw: string): number {
  const m = raw.match(/^\+?(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function findAcBaseOverride(passives: Dict[]): string | null {
  for (const mech of passives) {
    const effects = (mech.effects ?? mech.interactions) as unknown;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects as Dict[]) {
      const results = (eff.result ?? eff.results) as unknown;
      if (!Array.isArray(results)) continue;
      for (const r of results as Dict[]) {
        if (r.kind === 'set_value' && r.target === 'ac_base') {
          return String(r.formula ?? r.value ?? '');
        }
      }
    }
  }
  return null;
}

function allKnownCards(character: CharacterContext): Card[] {
  const map = new Map<string, Card>();
  for (const c of character.equippedCards ?? []) map.set(c.id, c);
  for (const c of character.knownCards ?? []) map.set(c.id, c);
  return [...map.values()];
}

function resolveCard(id: string, cards: Card[]): Card | undefined {
  return cards.find((c) => c.id === id) ?? getCard(id);
}

function armorFromState(state: RuntimeState, cards: Card[]): Card | undefined {
  const bodyId = state.equipment.body;
  if (!bodyId) return undefined;
  return resolveCard(bodyId, cards);
}

function shieldFromState(state: RuntimeState, cards: Card[]): Card | undefined {
  for (const slot of ['off_hand', 'main_hand'] as const) {
    const id = state.equipment[slot];
    if (!id) continue;
    const card = resolveCard(id, cards);
    if (card && (card.type === 'shield' || card.defense_type === 'shield')) return card;
  }
  return undefined;
}

function armorAc(armor: Card, character: CharacterContext, parts: RollModifier[]): number {
  const raw = armor.bonus_value ?? '10';

  if (/dex/i.test(raw)) {
    const baseFormula = raw.replace(/\s*\+\s*min\([^)]+\)/gi, '').replace(/\s*\+\s*dex.*$/i, '').trim();
    const base = evalNum(baseFormula || '10', character);
    const total = evalNum(raw, character);
    const dexPart = total - base;
    parts.push({ value: base, source: armor.name, reason: 'доспех' });
    if (dexPart) {
      parts.push({ value: dexPart, source: 'ЛВК', reason: 'модификатор характеристики' });
    }
    return total;
  }

  const fixed = evalNum(raw, character);
  parts.push({ value: fixed, source: armor.name, reason: 'доспех' });
  return fixed;
}

/** Вычислить КЗ с разбивкой по источникам. */
export function computeAC(
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
  cardIndex?: Map<string, Card>,
): ValueBreakdown {
  const cards = allKnownCards(character);
  const byId = cardIndex ?? new Map(cards.map((c) => [c.id, c]));
  for (const [id, c] of byId) if (!cards.find((x) => x.id === id)) cards.push(c);
  const parts: RollModifier[] = [];

  const armor = armorFromState(state, cards);
  const shield = shieldFromState(state, cards);

  let total: number;

  if (armor) {
    total = armorAc(armor, character, parts);
  } else {
    const override = findAcBaseOverride(passives);
    if (override) {
      total = evalNum(override, character);
      parts.push({ value: total, source: 'Защита без доспехов', reason: 'пассивка' });
    } else {
      const dex = character.abilityMods.dex ?? 0;
      parts.push({ value: 10, source: 'база', reason: 'без доспеха' });
      if (dex) parts.push({ value: dex, source: 'ЛВК', reason: 'модификатор характеристики' });
      total = 10 + dex;
    }
  }

  if (shield?.bonus_value) {
    const bonus = parseFlatBonus(shield.bonus_value);
    if (bonus) {
      parts.push({ value: bonus, source: 'Щит', reason: shield.name });
      total += bonus;
    }
  }

  return { value: total, parts };
}
