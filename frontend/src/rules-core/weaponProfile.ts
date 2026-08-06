import type { Card } from '../types';

type Dict = Record<string, unknown>;

export type WeaponAttackMode =
  | { kind: 'melee'; reachFt: number }
  | { kind: 'ranged'; normalFt: number; longFt: number };

export interface WeaponDamageLine {
  dice: string;
  type: string;
}

export interface WeaponProfile {
  weaponType: string;
  proficiencyCategory: 'simple' | 'martial';
  attackAbility: 'str' | 'dex' | 'finesse';
  damageLines: WeaponDamageLine[];
  versatileGrip?: WeaponDamageLine;
  defaultAttackMode: 'melee' | 'ranged';
  attackModes: WeaponAttackMode[];
  properties: string[];
  heavyRule?: {
    minimumAbilityScore: number;
    abilityByMode: { melee: 'str'; ranged: 'dex' };
    consequence: 'attack_disadvantage';
  };
  masteryEffectId: string;
  ammo: { cardId: string; name?: string } | null;
  enchantment: {
    attackBonus: number;
    damageBonus: number;
    extraDamageLines: WeaponDamageLine[];
  };
  attunement: { required: boolean };
}

export type WeaponProfileParseResult =
  | { valid: true; profile: WeaponProfile }
  | { valid: false; issue: string };

const PROFILE_KEYS = new Set([
  'weapon_type',
  'proficiency_category',
  'attack_ability',
  'damage_lines',
  'versatile_grip',
  'default_attack_mode',
  'attack_modes',
  'properties',
  'heavy',
  'mastery_effect_id',
  'ammo',
  'enchantment',
  'attunement',
]);
const DAMAGE_LINE_KEYS = new Set(['dice', 'type']);
const MELEE_MODE_KEYS = new Set(['kind', 'reach_ft']);
const RANGED_MODE_KEYS = new Set(['kind', 'normal_ft', 'long_ft']);
const AMMO_KEYS = new Set(['card_id', 'name']);
const ENCHANTMENT_KEYS = new Set(['attack_bonus', 'damage_bonus', 'extra_damage_lines']);
const ATTUNEMENT_KEYS = new Set(['required']);
const HEAVY_KEYS = new Set(['minimum_ability_score', 'ability_by_mode', 'consequence']);
const HEAVY_ABILITY_KEYS = new Set(['melee', 'ranged']);
const NORMALIZED_PROPERTIES = new Set([
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'reach',
  'thrown',
  'two_handed',
  'versatile',
]);
const STABLE_ID = /^[a-z][a-z0-9_]*$/;
const DICE = /^[1-9]\d*d(?:[2468]|1[02]|20|100)$/;

function record(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Dict
    : null;
}

