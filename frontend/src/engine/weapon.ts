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
import { collectModifiers, type ModifierQueryFacts } from './modifiers';
import weaponTypesData from '../../utils/weapon_types.json';
import {
  parseWeaponProfile,
  type WeaponProfile,
} from './weaponProfile';

type Dict = Record<string, unknown>;

type RawWeaponTypeCatalog = {
  basic?: Array<{
    name?: string;
    weapons?: Array<{ name?: string }>;
  }>;
};

function normalizeWeaponProficiencyId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['all_weapon', 'all_weapons', 'weapon', 'weapons'].includes(normalized)) return 'all';
  if (['simple_weapon', 'simple_weapons'].includes(normalized)) return 'simple';
  if (['martial_weapon', 'martial_weapons'].includes(normalized)) return 'martial';
  return normalized;
}

const WEAPON_GROUP_BY_TYPE = new Map<string, string>(
  ((weaponTypesData as RawWeaponTypeCatalog).basic ?? []).flatMap((group) => {
    const groupId = normalizeWeaponProficiencyId(String(group.name ?? ''));
    return (group.weapons ?? []).flatMap((weapon) => {
      const weaponType = normalizeWeaponProficiencyId(String(weapon.name ?? ''));
      return groupId && weaponType ? [[weaponType, groupId] as const] : [];
    });
  }),
);

/**
 * Single authority for adding PB to an attack with a weapon.  The character
 * compiler emits exact weapon types, four catalog groups, or the broad
 * simple/martial categories.  undefined preserves pre-projection contexts;
 * an explicit empty list means the actor is not proficient.
 */
export function isWeaponProficient(
  character: CharacterContext,
  weaponType: string | null | undefined,
  declaredCategory?: 'simple' | 'martial',
): boolean {
  if (character.weaponProficiencies === undefined) return true;
  const normalizedType = normalizeWeaponProficiencyId(String(weaponType ?? ''));
  if (!normalizedType) return false;
  const grants = new Set(character.weaponProficiencies.map(normalizeWeaponProficiencyId));
  if (grants.has('all') || grants.has(normalizedType)) return true;
  const group = WEAPON_GROUP_BY_TYPE.get(normalizedType);
  if (!group && !declaredCategory) return false;
  const broadCategory = declaredCategory ?? (group?.startsWith('simple_')
    ? 'simple'
    : group?.startsWith('martial_')
      ? 'martial'
      : group);
  return (group ? grants.has(group) : false)
    || (broadCategory ? grants.has(broadCategory) : false);
}

function cardById(ctx: CharacterContext, id: string | null | undefined): Card | undefined {
  if (!id) return undefined;
  return (ctx.equippedCards ?? []).find((c) => c.id === id)
    ?? (ctx.knownCards ?? []).find((c) => c.id === id);
}

/** Default attack mode is an explicit mechanics fact, never a display-field inference. */
export function weaponCategory(card: Card): 'melee' | 'ranged' | undefined {
  const parsed = parseWeaponProfile(card);
  return parsed.valid ? parsed.profile.defaultAttackMode : undefined;
}

function pickAbility(profile: WeaponProfile, character: CharacterContext): 'str' | 'dex' {
  const best = () => ((character.abilityMods.dex ?? 0) > (character.abilityMods.str ?? 0) ? 'dex' : 'str');
  return profile.attackAbility === 'finesse' ? best() : profile.attackAbility;
}

/** Compatibility projection of the declared attack enchantment; names are never parsed. */
export function weaponEnchant(card: Card): number {
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) throw new Error(parsed.issue);
  return parsed.profile.enchantment.attackBonus;
}

/**
 * Магические бонусы предмета действуют, если он не требует настройки ИЛИ на него
 * настроены. Ненастроенный магический предмет даёт только чистые статы (общее правило
 * настройки; пока применяется к оружию). attunedIds:undefined означает неизвестный факт и
 * fail-closed оставляет магические бонусы неактивными.
 */
function itemBonusesActive(
  card: Card,
  profile: WeaponProfile,
  character: CharacterContext,
): boolean {
  if (!profile.attunement.required) return true;
  if (character.attunedIds == null) return false;
  return character.attunedIds.includes(card.id);
}

