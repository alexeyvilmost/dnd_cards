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
import {payloadsOf} from './mechanicsView';

type Dict = Record<string, unknown>;

export interface DomainEvent {
  kind: string;
  timing?: 'before' | 'during' | 'after' | 'replaces';
  /** Данные события (напр. { amount } для damage_taken). */
  data?: Dict;
  /** Источник события. Явный subject:self допускает только владельца контекста;
   * старые слушатели без subject сохраняют прежнюю область подписки. */
  source?: string;
  target?: string;
}

export interface ListenerMatch {
  id: string;
  name: string;
  mechanics: Dict;
  mode: 'triggered' | 'reaction';
  cost: Dict[];
  /** uses.per (turn|round|…) для гейта «раз за ход». */
  usesPer?: string;
  /** activation.optional — свободный, но НЕОБЯЗАТЕЛЬНЫЙ триггер: предлагается игроку, а не срабатывает
   *  сам (особенности Голиафа «свободное действие при попадании» — игрок решает применять или нет). */
  optional?: boolean;
  /** Formulas snapshotted when a durable triggered effect was applied. */
  formulaVariables?: Record<string, number>;
}

function listenerFrom(mech: Dict, name: string): ListenerMatch | null {
  const act = mech.activation as Dict | undefined;
  const mode = String(act?.mode ?? '');
  if (mode !== 'triggered' && mode !== 'reaction') return null;
  const uses = mech.uses as Dict | undefined;
  const trig = act?.trigger as Dict | undefined;
  const rawFormulaVariables = mech.formula_variables;
  const formulaVariables = rawFormulaVariables && typeof rawFormulaVariables === 'object'
    && !Array.isArray(rawFormulaVariables)
    ? Object.fromEntries(Object.entries(rawFormulaVariables as Dict).flatMap(([key, value]) => (
      typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : []
    )))
    : undefined;
  return {
    id: String(mech.id ?? name),
    name,
    mechanics: mech,
    mode,
    cost: (act?.cost as Dict[]) ?? [],
    usesPer: uses?.per != null ? String(uses.per) : undefined,
    optional: act?.optional === true || trig?.prompt === true,
    ...(formulaVariables && Object.keys(formulaVariables).length ? { formulaVariables } : {}),
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
  // A passive item/feature may subscribe to multiple ordinary event listeners.
  // These remain data on the owned passive; they do not create permanent
  // runtime effects merely because the item was assembled or previewed.
  const expanded = sources.flatMap(({name,mech}) => {
    const mode = (mech?.activation as Dict | undefined)?.mode;
    if (mode !== undefined && mode !== 'passive') return [{name,mech}];
    const nested = payloadsOf(mech).flatMap((payload,index) => {
      if (payload.kind !== 'triggered_effect' || typeof payload.event !== 'string' || !Array.isArray(payload.effects)) return [];
      return [{name,mech:{
        id: String(payload.id ?? `${String(mech.id ?? name)}:trigger:${index}`),
        activation:{mode:'triggered',trigger:{event:payload.event,subject:payload.subject ?? 'self',circumstances:payload.circumstances}},
        effects:payload.effects,uses:payload.uses,
      }}];
    });
    return [{name,mech},...nested];
  });
  for (const { name, mech } of expanded) {
    if (!mech || typeof mech !== 'object') continue;
    const act = mech.activation as Dict | undefined;
    const trig = act?.trigger as Dict | undefined;
    if (!trig || String(trig.event ?? '') !== ev.kind) continue;
    if (trig.subject === 'self' && ev.source !== 'self'
      && (!evalCtx?.rollerActorId || ev.source !== evalCtx.rollerActorId)) continue;
    const trigTiming = trig.timing != null ? String(trig.timing) : undefined;
    if (ev.timing && trigTiming && trigTiming !== ev.timing) continue;
    if (!matchesWhen(
      trig.circumstances as Dict[] | undefined,
      { ...(evalCtx ?? {}), event: { kind: ev.kind, ...(ev.data ? { data: ev.data } : {}) } },
    )) continue;
    const lm = listenerFrom(mech, name);
    if (lm) out.push(lm);
  }
  return out;
}

/** Автоматический слушатель — triggered без стоимости и НЕ optional (исполняется сразу).
 *  optional-триггер (свободный, но по выбору игрока — Голиаф) уходит в предложение. */
export function isAuto(m: ListenerMatch): boolean {
  return m.mode === 'triggered' && m.cost.length === 0 && !m.optional;
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
