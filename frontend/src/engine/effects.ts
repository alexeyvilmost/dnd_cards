/**
 * Управление активными эффектами (фаза D4).
 */
import type { ActiveEffectEntry, EngineEvent, RuntimeState } from '../mvp/contracts';
import { dropConcentration } from './concentration';
import { conditionInstructions, conditionLabel } from './conditions';
import { turnCommandEffectName, turnCommandInstruction } from './turnCommands';

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

export function removeActiveEffect(
  state: RuntimeState,
  effectId: string,
): { state: RuntimeState; events: EngineEvent[] } {
  const next = cloneState(state);
  const removed = next.activeEffects.find((e) => e.id === effectId);
  if (!removed) return { state: next, events: [] };
  if ((removed.mechanics as Record<string, unknown>).kind === 'concentration') {
    return dropConcentration(next, 'снята вручную');
  }
  next.activeEffects = next.activeEffects.filter((e) => e.id !== effectId);
  return {
    state: next,
    events: [{ type: 'effect_expired', name: removed.name }],
  };
}

function turnsLabel(roundsLeft: number): string {
  const abs = Math.abs(roundsLeft) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? 'ходов' : last === 1 ? 'ход' : last >= 2 && last <= 4 ? 'хода' : 'ходов';
  return `${roundsLeft} ${word}`;
}

export function removeActiveEffectGroup(
  state: RuntimeState,
  effectIds: readonly string[],
): { state: RuntimeState; events: EngineEvent[] } {
  let next = state;
  const events: EngineEvent[] = [];
  for (const effectId of effectIds) {
    const removed = removeActiveEffect(next, effectId);
    next = removed.state;
    events.push(...removed.events);
  }
  return { state: next, events };
}

export function expiryLabel(expiry?: string, roundsLeft?: number): string {
  if (roundsLeft != null) return turnsLabel(roundsLeft);
  switch (expiry) {
    case 'start_of_next_turn': return 'до начала след. хода';
    case 'end_of_turn': return 'до конца хода';
    case 'until_rest': return 'до отдыха';
    case 'manual': return 'вручную';
    case 'source_turn': return 'до хода источника';
    default: return expiry ? expiry : 'без срока';
  }
}

export function activeEffectDurationLabel(effect: ActiveEffectEntry): string {
  const mechanics = effect.mechanics as Record<string, unknown>;
  if (mechanics.kind === 'turn_command') return 'до начала следующего хода цели';
  if (mechanics.kind === 'turn_command_resolution') return 'до конца текущего хода';
  const lifecycle = effect.sourceTurnExpiry;
  if (lifecycle) {
    if (lifecycle.boundary === 'start') return 'до начала следующего хода источника';
    return lifecycle.armed
      ? 'до конца текущего хода источника'
      : 'до конца следующего хода источника';
  }
  return expiryLabel(effect.expiry, effect.roundsLeft);
}

function activeEffectDisplayName(effect: ActiveEffectEntry): string {
  const mechanics = effect.mechanics as Record<string, unknown>;
  if (mechanics.kind === 'turn_command' || mechanics.kind === 'turn_command_resolution') {
    return turnCommandEffectName(effect.source, mechanics.command);
  }
  return mechanics.kind === 'condition' && typeof mechanics.value === 'string'
    ? conditionLabel(mechanics.value)
    : effect.name;
}

function activeEffectSourceLabel(effect: ActiveEffectEntry): string | null {
  const source = effect.source?.trim();
  return source && !source.startsWith('manual:') ? source : null;
}