/**
 * Все строки урона оружия: основная (bonus_value+damage_type) и стихийная
 * (elemental_damage_value+elemental_damage_type), если задана. Гранулярность №4 —
 * каждая строка отдельна, движок бросает и применяет их независимо.
 * magic=false (не настроен) — стихийный урон отбрасывается (это магическое свойство).
 */
function weaponDamages(
  profile: WeaponProfile,
  twoHandedGrip: boolean,
  magic: boolean,
): Array<{ dice: string; type: string }> {
  const out = profile.damageLines.map((line) => ({ ...line }));
  if (twoHandedGrip && profile.versatileGrip) out[0] = { ...profile.versatileGrip };
  if (magic) out.push(...profile.enchantment.extraDamageLines.map((line) => ({ ...line })));
  return out;
}

function cardToWeapon(
  card: Card,
  character: CharacterContext,
  twoHandedGrip = false,
): WeaponContext | null {
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) return null;
  const { profile } = parsed;
  const magic = itemBonusesActive(card, profile, character);
  const damages = weaponDamages(profile, twoHandedGrip, magic);
  return {
    cardId: card.id,
    name: card.name,
    dice: damages[0].dice,
    ability: pickAbility(profile, character),
    damageType: damages[0].type,
    damages,
    enchant: magic ? profile.enchantment.attackBonus : 0,
    attackEnchant: magic ? profile.enchantment.attackBonus : 0,
    damageEnchant: magic ? profile.enchantment.damageBonus : 0,
    properties: [...profile.properties],
    ...(profile.heavyRule ? {
      heavyRule: {
        ...profile.heavyRule,
        abilityByMode: { ...profile.heavyRule.abilityByMode },
      },
    } : {}),
    weaponType: profile.weaponType,
    proficiencyCategory: profile.proficiencyCategory,
    defaultAttackMode: profile.defaultAttackMode,
    attackModes: profile.attackModes.map((mode) => ({ ...mode })),
    // Искусность — НЕ магическое свойство: работает и без настройки (гейт — выбор персонажа).
    mastery: profile.masteryEffectId,
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
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) throw new Error(parsed.issue);
  return pickAbility(parsed.profile, character);
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

/**
 * Рукопашная / дальнобойная атака ОДНОГО effect'а (для дистанционного гейта B/C: автокрит и
 * проекция «Распластан» зависят от типа атаки). unarmed → melee; оружейная (on_hit dice:'weapon')
 * → по свойству ammunition оружия в руке (лук/арбалет = ranged, иначе melee). Не-оружейная
 * (атака заклинанием) → undefined: дальность неизвестна, range-гейт закрыт по умолчанию.
 */
export function attackRangeFromEffect(
  effect: Dict,
  hand: 'main' | 'off',
  character: CharacterContext,
  equipment?: Record<string, string | null | undefined>,
): 'melee' | 'ranged' | undefined {
  if (String(effect.attack_kind ?? '') === 'unarmed') return 'melee';
  const onHit = Array.isArray(effect.on_hit) ? (effect.on_hit as Dict[]) : [];
  if (!onHit.some((p) => p.dice === 'weapon')) return undefined;
  const w = weaponContext(character, hand, equipment);
  if (!w) return undefined;
  const declared = String(effect.attack_kind ?? '');
  const requested = declared === 'weapon_ranged'
    ? 'ranged'
    : declared === 'weapon_melee'
      ? 'melee'
      : w.defaultAttackMode;
  return w.attackModes.some((mode) => mode.kind === requested) ? requested : undefined;
}

