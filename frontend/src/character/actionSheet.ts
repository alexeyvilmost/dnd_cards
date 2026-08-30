import type { AssembledCharacter } from './assemble';
import {
  actionUsesKey,
  bindActionUsesCost,
  declaresSelfUsesCost,
  resolveActionUsesRecovery,
  usesFromMechanics,
} from '../engine/actionUses';
import { bindSelfItemCost } from '../engine/cost';
import type { ResourceRestRecovery } from '../mvp/contracts';
import type { Action, Card, PassiveEffect, Spell } from '../types';
import { upgradeLegacyActionMechanics } from './legacyActionMechanics';

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
  /** Immutable content provenance used by the canonical rules bridge. */
  sourceEntityIds?: readonly [string, ...string[]];
};

function stableSources(...values: Array<string | null | undefined>): [string, ...string[]] {
  const ids = [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  )))];
  if (!ids.length) throw new Error('Sheet action must have immutable source provenance');
  return ids as [string, ...string[]];
}

/** uses_<key> для действия с mechanics.uses; undefined — без ограничения использований. */
function actionUsesRef(action: Action): string | undefined {
  if (!usesFromMechanics(action.mechanics as Dict | null | undefined)) return undefined;
  return actionUsesKey(action.card_number || action.id);
}

function effectUsesRef(effect: PassiveEffect): string | undefined {
  if (!usesFromMechanics(effect.mechanics as Dict | null | undefined)) return undefined;
  return actionUsesKey(effect.card_number || effect.id);
}

function normalizeActionableMechanics(
  mech: Record<string, unknown>,
  usesKey?: string,
): Record<string, unknown> | null {
  const activation = { ...(mech.activation as Record<string, unknown> | undefined) };
  if (activation.mode !== 'active' && activation.mode !== 'reaction') return null;
  // Цена — только из mechanics.activation.cost. Даже action.resource и
  // mechanics.uses не являются вторым источником экономики действия.
  if (!Array.isArray(activation.cost)) return null;
  const hasUses = usesFromMechanics(mech) !== null;
  if (hasUses !== declaresSelfUsesCost(mech)) return null;
  if (hasUses && !usesKey) return null;
  return usesKey ? bindActionUsesCost({ ...mech, activation }, usesKey) : { ...mech, activation };
}

function effectActiveMechanics(effect: PassiveEffect): Record<string, unknown> | null {
  const mech = effect.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active') return null;
  return normalizeActionableMechanics(mech as Record<string, unknown>, effectUsesRef(effect));
}

function actionMechanics(action: Action, withUses = true): Record<string, unknown> | null {
  const mech = upgradeLegacyActionMechanics(action);
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active' && activation?.mode !== 'reaction') return null;
  return normalizeActionableMechanics(
    mech as Record<string, unknown>,
    withUses ? actionUsesRef(action) : undefined,
  );
}

