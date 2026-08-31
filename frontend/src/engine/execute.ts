/**
 * Единый исполнитель действий (фазы D4, E1–E5).
 */
import type {
  ActiveEffectEntry,
  AdvantageState,
  CharacterContext,
  DeferredTargetSave,
  EngineEvent,
  ExecuteContext,
  ExecuteResult,
  ReactionOffer,
  RollLog,
  RollModifier,
  RuntimeState,
  TargetContext,
} from '../mvp/contracts';
import { canPay, pay } from './cost';
import {
  conditionAppliedEvent, damageEvent, healingEvent, itemAddedEvent, narrativeEvent,
  formatRollBreakdown, resourceRestoredEvent, rollEvent, tempHpEvent,
} from './events';
import { evaluate, FormulaError, MissingVariableError, rollFormula, type AbilityKey, type FormulaContext } from './formula';
import {
  collectModifiers,
  foldAdvantage,
  foldModifiers,
  type ModifierQueryFacts,
} from './modifiers';
import {
  activeConditionsOf, creatureTypeMatches, matchesWhen, type EvalContext,
} from './circumstances';
import {
  conditionLevel,
  conditionModifierPayloads,
  conditionRuntimePayloads,
  conditionRule,
  conditionStacking,
  conditionLeaves,
  conditionLabel,
} from './conditions';
import { payloadsOf } from './mechanicsView';
import { selectedChoicePayloads, normalizeChoicePayload } from '../mechanics/expandChoices';
import { collectListeners, isAuto, toOffer, type DomainEvent } from './dispatch';
import { concentrationDC, concentrationEntry, dropConcentration } from './concentration';
import { retargetAttackRoll, rollD20 } from './roll';
import { applyDamageDieRules } from './rollRules';
import { drawDie } from './random';
import { hitDiceResourceKey, hitDieSides } from './resources';
import {
  attackRangeFromEffect,
  attackRollQueryFacts,
  equippedWeaponChoices,
  extraAttackSourceFromEffect,
  isWeaponProficient,
  weaponContext,
} from './weapon';
import { evaluateWeaponHeavyRule } from './weaponProfile';
import { activeMastery } from './mastery';
import { turnCommandEffectName, type TurnCommand } from './turnCommands';
import { getDamageLabel } from '../utils/damageTypes';

type Dict = Record<string, unknown>;

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

function formattedRoll(input: Omit<RollLog, 'text'>): RollLog {
  const roll: RollLog = { ...input, text: '' };
  return { ...roll, text: formatRollBreakdown(roll) };
}

export class InsufficientResourcesError extends Error {
  constructor(readonly missing: string[]) {
    super(`INSUFFICIENT_RESOURCES: ${missing.join(', ')}`);
    this.name = 'InsufficientResourcesError';
  }
}

export type MechanicsExecutionErrorCode =
  | 'INVALID_MECHANICS'
  | 'CANONICAL_PRIMITIVE_REQUIRED'
  | 'UNKNOWN_RESOLUTION'
  | 'UNKNOWN_PAYLOAD'
  | 'INVALID_PAYLOAD'
  | 'INVALID_FORMULA'
  | 'MISSING_CHOICE'
  | 'INVALID_CHOICE'
  | 'UNRESOLVED_GRANT_EFFECT';

/**
 * A data/adapter contract error detected before an action can spend resources.
 * `code` and `path` are stable machine-readable diagnostics; entity ids and
 * localized names deliberately never participate in dispatch.
 */
export class MechanicsExecutionError extends Error {
  constructor(
    readonly code: MechanicsExecutionErrorCode,
    readonly path: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${code} at ${path}: ${message}`, options);
    this.name = 'MechanicsExecutionError';
  }
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    hp: { ...state.hp },
    resources: { ...state.resources },
    maxResources: { ...state.maxResources },
    equipment: { ...state.equipment },
    inventory: state.inventory.map((r) => ({ ...r })),
    activeEffects: state.activeEffects.map((e) => ({ ...e })),
    deathSaves: state.deathSaves ? { ...state.deathSaves } : undefined,
    firedThisTurn: state.firedThisTurn ? [...state.firedThisTurn] : undefined,
    firedThisRest: state.firedThisRest ? [...state.firedThisRest] : undefined,
  };
}

function passivesFromCtx(ctx: ExecuteContext): Dict[] {
  return (ctx as ExecuteContext & { passives?: Dict[] }).passives ?? [];
}

function formulaCtx(ctx: ExecuteContext): FormulaContext {
  return {
    abilityMods: ctx.character.abilityMods,
    profBonus: ctx.character.profBonus,
    selfLevel: ctx.character.level,
    classLevels: ctx.character.classLevels,
    spellcastingMod: ctx.character.spellcastingMod,
    variables: ctx.character.variables,
    // Искусность 2024: модификатор характеристики атаки текущим оружием (weapon_mod).
    // Проставляется только на прогоне механики мастерства (см. runAttackRoll).
    weaponMod: ctx.weaponMod,
    rng: ctx.rng,
  };
}

/** Контекст формул ЦЕЛИ (её характеристики/уровень/переменные) — для formula-aware
 *  вычисления проецируемых цель→атакующий модификаторов. null, если цель обобщённая. */
function targetFormulaCtx(target: ExecuteContext['target']): FormulaContext | null {
  const cc = target?.characterContext;
  if (!cc) return null;
  return {
    abilityMods: cc.abilityMods,
    profBonus: cc.profBonus,
    selfLevel: cc.level,
    classLevels: cc.classLevels,
    spellcastingMod: cc.spellcastingMod,
    variables: cc.variables,
  };
}

const EXECUTABLE_RESOLUTIONS = new Set(['auto', 'attack_roll', 'save', 'ability_check']);
const EXECUTABLE_PAYLOAD_KINDS = new Set([
  'damage', 'damage_rider', 'healing', 'reduce_damage', 'temp_hp', 'condition', 'resource',
  'modifier', 'attack_follow_up', 'grant_sense', 'resistance', 'set_value',
  'condition_immunity', 'triggered_effect', 'fall_protection', 'movement_option',
  'targeting_ward', 'turn_command',
  'stabilize', 'weapon_enchantment', 'remote_manipulator', 'communication_link',
  'world_interaction', 'illusion', 'temporary_consumable', 'world_entity',
  'information_access', 'information_reveal', 'world_zone',
  'grant_effect', 'choice', 'add_item', 'movement', 'boon', 'reroll',
  'transform', 'narrative',
]);
const ABILITY_KEYS = new Set<AbilityKey>(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const ATTACK_ABILITIES = new Set([...ABILITY_KEYS, 'auto', 'spellcasting']);
const MODIFIER_OPS = new Set([
  'add', 'set', 'advantage', 'disadvantage', 'reroll', 'multiply', 'upgrade',
  'downgrade', 'auto_fail', 'auto_crit', 'deny', 'set_die', 'crit_range',
  'outcome', 'on_roll', 'minimum_die', 'die_bonus', 'bonus_die', 'explode',
  'minimum_total', 'reroll_damage', 'reroll_healing_ones',
]);
const NUMERIC_MODIFIER_OPS = new Set([
  'add', 'set', 'multiply', 'upgrade', 'downgrade', 'crit_range', 'minimum_die', 'die_bonus',
  'minimum_total',
]);
const MOVEMENT_MODES = new Set(['push', 'pull', 'teleport', 'extra_speed', 'double', 'knock_prone', 'move']);
const RESISTANCE_LEVELS = new Set(['resistance', 'immunity', 'vulnerability']);
const TARGETING_WARD_INTERACTIONS = new Set(['attack_roll', 'damaging_spell']);
const TURN_COMMANDS = new Set(['approach', 'drop', 'flee', 'grovel', 'halt']);
const MAX_PREFLIGHT_DEPTH = 12;
const PREFLIGHT_RNG = () => 0.5;

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mechanicsError(
  code: MechanicsExecutionErrorCode,
  path: string,
  message: string,
  cause?: unknown,
): MechanicsExecutionError {
  return new MechanicsExecutionError(code, path, message, cause === undefined ? undefined : { cause });
}

function preflightFormulaCtx(ctx: ExecuteContext, targetOwned = false): FormulaContext {
  const base = targetOwned ? (targetFormulaCtx(ctx.target) ?? formulaCtx(ctx)) : formulaCtx(ctx);
  return { ...base, rng: PREFLIGHT_RNG };
}

/** Parse and evaluate without consuming the caller's RNG tape. */
function assertFiniteFormula(
  value: unknown,
  path: string,
  ctx: ExecuteContext,
  targetOwned = false,
): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw mechanicsError('INVALID_FORMULA', path, 'expected a formula string or number');
  }
  try {
    const result = evaluate(value, preflightFormulaCtx(ctx, targetOwned));
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new FormulaError('formula must resolve to a finite number');
    }
    return result;
  } catch (error) {
    throw mechanicsError(
      'INVALID_FORMULA',
      path,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

function explicitAbility(
  value: unknown,
  path: string,
  supported: ReadonlySet<string>,
  label: string,
): string {
  if (typeof value !== 'string' || !supported.has(value)) {
    throw mechanicsError(
      'INVALID_PAYLOAD',
      path,
      `${label} requires an explicit supported ability`,
    );
  }
  return value;
}

function explicitPositiveDc(
  value: unknown,
  path: string,
  ctx: ExecuteContext,
): number {
  if (value === undefined) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'resolution requires an explicit DC formula');
  }
  const dc = assertFiniteFormula(value, path, ctx);
  if (dc <= 0) {
    throw mechanicsError('INVALID_FORMULA', path, 'DC formula must resolve to a positive number');
  }
  return dc;
}

function explicitTargetArmorClass(ctx: ExecuteContext): number {
  const ac = ctx.target?.ac;
  if (typeof ac !== 'number' || !Number.isFinite(ac) || ac <= 0) {
    throw mechanicsError(
      'INVALID_MECHANICS',
      'context.target.ac',
      'attack resolution requires an explicit positive finite target AC',
    );
  }
  return ac;
}

function explicitCharacterAbilityModifier(
  ctx: ExecuteContext,
  ability: AbilityKey,
): number {
  const modifier = ctx.character?.abilityMods?.[ability];
  if (typeof modifier !== 'number' || !Number.isFinite(modifier)) {
    throw mechanicsError(
      'INVALID_MECHANICS',
      `context.character.abilityMods.${ability}`,
      'resolution requires an explicit finite actor ability modifier',
    );
  }
  return modifier;
}

function explicitCharacterProficiencyBonus(ctx: ExecuteContext): number {
  const bonus = ctx.character?.profBonus;
  if (typeof bonus !== 'number' || !Number.isFinite(bonus)) {
    throw mechanicsError(
      'INVALID_MECHANICS',
      'context.character.profBonus',
      'D20 resolution requires an explicit finite actor proficiency bonus',
    );
  }
  return bonus;
}

function explicitTargetSaveModifier(ctx: ExecuteContext, ability: AbilityKey): number {
  const targetCharacter = ctx.target?.characterContext;
  if (targetCharacter) {
    const base = targetCharacter.abilityMods[ability];
    if (typeof base !== 'number' || !Number.isFinite(base)
      || typeof targetCharacter.profBonus !== 'number'
      || !Number.isFinite(targetCharacter.profBonus)) {
      throw mechanicsError(
        'INVALID_MECHANICS',
        `context.target.characterContext.abilityMods.${ability}`,
        'save resolution requires explicit finite target ability and proficiency facts',
      );
    }
    return base + (targetCharacter.saveProficiencies?.includes(ability)
      ? targetCharacter.profBonus
      : 0);
  }
  const modifier = ctx.target?.saveMods?.[ability];
  if (typeof modifier !== 'number' || !Number.isFinite(modifier)) {
    throw mechanicsError(
      'INVALID_MECHANICS',
      `context.target.saveMods.${ability}`,
      'save resolution requires an explicit finite target save modifier',
    );
  }
  return modifier;
}

function explicitContestSkills(effect: Dict, path: string, ctx: ExecuteContext): string[] {
  if (!Array.isArray(effect.contest_vs)
    || effect.contest_vs.length === 0
    || effect.contest_vs.some((skill) => typeof skill !== 'string' || !skill.trim())
    || new Set(effect.contest_vs).size !== effect.contest_vs.length) {
    throw mechanicsError(
      'INVALID_PAYLOAD',
      `${path}.contest_vs`,
      'contest requires explicit distinct non-empty defending skills',
    );
  }
  const skills = effect.contest_vs as string[];
  for (const skill of skills) {
    const modifier = ctx.target?.checkMods?.[skill];
    if (typeof modifier !== 'number' || !Number.isFinite(modifier)) {
      throw mechanicsError(
        'INVALID_MECHANICS',
        `context.target.checkMods.${skill}`,
        'contest requires an explicit finite modifier for every defending skill',
      );
    }
  }
  return skills;
}

function assertDeterministicFiniteFormula(
  value: unknown,
  path: string,
  ctx: ExecuteContext,
): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw mechanicsError('INVALID_FORMULA', path, 'expected a formula string or number');
  }
  try {
    const result = evaluate(value, {
      ...preflightFormulaCtx(ctx),
      rng: () => { throw new FormulaError('formula binding cannot contain a random die'); },
    });
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new FormulaError('formula binding must resolve to a finite number');
    }
    return result;
  } catch (error) {
    throw mechanicsError(
      'INVALID_FORMULA',
      path,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

/** Activation costs must be deterministic: a price may use actor variables,
 * but cannot roll dice while the engine is deciding whether it can be paid. */
function resolveCostAmount(value: unknown, path: string, ctx: ExecuteContext): number {
  if (value === undefined) return 1;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw mechanicsError('INVALID_FORMULA', path, 'cost amount must be a deterministic formula');
  }
  try {
    const result = evaluate(value, {
      ...preflightFormulaCtx(ctx),
      rng: () => { throw new FormulaError('activation cost cannot contain a random die'); },
    });
    if (typeof result !== 'number' || !Number.isFinite(result)
      || !Number.isInteger(result) || result <= 0) {
      throw new FormulaError('cost amount must resolve to a positive integer');
    }
    return result;
  } catch (error) {
    throw mechanicsError(
      'INVALID_FORMULA',
      path,
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

/** Validate and resolve the exact cost array that canPay/pay will receive.
 * Formula prices are reduced once to numeric values, so resources cannot be
 * checked using one amount and consumed using another. */
function preflightActivationCost(mechanics: Dict, ctx: ExecuteContext): Dict[] {
  if (mechanics.activation === undefined) return [];
  if (!isDict(mechanics.activation)) {
    throw mechanicsError('INVALID_MECHANICS', 'mechanics.activation', 'activation must be an object');
  }
  const activation = mechanics.activation;
  if (activation.cost === undefined) return [];
  if (!Array.isArray(activation.cost)) {
    throw mechanicsError('INVALID_MECHANICS', 'mechanics.activation.cost', 'activation cost must be an array');
  }
  return activation.cost.map((entry, index) => {
    const path = `mechanics.activation.cost[${index}]`;
    if (!isDict(entry)) {
      throw mechanicsError('INVALID_PAYLOAD', path, 'cost entry must be an object');
    }
    if (typeof entry.resource !== 'string' || !entry.resource.trim()) {
      throw mechanicsError('INVALID_PAYLOAD', `${path}.resource`, 'cost resource must be non-empty');
    }
    if (entry.resource === 'item'
      && (typeof entry.card_id !== 'string' || !entry.card_id.trim())) {
      throw mechanicsError('INVALID_PAYLOAD', `${path}.card_id`, 'item cost requires a non-empty card_id');
    }
    if (entry.level !== undefined
      && (!Number.isInteger(entry.level) || Number(entry.level) < 0 || Number(entry.level) > 9)) {
      throw mechanicsError('INVALID_PAYLOAD', `${path}.level`, 'cost level must be an integer from 0 to 9');
    }
    return {
      ...entry,
      resource: entry.resource,
      amount: resolveCostAmount(entry.amount, `${path}.amount`, ctx),
    };
  });
}

function assertPayloadArray(
  value: unknown,
  path: string,
  state: RuntimeState,
  ctx: ExecuteContext,
  targetOwned: boolean,
  depth: number,
  hand: 'main' | 'off' = 'main',
): void {
  if (!Array.isArray(value)) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'expected an array of payloads');
  }
  value.forEach((payload, index) => preflightPayload(
    payload,
    `${path}[${index}]`,
    state,
    ctx,
    targetOwned,
    depth + 1,
    hand,
  ));
}

function grantEffectSlugs(payload: Dict, path: string): string[] {
  const slugs: string[] = [];
  if (payload.value !== undefined) {
    if (typeof payload.value !== 'string' || !payload.value.trim()) {
      throw mechanicsError('INVALID_PAYLOAD', `${path}.value`, 'expected a non-empty effect reference');
    }
    slugs.push(payload.value);
  }
  if (payload.values !== undefined) {
    if (!Array.isArray(payload.values) || payload.values.some((value) => typeof value !== 'string' || !value.trim())) {
      throw mechanicsError('INVALID_PAYLOAD', `${path}.values`, 'expected non-empty effect references');
    }
    slugs.push(...payload.values as string[]);
  }
  if (!slugs.length) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'grant_effect has no effect reference');
  }
  return [...new Set(slugs)];
}

function preflightModifier(
  payload: Dict,
  path: string,
  state: RuntimeState,
  ctx: ExecuteContext,
  targetOwned: boolean,
  depth: number,
  hand: 'main' | 'off',
): void {
  const op = String(payload.op ?? 'add');
  if (!MODIFIER_OPS.has(op)) {
    throw mechanicsError('INVALID_PAYLOAD', `${path}.op`, `unsupported modifier operation «${op}»`);
  }
  if (!isDict(payload.applies_to)) {
    throw mechanicsError('INVALID_PAYLOAD', `${path}.applies_to`, 'modifier must declare its engine query');
  }
  if (NUMERIC_MODIFIER_OPS.has(op)) {
    const formula = typeof payload.value === 'string'
      ? payload.value.replace(/^\+/, '')
      : payload.value;
    assertFiniteFormula(formula, `${path}.value`, ctx, targetOwned);
  }
  if (op === 'set_die' || op === 'bonus_die') {
    const faces = Number(payload.faces ?? payload.die ?? payload.value);
    if (!Number.isFinite(faces) || faces < 2) {
      throw mechanicsError('INVALID_PAYLOAD', path, `${op} requires at least two die faces`);
    }
  }
  if (op === 'explode') {
    const limit = payload.limit ?? payload.value;
    if (limit === undefined) {
      throw mechanicsError('INVALID_PAYLOAD', path, 'explode requires a limit formula');
    }
    assertFiniteFormula(limit, `${path}.${payload.limit === undefined ? 'value' : 'limit'}`, ctx, targetOwned);
  }
  if (op === 'outcome' && typeof (payload.value ?? payload.outcome) !== 'string') {
    throw mechanicsError('INVALID_PAYLOAD', path, 'outcome requires a string result');
  }
  if (op === 'on_roll') {
    const nested = payload.then ?? payload.result;
    assertPayloadArray(
      nested,
      `${path}.${payload.then === undefined ? 'result' : 'then'}`,
      state,
      ctx,
      targetOwned,
      depth,
      hand,
    );
  }
}

function preflightChoice(
  payload: Dict,
  path: string,
  state: RuntimeState,
  ctx: ExecuteContext,
  targetOwned: boolean,
  depth: number,
  hand: 'main' | 'off',
): void {
  const id = String(payload.id ?? 'choice');
  const raw = ctx.choices?.[id];
  if (raw == null) {
    throw mechanicsError('MISSING_CHOICE', path, `runtime choice «${id}» was not resolved`);
  }
  const selected = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => (
    typeof value === 'string' && value.length > 0
  ));
  const expected = Math.max(1, Math.floor(Number(payload.count ?? 1)) || 1);
  if (selected.length !== expected || new Set(selected).size !== selected.length) {
    throw mechanicsError(
      'INVALID_CHOICE',
      path,
      `runtime choice «${id}» requires ${expected} distinct selection(s)`,
    );
  }
  const options = isDict(payload.options) ? payload.options : {};
  const source = String(options.source ?? payload.source ?? '');
  if (source === 'equipped_weapon') {
    const filter = Array.isArray(options.filter ?? payload.filter)
      ? (options.filter ?? payload.filter) as string[]
      : [];
    const eligible = new Set(equippedWeaponChoices(ctx.character, state.equipment, filter)
      .map((weapon) => weapon.id));
    const invalid = selected.filter((id) => !eligible.has(id));
    if (invalid.length) {
      throw mechanicsError(
        'INVALID_CHOICE', path,
        `runtime choice «${id}» contains a weapon that is not currently equipped and eligible`,
      );
    }
    return;
  }
  const expanded = selectedChoicePayloads(payload, selected).map(normalizeChoicePayload);
  if (!expanded.length) {
    throw mechanicsError('INVALID_CHOICE', path, `runtime choice «${id}» has no executable selected branch`);
  }
  expanded.forEach((candidate, index) => preflightPayload(
    candidate,
    `${path}.selected[${index}]`,
    state,
    ctx,
    targetOwned,
    depth + 1,
    hand,
  ));
}

function preflightPayload(
  value: unknown,
  path: string,
  state: RuntimeState,
  ctx: ExecuteContext,
  targetOwned: boolean,
  depth: number,
  hand: 'main' | 'off' = 'main',
): void {
  if (depth > MAX_PREFLIGHT_DEPTH) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'payload nesting exceeds the engine limit');
  }
  if (!isDict(value)) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'payload must be an object');
  }
  const kind = typeof value.kind === 'string' ? value.kind : '';
  if (!EXECUTABLE_PAYLOAD_KINDS.has(kind)) {
    throw mechanicsError('UNKNOWN_PAYLOAD', `${path}.kind`, `executor does not own payload kind «${kind || '?'}»`);
  }

  switch (kind) {
    case 'damage': {
      const base = value.amount ?? value.dice;
      if (base == null) throw mechanicsError('INVALID_PAYLOAD', path, 'damage requires amount or dice');
      if (typeof value.type !== 'string' || !value.type.trim()) {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.type`,
          'damage requires an explicit non-empty damage type',
        );
      }
      if (base === 'weapon' && value.type !== 'weapon') {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.type`,
          'weapon damage dice require the explicit weapon damage type',
        );
      }
      if ((base === 'weapon' || value.type === 'weapon')
        && !weaponContext(ctx.character, hand, state.equipment, state)) {
        throw mechanicsError(
          'INVALID_MECHANICS',
          'context.character.equipment',
          `weapon damage requires an explicit equipped ${hand}-hand weapon`,
        );
      }
      if (base !== 'weapon') {
        assertFiniteFormula(withScaling(String(base), value, ctx), `${path}.${value.amount == null ? 'dice' : 'amount'}`, ctx);
      }
      const explode = value.explode;
      if (isDict(explode) && explode.limit !== undefined) {
        assertFiniteFormula(explode.limit, `${path}.explode.limit`, ctx);
      } else if (explode !== undefined && typeof explode !== 'boolean') {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.explode`, 'expected a boolean or an object');
      }
      break;
    }
    case 'damage_rider': {
      if (value.trigger !== 'hit_by_attack_roll') {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.trigger`,
          'damage_rider requires trigger hit_by_attack_roll',
        );
      }
      if (typeof value.dice !== 'string' || !value.dice.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.dice`, 'damage_rider requires dice');
      }
      if (typeof value.type !== 'string' || !value.type.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.type`, 'damage_rider requires a damage type');
      }
      assertFiniteFormula(withScaling(value.dice, value, ctx), `${path}.dice`, ctx);
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'damage_rider requires duration');
      }
      if (value.source_actor_only === true && value.scope !== 'target') {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.source_actor_only`,
          'source_actor_only is valid only for a target-scoped rider',
        );
      }
      break;
    }
    case 'condition_immunity': {
      if (typeof value.condition !== 'string' || !value.condition.trim()) {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.condition`,
          'condition_immunity requires a non-empty condition id',
        );
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'condition_immunity requires duration');
      }
      if (value.source_creature_types !== undefined
        && (!Array.isArray(value.source_creature_types)
          || value.source_creature_types.length === 0
          || value.source_creature_types.some((candidate) => typeof candidate !== 'string' || !candidate.trim()))) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.source_creature_types`,
          'source creature types must be a non-empty string array',
        );
      }
      break;
    }
    case 'targeting_ward': {
      const protects = value.protects;
      if (!Array.isArray(protects) || protects.length === 0
        || protects.some((candidate) => typeof candidate !== 'string'
          || !TARGETING_WARD_INTERACTIONS.has(candidate))) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.protects`, 'targeting ward requires supported protected interactions',
        );
      }
      explicitAbility(value.save_ability, `${path}.save_ability`, ABILITY_KEYS, 'targeting ward');
      explicitPositiveDc(value.dc, `${path}.dc`, ctx);
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'targeting ward requires duration');
      }
      if (!Array.isArray(value.end_triggers) || value.end_triggers.length === 0
        || value.end_triggers.some((candidate) => typeof candidate !== 'string' || !candidate.trim())) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.end_triggers`, 'targeting ward requires observable end triggers',
        );
      }
      break;
    }
    case 'turn_command': {
      if (typeof value.command !== 'string' || !TURN_COMMANDS.has(value.command)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.command`, 'turn command requires a supported command');
      }
      if (value.execute_at !== 'next_turn') {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.execute_at`, 'turn command must execute at next turn');
      }
      break;
    }
    case 'stabilize': {
      const target = targetOwned ? ctx.target?.runtimeState : state;
      if (!target || target.hp.current !== 0 || target.deathSaves?.dead === true) {
        throw mechanicsError(
          'INVALID_MECHANICS', path,
          'stabilize requires a living target at exactly 0 HP',
        );
      }
      break;
    }
    case 'weapon_enchantment': {
      const weaponChoiceId = String(value.weapon_choice_id ?? '');
      const damageChoiceId = String(value.damage_type_choice_id ?? '');
      const weaponSelection = ctx.choices?.[weaponChoiceId];
      const damageSelection = ctx.choices?.[damageChoiceId];
      const weaponId = Array.isArray(weaponSelection) ? weaponSelection[0] : weaponSelection;
      const damageType = Array.isArray(damageSelection) ? damageSelection[0] : damageSelection;
      const eligibleTypes = Array.isArray(value.eligible_weapon_types)
        ? value.eligible_weapon_types.map(String)
        : [];
      if (typeof weaponId !== 'string'
        || !equippedWeaponChoices(ctx.character, state.equipment, eligibleTypes)
          .some((weapon) => weapon.id === weaponId)) {
        throw mechanicsError('INVALID_CHOICE', `${path}.weapon_choice_id`, 'selected weapon is not eligible');
      }
      if (damageType !== 'weapon' && damageType !== 'force') {
        throw mechanicsError('INVALID_CHOICE', `${path}.damage_type_choice_id`, 'damage type must be weapon or force');
      }
      const ability = ctx.spell?.spellcastingAbility ?? ctx.character.spellcastingAbility;
      if (!ability || !ABILITY_KEYS.has(ability)) {
        throw mechanicsError('INVALID_MECHANICS', path, 'weapon enchantment requires an explicit spellcasting ability');
      }
      if (!Array.isArray(value.damage_scaling) || value.damage_scaling.length === 0
        || value.damage_scaling.some((entry) => !isDict(entry)
          || !Number.isInteger(entry.min_level) || Number(entry.min_level) < 1
          || typeof entry.dice !== 'string' || !entry.dice.trim())) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.damage_scaling`, 'weapon enchantment requires valid level scaling');
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'weapon enchantment requires duration');
      }
      break;
    }
    case 'remote_manipulator': {
      for (const key of ['max_distance_ft', 'move_per_action_ft', 'max_load_lb'] as const) {
        const amount = Number(value[key]);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw mechanicsError('INVALID_PAYLOAD', `${path}.${key}`, `${key} must be positive`);
        }
      }
      if (!Array.isArray(value.allowed_operations) || value.allowed_operations.length === 0
        || value.allowed_operations.some((operation) => typeof operation !== 'string' || !operation.trim())) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.allowed_operations`, 'remote manipulator requires operations');
      }
      if (!Array.isArray(value.forbidden_operations) || value.forbidden_operations.length === 0) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.forbidden_operations`, 'remote manipulator requires explicit limits');
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'remote manipulator requires duration');
      }
      break;
    }
    case 'communication_link': {
      const range = Number(value.range_ft);
      if (!Number.isFinite(range) || range <= 0 || value.private !== true) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'communication link requires positive range and private delivery');
      }
      if (!isDict(value.blockers) || !isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'communication link requires blockers and duration');
      }
      break;
    }
    case 'world_interaction': {
      if (typeof value.operation !== 'string' || !value.operation.trim()
        || !isDict(value.parameters)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'world interaction requires operation and parameters');
      }
      break;
    }
    case 'illusion': {
      if (typeof value.form !== 'string' || !value.form.trim()
        || !isDict(value.duration)
        || typeof value.physical_interaction_reveals !== 'boolean') {
        throw mechanicsError(
          'INVALID_PAYLOAD', path,
          'illusion requires form, duration, and an explicit physical-interaction policy',
        );
      }
      if (value.investigation_dc !== undefined) {
        explicitPositiveDc(value.investigation_dc, `${path}.investigation_dc`, ctx);
      }
      if (value.control !== undefined) {
        const control = isDict(value.control) ? value.control : null;
        if (!control || !['action', 'bonus_action'].includes(String(control.resource ?? ''))
          || !Number.isFinite(control.range_ft) || Number(control.range_ft) <= 0
          || !Array.isArray(control.operations) || control.operations.length === 0
          || control.operations.some((operation) => typeof operation !== 'string' || !operation.trim())) {
          throw mechanicsError('INVALID_PAYLOAD', `${path}.control`, 'illusion control policy is invalid');
        }
      }
      break;
    }
    case 'temporary_consumable': {
      if (typeof value.id !== 'string' || !value.id.trim()
        || !Number.isSafeInteger(value.count) || Number(value.count) <= 0
        || !['action', 'bonus_action'].includes(String(value.consume_resource ?? ''))
        || !isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'temporary consumable policy is invalid');
      }
      if (value.healing !== undefined
        && (!Number.isFinite(value.healing) || Number(value.healing) < 0)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.healing`, 'temporary consumable healing must be non-negative');
      }
      break;
    }
    case 'world_entity': {
      if (typeof value.entity_type !== 'string' || !value.entity_type.trim()
        || !isDict(value.duration) || !isDict(value.constraints)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'world entity requires type, constraints, and duration');
      }
      const command = value.command;
      if (command !== undefined) {
        if (!isDict(command) || !['action', 'bonus_action'].includes(String(command.resource ?? ''))
          || !Array.isArray(command.operations) || command.operations.length === 0
          || command.operations.some((operation) => typeof operation !== 'string' || !operation.trim())) {
          throw mechanicsError('INVALID_PAYLOAD', `${path}.command`, 'world entity command policy is invalid');
        }
      }
      break;
    }
    case 'information_access': {
      if (typeof value.capability !== 'string' || !value.capability.trim()
        || !isDict(value.policy) || !isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'information access requires capability, policy, and duration');
      }
      break;
    }
    case 'information_reveal': {
      if (typeof value.reveal !== 'string' || !value.reveal.trim()
        || !Array.isArray(value.fields) || value.fields.length === 0
        || value.fields.some((field) => typeof field !== 'string' || !field.trim())) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'information reveal requires a reveal id and fields');
      }
      break;
    }
    case 'world_zone': {
      if (typeof value.zone_type !== 'string' || !value.zone_type.trim()
        || !isDict(value.geometry) || !isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'world zone requires type, geometry, and duration');
      }
      const geometry = value.geometry as Dict;
      if (!['cube', 'sphere'].includes(String(geometry.shape ?? ''))
        || !Number.isFinite(geometry.size_ft) || Number(geometry.size_ft) <= 0) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.geometry`, 'world zone geometry is invalid');
      }
      break;
    }
    case 'triggered_effect': {
      const event = typeof value.event === 'string' ? value.event : '';
      if (!EMITTED_EVENTS.includes(event as (typeof EMITTED_EVENTS)[number])) {
        throw mechanicsError(
          'INVALID_PAYLOAD',
          `${path}.event`,
          `triggered_effect requires an emitted engine event, received «${event || '?'}»`,
        );
      }
      if (!Array.isArray(value.effects) || value.effects.length === 0) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.effects`, 'triggered_effect requires effects');
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'triggered_effect requires duration');
      }
      const bindings = value.formula_bindings;
      const variables: Record<string, number | { sides: number; count: number }> = {
        ...(ctx.character.variables ?? {}),
      };
      if (bindings !== undefined) {
        if (!isDict(bindings) || Object.keys(bindings).length === 0) {
          throw mechanicsError(
            'INVALID_PAYLOAD', `${path}.formula_bindings`, 'formula_bindings must be a non-empty object',
          );
        }
        for (const [key, expression] of Object.entries(bindings)) {
          if (!/^[a-z][a-z0-9_]*$/u.test(key)) {
            throw mechanicsError(
              'INVALID_PAYLOAD', `${path}.formula_bindings.${key}`, 'binding id must be a stable lowercase slug',
            );
          }
          variables[key] = assertDeterministicFiniteFormula(
            expression,
            `${path}.formula_bindings.${key}`,
            ctx,
          );
        }
      }
      const nestedContext: ExecuteContext = {
        ...ctx,
        character: { ...ctx.character, variables },
      };
      if (value.circumstances !== undefined && !Array.isArray(value.circumstances)) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.circumstances`, 'triggered_effect circumstances must be an array',
        );
      }
      if (value.uses !== undefined && !isDict(value.uses)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.uses`, 'triggered_effect uses must be an object');
      }
      value.effects.forEach((effect, index) => preflightEffect(
        effect,
        `${path}.effects[${index}]`,
        state,
        nestedContext,
        depth + 1,
      ));
      break;
    }
    case 'fall_protection': {
      const descent = Number(value.descent_per_round_ft);
      if (!Number.isFinite(descent) || descent <= 0) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.descent_per_round_ft`, 'fall protection requires a positive descent rate',
        );
      }
      if (value.prevents_fall_damage !== true || value.ends_on_landing !== true) {
        throw mechanicsError(
          'INVALID_PAYLOAD', path, 'fall protection must explicitly prevent damage and end on landing',
        );
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'fall protection requires duration');
      }
      break;
    }
    case 'movement_option': {
      if (typeof value.id !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(value.id)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.id`, 'movement option requires a stable slug id');
      }
      for (const key of ['distance_ft', 'movement_cost_ft'] as const) {
        const amount = Number(value[key]);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw mechanicsError('INVALID_PAYLOAD', `${path}.${key}`, `${key} must be positive`);
        }
      }
      if (!isDict(value.duration)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.duration`, 'movement option requires duration');
      }
      const uses = value.uses;
      if (!isDict(uses) || Number(uses.count) !== 1 || uses.per !== 'turn') {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.uses`, 'movement option currently requires exactly one use per turn',
        );
      }
      break;
    }
    case 'healing':
    case 'reduce_damage':
    case 'temp_hp': {
      if (kind === 'healing' && value.hit_die === 'target') {
        const targetHitDie = ctx.target?.characterContext?.hitDie;
        if (!hitDieSides(targetHitDie)) {
          throw mechanicsError('INVALID_MECHANICS', `${path}.hit_die`, 'target healing requires a declared target Hit Die');
        }
      } else {
        if (value.amount == null) throw mechanicsError('INVALID_PAYLOAD', path, `${kind} requires amount`);
        assertFiniteFormula(withScaling(String(value.amount), value, ctx), `${path}.amount`, ctx);
      }
      break;
    }
    case 'condition': {
      if (typeof value.value !== 'string' || !value.value.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.value`, 'condition id must be non-empty');
      }
      const op = String(value.op ?? 'apply');
      if (op !== 'apply' && op !== 'remove') {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.op`, `unsupported condition operation «${op}»`);
      }
      if (value.required_end_trigger !== undefined
        && (typeof value.required_end_trigger !== 'string' || !value.required_end_trigger.trim())) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.required_end_trigger`,
          'condition removal end trigger must be a non-empty string',
        );
      }
      if (value.required_cause_tags !== undefined
        && (!Array.isArray(value.required_cause_tags)
          || value.required_cause_tags.some((tag) => typeof tag !== 'string' || !tag.trim()))) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.required_cause_tags`,
          'condition removal cause tags must be non-empty strings',
        );
      }
      break;
    }
    case 'resource': {
      const id = value.id ?? value.resource;
      if (typeof id !== 'string' || !id.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'resource id must be non-empty');
      }
      const op = String(value.op ?? 'grant');
      if (op !== 'grant' && op !== 'restore' && op !== 'grant_capped') {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.op`, `executor does not support resource operation «${op}»`);
      }
      if (value.amount !== undefined) assertFiniteFormula(value.amount, `${path}.amount`, ctx, targetOwned);
      break;
    }
    case 'modifier':
      preflightModifier(value, path, state, ctx, targetOwned, depth, hand);
      break;
    case 'attack_follow_up': {
      if (typeof value.follow_up !== 'string' || !value.follow_up.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'attack_follow_up requires a typed follow_up');
      }
      break;
    }
    case 'grant_sense': {
      if (typeof value.sense !== 'string' || !value.sense.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.sense`, 'sense must be non-empty');
      }
      const range = Number(value.range);
      if (!Number.isFinite(range) || range <= 0) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.range`, 'sense range must be positive');
      }
      break;
    }
    case 'resistance': {
      if (typeof value.damage_type !== 'string' || !value.damage_type.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.damage_type`, 'damage type must be non-empty');
      }
      if (!RESISTANCE_LEVELS.has(String(value.value ?? ''))) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.value`, 'invalid damage adjustment level');
      }
      break;
    }
    case 'set_value': {
      const target = typeof value.target === 'string' ? value.target : '';
      const knownTarget = ['hp', 'current_hp', 'temp_hp', 'max_hp', 'hp_max', 'ac_base'].includes(target)
        || target in state.resources || target in state.maxResources;
      if (!knownTarget) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.target`, `unknown runtime target «${target || '?'}»`);
      }
      assertFiniteFormula(value.formula ?? value.value, `${path}.${value.formula === undefined ? 'value' : 'formula'}`, ctx, targetOwned);
      break;
    }
    case 'grant_effect': {
      for (const slug of grantEffectSlugs(value, path)) {
        const granted = ctx.grantedEffects?.[slug];
        if (!granted || !isDict(granted.mechanics)) {
          throw mechanicsError(
            'UNRESOLVED_GRANT_EFFECT',
            path,
            `effect reference «${slug}» is not present in ExecuteContext.grantedEffects`,
          );
        }
      }
      break;
    }
    case 'choice':
      preflightChoice(value, path, state, ctx, targetOwned, depth, hand);
      break;
    case 'add_item': {
      const cardId = value.card_id ?? value.value;
      if (typeof cardId !== 'string' || !cardId.trim()) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'add_item requires card_id or value');
      }
      const qty = Number(value.qty ?? value.amount ?? 1);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw mechanicsError('INVALID_PAYLOAD', path, 'add_item quantity must be positive');
      }
      break;
    }
    case 'movement': {
      const mode = String(value.value ?? 'move');
      if (!MOVEMENT_MODES.has(mode)) {
        throw mechanicsError('INVALID_PAYLOAD', `${path}.value`, `unsupported movement mode «${mode}»`);
      }
      if (value.distance !== undefined) assertFiniteFormula(value.distance, `${path}.distance`, ctx, targetOwned);
      break;
    }
    // These primitives either persist a typed effect or emit an explicit
    // narrative/event and intentionally do not require numeric fields.
    case 'boon':
    case 'reroll':
    case 'transform':
    case 'narrative':
      break;
    default:
      break;
  }
}

