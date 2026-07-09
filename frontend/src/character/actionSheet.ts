import type { AssembledCharacter } from './assemble';
import { actionUsesKey, applyActionUsesCost, usesFromMechanics } from '../engine/actionUses';
import { applyItemConsumeCost } from '../engine/cost';
import type { Action, PassiveEffect, Spell } from '../types';

type Dict = Record<string, unknown>;

export type SheetAction = {
  id: string;
  name: string;
  mechanics: Record<string, unknown>;
  group: 'basic' | 'class' | 'race' | 'spell' | 'item';
  level?: number;
  imageUrl?: string | null;
  sourceLabel?: string;
  /** Человекочитаемое описание (для hover базовых действий). */
  description?: string;
  /** Ключ виртуального пула использований (uses_<card_number|id>), если у механики есть uses. */
  usesKey?: string;
  actionRef?: Action;
  effectRef?: PassiveEffect;
  spellRef?: Spell;
};

/** uses_<key> для действия с mechanics.uses; undefined — без ограничения использований. */
function actionUsesRef(action: Action): string | undefined {
  if (!usesFromMechanics(action.mechanics as Dict | null | undefined)) return undefined;
  return actionUsesKey(action.card_number || action.id);
}

function effectUsesRef(effect: PassiveEffect): string | undefined {
  if (!usesFromMechanics(effect.mechanics as Dict | null | undefined)) return undefined;
  return actionUsesKey(effect.card_number || effect.id);
}

function normalizeActiveMechanics(
  mech: Record<string, unknown>,
  fallbackResource?: string,
  usesKey?: string,
): Record<string, unknown> {
  const activation = { ...(mech.activation as Record<string, unknown> | undefined) };
  if (activation.mode !== 'active') return mech;
  // mechanics.uses → трата виртуального пула uses_<key> (canPay/pay из коробки).
  let next: Dict = { ...mech, activation };
  if (usesKey) next = applyActionUsesCost(next, usesKey);
  const nextActivation = next.activation as Record<string, unknown>;
  const cost = nextActivation.cost as unknown[] | undefined;
  if (!Array.isArray(cost) || !cost.length) {
    nextActivation.cost = [{ resource: fallbackResource || 'action' }];
  }
  return next;
}

function effectActiveMechanics(effect: PassiveEffect): Record<string, unknown> | null {
  const mech = effect.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active') return null;
  return normalizeActiveMechanics(mech as Record<string, unknown>, 'action', effectUsesRef(effect));
}

function actionMechanics(action: Action, withUses = true): Record<string, unknown> | null {
  const mech = action.mechanics;
  if (!mech || typeof mech !== 'object') {
    if (!action.resource) return null;
    return {
      name: action.name,
      activation: { mode: 'active', cost: [{ resource: action.resource }] },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'narrative', description: action.description || action.name }],
      }],
    };
  }
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active') return null;
  return normalizeActiveMechanics(mech as Record<string, unknown>, action.resource, withUses ? actionUsesRef(action) : undefined);
}

function spellMechanics(spell: Spell): Record<string, unknown> | null {
  const mech = spell.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (!activation || activation.mode === 'passive') return null;
  return mech as Record<string, unknown>;
}

/** S6 «предмет=эффект»: slug'и действий, ВЫДАННЫХ через grant_action (даёт доступ к библиотечному
 *  действию; экономика/поведение — на самой карте действия). Читает value | values, форму effects[]. */
export function collectGrantActionSlugs(mechanics: Record<string, unknown> | null | undefined, level = Infinity): string[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: string[] = [];
  const scan = (p: Dict) => {
    if (!p || p.kind !== 'grant_action') return;
    // Уровневый гейт (как grant_spell): приём доступен только с нужного уровня персонажа.
    const g = p.level_gate ?? p.min_level;
    if (g != null && !Number.isNaN(Number(g)) && level < Number(g)) return;
    if (typeof p.value === 'string' && p.value) out.push(p.value);
    if (Array.isArray(p.values)) for (const v of p.values) if (typeof v === 'string' && v) out.push(v);
  };
  for (const it of effects as Dict[]) {
    if (it?.kind) scan(it);
    else if (it?.resolution === 'auto' && Array.isArray(it.result)) for (const p of it.result as Dict[]) scan(p);
  }
  return out;
}

/** Действие, выданное через grant_action (уже загруженное по slug), для collectSheetActions. */
export interface GrantedAction { action: Action; sourceLabel: string; group: SheetAction['group']; }

