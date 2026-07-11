import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { actionsApi, effectsApi } from '../api/client';
import { getCardsIndex } from '../utils/cardsIndex';
import type { AssembledCharacter } from '../character/assemble';
import { actionNeedsTarget, collectSheetActions, collectGrantActionSlugs, collectGrantEffectSlugs, type SheetAction, type GrantedAction } from '../character/actionSheet';
import { useBasicActions } from '../character/basicActions';
import { collectItemMechanics, readAttunedIds } from '../character/attunement';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { isActionUsesKey } from '../engine/actionUses';
import { applyFreeuseCost, findFreeusePoolKey, freeuseKey, isFreeusePoolKey } from '../engine/freeuse';
import { startConcentration } from '../engine/concentration';
import { canPay } from '../engine/cost';
import { extractDiceFromEvents, plannedValuesRng, PLANNING_RNG } from '../engine/dicePlan';
import { executeAction, InsufficientResourcesError } from '../engine/execute';
import { describeMechanicsLine } from '../engine/describeMechanics';
import { weaponActionAvailability, weaponAmmoCost, weaponAttackPreview } from '../engine/weapon';
import { appendActivationCost, costAmount } from '../engine/cost';
import { inventoryQty } from '../character/inventory';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { collectInPlayActionChoices } from '../mechanics/collectChoices';
import { findResource, useResourceOptions } from '../utils/resources';
import { useSiteSettings } from '../settings';
import { getSpellLevelLabel, SPELL_SCHOOL_OPTIONS, type Card } from '../types';
import type { EngineEvent, ExecuteContext, ReactionOffer, RuntimeState } from '../mvp/contracts';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import SheetActionLine from './SheetActionLine';
import SpellPreview from './SpellPreview';
import FreeuseSpellsTile from './FreeuseSpellsTile';
import ActionHoverCard from './forge/ActionHoverCard';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  equipCards: Map<string, Card>;
  /** S3: механики эффектов, ВЫДАННЫХ предметами (grant_effect), для числового канала действий. */
  itemGrantedPassives?: Record<string, unknown>[];
  /** Истинный максимум HP (breakdown, с бонусами предметов/эффектов). Без него боевой кэп берёт
   *  «голый» ruleState.maxHP и, если предмет поднимает максимум, действие срезало бы HP до него. */
  maxHp?: number;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  embedded?: boolean;
  /** false — ресурсы/эффекты рисует соседняя SheetRuntimePanel (классический макет). */
  showResources?: boolean;
  showEffects?: boolean;
  /** Только заклинания, сгруппированные по кругам (блок «Заклинания» = 1:1 с блоком «Действия»). */
  spellsOnly?: boolean;
  /** Контролируемое «КЗ цели» (E4): один общий таргет на все инстансы панели листа.
   *  Если не передан — панель держит собственный локальный targetAc. */
  targetAc?: number;
  onTargetAcChange?: (n: number) => void;
  /** Контролируемый «Спас цели» (E5): единый модификатор спасброска цели
   *  (передаётся во все ability; движок берёт нужный по механике действия). */
  targetSaveMod?: number;
  onTargetSaveModChange?: (n: number) => void;
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  heroic_inspiration: 'Вдохновение',
};

const GROUP_DETAIL: Record<SheetAction['group'], string> = {
  basic: 'Базовое действие', race: 'Вид', class: 'Класс', item: 'Предмет', spell: 'Заклинание',
};
const spellSchoolLabel = (s?: string | null) => SPELL_SCHOOL_OPTIONS.find((o) => o.value === s)?.label || s || '';
// Вторая строка ряда действия (как у предметов, но без веса/цены).
const actionDetail = (a: SheetAction): string => {
  if (a.spellRef) {
    const lvl = a.spellRef.level ?? a.level ?? 0;
    return `${lvl === 0 ? 'Заговор' : `${lvl} уровень`}${a.spellRef.school ? ` · ${spellSchoolLabel(a.spellRef.school)}` : ''}`;
  }
  if (a.group === 'basic') return 'Базовое действие';
  return a.sourceLabel ?? GROUP_DETAIL[a.group] ?? '';
};

const RESOURCE_ICONS: Record<string, string> = {
  action: '/icons/resources/action.png',
  bonus_action: '/icons/resources/bonus_action.png',
  reaction: '/icons/resources/reaction.png',
  spell_slot: '/icons/resources/spell_slot.png',
  warlock_spell_slot: '/icons/resources/warlock_spell_slot.png',
};

