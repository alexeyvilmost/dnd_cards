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

/** Кости из событий одного прогона, в порядке броска. */
export function extractDiceFromEvents(events: EngineEvent[]): PlannedDie[] {
  const out: PlannedDie[] = [];
  for (const e of events) {
    if (e.type === 'roll') {
      for (const d of e.roll.dice) out.push({ sides: d.sides, label: e.label });
    } else if (e.type === 'damage' && e.roll) {
      const t = DAMAGE_LABEL[e.damageType] ?? e.damageType;
      for (const d of e.roll.dice) out.push({ sides: d.sides, label: `Урон (${t})` });
    } else if (e.type === 'healing' && e.roll) {
      for (const d of e.roll.dice) out.push({ sides: d.sides, label: 'Лечение' });
    }
  }
  return out;
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
