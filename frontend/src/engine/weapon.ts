/**
 * Оружейный контекст для dice:"weapon", ability:"auto" (фаза C5), плюс:
 *  - многострочный урон (основной + стихийный) и магический бонус «+N» (enchant);
 *  - доступность оружейных действий по экипировке (правая/левая рука, безоружная);
 *  - предпросмотр атаки/урона из оружия в соответствующей руке (парадигма №2).
 * Всё выводится из ДАННЫХ (маркеры механики + поля карты), а не из имён действий —
 * поэтому применяется к любому действию с теми же маркерами (парадигма №1).
 */
import type { Card } from '../types';
import type { AbilityKey, FormulaContext } from './formula';
import type { CharacterContext, RuntimeState, WeaponContext } from '../mvp/contracts';
import { cardPropsList } from './equipment';
import { collectModifiers } from './modifiers';

type Dict = Record<string, unknown>;

function cardById(ctx: CharacterContext, id: string | null | undefined): Card | undefined {
  if (!id) return undefined;
  return (ctx.equippedCards ?? []).find((c) => c.id === id)
    ?? (ctx.knownCards ?? []).find((c) => c.id === id);
}

function pickAbility(card: Card, character: CharacterContext): 'str' | 'dex' {
  const props = cardPropsList(card);
  if (props.includes('finesse')) {
    const str = character.abilityMods.str ?? 0;
    const dex = character.abilityMods.dex ?? 0;
    return dex > str ? 'dex' : 'str';
  }
  return 'str';
}

/**
 * Кость урона из bonus_value. Универсальное оружие пишется «1d6 (1d8)»:
 * скобочная кость — при хвате двумя руками (вторая рука свободна).
 */
function weaponDice(card: Card, twoHandedGrip: boolean): string {
  const raw = String(card.bonus_value ?? '1d4');
  const dice = raw.match(/\d+[dк]\d+/gi);
  if (!dice?.length) return '1d4';
  const pick = twoHandedGrip && dice.length > 1 ? dice[1] : dice[0];
  return pick.replace(/к/i, 'd');
}

/** Магический бонус оружия: поле enchant_bonus, иначе разбор «+N» из имени (запасной путь). */
export function weaponEnchant(card: Card): number {
  if (typeof card.enchant_bonus === 'number') return card.enchant_bonus;
  const m = /\+(\d+)/.exec(card.name ?? '');
  return m ? Number(m[1]) : 0;
}

/**
 * Магические бонусы предмета действуют, если он не требует настройки ИЛИ на него
 * настроены. Ненастроенный магический предмет даёт только чистые статы (общее правило
 * настройки; пока применяется к оружию). attunedIds:undefined — данных нет (тесты) → не гейтим.
 */
function itemBonusesActive(card: Card, character: CharacterContext): boolean {
  if (!card.requires_attunement) return true;
  if (character.attunedIds == null) return true;
  return character.attunedIds.includes(card.id);
}

/**
 * Все строки урона оружия: основная (bonus_value+damage_type) и стихийная
 * (elemental_damage_value+elemental_damage_type), если задана. Гранулярность №4 —
 * каждая строка отдельна, движок бросает и применяет их независимо.
 * magic=false (не настроен) — стихийный урон отбрасывается (это магическое свойство).
 */
function weaponDamages(card: Card, twoHandedGrip: boolean, magic: boolean): Array<{ dice: string; type: string }> {
  const out: Array<{ dice: string; type: string }> = [
    { dice: weaponDice(card, twoHandedGrip), type: card.damage_type ?? 'bludgeoning' },
  ];
  const ed = card.elemental_damage_value?.trim();
  const et = card.elemental_damage_type?.trim();
  if (magic && ed && et) out.push({ dice: ed.replace(/к/i, 'd'), type: et });
  return out;
}

function cardToWeapon(card: Card, character: CharacterContext, twoHandedGrip = false): WeaponContext {
  const magic = itemBonusesActive(card, character); // настройка: без неё — только чистые статы
  const damages = weaponDamages(card, twoHandedGrip, magic);
  return {
    cardId: card.id,
    name: card.name,
    dice: damages[0].dice,
    ability: pickAbility(card, character),
    damageType: damages[0].type,
    damages,
    enchant: magic ? weaponEnchant(card) : 0,
    properties: cardPropsList(card),
  };
}