/** Typed facts for attack-roll modifier filters, derived from mechanics and equipped Card data. */
export function attackRollQueryFacts(
  effect: Dict,
  hand: 'main' | 'off',
  character: CharacterContext,
  equipment?: Record<string, string | null | undefined>,
): Pick<ModifierQueryFacts, 'attackKind' | 'weaponCategory'> {
  const declaredKind = String(effect.attack_kind ?? '').toLowerCase();
  if (declaredKind === 'unarmed') return { attackKind: 'unarmed' };
  if (declaredKind === 'spell') return { attackKind: 'spell' };
  const onHit = Array.isArray(effect.on_hit) ? (effect.on_hit as Dict[]) : [];
  const isWeaponAttack = declaredKind.startsWith('weapon')
    || onHit.some((payload) => payload.dice === 'weapon');
  if (!isWeaponAttack) return { attackKind: 'spell' };
  const weapon = weaponContext(character, hand, equipment);
  return {
    attackKind: 'weapon',
    ...(weapon ? { weaponCategory: weapon.defaultAttackMode } : {}),
  };
}

/**
 * Identify the legacy action's Light-property extra attack from canonical
 * action tags plus two distinct equipped Light weapon Cards. No caller/UI flag
 * can make a non-Light weapon qualify.
 */
export function extraAttackSourceFromEffect(
  effect: Dict,
  hand: 'main' | 'off',
  character: CharacterContext,
  equipment?: Record<string, string | null | undefined>,
): NonNullable<ModifierQueryFacts['extraAttackSource']> {
  const tags = Array.isArray(effect.tags) ? effect.tags.map(String) : [];
  const canonicalLightExtra = tags.includes('light_property_extra_attack');
  if (!canonicalLightExtra && (hand !== 'off' || !tags.includes('two_weapon'))) return 'none';
  const main = weaponContext(character, 'main', equipment);
  const off = weaponContext(character, 'off', equipment);
  if (!main || !off || main.cardId === off.cardId) return 'other';
  const mainLight = main.properties.map((value) => value.toLowerCase()).includes('light');
  const offLight = off.properties.map((value) => value.toLowerCase()).includes('light');
  return mainLight && offLight ? 'light_property' : 'other';
}

// ─── Доступность оружейных действий по экипировке ───────────────────────────

export interface ActionAvailability {
  available: boolean;
  /** Причина недоступности (слой поверх превью, парадигма №2). */
  reason?: string;
}

