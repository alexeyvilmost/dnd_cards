/**
 * Единый исполнитель действий (фазы D4, E1–E5).
 */
import type {
  ActiveEffectEntry,
  CharacterContext,
  EngineEvent,
  ExecuteContext,
  ExecuteResult,
  RollModifier,
  RuntimeState,
} from '../mvp/contracts';
import { canPay, pay } from './cost';
import { damageEvent, healingEvent, narrativeEvent, rollEvent } from './events';
import { evaluate, rollFormula, type AbilityKey, type FormulaContext } from './formula';
import { collectRollModifiers } from './modifiers';
import { rollD20 } from './roll';
import { weaponContext } from './weapon';

type Dict = Record<string, unknown>;

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

export class InsufficientResourcesError extends Error {
  constructor(readonly missing: string[]) {
    super(`INSUFFICIENT_RESOURCES: ${missing.join(', ')}`);
    this.name = 'InsufficientResourcesError';
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
    rng: ctx.rng,
  };
}

function evalDc(formula: string, ctx: ExecuteContext): number {
  const normalized = formula.replace(/\s+/g, '');
  const v = evaluate(normalized, formulaCtx(ctx));
  if (typeof v !== 'number') throw new Error(`DC формула «${formula}» не число`);
  return v;
}

function expiryFromDuration(duration: Dict | undefined): string | undefined {
  const t = duration?.type;
  if (t === 'until_start_of_next_turn') return 'start_of_next_turn';
  return undefined;
}

function resolveHand(effect: Dict): 'main' | 'off' {
  const tags = effect.tags as string[] | undefined;
  return tags?.includes('off_hand') ? 'off' : 'main';
}

function attackAbilityMods(effect: Dict, ctx: ExecuteContext, hand: 'main' | 'off', state: RuntimeState): RollModifier[] {
  const mods: RollModifier[] = [];
  const ability = String(effect.ability ?? 'str');

  if (ability === 'spellcasting') {
    mods.push({ value: ctx.character.spellcastingMod ?? 0, source: 'заклин.', reason: 'модификатор заклинаний' });
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  } else if (ability === 'auto') {
    const w = weaponContext(ctx.character, hand, state.equipment);
    if (w) {
      mods.push({
        value: ctx.character.abilityMods[w.ability],
        source: ABILITY_LABEL[w.ability],
        reason: 'модификатор характеристики',
      });
    }
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  } else {
    const key = ability as AbilityKey;
    mods.push({
      value: ctx.character.abilityMods[key] ?? 0,
      source: ABILITY_LABEL[key] ?? ability,
      reason: 'модификатор характеристики',
    });
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  }
  return mods;
}

function applyAutoResult(
  state: RuntimeState,
  results: Dict[],
  source: string,
  events: EngineEvent[],
  ctx: ExecuteContext,
): RuntimeState {
  let next = state;
  for (const r of results) {
    if (r.kind === 'modifier') {
      const entry: ActiveEffectEntry = {
        id: `fx-${next.activeEffects.length}-${Date.now()}`,
        name: source,
        mechanics: r,
        expiry: expiryFromDuration(r.duration as Dict | undefined),
        source,
      };
      next = { ...next, activeEffects: [...next.activeEffects, entry] };
      events.push({ type: 'effect_applied', name: source });
      continue;
    }
    if (r.kind === 'healing') {
      next = applyHealing(next, r, ctx, events);
      continue;
    }
    if (r.kind === 'narrative') {
      events.push(narrativeEvent(String(r.description ?? r.text ?? '')));
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
  const fr = rollFormula(String(payload.amount ?? '0'), formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  next.hp.current = Math.min(next.hp.max, next.hp.current + fr.total);
  events.push(healingEvent(fr.total, {
    kind: 'healing',
    dice: fr.dice,
    modifiers: fr.modifiers,
    total: fr.total,
    text: fr.text,
  }));
  return next;
}

function resolveDamageAmount(
  payload: Dict,
  ctx: ExecuteContext,
  state: RuntimeState,
  hand: 'main' | 'off',
): { amount: number; damageType: string; roll?: import('../mvp/contracts').RollLog } {
  const handWeapon = weaponContext(ctx.character, hand, state.equipment);
  let damageType = String(payload.type ?? 'bludgeoning');
  if (damageType === 'weapon') damageType = handWeapon?.damageType ?? 'bludgeoning';

  if (payload.dice === 'weapon') {
    const dice = handWeapon?.dice ?? '1d4';
    const fr = rollFormula(dice, formulaCtx(ctx), { rng: ctx.rng });
    let total = fr.total;
    const ab = String(payload.ability ?? 'auto');
    if (ab !== 'none') {
      if (ab === 'auto' && handWeapon) {
        total += ctx.character.abilityMods[handWeapon.ability];
      } else if (ab !== 'auto') {
        total += ctx.character.abilityMods[ab as AbilityKey] ?? 0;
      }
    }
    return {
      amount: total,
      damageType,
      roll: { kind: 'damage', dice: fr.dice, modifiers: fr.modifiers, total, text: fr.text },
    };
  }

  if (payload.amount != null) {
    const fr = rollFormula(String(payload.amount), formulaCtx(ctx), { rng: ctx.rng });
    return {
      amount: fr.total,
      damageType,
      roll: { kind: 'damage', dice: fr.dice, modifiers: fr.modifiers, total: fr.total, text: fr.text },
    };
  }

  if (payload.dice != null) {
    const fr = rollFormula(String(payload.dice), formulaCtx(ctx), { rng: ctx.rng });
    return {
      amount: fr.total,
      damageType,
      roll: { kind: 'damage', dice: fr.dice, modifiers: fr.modifiers, total: fr.total, text: fr.text },
    };
  }

  return { amount: 0, damageType };
}

function applyDamageList(
  payloads: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  hand: 'main' | 'off',
  halfOnSuccess = false,
): RuntimeState {
  let next = state;
  for (const p of payloads) {
    let { amount, damageType, roll } = resolveDamageAmount(p, ctx, next, hand);
    if (halfOnSuccess) amount = Math.floor(amount / 2);
    events.push(damageEvent(amount, damageType, roll));
  }
  return next;
}

function runAttackRoll(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const hand = resolveHand(effect);
  const ac = ctx.target?.ac ?? 10;
  const passives = passivesFromCtx(ctx);
  const collected = collectRollModifiers(state, passives, { roll: 'attack' });
  const mods = [...attackAbilityMods(effect, ctx, hand, state), ...collected.modifiers];

  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: mods,
    target: { type: 'ac', value: ac },
    rng: ctx.rng,
  });
  events.push(rollEvent('Атака', roll));

  if (roll.outcome === 'hit' || roll.outcome === 'crit') {
    const payloads = (roll.outcome === 'crit' && effect.on_crit
      ? effect.on_crit
      : effect.on_hit) as Dict[] | undefined;
    if (Array.isArray(payloads)) {
      return applyDamageList(payloads, state, ctx, events, hand);
    }
  }
  return state;
}

function runSave(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const dcFormula = String(effect.dc ?? '10');
  const dc = evalDc(dcFormula, ctx);
  const ability = String(effect.ability ?? 'dex') as AbilityKey;
  const saveMod = ctx.target?.saveMods?.[ability] ?? 0;
  const collected = collectRollModifiers(state, passivesFromCtx(ctx), {
    roll: 'saving_throw',
    filter: { ability },
  });

  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [{ value: saveMod, source: 'цель' }, ...collected.modifiers],
    target: { type: 'dc', value: dc },
    rng: ctx.rng,
  });
  events.push(rollEvent('Спасбросок', { ...roll, kind: 'save' }));

  const success = roll.outcome === 'success';
  const payloads = (success ? effect.on_success : effect.on_fail) as Dict[] | undefined;
  if (!Array.isArray(payloads)) return state;

  const half = success && payloads.some((p) => p.on_success === 'half');
  return applyDamageList(payloads, state, ctx, events, 'main', half);
}

