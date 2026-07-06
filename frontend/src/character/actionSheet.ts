import type { AssembledCharacter } from './assemble';
import { actionUsesKey, applyActionUsesCost, usesFromMechanics } from '../engine/actionUses';
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

function actionMechanics(action: Action): Record<string, unknown> | null {
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
  return normalizeActiveMechanics(mech as Record<string, unknown>, action.resource, actionUsesRef(action));
}

function spellMechanics(spell: Spell): Record<string, unknown> | null {
  const mech = spell.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (!activation || activation.mode === 'passive') return null;
  return mech as Record<string, unknown>;
}

export function collectSheetActions(
  assembled: AssembledCharacter,
  /** Механики надетых предметов (уже с учётом настройки) — активируемые попадают в действия. */
  itemMechanics: Array<{ card: import('../types').Card; mechanics: Record<string, unknown> }> = [],
  /** Базовые действия — сущности Action (type='basic') из библиотеки, грузятся отдельно. */
  basicActions: Action[] = [],
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
      return {
        id: `item-${card.id}`,
        name: card.name,
        mechanics: { ...mechanics, name: card.name },
        group: 'item' as const,
        imageUrl: card.image_url,
        sourceLabel: 'Предмет',
      };
    })
    .filter((a): a is SheetAction => a != null);

  return [...basic, ...fromRace, ...fromClass, ...fromItems, ...spells];
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