function activeEffectInstructionRows(effect: ActiveEffectEntry): string[] {
  const mechanics = effect.mechanics as Record<string, unknown>;
  if (mechanics.kind === 'condition' && typeof mechanics.value === 'string') {
    const rows = [...conditionInstructions(mechanics.value)];
    const saveEnds = mechanics.save_ends as Record<string, unknown> | undefined;
    if (saveEnds && String(saveEnds.timing ?? 'end_of_turn') === 'end_of_turn') {
      const ability = ({
        str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
      } as Record<string, string>)[String(saveEnds.ability)] ?? String(saveEnds.ability ?? 'характеристики');
      const dc = saveEnds.dc == null ? 'указанной СЛ' : `СЛ ${String(saveEnds.dc)}`;
      const transition = typeof saveEnds.on_failure_condition === 'string'
        ? conditionLabel(saveEnds.on_failure_condition) : null;
      rows.push(
        `В конце своего хода повторите спасбросок ${ability} против ${dc}`
        + `${transition ? `; при провале получите состояние «${transition}»` : ''}.`,
      );
    }
    const endTriggers = Array.isArray(mechanics.end_triggers)
      ? mechanics.end_triggers.map(String) : [];
    if (endTriggers.includes('actor_takes_damage')
      && endTriggers.includes('wake_action_within_5_ft')) {
      rows.push('Эффект закончится при получении урона или если существо в 5 фт потратит действие, чтобы разбудить вас.');
    } else if (endTriggers.includes('actor_takes_damage')) {
      rows.push('Эффект закончится при получении урона.');
    }
    return rows;
  }
  const instruction = activeEffectInstruction(effect);
  return instruction ? [instruction] : [];
}

const BOON_ROLL_LABELS: Record<string, string> = {
  ability_check: 'проверке характеристики',
  attack_roll: 'броску атаки',
  saving_throw: 'спасброску',
};