function spellMechanics(spell: Spell): Record<string, unknown> | null {
  const mech = spell.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (!activation || activation.mode === 'passive') return null;
  if (!Array.isArray(activation.cost)) return null;
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
 * `mechanics.name` belongs to the locked mechanics document when it is
 * explicitly declared. A mutable entity display name may label legacy rows,
 * but must never overwrite those reviewed bytes during sheet projection.
 */
function mechanicsWithPresentationName(
  mechanics: Record<string, unknown>,
  displayName: string,
): Record<string, unknown> {
  return Object.prototype.hasOwnProperty.call(mechanics, 'name')
    ? mechanics
    : { ...mechanics, name: displayName };
}

/**
 * S2 контейнеры: действие «Распаковать» для контейнера mode='all' (Набор артиста) — кладёт ВСЁ
 * содержимое в инвентарь (add_item ×N из card.contents) и расходует сам контейнер явной item-cost.
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
  const mechanics = {
    name: card.name,
    activation: { mode: 'active', cost: [{ resource: 'item', card_id: card.id, amount: 1 }] },
    effects: [{ resolution: 'auto', result }],
  };
  return {
    id: `container-${card.id}`,
    name: `Распаковать: ${card.name}`,
    mechanics,
    group: 'item',
    imageUrl: card.image_url,
    sourceLabel: card.name,
    sourceEntityIds: stableSources(card.id, card.card_number),
  };
}

/**
 * S3 контейнеры: действие «Достать» для контейнера mode='choice' (Мешок инструментов) — диалог выбора
 * ОДНОГО предмета из содержимого (choice source:'item', context:'in_play' — тот же примитив, что выбор
 * «Сглаза»); выбранный → в инвентарь (add_item), сам мешок расходуется явной item-cost.
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
  const mechanics = {
    name: card.name,
    activation: { mode: 'active', cost: [{ resource: 'item', card_id: card.id, amount: 1 }] },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'choice', context: 'in_play', id: 'container', prompt: `Выберите предмет: ${card.name}`, count: 1, options: { source: 'item', items } }],
    }],
  };
  return {
    id: `container-${card.id}`,
    name: `Достать: ${card.name}`,
    mechanics,
    group: 'item',
    imageUrl: card.image_url,
    sourceLabel: card.name,
    sourceEntityIds: stableSources(card.id, card.card_number),
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
        mechanics: mechanicsWithPresentationName(mechanics, action.name),
        group: 'basic' as const,
        imageUrl: action.image_url,
        description: action.description,
        usesKey: actionUsesRef(action),
        actionRef: action,
        sourceEntityIds: stableSources(action.id, action.card_number),
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
        mechanics: mechanicsWithPresentationName(mechanics, action.name),
        group: origin.kind === 'race' ? 'race' as const : 'class' as const,
        imageUrl: action.image_url,
        sourceLabel: `${origin.name}`,
        usesKey: actionUsesRef(action),
        actionRef: action,
        sourceEntityIds: stableSources(action.id, action.card_number, origin.id),
      };
    })
    .filter((a): a is SheetAction => a != null);

  // Active effects are actions regardless of their source. Historically the
  // real sheet promoted only species effects, which made active class/feat
  // mechanics (including Pact Blade) disappear even though the compiler and
  // Rules Lab could execute them.
  const fromEffects: SheetAction[] = assembled.effects
    .map(({ effect, origin }): SheetAction | null => {
      const mechanics = effectActiveMechanics(effect);
      if (!mechanics) return null;
      return {
        id: effect.id,
        name: effect.name,
        mechanics: mechanicsWithPresentationName(mechanics, effect.name),
        group: origin.kind === 'race' ? 'race' as const : 'class' as const,
        imageUrl: effect.image_url,
        sourceLabel: `${origin.name}`,
        usesKey: effectUsesRef(effect),
        effectRef: effect,
        sourceEntityIds: stableSources(effect.id, effect.card_number, origin.id),
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
        mechanics: mechanicsWithPresentationName(mechanics, spell.name),
        group: 'spell' as const,
        level: spell.level ?? 0,
        imageUrl: spell.image_url,
        sourceLabel: spell.school ? `Заклинание · ${spell.school}` : 'Заклинание',
        spellRef: spell,
        sourceEntityIds: stableSources(
          spell.id,
          spell.card_number,
          assembled.klass?.id,
          assembled.klass?.card_number,
        ),
      };
    })
    .filter((a): a is SheetAction => a != null);

  const fromItems: SheetAction[] = itemMechanics
    .map(({ card, mechanics }): SheetAction | null => {
      const activation = mechanics.activation as Record<string, unknown> | undefined;
      if (!activation || activation.mode === 'passive') return null;
      // Экономика предмета так же обязана быть объявлена данными. Legacy
      // consumes_self больше не превращается здесь в скрытую стоимость.
      if (!Array.isArray(activation.cost)) return null;
      const mechanics2 = bindSelfItemCost(
        mechanicsWithPresentationName(mechanics, card.name),
        card.id,
      );
      return {
        id: `item-${card.id}`,
        name: card.name,
        mechanics: mechanics2,
        group: 'item' as const,
        imageUrl: card.image_url,
        sourceLabel: 'Предмет',
        sourceEntityIds: stableSources(card.id, card.card_number),
      };
    })
    .filter((a): a is SheetAction => a != null);

  // S6: действия, выданные grant_action (приёмы оружия BG3). Карта действия несёт свою экономику
  // (activation) и поведение — здесь только оборачиваем в строку листа с источником.
  const fromGranted: SheetAction[] = grantedActions
    .map(({ action, sourceLabel, group }): SheetAction | null => {
      // withUses=false: grant_action пока не материализует uses-пул в init/rest.
      // Limited granted actions therefore fail closed (actionMechanics returns
      // null) instead of silently becoming unlimited.
      const mechanics = actionMechanics(action, false);
      if (!mechanics) return null;
      return {
        id: `granted-${action.id}`,
        name: action.name,
        mechanics: mechanicsWithPresentationName(mechanics, action.name),
        group,
        imageUrl: action.image_url,
        sourceLabel,
        actionRef: action,
        sourceEntityIds: stableSources(action.id, action.card_number),
      };
    })
    .filter((a): a is SheetAction => a != null);

  // S2: распаковка контейнеров mode='all' (Набор артиста → всё в инвентарь + расход набора).
  const fromContainers: SheetAction[] = containerCards
    .map((c) => (c.container_mode === 'choice' ? containerChoiceAction(c, nameOf) : containerUnpackAction(c, nameOf)))
    .filter((a): a is SheetAction => a != null);

  return [...basic, ...fromEffects, ...fromClass, ...fromItems, ...fromGranted, ...fromContainers, ...spells];
}

export type ActionUsesPool = {
  key: string;
  count: number | string;
  per?: string;
  source: string;
  /** undefined = legacy uses.per; null = explicit invalid recovery (fail closed). */
  recovery?: ResourceRestRecovery | null;
};

