/**
 * План кубов для диалога ручного броска: какие кости понадобятся действию
 * и rng-инъекция значений физических кубов.
 *
 * Схема: исполнитель чистый, поэтому «планирующий» прогон с фиксированным rng
 * перечисляет кости из событий (порядок событий = порядок обращений к rng).
 * Реальный прогон затем потребляет введённые значения тем же порядком; если
 * фактический путь запросил меньше костей (промах — урон не бросается),
 * лишние значения просто не используются, если больше — добор Math.random.
 */
import type { EngineEvent } from '../mvp/contracts';

export interface PlannedDie {
  sides: number;
  /** Подпись для игрока: «Атака», «Урон (piercing)», «Лечение»… */
  label: string;
  /** Идентификатор одного логического броска (например, атака отдельно от урона). */
  resultGroup?: string;
  /** Числовые модификаторы логического броска; задаются на первой кости группы. */
  modifier?: number;
  /** Как выбрать d20 при преимуществе/помехе. */
  advantage?: 'none' | 'advantage' | 'disadvantage';
}

/**
 * rng планирующего прогона: 0.94 → к20 даёт 19 (попадание почти всегда, не крит),
 * чтобы в план попали и кости урона on_hit.
 */
export const PLANNING_RNG = () => 0.94;

const DAMAGE_LABEL: Record<string, string> = {
  slashing: 'рубящий', piercing: 'колющий', bludgeoning: 'дробящий',
  fire: 'огонь', cold: 'холод', lightning: 'молния', thunder: 'звук',
  acid: 'кислота', poison: 'яд', necrotic: 'некротический', radiant: 'излучение',
  psychic: 'психический', force: 'силовое поле',
};

/** Кости из событий одного прогона, в порядке броска. skipSave — не включать d20 спасброска
 *  (онлайн-бой: спас бросает ЦЕЛЬ на своём листе, кастер вводит только кости урона). */
export function extractDiceFromEvents(events: EngineEvent[], skipSave = false): PlannedDie[] {
  const out: PlannedDie[] = [];
  events.forEach((e, eventIndex) => {
    if (e.type === 'roll') {
      if (skipSave && e.roll.kind === 'save') return;
      const modifier = e.roll.modifiers.reduce((sum, item) => sum + item.value, 0);
      for (const [dieIndex, d] of e.roll.dice.entries()) {
        out.push({
          sides: d.sides,
          label: e.label,
          resultGroup: `event-${eventIndex}`,
          ...(dieIndex === 0 && modifier ? { modifier } : {}),
          ...(e.roll.advantage !== 'none' ? { advantage: e.roll.advantage } : {}),
        });
      }
    } else if (e.type === 'damage' && e.roll) {
      const t = DAMAGE_LABEL[e.damageType] ?? e.damageType;
      const modifier = e.roll.modifiers.reduce((sum, item) => sum + item.value, 0);
      for (const [dieIndex, d] of e.roll.dice.entries()) {
        out.push({
          sides: d.sides,
          label: `Урон (${t})`,
          resultGroup: `event-${eventIndex}`,
          ...(dieIndex === 0 && modifier ? { modifier } : {}),
        });
      }
    } else if (e.type === 'healing' && e.roll) {
      const modifier = e.roll.modifiers.reduce((sum, item) => sum + item.value, 0);
      for (const [dieIndex, d] of e.roll.dice.entries()) {
        out.push({
          sides: d.sides,
          label: 'Лечение',
          resultGroup: `event-${eventIndex}`,
          ...(dieIndex === 0 && modifier ? { modifier } : {}),
        });
      }
    }
  });
  return out;
}

export interface PlannedRollTotal {
  key: string;
  label: string;
  diceTotal: number;
  modifier: number;
  total: number;
}

/** Превращает data-driven bonus_die (Наставление/Благословение) в физические кости плана. */
export function plannedD20BonusDice(
  rules: Record<string, unknown>[],
  label: string,
  resultGroup: string,
): PlannedDie[] {
  const dice: PlannedDie[] = [];
  for (const rule of rules) {
    if (rule.op !== 'bonus_die') continue;
    const faces = Math.floor(Number(rule.faces ?? rule.die ?? rule.value ?? 0));
    if (faces < 2) continue;
    const count = Math.max(1, Math.floor(Number(rule.count ?? 1)));
    for (let index = 0; index < count; index += 1) {
      dice.push({ sides: faces, label, resultGroup });
    }
  }
  return dice;
}

/** Полные итоги логических бросков для 3D-панели: кости + модификаторы. */
export function calculatePlannedRollTotals(plan: PlannedDie[], values: number[]): PlannedRollTotal[] {
  const groups: Array<{ key: string; label: string; dice: Array<{ sides: number; value: number }>; modifier: number; advantage: PlannedDie['advantage'] }> = [];
  let implicitGroup = 0;
  let previousImplicitLabel: string | undefined;
  plan.forEach((die, index) => {
    if (!die.resultGroup && die.label !== previousImplicitLabel) implicitGroup += 1;
    const key = die.resultGroup ?? `implicit-${implicitGroup}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: die.label, dice: [], modifier: 0, advantage: die.advantage };
      groups.push(group);
    }
    group.dice.push({ sides: die.sides, value: Number(values[index]) || 0 });
    group.modifier += die.modifier ?? 0;
    group.advantage = group.advantage ?? die.advantage;
    previousImplicitLabel = die.resultGroup ? undefined : die.label;
  });

  return groups.map((group) => {
    const d20 = group.dice.filter((die) => die.sides === 20).map((die) => die.value);
    const other = group.dice.filter((die) => die.sides !== 20).reduce((sum, die) => sum + die.value, 0);
    let d20Total = d20.reduce((sum, value) => sum + value, 0);
    if (d20.length > 1 && group.advantage === 'advantage') d20Total = Math.max(...d20);
    if (d20.length > 1 && group.advantage === 'disadvantage') d20Total = Math.min(...d20);
    const diceTotal = d20Total + other;
    return {
      key: group.key,
      label: group.label,
      diceTotal,
      modifier: group.modifier,
      total: diceTotal + group.modifier,
    };
  });
}

/** Человекочитаемая сводка плана: «1к20 и 2к8» (группировка по типу кости). */
export function summarizeDice(plan: PlannedDie[]): string {
  const bySides = new Map<number, number>();
  for (const d of plan) bySides.set(d.sides, (bySides.get(d.sides) ?? 0) + 1);
  return [...bySides.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([sides, count]) => `${count}к${sides}`)
    .join(' и ');
}

/**
 * rng, отдающий введённые значения по порядку плана.
 * values[i] — результат i-й кости плана (1..sides).
 */
export function plannedValuesRng(plan: PlannedDie[], values: number[]): () => number {
  let i = 0;
  return () => {
    if (i < plan.length && i < values.length) {
      const { sides } = plan[i];
      const v = Math.min(Math.max(Math.round(values[i]), 1), sides);
      i++;
      return (v - 0.5) / sides;
    }
    i++;
    return Math.random();
  };
}
