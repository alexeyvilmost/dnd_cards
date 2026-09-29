/**
 * Вычисление «Обстоятельств» (unified-mechanics-schema.md §5.5): предикаты
 * when/circumstances на модификаторах и триггерах. До фазы C движок их не вычислял
 * (0 ссылок в engine/) — условные пассивки применялись безусловно. Здесь — маленький
 * интерпретатор предикатов над контекстом броска.
 *
 * Гейт по умолчанию ЗАКРЫТ: нераспознанный/пока не реализованный предикат считается
 * НЕвыполненным (false) — модификатор-ограничитель не применяется, пока движок не умеет
 * подтвердить условие (иначе «+1 КД, пока в руке щит» висел бы всегда). Исключение —
 * narrative (на усмотрение ГМ, не блокирует). Предикаты, для которых данных нет прямо
 * сейчас (например «у цели состояние», а цели нет), тоже дают false — условие не выполнено.
 */
import type { AdvantageState, CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';
import {isHiddenByAction,targetIsUnarmored,isTransformedOrDisguised} from './itemCircumstances';
import {itemGate} from '../character/attunement';
import { expandConditionSet } from './conditions';
import { isShieldCard, isWearingArmor } from './equipment';
import { eventOccurrenceCount, OCCURRENCE_PERIODS, type OccurrencePeriod } from './eventOccurrence';

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
  const suppressed=suppressedConditionsOf(state);
  for (const e of state.activeEffects) {
    const m = e.mechanics as Dict;
    if (m?.kind === 'condition' && m.value&&!suppressed.has(String(m.value))) raw.push(String(m.value));
  }
  return expandConditionSet(raw);
}

/** An item-backed suppression masks a condition without deleting its source or duration. */
export function suppressedConditionsOf(state:RuntimeState|undefined):Set<string>{
  const result=new Set<string>();
  if(!state)return result;
  for(const effect of state.activeEffects){
    const payload=effect.mechanics as Dict;
    if(payload?.kind!=='condition_immunity'||payload.suppress_existing!==true||typeof payload.condition!=='string')continue;
    const required=payload.requires_equipped_item_id;
    if(typeof required==='string'&&!Object.values(state.equipment).includes(required))continue;
    result.add(payload.condition);
  }
  return result;
}