function runAbilityCheck(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const ability = String(effect.ability ?? 'str') as AbilityKey;
  const skill = String(effect.skill ?? '');
  const attackerTotal = (ctx.character.abilityMods[ability] ?? 0) + ctx.character.profBonus;
  const attRoll = rollD20({
    modifiers: [{ value: attackerTotal, source: skill || ABILITY_LABEL[ability] }],
    rng: ctx.rng,
  });
  events.push(rollEvent(skill ? `Проверка (${skill})` : 'Проверка', { ...attRoll, kind: 'check' }));

  const contestVs = (effect.contest_vs as string[]) ?? ['athletics'];
  let bestDef = -Infinity;
  for (const defSkill of contestVs) {
    const defMod = ctx.target?.checkMods?.[defSkill] ?? 0;
    const defRoll = rollD20({
      modifiers: [{ value: defMod, source: defSkill }],
      rng: ctx.rng,
    });
    events.push(rollEvent(`Ответ (${defSkill})`, { ...defRoll, kind: 'check' }));
    if (defRoll.total > bestDef) bestDef = defRoll.total;
  }

  if (attRoll.total > bestDef) {
    const onSuccess = effect.on_success as Dict[] | undefined;
    if (Array.isArray(onSuccess)) {
      let next = state;
      for (const r of onSuccess) {
        if (r.kind === 'narrative') events.push(narrativeEvent(String(r.description ?? '')));
        if (r.kind === 'movement') events.push(narrativeEvent(`Перемещение: ${r.value} ${r.distance ?? ''} фт`));
      }
      return next;
    }
  }
  return state;
}

export function executeAction(
  state: RuntimeState,
  mechanics: Dict,
  ctx: ExecuteContext,
): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [];

  const activation = mechanics.activation as Dict | undefined;
  const cost = (activation?.cost as Dict[]) ?? [];
  if (cost.length) {
    const check = canPay(next, cost);
    if (!check.ok) throw new InsufficientResourcesError(check.missing);
    const paid = pay(next, cost);
    next = paid.state;
    events.push(...paid.events);
  }

  const effects = mechanics.effects as Dict[] | undefined;
  if (!Array.isArray(effects)) return { state: next, events };

  const sourceName = String(mechanics.name ?? 'действие');

  for (const eff of effects) {
    const resolution = String(eff.resolution ?? '');
    if (resolution === 'auto') {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (Array.isArray(results)) {
        next = applyAutoResult(next, results, sourceName, events, ctx);
      }
      continue;
    }
    if (resolution === 'attack_roll') {
      next = runAttackRoll(eff, next, ctx, events);
      continue;
    }
    if (resolution === 'save') {
      next = runSave(eff, next, ctx, events);
      continue;
    }
    if (resolution === 'ability_check') {
      next = runAbilityCheck(eff, next, ctx, events);
      continue;
    }
    events.push(narrativeEvent(`NOT_IMPLEMENTED resolution: ${resolution}`));
  }

  void (ctx.character as CharacterContext);
  return { state: next, events };
}