export function collectSheetActions(
  assembled: AssembledCharacter,
  /** Механики надетых предметов (уже с учётом настройки) — активируемые попадают в действия. */
  itemMechanics: Array<{ card: import('../types').Card; mechanics: Record<string, unknown> }> = [],
  /** Базовые действия — сущности Action (type='basic') из библиотеки, грузятся отдельно. */
  basicActions: Action[] = [],
  /** S6: действия, выданные через grant_action (загружены по slug на листе). */
  grantedActions: GrantedAction[] = [],
): SheetAction[] {
  const basic: SheetAction[] = basicActions
    .map((action): SheetAction | null => {
      const mechanics = actionMechanics(action);
      if (!mechanics) return null;
      return {
        id: action.id,
        name: action.name,
        mechanics: { ...mechanics, name: action.name },
        group: 'basic' as const,
        imageUrl: action.image_url,
        description: action.description,
        usesKey: actionUsesRef(action),
        actionRef: action,
      };
    })
    .filter((a): a is SheetAction => a != null);

  const fromClass: SheetAction[] = assembled.actions
    .map(({ action, origin }): SheetAction | null => {
      const mechanics = actionMechanics(action);
      if (!mechanics) return null;
      return {
        id: action.id,
        name: action.name,
        mechanics: { ...mechanics, name: action.name },
        group: 'class' as const,
        imageUrl: action.image_url,
        sourceLabel: `${origin.name}`,
        usesKey: actionUsesRef(action),
        actionRef: action,
      };
    })
    .filter((a): a is SheetAction => a != null);

  const fromRace: SheetAction[] = assembled.effects
    .filter(({ origin }) => origin.kind === 'race')
    .map(({ effect, origin }): SheetAction | null => {
      const mechanics = effectActiveMechanics(effect);
      if (!mechanics) return null;
      return {
        id: effect.id,
        name: effect.name,
        mechanics: { ...mechanics, name: effect.name },
        group: 'race' as const,
        imageUrl: effect.image_url,
        sourceLabel: `${origin.name}`,
        usesKey: effectUsesRef(effect),
        effectRef: effect,
      };
    })
    .filter((a): a is SheetAction => a != null);

  const spells: SheetAction[] = assembled.spells
    .map((spell): SheetAction | null => {
      const mechanics = spellMechanics(spell);
      if (!mechanics) return null;
      return {
        id: spell.id,
        name: spell.name,
        mechanics: { ...mechanics, name: spell.name },
        group: 'spell' as const,
        level: spell.level ?? 0,
        imageUrl: spell.image_url,
        sourceLabel: spell.school ? `Заклинание · ${spell.school}` : 'Заклинание',
        spellRef: spell,
      };
    })
    .filter((a): a is SheetAction => a != null);

  const fromItems: SheetAction[] = itemMechanics
    .map(({ card, mechanics }): SheetAction | null => {
      const activation = mechanics.activation as Record<string, unknown> | undefined;
      if (!activation || activation.mode === 'passive') return null;
      // S4: саморасходуемый предмет (зелье) тратит себя из инвентаря при использовании
      // (consumes_self → cost {resource:'item', card_id:self}; canPay/pay из коробки).
      const mechanics2 = applyItemConsumeCost({ ...mechanics, name: card.name }, card.id);
      return {
        id: `item-${card.id}`,
        name: card.name,
        mechanics: mechanics2,
        group: 'item' as const,
        imageUrl: card.image_url,
        sourceLabel: 'Предмет',
      };
    })
    .filter((a): a is SheetAction => a != null);

  // S6: действия, выданные grant_action (приёмы оружия BG3). Карта действия несёт свою экономику
  // (activation) и поведение — здесь только оборачиваем в строку листа с источником.
  const fromGranted: SheetAction[] = grantedActions
    .map(({ action, sourceLabel, group }): SheetAction | null => {
      // withUses=false: пул использований выданных действий пока НЕ сидируется (грант резолвится на
      // рендере, а не на init/rest), поэтому не гейтим по uses — иначе действие с mechanics.uses было
      // бы навсегда недоступно. Экономика действия (bonus_action и т.п.) сохраняется. Полноценный uses
      // для грантов (сид+перезарядка) — отдельная задача.
      const mechanics = actionMechanics(action, false);
      if (!mechanics) return null;
      return {
        id: `granted-${action.id}`,
        name: action.name,
        mechanics: { ...mechanics, name: action.name },
        group,
        imageUrl: action.image_url,
        sourceLabel,
        actionRef: action,
      };
    })
    .filter((a): a is SheetAction => a != null);

  return [...basic, ...fromRace, ...fromClass, ...fromItems, ...fromGranted, ...spells];
}

export type ActionUsesPool = { key: string; count: number | string; per?: string };

function isActiveMech(mech: unknown): boolean {
  if (!mech || typeof mech !== 'object') return false;
  const activation = (mech as Dict).activation as Dict | undefined;
  return activation?.mode === 'active';
}

/**
 * Пулы использований действий листа: uses_<card_number|id> → {count, per}.
 * Источники зеркалят collectSheetActions: действия + активные способности вида.
 */
export function collectActionUsesPools(assembled: AssembledCharacter): ActionUsesPool[] {
  const out: ActionUsesPool[] = [];
  const seen = new Set<string>();
  const push = (key: string | undefined, mech: unknown) => {
    const uses = usesFromMechanics(mech as Dict | null | undefined);
    if (!key || !uses || seen.has(key)) return;
    seen.add(key);
    out.push({ key, count: uses.count, per: uses.per });
  };
  for (const { action } of assembled.actions) {
    if (isActiveMech(action.mechanics)) push(actionUsesRef(action), action.mechanics);
  }
  for (const { effect, origin } of assembled.effects) {
    if (origin.kind !== 'race' || !isActiveMech(effect.mechanics)) continue;
    push(effectUsesRef(effect), effect.mechanics);
  }
  return out;
}

/** recharge-карта пулов использований: uses_<key> → per (short_rest | long_rest). */
export function collectActionUsesRecharge(assembled: AssembledCharacter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pool of collectActionUsesPools(assembled)) {
    if (pool.per) out[pool.key] = pool.per;
  }
  return out;
}

export function actionNeedsTarget(mechanics: Record<string, unknown>): boolean {
  const effects = mechanics.effects as Record<string, unknown>[] | undefined;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => {
    const res = String(e.resolution ?? '');
    return res === 'attack_roll' || res === 'save';
  });
}