/** Вычислить один предикат обстоятельства. Нераспознанный гейт → false (closed-by-default); narrative → true. */
export function evaluateCondition(cond: Dict, ctx: EvalContext): boolean {
  const kind = String(cond.kind ?? '');
  switch (kind) {
    case 'target_damage_since_source_turn': {
      const owner=ctx.character?.combatHistory,target=ctx.target?.characterContext?.combatHistory;
      if(!owner||!target)return false;
      const dealt=target.damageDealt>owner.turnEnded;
      return cond.value===false?!dealt:dealt;
    }
    case 'target_item_active': {
      const card=ctx.target?.characterContext?.knownCards?.find(row=>row.id===cond.value),state=ctx.target?.runtimeState;
      return !!card&&!!state&&itemGate(card,{equipment:state.equipment,inventory:state.inventory,attuned:ctx.target?.characterContext?.attunedIds??[]});
    }
    case 'target_illuminated': return ['bright', 'dim'].includes(ctx.target?.characterContext?.illumination?.level ?? '');
    case 'in_dim_light_or_darkness': return ['dim', 'dark'].includes(ctx.character?.illumination?.level ?? '');
    case 'in_open_night_sky': return ctx.character?.environmentObservations?.openNightSky === true;
    case 'near_sea': return typeof ctx.character?.environmentObservations?.nearestSeaFt === 'number' && ctx.character.environmentObservations.nearestSeaFt <= Number(cond.range_ft);
    case 'in_darkness': return ctx.character?.illumination?.level === 'dark';
    case 'in_daylight': return ctx.character?.illumination?.daylight === true;
    case 'you_are_hidden': return isHiddenByAction(ctx.state);
    case 'target_unarmored': return targetIsUnarmored(ctx.target);
    case 'you_transformed_or_disguised': return isTransformedOrDisguised(ctx.state);
    case 'target_nearby_enemies':
    case 'nearby_enemies': {
      const radius = Number(cond.range_ft), minimum = Number(cond.min ?? 1);
      const facts = kind==='target_nearby_enemies'?ctx.target?.characterContext?.spatialObservations:ctx.character?.spatialObservations;
      if (!facts || !Number.isFinite(radius) || radius < 0 || !Number.isInteger(minimum) || minimum < 1) return false;
      return facts.nearby.filter(creature => creature.relation === 'enemy' && creature.conscious!==false && creature.distanceFt <= radius).length >= minimum;
    }
    case 'in_encounter': return ctx.state?.encounterActive === true;
    case 'resource_at_most': {
      const id=typeof cond.id==='string'?cond.id:'';
      const maximum=Number(cond.value);
      const current=id?ctx.state?.resources[id]:undefined;
      return typeof current==='number' && Number.isFinite(current) && Number.isFinite(maximum) && current<=maximum;
    }
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
    case 'item_source_active': {
      const card=ctx.character?.knownCards?.find(card=>card.id===(cond.id??cond.value));
      return !!card&&!!ctx.state&&itemGate(card,{equipment:ctx.state.equipment,inventory:ctx.state.inventory,attuned:ctx.character?.attunedIds??[]});
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
      ], typeof cond.category === 'string' ? cond.category : undefined);
    case 'wielding_shield': {
      if (!ctx.state || !ctx.character) return false;
      const equipped = new Set([ctx.state.equipment?.main_hand, ctx.state.equipment?.off_hand].filter(Boolean));
      return [...(ctx.character.equippedCards ?? []), ...(ctx.character.knownCards ?? [])]
        .some((card) => equipped.has(card.id) && isShieldCard(card));
    }
    case 'you_have_condition':
      return ctx.activeConditions?.has(String(cond.value)) ?? false;
    case 'concentrating':
      return ctx.state?.activeEffects.some((entry) => (entry.mechanics as Dict)?.kind === 'concentration') ?? false;
    case 'hp_fraction_at_most': {
      const threshold = Number(cond.value);
      const hp = ctx.state?.hp;
      return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
        && !!hp && hp.max > 0 && hp.current >= 0 && hp.current <= hp.max * threshold;
    }
    case 'hp_fraction_below': {
      const threshold=Number(cond.value),hp=ctx.state?.hp;
      return Number.isFinite(threshold)&&threshold>=0&&threshold<=1&&!!hp&&hp.max>0&&hp.current>=0&&hp.current<hp.max*threshold;
    }
    case 'class_id_in': {
      if(!Array.isArray(cond.values)||!cond.values.length||!ctx.character?.classLevels)return false;
      return cond.values.some(value=>typeof value==='string'&&Number(ctx.character!.classLevels![value])>0);
    }
    case 'equipment_slot_equals':
      return typeof cond.slot==='string'&&typeof cond.id==='string'&&cond.id.length>0
        &&ctx.state?.equipment[cond.slot]===cond.id;
    case 'character_size':
      return typeof ctx.character?.baseSize==='number'&&Number.isFinite(Number(cond.value))&&ctx.character.baseSize===Number(cond.value);
    case 'target_has_effect': {
      if(typeof cond.value!=='string'||!ctx.target?.runtimeState)return false;
      return ctx.target.runtimeState.activeEffects.some(entry=>(entry.entityRef?.id===cond.value
        ||entry.entityRef?.cardNumber===cond.value||(entry.mechanics as Dict).stack_id===cond.value)
        &&(cond.source!=='self'||(!!ctx.rollerActorId&&entry.sourceId===ctx.rollerActorId)));
    }
    case 'you_have_effect_stack': {
      const stackId = String(cond.value ?? cond.id ?? '').trim();
      if (!stackId || !ctx.state) return false;
      return ctx.state.activeEffects.some((entry) => (
        (entry.mechanics as Dict | undefined)?.stack_id === stackId
      ));
    }
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
    case 'roller_is_not_condition_source':
      return !!ctx.conditionSourceId && !!ctx.rollerActorId
        && ctx.rollerActorId !== ctx.conditionSourceId;
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
    case 'event_data_number': {
      const key = typeof cond.key === 'string' ? cond.key : '';
      const value = ctx.event?.data?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      const min = cond.min === undefined ? -Infinity : Number(cond.min);
      const max = cond.max === undefined ? Infinity : Number(cond.max);
      return !Number.isNaN(min) && !Number.isNaN(max) && min <= max && value >= min && value <= max;
    }
    case 'moved_distance_ft': {
      const value = ctx.state?.turnMovementFt;
      // An absent observation is unknown, particularly in imported old fights.
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      const min = cond.min === undefined ? 0 : Number(cond.min);
      const max = cond.max === undefined ? Infinity : Number(cond.max);
      return !Number.isNaN(min) && !Number.isNaN(max) && min <= max && value >= min && value <= max;
    }
    case 'event_count_below': {
      if (!ctx.state || typeof cond.id !== 'string' || !cond.id
        || !OCCURRENCE_PERIODS.includes(cond.per as OccurrencePeriod)
        || !Number.isSafeInteger(cond.threshold) || Number(cond.threshold) < 1) return false;
      const target = cond.group_by === 'target' ? ctx.rollTargetActorId : undefined;
      if (cond.group_by === 'target' && !target) return false;
      return eventOccurrenceCount(ctx.state,cond.id,cond.per as OccurrencePeriod,target) < Number(cond.threshold);
    }
    case 'living_at_zero_hp':
      return ctx.state?.hp.current === 0 && ctx.state.deathSaves?.dead !== true;
    case 'target_creature_type_in':
      return Array.isArray(cond.values)&&cond.values.some(value=>creatureTypeMatches(ctx.target?.characterContext?.creatureType,value));
    case 'target_relation_in':
      return Array.isArray(cond.values)&&cond.values.includes(ctx.target?.relationToSource);
    case 'event_creature_type_in': {
      if(typeof cond.key!=='string'||!Array.isArray(cond.values))return false;
      const observed=ctx.event?.data?.[cond.key];
      return typeof observed==='string'&&cond.values.some(value=>creatureTypeMatches(observed,value));
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
      // ограничитель («+1 КД, пока в руке щит») применялся бы ВСЕГДА, завышая статы. Как только
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