/** Player-facing instructions for active effects that require manual use. */
export function activeEffectInstruction(effect: ActiveEffectEntry): string | null {
  const mechanics = effect.mechanics as Record<string, unknown>;
  if (mechanics.kind === 'turn_command' || mechanics.kind === 'turn_command_resolution') {
    return turnCommandInstruction(mechanics.command);
  }
  if (mechanics.kind === 'condition' && typeof mechanics.value === 'string') {
    const instructions = conditionInstructions(mechanics.value);
    return instructions.length ? instructions.join(' ') : null;
  }
  if (mechanics.kind === 'boon') {
    const die = String(mechanics.die ?? '1d6').replace(/d/i, 'к');
    const declared = Array.isArray(mechanics.applies_to)
      ? mechanics.applies_to.map(String)
      : [];
    const rolls = declared.map((item) => BOON_ROLL_LABELS[item] ?? item);
    const scope = rolls.length
      ? rolls.join(', ').replace(/, ([^,]*)$/, ' или $1')
      : 'подходящему броску к20';
    return `Чтобы использовать: бросьте отдельный ${die}, вручную добавьте результат к ${scope}, затем нажмите × «Снять вручную».`;
  }
  if (mechanics.kind === 'modifier') {
    const appliesTo = mechanics.applies_to as Record<string, unknown> | undefined;
    const roll = String(appliesTo?.roll ?? '');
    if (String(mechanics.op) === 'deny' && roll === 'healing') {
      return 'Не может восстанавливать Хиты.';
    }
    if (String(mechanics.op) === 'minimum_total' && roll === 'd20' && mechanics.value != null) {
      const consume = String(mechanics.consume ?? '') === 'next'
        ? ' После следующего броска эффект расходуется.'
        : '';
      return `Итог броска к20 не может быть меньше ${String(mechanics.value)}.${consume}`;
    }
    const label = roll === 'size' ? 'Размер' : roll === 'speed' ? 'Скорость' : '';
    if (!label || mechanics.value == null) return null;
    const op = String(mechanics.op ?? 'add');
    const rawValue = String(mechanics.value);
    const value = roll === 'size'
      ? (op === 'add' && rawValue === '1'
        ? 'на одну категорию больше'
        : op === 'add' && rawValue === '-1'
          ? 'на одну категорию меньше'
          : ({ large: 'Большой', medium: 'Средний', small: 'Маленький' }[rawValue.toLowerCase()] ?? rawValue))
      : `${op === 'add' && !rawValue.startsWith('-') ? '+' : ''}${rawValue} фт`;
    return `${label}: ${value}.`;
  }
  const nestedResults = (Array.isArray(mechanics.effects) ? mechanics.effects : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const result = (entry as Record<string, unknown>).result;
      return Array.isArray(result) ? result : [];
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  const acMethod = nestedResults.find((entry) => (
    entry.kind === 'set_value' && entry.target === 'ac_base' && typeof entry.formula === 'string'
  ));
  if (acMethod) {
    const formula = String(acMethod.formula)
      .replace(/\bdex\b/giu, 'модификатор Ловкости')
      .replace(/\bwis\b/giu, 'модификатор Мудрости')
      .replace(/\bcon\b/giu, 'модификатор Телосложения');
    const duration = mechanics.duration as Record<string, unknown> | undefined;
    const rounds = duration?.type === 'rounds' ? Number(duration.amount) : 0;
    const hours = rounds > 0 && rounds % 600 === 0 ? rounds / 600 : 0;
    const hourWord = hours % 10 === 1 && hours % 100 !== 11
      ? 'час'
      : hours % 10 >= 2 && hours % 10 <= 4 && !(hours % 100 >= 12 && hours % 100 <= 14)
        ? 'часа'
        : 'часов';
    const endTriggers = Array.isArray(mechanics.end_triggers) ? mechanics.end_triggers.map(String) : [];
    return [
      `КД: ${formula}.`,
      hours ? `Срок: ${hours} ${hourWord}.` : null,
      endTriggers.includes('wearer_dons_armor')
        ? 'Эффект закончится, если вы наденете доспех.'
        : null,
    ].filter((row): row is string => Boolean(row)).join(' ');
  }
  if (mechanics.kind === 'grant_sense') {
    const sense = String(mechanics.sense ?? 'чувство');
    const label = ({
      darkvision: 'Тёмное зрение',
      tremorsense: 'Чувство вибрации',
      blindsight: 'Слепое зрение',
      truesight: 'Истинное зрение',
    } as Record<string, string>)[sense] ?? sense;
    const range = Number(mechanics.range);
    const duration = expiryLabel(effect.expiry, effect.roundsLeft);
    const scope = mechanics.senseScope as Record<string, unknown> | undefined;
    const limitations = scope?.kind === 'stonework'
      ? [
          scope.sameSurfaceOnly === true ? 'только по той же каменной поверхности' : null,
          scope.detectsAirborne === false ? 'не обнаруживает существ в воздухе' : null,
          scope.grantsSight === false ? 'не даёт видеть' : null,
        ].filter((value): value is string => Boolean(value))
      : [];
    const distance = Number.isFinite(range) && range > 0 ? `${range} фт.` : 'заявленная дистанция';
    return `${label}: ${distance} (${duration})${limitations.length ? `; ${limitations.join('; ')}` : ''}.`;
  }
  return null;
}

export interface ActiveEffectDisplayGroup {
  key: string;
  name: string;
  effects: ActiveEffectEntry[];
  instructions: string[];
  source: string | null;
  duration: string;
}

/** One action can persist several mechanical payload rows. Present them as one
 * player-facing effect while retaining every row for rules evaluation. */
export function groupActiveEffectsForDisplay(
  effects: readonly ActiveEffectEntry[],
): ActiveEffectDisplayGroup[] {
  const groups = new Map<string, ActiveEffectEntry[]>();
  for (const effect of effects) {
    const key = [
      effect.name, effect.source, effect.ownerId ?? '', effect.sourceId ?? '',
      effect.expiry ?? '', effect.roundsLeft ?? '',
    ].join('\u0000');
    const group = groups.get(key);
    if (group) group.push(effect);
    else groups.set(key, [effect]);
  }
  return [...groups.entries()].map(([key, entries]) => ({
    key,
    name: activeEffectDisplayName(entries[0]),
    effects: entries,
    instructions: [...new Set(entries.flatMap(activeEffectInstructionRows))],
    source: activeEffectSourceLabel(entries[0]),
    duration: activeEffectDurationLabel(entries[0]),
  }));
}
