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
import {
  conditionAppliedEvent, damageEvent, healingEvent, narrativeEvent,
  resourceRestoredEvent, rollEvent, tempHpEvent,
} from './events';
import { evaluate, FormulaError, MissingVariableError, rollFormula, type AbilityKey, type FormulaContext } from './formula';
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
    variables: ctx.character.variables,
    rng: ctx.rng,
  };
}

function evalDc(formula: string, ctx: ExecuteContext): number {
  const normalized = formula.replace(/\s+/g, '');
  const v = evaluate(normalized, formulaCtx(ctx));
  if (typeof v !== 'number') throw new FormulaError(`DC формула «${formula}» не число`);
  return v;
}

function expiryFromDuration(duration: Dict | undefined): string | undefined {
  const t = duration?.type;
  if (t === 'until_start_of_next_turn') return 'start_of_next_turn';
  return undefined;
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

function applyModifierPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
): RuntimeState {
  const entry: ActiveEffectEntry = {
    id: `fx-${state.activeEffects.length}-${Date.now()}`,
    name: source,
    mechanics: payload,
    expiry: expiryFromDuration(payload.duration as Dict | undefined),
    source,
  };
  events.push({ type: 'effect_applied', name: source });
  return { ...state, activeEffects: [...state.activeEffects, entry] };
}

function applyHealing(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const formula = withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  next.hp.current = Math.min(next.hp.max, next.hp.current + fr.total);
  events.push(healingEvent(fr.total, {
    kind: 'healing',
    advantage: 'none',
    dice: fr.dice,
    modifiers: fr.modifiers,
    total: fr.total,
    text: fr.text,
  }));
  return next;
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
): RuntimeState {
  const condition = String(payload.value ?? '');
  if (!condition) return state;
  const op = String(payload.op ?? 'apply');

  if (op === 'remove') {
    const kept = state.activeEffects.filter((e) => {
      const m = e.mechanics as Dict;
      const match = m?.kind === 'condition' && String(m.value ?? '') === condition;
      if (match) events.push({ type: 'effect_expired', name: e.name });
      return !match;
    });
    return { ...state, activeEffects: kept };
  }

  const duration = payload.duration as Dict | undefined;
  const rounds = duration?.type === 'rounds' ? Number(duration.amount) || undefined : undefined;
  const entry: ActiveEffectEntry = {
    id: `cond-${state.activeEffects.length}-${Date.now()}`,
    name: condition,
    mechanics: payload,
    roundsLeft: rounds,
    expiry: expiryFromDuration(duration) ?? (rounds ? undefined : 'manual'),
    source,
  };
  events.push(conditionAppliedEvent(condition));
  return { ...state, activeEffects: [...state.activeEffects, entry] };
}

/** resource: grant — сверх максимума (Прилив действий), restore — до максимума. */
function applyResource(
  state: RuntimeState,
  payload: Dict,
  events: EngineEvent[],
): RuntimeState {
  let key = String(payload.id ?? payload.resource ?? '');
  if (!key) return state;
  if (key === 'spell_slot' && payload.level != null) key = `spell_slot_${payload.level}`;

  const amount = typeof payload.amount === 'number' ? payload.amount : Number(payload.amount) || 1;
  const op = String(payload.op ?? 'grant');
  const next = cloneState(state);
  const current = next.resources[key] ?? 0;

  if (op === 'restore') {
    const max = next.maxResources[key];
    next.resources[key] = max != null ? Math.min(max, current + amount) : current + amount;
  } else {
    next.resources[key] = current + amount;
  }
  const gained = next.resources[key] - current;
  if (gained > 0) events.push(resourceRestoredEvent(key, gained, next.resources[key]));
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
      roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: fr.modifiers, total, text: fr.text },
    };
  }

  if (payload.amount != null) {
    const formula = withScaling(String(payload.amount), payload, ctx);
    const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
    return {
      amount: fr.total,
      damageType,
      roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: fr.modifiers, total: fr.total, text: fr.text },
    };
  }

  if (payload.dice != null) {
    const formula = withScaling(String(payload.dice), payload, ctx);
    const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
    return {
      amount: fr.total,
      damageType,
      roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: fr.modifiers, total: fr.total, text: fr.text },
    };
  }

  return { amount: 0, damageType };
}

/**
 * Единый роутер payload-ов (§6.5 схемы): исполняет список исходов
 * on_hit / on_crit / on_fail / on_success / result.
 */