function isWeaponCard(card: Card | undefined): boolean {
  return card?.type === 'weapon' && parseWeaponProfile(card).valid;
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

export const EQUIPPED_WEAPON_AMMO_RESOURCE = 'equipped_weapon_ammo' as const;

function selectedWeaponForMechanics(
  mechanics: Dict,
  equipment: Record<string, string | null | undefined> | undefined,
  cardsById: Map<string, Card>,
): { hand: 'main' | 'off'; weapon: Card; profile: WeaponProfile } | null {
  const kind = weaponAttackKind(mechanics);
  if (kind !== 'main' && kind !== 'off') return null;
  const slotId = kind === 'main' ? equipment?.main_hand : equipment?.off_hand;
  const weapon = slotId ? cardsById.get(slotId) : undefined;
  if (!slotId || !weapon || weapon.type !== 'weapon') {
    throw new Error(`weapon action requires a weapon in the ${kind} hand`);
  }
  const parsed = parseWeaponProfile(weapon);
  if (!parsed.valid) throw new Error(parsed.issue);
  return { hand: kind, weapon, profile: parsed.profile };
}

/**
 * Materialize the actor-specific targeting ceiling from the selected weapon.
 * The returned mechanics object is what the canonical action compiler, UI and
 * handler consume; the catalog template's broad contextual ceiling is never
 * an executable targeting authority.
 */
export function bindEquippedWeaponProfileTargeting(
  mechanics: Dict | null | undefined,
  equipment: Record<string, string | null | undefined> | undefined,
  cardsById: Map<string, Card>,
): Dict {
  if (!mechanics) return {};
  const selected = selectedWeaponForMechanics(mechanics, equipment, cardsById);
  if (!selected) return mechanics;
  const targeting = mechanics.targeting;
  if (!targeting || typeof targeting !== 'object' || Array.isArray(targeting)) {
    throw new Error('weapon action requires explicit mechanics.targeting');
  }
  const ranges = selected.profile.attackModes.map((mode) => (
    mode.kind === 'melee' ? mode.reachFt : mode.longFt
  ));
  if (!ranges.length || ranges.some((range) => !Number.isFinite(range) || range <= 0)) {
    throw new Error(`${selected.weapon.id}: weapon_profile has no usable attack range`);
  }
  return {
    ...mechanics,
    targeting: { ...(targeting as Dict), range_ft: Math.max(...ranges) },
  };
}

function declaredWeaponAmmo(weapon: Card): { cardId: string; name?: string } | null {
  const parsed = parseWeaponProfile(weapon);
  if (!parsed.valid) throw new Error(parsed.issue);
  return parsed.profile.ammo;
}

/**
 * Resolve the explicitly declared contextual activation cost against the
 * weapon selected by the action's ordinary weapon markers. With no marker,
 * weapon data is never inspected and ammunition can never be spent.
 */
export function bindEquippedWeaponAmmoCost(
  mechanics: Dict | null | undefined,
  equipment: Record<string, string | null | undefined> | undefined,
  cardsById: Map<string, Card>,
): Dict {
  if (!mechanics) return {};
  const activation = mechanics.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mechanics;
  const contextual = (activation.cost as Dict[]).filter((entry) => (
    entry?.resource === EQUIPPED_WEAPON_AMMO_RESOURCE
  ));
  if (!contextual.length) return mechanics;
  if (contextual.length !== 1) {
    throw new Error('activation.cost must contain at most one equipped_weapon_ammo entry');
  }
  const marker = contextual[0];
  if (Object.keys(marker).some((key) => !['resource', 'amount'].includes(key))
    || !Number.isSafeInteger(marker.amount)
    || Number(marker.amount) <= 0) {
    throw new Error('activation.cost equipped_weapon_ammo requires only a positive integer amount');
  }
  const kind = weaponAttackKind(mechanics);
  if (kind !== 'main' && kind !== 'off') {
    throw new Error('activation.cost equipped_weapon_ammo requires a main/off weapon attack');
  }
  const selected = selectedWeaponForMechanics(mechanics, equipment, cardsById);
  if (!selected || selected.hand !== kind) {
    throw new Error(`activation.cost equipped_weapon_ammo requires a weapon in the ${kind} hand`);
  }
  const { weapon } = selected;
  const ammo = declaredWeaponAmmo(weapon);
  const cost = (activation.cost as Dict[]).flatMap((entry) => {
    if (entry.resource !== EQUIPPED_WEAPON_AMMO_RESOURCE) return [entry];
    if (!ammo) return [];
    return [{
      resource: 'item',
      card_id: ammo.cardId,
      amount: Number(marker.amount),
      ...(ammo.name ? { name: ammo.name } : {}),
    }];
  });
  return { ...mechanics, activation: { ...activation, cost } };
}

/** One actor-context projection used before canonical compilation. */
export function bindEquippedWeaponActionContext(
  mechanics: Dict | null | undefined,
  equipment: Record<string, string | null | undefined> | undefined,
  cardsById: Map<string, Card>,
): Dict {
  const targeted = bindEquippedWeaponProfileTargeting(mechanics, equipment, cardsById);
  return bindEquippedWeaponAmmoCost(targeted, equipment, cardsById);
}

// ─── Предпросмотр атаки/урона (парадигма №2) ────────────────────────────────

export interface WeaponAttackPreview {
  /** Бонус к броску атаки: «к20» + attack. */
  attack: number;
  /** Строки урона: {кость, плоский бонус, тип}. Пустая dice — только бонус (безоружный). */
  damages: Array<{ dice: string; bonus: number; type: string }>;
}

function previewFormulaContext(
  character: CharacterContext,
  weaponMod?: number,
): FormulaContext {
  return {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
    spellcastingMod: character.spellcastingMod,
    variables: character.variables,
    ...(weaponMod !== undefined ? { weaponMod } : {}),
  };
}

function attackModifierBonus(
  state: RuntimeState | undefined,
  passives: Dict[] | undefined,
  character: CharacterContext,
  filter: ModifierQueryFacts,
): number {
  if (!state) return 0;
  const collected = collectModifiers(state, passives ?? [], {
    roll: 'attack',
    filter,
    formulaCtx: previewFormulaContext(character),
    evalCtx: { character, state },
  });
  return collected.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

/** C1: сумма модификаторов урона из эффектов/пассивок для предпросмотра (парадигма №2 —
 *  превью = исполнению). Фильтр зеркалит resolveDamageAmounts и несёт только факты,
 *  выведенные из механики действия и реально экипированных Card. */
function damageModifierBonus(
  state: RuntimeState | undefined,
  passives: Dict[] | undefined,
  character: CharacterContext,
  filter: ModifierQueryFacts,
  weaponMod: number | undefined,
): number {
  if (!state) return 0;
  const collected = collectModifiers(state, passives ?? [], {
    roll: 'damage',
    filter,
    formulaCtx: previewFormulaContext(character, weaponMod),
    evalCtx: { character, state },
  });
  return collected.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

/**
 * Числа для подсказки оружейной атаки, посчитанные из оружия в соответствующей руке.
 * Использует ту же математику, что и исполнение (единый источник истины):
 *  - атака = мод характеристики + БМ при владении + зачарование;
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

  if (kind === 'unarmed') {
    const strMod = character.abilityMods.str ?? 0;
    return {
      attack: strMod + character.profBonus,
      damages: [{ dice: '1', bonus: strMod, type: 'bludgeoning' }],
    };
  }

  const hand: 'main' | 'off' = kind === 'off' ? 'off' : 'main';
  const w = weaponContext(character, hand, equipment);
  if (!w) return null;
  const prof = isWeaponProficient(
    character,
    w.weaponType,
    w.proficiencyCategory,
  ) ? character.profBonus : 0;
  const attackEffect = matchedAttackEffect(mechanics) as Dict;
  const attackFacts = attackRollQueryFacts(attackEffect, hand, character, equipment);

  // Бонус к БРОСКУ АТАКИ — зеркало attackAbilityMods (execute.ts): при ability:'auto'
  // берём мод оружия и зачарование; при явной характеристике — её мод без зачарования.
  const atkAbility = String(attackEffect.ability ?? 'auto');
  const atkAbilityMod = atkAbility === 'spellcasting'
    ? character.spellcastingMod ?? 0
    : atkAbility === 'auto'
      ? character.abilityMods[w.ability] ?? 0
      : character.abilityMods[atkAbility as keyof CharacterContext['abilityMods']] ?? 0;
  const attackEnchant = atkAbility === 'auto' ? w.attackEnchant : 0;
  const attackMods = attackModifierBonus(state, passives, character, attackFacts);

  const onHit = Array.isArray(attackEffect.on_hit) ? attackEffect.on_hit as Dict[] : [];
  const weaponDamage = onHit.find((payload) => payload.dice === 'weapon');
  const damageAbility = String(weaponDamage?.ability ?? 'auto');
  const damageAbilityBonus = damageAbility === 'none'
    ? 0
    : damageAbility === 'spellcasting'
      ? character.spellcastingMod ?? 0
      : damageAbility === 'auto'
        ? character.abilityMods[w.ability] ?? 0
        : character.abilityMods[damageAbility as AbilityKey] ?? 0;
  const usedAbility = damageAbility === 'auto'
    ? w.ability
    : damageAbility !== 'none' && damageAbility !== 'spellcasting'
      ? damageAbility as AbilityKey
      : undefined;
  const extraAttackSource = extraAttackSourceFromEffect(
    attackEffect, hand, character, equipment,
  );
  // C1: модификаторы урона из эффектов (Ярость и т.п.) — на основную строку, как в исполнении.
  const dmgMods = damageModifierBonus(state, passives, character, {
    hand,
    ...(usedAbility ? { ability: usedAbility } : {}),
    attackKind: attackFacts.attackKind,
    extraAttackSource,
    abilityModifierAlreadyIncluded: damageAbility !== 'none',
  }, atkAbilityMod);

  return {
    attack: atkAbilityMod + prof + attackEnchant + attackMods,
    damages: w.damages.map((d, i) => ({
      dice: d.dice,
      // Мод характеристики + зачарование + модификаторы эффектов — только на основную строку.
      bonus: i === 0 ? damageAbilityBonus + w.damageEnchant + dmgMods : 0,
      type: d.type,
    })),
  };
}