function exactKeys(value: Dict, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseDamageLine(value: unknown, path: string): WeaponDamageLine | string {
  const line = record(value);
  if (!line || !exactKeys(line, DAMAGE_LINE_KEYS)) return `${path} must contain only dice and type`;
  if (typeof line.dice !== 'string' || !DICE.test(line.dice)) {
    return `${path}.dice must be a normalized dice expression`;
  }
  if (!nonBlank(line.type) || !STABLE_ID.test(line.type)) {
    return `${path}.type must be a normalized non-blank damage type`;
  }
  return { dice: line.dice, type: line.type };
}

function parseAttackMode(value: unknown, path: string): WeaponAttackMode | string {
  const mode = record(value);
  if (!mode) return `${path} must be an object`;
  if (mode.kind === 'melee') {
    if (!exactKeys(mode, MELEE_MODE_KEYS) || !positiveNumber(mode.reach_ft)) {
      return `${path} melee mode requires only a positive reach_ft`;
    }
    return { kind: 'melee', reachFt: mode.reach_ft };
  }
  if (mode.kind === 'ranged') {
    if (!exactKeys(mode, RANGED_MODE_KEYS)
      || !positiveNumber(mode.normal_ft)
      || !positiveNumber(mode.long_ft)
      || mode.long_ft < mode.normal_ft) {
      return `${path} ranged mode requires positive normal_ft/long_ft with long_ft >= normal_ft`;
    }
    return { kind: 'ranged', normalFt: mode.normal_ft, longFt: mode.long_ft };
  }
  return `${path}.kind must be melee or ranged`;
}

/**
 * The one runtime parser for a weapon Card's rules declaration. It reads only
 * mechanics.weapon_profile and deliberately ignores legacy display fields.
 */
export function parseWeaponProfile(card: Pick<Card, 'id' | 'mechanics'>): WeaponProfileParseResult {
  const mechanics = record(card.mechanics);
  const raw = mechanics ? record(mechanics.weapon_profile) : null;
  const label = card.id || 'weapon';
  if (!raw) return { valid: false, issue: `${label}: mechanics.weapon_profile is required` };
  if (!exactKeys(raw, PROFILE_KEYS)) {
    return { valid: false, issue: `${label}: mechanics.weapon_profile contains unsupported fields` };
  }
  if (!nonBlank(raw.weapon_type) || !STABLE_ID.test(raw.weapon_type)) {
    return { valid: false, issue: `${label}: weapon_profile.weapon_type is invalid` };
  }
  if (raw.proficiency_category !== 'simple' && raw.proficiency_category !== 'martial') {
    return { valid: false, issue: `${label}: weapon_profile.proficiency_category is invalid` };
  }
  if (!['str', 'dex', 'finesse'].includes(String(raw.attack_ability))) {
    return { valid: false, issue: `${label}: weapon_profile.attack_ability is invalid` };
  }
  if (!Array.isArray(raw.damage_lines) || raw.damage_lines.length === 0) {
    return { valid: false, issue: `${label}: weapon_profile.damage_lines must be non-empty` };
  }
  const damageLines: WeaponDamageLine[] = [];
  for (let index = 0; index < raw.damage_lines.length; index += 1) {
    const parsed = parseDamageLine(raw.damage_lines[index], `weapon_profile.damage_lines[${index}]`);
    if (typeof parsed === 'string') return { valid: false, issue: `${label}: ${parsed}` };
    damageLines.push(parsed);
  }
  let versatileGrip: WeaponDamageLine | undefined;
  if (raw.versatile_grip !== undefined) {
    const parsed = parseDamageLine(raw.versatile_grip, 'weapon_profile.versatile_grip');
    if (typeof parsed === 'string') return { valid: false, issue: `${label}: ${parsed}` };
    versatileGrip = parsed;
  }
  if (raw.default_attack_mode !== 'melee' && raw.default_attack_mode !== 'ranged') {
    return { valid: false, issue: `${label}: weapon_profile.default_attack_mode is invalid` };
  }
  if (!Array.isArray(raw.attack_modes) || raw.attack_modes.length === 0) {
    return { valid: false, issue: `${label}: weapon_profile.attack_modes must be non-empty` };
  }
  const attackModes: WeaponAttackMode[] = [];
  for (let index = 0; index < raw.attack_modes.length; index += 1) {
    const parsed = parseAttackMode(raw.attack_modes[index], `weapon_profile.attack_modes[${index}]`);
    if (typeof parsed === 'string') return { valid: false, issue: `${label}: ${parsed}` };
    attackModes.push(parsed);
  }
  if (new Set(attackModes.map((mode) => mode.kind)).size !== attackModes.length) {
    return { valid: false, issue: `${label}: weapon_profile.attack_modes contains duplicate kinds` };
  }
  if (!attackModes.some((mode) => mode.kind === raw.default_attack_mode)) {
    return { valid: false, issue: `${label}: default attack mode is not declared` };
  }
  if (!Array.isArray(raw.properties)
    || raw.properties.some((property) => (
      typeof property !== 'string'
      || !NORMALIZED_PROPERTIES.has(property)
    ))
    || new Set(raw.properties).size !== raw.properties.length) {
    return { valid: false, issue: `${label}: weapon_profile.properties must be unique normalized properties` };
  }
  if ((raw.versatile_grip !== undefined) !== raw.properties.includes('versatile')) {
    return { valid: false, issue: `${label}: versatile property and versatile_grip must be declared together` };
  }
  let heavyRule: WeaponProfile['heavyRule'];
  if (raw.heavy !== undefined) {
    const heavy = record(raw.heavy);
    const abilities = heavy ? record(heavy.ability_by_mode) : null;
    if (!heavy || !exactKeys(heavy, HEAVY_KEYS)
      || !Number.isSafeInteger(heavy.minimum_ability_score)
      || Number(heavy.minimum_ability_score) <= 0
      || !abilities || !exactKeys(abilities, HEAVY_ABILITY_KEYS)
      || abilities.melee !== 'str' || abilities.ranged !== 'dex'
      || heavy.consequence !== 'attack_disadvantage') {
      return { valid: false, issue: `${label}: weapon_profile.heavy is invalid` };
    }
    heavyRule = {
      minimumAbilityScore: Number(heavy.minimum_ability_score),
      abilityByMode: { melee: 'str', ranged: 'dex' },
      consequence: 'attack_disadvantage',
    };
  }
  if ((heavyRule !== undefined) !== raw.properties.includes('heavy')) {
    return { valid: false, issue: `${label}: heavy property and heavy declaration must agree` };
  }
  if (attackModes.some((mode) => mode.kind === 'ranged')
    && !raw.properties.includes('ammunition')
    && !raw.properties.includes('thrown')) {
    return { valid: false, issue: `${label}: ranged attack mode requires ammunition or thrown` };
  }
  if (!nonBlank(raw.mastery_effect_id)) {
    return { valid: false, issue: `${label}: weapon_profile.mastery_effect_id is required` };
  }
  let ammo: WeaponProfile['ammo'];
  if (raw.ammo === null) {
    ammo = null;
  } else {
    const ammoValue = record(raw.ammo);
    if (!ammoValue || !exactKeys(ammoValue, AMMO_KEYS)
      || !nonBlank(ammoValue.card_id)
      || (ammoValue.name !== undefined && !nonBlank(ammoValue.name))) {
      return { valid: false, issue: `${label}: weapon_profile.ammo must be null or a stable card reference` };
    }
    ammo = {
      cardId: ammoValue.card_id,
      ...(typeof ammoValue.name === 'string' ? { name: ammoValue.name } : {}),
    };
  }
  if ((ammo !== null) !== raw.properties.includes('ammunition')) {
    return { valid: false, issue: `${label}: ammunition property and ammo reference must agree` };
  }
  const enchantment = record(raw.enchantment);
  if (!enchantment || !exactKeys(enchantment, ENCHANTMENT_KEYS)
    || !nonNegativeInteger(enchantment.attack_bonus)
    || !nonNegativeInteger(enchantment.damage_bonus)
    || !Array.isArray(enchantment.extra_damage_lines)) {
    return { valid: false, issue: `${label}: weapon_profile.enchantment is invalid` };
  }
  const extraDamageLines: WeaponDamageLine[] = [];
  for (let index = 0; index < enchantment.extra_damage_lines.length; index += 1) {
    const parsed = parseDamageLine(
      enchantment.extra_damage_lines[index],
      `weapon_profile.enchantment.extra_damage_lines[${index}]`,
    );
    if (typeof parsed === 'string') return { valid: false, issue: `${label}: ${parsed}` };
    extraDamageLines.push(parsed);
  }
  const attunement = record(raw.attunement);
  if (!attunement || !exactKeys(attunement, ATTUNEMENT_KEYS)
    || typeof attunement.required !== 'boolean') {
    return { valid: false, issue: `${label}: weapon_profile.attunement is invalid` };
  }
  return {
    valid: true,
    profile: {
      weaponType: raw.weapon_type,
      proficiencyCategory: raw.proficiency_category,
      attackAbility: raw.attack_ability as WeaponProfile['attackAbility'],
      damageLines,
      ...(versatileGrip ? { versatileGrip } : {}),
      defaultAttackMode: raw.default_attack_mode,
      attackModes,
      properties: [...raw.properties],
      ...(heavyRule ? { heavyRule } : {}),
      masteryEffectId: raw.mastery_effect_id,
      ammo,
      enchantment: {
        attackBonus: enchantment.attack_bonus,
        damageBonus: enchantment.damage_bonus,
        extraDamageLines,
      },
      attunement: { required: attunement.required },
    },
  };
}

export type WeaponHeavyRuleEvaluation =
  | { valid: true; disadvantage: boolean; ability: 'str' | 'dex'; threshold: number }
  | { valid: false; issue: string };

/** Evaluates the entirely data-owned Heavy declaration against authoritative ability scores. */
export function evaluateWeaponHeavyRule(
  profile: Pick<WeaponProfile, 'heavyRule'>,
  mode: 'melee' | 'ranged',
  abilityScores: Partial<Record<'str' | 'dex', number>> | undefined,
): WeaponHeavyRuleEvaluation | null {
  if (!profile.heavyRule) return null;
  const ability = profile.heavyRule.abilityByMode[mode];
  const score = abilityScores?.[ability];
  if (!Number.isInteger(score) || Number(score) < 1) {
    return { valid: false, issue: `Heavy weapon requires an authoritative ${ability} ability score` };
  }
  return {
    valid: true,
    disadvantage: Number(score) < profile.heavyRule.minimumAbilityScore,
    ability,
    threshold: profile.heavyRule.minimumAbilityScore,
  };
}

export function weaponAttackMode(
  profile: WeaponProfile,
  kind: 'melee' | 'ranged',
): WeaponAttackMode | undefined {
  return profile.attackModes.find((mode) => mode.kind === kind);
}

/** Selects a declared mode from explicit spatial facts; it never invents reach/range. */
export function weaponAttackModeAtDistance(
  profile: WeaponProfile,
  distanceFt: number,
): WeaponAttackMode | undefined {
  if (!Number.isFinite(distanceFt) || distanceFt < 0) return undefined;
  const melee = weaponAttackMode(profile, 'melee');
  if (melee?.kind === 'melee' && distanceFt <= melee.reachFt) return melee;
  const ranged = weaponAttackMode(profile, 'ranged');
  if (ranged?.kind === 'ranged' && distanceFt <= ranged.longFt) return ranged;
  return undefined;
}
