import type { ForgeCharacter } from './types';
import type { CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';
import type { Card } from '../types';
import type { CharacterClass } from '../types';
import type { CharacterRuleState } from './rules/types';

/** Синхронизирует max HP в runtime с расчётным значением правил. */
export function alignRuntimeHp(state: RuntimeState, computedMax: number): RuntimeState {
  if (computedMax <= 0) return state;
  return {
    ...state,
    hp: {
      ...state.hp,
      max: computedMax,
      current: Math.min(state.hp.current, computedMax),
    },
  };
}

export function forgeToRuntimeState(c: ForgeCharacter): RuntimeState {
  const inv = (c.inventory_items ?? []).map((row) => ({
    cardId: row.card_id,
    qty: row.qty,
    ...(row.container_id ? { containerId: row.container_id } : {}),
  }));
  return {
    hp: {
      current: c.current_hp ?? 0,
      max: c.max_hp ?? 0,
      temp: typeof c.turn_state?.temp_hp === 'number' ? c.turn_state.temp_hp : 0,
    },
    resources: { ...(c.resources ?? {}) },
    maxResources: { ...(c.max_resources ?? {}) },
    equipment: { ...(c.equipment ?? {}) },
    inventory: inv,
    activeEffects: parseActiveEffects(c.active_effects),
  };
}

function parseActiveEffects(raw: unknown): RuntimeState['activeEffects'] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object') as RuntimeState['activeEffects'];
}

/**
 * «Богатая» цель из уже-персистнутого персонажа — БЕЗ пересборки (assemble/resolveCharacterRules).
 * AC/спасброски/навыки берём из снимка rule_state; hp/состояния/сопротивления/ресурсы — из
 * forgeToRuntimeState. Движок применяет к target.runtimeState урон/лечение/эффекты (who:'target')
 * и возвращает мутированную копию в ExecuteResult.targetState (её лист персистит выбранному персонажу).
 */
export function buildTargetFromCharacter(c: ForgeCharacter): TargetContext {
  const rs = c.rule_state as CharacterRuleState | undefined;
  const characterContext: CharacterContext | undefined = rs ? {
    abilityMods: rs.abilityMods,
    profBonus: rs.proficiencyBonus,
    level: c.level ?? 1,
    variables: rs.variables,
    saveProficiencies: rs.proficiencies?.savingThrows,
    skillProficiencies: rs.proficiencies?.skills,
    skillExpertise: rs.expertise?.skills,
  } : undefined;
  return {
    ac: rs?.armorClass ?? c.armor_class ?? 10,
    checkMods: rs?.skillBonuses,          // для состязаний (Толчок/Подножка): навыки цели
    characterContext,
    runtimeState: forgeToRuntimeState(c),
  };
}

export function runtimeInventoryPayload(state: RuntimeState) {
  return state.inventory.map((row) => ({ card_id: row.cardId, qty: row.qty, ...(row.containerId ? { container_id: row.containerId } : {}) }));
}

export function classLevelKey(klass: CharacterClass | null): string | null {
  if (!klass) return null;
  const cn = klass.card_number || '';
  const m = cn.match(/CLASS[-_](.+)/i);
  if (m) return m[1].toLowerCase().replace(/-/g, '_');
  return klass.id;
}

export function buildCharacterContext(
  ruleState: CharacterRuleState,
  draft: { level: number; abilities: Record<string, number> },
  equippedCards: Card[],
  klass?: CharacterClass | null,
): CharacterContext {
  const classKey = classLevelKey(klass ?? null);
  return {
    abilityMods: ruleState.abilityMods,
    profBonus: ruleState.proficiencyBonus,
    level: draft.level,
    classLevels: classKey ? { [classKey]: draft.level } : undefined,
    variables: ruleState.variables,
    characterSpeed: ruleState.speed,
    baseSpeed: ruleState.baseSpeed,
    baseSize: ruleState.size,
    hitDie: klass?.hit_die ?? null,
    equippedCards,
    knownCards: equippedCards,
    spellcastingMod: ruleState.spellcasting
      ? ruleState.abilityMods[ruleState.spellcasting.ability]
      : undefined,
    saveProficiencies: ruleState.proficiencies.savingThrows,
    skillProficiencies: ruleState.proficiencies.skills,
    skillExpertise: ruleState.expertise.skills,
  };
}

export function buildExecuteContext(
  ruleState: CharacterRuleState,
  draft: { level: number; abilities: Record<string, number> },
  equippedCards: Card[],
  klass: CharacterClass | null | undefined,
  passives: Record<string, unknown>[],
): import('../mvp/contracts').ExecuteContext & { passives?: Record<string, unknown>[] } {
  return {
    character: buildCharacterContext(ruleState, draft, equippedCards, klass),
    passives,
    rng: () => Math.random(),
  };
}

/** Множитель грузоподъёмности по размеру (D&D 2024): Крошечный ×0.5, Маленький/Средний ×1,
 *  далее ×2 за каждую категорию (Большой ×2, Огромный ×4, Громадный ×8). */
export function carrySizeMultiplier(size: number): number {
  if (size <= 0) return 0.5;
  if (size <= 2) return 1;
  return 2 ** (size - 2);
}
/** Грузоподъёмность: Сила ×15 × множитель размера. size по умолчанию Средний (2). */
export function carryingCapacity(strScore: number, size = 2): number {
  return Math.floor(strScore * 15 * carrySizeMultiplier(size));
}

export function addToInventory(state: RuntimeState, cardId: string, qty = 1): RuntimeState {
  const inventory = state.inventory.map((row) => ({ ...row }));
  // S4: добавляем на ВЕРХНИЙ уровень (containerId пусто) — не в стопку внутри контейнера.
  const row = inventory.find((r) => r.cardId === cardId && r.containerId == null);
  if (row) row.qty += qty;
  else inventory.push({ cardId, qty });
  return { ...state, inventory };
}

export function removeFromInventory(state: RuntimeState, cardId: string, qty = 1): RuntimeState {
  // S4: списываем ВСЕГО qty, предпочитая верхний уровень (потом из контейнеров) — стопки предмета
  // теперь могут быть в разных локациях, наивный decrement-по-cardId списал бы каждую.
  let remaining = Math.max(0, Math.floor(qty) || 0);
  const order = state.inventory
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.cardId === cardId)
    .sort((a, b) => ((a.r.containerId ? 1 : 0) - (b.r.containerId ? 1 : 0)) || (a.i - b.i));
  const take = new Map<number, number>();
  for (const { r, i } of order) {
    if (remaining <= 0) break;
    const t = Math.min(r.qty, remaining);
    take.set(i, t);
    remaining -= t;
  }
  const inventory = state.inventory
    .map((r, i) => (take.has(i) ? { ...r, qty: r.qty - (take.get(i) ?? 0) } : { ...r }))
    .filter((r) => r.qty > 0);
  return { ...state, inventory };
}