function applyPayloads(
  payloads: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  hand: 'main' | 'off',
  halfDamage = false,
): RuntimeState {
  let next = state;
  for (const p of payloads) {
    const kind = String(p.kind ?? '');
    switch (kind) {
      case 'damage': {
        let { amount, damageType, roll } = resolveDamageAmount(p, ctx, next, hand);
        if (halfDamage) amount = Math.floor(amount / 2);
        events.push(damageEvent(amount, damageType, roll));
        break;
      }
      case 'healing':
        next = applyHealing(next, p, ctx, events);
        break;
      case 'temp_hp':
        next = applyTempHp(next, p, ctx, events);
        break;
      case 'condition':
        next = applyCondition(next, p, source, events);
        break;
      case 'resource':
        next = applyResource(next, p, events);
        break;
      case 'modifier':
        next = applyModifierPayload(next, p, source, events);
        break;
      case 'movement':
        events.push(narrativeEvent(`Перемещение: ${p.value} ${p.distance ?? ''} фт`));
        break;
      case 'boon': {
        // «Талон» (Вдохновение барда): чип-эффект с костью, снимается вручную
        // при использовании; кость вводится диалогом бросков получателя.
        const die = String(p.die ?? 'к6').replace(/d/i, 'к');
        const name = `Талон ${die}${p.id ? ` (${source})` : ''}`;
        const entry: ActiveEffectEntry = {
          id: `boon-${next.activeEffects.length}-${Date.now()}`,
          name,
          mechanics: p,
          expiry: 'manual',
          source,
        };
        next = { ...next, activeEffects: [...next.activeEffects, entry] };
        events.push({ type: 'effect_applied', name, sourceAction: source });
        events.push(narrativeEvent(
          `Талон ${die}: получатель добавляет ${die} к броску атаки, проверке или спасброску`
          + `${p.expires ? ` (истекает: ${p.expires})` : ''}. Снимите эффект при использовании.`,
        ));
        break;
      }
      case 'reroll': {
        // Переброс (Везунчик): архитектурно бросок уже совершён — движок
        // фиксирует право переброса, значение вводится диалогом кубов.
        const which = String(p.which ?? 'd20').replace(/d/i, 'к');
        const keep = p.keep === 'either' ? 'оставьте любой из двух результатов' : 'используйте новый результат';
        events.push(narrativeEvent(`Переброс ${which}: перебросьте кость — ${keep}.`));
        break;
      }
      case 'transform': {
        // Превращение (Дикий облик): облик как активный эффект-чип; стат-блок
        // зверя ведётся по бестиарию, лист напоминает об ограничениях.
        const formName = String(p.form ?? p.value ?? 'Дикий облик');
        const entry: ActiveEffectEntry = {
          id: `form-${next.activeEffects.length}-${Date.now()}`,
          name: `Облик: ${formName}`,
          mechanics: p,
          expiry: 'manual',
          source,
        };
        next = { ...next, activeEffects: [...next.activeEffects, entry] };
        events.push({ type: 'effect_applied', name: entry.name, sourceAction: source });
        events.push(narrativeEvent(
          `Превращение (${source}): используйте стат-блок зверя${p.max_cr != null ? ` (ПО ≤ ${p.max_cr})` : ''}; `
          + 'ментальные характеристики и спасброски МДР/ИНТ/ХАР — ваши. Снимите эффект при возврате.',
        ));
        break;
      }
      case 'narrative':
        events.push(narrativeEvent(String(p.description ?? p.text ?? '')));
        break;
      default:
        events.push(narrativeEvent(`NOT_IMPLEMENTED payload: ${kind}`));
    }
  }
  return next;
}

function runAttackRoll(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
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
      return applyPayloads(payloads, state, ctx, events, source, hand);
    }
  }
  return state;
}

function runSave(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
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
  return applyPayloads(payloads, state, ctx, events, source, 'main', half);
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
    // Мягкая деградация: если формула эффекта ссылается на недоступную переменную,
    // эффект пропускается с логом, а не роняет всё действие (см. docs/variables.md).
    try {
      if (resolution === 'auto') {
        const results = (eff.result ?? eff.results) as Dict[] | undefined;
        if (Array.isArray(results)) {
          next = applyPayloads(results, next, ctx, events, sourceName, 'main');
        }
        continue;
      }
      if (resolution === 'attack_roll') {
        next = runAttackRoll(eff, next, ctx, events, sourceName);
        continue;
      }
      if (resolution === 'save') {
        next = runSave(eff, next, ctx, events, sourceName);
        continue;
      }
      if (resolution === 'ability_check') {
        next = runAbilityCheck(eff, next, ctx, events);
        continue;
      }
      events.push(narrativeEvent(`NOT_IMPLEMENTED resolution: ${resolution}`));
    } catch (e) {
      // Проблема формулы (нет переменной / битая формула) — эффект пропускается с
      // логом, действие не падает. Реальные (не формульные) ошибки идут наверх.
      if (e instanceof MissingVariableError) {
        events.push(narrativeEvent(`Переменная «${e.variable}» недоступна — эффект «${sourceName}» не применён.`));
        continue;
      }
      if (e instanceof FormulaError) {
        events.push(narrativeEvent(`Формула эффекта «${sourceName}» не вычислена: ${e.message}`));
        continue;
      }
      throw e;
    }
  }

  void (ctx.character as CharacterContext);
  return { state: next, events };
}
