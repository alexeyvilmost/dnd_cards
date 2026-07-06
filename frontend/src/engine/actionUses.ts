/**
 * Использования-на-действие (mechanics.uses): «Второе дыхание», «Всплеск
 * действий», «Оружие дыхания» и т.п. — не ресурсы персонажа, их запас живёт
 * в самом действии. Реализация: виртуальный пул ресурсов с ключом
 * uses_<card_number|id действия>, который тратится обычными canPay/pay
 * и восстанавливается отдыхами по recharge-карте (uses.per).
 *
 * Конвенция UI: панели ресурсов СКРЫВАЮТ ключи с префиксом uses_
 * (см. isActionUsesKey) — остаток рисуется на строке самого действия.
 */

type Dict = Record<string, unknown>;

export const ACTION_USES_PREFIX = 'uses_';

export type ActionUses = { count: number | string; per?: string };

/** Ключ виртуального пула: uses_<card_number|id>. */
export function actionUsesKey(ref: string): string {
  return `${ACTION_USES_PREFIX}${ref}`;
}

export function isActionUsesKey(key: string): boolean {
  return key.startsWith(ACTION_USES_PREFIX);
}

/** Валидное mechanics.uses ({count, per}) или null. */
export function usesFromMechanics(mech: Dict | null | undefined): ActionUses | null {
  if (!mech || typeof mech !== 'object') return null;
  const uses = mech.uses as Dict | undefined;
  if (!uses || typeof uses !== 'object') return null;
  const count = uses.count;
  if (typeof count !== 'number' && typeof count !== 'string') return null;
  return { count, per: typeof uses.per === 'string' ? uses.per : undefined };
}

/**
 * Добавляет к активационной стоимости трату одного использования
 * ({resource: uses_<key>, amount: 1}). Идемпотентно; без mechanics.uses —
 * возвращает механику как есть.
 */
export function applyActionUsesCost(mech: Dict, usesKey: string): Dict {
  if (!usesFromMechanics(mech)) return mech;
  const activation = { ...(mech.activation as Dict | undefined) };
  const cost = Array.isArray(activation.cost) ? [...(activation.cost as Dict[])] : [];
  if (cost.some((c) => c && c.resource === usesKey)) return mech;
  cost.push({ resource: usesKey, amount: 1 });
  activation.cost = cost;
  return { ...mech, activation };
}
