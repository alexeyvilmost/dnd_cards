/**
 * Вычисление «Обстоятельств» (unified-mechanics-schema.md §5.5): предикаты
 * when/circumstances на модификаторах и триггерах. До фазы C движок их не вычислял
 * (0 ссылок в engine/) — условные пассивки применялись безусловно. Здесь — маленький
 * интерпретатор предикатов над контекстом броска.
 *
 * Гейт по умолчанию ЗАКРЫТ: нераспознанный/пока не реализованный предикат считается
 * НЕвыполненным (false) — модификатор-ограничитель не применяется, пока движок не умеет
 * подтвердить условие (иначе «+1 КЗ, пока в руке щит» висел бы всегда). Исключение —
 * narrative (на усмотрение ГМ, не блокирует). Предикаты, для которых данных нет прямо
 * сейчас (например «у цели состояние», а цели нет), тоже дают false — условие не выполнено.
 */
import type { AdvantageState, CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';
import { expandConditionSet } from './conditions';
import { isShieldCard, isWearingArmor } from './equipment';

type Dict = Record<string, unknown>;

export interface EvalContext {
  character?: CharacterContext;
  state?: RuntimeState;
  target?: TargetContext;
  /** Состояния (kind:'condition' value), активные на владельце листа. */
  activeConditions?: Set<string>;
  /** Состояния на цели (заполнится в фазе E — двусторонний бой). */
  targetConditions?: Set<string>;
  /** Состояния, которые текущий спасбросок пытается ИЗБЕЖАТЬ (из on_fail эффекта-сейва).
   *  Для предиката save_avoids_condition — «преимущество/бонус на спас, чтобы не получить X». */
  savedConditions?: Set<string>;
  /** Преимущество, накопленное к текущему моменту сбора (для has_advantage). */
  advantageSoFar?: AdvantageState;
  /** Результат последнего d20 (для d20_equals). */
  lastD20?: number;
  /** Current engine event when evaluating a triggered listener. */
  event?: { kind: string; data?: Dict };
  /** Stable actor identities for condition-source predicates. */
  rollerActorId?: string;
  rollTargetActorId?: string;
  /** Canonical broad/subtyped creature type of the creature making the roll. */
  rollerCreatureType?: string;
  /** ActiveEffectEntry.sourceId of the condition whose payload is evaluated. */
  conditionSourceId?: string;
  /** Stable id of the creature that carries the evaluated condition. */
  conditionOwnerId?: string;
  /** Explicit board/GM observations keyed by condition source actor id. */
  conditionSourceFacts?: Record<string, { lineOfSight: boolean }>;
  /** Explicit symmetric distance facts keyed actor -> actor -> feet. */
  distancesFt?: Record<string, Record<string, number>>;
  /** Explicit directed visibility facts keyed observer -> observed actor. */
  visibility?: Record<string, Record<string, boolean>>;
}

export function creatureTypeMatches(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const normalizedActual = actual.trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();
  if (!normalizedActual || !normalizedExpected) return false;
  return normalizedActual === normalizedExpected || normalizedActual.startsWith(`${normalizedExpected}:`);
}

/** Собрать множество активных состояний владельца из RuntimeState (с раскрытием композиции F:
 *  «Без сознания» → тоже «Недееспособен» и т.д. — чтобы предикаты видели унаследованные состояния). */
export function activeConditionsOf(state: RuntimeState | undefined): Set<string> {
  const raw: string[] = [];
  if (!state) return new Set();
  for (const e of state.activeEffects) {
    const m = e.mechanics as Dict;
    if (m?.kind === 'condition' && m.value) raw.push(String(m.value));
  }
  return expandConditionSet(raw);
}

/** Вычислить один предикат обстоятельства. Нераспознанный гейт → false (closed-by-default); narrative → true. */
export function evaluateCondition(cond: Dict, ctx: EvalContext): boolean {
  const kind = String(cond.kind ?? '');
  switch (kind) {
    case 'any_of': {
      const of = (cond.of as Dict[]) ?? [];
      return of.length === 0 || of.some((c) => evaluateCondition(c, ctx));
    }
    case 'all_of': {
      const of = (cond.of as Dict[]) ?? [];
      return of.every((c) => evaluateCondition(c, ctx));
    }
    case 'not': {
      const of = cond.of as Dict | undefined;
      return of ? !evaluateCondition(of, ctx) : true;
    }
    // ПРЕДМЕТНЫЕ ПРЕДИКАТЫ (S2). id из cond.id | cond.value. Оживляют when-гейты «пока предмет X
    // надет/в сумке/настроен» (S2/S6). ВАЖНО: enforced лишь там, где collectModifiers получает evalCtx
    // (боевые броски — execute/turn). Лист (breakdown/AC/ручной бросок) evalCtx пока не передаёт → when
    // там не блокирует (пре-существующее поведение ВСЕХ when-предикатов; сквозной evalCtx — отдельная
    // задача к S6). Closed-by-default: нет id/state → false, и НИКОГДА не бросаем (мягкие guard'ы).
    case 'item_equipped': {
      const id = String(cond.id ?? cond.value ?? '');
      if (!id || !ctx.state) return false;
      return Object.values(ctx.state.equipment ?? {}).some((v) => v === id);
    }
    case 'item_carried': {
      const id = String(cond.id ?? cond.value ?? '');
      if (!id || !ctx.state) return false;
      if (Object.values(ctx.state.equipment ?? {}).some((v) => v === id)) return true;
      return ((ctx.state.inventory ?? []).find((r) => r.cardId === id)?.qty ?? 0) > 0;
    }
    case 'attuned': {
      const id = String(cond.id ?? cond.value ?? '');
      return !!id && (ctx.character?.attunedIds?.includes(id) ?? false);
    }
    case 'wearing_armor':
      return isWearingArmor(ctx.state, [
        ...(ctx.character?.equippedCards ?? []),
        ...(ctx.character?.knownCards ?? []),
      ]);
    case 'wielding_shield': {
      if (!ctx.state || !ctx.character) return false;
      const equipped = new Set([ctx.state.equipment?.main_hand, ctx.state.equipment?.off_hand].filter(Boolean));
      return [...(ctx.character.equippedCards ?? []), ...(ctx.character.knownCards ?? [])]
        .some((card) => equipped.has(card.id) && isShieldCard(card));
    }
    case 'you_have_condition':
      return ctx.activeConditions?.has(String(cond.value)) ?? false;
    case 'target_has_condition':
      return ctx.targetConditions?.has(String(cond.value)) ?? false;
    case 'save_avoids_condition':
      // «Спасбросок, чтобы ИЗБЕЖАТЬ состояния X» — истинно, когда текущий сейв налагает X при провале
      // (Происхождение фей: преимущество на спас против Очарования). savedConditions заполняет runSave.
      return ctx.savedConditions?.has(String(cond.value)) ?? false;
    case 'condition_source_in_line_of_sight': {
      const sourceId = ctx.conditionSourceId;
      return !!sourceId && ctx.conditionSourceFacts?.[sourceId]?.lineOfSight === true;
    }
    case 'roll_target_is_condition_source':
      return !!ctx.conditionSourceId && !!ctx.rollTargetActorId
        && ctx.rollTargetActorId === ctx.conditionSourceId;
    case 'roll_target_is_not_condition_source':
      return !!ctx.conditionSourceId && !!ctx.rollTargetActorId
        && ctx.rollTargetActorId !== ctx.conditionSourceId;
    case 'roller_is_condition_source':
      return !!ctx.conditionSourceId && !!ctx.rollerActorId
        && ctx.rollerActorId === ctx.conditionSourceId;
    case 'distance_to_condition_owner': {
      const ownerId = ctx.conditionOwnerId;
      const subjectId = cond.subject === 'roll_target' ? ctx.rollTargetActorId : ctx.rollerActorId;
      if (!ownerId || !subjectId) return false;
      const distance = ctx.distancesFt?.[subjectId]?.[ownerId]
        ?? ctx.distancesFt?.[ownerId]?.[subjectId];
      const feet = Number(cond.feet);
      if (typeof distance !== 'number' || !Number.isFinite(distance)
        || !Number.isFinite(feet) || feet < 0) return false;
      const observedDistanceFt: number = distance;
      if (cond.operator === 'lte') return observedDistanceFt <= feet;
      if (cond.operator === 'lt') return observedDistanceFt < feet;
      if (cond.operator === 'gte') return observedDistanceFt >= feet;
      if (cond.operator === 'gt') return observedDistanceFt > feet;
      if (cond.operator === 'eq') return observedDistanceFt === feet;
      return false;
    }
    case 'observer_can_see_condition_owner': {
      const ownerId = ctx.conditionOwnerId;
      const observerId = cond.observer === 'roll_target'
        ? ctx.rollTargetActorId
        : ctx.rollerActorId;
      if (!ownerId || !observerId || typeof cond.value !== 'boolean') return false;
      return ctx.visibility?.[observerId]?.[ownerId] === cond.value;
    }
    case 'condition':
      // Легаси-форма расовых черт «преимущество на спас против X» ({kind:'condition', id:X}) — движок
      // раньше её не знал (закрыто-по-умолчанию), а до передачи evalCtx в сейв она применялась БЕЗУСЛОВНО.
      // Трактуем как save_avoids_condition (эти черты — Дворфская стойкость/Храбрость — про сейв ПРОТИВ
      // состояния). На не-сейв путях savedConditions пуст → false (как и было). id из cond.id | cond.value.
      return ctx.savedConditions?.has(String(cond.id ?? cond.value)) ?? false;
    case 'has_advantage':
      return ctx.advantageSoFar === 'advantage';
    case 'attack_weapon_property': {
      const properties = ctx.event?.data?.weaponProperties;
      return ctx.event?.kind === 'hit' && Array.isArray(properties)
        && properties.map(String).includes(String(cond.value));
    }
    case 'attack_range':
      return ctx.event?.kind === 'hit' && ctx.event.data?.attackRange === cond.value;
    case 'attack_advantage_state':
      return ctx.event?.kind === 'hit' && ctx.event.data?.advantage === cond.value;
    case 'nearby_eligible_ally_to_target':
      return ctx.event?.kind === 'hit' && ctx.event.data?.nearbyEligibleAllyToTarget === true;
    case 'event_data_equals': {
      const key = typeof cond.key === 'string' ? cond.key : '';
      if (!key || !ctx.event?.data) return false;
      return ctx.event.data[key] === cond.value;
    }
    case 'roller_creature_type_in': {
      if (!Array.isArray(cond.values) || cond.values.length === 0) return false;
      return cond.values.some((candidate) => creatureTypeMatches(ctx.rollerCreatureType, candidate));
    }
    case 'd20_equals':
      return ctx.lastD20 != null && ctx.lastD20 === Number(cond.value);
    case 'narrative':
      // Текстовое условие — на усмотрение ГМ; движок не блокирует.
      return true;
    default:
      // Нераспознанный предикат — это ЯВНЫЙ гейт, который движок пока не умеет проверить.
      // Считаем условие НЕвыполненным (false), а не «истинным по умолчанию»: иначе модификатор-
      // ограничитель («+1 КЗ, пока в руке щит») применялся бы ВСЕГДА, завышая статы. Как только
      // предикат реализуют — гейт заработает точно. (narrative выше — намеренное исключение.)
      return false;
  }
}

/** true, если все when-условия выполнены (или их нет / нет контекста для оценки). */
export function matchesWhen(when: Dict[] | undefined, ctx?: EvalContext): boolean {
  if (!when || when.length === 0) return true;
  if (!ctx) return true; // нет контекста — не блокируем (обратная совместимость)
  return when.every((c) => evaluateCondition(c, ctx));
}