function preflightEffect(
  value: unknown,
  path: string,
  state: RuntimeState,
  ctx: ExecuteContext,
  depth = 0,
): void {
  if (!isDict(value)) throw mechanicsError('INVALID_PAYLOAD', path, 'effect must be an object');
  const hand = resolveHand(value);
  if (value.kind !== undefined) {
    if (value.kind !== 'choice') {
      throw mechanicsError(
        'UNKNOWN_PAYLOAD',
        `${path}.kind`,
        `payload kind «${String(value.kind)}» cannot be used at the interaction layer`,
      );
    }
    preflightPayload(value, path, state, ctx, String(value.who ?? 'self') === 'target', depth, hand);
    return;
  }
  const resolution = typeof value.resolution === 'string' ? value.resolution : '';
  if (!EXECUTABLE_RESOLUTIONS.has(resolution)) {
    throw mechanicsError('UNKNOWN_RESOLUTION', `${path}.resolution`, `executor does not own resolution «${resolution || '?'}»`);
  }
  const targetOwned = String(value.who ?? (resolution === 'auto' ? 'self' : 'target')) === 'target';
  const outcomes = resolution === 'auto'
    ? ['result', 'results']
    : resolution === 'attack_roll'
      ? ['on_hit', 'on_crit', 'on_miss']
      : resolution === 'save'
        ? ['on_fail', 'on_success']
        : ['on_success'];
  if (resolution === 'auto' && value.result === undefined && value.results === undefined) {
    throw mechanicsError('INVALID_PAYLOAD', path, 'auto resolution requires result or results');
  }
  for (const key of outcomes) {
    if (value[key] !== undefined) {
      assertPayloadArray(value[key], `${path}.${key}`, state, ctx, targetOwned, depth, hand);
    }
  }
  if (resolution === 'attack_roll') {
    const ability = explicitAbility(
      value.ability,
      `${path}.ability`,
      ATTACK_ABILITIES,
      'attack resolution',
    );
    explicitTargetArmorClass(ctx);
    explicitCharacterProficiencyBonus(ctx);
    if (ability === 'spellcasting'
      && (typeof ctx.character.spellcastingMod !== 'number'
        || !Number.isFinite(ctx.character.spellcastingMod))) {
      throw mechanicsError(
        'INVALID_MECHANICS',
        'context.character.spellcastingMod',
        'spell attack requires an explicit finite spellcasting modifier',
      );
    }
    if (ability === 'auto') {
      const weapon = weaponContext(ctx.character, resolveHand(value), state.equipment, state);
      if (!weapon) {
        throw mechanicsError(
          'INVALID_MECHANICS',
          'context.character.equipment',
          'automatic attack ability requires an explicit equipped weapon',
        );
      }
      explicitCharacterAbilityModifier(ctx, weapon.ability);
    } else if (ability !== 'spellcasting') {
      explicitCharacterAbilityModifier(ctx, ability as AbilityKey);
    }
  } else if (resolution === 'save') {
    const ability = explicitAbility(
      value.ability,
      `${path}.ability`,
      ABILITY_KEYS,
      'save resolution',
    ) as AbilityKey;
    explicitPositiveDc(value.dc, `${path}.dc`, ctx);
    if (value.automatic_success !== undefined) {
      if (!isDict(value.automatic_success)) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.automatic_success`,
          'automatic save success declaration must be an object',
        );
      }
      const declaration = value.automatic_success as Dict;
      const noSleep = declaration.if_sleep_not_required === true;
      const immunity = declaration.if_condition_immunity;
      if (!noSleep && (typeof immunity !== 'string' || !immunity.trim())) {
        throw mechanicsError(
          'INVALID_PAYLOAD', `${path}.automatic_success`,
          'automatic save success requires a no-sleep or condition-immunity rule',
        );
      }
    }
    const hasDeferredTargetAuthority = ctx.deferTargetSaves === true
      && targetOwned
      && ctx.target?.runtimeState !== undefined
      && ctx.deferredSaveSource !== undefined;
    if (ctx.forceSaveOutcome == null
      && !hasDeferredTargetAuthority
      && !automaticSaveSuccessReason(value, ctx.target)) {
      explicitTargetSaveModifier(ctx, ability);
    }
  } else if (resolution === 'ability_check') {
    const ability = explicitAbility(
      value.ability,
      `${path}.ability`,
      ABILITY_KEYS,
      'ability-check resolution',
    ) as AbilityKey;
    explicitCharacterAbilityModifier(ctx, ability);
    explicitCharacterProficiencyBonus(ctx);
    const hasDc = value.dc !== undefined;
    const hasContest = value.contest_vs !== undefined;
    if (hasDc === hasContest) {
      throw mechanicsError(
        'INVALID_PAYLOAD',
        path,
        'ability check requires exactly one explicit dc or contest_vs declaration',
      );
    }
    if (value.mode !== undefined
      && value.mode !== (hasDc ? 'dc' : 'contest')) {
      throw mechanicsError(
        'INVALID_PAYLOAD',
        `${path}.mode`,
        'ability-check mode contradicts its explicit dc or contest_vs declaration',
      );
    }
    if (hasDc) {
      explicitPositiveDc(value.dc, `${path}.dc`, ctx);
    } else {
      explicitContestSkills(value, path, ctx);
    }
  }
}

/**
 * Validate precisely the mechanics graph that the synchronous executor owns.
 * This runs before `canPay`/`pay`, consumes no caller RNG, resolves selected
 * runtime choices, and rejects canonical/build primitives instead of silently
 * degrading them into a paid no-op.
 */
export function preflightMechanicsExecution(
  state: RuntimeState,
  mechanics: Dict,
  ctx: ExecuteContext,
): Dict[] {
  if (!isDict(mechanics)) {
    throw mechanicsError('INVALID_MECHANICS', 'mechanics', 'mechanics must be an object');
  }
  // This executor never dispatches a world primitive. Canonical rules-core may
  // call back with the same immutable mechanics only after its own validated
  // world mutation, using an explicit one-way authority hand-off. Every direct
  // browser/legacy caller therefore fails before resource checks/payment.
  if (Object.prototype.hasOwnProperty.call(mechanics, 'primitive')
    && ctx.externalPrimitiveHandled !== true) {
    const primitive = isDict(mechanics.primitive) ? String(mechanics.primitive.type ?? '?') : '?';
    throw mechanicsError(
      'CANONICAL_PRIMITIVE_REQUIRED',
      'mechanics.primitive',
      `primitive «${primitive}» requires a canonical rules-core hand-off`,
    );
  }
  if (mechanics.interactions !== undefined && mechanics.effects === undefined) {
    throw mechanicsError(
      'INVALID_MECHANICS',
      'mechanics.interactions',
      'legacy executor accepts the effects container only',
    );
  }
  const cost = preflightActivationCost(mechanics, ctx);
  if (mechanics.effects === undefined) {
    if (mechanics.kind !== undefined) {
      throw mechanicsError('INVALID_MECHANICS', 'mechanics.kind', 'a payload cannot be executed as an action');
    }
    return cost;
  }
  if (!Array.isArray(mechanics.effects)) {
    throw mechanicsError('INVALID_MECHANICS', 'mechanics.effects', 'effects must be an array');
  }
  mechanics.effects.forEach((effect, index) => preflightEffect(
    effect,
    `mechanics.effects[${index}]`,
    state,
    ctx,
  ));
  return cost;
}

function evalCtxOf(state: RuntimeState, ctx: ExecuteContext): EvalContext {
  return {
    character: ctx.character,
    state,
    target: ctx.target,
    activeConditions: activeConditionsOf(state),
    // C10: состояния ЦЕЛИ — чтобы предикат target_has_condition («преимущество, пока цель
    // распластана/опутана») гейтился данными, а не молча давал false. Пустое множество, если цели нет.
    targetConditions: activeConditionsOf(ctx.target?.runtimeState),
    rollerActorId: ctx.selfId,
    rollTargetActorId: ctx.target?.id,
    rollerCreatureType: ctx.character.creatureType,
    conditionSourceFacts: ctx.conditionSourceFacts,
    distancesFt: ctx.conditionRelationFacts?.distancesFt,
    visibility: ctx.conditionRelationFacts?.visibility,
  };
}

// ─── Фаза E: двусторонний контекст ──────────────────────────────────────────

/**
 * Модификаторы, проецируемые ЦЕЛЬЮ на бросок атакующего (фаза E). Читаются обобщённо из
 * активных эффектов цели по данным scope:'target' — и из состояний (по данным состояния),
 * и из любого эффекта с scope:'target'-модификатором. Никакого хардкода проекции.
 */
export function projectedAgainst(
  target: ExecuteContext['target'],
  roll: string,
  attackRange?: 'melee' | 'ranged',
  evalCtx?: EvalContext,
  queryFilter?: ModifierQueryFacts,
): { modifiers: RollModifier[]; rules: Dict[]; advantage: AdvantageState; hasAdvantage: boolean; hasDisadvantage: boolean; autoCrit: boolean } {
  const out = {
    modifiers: [] as RollModifier[],
    rules: [] as Dict[],
    advantage: 'none' as AdvantageState,
    hasAdvantage: false,
    hasDisadvantage: false,
    autoCrit: false,
  };
  const st = target?.runtimeState;
  if (!st) return out;

  // C14-родственник: значение проецируемого модификатора вычисляем formula-aware в контексте
  // ЦЕЛИ (её характеристики/переменные), а не голым Number() — иначе формульные моды теряются.
  const tctx = targetFormulaCtx(target);
  const consider = (m: Dict, source: string, conditionSourceId?: string): void => {
    if (String(m.scope ?? 'self') !== 'target') return;
    const applies = m.applies_to as Dict | undefined;
    if (!applies || applies.roll !== roll) return;
    const effectFilter = applies.filter as Dict | undefined;
    if (effectFilter && Object.entries(effectFilter).some(([key, value]) => queryFilter?.[key] !== value)) return;
    if (!matchesWhen(m.when as Dict[] | undefined, {
      ...(evalCtx ?? {}),
      conditionSourceId,
      conditionOwnerId: target?.id,
    })) return;
    // Дистанционный гейт (B/C): модификатор с range применяется только к атаке того же типа.
    // Закрыт по умолчанию — если тип атаки неизвестен, range-гейтованный модификатор не применяется
    // (не ставим ложный автокрит / преимущество распластанному от неизвестной атаки).
    const range = m.range as 'melee' | 'ranged' | undefined;
    if (range === 'melee' || range === 'ranged') { if (attackRange !== range) return; }
    const op = String(m.op ?? '');
    if (op === 'auto_crit') {
      out.autoCrit = true;
    } else if (op === 'bonus_die') {
      out.rules.push(m);
    } else if (op === 'advantage' || op === 'disadvantage') {
      if (op === 'advantage') out.hasAdvantage = true; else out.hasDisadvantage = true;
      out.advantage = foldAdvantage(out.hasAdvantage, out.hasDisadvantage);
    } else if (op === 'add' && m.value != null) {
      const raw = String(m.value).replace(/^\+/, '');
      let v: number | undefined;
      try { const r = evaluate(raw, tctx ?? {}); v = typeof r === 'number' ? r : undefined; }
      catch { v = undefined; }
      if (v != null && !Number.isNaN(v) && v !== 0) out.modifiers.push({ value: v, source });
    }
  };

  for (const e of st.activeEffects) {
    const mech = e.mechanics as Dict;
    if (mech?.kind === 'condition' && mech.value) {
      for (const rule of conditionModifierPayloads(String(mech.value))) {
        consider(rule as unknown as Dict, String(mech.value), e.sourceId);
      }
    } else {
      for (const p of payloadsOf(mech)) if (p.kind === 'modifier') consider(p, e.name, e.sourceId);
    }
  }
  return out;
}

interface DamageAdjustmentRule {
  level: string | null;
  sourceEntityIds: string[];
}

/** Уровень и стабильный источник сопротивления (активные эффекты + пассивки). */
function resistanceRuleFor(
  state: RuntimeState,
  ctx: ExecuteContext,
  damageType: string,
): DamageAdjustmentRule {
  const rank = (l: string | null) => (l === 'immunity' ? 3 : l === 'resistance' ? 2 : l === 'vulnerability' ? 1 : 0);
  const scan = (mech: Dict | undefined): string | null => {
    const payloads = mech?.kind === 'condition' && mech.value
      ? conditionRuntimePayloads(String(mech.value))
      : payloadsOf(mech);
    for (const p of payloads) {
      const declaredType = String(p.damage_type ?? '');
      if (p.kind === 'resistance' && (declaredType === damageType || declaredType === 'all')) {
        return String(p.value ?? '');
      }
    }
    return null;
  };
  const stableSources = (owner: Dict, fallback: string[]): string[] => {
    const declared = Array.isArray(owner.sourceEntityIds)
      ? owner.sourceEntityIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [];
    return [...new Set(declared.length ? declared : fallback)].sort();
  };
  let result: DamageAdjustmentRule = { level: null, sourceEntityIds: [] };
  for (const effect of state.activeEffects) {
    const level = scan(effect.mechanics as Dict);
    if (rank(level) > rank(result.level)) {
      result = { level, sourceEntityIds: stableSources(effect.mechanics as Dict, [effect.id]) };
    }
  }
  for (const passive of passivesFromCtx(ctx)) {
    const level = scan(passive);
    if (rank(level) > rank(result.level)) {
      result = { level, sourceEntityIds: stableSources(passive, []) };
    }
  }
  return result;
}

/** Применить уровень сопротивления к количеству урона. */
function applyResistance(amount: number, level: string | null): number {
  if (level === 'immunity') return 0;
  if (level === 'resistance') return Math.floor(amount / 2);
  if (level === 'vulnerability') return amount * 2;
  return amount;
}

/** Модификатор спасброска цели: динамически из её характеристик (фаза E) или из saveMods. */
function targetSaveMod(target: ExecuteContext['target'], ability: AbilityKey): number {
  const cc = target?.characterContext;
  if (cc) {
    const base = cc.abilityMods[ability];
    const prof = cc.saveProficiencies?.includes(ability) ? cc.profBonus : 0;
    return base + prof;
  }
  return target!.saveMods![ability]!;
}

function evalDc(formula: string, ctx: ExecuteContext): number {
  const normalized = formula.replace(/\s+/g, '');
  const v = evaluate(normalized, formulaCtx(ctx));
  if (typeof v !== 'number') throw new FormulaError(`DC формула «${formula}» не число`);
  const spellClass = ctx.spell?.sourceClass;
  const state = ctx.selfRuntime;
  if (!spellClass || !state) return v;
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'spell_save_dc',
    filter: { spellClass },
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  return foldModifiers(v, collected).value;
}

function expiryFromDuration(duration: Dict | undefined): string | undefined {
  const t = duration?.type;
  if (t === 'until_start_of_next_turn') return 'start_of_next_turn';
  if (t === 'until_end_of_turn') return 'end_of_turn';
  if (t === 'until_long_rest') return 'long_rest';
  return undefined;
}

/**
 * C6: единый резолвер длительности «стоячего» эффекта → { roundsLeft, expiry }. Общий для
 * condition / modifier / resistance (раньше логика дублировалась, а у modifier её вовсе не было —
 * бафф «+2 на 3 раунда» висел вечно). duration.rounds → roundsLeft (тикает на начале хода в
 * expireStartOfTurnEffects); until_start/end_of_turn → expiry-метка; без длительности → 'manual'
 * (снимается вручную/до отдыха, как чип Ярости).
 */
function resolveDuration(duration: Dict | undefined): { roundsLeft?: number; expiry?: string } {
  if (duration?.type === 'rounds' || duration?.type === 'minutes' || duration?.type === 'hours') {
    // Целое число раундов → тикающий эффект. Невалидный amount (0/отрицательное/дробное/NaN, а
    // также формульное '1d4' — Number()→NaN) НЕ делаем вечным: даём 1 раунд (истечёт на следующем
    // ходу), иначе временный эффект тихо стал бы постоянным. Формульные длительности через evaluate —
    // отдельная фича (нужен ctx/rng здесь), пока усекаются до 1 раунда.
    const raw = Math.floor(Number(duration.amount));
    const multiplier = duration.type === 'minutes' ? 10 : duration.type === 'hours' ? 600 : 1;
    const rounds = raw * multiplier;
    return { roundsLeft: Number.isFinite(rounds) && rounds > 0 ? rounds : 1 };
  }
  // Нет длительности / until_*-метка: expiry ('start_of_next_turn'|'end_of_turn') либо 'manual'
  // (стоячий до ручного снятия/отдыха — Ярость и т.п.).
  return { expiry: expiryFromDuration(duration) ?? 'manual' };
}

function sourceTurnMetadata(
  duration: Dict | undefined,
  ctx: ExecuteContext,
  ownerActorId: string | undefined,
): Pick<ActiveEffectEntry, 'expiry' | 'ownerId' | 'sourceId' | 'sourceTurnExpiry'> | undefined {
  const type = String(duration?.type ?? '');
  const boundary = type === 'until_start_of_source_next_turn'
    ? 'start' as const
    : type === 'until_end_of_source_next_turn'
      ? 'end' as const
      : null;
  if (!boundary || !ctx.selfId || !ownerActorId) return undefined;
  return {
    expiry: 'source_turn',
    ownerId: ownerActorId,
    sourceId: ctx.selfId,
    sourceTurnExpiry: {
      sourceActorId: ctx.selfId,
      ownerActorId,
      boundary,
    },
  };
}

/**
 * Скейлинг формулы урона/лечения (E5):
 * - per: 'spell_slot_above' — апкаст: +dice за каждый уровень слота выше базового;
 * - per: 'character_level' | 'cantrip' — рост заговора на уровнях персонажа 5/11/17.
 */
function withScaling(base: string, payload: Dict, ctx: ExecuteContext): string {
  const scaling = payload.scaling as Dict | undefined;
  const dice = scaling?.dice;
  if (!scaling || typeof dice !== 'string' || !dice) return base;

  const per = String(scaling.per ?? '');
  let steps = 0;
  if (per === 'spell_slot_above') {
    const baseLevel = ctx.spell?.baseLevel ?? 0;
    const castLevel = ctx.spell?.castLevel ?? baseLevel;
    steps = Math.max(0, castLevel - baseLevel);
  } else if (per === 'character_level' || per === 'cantrip') {
    const lvl = ctx.character.level;
    steps = (lvl >= 5 ? 1 : 0) + (lvl >= 11 ? 1 : 0) + (lvl >= 17 ? 1 : 0);
  }
  if (steps <= 0) return base;
  return `${base}${` + ${dice}`.repeat(steps)}`;
}

function resolveHand(effect: Dict): 'main' | 'off' {
  const tags = effect.tags as string[] | undefined;
  return tags?.includes('off_hand') ? 'off' : 'main';
}

function attackAbilityMods(effect: Dict, ctx: ExecuteContext, hand: 'main' | 'off', state: RuntimeState): RollModifier[] {
  const mods: RollModifier[] = [];
  const ability = String(effect.ability);
  const attackKind = attackRollQueryFacts(effect, hand, ctx.character, state.equipment).attackKind;
  const currentWeapon = attackKind === 'weapon'
    ? weaponContext(ctx.character, hand, state.equipment, state)
    : null;
  const proficiencyBonus = attackKind !== 'weapon'
    || (currentWeapon !== null
      && isWeaponProficient(
        ctx.character,
        currentWeapon.weaponType,
        currentWeapon.proficiencyCategory,
      ))
    ? ctx.character.profBonus
    : 0;

  if (ability === 'spellcasting') {
    mods.push({ value: ctx.character.spellcastingMod!, source: 'заклин.', reason: 'модификатор заклинаний' });
    if (proficiencyBonus) {
      mods.push({ value: proficiencyBonus, source: 'БМ', reason: 'бонус мастерства' });
    }
  } else if (ability === 'auto') {
    const w = currentWeapon ?? weaponContext(ctx.character, hand, state.equipment, state);
    if (w) {
      mods.push({
        value: ctx.character.abilityMods[w.ability],
        source: ABILITY_LABEL[w.ability],
        reason: 'модификатор характеристики',
      });
      if (w.attackEnchant) {
        mods.push({ value: w.attackEnchant, source: `+${w.attackEnchant}`, reason: 'зачарование оружия' });
      }
    }
    if (proficiencyBonus) {
      mods.push({ value: proficiencyBonus, source: 'БМ', reason: 'бонус мастерства' });
    }
  } else {
    const key = ability as AbilityKey;
    mods.push({
      value: ctx.character.abilityMods[key],
      source: ABILITY_LABEL[key] ?? ability,
      reason: 'модификатор характеристики',
    });
    if (proficiencyBonus) {
      mods.push({ value: proficiencyBonus, source: 'БМ', reason: 'бонус мастерства' });
    }
  }
  return mods;
}

/**
 * Ключ стека (фаза D, модель StackId из BG3): явный stack_id, а для состояний —
 * неявный `cond:<value>` (состояние бинарно — оно либо есть, либо нет).
 */
function stackKeyOf(mech: Dict | undefined): string | undefined {
  if (!mech) return undefined;
  if (mech.stack_id != null) return String(mech.stack_id);
  if (mech.kind === 'condition' && mech.value != null) return `cond:${String(mech.value)}`;
  if (mech.kind === 'boon' && mech.id != null) return `boon:${String(mech.id)}`;
  return undefined;
}

/**
 * Добавить активный эффект с учётом стекинга (RAW 2024 «Combining Game Effects»):
 * - нет ключа стека → просто добавить (текущее поведение, обратная совместимость);
 * - overwrite (дефолт при ключе): потентнейший (stack_priority) остаётся, при равенстве —
 *   новый (свежесть); одноимённое не удваивается;
 * - ignore → если такой уже есть, новый не добавляется;
 * - additive → длительности складываются;
 * - stack → независимые экземпляры.
 */
function stackApply(state: RuntimeState, entry: ActiveEffectEntry, payload: Dict): RuntimeState {
  const stackId = stackKeyOf(payload);
  const add = (): RuntimeState => ({ ...state, activeEffects: [...state.activeEffects, entry] });
  if (!stackId) return add();

  const stackType = String(payload.stack_type ?? 'overwrite');
  const same = state.activeEffects.filter((e) => stackKeyOf(e.mechanics as Dict) === stackId);
  const others = state.activeEffects.filter((e) => stackKeyOf(e.mechanics as Dict) !== stackId);

  if (stackType === 'stack') return add();
  if (stackType === 'ignore') return same.length ? state : add();
  if (stackType === 'additive') {
    if (!same.length) return add();
    const merged = same.map((e) => ({
      ...e,
      roundsLeft: ((e.roundsLeft ?? 0) + (entry.roundsLeft ?? 0)) || undefined,
    }));
    return { ...state, activeEffects: [...others, ...merged] };
  }
  // overwrite: потентнейший (priority) остаётся; равенство → новый (recency).
  const priority = Number(payload.stack_priority ?? 0);
  const maxPrio = same.reduce((m, e) => Math.max(m, Number((e.mechanics as Dict).stack_priority ?? 0)), -Infinity);
  if (same.length && priority < maxPrio) return state;
  return { ...state, activeEffects: [...others, entry] };
}

function runtimeEffectId(ctx: ExecuteContext, prefix: string, ordinal: number): string {
  return ctx.nextId?.() ?? `${prefix}-${ordinal}-${Date.now()}`;
}

function modifierApplicationLabel(source: string, payload: Dict): string {
  const appliesTo = payload.applies_to as Dict | undefined;
  const roll = String(appliesTo?.roll ?? '');
  const labels: Record<string, string> = {
    ac: 'КД',
    size: 'размер',
    speed: 'скорость',
    attack: 'атака',
    damage: 'урон',
    saving_throw: 'спасбросок',
    ability_check: 'проверка',
  };
  return labels[roll] ? `${source} · ${labels[roll]}` : source;
}

function applyModifierPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const duration = payload.duration as Dict | undefined;
  const relative = sourceTurnMetadata(duration, ctx, ownerActorId);
  const resolved = relative ? { expiry: relative.expiry } : resolveDuration(duration);
  const { roundsLeft, expiry } = resolved;
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'fx', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft, // C6: раньше не выставлялся — модификатор с duration.rounds не истекал
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
    ...(relative ?? {}),
  };
  events.push({
    type: 'effect_applied',
    name: modifierApplicationLabel(source, payload),
    sourceAction: source,
  });
  return stackApply(state, entry, payload);
}

/** Persist one generic on-hit damage rider. Unlike an ordinary modifier it
 * always records actor ownership: target marks must never benefit a different
 * attacker merely because that attacker hits the same creature. */
function applyDamageRiderPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'rider', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/** Persist a generic condition immunity granted by an action or spell. */
function applyConditionImmunityPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'immunity', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

function resolveTriggeredFormulaBindings(
  payload: Dict,
  ctx: ExecuteContext,
): Record<string, number> {
  if (!isDict(payload.formula_bindings)) return {};
  return Object.fromEntries(Object.entries(payload.formula_bindings).map(([key, expression]) => {
    const value = evaluate(expression as string | number, {
      ...formulaCtx(ctx),
      rng: () => { throw new FormulaError('triggered_effect formula bindings cannot roll dice'); },
    });
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new FormulaError(`triggered_effect binding «${key}» must resolve to a finite number`);
    }
    return [key, value];
  }));
}

/** Convert a payload declaration into the ordinary triggered-listener shape
 * already consumed by the event bus. Formula bindings are frozen at apply
 * time, so an effect on another actor retains the caster-owned value. */
function applyTriggeredEffectPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const formulaVariables = resolveTriggeredFormulaBindings(payload, ctx);
  const mechanics: Dict = {
    activation: {
      mode: 'triggered',
      trigger: {
        event: payload.event,
        ...(Array.isArray(payload.circumstances) ? { circumstances: payload.circumstances } : {}),
      },
    },
    effects: payload.effects,
    duration: payload.duration,
    ...(isDict(payload.uses) ? { uses: payload.uses } : {}),
    ...(Object.keys(formulaVariables).length ? { formula_variables: formulaVariables } : {}),
    ...(Array.isArray(payload.end_triggers) ? { end_triggers: payload.end_triggers } : {}),
    ...(payload.stack_id !== undefined ? { stack_id: payload.stack_id } : {}),
    ...(payload.stack_type !== undefined ? { stack_type: payload.stack_type } : {}),
  };
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'trigger', state.activeEffects.length),
    name: source,
    mechanics,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, mechanics);
}

/** Persist a rules-owned adapter for falling or a special movement mode. */
function applyTraversalPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const suffix = payload.kind === 'movement_option' ? String(payload.id) : 'fall';
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, suffix, state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/** Persist a target-owned pre-resolution ward.  The save DC is frozen from the
 * caster at application time, so later incoming actions never trust a client
 * supplied DC or accidentally use the attacker's spellcasting ability. */
function applyTargetingWardPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const persisted: Dict = { ...payload, dc: evalDc(String(payload.dc), ctx) };
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'ward', state.activeEffects.length),
    name: source,
    mechanics: persisted,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, persisted);
}

/** Persist an instruction for the target's next turn.  Geometry and held-item
 * mutation are intentionally delegated to the board adapter, while the command
 * vocabulary and lifecycle remain content-owned and reusable. */
function applyTurnCommandPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const command = String(payload.command) as TurnCommand;
  const name = turnCommandEffectName(source, command);
  const displaySource = source.trim() && source !== 'действие' ? source : 'Приказ';
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, `command-${command}`, state.activeEffects.length),
    name,
    mechanics: payload,
    expiry: 'manual',
    source: displaySource,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name });
  return stackApply(state, entry, payload);
}

function applyStabilizePayload(
  state: RuntimeState,
  events: EngineEvent[],
): RuntimeState {
  if (state.hp.current !== 0 || state.deathSaves?.dead === true) {
    throw mechanicsError(
      'INVALID_MECHANICS', 'runtime.payload',
      'stabilize requires a living target at exactly 0 HP',
    );
  }
  events.push({ type: 'stabilized' });
  return {
    ...state,
    deathSaves: { successes: 0, failures: 0, stable: true, dead: false },
  };
}

function selectedChoice(ctx: ExecuteContext, id: unknown): string | undefined {
  const raw = ctx.choices?.[String(id ?? '')];
  return Array.isArray(raw) ? raw[0] : raw;
}

function scaledWeaponDice(payload: Dict, level: number): string {
  return (payload.damage_scaling as Dict[])
    .filter((entry) => Number(entry.min_level) <= level)
    .sort((left, right) => Number(right.min_level) - Number(left.min_level))
    .map((entry) => String(entry.dice))[0];
}

function applyWeaponEnchantmentPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const weaponCardId = selectedChoice(ctx, payload.weapon_choice_id);
  const damageType = selectedChoice(ctx, payload.damage_type_choice_id);
  const ability = ctx.spell?.spellcastingAbility ?? ctx.character.spellcastingAbility;
  const eligible = equippedWeaponChoices(
    ctx.character,
    state.equipment,
    Array.isArray(payload.eligible_weapon_types) ? payload.eligible_weapon_types.map(String) : [],
  );
  if (!weaponCardId || !eligible.some((weapon) => weapon.id === weaponCardId)
    || (damageType !== 'weapon' && damageType !== 'force')
    || !ability || !ABILITY_KEYS.has(ability)) {
    throw mechanicsError('INVALID_CHOICE', 'runtime.payload', 'weapon enchantment choices are invalid');
  }
  const persisted: Dict = {
    ...payload,
    weapon_card_id: weaponCardId,
    damage_type: damageType,
    attack_ability: ability,
    damage_dice: scaledWeaponDice(payload, ctx.character.level ?? 1),
  };
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'weapon-enchantment', state.activeEffects.length),
    name: source,
    mechanics: persisted,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, persisted);
}

function applyPersistentAdapterPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const persisted: Dict = payload.kind === 'illusion' && payload.investigation_dc !== undefined
    ? { ...payload, investigation_dc: evalDc(String(payload.investigation_dc), ctx) }
    : payload.kind === 'temporary_consumable'
      ? { ...payload, remaining: Number(payload.count) }
      : { ...payload };
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, String(persisted.kind), state.activeEffects.length),
    name: source,
    mechanics: persisted,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  if (persisted.kind === 'communication_link') {
    events.push({
      type: 'communication',
      mode: 'message',
      sourceActorId: ctx.selfId,
      targetActorId: ownerActorId,
      private: true,
    });
  }
  return stackApply(state, entry, persisted);
}

/** Runtime sense grants such as Dwarf Stonecunning are persisted effects. */
function applySensePayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  const sense = String(payload.sense ?? '');
  const range = Number(payload.range);
  if (!sense || !Number.isFinite(range) || range <= 0) {
    throw mechanicsError('INVALID_PAYLOAD', 'runtime.payload', `grant_sense «${sense || '?'}» has invalid range`);
  }
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'sense', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/**
 * set_value ac_base из ДЕЙСТВИЯ/ЗАКЛИНАНИЯ (Доспех мага): ставим «стоячий» активный эффект с
 * СЫРОЙ формулой — computeAC (ac.ts) сканирует state.activeEffects и берёт его как метод-кандидат
 * базового КЗ (максимум применимого, только без доспеха). Зеркало applyModifierPayload —
 * разница лишь в kind полезной нагрузки. Формула НЕ вычисляется здесь: её считает computeAC
 * в контексте владельца (иначе 13+dex застыло бы на момент каста).
 */
function applyAcBaseMethod(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'ac', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/**
 * grant_effect из ДЕЙСТВИЯ/ЗАКЛИНАНИЯ (Доспехи мага → EFFECT-0256): каст выдаёт ОТДЕЛЬНЫЙ эффект,
 * механику которого лист предзагрузил в ctx.grantedEffects[slug]. Ставим её «стоячим» активным
 * эффектом — так его непрерывные роли (set_value ac_base, modifier, resistance) начинают влиять
 * на лист/бой ровно как у пассивок. Длительность берём из механики выданного эффекта (until_long_rest
 * и т.п.). Все ссылки обязаны быть разрешены preflight-проходом до оплаты действия.
 * Наносится ИСПОЛНИТЕЛЮ (single-character лист): цель каста = сам носитель.
 */
function applyGrantEffect(
  state: RuntimeState,
  slugs: string[],
  granted: ExecuteContext['grantedEffects'],
  events: EngineEvent[],
  ctx: ExecuteContext,
  ownerActorId?: string,
): RuntimeState {
  let next = state;
  for (const slug of slugs) {
    const rec = granted?.[slug];
    const rawMech = (rec?.mechanics ?? undefined) as Dict | undefined;
    if (!isDict(rawMech)) {
      throw mechanicsError(
        'UNRESOLVED_GRANT_EFFECT',
        'runtime.payload',
        `effect reference «${slug}» was not resolved`,
      );
    }
    // Ключуем выданный эффект его slug'ом (если автор не задал stack_id): неповторяемый повторный
    // каст ПЕРЕЗАПИСЫВАЕТ (одна копия), повторяемый — НАКАПЛИВАЕТСЯ (stack_type='stack' → независимые
    // экземпляры даже для Истощения/Отравления, которые иначе схлопнулись бы).
    const mech: Dict = {
      ...rawMech,
      stack_id: rawMech.stack_id ?? slug,
      ...(rec?.repeatable ? { stack_type: 'stack' } : {}),
    };
    const name = String(rec?.name ?? (rawMech as Dict).name ?? slug);
    const { roundsLeft, expiry } = resolveDuration(mech.duration as Dict | undefined);
    const entry: ActiveEffectEntry = {
      id: runtimeEffectId(ctx, `grant-${slug}`, next.activeEffects.length),
      name,
      mechanics: mech,
      roundsLeft,
      expiry,
      source: name,
      ...(ownerActorId ? { ownerId: ownerActorId } : {}),
      ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
    };
    events.push({ type: 'effect_applied', name });
    next = stackApply(next, entry, mech);
  }
  return next;
}

/**
 * resistance/immunity/vulnerability, выданные действием (Ярость), — как «стоячий» активный
 * эффект: кладём payload в activeEffects через stackApply, чтобы resistanceLevelFor нашёл его
 * при получении урона. Зеркало applyModifierPayload; разница только в kind полезной нагрузки.
 */
function applyResistancePayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'res', state.activeEffects.length),
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/**
 * 2.4: set_value — установить поле состояния значением/формулой. target: hp|current_hp (клампится
 * в [0,max] — Неумолимая стойкость hp=1), temp_hp, max_hp|hp_max, иначе id ресурса. ac_base —
 * пассивное понятие (метод КЗ, acBaseOverrides), в рантайме не хранится. Формула — formula|value.
 */
function applySetValue(state: RuntimeState, payload: Dict, fctx: FormulaContext, events: EngineEvent[]): RuntimeState {
  const target = String(payload.target ?? '');
  const raw = String(payload.formula ?? payload.value ?? '').replace(/\s+/g, '');
  if (!raw) throw mechanicsError('INVALID_FORMULA', 'runtime.payload', 'set_value formula is empty');
  // formula-aware: fctx выбирается вызывающим (для who:'target' — контекст ЦЕЛИ, а не исполнителя).
  const evaluated = evaluate(raw, fctx);
  if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
    throw new FormulaError(`set_value «${target}»: формула «${raw}» не является конечным числом`);
  }
  const val = Math.floor(evaluated);

  const next = cloneState(state);
  switch (target) {
    case 'hp':
    case 'current_hp':
      next.hp.current = Math.max(0, Math.min(next.hp.max, val));
      events.push(narrativeEvent(`Хиты установлены: ${next.hp.current}`));
      break;
    case 'temp_hp':
      next.hp.temp = Math.max(0, val);
      events.push(tempHpEvent(next.hp.temp));
      break;
    case 'max_hp':
    case 'hp_max':
      next.hp.max = Math.max(1, val);
      if (next.hp.current > next.hp.max) next.hp.current = next.hp.max;
      events.push(narrativeEvent(`Макс. хиты установлены: ${next.hp.max}`));
      break;
    case 'ac_base':
      events.push(narrativeEvent('set_value ac_base — вычисляется как метод КЗ (armorClassValue), не рантайм-мутация.'));
      break;
    default: {
      // Только ИЗВЕСТНЫЙ ресурс. Иначе — ГРОМКО (narrative), а не тихо создаём фантомный ресурс:
      // это ловит опечатки target ('hp'→'hpp') и не-рантаймовые target ('str' у Пояса силы огра →
      // это value_method характеристики, C8), которые раньше были видны как NOT_IMPLEMENTED.
      if (target && (target in next.maxResources || target in next.resources)) {
        const before = next.resources[target] ?? 0;
        next.resources[target] = Math.max(0, val);
        const delta = next.resources[target] - before;
        events.push(delta > 0
          ? resourceRestoredEvent(target, delta, next.resources[target])
          : narrativeEvent(`Ресурс «${target}» установлен: ${next.resources[target]}`));
      } else {
        throw mechanicsError('INVALID_PAYLOAD', 'runtime.payload', `set_value has unknown target «${target}»`);
      }
    }
  }
  return next;
}

function applyHealing(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  if (collectModifiers(state, [], { roll: 'healing' }).denied) {
    events.push(narrativeEvent('Лечение заблокировано действующим эффектом.'));
    return state;
  }
  const targetHitDie = payload.hit_die === 'target' ? ctx.target?.characterContext?.hitDie : null;
  const sides = targetHitDie ? hitDieSides(targetHitDie) : null;
  const formula = sides
    ? `1d${sides}+prof_bonus`
    : withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  if (sides && payload.spend_hit_die === true) {
    const key = hitDiceResourceKey(targetHitDie);
    if (!key || (next.resources[key] ?? 0) < 1) throw new InsufficientResourcesError([key ?? 'hit_die']);
    next.resources[key] -= 1;
    events.push({ type: 'resource_spent', resource: key, amount: 1, remaining: next.resources[key] });
  }
  const healingRules = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'healing', formulaCtx: formulaCtx(ctx), evalCtx: evalCtxOf(state, ctx),
  }).rules;
  const rerollOnes = payload.reroll_ones === true
    || healingRules.some((rule) => rule.op === 'reroll_healing_ones');
  const dice = fr.dice.map((die) => ({ ...die }));
  let total = fr.total;
  if (rerollOnes) {
    for (const die of [...dice]) {
      if (die.discarded || die.result !== 1) continue;
      die.discarded = true;
      const replacement = drawDie(ctx.rng, die.sides);
      dice.push({ sides: die.sides, result: replacement });
      total += replacement - 1;
    }
  }
  next.hp.current = Math.min(next.hp.max, next.hp.current + total);
  events.push(healingEvent(total, formattedRoll({
    kind: 'healing',
    advantage: 'none',
    dice,
    modifiers: fr.modifiers,
    total,
  })));
  return next;
}

/**
 * reduce_damage: снижение ВХОДЯЩЕГО урона (Каменная стойкость Голиафа) — реакция на damage_taken.
 * НЕ трогает хиты: бросает формулу (1к12+ТЕЛ) и лишь ЭМИТИТ damage_reduction. Величину применяет
 * applyIncomingDamage (opts.damageReduction) ДО списания хитов — поэтому HP не проседает ниже
 * итогового (не триггерит «Окровален»/падение до 0) и это НЕ исцеление (не блокируется анти-хилом).
 */
function applyReduceDamage(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const formula = withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  events.push({
    type: 'damage_reduction', amount: fr.total,
    roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: fr.modifiers, total: fr.total, text: fr.text },
  });
  return state;
}

/** temp_hp: временные хиты не суммируются — остаётся большее значение. */
function applyTempHp(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const formula = withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  next.hp.temp = Math.max(next.hp.temp, fr.total);
  events.push(tempHpEvent(fr.total));
  return next;
}

/** condition: наложение состояния как активного эффекта (op:apply|remove). */
function applyCondition(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
  sourceId?: string,
  ownerActorId?: string,
  conditionImmunities = ctx.conditionImmunities,
): RuntimeState {
  const condition = String(payload.value ?? '');
  if (!condition) return state;
  const op = String(payload.op ?? 'apply');

  if (op === 'remove') {
    const normalizeTag = (value: string) => value.trim().toLowerCase()
      .replaceAll('-', '_').replaceAll(' ', '_');
    const requiredCauseTags = (Array.isArray(payload.required_cause_tags)
      ? payload.required_cause_tags : [])
      .filter((tag): tag is string => typeof tag === 'string')
      .map(normalizeTag);
    const requiredEndTrigger = typeof payload.required_end_trigger === 'string'
      ? payload.required_end_trigger : null;
    const kept = state.activeEffects.filter((e) => {
      const m = e.mechanics as Dict;
      const causeTags = new Set(
        (Array.isArray(m?.causeTags) ? m.causeTags
          : Array.isArray(m?.cause_tags) ? m.cause_tags
            : [])
          .filter((tag): tag is string => typeof tag === 'string')
          .map(normalizeTag),
      );
      const endTriggers = Array.isArray(m?.end_triggers) ? m.end_triggers.map(String) : [];
      const match = m?.kind === 'condition'
        && String(m.value ?? '') === condition
        && requiredCauseTags.every((tag) => causeTags.has(tag))
        && (requiredEndTrigger == null || endTriggers.includes(requiredEndTrigger));
      if (match) events.push({ type: 'effect_expired', name: e.name });
      return !match;
    });
    // Остаточные состояния (Без сознания → остаётесь Опрокинутым): добавляем самостоятельными, если их ещё нет.
    const present = new Set(
      kept.filter((e) => (e.mechanics as Dict)?.kind === 'condition').map((e) => String((e.mechanics as Dict).value ?? '')),
    );
    const additions: ActiveEffectEntry[] = [];
    for (const leave of conditionLeaves(condition)) {
      if (present.has(leave)) continue;
      additions.push({
        id: runtimeEffectId(ctx, `cond-leave-${leave}`, state.activeEffects.length + additions.length),
        name: conditionLabel(leave),
        mechanics: { kind: 'condition', value: leave, op: 'apply' },
        expiry: 'manual',
        source: `осталось от «${condition}»`,
      });
      events.push(conditionAppliedEvent(leave));
    }
    return { ...state, activeEffects: [...kept, ...additions] };
  }

  const normalizeTag = (value: string) => value.trim().toLowerCase()
    .replaceAll('-', '_').replaceAll(' ', '_');
  const causeTags = new Set(
    (Array.isArray(payload.causeTags) ? payload.causeTags
      : Array.isArray(payload.cause_tags) ? payload.cause_tags
        : [])
      .filter((tag): tag is string => typeof tag === 'string')
      .map(normalizeTag),
  );
  const conditionOwnedImmunities = state.activeEffects.flatMap((entry) => {
    const mechanics = entry.mechanics as Dict;
    const candidates = mechanics.kind === 'condition' && mechanics.value
      ? conditionRuntimePayloads(String(mechanics.value))
      : payloadsOf(mechanics);
    return candidates.flatMap((candidate) => (
      candidate.kind === 'condition_immunity' && candidate.condition
        ? [{
          condition: String(candidate.condition),
          ...(Array.isArray(candidate.requiredCauseTags)
            ? { requiredCauseTags: candidate.requiredCauseTags.map(String) }
            : {}),
          ...(Array.isArray(candidate.source_creature_types)
            ? { sourceCreatureTypes: candidate.source_creature_types.map(String) }
            : {}),
          sourceEntityIds: [entry.id],
        }]
        : []
    ));
  });
  const immunity = [...(conditionImmunities ?? []), ...conditionOwnedImmunities].find((candidate) => (
    normalizeTag(candidate.condition) === normalizeTag(condition)
      && (candidate.requiredCauseTags ?? []).every((tag) => causeTags.has(normalizeTag(tag)))
      && ((candidate.sourceCreatureTypes ?? []).length === 0
        || candidate.sourceCreatureTypes!.some((requiredType) => (
          creatureTypeMatches(ctx.character.creatureType, requiredType)
        )))
  ));
  if (immunity) {
    events.push({
      type: 'condition_immune',
      condition,
      sourceEntityIds: [...immunity.sourceEntityIds],
    });
    return state;
  }

  const duration = payload.duration as Dict | undefined;
  const relative = sourceTurnMetadata(duration, ctx, ownerActorId);
  const resolved = relative ? { expiry: relative.expiry } : resolveDuration(duration);
  const { roundsLeft, expiry } = resolved;
  const stacking = conditionStacking(condition);
  const existingLevel = conditionLevel(state, condition);
  if (stacking.mode === 'levels' && stacking.max != null && existingLevel >= stacking.max) {
    events.push(narrativeEvent(`${conditionLabel(condition)}: достигнут максимальный уровень ${stacking.max}.`));
    return state;
  }
  let persistedPayload: Dict = stacking.mode === 'levels'
    ? { ...payload, stack_type: 'stack' }
    : { ...payload };
  const saveEnds = persistedPayload.save_ends as Dict | undefined;
  if (saveEnds && typeof saveEnds === 'object' && !Array.isArray(saveEnds)
    && saveEnds.dc !== undefined) {
    const resolvedDc = evaluate(saveEnds.dc as string | number, {
      ...formulaCtx(ctx),
      rng: () => { throw new FormulaError('save_ends DC cannot contain a random die'); },
    });
    if (typeof resolvedDc !== 'number' || !Number.isFinite(resolvedDc) || resolvedDc <= 0) {
      throw mechanicsError(
        'INVALID_FORMULA', 'runtime.payload.save_ends.dc',
        'save_ends DC must resolve to a positive finite number',
      );
    }
    persistedPayload = {
      ...persistedPayload,
      save_ends: { ...saveEnds, dc: resolvedDc },
    };
  }
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'cond', state.activeEffects.length),
    name: condition,
    mechanics: persistedPayload,
    roundsLeft,
    expiry,
    source,
    // E: владелец состояния и наложивший его актор нужны как для реляционных правил
    // (Очарованный ↛ очаровавший), так и для точного source-turn lifecycle.
    ...(ownerActorId ? { ownerId: ownerActorId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(relative ?? {}),
  };
  events.push(conditionAppliedEvent(condition));
  const next = stackApply(state, entry, persistedPayload);
  const threshold = conditionLevel(next, condition);
  if (threshold > existingLevel) {
    const outcome = conditionRule(condition)?.thresholds?.find((candidate) => threshold >= candidate.atLevel);
    if (outcome) events.push(narrativeEvent(
      `${conditionLabel(condition)}: уровень ${threshold}, порог ${outcome.atLevel} → ${outcome.outcome}.`,
    ));
  }
  return next;
}

/** resource: grant — сверх максимума (Прилив действий), restore — до максимума. */
function applyResource(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  let key = String(payload.id ?? payload.resource ?? '');
  if (!key) throw mechanicsError('INVALID_PAYLOAD', 'runtime.payload', 'resource id is empty');
  if (key === 'spell_slot' && payload.level != null) key = `spell_slot_${payload.level}`;

  const evaluated = evaluate(payload.amount == null ? 1 : String(payload.amount), formulaCtx(ctx));
  if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
    throw new FormulaError(`resource «${key}»: amount must resolve to a finite number`);
  }
  const amount = Math.max(0, Math.floor(evaluated));
  const op = String(payload.op ?? 'grant');
  if (op !== 'grant' && op !== 'restore' && op !== 'grant_capped') {
    throw mechanicsError('INVALID_PAYLOAD', 'runtime.payload', `unsupported resource operation «${op}»`);
  }
  const next = cloneState(state);
  const current = next.resources[key] ?? 0;

  if (op === 'restore') {
    const max = next.maxResources[key];
    next.resources[key] = max != null ? Math.min(max, current + amount) : current + amount;
  } else if (op === 'grant_capped') {
    const cap = Math.max(1, Math.floor(Number(payload.max ?? 1)) || 1);
    next.maxResources[key] = Math.max(next.maxResources[key] ?? 0, cap);
    next.resources[key] = Math.min(cap, current + amount);
  } else {
    next.resources[key] = current + amount;
  }
  const gained = next.resources[key] - current;
  if (gained > 0) events.push(resourceRestoredEvent(key, gained, next.resources[key]));
  return next;
}

type DamageInstance = { amount: number; damageType: string; roll?: import('../mvp/contracts').RollLog };
type AttackDamageQueryFacts = Pick<ModifierQueryFacts,
  | 'attackKind'
  | 'weaponCategory'
  | 'extraAttackSource'
  | 'weaponHasThrownProperty'
  | 'weaponWieldedInTwoHands'
  | 'otherWeaponEquipped'
> & {
  /** Ability modifier used for this attack, independent of the weapon's default ability. */
  weaponMod?: number;
};

/** C1: модификаторы урона из активных эффектов/пассивок (Ярость +СИЛ, «Свет Латандера» +3).
 *  Запрос ОБЯЗАН передать ability использованной характеристики — иначе фильтр Ярости
 *  {ability:'str'} отсечёт её (matchFilter). Возвращает отдельные строки (гранулярность №4). */
function collectDamageModifiers(
  ctx: ExecuteContext,
  state: RuntimeState,
  filter: ModifierQueryFacts,
  weaponMod?: number,
): RollModifier[] {
  return collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'damage',
    filter,
    formulaCtx: { ...formulaCtx(ctx), ...(weaponMod !== undefined ? { weaponMod } : {}) },
    evalCtx: evalCtxOf(state, ctx),
  }).modifiers;
}

/** Data-driven die rules for the exact immutable attack/damage-line facts. */
function damageRules(
  ctx: ExecuteContext,
  state: RuntimeState,
  filter: ModifierQueryFacts,
  weaponMod?: number,
): Dict[] {
  const rules = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'damage',
    filter,
    formulaCtx: { ...formulaCtx(ctx), ...(weaponMod !== undefined ? { weaponMod } : {}) },
    evalCtx: evalCtxOf(state, ctx),
  }).rules;
  const fired = new Set(state.firedThisTurn ?? []);
  return rules.filter((rule) => {
    const key = typeof rule.once_per_turn === 'string' ? rule.once_per_turn.trim() : '';
    return !key || !fired.has(key);
  });
}

function recordUsedDamageRules(state: RuntimeState, keys: readonly string[]): void {
  if (!keys.length) return;
  state.firedThisTurn = [...new Set([...(state.firedThisTurn ?? []), ...keys])];
}

/** Лимит взрывных костей из свойства payload.explode ({limit}|число|формула). undefined — нет взрыва. */
function explodeLimitOf(payload: Dict, ctx: ExecuteContext): number | undefined {
  const ex = payload.explode;
  if (ex == null || ex === false) return undefined;
  const raw = typeof ex === 'object' ? ((ex as Dict).limit ?? (ex as Dict).times) : ex;
  if (raw == null || raw === true) return undefined;
  try { const v = evaluate(String(raw).replace(/\s+/g, ''), formulaCtx(ctx)); if (typeof v === 'number') return Math.max(0, Math.floor(v)); } catch { /* число ниже */ }
  const n = Number(raw); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
}

/**
 * Критическое попадание (PHB 2024): кости урона броска бросаются ДВАЖДЫ, а модификаторы
 * (мод характеристики, зачарование, плоские бонусы) прибавляются один раз. Удваиваем число
 * костей в формуле («2d6+3» → «4d6+3»); константы/бонусы не трогаем.
 */
function doubleDice(formula: string): string {
  return String(formula).replace(/(\d+)d(\d+)/gi, (_m, n: string, s: string) => `${Number(n) * 2}d${s}`);
}

/**
 * Одна payload-строка урона → одна ИЛИ несколько нанесённых инстанций.
 * dice:"weapon" раскрывается в оружие в руке: основная строка (кость + мод характеристики
 * + зачарование) плюс отдельная инстанция на каждый стихийный урон (без мода и зачарования).
 * Порядок стабилен (основная первой) — важно для плана кубов/диалога и сопротивлений по типам.
 * crit=true — критическое попадание: кости броска удваиваются (модификаторы — один раз).
 */
function resolveDamageAmounts(
  payload: Dict,
  ctx: ExecuteContext,
  state: RuntimeState,
  hand: 'main' | 'off',
  crit = false,
  attackFacts?: AttackDamageQueryFacts,
): DamageInstance[] {
  const handWeapon = weaponContext(ctx.character, hand, state.equipment, state);
  const declaredDamageType = String(payload.type).trim();
  const explodeLimit = explodeLimitOf(payload, ctx);
  const damageRng = ctx.damageRng ?? ctx.rng;

  if (payload.dice === 'weapon') {
    if (!handWeapon) {
      throw mechanicsError(
        'INVALID_MECHANICS',
        'context.character.equipment',
        `weapon damage requires an explicit equipped ${hand}-hand weapon`,
      );
    }
    const lines = handWeapon.damages;
    const ab = String(payload.ability ?? 'auto');
    return lines.map((line, i) => {
      const usedAbility = ab === 'auto'
        ? handWeapon?.ability
        : (ab !== 'none' && ab !== 'spellcasting' ? (ab as AbilityKey) : undefined);
      const damageFilter: ModifierQueryFacts = {
        hand,
        ...attackFacts,
        ...(usedAbility ? { ability: usedAbility } : {}),
        abilityModifierAlreadyIncluded: ab !== 'none',
        weaponDamageLine: i === 0 ? 'base' : 'extra',
      };
      const dmgRules = damageRules(ctx, state, damageFilter, attackFacts?.weaponMod);
      const fr = rollFormula(crit ? doubleDice(line.dice) : line.dice, formulaCtx(ctx), { rng: damageRng });
      // Правила кости (die_bonus/explode) — на кости строки, до модов характеристики/зачарования.
      const ruled = applyDamageDieRules(fr.dice, dmgRules, { explodeLimit, rng: damageRng });
      recordUsedDamageRules(state, ruled.usedRuleKeys);
      let total = fr.total + ruled.delta;
      let extraMods: RollModifier[] = [];
      // Мод характеристики и зачарование — только на основную строку (RAW: +N один раз к урону оружия).
      if (i === 0) {
        const weaponMods: RollModifier[] = [];
        const weaponDamageAbilityMod = handWeapon
          ? ctx.character.abilityMods[handWeapon.ability] ?? 0
          : undefined;
        const attackWeaponMod = attackFacts?.weaponMod ?? weaponDamageAbilityMod;
        if (ab === 'auto' && handWeapon) {
          weaponMods.push({
            value: weaponDamageAbilityMod ?? 0,
            source: ABILITY_LABEL[handWeapon.ability],
          });
        } else if (ab === 'spellcasting') {
          weaponMods.push({
            value: ctx.character.spellcastingMod ?? 0,
            source: 'Базовая характеристика заклинаний',
          });
        } else if (ab !== 'auto' && ab !== 'none') {
          weaponMods.push({
            value: ctx.character.abilityMods[ab as AbilityKey] ?? 0,
            source: ABILITY_LABEL[ab as AbilityKey],
          });
        }
        if (handWeapon?.damageEnchant) {
          weaponMods.push({ value: handWeapon.damageEnchant, source: 'Зачарование оружия' });
        }
        // C1: модификаторы урона из эффектов (Ярость и т.п.) — на основную строку, отдельными частями.
        extraMods = [
          ...weaponMods,
          ...collectDamageModifiers(ctx, state, damageFilter, attackWeaponMod),
        ];
        for (const m of extraMods) total += m.value;
      }
      return {
        amount: total,
        damageType: line.type,
        roll: formattedRoll({
          kind: 'damage', advantage: 'none', dice: ruled.dice,
          modifiers: [...fr.modifiers, ...extraMods], total,
        }),
      };
    });
  }

  let damageType = declaredDamageType;
  if (damageType === 'weapon') {
    if (!handWeapon) {
      throw mechanicsError(
        'INVALID_MECHANICS',
        'context.character.equipment',
        `weapon damage requires an explicit equipped ${hand}-hand weapon`,
      );
    }
    damageType = handWeapon.damageType;
  }

  const flat = payload.amount != null ? String(payload.amount) : payload.dice != null ? String(payload.dice) : null;
  if (flat != null) {
    const scaled = withScaling(flat, payload, ctx);
    const usedAbility = payload.ability != null && payload.ability !== 'auto' && payload.ability !== 'none'
      ? (payload.ability as AbilityKey) : undefined;
    const damageFilter: ModifierQueryFacts = {
      ...attackFacts,
      ...(usedAbility ? { ability: usedAbility } : {}),
      weaponDamageLine: 'none',
    };
    const dmgRules = damageRules(ctx, state, damageFilter, attackFacts?.weaponMod);
    const fr = rollFormula(crit ? doubleDice(scaled) : scaled, formulaCtx(ctx), { rng: damageRng });
    const ruled = applyDamageDieRules(fr.dice, dmgRules, { explodeLimit, rng: damageRng });
    recordUsedDamageRules(state, ruled.usedRuleKeys);
    // C1: модификаторы урона из эффектов. Для не-оружейного урона ability берём из payload,
    // если задан; иначе ability в фильтр не кладём (эффект без ability-фильтра всё равно применится).
    const extraMods = payload.suppress_damage_modifiers === true
      ? []
      : collectDamageModifiers(ctx, state, damageFilter, attackFacts?.weaponMod);
    let total = fr.total + ruled.delta;
    for (const m of extraMods) total += m.value;
    return [{
      amount: total,
      damageType,
      roll: formattedRoll({
        kind: 'damage', advantage: 'none', dice: ruled.dice,
        modifiers: [...fr.modifiers, ...extraMods], total,
      }),
    }];
  }

  return [{ amount: 0, damageType }];
}

/**
 * Единый роутер payload-ов (§6.5 схемы): исполняет список исходов
 * on_hit / on_crit / on_fail / on_success / result.
 */
/** Холдер состояния ЦЕЛИ (C2). payload-ы who:'target' мутируют отдельную цель через state,
 *  а self-target — уже оплаченное состояние исполнителя через aliasesSelf. state undefined без
 *  aliasesSelf означает цель без runtimeState: всё идёт в self для обратной совместимости. */
type TargetRef = { state?: RuntimeState; mutated: boolean; aliasesSelf?: boolean };

function riderFilterMatches(filter: Dict | undefined, facts: Dict): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;
  return Object.entries(filter).every(([key, value]) => facts[key] === value);
}

type DamageRiderCandidate = { payload: Dict; name: string; sourceId?: string };

/** Collects one-hit damage additions from actor-owned runtime/passive effects
 * and target-owned marks. Target marks are source-bound by persisted actor id,
 * so a second attacker cannot borrow Hunter's Mark or Hex. */
function attackDamageRiders(
  state: RuntimeState,
  ctx: ExecuteContext,
  facts: AttackDamageQueryFacts,
): DamageRiderCandidate[] {
  const candidates: DamageRiderCandidate[] = [];
  const collect = (
    mechanics: Dict,
    name: string,
    expectedScope: 'self' | 'target',
    sourceId?: string,
  ): void => {
    for (const payload of payloadsOf(mechanics)) {
      if (payload.kind !== 'damage_rider'
        || payload.trigger !== 'hit_by_attack_roll'
        || String(payload.scope ?? 'self') !== expectedScope
        || !riderFilterMatches(payload.filter as Dict | undefined, facts)) continue;
      if (expectedScope === 'target' && payload.source_actor_only === true
        && (!ctx.selfId || sourceId !== ctx.selfId)) continue;
      if (!matchesWhen(payload.when as Dict[] | undefined, {
        ...evalCtxOf(state, ctx),
        event: { kind: 'hit', data: facts },
      })) continue;
      candidates.push({ payload, name, sourceId });
    }
  };
  for (const effect of state.activeEffects) {
    collect(effect.mechanics as Dict, effect.name, 'self', effect.sourceId);
  }
  for (const passive of passivesFromCtx(ctx)) {
    collect(passive, String(passive.name ?? 'пассивный райдер'), 'self');
  }
  for (const effect of ctx.target?.runtimeState?.activeEffects ?? []) {
    collect(effect.mechanics as Dict, effect.name, 'target', effect.sourceId);
  }
  return candidates;
}

function applyAttackDamageRiders(
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  hand: 'main' | 'off',
  targetRef: TargetRef,
  crit: boolean,
  facts: AttackDamageQueryFacts,
): RuntimeState {
  let next = state;
  for (const rider of attackDamageRiders(next, ctx, facts)) {
    const payload = {
      ...rider.payload,
      kind: 'damage',
      suppress_damage_modifiers: true,
    };
    const routedTarget = targetRef.aliasesSelf ? next : targetRef.state;
    if (routedTarget) {
      const targetContext: ExecuteContext = {
        ...ctx,
        character: ctx.target?.characterContext ?? ctx.character,
        passives: ctx.target?.passives ?? ctx.passives,
      };
      let damagedTarget = routedTarget;
      for (const damage of resolveDamageAmounts(payload, ctx, next, hand, crit, facts)) {
        const applied = applyIncomingDamage(damagedTarget, damage.amount, targetContext, {
          damageType: damage.damageType,
          roll: damage.roll,
          crit,
        });
        damagedTarget = applied.state;
        events.push(...applied.events);
      }
      if (targetRef.aliasesSelf) next = damagedTarget;
      else {
        targetRef.state = damagedTarget;
        targetRef.mutated = true;
      }
    } else {
      for (const damage of resolveDamageAmounts(payload, ctx, next, hand, crit, facts)) {
        events.push(damageEvent(damage.amount, damage.damageType, damage.roll));
      }
    }
  }
  return next;
}

/** «Талон» (Вдохновение барда): чип-эффект с костью, которую получатель бросает отдельно
 *  и снимает вручную. Вынесен в хелпер, чтобы who:'target' мог класть его цели. */
function applyBoon(
  state: RuntimeState,
  p: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  const die = String(p.die ?? 'к6').replace(/d/i, 'к');
  const name = `Талон ${die}${p.id ? ` (${source})` : ''}`;
  const mechanics: Dict = {
    ...p,
    ...(p.id != null && p.stack_id == null ? { stack_id: `boon:${String(p.id)}` } : {}),
  };
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'boon', state.activeEffects.length), name, mechanics, expiry: 'manual', source,
  };
  const next = stackApply(state, entry, mechanics);
  events.push({ type: 'effect_applied', name, sourceAction: source });
  events.push(narrativeEvent(
    `Талон ${die}: получатель бросает отдельный ${die}, вручную добавляет результат к броску атаки, проверке или спасброску`
    + `${p.expires ? ` (истекает: ${p.expires})` : ''}, затем снимает эффект.`,
  ));
  return next;
}

/** Превращение (Дикий облик): облик как активный эффект-чип; стат-блок зверя — по бестиарию. */
function applyTransform(
  state: RuntimeState,
  p: Dict,
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  const formName = String(p.form ?? p.value ?? p.into ?? 'Дикий облик');
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, 'form', state.activeEffects.length), name: `Облик: ${formName}`, mechanics: p, expiry: 'manual', source,
  };
  const next = { ...state, activeEffects: [...state.activeEffects, entry] };
  events.push({ type: 'effect_applied', name: entry.name, sourceAction: source });
  events.push(narrativeEvent(
    `Превращение (${source}): используйте стат-блок зверя${p.max_cr != null ? ` (ПО ≤ ${p.max_cr})` : ''}; `
    + 'ментальные характеристики и спасброски МДР/ИНТ/ХАР — ваши. Снимите эффект при возврате.',
  ));
  return next;
}

// Инлайн инвентарных хелперов (как в cost.ts) — избегаем cross-layer импорта character/runtime.
function invQtyOf(state: RuntimeState, cardId: string): number {
  return state.inventory.find((r) => r.cardId === cardId)?.qty ?? 0;
}
function addItemToInventory(state: RuntimeState, cardId: string, qty: number): RuntimeState {
  const inventory = state.inventory.map((r) => ({ ...r }));
  // S4: add_item кладёт на ВЕРХНИЙ уровень (containerId пусто), не в стопку внутри контейнера.
  const row = inventory.find((r) => r.cardId === cardId && r.containerId == null);
  if (row) row.qty += qty;
  else inventory.push({ cardId, qty });
  return { ...state, inventory };
}

function applyPayloads(
  payloads: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  hand: 'main' | 'off',
  halfDamage = false,
  whoTarget = false,
  targetRef: TargetRef = { mutated: false },
  crit = false,
  attackFacts?: AttackDamageQueryFacts,
): RuntimeState {
  let next = state;
  // Роутер мутации (C2): who:'target' с переданным состоянием цели пишет в ЦЕЛЬ и метит
  // mutated; self-target пишет прямо в уже оплаченное состояние исполнителя. Иначе — в self
  // для обратной совместимости с вызовами без runtimeState цели.
  const route = (mutate: (s: RuntimeState) => RuntimeState) => {
    if (whoTarget && targetRef.aliasesSelf) {
      next = mutate(next);
    } else if (whoTarget && targetRef.state) {
      targetRef.state = mutate(targetRef.state);
      targetRef.mutated = true;
    } else {
      next = mutate(next);
    }
  };
  for (const p of payloads) {
    const kind = String(p.kind ?? '');
    switch (kind) {
      case 'damage': {
        // Оружейный урон может раскрыться в несколько строк (основной + стихийный) —
        // каждую наносим отдельным событием (сопротивления по типам, план кубов, №4).
        const routedTarget = whoTarget
          ? (targetRef.aliasesSelf ? next : targetRef.state)
          : undefined;
        if (routedTarget) {
          // C2/фаза E: урон по ВЫБРАННОЙ цели реально списывает её HP через applyIncomingDamage
          // (сопротивление/иммунитет/уязвимость цели, temp→current, авто-проверка концентрации).
          // Величину урона считаем статами АТАКУЮЩЕГО, применяем — на состоянии ЦЕЛИ с её контекстом.
          const tctx: ExecuteContext = {
            ...ctx,
            character: ctx.target?.characterContext ?? ctx.character,
            passives: ctx.target?.passives ?? ctx.passives,
          };
          let damagedTarget = routedTarget;
          for (const dmg of resolveDamageAmounts(p, ctx, next, hand, crit, attackFacts)) {
            const amount = halfDamage ? Math.floor(dmg.amount / 2) : dmg.amount;
            const res = applyIncomingDamage(damagedTarget, amount, tctx, {
              damageType: dmg.damageType,
              roll: dmg.roll,
            });
            damagedTarget = res.state;
            events.push(...res.events);
          }
          if (targetRef.aliasesSelf) {
            next = damagedTarget;
          } else {
            targetRef.state = damagedTarget;
            targetRef.mutated = true;
          }
        } else {
          for (const dmg of resolveDamageAmounts(p, ctx, next, hand, crit, attackFacts)) {
            const amount = halfDamage ? Math.floor(dmg.amount / 2) : dmg.amount;
            events.push(damageEvent(amount, dmg.damageType, dmg.roll));
          }
        }
        break;
      }
      case 'healing': route((s) => applyHealing(s, p, ctx, events)); break;
      case 'reduce_damage': route((s) => applyReduceDamage(s, p, ctx, events)); break;
      case 'temp_hp': route((s) => applyTempHp(s, p, ctx, events)); break;
      case 'condition': route((s) => applyCondition(
        s,
        p,
        source,
        events,
        ctx,
        ctx.selfId,
        whoTarget ? ctx.target?.id : ctx.selfId,
        whoTarget ? ctx.target?.conditionImmunities : ctx.conditionImmunities,
      )); break;
      case 'resource': route((s) => applyResource(s, p, ctx, events)); break;
      case 'modifier': route((s) => applyModifierPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'damage_rider': route((s) => applyDamageRiderPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'condition_immunity': route((s) => applyConditionImmunityPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'triggered_effect': route((s) => applyTriggeredEffectPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'fall_protection':
      case 'movement_option': route((s) => applyTraversalPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'targeting_ward': route((s) => applyTargetingWardPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'turn_command': route((s) => applyTurnCommandPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'stabilize': route((s) => applyStabilizePayload(s, events)); break;
      case 'weapon_enchantment': route((s) => applyWeaponEnchantmentPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'remote_manipulator':
      case 'communication_link':
      case 'illusion':
      case 'temporary_consumable':
      case 'world_entity':
      case 'information_access':
      case 'world_zone': route((s) => applyPersistentAdapterPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'world_interaction':
        events.push({
          type: 'world_interaction',
          operation: String(p.operation),
          parameters: { ...(p.parameters as Dict) },
          source,
        });
        break;
      case 'information_reveal':
        events.push({
          type: 'world_interaction',
          operation: 'reveal_information',
          parameters: {
            reveal: String(p.reveal),
            fields: [...(p.fields as string[])],
          },
          source,
        });
        break;
      // Typed, short-lived opportunity consumed by an authoritative follow-up
      // command (Cleave today; reusable for later attack riders).
      case 'attack_follow_up': route((s) => applyModifierPayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'grant_sense': route((s) => applySensePayload(
        s,
        p,
        source,
        events,
        ctx,
        whoTarget ? ctx.target?.id : ctx.selfId,
      )); break;
      case 'resistance': route((s) => applyResistancePayload(s, p, source, events, ctx)); break;
      case 'set_value': {
        // ac_base — не рантайм-мутация, а НОВЫЙ метod расчёта КЗ (Доспех мага 13+ЛВК): ставим
        // «стоячий» активный эффект с сырой формулой, computeAC подберёт его как метод-кандидат.
        if (p.target === 'ac_base') { route((s) => applyAcBaseMethod(s, p, source, events, ctx)); break; }
        // Значение считаем в контексте того, КОГО меняем: при who:'target' — по статам ЦЕЛИ
        // (targetFormulaCtx), иначе исполнителя. Для литералов (hp=1) неважно; для формул — критично.
        const fctx = (whoTarget && targetRef.state) ? (targetFormulaCtx(ctx.target) ?? formulaCtx(ctx)) : formulaCtx(ctx);
        route((s) => applySetValue(s, p, fctx, events));
        break;
      }
      case 'grant_effect': {
        // Каст выдаёт отдельный эффект (Доспехи мага → EFFECT-0256): ставим его механику стоячим
        // активным эффектом (лист предзагрузил её в ctx.grantedEffects). Раньше падало в NOT_IMPLEMENTED.
        const slugs: string[] = [];
        if (typeof p.value === 'string' && p.value) slugs.push(p.value);
        if (Array.isArray(p.values)) for (const v of p.values) if (typeof v === 'string' && v) slugs.push(v);
        route((s) => applyGrantEffect(
          s,
          slugs,
          ctx.grantedEffects,
          events,
          ctx,
          whoTarget ? ctx.target?.id : ctx.selfId,
        ));
        break;
      }
      case 'variable':
        throw mechanicsError(
          'UNKNOWN_PAYLOAD',
          'runtime.payload.kind',
          'variable is a build primitive and has no RuntimeState interpreter',
        );
      case 'value_method':
        throw mechanicsError(
          'UNKNOWN_PAYLOAD',
          'runtime.payload.kind',
          'value_method is a build primitive and cannot be activated',
        );
      case 'choice': {
        // Ярус 1.2: выбор в момент исполнения. Решение игрока собрано предпроходом на клике
        // действия в ctx.choices[<сырой id выбора>] (fallback 'choice' — как в коллекторе).
        // Разворачиваем выбранные ветки тем же роутером (вложенный choice → снова сюда).
        // Нормализуем форму (resistance из apply-шаблона) и НЕ пропускаем build-гранты (grant_* —
        // их применяет резолвер сборки, здесь они лишь замусорили бы журнал NOT_IMPLEMENTED).
        const raw = ctx.choices?.[String(p.id ?? 'choice')];
        const vals = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        if (vals.length) {
          const sub = selectedChoicePayloads(p, vals)
            .map(normalizeChoicePayload)
            .filter((sp) => !String(sp.kind).startsWith('grant_'));
          next = applyPayloads(
            sub, next, ctx, events, source, hand, halfDamage, whoTarget, targetRef, crit, attackFacts,
          );
        }
        break;
      }
      case 'add_item': {
        // Контейнеры (S1): рантайм-выдача предмета в инвентарь ИСПОЛНИТЕЛЯ (self, не target —
        // контейнер наполняет сумку носителя). Имя вне grant_-неймспейса намеренно: in-play choice
        // вырезает grant_* (см. case 'choice'). Персист включает item_added-гейт (панель).
        const cardId = String(p.card_id ?? p.value ?? '');
        const qty = Math.max(1, Math.floor(Number(p.qty ?? p.amount ?? 1)) || 1);
        if (cardId) {
          next = addItemToInventory(next, cardId, qty);
          const name = typeof p.name === 'string' ? p.name : undefined;
          events.push(itemAddedEvent(cardId, qty, invQtyOf(next, cardId), name));
          if (p.temporary_until === 'long_rest') {
            const entry: ActiveEffectEntry = {
              id: runtimeEffectId(ctx, `temporary-item-${cardId}`, next.activeEffects.length),
              name: `Временный предмет: ${name ?? cardId}`,
              mechanics: { kind: 'temporary_inventory_item', card_id: cardId, qty },
              expiry: 'long_rest',
              source,
            };
            next = { ...next, activeEffects: [...next.activeEffects, entry] };
            events.push({ type: 'effect_applied', name: entry.name, sourceAction: source });
          }
        } else {
          throw mechanicsError('INVALID_PAYLOAD', 'runtime.payload', 'add_item has no card_id/value');
        }
        break;
      }
      case 'movement': {
        const evaluated = evaluate(p.distance == null ? 0 : String(p.distance), formulaCtx(ctx));
        if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
          throw new FormulaError('movement distance must resolve to a finite number');
        }
        events.push({
          type: 'movement',
          mode: String(p.value ?? 'move'),
          distanceFt: Math.max(0, evaluated),
        });
        break;
      }
      case 'boon': route((s) => applyBoon(s, p, source, events, ctx)); break;
      case 'reroll': {
        // Переброс (Везунчик): архитектурно бросок уже совершён — движок фиксирует
        // право переброса, значение вводится диалогом кубов.
        const which = String(p.which ?? 'd20').replace(/d/i, 'к');
        const keep = p.keep === 'either' ? 'оставьте любой из двух результатов' : 'используйте новый результат';
        events.push(narrativeEvent(`Переброс ${which}: перебросьте кость — ${keep}.`));
        break;
      }
      case 'transform': route((s) => applyTransform(s, p, source, events, ctx)); break;
      case 'narrative':
        events.push(narrativeEvent(String(p.description ?? p.text ?? '')));
        break;
      default:
        throw mechanicsError('UNKNOWN_PAYLOAD', 'runtime.payload.kind', `executor does not own payload kind «${kind || '?'}»`);
    }
  }
  return next;
}

/**
 * Снять активный modifier с consume:'next' после первого подходящего броска.
 * Это общий примитив для «следующей атаки с помехой» и «−к4 к следующему спасброску».
 */
function modifierMatchesRoll(
  payload: Dict,
  roll: string,
  filter?: Dict,
  evalCtx?: EvalContext,
  scope: 'self' | 'target' = 'self',
): boolean {
  if (payload.kind !== 'modifier' || payload.consume !== 'next') return false;
  if (String(payload.scope ?? 'self') !== scope) return false;
  const applies = payload.applies_to as Dict | undefined;
  const rollMatches = applies?.roll === roll || (applies?.roll === 'd20'
    && ['attack', 'saving_throw', 'ability_check', 'initiative'].includes(roll));
  if (!rollMatches) return false;
  const requiredFilter = applies?.filter as Dict | undefined;
  if (requiredFilter) {
    if (!filter) return false;
    for (const [key, value] of Object.entries(requiredFilter)) {
      if (filter[key] !== value) return false;
    }
  }
  return matchesWhen(payload.when as Dict[] | undefined, evalCtx);
}

export function consumeNextRollEffects(
  state: RuntimeState,
  roll: string,
  events: EngineEvent[],
  options: { filter?: Dict; evalCtx?: EvalContext; scope?: 'self' | 'target' } = {},
): RuntimeState {
  const expired: ActiveEffectEntry[] = [];
  const activeEffects = state.activeEffects.filter((entry) => {
    const consumes = payloadsOf(entry.mechanics).some((payload) => (
      modifierMatchesRoll(payload, roll, options.filter, options.evalCtx, options.scope)
    ));
    if (consumes) expired.push(entry);
    return !consumes;
  });
  if (!expired.length) return state;
  expired.forEach((entry) => events.push({ type: 'effect_expired', name: entry.name }));
  return { ...state, activeEffects };
}

/**
 * Ends runtime effects whose canonical payload names an observable trigger.
 * Hide uses this after the roll has been assembled, so Invisible still affects
 * the first attack but cannot leak into a second attack in the same action.
 */
export function expireEffectsForTrigger(
  state: RuntimeState,
  trigger: string,
  events: EngineEvent[],
): RuntimeState {
  const expired: ActiveEffectEntry[] = [];
  const activeEffects = state.activeEffects.filter((entry) => {
    const mechanics = entry.mechanics as Dict;
    const triggers = [
      ...(Array.isArray(mechanics.hidden_end_triggers)
        ? mechanics.hidden_end_triggers.map(String)
        : []),
      ...(Array.isArray(mechanics.end_triggers)
        ? mechanics.end_triggers.map(String)
        : []),
    ];
    if (!triggers.includes(trigger)) return true;
    expired.push(entry);
    return false;
  });
  if (!expired.length) return state;
  expired.forEach((entry) => events.push({ type: 'effect_expired', name: entry.name }));
  return { ...state, activeEffects };
}

function runAttackRoll(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
  deferredSaves: DeferredTargetSave[] = [],
): RuntimeState {
  const whoTarget = String(effect.who ?? 'target') === 'target'
    && (!!targetRef.state || targetRef.aliasesSelf === true);
  const hand = resolveHand(effect);
  const ac = ctx.target!.ac!;
  const passives = passivesFromCtx(ctx);
  const currentWeapon = weaponContext(ctx.character, hand, state.equipment, state);
  const attackRange = attackRangeFromEffect(effect, hand, ctx.character, state.equipment);
  const heavy = currentWeapon ? evaluateWeaponHeavyRule(
    currentWeapon,
    attackRange ?? currentWeapon.defaultAttackMode,
    ctx.character.abilityScores,
  ) : null;
  if (heavy && !heavy.valid) throw new Error(heavy.issue);
  const attackFacts = attackRollQueryFacts(effect, hand, ctx.character, state.equipment);
  const attackFilter: ModifierQueryFacts = {
    ...attackFacts,
    ...(ctx.target?.id ? { targetActorId: ctx.target.id } : {}),
    ...(ctx.spell?.sourceClass ? { spellClass: ctx.spell.sourceClass } : {}),
  };
  const collected = collectModifiers(state, passives, {
    roll: 'attack',
    filter: attackFilter,
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  // Проекция состояний цели на бросок атакующего (фаза E): атака по распластанному/
  // опутанному/ослеплённому/парализованному/ошеломлённому/без сознания — с преимуществом.
  // Дистанционный гейт (B/C): рукопашная/дальнобойная атака определяется по оружию в руке.
  const projected = projectedAgainst(
    ctx.target,
    'attack',
    attackRange,
    evalCtxOf(state, ctx),
    attackFilter,
  );
  const mods = [...attackAbilityMods(effect, ctx, hand, state), ...collected.modifiers, ...projected.modifiers];

  const roll = ctx.forcedAttackRoll
    ? retargetAttackRoll(ctx.forcedAttackRoll, ac)
    : rollD20({
    // C7: объединяем флаги обоих проходов — и преим., и помеха (свои + от цели) → none.
    advantage: foldAdvantage(
      collected.hasAdvantage || projected.hasAdvantage,
      collected.hasDisadvantage || projected.hasDisadvantage
        || Boolean(heavy?.valid && heavy.disadvantage),
    ),
    modifiers: mods,
    target: { type: 'ac', value: ac },
    rng: ctx.rng,
    rules: [...collected.rules, ...projected.rules], // свои правила + проекция цели (Blade Ward)
    });
  events.push(rollEvent('Атака', roll));

  let next = consumeNextRollEffects(state, 'attack', events, {
    filter: attackFilter,
    evalCtx: evalCtxOf(state, ctx),
  });
  if (targetRef.state) {
    const consumedTarget = consumeNextRollEffects(targetRef.state, 'attack', events, {
      scope: 'target',
      evalCtx: evalCtxOf(state, ctx),
    });
    if (consumedTarget !== targetRef.state) {
      targetRef.state = consumedTarget;
      targetRef.mutated = true;
    }
  }
  next = expireEffectsForTrigger(next, 'actor_makes_attack_roll', events);
  if (ctx.pauseAfterAttackRoll) return next;
  // on_roll-триггеры по значению кости (напр. «на 15 → парализовать цель») — не зависят от исхода.
  if (Array.isArray(roll.triggered) && roll.triggered.length) {
    next = applyPayloads(roll.triggered as Dict[], next, ctx, events, source, hand, false, whoTarget, targetRef);
  }

  // Автокрит (B): попадание рукопашной атакой по Парализованному/Без сознания — критическое.
  const outcome = roll.outcome === 'hit' && projected.autoCrit ? 'crit' : roll.outcome;
  if (roll.outcome === 'hit' && projected.autoCrit) {
    events.push(narrativeEvent('Автокрит: попадание вблизи становится критическим (состояние цели).'));
  }

  if (outcome === 'hit' || outcome === 'crit') {
    // При крите используем on_crit, если автор задал его явно (тогда он — истина, не удваиваем).
    // Иначе берём on_hit и удваиваем кости урона движком (PHB 2024: кости броска дважды).
    const useCritPayloads = outcome === 'crit' && Array.isArray(effect.on_crit);
    const payloads = (useCritPayloads ? effect.on_crit : effect.on_hit) as Dict[] | undefined;
    const critDouble = outcome === 'crit' && !useCritPayloads;
    const attackAbility = String(effect.ability);
    const attackWeaponMod = attackAbility === 'spellcasting'
      ? ctx.character.spellcastingMod!
      : attackAbility === 'auto'
        ? ctx.character.abilityMods[currentWeapon!.ability]
        : ctx.character.abilityMods[attackAbility as AbilityKey];
    const attackDamageFacts: AttackDamageQueryFacts = {
      attackKind: attackFacts.attackKind,
      extraAttackSource: extraAttackSourceFromEffect(
        effect, hand, ctx.character, state.equipment,
      ),
      weaponMod: attackWeaponMod,
      ...(attackFacts.attackKind === 'weapon' && currentWeapon ? {
        weaponCategory: attackRange ?? currentWeapon.defaultAttackMode,
        weaponHasThrownProperty: currentWeapon.properties.includes('thrown'),
        weaponWieldedInTwoHands: currentWeapon.properties.includes('two_handed')
          || (hand === 'main'
            && currentWeapon.properties.includes('versatile')
            && !state.equipment.off_hand),
        otherWeaponEquipped: Boolean(weaponContext(
          ctx.character,
          hand === 'main' ? 'off' : 'main',
          state.equipment,
          state,
        )),
      } : {}),
    };
    const damageEventStart = events.length;
    if (Array.isArray(payloads)) {
      next = applyPayloads(
        payloads,
        next,
        ctx,
        events,
        source,
        hand,
        false,
        whoTarget,
        targetRef,
        critDouble,
        attackDamageFacts,
      );
    }
    next = applyAttackDamageRiders(
      next,
      ctx,
      events,
      hand,
      targetRef,
      outcome === 'crit',
      attackDamageFacts,
    );
    const dealtDamage = events.slice(damageEventStart).some((entry) => (
      entry.type === 'damage' && entry.amount > 0
    ));
    // Искусность 2024 на попадании (Опрокидывающее/Ослабляющее/Замедляющее/Отвлекающее/
    // Отталкивающее/Рассекающее) — до райдеров события, чтобы её эффекты уже были в состоянии.
    next = runMastery(
      next,
      ctx,
      events,
      pending,
      targetRef,
      hand,
      'hit',
      deferredSaves,
      { attackRange, dealtDamage },
    );
    // Событие попадания → on-hit-райдеры: Скрытая атака (авто), Божественная кара /
    // Внезапный удар (предложение со стоимостью). Без timing — совпадает с любым.
    const declaredProperties = Array.isArray(effect.weapon_properties)
      ? (effect.weapon_properties as unknown[]).map(String)
      : [];
    next = emitEvent({
      kind: 'hit',
      source: 'self',
      data: {
        advantage: roll.advantage,
        attackRange: attackRange ?? 'unknown',
        weaponProperties: [...new Set([...(currentWeapon?.properties ?? []), ...declaredProperties])],
        nearbyEligibleAllyToTarget: ctx.attackFacts?.nearbyEligibleAllyToTarget === true,
        critical: outcome === 'crit',
      },
    }, next, ctx, events, pending, targetRef, deferredSaves);
    if (outcome === 'crit') next = emitEvent(
      { kind: 'crit', source: 'self' }, next, ctx, events, pending, targetRef, deferredSaves,
    );
  } else {
    // Промах: on_miss-райдеры (Graze/Vex — оружейное мастерство 2024) + событие miss.
    if (Array.isArray(effect.on_miss)) {
      next = applyPayloads(effect.on_miss as Dict[], next, ctx, events, source, hand, false, whoTarget, targetRef);
    }
    // Искусность на промахе: Задевающее (урон = модификатор характеристики атаки).
    next = runMastery(
      next,
      ctx,
      events,
      pending,
      targetRef,
      hand,
      'miss',
      deferredSaves,
      { attackRange, dealtDamage: false },
    );
    next = emitEvent(
      { kind: 'miss', source: 'self' }, next, ctx, events, pending, targetRef, deferredSaves,
    );
  }
  return next;
}

/**
 * Искусность оружия (Weapon Mastery, PHB 2024) на исходе броска атаки.
 * Мастерство берётся из оружия в руке (card.mastery) и работает, только если его ВИД выбран
 * персонажем (character.weaponMasteries) — см. engine/mastery.ts. Сама механика — данные эффекта,
 * поэтому просто исполняем её штатным runMechanicEffects по цели этой же атаки.
 * weapon_mod (модификатор характеристики атаки) прокидываем в формулы: от него зависят СЛ
 * Опрокидывающего и урон Задевающего.
 */
function runMastery(
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  pending: ReactionOffer[],
  targetRef: TargetRef,
  hand: 'main' | 'off',
  event: 'hit' | 'miss',
  deferredSaves: DeferredTargetSave[],
  facts: { attackRange?: 'melee' | 'ranged'; dealtDamage: boolean },
): RuntimeState {
  const m = activeMastery(ctx, state, hand, facts);
  if (!m || m.event !== event) return state;
  const effects = (m.mechanics.effects as Dict[] | undefined);
  if (!Array.isArray(effects) || !effects.length) return state;
  events.push(narrativeEvent(`Искусность: ${m.name}`));
  const mctx: ExecuteContext = {
    ...ctx,
    weaponMod: m.weaponMod,
    deferredSaveSource: {
      kind: 'weapon_mastery',
      entityId: m.id,
      name: m.name,
      weaponMod: m.weaponMod,
    },
  };
  return runMechanicEffects(
    effects, state, mctx, events, m.name, pending, targetRef, false, deferredSaves,
  );
}

// Состояния, которые сейв пытается ИЗБЕЖАТЬ: значения condition-пейлоадов из on_fail (урон/прочее
// пропускаем). Нужны предикату save_avoids_condition (напр. преимущество на спас против Очарования).
function savedConditionsOf(effect: Dict): string[] {
  const onFail = effect.on_fail;
  if (!Array.isArray(onFail)) return [];
  return (onFail as Dict[]).filter((p) => p.kind === 'condition' && p.value != null).map((p) => String(p.value));
}

function automaticSaveSuccessReason(
  effect: Dict,
  target: TargetContext | undefined,
): { reason: string; sourceEntityIds: string[] } | null {
  const declaration = effect.automatic_success;
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration) || !target) {
    return null;
  }
  const rule = declaration as Dict;
  if (rule.if_sleep_not_required === true && target.sleepRequired === false) {
    return {
      reason: 'существо не нуждается во сне',
      sourceEntityIds: [...(target.sleepTraitSourceEntityIds ?? [])],
    };
  }
  const requiredImmunity = typeof rule.if_condition_immunity === 'string'
    ? rule.if_condition_immunity.trim().toLowerCase() : '';
  if (requiredImmunity) {
    const immunity = target.conditionImmunities?.find((candidate) => (
      candidate.condition.trim().toLowerCase() === requiredImmunity
      && (candidate.requiredCauseTags ?? []).length === 0
    ));
    if (immunity) {
      return {
        reason: `иммунитет к состоянию «${requiredImmunity}»`,
        sourceEntityIds: [...immunity.sourceEntityIds],
      };
    }
  }
  return null;
}

function runSave(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  targetRef: TargetRef = { mutated: false },
  deferredSaves: DeferredTargetSave[] = [],
): RuntimeState {
  const whoTarget = String(effect.who ?? 'target') === 'target'
    && (!!targetRef.state || targetRef.aliasesSelf === true);
  const dcFormula = String(effect.dc);
  const dc = evalDc(dcFormula, ctx);
  const ability = String(effect.ability) as AbilityKey;
  const automaticSuccess = automaticSaveSuccessReason(effect, ctx.target);
  if (automaticSuccess) {
    events.push(narrativeEvent(
      `Спасбросок ${ABILITY_LABEL[ability]} — автоуспех: ${automaticSuccess.reason}.`
      + (automaticSuccess.sourceEntityIds.length
        ? ` Источники: ${automaticSuccess.sourceEntityIds.join(', ')}.` : ''),
    ));
    const automaticPayloads = effect.on_success as Dict[] | undefined;
    return Array.isArray(automaticPayloads)
      ? applyPayloads(
          automaticPayloads,
          state,
          ctx,
          events,
          source,
          'main',
          automaticPayloads.some((payload) => payload.on_success === 'half'),
          whoTarget,
          targetRef,
        )
      : state;
  }
  if (ctx.deferTargetSaves && whoTarget && targetRef.state && ctx.deferredSaveSource) {
    deferredSaves.push({
      source: { ...ctx.deferredSaveSource },
      effect: { ...effect },
      ability,
      dc,
      avoidsConditions: savedConditionsOf(effect),
    });
    return state;
  }
  // Спасбросок совершает ЦЕЛЬ своими модификаторами/преимуществом — НЕ атакующий.
  // Берём эффекты из рантайма цели (богатая цель, фаза E); у обобщённой цели их нет.
  // evalCtx с savedConditions гейтит модификаторы «преимущество/бонус на спас против состояния X»
  // (Происхождение фей). Раньше сейв не передавал evalCtx — condition-scoped when не срабатывал.
  const targetState = ctx.target?.runtimeState;
  const collected = targetState
    ? collectModifiers(targetState, [], {
        roll: 'saving_throw', filter: { ability },
        evalCtx: { state: targetState, activeConditions: activeConditionsOf(targetState), savedConditions: new Set(savedConditionsOf(effect)) },
      })
    : { modifiers: [] as RollModifier[], advantage: 'none' as const, autoFail: false, rules: [] as Dict[] };

  let success: boolean;
  if (ctx.forceSaveOutcome != null) {
    // Онлайн-бой: исход форсирован (предрасчёт для передачи цели). d20 НЕ катим — иначе съели бы
    // из ctx.rng кости урона; событие спасброска не эмитим — бросок сделает цель на своём листе.
    success = ctx.forceSaveOutcome === 'success';
  } else if (collected.autoFail) {
    // Автопровал (A): Парализован/Ошеломлён/Без сознания автоматически проваливают спас СИЛ/ЛВК.
    // d20 не катим (не тратим кости урона), фиксируем провал.
    events.push(narrativeEvent(`Спасбросок ${ABILITY_LABEL[ability]} — автопровал (состояние цели).`));
    success = false;
  } else {
    const saveMod = targetSaveMod(ctx.target, ability);
    const roll = rollD20({
      advantage: collected.advantage,
      modifiers: [{ value: saveMod, source: 'цель' }, ...collected.modifiers],
      target: { type: 'dc', value: dc },
      rng: ctx.rng,
      rules: collected.rules,
    });
    events.push(rollEvent('Спасбросок', { ...roll, kind: 'save' }));
    // Планирующий прогон: берём ветку провала, чтобы кости on_fail-урона попали в план кубов
    // (иначе при высоком PLANNING_RNG цель успевает спастись и урон не планируется → #8).
    success = ctx.planning ? false : roll.outcome === 'success';
  }
  let next = state;
  if (targetState && targetRef.state) {
    const consumedTarget = consumeNextRollEffects(targetRef.state, 'saving_throw', events, {
      filter: { ability },
      evalCtx: {
        state: targetRef.state,
        activeConditions: activeConditionsOf(targetRef.state),
        savedConditions: new Set(savedConditionsOf(effect)),
      },
    });
    if (consumedTarget !== targetRef.state) {
      targetRef.state = consumedTarget;
      targetRef.mutated = true;
    }
  } else {
    next = consumeNextRollEffects(next, 'saving_throw', events, {
      filter: { ability },
      evalCtx: evalCtxOf(next, ctx),
    });
  }

  const payloads = (success ? effect.on_success : effect.on_fail) as Dict[] | undefined;
  if (!Array.isArray(payloads)) return next;

  const half = success && payloads.some((p) => p.on_success === 'half');
  return applyPayloads(payloads, next, ctx, events, source, 'main', half, whoTarget, targetRef);
}

// readTargetSave — параметры форсируемого спасброска ЦЕЛИ из механики действия (ability, DC, half).
// DC считается в контексте КАСТЕРА (8 + БМ + модификатор заклинания). Нужен, чтобы передать цели
// pending-спасбросок в онлайн-бою: цель кинет d20 сама и сравнит со своей СЛ. null — сейва цели нет.
export function readTargetSave(mechanics: Dict, ctx: ExecuteContext): {
  ability: string;
  dc: number;
  half: boolean;
  avoidsConditions: string[];
  automaticSuccess?: { reason: string; sourceEntityIds: string[] };
} | null {
  const effects = mechanics.effects as Dict[] | undefined;
  if (!Array.isArray(effects)) return null;
  const effectIndex = effects.findIndex((effect) => (
    String(effect.resolution ?? '') === 'save' && String(effect.who ?? 'target') === 'target'
  ));
  if (effectIndex < 0) return null;
  const eff = effects[effectIndex];
  const path = `mechanics.effects[${effectIndex}]`;
  const ability = explicitAbility(
    eff.ability,
    `${path}.ability`,
    ABILITY_KEYS,
    'save resolution',
  );
  explicitPositiveDc(eff.dc, `${path}.dc`, ctx);
  const dc = evalDc(String(eff.dc), ctx);
  const half = Array.isArray(eff.on_success) && (eff.on_success as Dict[]).some((p) => p.on_success === 'half');
  // Состояния, которые сейв позволяет избежать — цель применит condition-scoped модификаторы (Происхождение фей).
  const automaticSuccess = automaticSaveSuccessReason(eff, ctx.target);
  return {
    ability,
    dc,
    half,
    avoidsConditions: savedConditionsOf(eff),
    ...(automaticSuccess ? { automaticSuccess } : {}),
  };
}

function runAbilityCheck(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  const ability = String(effect.ability) as AbilityKey;
  const skill = String(effect.skill ?? '');
  // C12: бонус мастерства — ТОЛЬКО при владении навыком (экспертиза ×2). «Голая» проверка
  // характеристики (без skill) бонус мастерства не получает — раньше он прибавлялся безусловно.
  const prof = skill && ctx.character.skillExpertise?.includes(skill)
    ? ctx.character.profBonus * 2
    : skill && ctx.character.skillProficiencies?.includes(skill)
      ? ctx.character.profBonus
      : 0;
  const attackerTotal = ctx.character.abilityMods[ability] + prof;
  const sense = String(effect.requires_sense ?? effect.sense ?? '');
  const checkFilter: ModifierQueryFacts = {
    ability,
    ...(skill ? { skill } : {}),
    ...(sense === 'sight' || sense === 'hearing' ? { sense } : {}),
  };
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'ability_check',
    filter: checkFilter,
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  let next = state;
  let success: boolean;
  if (collected.autoFail) {
    // Sight/hearing requirements are explicit action facts. A matching
    // condition declares auto_fail; the executor consumes neither RNG nor a
    // "next roll" effect because no D20 Test occurred.
    events.push(narrativeEvent(
      `Проверка${sense ? ` (${sense})` : ''} — автопровал (состояние).`,
    ));
    success = false;
  } else {
    const attRoll = rollD20({
      advantage: collected.advantage,
      modifiers: [
        { value: attackerTotal, source: skill || ABILITY_LABEL[ability] },
        ...collected.modifiers,
      ],
      ...(effect.dc == null ? {} : { target: { type: 'dc' as const, value: evalDc(String(effect.dc), ctx) } }),
      rng: ctx.rng,
      rules: collected.rules,
    });
    events.push(rollEvent(skill ? `Проверка (${skill})` : 'Проверка', { ...attRoll, kind: 'check' }));
    next = consumeNextRollEffects(state, 'ability_check', events, {
      filter: checkFilter,
      evalCtx: evalCtxOf(state, ctx),
    });

    // Исход: против явно объявленной СЛ или явно объявленного набора защитных навыков.
    if (effect.dc != null) {
      success = attRoll.total >= evalDc(String(effect.dc), ctx);
    } else {
      // RAW 2024: цель ВЫБИРАЕТ одну защитную характеристику (Атлетика ИЛИ Акробатика) — берёт
      // выгоднейшую по модификатору — и совершает ОДИН бросок.
      const contestVs = effect.contest_vs as string[];
      const checkMods = ctx.target!.checkMods!;
      const defSkill = contestVs.reduce(
        (best, candidate) => (checkMods[candidate] > checkMods[best] ? candidate : best),
        contestVs[0],
      );
      const defMod = checkMods[defSkill];
      const defRoll = rollD20({ modifiers: [{ value: defMod, source: defSkill }], rng: ctx.rng });
      events.push(rollEvent(`Ответ (${defSkill})`, { ...defRoll, kind: 'check' }));
      success = attRoll.total > defRoll.total;
    }
  }

  if (!success) return next;
  // C12: исход успеха идёт через общий роутер payload-ов — состояние (Толчок → prone),
  // перемещение, нарратив. who:'target' направляет состояние ЦЕЛИ, а не исполнителю.
  const onSuccess = effect.on_success as Dict[] | undefined;
  if (!Array.isArray(onSuccess)) return next;
  const whoTarget = String(effect.who ?? 'target') === 'target'
    && (!!targetRef.state || targetRef.aliasesSelf === true);
  return applyPayloads(onSuccess, next, ctx, events, source, 'main', false, whoTarget, targetRef);
}

/**
 * Исполнить список interactions механики (auto/attack_roll/save/ability_check).
 * Основное действие проходит строгий preflight до оплаты; ошибки динамически
 * подключённых слушателей также остаются typed/fail-closed, а не становятся
 * успешным narrative-only применением.
 */
function runMechanicEffects(
  effects: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  sourceName: string,
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
  criticalDamage = false,
  deferredSaves: DeferredTargetSave[] = [],
): RuntimeState {
  let next = state;
  for (const eff of effects) {
    const resolution = String(eff.resolution ?? '');
    try {
      // Ярус 1.2: choice как самостоятельная интеракция действия — через общий роутер payload-ов
      // (там case 'choice' развернёт выбор из ctx.choices). Иначе бы упал в NOT_IMPLEMENTED resolution.
      if (eff.kind === 'choice') {
        const whoTarget = String(eff.who ?? 'self') === 'target'
          && (!!targetRef.state || targetRef.aliasesSelf === true);
        next = applyPayloads([eff], next, ctx, events, sourceName, 'main', false, whoTarget, targetRef);
        continue;
      }
      if (resolution === 'auto') {
        const results = (eff.result ?? eff.results) as Dict[] | undefined;
        if (Array.isArray(results)) {
          const whoTarget = String(eff.who ?? 'self') === 'target'
            && (!!targetRef.state || targetRef.aliasesSelf === true);
          next = applyPayloads(results, next, ctx, events, sourceName, 'main', false, whoTarget, targetRef, criticalDamage);
        }
        continue;
      }
      if (resolution === 'attack_roll') {
        next = runAttackRoll(eff, next, ctx, events, sourceName, pending, targetRef, deferredSaves);
        continue;
      }
      if (resolution === 'save') {
        next = runSave(eff, next, ctx, events, sourceName, targetRef, deferredSaves);
        continue;
      }
      if (resolution === 'ability_check') { next = runAbilityCheck(eff, next, ctx, events, sourceName, targetRef); continue; }
      throw mechanicsError(
        'UNKNOWN_RESOLUTION',
        'runtime.effect.resolution',
        `executor does not own resolution «${resolution || '?'}»`,
      );
    } catch (e) {
      if (e instanceof MissingVariableError) {
        throw mechanicsError(
          'INVALID_FORMULA',
          'runtime.effect.formula',
          `variable «${e.variable}» is unavailable for effect «${sourceName}»`,
          e,
        );
      }
      if (e instanceof FormulaError) {
        throw mechanicsError(
          'INVALID_FORMULA',
          'runtime.effect.formula',
          `effect «${sourceName}» cannot be evaluated: ${e.message}`,
          e,
        );
      }
      throw e;
    }
  }
  return next;
}

/**
 * Диспетчер события (фаза A): находит слушателей, авто-триггеры исполняет сразу
 * (с гейтом uses.per:"turn"), а реакции/триггеры со стоимостью складывает в pending
 * для решения игрока. Возвращает изменённое состояние.
 */
/**
 * Словарь событий шины (C3). Единый источник истины: EMITTED — события, которые движок
 * реально диспатчит из своих путей; PLANNED — валидные по схеме, но пока не эмитятся
 * (с указанием причины ниже). Контрактный тест (eventBusContract.test.ts) сверяет
 * union(EMITTED, PLANNED) с enum схемы: новое событие обязано попасть в один из списков.
 */
export const EMITTED_EVENTS = [
  'hit', 'crit', 'damage_taken', 'miss', 'spell_cast', 'reduced_to_0_hp',
  // Ход и отдыхи через шину (C3 слайс 2 — turn.ts startTurn/endTurn/shortRest/longRest):
  'turn_start', 'turn_end', 'short_rest', 'long_rest',
] as const;

export const PLANNED_EVENTS = [
  // Требуют конвейера стадий атаки/урона (отдельные точки эмиссии):
  'attack_roll_made', 'hit_by_attack', 'damage_dealt', 'saving_throw_made', 'forced_save', 'ability_check_made',
  // Требуют многоактора/EncounterState (позиции, дистанции) — вне текущей модели:
  'creature_enters_reach', 'creature_leaves_reach', 'creature_moves',
  // Прочее (условия/инициатива/приобретение/уровень) — отдельные слайсы:
  'condition_applied', 'initiative_roll', 'on_acquire', 'level_gained',
] as const;

// C4: страховка каскада событий (emitEvent → механика слушателя → снова emitEvent). Бюджет на ОДНО
// верхнеуровневое действие / получение урона; при превышении дальнейшие триггеры не запускаются — это
// жёстко исключает стек-оверфлоу от зацикленного on-hit-контента (напр. слушатель, атакующий по своему
// же hit). Ключ — объект ctx (свой на каждое действие); beginCascade обнуляет на входе (защита от
// переиспользования ctx между вызовами). Бюджет по СУММЕ эмиссий ⇒ ограничивает и глубину рекурсии.
const MAX_EVENT_CASCADE = 16;
const cascadeBudget = new WeakMap<object, { n: number; warned: boolean }>();

function beginCascade(ctx: ExecuteContext): void {
  cascadeBudget.set(ctx, { n: 0, warned: false });
}

function cascadeAllows(ctx: ExecuteContext, events: EngineEvent[]): boolean {
  let b = cascadeBudget.get(ctx);
  if (!b) { b = { n: 0, warned: false }; cascadeBudget.set(ctx, b); }
  b.n += 1;
  if (b.n > MAX_EVENT_CASCADE) {
    if (!b.warned) {
      b.warned = true;
      events.push(narrativeEvent(`Каскад событий превысил лимит (${MAX_EVENT_CASCADE}) — дальнейшие триггеры остановлены во избежание зацикливания.`));
    }
    return false;
  }
  return true;
}

export function emitEvent(
  ev: DomainEvent,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
  deferredSaves: DeferredTargetSave[] = [],
): RuntimeState {
  // Слушатели: пассивки + отдельный пул триггерных способностей (ctx.triggers — заклинания-реакции
  // вроде Божественной кары; их не читает collectModifiers, чтобы не применять эффект пассивно).
  const triggers = (ctx as ExecuteContext & { triggers?: Dict[] }).triggers ?? [];
  const listeners = collectListeners(ev, state, [...passivesFromCtx(ctx), ...triggers], evalCtxOf(state, ctx));
  if (!listeners.length) return state; // нет слушателей → рекурсии быть не может → бюджет не тратим
  // C4: бюджет жжём только на эмиссии СО слушателями (лишь они способны углубить рекурсию), иначе
  // широкое линейное действие (многолучевое заклинание без триггеров) ловило бы ложный лимит.
  if (!cascadeAllows(ctx, events)) return state;

  let next = state;
  for (const lm of listeners) {
    if (!isAuto(lm)) { pending.push(toOffer(lm, ev)); continue; }
    const per = lm.usesPer;
    // Гейт «уже сработал в этом периоде»: per:'turn' — firedThisTurn (сброс в startTurn); любой иной
    // период (long_rest/short_rest/day/…) — firedThisRest (сброс в longRest), иначе «раз за отдых»-триггер
    // (Неумолимая стойкость → hp=1) срабатывал бы бесконечно. firedThisTurn/Rest читаем СВЕЖИМ на каждой
    // итерации (C4: вложенный каскад мог обновить), помечаем и коммитим ДО запуска механики.
    const firedTurn = new Set(next.firedThisTurn ?? []);
    const firedRest = new Set(next.firedThisRest ?? []);
    if (per === 'turn' && firedTurn.has(lm.id)) continue;
    if (per && per !== 'turn' && firedRest.has(lm.id)) continue;
    if (per === 'turn') {
      firedTurn.add(lm.id);
      next = { ...next, firedThisTurn: [...firedTurn] };
    } else if (per) {
      firedRest.add(lm.id);
      next = { ...next, firedThisRest: [...firedRest] };
    }
    const effs = (lm.mechanics.effects as Dict[]) ?? [];
    if (effs.length) {
      events.push(narrativeEvent(`Сработало: ${lm.name}`));
      const listenerCtx: ExecuteContext = lm.formulaVariables
        ? {
          ...ctx,
          character: {
            ...ctx.character,
            variables: {
              ...(ctx.character.variables ?? {}),
              ...lm.formulaVariables,
            },
          },
        }
        : ctx;
      next = runMechanicEffects(
        effs,
        next,
        listenerCtx,
        events,
        lm.name,
        pending,
        targetRef,
        ev.kind === 'hit' && ev.data?.critical === true,
        deferredSaves,
      );
    }
  }
  return next;
}

function mechanicsHasResolution(mechanics: Dict, resolution: string): boolean {
  return Array.isArray(mechanics.effects) && mechanics.effects.some((effect) => (
    isDict(effect) && effect.resolution === resolution
  ));
}

function mechanicsTargetsArea(mechanics: Dict): boolean {
  const targeting = mechanics.targeting;
  if (!isDict(targeting)) return false;
  const shape = String(targeting.shape ?? '');
  return targeting.domain === 'area'
    || ['area', 'cone', 'cube', 'cylinder', 'line', 'sphere', 'emanation'].includes(shape)
    || isDict(targeting.area);
}

function resolveTargetingWard(
  state: RuntimeState,
  targetState: RuntimeState | undefined,
  mechanics: Dict,
  ctx: ExecuteContext,
): { blocked: boolean; events: EngineEvent[] } {
  if (!targetState) return { blocked: false, events: [] };
  const attackRoll = mechanicsHasResolution(mechanics, 'attack_roll');
  const damagingSpell = ctx.spell != null
    && mechanicsContainsPayloadKind(mechanics, 'damage')
    && !mechanicsTargetsArea(mechanics);
  if (!attackRoll && !damagingSpell) return { blocked: false, events: [] };

  const ward = activePayloadEntries(targetState, 'targeting_ward').find(({ payload }) => {
    const protects = Array.isArray(payload.protects) ? payload.protects.map(String) : [];
    return (attackRoll && protects.includes('attack_roll'))
      || (damagingSpell && protects.includes('damaging_spell'));
  });
  if (!ward) return { blocked: false, events: [] };

  const ability = String(ward.payload.save_ability) as AbilityKey;
  const base = explicitCharacterAbilityModifier(ctx, ability)
    + (ctx.character.saveProficiencies?.includes(ability)
      ? explicitCharacterProficiencyBonus(ctx)
      : 0);
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'saving_throw',
    filter: { ability },
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  const dc = Number(ward.payload.dc);
  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [{ value: base, source: ABILITY_LABEL[ability] }, ...collected.modifiers],
    rules: collected.rules,
    target: { type: 'dc', value: dc },
    rng: ctx.rng,
  });
  const events: EngineEvent[] = [
    rollEvent(`${ward.entry.name}: спасбросок ${ABILITY_LABEL[ability]} (СЛ ${dc})`, {
      ...roll, kind: 'save',
    }),
  ];
  if (roll.outcome === 'success') return { blocked: false, events };
  events.push(narrativeEvent(
    `${ward.entry.name}: цель нельзя атаковать; выберите новую цель или потеряйте атаку/заклинание.`,
  ));
  return { blocked: true, events };
}

function emitSpellCastLifecycle(
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  pending: ReactionOffer[],
  targetRef: TargetRef,
  deferredSaves: DeferredTargetSave[],
): RuntimeState {
  if (!ctx.spell || ctx.suppressSpellCastEvent) return state;
  let next = emitEvent(
    { kind: 'spell_cast', source: 'self', data: { level: ctx.spell.castLevel ?? ctx.spell.baseLevel } },
    state, ctx, events, pending, targetRef, deferredSaves,
  );
  next = expireEffectsForTrigger(next, 'actor_casts_spell', events);
  if (ctx.spell.components?.verbal === true) {
    next = expireEffectsForTrigger(next, 'actor_casts_spell_with_verbal_component', events);
  }
  return next;
}

export function executeAction(
  state: RuntimeState,
  mechanics: Dict,
  ctx: ExecuteContext,
): ExecuteResult {
  const cost = preflightMechanicsExecution(state, mechanics, ctx);
  beginCascade(ctx); // C4: свежий бюджет каскада событий на это действие
  let next = cloneState(state);
  const events: EngineEvent[] = [];
  const pending: ReactionOffer[] = [];
  const deferredSaves: DeferredTargetSave[] = [];
  // Состояние ОТДЕЛЬНОЙ цели (C2): клон (не мутируем объект вызывающего). Для self-target
  // отдельная ветка недопустима: она потеряла бы уже оплаченную стоимость source-state, когда
  // handler сведёт две мутации одного actor id. Поэтому who:'target' для самого исполнителя
  // штатно пишет в `next`, а для другого существа — в targetRef.
  const hasSeparateTarget = ctx.target?.runtimeState != null
    && !(ctx.selfId != null && ctx.target.id === ctx.selfId);
  const aliasesSelf = ctx.selfId != null && ctx.target?.id === ctx.selfId;
  const targetRef: TargetRef = {
    state: hasSeparateTarget ? cloneState(ctx.target!.runtimeState!) : undefined,
    mutated: false,
    aliasesSelf,
  };

  if (cost.length) {
    const check = canPay(next, cost);
    if (!check.ok) throw new InsufficientResourcesError(check.missing);
    const paid = pay(next, cost);
    next = paid.state;
    events.push(...paid.events);
  }

  const targetStateForWard = targetRef.aliasesSelf
    ? next
    : targetRef.state ?? ctx.target?.runtimeState;
  const ward = resolveTargetingWard(next, targetStateForWard, mechanics, ctx);
  events.push(...ward.events);
  if (ward.blocked) {
    next = emitSpellCastLifecycle(next, ctx, events, pending, targetRef, deferredSaves);
    return {
      state: next,
      events,
      ...(pending.length ? { pendingReactions: pending } : {}),
      ...(deferredSaves.length ? { deferredTargetSaves: deferredSaves } : {}),
    };
  }

  const effects = mechanics.effects as Dict[] | undefined;
  if (Array.isArray(effects)) {
    const sourceName = String(ctx.actionName ?? mechanics.name ?? 'действие');
    next = runMechanicEffects(
      effects, next, ctx, events, sourceName, pending, targetRef, false, deferredSaves,
    );
  }

  if (events.some((event) => event.type === 'damage' && event.amount > 0)) {
    next = expireEffectsForTrigger(next, 'actor_deals_damage', events);
  }

  // Событие «сотворено заклинание» → триггеры на каст (напр. отклик оружия/предмета).
  // Активируется, когда лист/кузня передают ctx.spell (пикер уровня слота — D1 слайс 2);
  // до этого не фигурирует (аддитивно, без изменения текущего поведения).
  next = emitSpellCastLifecycle(next, ctx, events, pending, targetRef, deferredSaves);

  void (ctx.character as CharacterContext);
  return {
    state: next,
    events,
    ...(pending.length ? { pendingReactions: pending } : {}),
    ...(deferredSaves.length ? { deferredTargetSaves: deferredSaves } : {}),
    ...(targetRef.mutated ? { targetState: targetRef.state } : {}),
  };
}

function mechanicsContainsPayloadKind(mechanics: Dict, kind: string): boolean {
  return payloadsOf(mechanics).some((payload) => payload.kind === kind)
    || (Array.isArray(mechanics.effects) && mechanics.effects.some((effect) => (
      isDict(effect) && ['result', 'results', 'on_hit', 'on_crit', 'on_miss', 'on_fail', 'on_success']
        .some((key) => Array.isArray(effect[key])
          && (effect[key] as unknown[]).some((payload) => isDict(payload) && payload.kind === kind))
    )));
}

/** Resolve automatic once-per-turn damage reducers before HP changes. This is
 * the reusable bridge used by Resistance and future typed wards; optional
 * reactions remain owned by the sheet/encounter decision UI. */
function resolveAutomaticDamageReductions(
  state: RuntimeState,
  amount: number,
  damageType: string,
  ctx: ExecuteContext,
): { state: RuntimeState; events: EngineEvent[]; reduction: number } {
  if (amount <= 0) return { state, events: [], reduction: 0 };
  let next = state;
  const events: EngineEvent[] = [];
  let reduction = 0;
  const event: DomainEvent = {
    kind: 'damage_taken',
    timing: 'before',
    source: 'self',
    data: { amount, damageType },
  };
  const listeners = collectListeners(event, next, passivesFromCtx(ctx), evalCtxOf(next, ctx));
  for (const listener of listeners) {
    if (!isAuto(listener) || listener.usesPer !== 'turn'
      || !mechanicsContainsPayloadKind(listener.mechanics, 'reduce_damage')) continue;
    const fired = new Set(next.firedThisTurn ?? []);
    if (fired.has(listener.id)) continue;
    fired.add(listener.id);
    next = { ...next, firedThisTurn: [...fired] };

    const listenerCtx: ExecuteContext = listener.formulaVariables
      ? {
        ...ctx,
        character: {
          ...ctx.character,
          variables: {
            ...(ctx.character.variables ?? {}),
            ...listener.formulaVariables,
          },
        },
      }
      : ctx;
    const before = events.length;
    events.push(narrativeEvent(`Сработало: ${listener.name}`));
    const targetRef: TargetRef = { mutated: false };
    next = runMechanicEffects(
      (listener.mechanics.effects as Dict[]) ?? [],
      next,
      listenerCtx,
      events,
      listener.name,
      [],
      targetRef,
      false,
      [],
    );
    reduction += events.slice(before).reduce((sum, candidate) => (
      candidate.type === 'damage_reduction' ? sum + candidate.amount : sum
    ), 0);
  }
  return { state: next, events, reduction };
}

/**
 * Применить ВХОДЯЩИЙ урон к владельцу листа (фаза A/E): списывает временные, затем
 * текущие хиты; при активной концентрации — авто-проверка ТЕЛ (СЛ по 2024, помеха при
 * крите); эмитит damage_taken → реакции (Адское возмездие и т.п.) как pendingReactions.
 */
export function applyIncomingDamage(
  state: RuntimeState,
  amount: number,
  ctx: ExecuteContext,
  opts?: {
    crit?: boolean;
    damageType?: string;
    conSaveBonus?: number;
    damageReduction?: number;
    roll?: import('../mvp/contracts').RollLog;
  },
): ExecuteResult {
  beginCascade(ctx); // C4: свежий бюджет каскада событий на это получение урона
  let next = cloneState(state);
  const events: EngineEvent[] = [];
  const pending: ReactionOffer[] = [];

  const raw = Math.max(0, Math.floor(amount));
  const damageType = opts?.damageType ?? 'урон';
  // Сопротивление/иммунитет/уязвимость цели (фаза E) — применяется при получении урона.
  const resistanceRule = resistanceRuleFor(next, ctx, damageType);
  const level = resistanceRule.level;
  const resisted = applyResistance(raw, level);
  if (level && resisted !== raw) {
    const label = level === 'immunity' ? 'иммунитет' : level === 'resistance' ? 'сопротивление' : 'уязвимость';
    const damageLabel = getDamageLabel(damageType).toLocaleLowerCase('ru-RU');
    events.push({
      type: 'narrative',
      text: `${label} (${damageLabel}): ${raw} → ${resisted}`,
      damageAdjustment: {
        damageType,
        adjustment: level as 'resistance' | 'immunity' | 'vulnerability',
        before: raw,
        after: resisted,
        sourceEntityIds: resistanceRule.sourceEntityIds,
      },
    });
  }
  const automaticReduction = resolveAutomaticDamageReductions(next, resisted, damageType, ctx);
  next = automaticReduction.state;
  events.push(...automaticReduction.events);
  // Снижение урона (Каменная стойкость) — ПОСЛЕ сопротивления, ДО списания хитов. Урон не может
  // уйти ниже 0. Так HP не проседает (нет ложных «Окровален»/падения до 0), и это НЕ лечение.
  const reduction = Math.max(0, Math.floor(
    (opts?.damageReduction ?? 0) + automaticReduction.reduction,
  ));
  const dmg = Math.max(0, resisted - reduction);
  if (reduction > 0) {
    events.push(narrativeEvent(`Снижение урона: ${resisted} → ${dmg} (−${Math.min(reduction, resisted)})`));
  }
  const absorbed = Math.min(next.hp.temp, dmg);
  next.hp.temp -= absorbed;
  next.hp.current = Math.max(0, next.hp.current - (dmg - absorbed));
  events.push(damageEvent(dmg, damageType, opts?.roll));
  if (dmg > 0) {
    next = expireEffectsForTrigger(next, 'actor_takes_damage', events);
  }

  // Авто-проверка концентрации при уроне.
  const conc = concentrationEntry(next);
  // При предрасчёте исходов боя (forceSaveOutcome) проверку концентрации НЕ катим: она тоже тянет
  // d20 из ctx.rng и, не будучи в плане кубов, сдвинула бы кости урона. Разрыв концентрации цели —
  // её отдельная забота (не моделируем в предрасчёте pending-спасброска).
  if (conc && dmg > 0 && ctx.forceSaveOutcome == null) {
    const dc = concentrationDC(dmg);
    const collected = collectModifiers(next, passivesFromCtx(ctx), {
      roll: 'saving_throw', filter: { ability: 'con' },
      formulaCtx: formulaCtx(ctx), evalCtx: evalCtxOf(next, ctx),
    });
    // Базовый модификатор проверки концентрации: полный бонус ТЕЛ-спасброска (мод +
    // владение), если лист его передал (важно для сорсереров), иначе только мод.
    const conMod = opts?.conSaveBonus ?? (ctx.character.abilityMods.con ?? 0);
    const advantage = opts?.crit
      ? (collected.advantage === 'advantage' ? 'none' : 'disadvantage')
      : collected.advantage;
    const roll = rollD20({
      advantage,
      modifiers: [{ value: conMod, source: 'ТЕЛ' }, ...collected.modifiers],
      target: { type: 'dc', value: dc },
      rng: ctx.rng,
    });
    events.push(rollEvent(`Концентрация (СЛ ${dc})`, { ...roll, kind: 'save' }));
    if (roll.outcome !== 'success') {
      const dropped = dropConcentration(next, `провал спасброска СЛ ${dc}`);
      next = dropped.state;
      events.push(...dropped.events);
    }
  }

  // Событие получения урона → реакции (Адское возмездие, Невероятное уклонение…).
  next = emitEvent({
    kind: 'damage_taken',
    source: 'self',
    data: { amount: dmg, damageType },
  }, next, ctx, events, pending);

  // Падение до 0 HP → триггеры «при 0 HP» (напр. Отчаянная стойкость, срабатывания черт).
  // Гейт «был >0, стал 0» — чтобы не дублировать эмиссию на добивании уже бессознательного.
  if (next.hp.current === 0 && state.hp.current > 0) {
    next = emitEvent({ kind: 'reduced_to_0_hp', source: 'self' }, next, ctx, events, pending);
  }

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

function activePayloadEntries(state: RuntimeState, kind: string): Array<{
  entry: ActiveEffectEntry;
  payload: Dict;
}> {
  return state.activeEffects.flatMap((entry) => payloadsOf(entry.mechanics as Dict)
    .filter((payload) => payload.kind === kind)
    .map((payload) => ({ entry, payload })));
}

export interface RemoteManipulatorCommand {
  operation: string;
  distanceFt: number;
  objectWeightLb?: number;
  moveDistanceFt?: number;
  parameters?: Dict;
}

/** Spend a Magic action to control a persisted remote manipulator. The world
 * adapter applies the structured interaction to the selected object. */
export function executeRemoteManipulator(
  state: RuntimeState,
  command: RemoteManipulatorCommand,
): ExecuteResult {
  const active = activePayloadEntries(state, 'remote_manipulator')[0];
  if (!active) {
    throw mechanicsError('INVALID_MECHANICS', 'remote_manipulator', 'no active remote manipulator exists');
  }
  const allowed = Array.isArray(active.payload.allowed_operations)
    ? active.payload.allowed_operations.map(String)
    : [];
  const forbidden = Array.isArray(active.payload.forbidden_operations)
    ? active.payload.forbidden_operations.map(String)
    : [];
  if (!allowed.includes(command.operation) || forbidden.includes(command.operation)) {
    throw mechanicsError('INVALID_MECHANICS', 'remote_manipulator.operation', 'operation is not permitted');
  }
  if (!Number.isFinite(command.distanceFt) || command.distanceFt < 0
    || command.distanceFt > Number(active.payload.max_distance_ft)) {
    throw mechanicsError('INVALID_MECHANICS', 'remote_manipulator.distanceFt', 'object is outside control range');
  }
  const objectWeight = command.objectWeightLb ?? 0;
  if (!Number.isFinite(objectWeight) || objectWeight < 0
    || objectWeight > Number(active.payload.max_load_lb)) {
    throw mechanicsError('INVALID_MECHANICS', 'remote_manipulator.objectWeightLb', 'object exceeds load limit');
  }
  const moveDistance = command.moveDistanceFt ?? 0;
  if (!Number.isFinite(moveDistance) || moveDistance < 0
    || moveDistance > Number(active.payload.move_per_action_ft)) {
    throw mechanicsError('INVALID_MECHANICS', 'remote_manipulator.moveDistanceFt', 'movement exceeds per-action limit');
  }
  const payment = canPay(state, [{ resource: 'action', amount: 1 }]);
  if (!payment.ok) throw new InsufficientResourcesError(payment.missing);
  const paid = pay(state, [{ resource: 'action', amount: 1 }]);
  return {
    state: paid.state,
    events: [
      ...paid.events,
      {
        type: 'world_interaction',
        operation: command.operation,
        parameters: {
          ...(command.parameters ?? {}),
          distance_ft: command.distanceFt,
          object_weight_lb: objectWeight,
          move_distance_ft: moveDistance,
        },
        source: active.entry.name,
      },
    ],
  };
}

export interface CommunicationLinkFacts {
  distanceFt: number;
  magicalSilence?: boolean;
  barrier?: { material: 'stone' | 'metal' | 'wood' | 'lead'; thicknessFt: number };
}

/** Validate delivery/reply against the link's explicit range and blockers. */
export function resolveCommunicationLink(
  state: RuntimeState,
  facts: CommunicationLinkFacts,
  mode: 'message' | 'reply' = 'reply',
): ExecuteResult {
  const active = activePayloadEntries(state, 'communication_link')[0];
  if (!active) {
    throw mechanicsError('INVALID_MECHANICS', 'communication_link', 'no active communication link exists');
  }
  if (!Number.isFinite(facts.distanceFt) || facts.distanceFt < 0
    || facts.distanceFt > Number(active.payload.range_ft)) {
    throw mechanicsError('INVALID_MECHANICS', 'communication_link.distanceFt', 'recipient is outside range');
  }
  const blockers = active.payload.blockers as Dict;
  if (facts.magicalSilence && blockers.magical_silence === true) {
    throw mechanicsError('INVALID_MECHANICS', 'communication_link.magicalSilence', 'magical silence blocks the link');
  }
  if (facts.barrier) {
    const limits = isDict(blockers.max_thickness_ft) ? blockers.max_thickness_ft : {};
    const limit = Number(limits[facts.barrier.material]);
    if (Number.isFinite(limit) && facts.barrier.thicknessFt >= limit) {
      throw mechanicsError('INVALID_MECHANICS', 'communication_link.barrier', 'barrier blocks the link');
    }
  }
  return {
    state: cloneState(state),
    events: [{
      type: 'communication',
      mode,
      sourceActorId: mode === 'reply' ? active.entry.ownerId : active.entry.sourceId,
      targetActorId: mode === 'reply' ? active.entry.sourceId : active.entry.ownerId,
      private: true,
    }],
  };
}

export interface IllusionInspectionFacts {
  physicalInteraction?: boolean;
  investigationTotal?: number;
}

/** Resolve an observation against a persisted illusion. The caller supplies
 * observable contact or a completed Investigation total; the data-owned DC and
 * reveal policy stay authoritative in the engine. */
export function inspectIllusion(
  state: RuntimeState,
  facts: IllusionInspectionFacts,
): ExecuteResult & { revealed: boolean } {
  const active = activePayloadEntries(state, 'illusion')[0];
  if (!active) throw mechanicsError('INVALID_MECHANICS', 'illusion', 'no active illusion exists');
  const physical = facts.physicalInteraction === true
    && active.payload.physical_interaction_reveals === true;
  const dc = Number(active.payload.investigation_dc);
  const investigated = facts.investigationTotal !== undefined
    && Number.isFinite(facts.investigationTotal)
    && Number.isFinite(dc)
    && Number(facts.investigationTotal) >= dc;
  const revealed = physical || investigated;
  return {
    state: cloneState(state),
    revealed,
    events: [{
      type: 'world_interaction',
      operation: 'inspect_illusion',
      parameters: { revealed, physical_interaction: physical, investigation_dc: dc || null },
      source: active.entry.name,
    }],
  };
}

export interface IllusionControlCommand {
  operation: string;
  distanceFt: number;
  parameters?: Dict;
}

/** Spend the declared turn resource to manipulate a persisted illusion. */
export function controlIllusion(
  state: RuntimeState,
  command: IllusionControlCommand,
): ExecuteResult {
  const active = activePayloadEntries(state, 'illusion')[0];
  if (!active || !isDict(active.payload.control)) {
    throw mechanicsError('INVALID_MECHANICS', 'illusion.control', 'illusion is not controllable');
  }
  const policy = active.payload.control as Dict;
  const operations = Array.isArray(policy.operations) ? policy.operations.map(String) : [];
  if (!operations.includes(command.operation)) {
    throw mechanicsError('INVALID_MECHANICS', 'illusion.control.operation', 'operation is not permitted');
  }
  if (!Number.isFinite(command.distanceFt) || command.distanceFt < 0
    || command.distanceFt > Number(policy.range_ft)) {
    throw mechanicsError('INVALID_MECHANICS', 'illusion.control.distanceFt', 'illusion is outside control range');
  }
  const resource = String(policy.resource);
  const payment = canPay(state, [{ resource, amount: 1 }]);
  if (!payment.ok) throw new InsufficientResourcesError(payment.missing);
  const paid = pay(state, [{ resource, amount: 1 }]);
  return {
    state: paid.state,
    events: [...paid.events, {
      type: 'world_interaction', operation: command.operation,
      parameters: { ...(command.parameters ?? {}), distance_ft: command.distanceFt },
      source: active.entry.name,
    }],
  };
}

/** Consume one actor-owned temporary item. Transfer between actors remains a
 * scene/inventory adapter concern, but quantity, expiry, action cost, and
 * healing are enforced here. */
export function consumeTemporaryConsumable(state: RuntimeState): ExecuteResult {
  const active = activePayloadEntries(state, 'temporary_consumable')[0];
  if (!active) throw mechanicsError('INVALID_MECHANICS', 'temporary_consumable', 'no consumable remains');
  const remaining = Number(active.payload.remaining);
  if (!Number.isSafeInteger(remaining) || remaining <= 0) {
    throw mechanicsError('INVALID_MECHANICS', 'temporary_consumable.remaining', 'no consumable remains');
  }
  const resource = String(active.payload.consume_resource);
  const payment = canPay(state, [{ resource, amount: 1 }]);
  if (!payment.ok) throw new InsufficientResourcesError(payment.missing);
  const paid = pay(state, [{ resource, amount: 1 }]);
  const next = cloneState(paid.state);
  const updatedRemaining = remaining - 1;
  if (updatedRemaining === 0) {
    next.activeEffects = next.activeEffects.filter((entry) => entry.id !== active.entry.id);
  } else {
    next.activeEffects = next.activeEffects.map((entry) => entry.id === active.entry.id
      ? { ...entry, mechanics: { ...active.payload, remaining: updatedRemaining } }
      : entry);
  }
  const healing = Math.max(0, Number(active.payload.healing ?? 0));
  const healed = Math.min(healing, next.hp.max - next.hp.current);
  next.hp.current += healed;
  return {
    state: next,
    events: [
      ...paid.events,
      ...(healed > 0 ? [{ type: 'healing' as const, amount: healed, source: active.entry.name }] : []),
      { type: 'world_interaction', operation: 'consume_temporary_item', parameters: {
        item_id: String(active.payload.id), remaining: updatedRemaining,
        nourishment_days: Number(active.payload.nourishment_days ?? 0),
      }, source: active.entry.name },
    ],
  };
}

export interface WorldEntityCommand {
  operation: string;
  distanceFt?: number;
  loadLb?: number;
  parameters?: Dict;
}

/** Validate and pay a command issued to a spell-created servant or object. */
export function commandWorldEntity(state: RuntimeState, command: WorldEntityCommand): ExecuteResult {
  const active = activePayloadEntries(state, 'world_entity')[0];
  if (!active || !isDict(active.payload.command)) {
    throw mechanicsError('INVALID_MECHANICS', 'world_entity.command', 'world entity is not commandable');
  }
  const policy = active.payload.command as Dict;
  const operations = Array.isArray(policy.operations) ? policy.operations.map(String) : [];
  if (!operations.includes(command.operation)) {
    throw mechanicsError('INVALID_MECHANICS', 'world_entity.command.operation', 'operation is not permitted');
  }
  const constraints = active.payload.constraints as Dict;
  if (command.distanceFt !== undefined) {
    const maximum = Number(constraints.max_distance_ft ?? constraints.tether_ft);
    if (!Number.isFinite(command.distanceFt) || command.distanceFt < 0
      || (Number.isFinite(maximum) && command.distanceFt > maximum)) {
      throw mechanicsError('INVALID_MECHANICS', 'world_entity.command.distanceFt', 'entity is outside its limit');
    }
  }
  if (command.loadLb !== undefined) {
    const capacity = Number(constraints.capacity_lb);
    if (!Number.isFinite(command.loadLb) || command.loadLb < 0
      || (Number.isFinite(capacity) && command.loadLb > capacity)) {
      throw mechanicsError('INVALID_MECHANICS', 'world_entity.command.loadLb', 'entity is overloaded');
    }
  }
  const resource = String(policy.resource);
  const payment = canPay(state, [{ resource, amount: 1 }]);
  if (!payment.ok) throw new InsufficientResourcesError(payment.missing);
  const paid = pay(state, [{ resource, amount: 1 }]);
  return { state: paid.state, events: [...paid.events, {
    type: 'world_interaction', operation: command.operation,
    parameters: {
      entity_type: String(active.payload.entity_type),
      ...(command.distanceFt !== undefined ? { distance_ft: command.distanceFt } : {}),
      ...(command.loadLb !== undefined ? { load_lb: command.loadLb } : {}),
      ...(command.parameters ?? {}),
    }, source: active.entry.name,
  }] };
}

export interface InformationAccessFacts {
  distanceFt?: number;
  creatureType?: string;
  barrier?: { material: string; thicknessFt: number };
  mode?: string;
  touching?: boolean;
}

/** Query a persisted magical sense/language capability using scene facts. */
export function queryInformationAccess(
  state: RuntimeState,
  facts: InformationAccessFacts,
): ExecuteResult & { accessible: boolean } {
  const active = activePayloadEntries(state, 'information_access')[0];
  if (!active) throw mechanicsError('INVALID_MECHANICS', 'information_access', 'no information access exists');
  const policy = active.payload.policy as Dict;
  let accessible = true;
  const range = Number(policy.range_ft);
  if (facts.distanceFt !== undefined && Number.isFinite(range)) {
    accessible = Number.isFinite(facts.distanceFt) && facts.distanceFt >= 0 && facts.distanceFt <= range;
  }
  if (facts.creatureType !== undefined && Array.isArray(policy.creature_types)) {
    accessible = accessible && policy.creature_types.map(String).includes(facts.creatureType);
  }
  if (facts.mode !== undefined && Array.isArray(policy.modes)) {
    accessible = accessible && policy.modes.map(String).includes(facts.mode);
  }
  if (facts.mode === 'written' && policy.written_requires_touch === true) {
    accessible = accessible && facts.touching === true;
  }
  if (facts.barrier && isDict(policy.blockers)) {
    const limits = (policy.blockers as Dict).max_thickness_ft;
    if (isDict(limits)) {
      const limit = Number(limits[facts.barrier.material]);
      if (Number.isFinite(limit) && facts.barrier.thicknessFt >= limit) accessible = false;
    }
  }
  return { state: cloneState(state), accessible, events: [{
    type: 'world_interaction', operation: 'query_information_access', parameters: {
      capability: String(active.payload.capability), accessible,
    }, source: active.entry.name,
  }] };
}

export interface WorldZoneFacts {
  operation: string;
  exempt?: boolean;
  distanceFromCasterFt?: number;
  strongWind?: boolean;
}

/** Resolve an entry/dispersal/query against a persisted spell zone. */
export function resolveWorldZone(
  state: RuntimeState,
  facts: WorldZoneFacts,
): ExecuteResult & { triggered: boolean } {
  const active = activePayloadEntries(state, 'world_zone')[0];
  if (!active) throw mechanicsError('INVALID_MECHANICS', 'world_zone', 'no active world zone exists');
  const payload = active.payload;
  let triggered = facts.exempt !== true;
  if (facts.operation === 'disperse' && payload.dispersed_by_strong_wind === true) {
    triggered = facts.strongWind === true;
  }
  if (facts.operation === 'mental_alarm' && facts.distanceFromCasterFt !== undefined) {
    triggered = triggered && facts.distanceFromCasterFt <= Number(payload.mental_range_ft ?? 0);
  }
  const next = cloneState(state);
  if (facts.operation === 'disperse' && triggered) {
    next.activeEffects = next.activeEffects.filter((entry) => entry.id !== active.entry.id);
  }
  return { state: next, triggered, events: [{
    type: 'world_interaction', operation: `world_zone_${facts.operation}`, parameters: {
      zone_type: String(payload.zone_type), triggered,
    }, source: active.entry.name,
  }] };
}

export type TurnCommandDirective =
  | { type: 'approach_source'; sourceActorId?: string; shortestDirectRoute: true }
  | { type: 'drop_held_items' }
  | { type: 'flee_source'; sourceActorId?: string; fastestAvailableMeans: true }
  | { type: 'grovel_prone' }
  | { type: 'halt' };

export interface TurnCommandResolution extends ExecuteResult {
  command: TurnCommand;
  directive: TurnCommandDirective;
  endsTurn: boolean | 'within_5ft_of_source';
}

function applyTurnCommandEndRestriction(
  state: RuntimeState,
  commandEffect: { entry: ActiveEffectEntry },
  command: TurnCommand,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  const mechanics: Dict = {
    kind: 'turn_command_resolution',
    command,
    effects: [{
      resolution: 'auto',
      result: ['movement', 'action', 'bonus_action'].map((capability) => ({
        kind: 'modifier', applies_to: { roll: capability }, op: 'deny', value: '1',
      })),
    }],
  };
  const entry: ActiveEffectEntry = {
    id: runtimeEffectId(ctx, `command-${command}-resolved`, state.activeEffects.length),
    name: commandEffect.entry.name,
    source: commandEffect.entry.source,
    ownerId: commandEffect.entry.ownerId,
    sourceId: commandEffect.entry.sourceId,
    expiry: 'end_of_turn',
    mechanics,
  };
  events.push({ type: 'effect_applied', name: entry.name });
  return stackApply(state, entry, mechanics);
}

/** Consume one data-owned command at the beginning of its owner's next turn.
 * The pure runtime owns condition/capability mutations; a board controller owns
 * actual pathfinding and held-item placement using the returned directive. */
export function resolveNextTurnCommand(
  state: RuntimeState,
  ctx: ExecuteContext,
): TurnCommandResolution | null {
  const commandEffect = activePayloadEntries(state, 'turn_command')[0];
  if (!commandEffect) return null;
  const command = String(commandEffect.payload.command) as TurnCommand;
  let next = cloneState(state);
  next.activeEffects = next.activeEffects.filter((entry) => entry.id !== commandEffect.entry.id);
  const events: EngineEvent[] = [{ type: 'effect_expired', name: commandEffect.entry.name }];
  const speed = Math.max(0, Number(ctx.character.characterSpeed ?? ctx.character.baseSpeed ?? 0));

  if (command === 'grovel') {
    next = applyCondition(
      next,
      { kind: 'condition', value: 'prone', op: 'apply' },
      commandEffect.entry.name,
      events,
      ctx,
      commandEffect.entry.sourceId,
    );
    next = applyTurnCommandEndRestriction(next, commandEffect, command, events, ctx);
    return {
      state: next,
      events,
      command,
      directive: { type: 'grovel_prone' },
      endsTurn: true,
    };
  }

  if (command === 'halt') {
    next = applyTurnCommandEndRestriction(next, commandEffect, command, events, ctx);
    return {
      state: next,
      events,
      command,
      directive: { type: 'halt' },
      endsTurn: true,
    };
  }

  if (command === 'approach') {
    events.push({ type: 'movement', mode: 'approach_source', distanceFt: speed });
    return {
      state: next,
      events,
      command,
      directive: {
        type: 'approach_source', sourceActorId: commandEffect.entry.sourceId, shortestDirectRoute: true,
      },
      endsTurn: 'within_5ft_of_source',
    };
  }

  if (command === 'flee') {
    events.push({ type: 'movement', mode: 'flee_source', distanceFt: speed });
    next = applyTurnCommandEndRestriction(next, commandEffect, command, events, ctx);
    return {
      state: next,
      events,
      command,
      directive: {
        type: 'flee_source', sourceActorId: commandEffect.entry.sourceId, fastestAvailableMeans: true,
      },
      endsTurn: true,
    };
  }

  events.push(narrativeEvent(`${commandEffect.entry.name}: цель бросает удерживаемые предметы.`));
  next = applyTurnCommandEndRestriction(next, commandEffect, 'drop', events, ctx);
  return {
    state: next,
    events,
    command: 'drop',
    directive: { type: 'drop_held_items' },
    endsTurn: true,
  };
}

/** Authoritative descent cap exposed to a board/hazard adapter. */
export function fallDescentRateFt(
  state: RuntimeState,
  ordinaryRateFt = 500,
): number {
  const declared = activePayloadEntries(state, 'fall_protection')
    .map(({ payload }) => Number(payload.descent_per_round_ft))
    .filter((value) => Number.isFinite(value) && value > 0);
  return declared.length ? Math.min(ordinaryRateFt, ...declared) : ordinaryRateFt;
}

/** Resolve landing through a persisted fall-protection effect or the ordinary
 * incoming-damage pipeline. The adapter supplies observed distance and the
 * rules-derived fall damage; content never writes HP directly. */
export function resolveFallLanding(
  state: RuntimeState,
  input: { distanceFt: number; damage: number },
  ctx: ExecuteContext,
): ExecuteResult {
  if (!Number.isFinite(input.distanceFt) || input.distanceFt < 0
    || !Number.isFinite(input.damage) || input.damage < 0) {
    throw mechanicsError('INVALID_MECHANICS', 'fall', 'fall distance and damage must be finite non-negative values');
  }
  const protections = activePayloadEntries(state, 'fall_protection')
    .filter(({ payload }) => payload.prevents_fall_damage === true);
  if (!protections.length) {
    const ordinary = applyIncomingDamage(state, input.damage, ctx, { damageType: 'bludgeoning' });
    return {
      ...ordinary,
      events: [{ type: 'movement', mode: 'fall_landing', distanceFt: input.distanceFt }, ...ordinary.events],
    };
  }

  const expiring = new Set(protections
    .filter(({ payload }) => payload.ends_on_landing === true)
    .map(({ entry }) => entry.id));
  const next = cloneState(state);
  next.activeEffects = next.activeEffects.filter((entry) => !expiring.has(entry.id));
  const events: EngineEvent[] = [
    { type: 'movement', mode: 'fall_landing', distanceFt: input.distanceFt },
    ...(input.damage > 0 ? [{ type: 'damage_reduction', amount: Math.floor(input.damage) } as EngineEvent] : []),
    ...protections
      .filter(({ entry }) => expiring.has(entry.id))
      .map(({ entry }) => ({ type: 'effect_expired', name: entry.name } as EngineEvent)),
  ];
  return { state: next, events };
}

export interface MovementOptionExecutionResult extends ExecuteResult {
  distanceFt: number;
  movementCostFt: number;
  remainingMovementFt: number;
}

/** Spend an external board movement budget on a data-driven special move. */
export function executeMovementOption(
  state: RuntimeState,
  optionId: string,
  availableMovementFt: number,
): MovementOptionExecutionResult {
  if (!Number.isFinite(availableMovementFt) || availableMovementFt < 0) {
    throw mechanicsError('INVALID_MECHANICS', 'movement.availableMovementFt', 'movement budget must be finite and non-negative');
  }
  const matches = activePayloadEntries(state, 'movement_option')
    .filter(({ payload }) => payload.id === optionId);
  if (matches.length !== 1) {
    throw mechanicsError(
      'INVALID_MECHANICS', 'movement.optionId', `expected one active movement option «${optionId}», got ${matches.length}`,
    );
  }
  const { entry, payload } = matches[0];
  const useKey = `movement-option:${entry.id}`;
  if ((state.firedThisTurn ?? []).includes(useKey)) {
    throw mechanicsError('INVALID_MECHANICS', 'movement.uses', `movement option «${optionId}» was already used this turn`);
  }
  const movementCostFt = Number(payload.movement_cost_ft);
  const distanceFt = Number(payload.distance_ft);
  if (availableMovementFt < movementCostFt) {
    throw mechanicsError(
      'INVALID_MECHANICS', 'movement.availableMovementFt', `movement option «${optionId}» requires ${movementCostFt} ft`,
    );
  }
  const next = cloneState(state);
  next.firedThisTurn = [...new Set([...(next.firedThisTurn ?? []), useKey])];
  return {
    state: next,
    events: [{ type: 'movement', mode: optionId, distanceFt }],
    distanceFt,
    movementCostFt,
    remainingMovementFt: availableMovementFt - movementCostFt,
  };
}