/** Выбор источника оплаты каста: за ячейку уровня level или бесплатно (freeuse-пул). */
type CastChoice = { via: 'slot'; level: number } | { via: 'free' };

/** Апкаст (D1): заклинание со стоимостью spell_slot уровня N доступно, если есть ЛЮБОЙ
 *  слот уровня ≥ N (не только базового) — иначе кастер со свободным старшим слотом, но
 *  потраченным базовым, не смог бы кастовать. Прочие ресурсы стоимости — обычной проверкой. */
export function payableWithUpcast(runtime: RuntimeState, cost: Record<string, unknown>[]): boolean {
  const slot = cost.find((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
  const nonSlot = cost.filter((c) => c !== slot);
  if (nonSlot.length && !canPay(runtime, nonSlot).ok) return false;
  if (slot) {
    const base = Number(slot.level) || 0;
    const need = Number(slot.amount ?? 1) || 1;
    let ok = false;
    for (let L = base; L <= 9; L++) if ((runtime.resources[`spell_slot_${L}`] ?? 0) >= need) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

function persistPayload(state: RuntimeState, prevTurnState: Record<string, unknown> | null | undefined, includeInventory: boolean) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    resources: state.resources,
    max_resources: state.maxResources,
    active_effects: state.activeEffects,
    // S4: инвентарь персистим ТОЛЬКО когда действие реально израсходовало предмет — иначе каждое
    // действие затирало бы inventory_items локальным снимком и могло откатить параллельное изменение
    // сумки (экипировка/покупка/расход в другой вкладке). Бэкенд уже принимает inventory_items.
    ...(includeInventory ? { inventory_items: state.inventory.map((r) => ({ card_id: r.cardId, qty: r.qty, ...(r.containerId ? { container_id: r.containerId } : {}) })) } : {}),
    // temp_hp обновляем, остальные поля turn_state (спасброски смерти) сохраняем
    turn_state: { ...(prevTurnState ?? {}), temp_hp: state.hp.temp },
  };
}

/** Действие тратит ЛЮБОЙ ресурс — основное/бонусное действие, реакцию, слот заклинания, заряд,
 *  очки, расходник. Для таких при включённом диалоге кубов показываем «Применить»/«Отмена». */
function spendsResource(mech: Record<string, unknown>): boolean {
  const activation = mech.activation as Record<string, unknown> | undefined;
  const cost = activation?.cost as Record<string, unknown>[] | undefined;
  if (!Array.isArray(cost)) return false;
  return cost.some((c) => !!String(c.resource ?? ''));
}

export default function SheetActionsPanel({
  character,
  assembled,
  ruleState,
  equipCards,
  itemGrantedPassives,
  maxHp,
  onUpdated,
  onEvents,
  embedded,
  showResources = true,
  showEffects = true,
  spellsOnly = false,
  targetAc: targetAcProp,
  onTargetAcChange,
  targetSaveMod: targetSaveModProp,
  onTargetSaveModChange,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Пикер источника оплаты каста (D1 апкаст + freeuse): промис-модалка без нового провайдера.
  // via:'slot' — за ячейку уровня level; via:'free' — из пула бесплатных использований.
  const [slotPick, setSlotPick] = useState<{
    baseLevel: number;
    options: number[];
    freeuse?: { current: number; max: number; level: number };
    resolve: (v: CastChoice | null) => void;
  } | null>(null);
  const requestCastChoice = (baseLevel: number, options: number[], freeuse?: { current: number; max: number; level: number }) =>
    new Promise<CastChoice | null>((resolve) => setSlotPick({ baseLevel, options, freeuse, resolve }));
  const resolveCast = (v: CastChoice | null) => { slotPick?.resolve(v); setSlotPick(null); };
  const [localTargetAc, setLocalTargetAc] = useState(10);
  // E4: если родитель управляет «КЗ цели» — используем его; иначе локальный стейт.
  const targetAc = targetAcProp ?? localTargetAc;
  const setTargetAc = (n: number) => {
    if (onTargetAcChange) onTargetAcChange(n);
    else setLocalTargetAc(n);
  };
  const [localTargetSaveMod, setLocalTargetSaveMod] = useState(0);
  // E5: единый модификатор спасброска цели (раньше saveMods жёстко = 0).
  const targetSaveMod = targetSaveModProp ?? localTargetSaveMod;
  const setTargetSaveMod = (n: number) => {
    if (onTargetSaveModChange) onTargetSaveModChange(n);
    else setLocalTargetSaveMod(n);
  };
  const diceDialog = useDiceDialog();
  const choiceDialog = useChoiceDialog();
  const reactionPrompt = useReactionPrompt();

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), maxHp ?? ruleState.maxHP),
    [character, maxHp, ruleState.maxHP],
  );
  // Пассивки персонажа + механики надетых предметов (с учётом настройки).
  const passives = useMemo(() => {
    const items = collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state, runtime.inventory)
      .map((im) => im.mechanics);
    // S3: выданные предметами эффекты (grant_effect) — тот же числовой канал, что и механики предметов.
    return [...collectPassiveMechanics(assembled, character.resolved_choices ?? {}), ...items, ...(itemGrantedPassives ?? [])];
  }, [assembled, character.equipment, character.turn_state, character.resolved_choices, equipCards, runtime.inventory, itemGrantedPassives]);

  const equippedCards = useMemo(() => {
    const out: Card[] = [];
    for (const id of Object.values(runtime.equipment)) {
      if (id && equipCards.has(id)) out.push(equipCards.get(id)!);
    }
    return out;
  }, [runtime.equipment, equipCards]);

  const ctx = useMemo(
    () => ({
      ...buildCharacterContext(
        ruleState,
        { level: character.level, abilities: character.abilities ?? {} },
        equippedCards,
        assembled.klass,
      ),
      spellcastingMod: ruleState.spellcasting
        ? ruleState.abilityMods[ruleState.spellcasting.ability]
        : undefined,
      passives,
      // Настройка на предметы: ненастроенный магический предмет даёт только чистые статы.
      attunedIds: readAttunedIds(character.turn_state),
    }),
    [ruleState, character, equippedCards, assembled.klass, passives],
  );

  const itemMechs = useMemo(
    () => collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state, runtime.inventory),
    [character.equipment, character.turn_state, equipCards, runtime.inventory],
  );
  const basicActions = useBasicActions();

  // S6: действия, ВЫДАННЫЕ предметами через grant_action (приёмы оружия BG3). Резолвим action по slug
  // (кэш getAction). Карта действия несёт экономику/поведение; здесь только доступ к нему на листе.
  const [grantedActions, setGrantedActions] = useState<GrantedAction[]>([]);
  useEffect(() => {
    if (spellsOnly) { setGrantedActions((p) => (p.length ? [] : p)); return; }
    const refs: { slug: string; sourceLabel: string }[] = [];
    const seen = new Set<string>();
    for (const im of itemMechs) {
      for (const slug of collectGrantActionSlugs(im.card.mechanics, character.level)) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        refs.push({ slug, sourceLabel: im.card.name });
      }
    }
    if (!refs.length) { setGrantedActions((p) => (p.length ? [] : p)); return; }
    let stale = false;
    Promise.all(refs.map((r): Promise<GrantedAction | null> => actionsApi.getAction(r.slug)
      .then((action): GrantedAction => ({ action, sourceLabel: r.sourceLabel, group: 'item' }))
      .catch(() => null)))
      .then((list) => { if (!stale) setGrantedActions(list.filter((x): x is GrantedAction => x !== null)); })
      .catch(() => { if (!stale) setGrantedActions((p) => (p.length ? [] : p)); });
    return () => { stale = true; };
  }, [itemMechs, spellsOnly]);

  // S3-полировка (#32): общий индекс карт — резолвер имён СОДЕРЖИМОГО контейнера (его карты не в
  // equipCards, т.к. лежат внутри мешка) для диалога выбора «Достать» и журнала распаковки.
  const [cardsIndex, setCardsIndex] = useState<Map<string, Card>>(new Map());
  useEffect(() => {
    let alive = true;
    getCardsIndex().then((m) => alive && setCardsIndex(m));
    return () => { alive = false; };
  }, []);

  // S2/S3 контейнеры: носимые карты-контейнеры → действие «Распаковать» (mode='all') или «Достать» (mode='choice').
  const containerCards = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runtime.inventory) ids.add(r.cardId);
    for (const id of Object.values(runtime.equipment)) if (id) ids.add(id);
    const out: Card[] = [];
    for (const id of ids) {
      const card = equipCards.get(id);
      if (card && (card.container_mode === 'all' || card.container_mode === 'choice') && Array.isArray(card.contents) && card.contents.length) out.push(card);
    }
    return out;
  }, [runtime.inventory, runtime.equipment, equipCards]);

  const actions = useMemo(
    () => collectSheetActions(assembled, itemMechs, basicActions, grantedActions, containerCards,
      (id) => equipCards.get(id)?.name ?? cardsIndex.get(id)?.name),
    [assembled, itemMechs, basicActions, grantedActions, containerCards, equipCards, cardsIndex],
  );

  // Доспехи мага и т.п.: каст выдаёт ОТДЕЛЬНЫЙ эффект через grant_effect. Движок синхронный —
  // предзагружаем механику каждого выдаваемого эффекта по slug (кэш getEffect), кладём в execCtx,
  // чтобы applyGrantEffect поставил стоячий активный эффект (set_value ac_base → КЗ обновится).
  const [grantedEffectsBySlug, setGrantedEffectsBySlug] = useState<Record<string, { name?: string; mechanics?: unknown; repeatable?: boolean }>>({});
  const grantEffectSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const a of actions) for (const slug of collectGrantEffectSlugs(a.mechanics)) set.add(slug);
    return [...set];
  }, [actions]);
  useEffect(() => {
    if (!grantEffectSlugs.length) { setGrantedEffectsBySlug((p) => (Object.keys(p).length ? {} : p)); return; }
    let stale = false;
    Promise.all(grantEffectSlugs.map((slug) => effectsApi.getEffect(slug)
      .then((eff) => [slug, { name: eff.name, mechanics: eff.mechanics, repeatable: eff.repeatable }] as const)
      .catch(() => null)))
      .then((pairs) => {
        if (stale) return;
        const map: Record<string, { name?: string; mechanics?: unknown; repeatable?: boolean }> = {};
        for (const p of pairs) if (p) map[p[0]] = p[1];
        setGrantedEffectsBySlug(map);
      })
      .catch(() => { if (!stale) setGrantedEffectsBySlug((p) => (Object.keys(p).length ? {} : p)); });
    return () => { stale = true; };
  }, [grantEffectSlugs.join('|')]);
  const resourceOptions = useResourceOptions();
  const { entityDisplay } = useSiteSettings();
  const actionsAsIcons = entityDisplay.actions === 'icon';
  // uses_<key> и freeuse-<spell> — виртуальные пулы: не плитки-ресурсы (freeuse рисуется
  // отдельной витриной FreeuseSpellsRow, uses — на строке действия).
  const resourceKeys = Object.keys(runtime.maxResources)
    .filter((k) => runtime.maxResources[k] > 0 && !isActionUsesKey(k) && !isFreeusePoolKey(k));

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    setError(null);
    try {
      // Инвентарь персистим при любом его изменении: расход (item_consumed) ИЛИ выдача (item_added, S1 контейнеры).
      const inventoryChanged = events.some((e) => e.type === 'item_consumed' || e.type === 'item_added');
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next, character.turn_state, inventoryChanged));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  // freeuse-пул заклинания-действия (каст без ячейки) с текущим/макс. запасом и
  // фиксированным кругом бесплатного каста (spec.level или базовый круг). null — нет пула/зарядов.
  const freeuseFor = (action: SheetAction): { key: string; current: number; max: number; level: number } | null => {
    if (!action.spellRef) return null;
    const key = findFreeusePoolKey(runtime.resources, { cardNumber: action.spellRef.card_number, id: action.spellRef.id });
    if (!key || (runtime.resources[key] ?? 0) <= 0) return null;
    const spec = ruleState.freeuseSpells.find((s) => freeuseKey(s.spell) === key);
    const base = action.spellRef.level ?? action.level ?? 0;
    return { key, current: runtime.resources[key] ?? 0, max: runtime.maxResources[key] ?? 0, level: spec?.level ?? base };
  };

  const runAction = async (action: SheetAction) => {
    let mech: Record<string, unknown> = { ...action.mechanics, name: action.name };
    // S5: дальнобойное оружие тратит боеприпас из инвентаря (оружие декларирует mechanics.ammo).
    // Добавляем cost {resource:'item', card_id} — расход/гейт штатным canPay/pay из слайса 4.
    const ammo = weaponAmmoCost(mech, runtime.equipment, equipCards);
    if (ammo) mech = appendActivationCost(mech, ammo);
    const activation = mech.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    // freeuse: заклинание с пулом бесплатных использований (каст без ячейки). Считаем ДО гейта —
    // персонаж без ячеек (напр. предмет-каст) всё равно может кастовать бесплатно.
    const freeuse = freeuseFor(action);
    if (cost.length && !payableWithUpcast(runtime, cost) && !freeuse) return;
    // Оружейное действие без нужного оружия в руке — не запускаем.
    if (!weaponActionAvailability(action.mechanics, runtime.equipment, equipCards).available) return;

    // Апкаст (D1) + freeuse: если действие тратит spell_slot уровня N — выбрать уровень слота N..9
    // и/или источник оплаты (ячейка/бесплатно). castLevel в mech.cost и в ctx.spell включает
    // апкаст-скейлинг (withScaling) и эмиссию spell_cast. Заговоры/spellRef без слота тоже
    // помечаем ctx.spell (для триггеров каста), castLevel не задаём.
    let spellCtx: { baseLevel: number; castLevel?: number } | undefined;
    const slotIdx = cost.findIndex((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
    if (slotIdx >= 0 || freeuse) {
      const slotEntry = slotIdx >= 0 ? cost[slotIdx] : null;
      const baseLevel = slotEntry ? Number(slotEntry.level) || 0 : (action.spellRef?.level ?? action.level ?? 0);
      const need = slotEntry ? Number(slotEntry.amount ?? 1) || 1 : 1;
      const options: number[] = [];
      if (slotEntry) for (let L = baseLevel; L <= 9; L++) if ((runtime.resources[`spell_slot_${L}`] ?? 0) >= need) options.push(L);

      // Выбор источника оплаты: меню при (freeuse И есть ячейки) или (>1 круга ячеек); иначе авто.
      let choice: CastChoice;
      if (freeuse && options.length > 0) {
        const picked = await requestCastChoice(baseLevel, options, freeuse);
        if (!picked) return; // отмена
        choice = picked;
      } else if (freeuse) {
        choice = { via: 'free' };
      } else if (options.length === 0) {
        return; // ни ячейки, ни freeuse (гейт пропустил бы только с freeuse)
      } else if (options.length === 1) {
        choice = { via: 'slot', level: options[0] };
      } else {
        const picked = await requestCastChoice(baseLevel, options, undefined);
        if (!picked) return;
        choice = picked;
      }

      if (choice.via === 'free') {
        // Подменяем оплату ячейкой на трату freeuse-пула; действие (bonus/action) остаётся.
        mech = applyFreeuseCost(mech, freeuse!.key);
        spellCtx = { baseLevel, castLevel: freeuse!.level }; // фикс. круг бесплатного каста
      } else {
        const castLevel = choice.level;
        if (slotEntry && castLevel !== baseLevel) {
          const newCost = cost.map((c, i) => (i === slotIdx ? { ...c, level: castLevel } : c));
          mech = { ...mech, activation: { ...(activation ?? {}), cost: newCost } };
        }
        spellCtx = { baseLevel, castLevel };
      }
    } else if (action.spellRef) {
      spellCtx = { baseLevel: action.spellRef.level ?? action.level ?? 0 };
    }

    const needsTarget = actionNeedsTarget(mech);
    const target = needsTarget
      ? {
          ac: targetAc,
          saveMods: { dex: targetSaveMod, con: targetSaveMod, str: targetSaveMod, int: targetSaveMod, wis: targetSaveMod, cha: targetSaveMod },
        }
      : undefined;

    // passives нужны движку и для модификаторов (фаза C), и для триггеров/реакций (фаза A).
    // planning=true у плана кубов: спасброски берут ветку провала (кости урона попадают в план).
    const execCtx = (rng: () => number, planning = false, choices: Record<string, string[]> = {}) =>
      ({ character: ctx, target, rng, passives, planning, choices, grantedEffects: grantedEffectsBySlug, ...(spellCtx ? { spell: spellCtx } : {}) }) as ExecuteContext & { passives: typeof passives };

    // Превью действия/заклинания для диалога кубов (видно, ради чего бросок).
    const previewFor = (a: SheetAction): ReactNode => {
      if (a.spellRef) {
        return <SpellPreview spell={a.spellRef} disableHover spellcasting={ruleState.spellcasting
          ? { saveDC: ruleState.spellcasting.saveDC, attack: ruleState.spellcasting.attack } : undefined} />;
      }
      if (a.actionRef) {
        return <ActionHoverCard action={a.actionRef} sourceLabel={a.sourceLabel}
          weaponAttackPreview={weaponAttackPreview(a.mechanics, ctx, runtime.equipment, runtime, passives) ?? undefined} />;
      }
      return null;
    };

    // Прогон механики через диалог кубов: план кубов → вопрос игроку → реальный бросок.
    const runViaDialog = async (
      baseState: RuntimeState,
      m: Record<string, unknown>,
      title: string,
      preview?: ReactNode,
      confirm = false,
    ): Promise<{ state: RuntimeState; events: EngineEvent[]; pending: ReactionOffer[] } | null> => {
      // Ярус 1.2: выборы context:'in_play' ВНУТРИ действия (вариант эффекта при активации) —
      // спрашиваем ДО плана кубов, чтобы и план, и реальный прогон шли по выбранной ветке.
      const inPlay = collectInPlayActionChoices(m, { kind: 'other', id: 'action', name: title });
      const choices: Record<string, string[]> = {};
      if (inPlay.length) {
        const picked = await choiceDialog.request(inPlay, title);
        if (!picked) return null; // отмена выбора = отмена действия
        for (const [k, v] of Object.entries(picked)) if (v.length) choices[k] = v;
      }
      const plan = extractDiceFromEvents(executeAction(baseState, m, execCtx(PLANNING_RNG, true, choices)).events);
      const decision = await diceDialog.request(plan, title, preview, { confirm });
      if (decision.mode === 'cancel') return null;
      const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      const r = executeAction(baseState, m, execCtx(rng, false, choices));
      return { state: r.state, events: r.events, pending: r.pendingReactions ?? [] };
    };

    try {
      // Подтверждение «Применить»/«Отмена» для действий, тратящих ЛЮБОЙ ресурс (основное/бонусное
      // действие, реакцию, слот, заряд, …) или заклинаний — даже когда кубов нет (при включённом
      // диалоге кубов). Атаки с кубами и так показывают окно броска.
      const needsConfirm = spendsResource(mech) || !!action.spellRef;
      const main = await runViaDialog(runtime, mech, action.name, previewFor(action), needsConfirm);
      if (!main) return;
      let { state, events } = main;
      // Заклинание с концентрацией: чип + вытеснение предыдущей концентрации.
      if (action.spellRef?.concentration) {
        const conc = startConcentration(state, action.name);
        state = conc.state;
        events = [...events, ...conc.events];
      }

      // Предложенные реакции/триггеры со стоимостью (фаза A): спрашиваем игрока.
      for (const offer of main.pending) {
        if (!canPay(state, offer.cost).ok) continue;
        const decision = await reactionPrompt.request(offer, describeMechanicsLine(offer.mechanics));
        if (decision !== 'accept') continue;
        const rmech = { ...offer.mechanics, name: offer.name };
        const r = await runViaDialog(state, rmech, offer.name);
        if (!r) continue;
        state = r.state;
        events = [...events, ...r.events];
      }

      apply(state, events);
    } catch (e) {
      if (e instanceof InsufficientResourcesError) {
        setError('Недостаточно ресурсов');
        return;
      }
      throw e;
    }
  };

  // Доступность + причина недоступности: сперва экипировка (оружие в руке), затем ресурсы.
  const disabledInfo = (action: SheetAction): { disabled: boolean; reason?: string } => {
    const avail = weaponActionAvailability(action.mechanics, runtime.equipment, equipCards);
    if (!avail.available) return { disabled: true, reason: avail.reason };
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const baseCost = (activation?.cost as Record<string, unknown>[]) ?? [];
    // S5: дальнобойное оружие требует боеприпас — добавляем его к проверяемой стоимости.
    const ammo = weaponAmmoCost(action.mechanics, runtime.equipment, equipCards);
    const cost = ammo ? [...baseCost, ammo] : baseCost;
    // Апкаст: спелл доступен при любом слоте ≥ базового круга; freeuse — при наличии пула
    // (даже без ячеек, напр. предмет-каст у не-кастера).
    const payable = !cost.length || payableWithUpcast(runtime, cost) || !!freeuseFor(action);
    if (!payable) {
      // Внятная причина для нехватки предмета-стоимости (боеприпас/зелье): показываем имя.
      const miss = cost.find((c) => String(c.resource ?? '') === 'item'
        && inventoryQty(runtime, String(c.card_id ?? '')) < costAmount(c));
      if (miss) {
        const name = (typeof miss.name === 'string' && miss.name)
          || equipCards.get(String(miss.card_id ?? ''))?.name || 'боеприпас';
        return { disabled: true, reason: `Нет: ${name}` };
      }
      return { disabled: true, reason: 'Недостаточно ресурсов' };
    }
    return { disabled: busy };
  };

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  const allGroups: { key: string; label: string; items: SheetAction[] }[] = [
    { key: 'basic', label: 'Базовые', items: actions.filter((a) => a.group === 'basic') },
    { key: 'race', label: 'Вид', items: actions.filter((a) => a.group === 'race') },
    { key: 'class', label: 'Класс', items: actions.filter((a) => a.group === 'class') },
    { key: 'item', label: 'Предметы', items: actions.filter((a) => a.group === 'item') },
    { key: 'spell', label: 'Заклинания', items: actions.filter((a) => a.group === 'spell') },
  ];
  // Режим «только заклинания»: группировка по кругам (тот же SheetActionLine и то же
  // поведение по клику/наведению, что и в блоке «Действия»).
  const spellLevelGroups: { key: string; label: string; items: SheetAction[] }[] = (() => {
    const m = new Map<number, SheetAction[]>();
    for (const a of actions) {
      if (a.group !== 'spell') continue;
      const lvl = a.spellRef?.level ?? a.level ?? 0;
      if (!m.has(lvl)) m.set(lvl, []);
      m.get(lvl)!.push(a);
    }
    return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([lvl, items]) => ({ key: `lvl-${lvl}`, label: getSpellLevelLabel(lvl), items }));
  })();
  const groups = spellsOnly ? spellLevelGroups : allGroups;

  const body = (
    <>
      {error && <p className="issues">{error}</p>}

      {showResources && !spellsOnly && resourceKeys.length > 0 && (
        <div className="res-tile-row">
          {resourceKeys.map((key) => {
            const cur = runtime.resources[key] ?? 0;
            const max = runtime.maxResources[key];
            const spent = cur <= 0;
            const slot = /^spell_slot_(\d)$/.exec(key);
            const warlockSlot = /^warlock_spell_slot(?:_(\d))?$/.exec(key);
            // Иконка: справочник ресурсов (кастомная, incl. spent) → хардкод → ячейки.
            const def = findResource(resourceOptions, key);
            const dictIcon = def?.imageUrl && !def.imageUrl.startsWith('/charges/') ? def.imageUrl : undefined;
            const dictSpent = def?.imageUrlSpent && !def.imageUrlSpent.startsWith('/charges/') ? def.imageUrlSpent : undefined;
            const icon = (spent && dictSpent) || dictIcon
              || RESOURCE_ICONS[key]
              || (slot ? RESOURCE_ICONS.spell_slot : undefined)
              || (warlockSlot ? RESOURCE_ICONS.warlock_spell_slot : undefined);
            const useSpentImg = spent && !!dictSpent; // если своя spent-картинка — CSS-фильтр не нужен
            const label = slot ? `Ячейка ${slot[1]}-го круга`
              : warlockSlot ? 'Ячейка колдуна'
              : (def?.label || RESOURCE_LABELS[key] || key);
            const roman = slot ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][Number(slot[1])] : '';
            return (
              <div key={key} className={`res-tile${spent ? ' res-tile--spent' : ''}`} title={`${cur}/${max} ${label}${def?.description ? `\n${def.description}` : ''}`}>
                {roman && <span className="res-tile-corner">{roman}</span>}
                {icon
                  ? <img src={icon} alt="" className={`res-tile-icon${spent && !useSpentImg ? ' res-tile-icon--dim' : ''}`} />
                  : <span className={`res-tile-mono${spent ? ' res-tile-mono--dim' : ''}`}>{label.slice(0, 2)}</span>}
                {max > 1 && cur !== 1 && <span className="res-tile-count">{cur}</span>}
              </div>
            );
          })}
          <FreeuseSpellsTile
            runtime={runtime}
            freeuseSpells={ruleState.freeuseSpells}
            spells={assembled.spells}
            resourceOptions={resourceOptions}
          />
        </div>
      )}

      {/* «КЗ/Спас цели» — только в основной панели действий; блок «Заклинания»
          (spellsOnly) переиспользует общий таргет родителя, поле не дублирует. */}
      {!spellsOnly && (
        <div className="sheet-target-inputs">
          <label className="sheet-target-field">
            <span>КЗ цели</span>
            <input
              type="number"
              className="forge-input sheet-target-num"
              value={targetAc}
              min={1}
              max={30}
              onChange={(e) => setTargetAc(Number(e.target.value) || 10)}
            />
          </label>
          <label className="sheet-target-field">
            <span>Спас цели</span>
            <input
              type="number"
              className="forge-input sheet-target-num"
              value={targetSaveMod}
              min={-5}
              max={20}
              onChange={(e) => setTargetSaveMod(Number(e.target.value) || 0)}
            />
          </label>
        </div>
      )}

      {groups.map(({ key, label, items }) => items.length > 0 && (
        <div key={key} className="sheet-group">
          <h3 className="sheet-h3">{label}</h3>
          <div className={actionsAsIcons ? 'cs-action-tiles' : 'sheet-item-cols'}>
            {items.map((action) => {
              const { disabled, reason } = disabledInfo(action);
              const weaponPreview = weaponAttackPreview(action.mechanics, ctx, runtime.equipment, runtime, passives) ?? undefined;
              return (
                <div key={action.id} data-action-id={action.id} style={actionsAsIcons ? { display: 'contents' } : undefined}>
                <SheetActionLine
                  name={action.name}
                  imageUrl={action.imageUrl}
                  sourceLabel={action.sourceLabel ?? (action.group === 'basic' ? 'Базовое действие' : undefined)}
                  description={action.group === 'basic' ? action.description ?? action.name : undefined}
                  detail={actionDetail(action)}
                  level={action.level}
                  variant={actionsAsIcons ? 'icon' : 'row'}
                  actionRef={action.actionRef}
                  effectRef={action.effectRef}
                  spellRef={action.spellRef}
                  spellcasting={ruleState.spellcasting
                    ? { saveDC: ruleState.spellcasting.saveDC, attack: ruleState.spellcasting.attack }
                    : undefined}
                  weaponAttackPreview={weaponPreview}
                  disabled={disabled}
                  disabledTitle={reason ?? 'Недостаточно ресурсов'}
                  onActivate={() => runAction(action)}
                />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {slotPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Выбор источника оплаты заклинания">
          <div className="absolute inset-0 bg-black/50" onClick={() => resolveCast(null)} />
          <div className="relative rounded-lg border border-[#8a7320] bg-[#1c1813] text-[#e8e0d0] shadow-xl p-4 w-72 max-w-[90vw]">
            <div className="text-sm mb-3" style={{ color: '#d8b978' }}>Как сотворить?</div>
            <div className="flex flex-col gap-1">
              {slotPick.freeuse && (
                <button
                  type="button"
                  onClick={() => resolveCast({ via: 'free' })}
                  className="flex items-center justify-between px-3 py-2 rounded border border-[#8a7320] bg-[#241f16] hover:bg-[#2b2520] text-sm text-left"
                >
                  <span>Бесплатно{slotPick.freeuse.level > slotPick.baseLevel ? ` · ${getSpellLevelLabel(slotPick.freeuse.level)}` : ''}</span>
                  <span className="text-[#d8b978] text-xs">{slotPick.freeuse.current}/{slotPick.freeuse.max}</span>
                </button>
              )}
              {slotPick.options.map((L) => (
                <button
                  key={L}
                  type="button"
                  onClick={() => resolveCast({ via: 'slot', level: L })}
                  className="flex items-center justify-between px-3 py-2 rounded border border-[#6b5836] hover:bg-[#2b2520] text-sm text-left"
                >
                  <span>{getSpellLevelLabel(L)}{L > slotPick.baseLevel ? ' · апкаст' : ''}</span>
                  <span className="text-[#a99f8b] text-xs">слотов: {runtime.resources[`spell_slot_${L}`] ?? 0}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => resolveCast(null)}
              className="mt-3 w-full px-3 py-1.5 rounded border border-[#6b5836] text-xs text-[#a99f8b] hover:bg-[#2b2520]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {showEffects && !spellsOnly && runtime.activeEffects.length > 0 && (
        <div className="sheet-group" style={{ marginTop: 8 }}>
          <h3 className="sheet-h3">Активные эффекты</h3>
          <ul className="sheet-active-effects">
            {runtime.activeEffects.map((fx) => (
              <li key={fx.id} className="sheet-active-effect">
                <span className="sheet-active-effect-name">{fx.name}</span>
                <span className="sheet-active-effect-meta">{expiryLabel(fx.expiry)}</span>
                <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy}
                  title="Снять вручную"
                  onClick={() => handleDismissEffect(fx.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <section className="sheet-panel sheet-panel-wide">
      <h2 className="sheet-h2">Действия</h2>
      {body}
      <p className="forge-note" style={{ marginTop: 8 }}>
        Атаки используют КЗ цели выше. Результаты — в журнале с анимацией броска.
      </p>
    </section>
  );
}