/** Параметры оружия в указанной руке (по слоту equipment, R3). */
export function weaponContext(
  character: CharacterContext,
  hand: 'main' | 'off',
  equipment?: Record<string, string | null | undefined>,
): WeaponContext | null {
  const slot = hand === 'main' ? 'main_hand' : 'off_hand';
  if (equipment) {
    const card = cardById(character, equipment[slot]);
    // Хват двумя руками: универсальное оружие в основной руке при пустой второй.
    const twoHandedGrip = hand === 'main' && !equipment.off_hand;
    if (card?.type === 'weapon') return cardToWeapon(card, character, twoHandedGrip);
    return null;
  }

  const weapons = (character.equippedCards ?? []).filter((c) => c.type === 'weapon');
  const card = hand === 'main' ? weapons[0] : weapons[1];
  if (!card) return null;
  return cardToWeapon(card, character);
}

export function abilityForWeapon(card: Card, character: CharacterContext): AbilityKey {
  return pickAbility(card, character);
}

// ─── Маркеры оружейной атаки (данные механики → тип атаки) ──────────────────

/** Тип оружейной атаки эффекта: 'main'/'off' (dice:'weapon') или 'unarmed'; null — не оружейная. */
export type WeaponAttackKind = 'main' | 'off' | 'unarmed' | null;

/**
 * Определить тип оружейной атаки по МАРКЕРАМ механики (не по имени действия):
 *  - attack_kind:'unarmed' → 'unarmed';
 *  - on_hit c dice:'weapon' → 'off' при теге off_hand, иначе 'main'.
 * Совпадает с тем, как resolveHand/resolveDamageAmount интерпретируют те же маркеры.
 */
/** Эффект-атака, по которому классифицируется оружейное действие (тот же выбор, что в weaponAttackKind). */
function matchedAttackEffect(mechanics: Dict | null | undefined): Dict | null {
  const effects = Array.isArray((mechanics as Dict | undefined)?.effects)
    ? ((mechanics as Dict).effects as Dict[])
    : [];
  for (const e of effects) {
    if (String(e.resolution ?? '') !== 'attack_roll') continue;
    if (String(e.attack_kind ?? '') === 'unarmed') return e;
    const onHit = Array.isArray(e.on_hit) ? (e.on_hit as Dict[]) : [];
    if (onHit.some((p) => p.dice === 'weapon')) return e;
  }
  return null;
}

export function weaponAttackKind(mechanics: Dict | null | undefined): WeaponAttackKind {
  const e = matchedAttackEffect(mechanics);
  if (!e) return null;
  if (String(e.attack_kind ?? '') === 'unarmed') return 'unarmed';
  const tags = Array.isArray(e.tags) ? (e.tags as unknown[]).map(String) : [];
  return tags.includes('off_hand') ? 'off' : 'main';
}

// ─── Доступность оружейных действий по экипировке ───────────────────────────

export interface ActionAvailability {
  available: boolean;
  /** Причина недоступности (слой поверх превью, парадигма №2). */
  reason?: string;
}

function isWeaponCard(card: Card | undefined): boolean {
  return card?.type === 'weapon';
}

/**
 * Доступно ли оружейное действие при текущей экипировке. Правило выводится из маркеров
 * действия (единое для всех действий с такими маркерами, парадигма №1):
 *  - 'main'    → нужно оружие в правой руке;
 *  - 'off'     → нужно отдельное оружие во второй руке (двуручный хват исключён);
 *  - 'unarmed' → правая рука должна быть свободна от оружия.
 * Не-оружейные действия не гейтятся.
 */
export function weaponActionAvailability(
  mechanics: Dict | null | undefined,
  equipment: Record<string, string | null | undefined> | undefined,
  cardsById: Map<string, Card>,
): ActionAvailability {
  const kind = weaponAttackKind(mechanics);
  if (!kind) return { available: true };

  const mainId = equipment?.main_hand ?? null;
  const offId = equipment?.off_hand ?? null;
  const mainCard = mainId ? cardsById.get(mainId) : undefined;
  const offCard = offId ? cardsById.get(offId) : undefined;

  if (kind === 'unarmed') {
    // По RAW 2024 безоружный удар доступен всегда (свободная рука нужна только для Захвата).
    return { available: true };
  }
  if (kind === 'main') {
    return isWeaponCard(mainCard)
      ? { available: true }
      : { available: false, reason: 'Нет оружия в правой руке' };
  }
  // 'off': нужен отдельный предмет во второй руке; двуручный хват (off_hand===main_hand) исключён.
  if (!offId || offId === mainId) return { available: false, reason: 'Нет оружия во второй руке' };
  return isWeaponCard(offCard)
    ? { available: true }
    : { available: false, reason: 'Нет оружия во второй руке' };
}

