/**
 * Искусность оружия (Weapon Mastery, PHB 2024).
 *
 * Правило: у каждого оружия есть свойство искусности (card.mastery → эффект EFFECT-0248..0255),
 * но пользоваться им может ТОЛЬКО персонаж с особенностью «Искусное владение оружием», и лишь
 * для ВЫБРАННЫХ им видов оружия (character.weaponMasteries — список card.weapon_type).
 *
 * Модель (парадигма №1): сама механика мастерства — ДАННЫЕ в эффекте (activation.trigger.event =
 * 'hit'|'miss' + effects[]), движок лишь связывает «оружие в руке → его мастерство → исход броска».
 * Связка живёт здесь, а не веткой в execute.ts, чтобы её можно было тестировать отдельно.
 *
 * Почему хук, а не пассивный триггер-слушатель: collectModifiers НЕ берёт механики с
 * activation.mode != 'passive' (инвариант «активные не залипают пассивно»), а гейт «этим ли оружием
 * бью» невыразим текущими предикатами when (item_equipped гейтит по id карты, а не по виду оружия).
 */
import type { ExecuteContext, RuntimeState, WeaponContext } from '../mvp/contracts';
import { weaponContext } from './weapon';

type Dict = Record<string, unknown>;

/** Событие, на котором срабатывает мастерство: 'hit' (большинство) или 'miss' (Задевающее). */
export type MasteryEvent = 'hit' | 'miss';

export interface ActiveMastery {
  /** id эффекта-мастерства (card.mastery). */
  id: string;
  name: string;
  /** Механика эффекта-мастерства (то, что исполнит движок). */
  mechanics: Dict;
  /** На каком исходе броска срабатывает. */
  event: MasteryEvent;
  /** Модификатор характеристики атаки этим оружием — для формул (weapon_mod). */
  weaponMod: number;
}

/** Событие мастерства из его механики: activation.trigger.event. По умолчанию 'hit'. */
export function masteryEvent(mech: Dict | null | undefined): MasteryEvent {
  const activation = (mech?.activation as Dict | undefined);
  const trigger = (activation?.trigger as Dict | undefined);
  return String(trigger?.event ?? 'hit') === 'miss' ? 'miss' : 'hit';
}

/**
 * Искусность доступна персонажу для ЭТОГО оружия?
 * Гейт — вид оружия (weapon_type) в списке выбранных. Пустой/отсутствующий список → нет искусности.
 * Оружие без weapon_type сматчить нельзя (в базе он null у трети оружия) → искусность не работает.
 */
export function knowsMastery(weapon: WeaponContext | null, masteries: string[] | undefined): boolean {
  if (!weapon?.mastery || !weapon.weaponType) return false;
  return (masteries ?? []).includes(weapon.weaponType);
}

/**
 * Активная искусность для броска атаки этой рукой: оружие в руке имеет мастерство, его вид выбран
 * персонажем, и механика мастерства предзагружена в ctx.masteryEffects. Иначе null (молча — это
 * штатная ситуация: у большинства персонажей искусности нет).
 */
export function activeMastery(
  ctx: ExecuteContext,
  state: RuntimeState,
  hand: 'main' | 'off',
): ActiveMastery | null {
  const weapon = weaponContext(ctx.character, hand, state.equipment);
  if (!knowsMastery(weapon, ctx.character.weaponMasteries)) return null;
  const rec = ctx.masteryEffects?.[weapon!.mastery!];
  const mech = rec?.mechanics as Dict | undefined;
  if (!mech || typeof mech !== 'object') return null; // механика не догружена — тихо
  // Пассивные мастерства (Быстрое/Рассекающее) — правила экономики действий и позиционирования,
  // которые движок не исполняет: они описывают себя в превью, но на исход броска не влияют.
  if (String((mech.activation as Dict | undefined)?.mode ?? 'triggered') === 'passive') return null;
  return {
    id: weapon!.mastery!,
    name: String(rec?.name ?? 'Искусность'),
    mechanics: mech,
    event: masteryEvent(mech),
    weaponMod: ctx.character.abilityMods[weapon!.ability] ?? 0,
  };
}
