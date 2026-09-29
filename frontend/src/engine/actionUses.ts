/**
 * Использования-на-действие (mechanics.uses): «Второе дыхание», «Всплеск
 * действий», «Оружие дыхания» и т.п. — не ресурсы персонажа, их запас живёт
 * в самом действии. Реализация: виртуальный пул ресурсов с ключом
 * uses_<card_number|id действия>, который тратится обычными canPay/pay
 * и восстанавливается отдыхами по recharge-карте (legacy uses.per) либо
 * явной bounded-политике mechanics.uses.recovery.
 *
 * Важно: наличие mechanics.uses только объявляет пул. Оно НЕ добавляет цену
 * активации. Трата должна быть явно записана в данных как
 * activation.cost[{resource:'self_uses'}]. Адаптер сущности связывает этот
 * относительный примитив с её стабильным runtime-ключом uses_<ref>.
 *
 * Конвенция UI: панели ресурсов СКРЫВАЮТ ключи с префиксом uses_
 * (см. isActionUsesKey) — остаток рисуется на строке самого действия.
 */

import type { ResourceRestRecovery } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export const ACTION_USES_PREFIX = 'uses_';
export const SELF_USES_RESOURCE = 'self_uses';

export type ActionUses = {
  count: number | string;
  per?: string;
  by_level?: Record<string, unknown>;
  level_source?: unknown;
};

export type ActionUsesRecoveryResolution =
  | { status: 'legacy' }
  | { status: 'invalid' }
  | { status: 'configured'; recovery: ResourceRestRecovery };

/** Ключ виртуального пула: uses_<card_number|id>. */
export function actionUsesKey(ref: string, mechanics?: Dict | null): string {
  const uses=mechanics?.uses as Dict|undefined;
  const pool=uses?.pool;
  if(pool===undefined)return `${ACTION_USES_PREFIX}${ref}`;
  if(typeof pool!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/.test(pool))throw Error('Invalid shared action uses pool');
  return `${ACTION_USES_PREFIX}shared_${pool}`;
}

function hasExactKeys(value: Dict, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

/**
 * Decode the optional, generic bounded recovery primitive on mechanics.uses.
 * No action identity or display label participates.  An explicitly present
 * but malformed declaration stays distinguishable from legacy absence so the
 * rest runtime can fail closed instead of falling back to full recovery.
 */
export function resolveActionUsesRecovery(
  mech: Dict | null | undefined,
): ActionUsesRecoveryResolution {
  if (!mech || typeof mech !== 'object') return { status: 'legacy' };
  const uses = mech.uses;
  if (!uses || typeof uses !== 'object' || Array.isArray(uses)) return { status: 'legacy' };
  if (!Object.prototype.hasOwnProperty.call(uses, 'recovery')) return { status: 'legacy' };
  const recovery = (uses as Dict).recovery;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) {
    return { status: 'invalid' };
  }
  const recoveryRow = recovery as Dict;
  if (!hasExactKeys(recoveryRow, ['long_rest', 'short_rest'])) return { status: 'invalid' };

  const parsed=parseResourceRestRecovery(recoveryRow);
  return parsed?{status:'configured',recovery:parsed}:{status:'invalid'};

}

/** Strict data decoder shared by action uses and granted spell free uses. */
export function parseResourceRestRecovery(raw:unknown):ResourceRestRecovery|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
  const value=raw as Dict;
  if(!hasExactKeys(value,['short_rest','long_rest']))return undefined;
  const short=value.short_rest as Dict,long=value.long_rest as Dict;
  if(!short||!long||typeof short!=='object'||typeof long!=='object')return undefined;
  const validShort=short.mode==='none'&&hasExactKeys(short,['mode'])
    ||short.mode==='fixed'&&hasExactKeys(short,['mode','amount'])&&Number.isSafeInteger(short.amount)&&Number(short.amount)>0;
  const dice=typeof long.dice==='string'?/^([1-9]\d?)d([1-9]\d{0,2})$/.exec(long.dice):null;
  const validLong=long.mode==='full'&&hasExactKeys(long,['mode'])
    ||long.mode==='dice'&&hasExactKeys(long,['mode','dice'])&&dice&&Number(dice[2])>=2;
  return validShort&&validLong?value as unknown as ResourceRestRecovery:undefined;
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
  const byLevel = uses.by_level;
  return {
    count,
    per: typeof uses.per === 'string' ? uses.per : undefined,
    ...(byLevel && typeof byLevel === 'object' && !Array.isArray(byLevel)
      ? { by_level: byLevel as Record<string, unknown> }
      : {}),
    ...(uses.level_source != null ? { level_source: uses.level_source } : {}),
  };
}

/** True only when the content explicitly spends its own uses pool. */
export function declaresSelfUsesCost(mech: Dict | null | undefined): boolean {
  if (!mech || typeof mech !== 'object') return false;
  const activation = mech.activation as Dict | undefined;
  return Array.isArray(activation?.cost)
    && activation.cost.some((entry) => (
      !!entry && typeof entry === 'object'
        && (entry as Dict).resource === SELF_USES_RESOURCE
    ));
}

/**
 * Bind the explicitly declared relative `self_uses` cost to the stable pool
 * of the concrete entity. This function never invents a cost from
 * `mechanics.uses`; absence stays absence and malformed declarations fail.
 */
export function bindActionUsesCost(mech: Dict, usesKey: string): Dict {
  const activation = mech.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mech;
  if (!declaresSelfUsesCost(mech)) return mech;
  if (!usesFromMechanics(mech)) {
    throw new Error('activation.cost self_uses requires mechanics.uses');
  }
  if (!usesKey.trim()) {
    throw new Error('activation.cost self_uses requires a stable entity reference');
  }
  const cost = (activation.cost as Dict[]).map((entry) => (
    entry?.resource === SELF_USES_RESOURCE
      ? { ...entry, resource: usesKey }
      : entry
  ));
  return { ...mech, activation: { ...activation, cost } };
}

/**
 * Restore the relative authoring marker before an already sheet-bound action
 * is passed through the immutable content compiler again. This is the exact
 * inverse of bindActionUsesCost for one declared pool; it never invents a
 * charge or rewrites a different resource.
 */
export function restoreSelfUsesCost(mech: Dict, usesKey: string): Dict {
  if (!usesFromMechanics(mech) || declaresSelfUsesCost(mech)) return mech;
  const activation = mech.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mech;
  const matches = (activation.cost as Dict[]).filter((entry) => entry?.resource === usesKey);
  if (matches.length !== 1) return mech;
  const cost = (activation.cost as Dict[]).map((entry) => (
    entry?.resource === usesKey
      ? { ...entry, resource: SELF_USES_RESOURCE }
      : entry
  ));
  return { ...mech, activation: { ...activation, cost } };
}