// ─── Предпросмотр атаки/урона (парадигма №2) ────────────────────────────────

export interface WeaponAttackPreview {
  /** Бонус к броску атаки: «к20» + attack. */
  attack: number;
  /** Строки урона: {кость, плоский бонус, тип}. Пустая dice — только бонус (безоружный). */
  damages: Array<{ dice: string; bonus: number; type: string }>;
}

/** C1: сумма модификаторов урона из эффектов/пассивок для предпросмотра (парадигма №2 —
 *  превью = исполнению). Фильтр зеркалит resolveDamageAmounts: осн. рука {hand, ability},
 *  вторая {hand}. Без state (вызовы без рантайма) возвращает 0. */
function damageModifierBonus(
  state: RuntimeState | undefined,
  passives: Dict[] | undefined,
  character: CharacterContext,
  hand: 'main' | 'off',
  ability: AbilityKey | undefined,
): number {
  if (!state) return 0;
  const fctx: FormulaContext = {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
    spellcastingMod: character.spellcastingMod,
    variables: character.variables,
  };
  const collected = collectModifiers(state, passives ?? [], {
    roll: 'damage',
    filter: { hand, ...(ability ? { ability } : {}) },
    formulaCtx: fctx,
  });
  return collected.modifiers.reduce((s, m) => s + m.value, 0);
}

/**
 * Числа для подсказки оружейной атаки, посчитанные из оружия в соответствующей руке.
 * Использует ту же математику, что и исполнение (единый источник истины):
 *  - атака = мод характеристики + БМ + зачарование;
 *  - урон = кость + (осн. рука? мод характеристики) + зачарование (только основная строка);
 *  - вторая рука не добавляет мод характеристики к урону (но добавляет зачарование).
 */
export function weaponAttackPreview(
  mechanics: Dict | null | undefined,
  character: CharacterContext,
  equipment: Record<string, string | null | undefined> | undefined,
  state?: RuntimeState,
  passives?: Dict[],
): WeaponAttackPreview | null {
  const kind = weaponAttackKind(mechanics);
  if (!kind) return null;
  const prof = character.profBonus;

  if (kind === 'unarmed') {
    const strMod = character.abilityMods.str ?? 0;
    return { attack: strMod + prof, damages: [{ dice: '1', bonus: strMod, type: 'bludgeoning' }] };
  }

  const hand: 'main' | 'off' = kind === 'off' ? 'off' : 'main';
  const w = weaponContext(character, hand, equipment);
  if (!w) return null;

  // Бонус к БРОСКУ АТАКИ — зеркало attackAbilityMods (execute.ts): при ability:'auto'
  // берём мод оружия и зачарование; при явной характеристике — её мод без зачарования.
  const atkAbility = String((matchedAttackEffect(mechanics) as Dict | null)?.ability ?? 'auto');
  const atkAbilityMod = atkAbility === 'auto'
    ? character.abilityMods[w.ability] ?? 0
    : character.abilityMods[atkAbility as keyof CharacterContext['abilityMods']] ?? 0;
  const attackEnchant = atkAbility === 'auto' ? w.enchant : 0;

  // Мод характеристики к урону: основная рука — да; вторая рука — нет (зачарование — на обеих).
  const dmgAbility = hand === 'off' ? 0 : (character.abilityMods[w.ability] ?? 0);
  // C1: модификаторы урона из эффектов (Ярость и т.п.) — на основную строку, как в исполнении.
  const dmgMods = damageModifierBonus(state, passives, character, hand, hand === 'main' ? w.ability : undefined);

  return {
    attack: atkAbilityMod + prof + attackEnchant,
    damages: w.damages.map((d, i) => ({
      dice: d.dice,
      // Мод характеристики + зачарование + модификаторы эффектов — только на основную строку.
      bonus: i === 0 ? dmgAbility + w.enchant + dmgMods : 0,
      type: d.type,
    })),
  };
}