function isActiveMech(mech: unknown): boolean {
  if (!mech || typeof mech !== 'object') return false;
  const activation = (mech as Dict).activation as Dict | undefined;
  return activation?.mode === 'active';
}

function isActionMech(mech: unknown): boolean {
  if (!mech || typeof mech !== 'object') return false;
  const activation = (mech as Dict).activation as Dict | undefined;
  return activation?.mode === 'active' || activation?.mode === 'reaction';
}

/**
 * Пулы использований действий листа: uses_<card_number|id> → {count, per}.
 * Источники зеркалят collectSheetActions: действия + активные способности вида.
 */
export function collectActionUsesPools(assembled: AssembledCharacter): ActionUsesPool[] {
  const out: ActionUsesPool[] = [];
  const seen = new Set<string>();
  const push = (key: string | undefined, mech: unknown, source: string) => {
    const uses = usesFromMechanics(mech as Dict | null | undefined);
    if (!key || !uses || seen.has(key)) return;
    seen.add(key);
    const recovery = resolveActionUsesRecovery(mech as Dict | null | undefined);
    out.push({
      key,
      count: uses.count,
      per: uses.per,
      source,
      ...(recovery.status === 'configured' ? { recovery: recovery.recovery } : {}),
      ...(recovery.status === 'invalid' ? { recovery: null } : {}),
    });
  };
  for (const { action, origin } of assembled.actions) {
    if (isActionMech(action.mechanics)) push(actionUsesRef(action), action.mechanics, `${action.name} · ${origin.name}`);
  }
  for (const { effect, origin } of assembled.effects) {
    if (!isActiveMech(effect.mechanics)) continue;
    push(effectUsesRef(effect), effect.mechanics, `${effect.name} · ${origin.name}`);
  }
  return out;
}

/** recharge-карта пулов использований: uses_<key> → per (short_rest | long_rest). */
export function collectActionUsesRecharge(assembled: AssembledCharacter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pool of collectActionUsesPools(assembled)) {
    if (pool.recovery === null) {
      out[pool.key] = 'never';
    } else if (pool.recovery?.short_rest) {
      out[pool.key] = 'short_rest';
    } else if (pool.per) {
      out[pool.key] = pool.per;
    }
  }
  return out;
}

/**
 * Recovery-политики виртуальных uses-пулов, напрямую декодированные из mechanics.
 * null сохраняется намеренно: это запрет восстановления для невалидного explicit
 * declaration, а не повод откатиться к legacy full-pool recharge.
 */
export function collectActionUsesRecovery(
  assembled: AssembledCharacter,
): Record<string, ResourceRestRecovery | null> {
  const out: Record<string, ResourceRestRecovery | null> = {};
  for (const pool of collectActionUsesPools(assembled)) {
    if (Object.prototype.hasOwnProperty.call(pool, 'recovery')) {
      out[pool.key] = pool.recovery ?? null;
    }
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
