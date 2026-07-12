import type { AssembledCharacter } from './assemble';
import { actionUsesKey, applyActionUsesCost, usesFromMechanics } from '../engine/actionUses';
import { applyItemConsumeCost } from '../engine/cost';
import type { Action, Card, PassiveEffect, Spell } from '../types';

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

/** Slug'и эффектов, ВЫДАВАЕМЫХ кастом через grant_effect (Доспехи мага → EFFECT-0256). Лист
 *  предзагружает их механику, чтобы движок поставил стоячий активный эффект при активации.
 *  Читает value | values, формы effects[]{kind} и effects[]{resolution:'auto',result[]}. */
export function collectGrantEffectSlugs(mechanics: Record<string, unknown> | null | undefined): string[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: string[] = [];
  const scan = (p: Dict) => {
    if (!p || p.kind !== 'grant_effect') return;
    if (typeof p.value === 'string' && p.value) out.push(p.value);
    if (Array.isArray(p.values)) for (const v of p.values) if (typeof v === 'string' && v) out.push(v);
  };
  for (const it of effects as Dict[]) {
    if (it?.kind) scan(it);
    else if (Array.isArray(it?.result)) for (const p of it.result as Dict[]) scan(p);
  }
  return out;
}

/** Действие, выданное через grant_action (уже загруженное по slug), для collectSheetActions. */
export interface GrantedAction { action: Action; sourceLabel: string; group: SheetAction['group']; }

/**
 * S2 контейнеры: действие «Распаковать» для контейнера mode='all' (Набор артиста) — кладёт ВСЁ
 * содержимое в инвентарь (add_item ×N из card.contents) и расходует сам контейнер (consumes_self).
 * Режим и состав — ДАННЫЕ карты (container_mode+contents), поведение не хардкодится. Cycle-guard:
 * пропускаем само-ссылку (дата-баг). mode='choice' здесь → null (одноразовый выбор — отдельный слайс).
 */
export function containerUnpackAction(card: Card, nameOf?: (id: string) => string | undefined): SheetAction | null {
  if (card.container_mode !== 'all') return null;
  const contents = Array.isArray(card.contents) ? card.contents : [];
  const result = contents
    .filter((c) => c && c.card_id && c.card_id !== card.id) // guard: контейнер не содержит сам себя
    .map((c) => {
      // Имя (best-effort, для журнала «Получен: <имя>»); нет карты в кэше → тихо без имени.
      const nm = nameOf?.(c.card_id);
      return { kind: 'add_item', card_id: c.card_id, qty: Math.max(1, Math.floor(Number(c.quantity)) || 1), ...(nm ? { name: nm } : {}) };
    });
  if (!result.length) return null;
  // consumes_self впрыскивает cost {resource:'item', card_id:self} → расход самого набора при использовании.
  const mechanics = applyItemConsumeCost({
    name: card.name,
    activation: { mode: 'active', consumes_self: true, cost: [] },
    effects: [{ resolution: 'auto', result }],
  }, card.id);
  return {
    id: `container-${card.id}`,
    name: `Распаковать: ${card.name}`,
    mechanics,
    group: 'item',
    imageUrl: card.image_url,
    sourceLabel: card.name,
  };
}

/**
 * S3 контейнеры: действие «Достать» для контейнера mode='choice' (Мешок инструментов) — диалог выбора
 * ОДНОГО предмета из содержимого (choice source:'item', context:'in_play' — тот же примитив, что выбор
 * «Сглаза»); выбранный → в инвентарь (add_item), сам мешок расходуется (consumes_self, одноразовый).
 * Общее решение: выбор предмета обрабатывается source:'item' в selectedChoicePayloads, не спец-логикой.
 * Cycle-guard само-ссылки; qty из quantity содержимого.
 */
export function containerChoiceAction(card: Card, nameOf?: (id: string) => string | undefined): SheetAction | null {
  if (card.container_mode !== 'choice') return null;
  const contents = Array.isArray(card.contents) ? card.contents : [];
  const items = contents
    .filter((c) => c && c.card_id && c.card_id !== card.id)
    .map((c) => ({ id: c.card_id, name: nameOf?.(c.card_id) ?? c.card_id, qty: Math.max(1, Math.floor(Number(c.quantity)) || 1) }));
  if (!items.length) return null;
  const mechanics = applyItemConsumeCost({
    name: card.name,
    activation: { mode: 'active', consumes_self: true, cost: [] },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'choice', context: 'in_play', id: 'container', prompt: `Выберите предмет: ${card.name}`, count: 1, options: { source: 'item', items } }],
    }],
  }, card.id);
  return {
    id: `container-${card.id}`,
    name: `Достать: ${card.name}`,
    mechanics,
    group: 'item',
    imageUrl: card.image_url,
    sourceLabel: card.name,
  };
}

export function collectSheetActions(
  assembled: AssembledCharacter,
  /** Механики надетых предметов (уже с учётом настройки) — активируемые попадают в действия. */
  itemMechanics: Array<{ card: import('../types').Card; mechanics: Record<string, unknown> }> = [],
  /** Базовые действия — сущности Action (type='basic') из библиотеки, грузятся отдельно. */
  basicActions: Action[] = [],
  /** S6: действия, выданные через grant_action (загружены по slug на листе). */
  grantedActions: GrantedAction[] = [],
  /** S2 контейнеры: носимые карты-контейнеры (mode='all') → действие «Распаковать». */
  containerCards: Card[] = [],
  /** S2: резолвер имени карты по id (для журнала распаковки); best-effort. */
  nameOf?: (id: string) => string | undefined,
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

  // S2: распаковка контейнеров mode='all' (Набор артиста → всё в инвентарь + расход набора).
  const fromContainers: SheetAction[] = containerCards
    .map((c) => (c.container_mode === 'choice' ? containerChoiceAction(c, nameOf) : containerUnpackAction(c, nameOf)))
    .filter((a): a is SheetAction => a != null);

  return [...basic, ...fromRace, ...fromClass, ...fromItems, ...fromGranted, ...fromContainers, ...spells];
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

/** Действие ВЗАИМОДЕЙСТВУЕТ с другим персонажем (для пикера цели): бросок против цели
 *  (атака/спас) ИЛИ явный who:'target' (лечение/бафф/дебафф на цель). */
export function actionInteractsWithTarget(mechanics: Record<string, unknown>): boolean {
  const effects = mechanics.effects as Record<string, unknown>[] | undefined;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => {
    const res = String(e.resolution ?? '');
    return res === 'attack_roll' || res === 'save' || String(e.who ?? '') === 'target';
  });
}

export function actionNeedsTarget(mechanics: Record<string, unknown>): boolean {
  const effects = mechanics.effects as Record<string, unknown>[] | undefined;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => {
    const res = String(e.resolution ?? '');
    return res === 'attack_roll' || res === 'save';
  });
}

/** Действие ФОРСИРУЕТ спасбросок ЦЕЛИ (resolution:'save', who:'target'). В онлайн-бою такой
 *  спас бросает сама цель на своём листе; атаки (attack_roll) остаются на стороне кастера. */
export function actionForcesTargetSave(mechanics: Record<string, unknown>): boolean {
  const effects = mechanics.effects as Record<string, unknown>[] | undefined;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => String(e.resolution ?? '') === 'save' && String(e.who ?? 'target') === 'target');
}
