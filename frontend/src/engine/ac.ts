/**
 * Конвейер КЗ (фаза C4).
 */
import type { Card } from '../types';
import type { CharacterContext, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import type { RollModifier } from '../mvp/contracts';
import { evaluate } from './formula';
import { getCard } from './cardRegistry';
import { pickBestMethod, type ValueMethod } from './derivedValue';

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

/** Все формулы set_value ac_base из пассивок — каждая станет методом-кандидатом. */
function acBaseOverrides(passives: Dict[]): string[] {
  const out: string[] = [];
  for (const mech of passives) {
    const effects = (mech.effects ?? mech.interactions) as unknown;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects as Dict[]) {
      const results = (eff.result ?? eff.results) as unknown;
      if (!Array.isArray(results)) continue;
      for (const r of results as Dict[]) {
        if (r.kind === 'set_value' && r.target === 'ac_base') {
          const f = String(r.formula ?? r.value ?? '');
          if (f) out.push(f);
        }
      }
    }
  }
  return out;
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

  const armor = armorFromState(state, cards);
  const shield = shieldFromState(state, cards);

  // Методы-кандидаты базового КЗ (парадигма №3): берётся максимум применимого.
  const methods: ValueMethod[] = [];

  if (armor) {
    // В доспехе безоружные методы неприменимы (по RAW 2024 требуют отсутствия доспеха).
    const parts: RollModifier[] = [];
    const value = armorAc(armor, character, parts);
    methods.push({ name: armor.name, value, parts });
  } else {
    const dex = character.abilityMods.dex ?? 0;
    const baseParts: RollModifier[] = [{ value: 10, source: 'база', reason: 'без доспеха' }];
    if (dex) baseParts.push({ value: dex, source: 'ЛВК', reason: 'модификатор характеристики' });
    methods.push({ name: 'Без доспеха', value: 10 + dex, parts: baseParts });

    // Каждый set_value ac_base — отдельный метод; берётся максимум (Защита без доспехов
    // 10+ЛВК+ТЕЛ vs Доспех мага 13+ЛВК → больший), а не первый попавшийся.
    for (const formula of acBaseOverrides(passives)) {
      const value = evalNum(formula, character);
      methods.push({
        name: 'Защита без доспехов',
        value,
        parts: [{ value, source: 'Защита без доспехов', reason: 'пассивка' }],
      });
    }
  }

  // Щит — аддитивный бонус поверх выбранного базового метода.
  const additive: RollModifier[] = [];
  if (shield?.bonus_value) {
    const bonus = parseFlatBonus(shield.bonus_value);
    if (bonus) additive.push({ value: bonus, source: 'Щит', reason: shield.name });
  }

  return pickBestMethod(methods, additive);
}
