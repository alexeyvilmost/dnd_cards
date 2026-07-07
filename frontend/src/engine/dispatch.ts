/**
 * Шина событий и подбор слушателей триггеров/реакций (фаза A).
 *
 * До фазы A движок был pull-based: activation.mode:"triggered" исполнялся только для
 * long_rest, реакции не срабатывали. Здесь — ЧИСТЫЙ подбор слушателей события среди
 * пассивок и активных эффектов. Само исполнение слушателей и сбор pendingReactions —
 * в execute.ts (там живёт исполнитель), чтобы не создавать циклическую зависимость.
 *
 * Модель (по образцу Interrupt из BG3, docs/engine-architecture-review §5):
 * - слушатель = механика с activation.mode ∈ {triggered, reaction} и
 *   activation.trigger.event === событию, у которой выполнены circumstances;
 * - «авто» (triggered без стоимости) исполняется сразу (Скрытая атака, авто-эффекты);
 * - «предложение» (reaction или triggered со стоимостью) уходит игроку как ReactionOffer.
 */
import type { ReactionOffer, RuntimeState } from '../mvp/contracts';
import { matchesWhen, type EvalContext } from './circumstances';

type Dict = Record<string, unknown>;

export interface DomainEvent {
  kind: string;
  timing?: 'before' | 'during' | 'after' | 'replaces';
  /** Данные события (напр. { amount } для damage_taken). */
  data?: Dict;
}

export interface ListenerMatch {
  id: string;
  name: string;
  mechanics: Dict;
  mode: 'triggered' | 'reaction';
  cost: Dict[];
  /** uses.per (turn|round|…) для гейта «раз за ход». */
  usesPer?: string;
}

function listenerFrom(mech: Dict, name: string): ListenerMatch | null {
  const act = mech.activation as Dict | undefined;
  const mode = String(act?.mode ?? '');
  if (mode !== 'triggered' && mode !== 'reaction') return null;
  const uses = mech.uses as Dict | undefined;
  return {
    id: String(mech.id ?? name),
    name,
    mechanics: mech,
    mode,
    cost: (act?.cost as Dict[]) ?? [],
    usesPer: uses?.per != null ? String(uses.per) : undefined,
  };
}

/**
 * Найти слушателей события среди активных эффектов и пассивок.
 * Отбор: mode ∈ {triggered, reaction} · trigger.event === ev.kind · circumstances
 * выполнены · timing совпадает (если задан и у события, и у триггера).
 */
export function collectListeners(
  ev: DomainEvent,
  state: RuntimeState,
  passives: Dict[],
  evalCtx?: EvalContext,
): ListenerMatch[] {
  const out: ListenerMatch[] = [];
  const sources: Array<{ name: string; mech: Dict }> = [
    ...state.activeEffects.map((e) => ({ name: e.name, mech: e.mechanics as Dict })),
    ...passives.map((m, i) => ({ name: String((m as Dict).name ?? `пассивка ${i}`), mech: m })),
  ];
  for (const { name, mech } of sources) {
    if (!mech || typeof mech !== 'object') continue;
    const act = mech.activation as Dict | undefined;
    const trig = act?.trigger as Dict | undefined;
    if (!trig || String(trig.event ?? '') !== ev.kind) continue;
    const trigTiming = trig.timing != null ? String(trig.timing) : undefined;
    if (ev.timing && trigTiming && trigTiming !== ev.timing) continue;
    if (!matchesWhen(trig.circumstances as Dict[] | undefined, evalCtx)) continue;
    const lm = listenerFrom(mech, name);
    if (lm) out.push(lm);
  }
  return out;
}

/** Автоматический слушатель — triggered без стоимости (исполняется сразу). */
export function isAuto(m: ListenerMatch): boolean {
  return m.mode === 'triggered' && m.cost.length === 0;
}

/** Обернуть слушателя-«предложение» в ReactionOffer для UI. */
export function toOffer(m: ListenerMatch, ev: DomainEvent): ReactionOffer {
  return {
    listenerId: m.id,
    name: m.name,
    mechanics: m.mechanics,
    cost: m.cost,
    event: { kind: ev.kind, ...(ev.timing ? { timing: ev.timing } : {}) },
  };
}
