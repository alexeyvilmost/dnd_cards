import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { actionNeedsTarget, collectSheetActions, type SheetAction } from '../character/actionSheet';
import { useBasicActions } from '../character/basicActions';
import { collectItemMechanics, readAttunedIds } from '../character/attunement';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { isActionUsesKey } from '../engine/actionUses';
import { startConcentration } from '../engine/concentration';
import { canPay } from '../engine/cost';
import { extractDiceFromEvents, plannedValuesRng, PLANNING_RNG } from '../engine/dicePlan';
import { executeAction, InsufficientResourcesError } from '../engine/execute';
import { describeMechanicsLine } from '../engine/describeMechanics';
import { weaponActionAvailability, weaponAttackPreview } from '../engine/weapon';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { findResource, useResourceOptions } from '../utils/resources';
import { useSiteSettings } from '../settings';
import type { Card } from '../types';
import type { EngineEvent, ExecuteContext, ReactionOffer, RuntimeState } from '../mvp/contracts';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import SheetActionLine from './SheetActionLine';
import SpellPreview from './SpellPreview';
import ActionHoverCard from './forge/ActionHoverCard';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  equipCards: Map<string, Card>;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  embedded?: boolean;
  /** false — ресурсы/эффекты рисует соседняя SheetRuntimePanel (классический макет). */
  showResources?: boolean;
  showEffects?: boolean;
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  heroic_inspiration: 'Вдохновение',
};

const RESOURCE_ICONS: Record<string, string> = {
  action: '/icons/resources/action.png',
  bonus_action: '/icons/resources/bonus_action.png',
  reaction: '/icons/resources/reaction.png',
  spell_slot: '/icons/resources/spell_slot.png',
  warlock_spell_slot: '/icons/resources/warlock_spell_slot.png',
};

function persistPayload(state: RuntimeState, prevTurnState: Record<string, unknown> | null | undefined) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    resources: state.resources,
    max_resources: state.maxResources,
    active_effects: state.activeEffects,
    // temp_hp обновляем, остальные поля turn_state (спасброски смерти) сохраняем
    turn_state: { ...(prevTurnState ?? {}), temp_hp: state.hp.temp },
  };
}

export default function SheetActionsPanel({
  character,
  assembled,
  ruleState,
  equipCards,
  onUpdated,
  onEvents,
  embedded,
  showResources = true,
  showEffects = true,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetAc, setTargetAc] = useState(10);
  const diceDialog = useDiceDialog();
  const reactionPrompt = useReactionPrompt();

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );
  // Пассивки персонажа + механики надетых предметов (с учётом настройки).
  const passives = useMemo(() => {
    const items = collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state)
      .map((im) => im.mechanics);
    return [...collectPassiveMechanics(assembled), ...items];
  }, [assembled, character.equipment, character.turn_state, equipCards]);

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
    () => collectItemMechanics(character.equipment ?? {}, equipCards, character.turn_state),
    [character.equipment, character.turn_state, equipCards],
  );
  const basicActions = useBasicActions();
  const actions = useMemo(
    () => collectSheetActions(assembled, itemMechs, basicActions),
    [assembled, itemMechs, basicActions],
  );
  const resourceOptions = useResourceOptions();
  const { entityDisplay } = useSiteSettings();
  const actionsAsIcons = entityDisplay.actions === 'icon';
  // uses_<key> — пулы использований действий: не плитки-ресурсы, остаток на строке действия.
  const resourceKeys = Object.keys(runtime.maxResources)
    .filter((k) => runtime.maxResources[k] > 0 && !isActionUsesKey(k));

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next, character.turn_state));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const runAction = async (action: SheetAction) => {
    const mech: Record<string, unknown> = { ...action.mechanics, name: action.name };
    const activation = mech.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    if (cost.length && !canPay(runtime, cost).ok) return;
    // Оружейное действие без нужного оружия в руке — не запускаем.
    if (!weaponActionAvailability(action.mechanics, runtime.equipment, equipCards).available) return;

    const needsTarget = actionNeedsTarget(mech);
    const target = needsTarget
      ? {
          ac: targetAc,
          saveMods: { dex: 0, con: 0, str: 0, int: 0, wis: 0, cha: 0 },
        }
      : undefined;

    // passives нужны движку и для модификаторов (фаза C), и для триггеров/реакций (фаза A).
    // planning=true у плана кубов: спасброски берут ветку провала (кости урона попадают в план).
    const execCtx = (rng: () => number, planning = false) =>
      ({ character: ctx, target, rng, passives, planning }) as ExecuteContext & { passives: typeof passives };

    // Превью действия/заклинания для диалога кубов (видно, ради чего бросок).
    const previewFor = (a: SheetAction): ReactNode => {
      if (a.spellRef) {
        return <SpellPreview spell={a.spellRef} disableHover spellcasting={ruleState.spellcasting
          ? { saveDC: ruleState.spellcasting.saveDC, attack: ruleState.spellcasting.attack } : undefined} />;
      }
      if (a.actionRef) {
        return <ActionHoverCard action={a.actionRef} sourceLabel={a.sourceLabel}
          weaponAttackPreview={weaponAttackPreview(a.mechanics, ctx, runtime.equipment) ?? undefined} />;
      }
      return null;
    };

    // Прогон механики через диалог кубов: план кубов → вопрос игроку → реальный бросок.
    const runViaDialog = async (
      baseState: RuntimeState,
      m: Record<string, unknown>,
      title: string,
      preview?: ReactNode,
    ): Promise<{ state: RuntimeState; events: EngineEvent[]; pending: ReactionOffer[] } | null> => {
      const plan = extractDiceFromEvents(executeAction(baseState, m, execCtx(PLANNING_RNG, true)).events);
      const decision = await diceDialog.request(plan, title, preview);
      if (decision.mode === 'cancel') return null;
      const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      const r = executeAction(baseState, m, execCtx(rng));
      return { state: r.state, events: r.events, pending: r.pendingReactions ?? [] };
    };

    try {
      const main = await runViaDialog(runtime, mech, action.name, previewFor(action));
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
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    const payable = !cost.length || canPay(runtime, cost).ok;
    if (!payable) return { disabled: true, reason: 'Недостаточно ресурсов' };
    return { disabled: busy };
  };

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  const groups: { key: SheetAction['group']; label: string; items: SheetAction[] }[] = [
    { key: 'basic', label: 'Базовые', items: actions.filter((a) => a.group === 'basic') },
    { key: 'race', label: 'Вид', items: actions.filter((a) => a.group === 'race') },
    { key: 'class', label: 'Класс', items: actions.filter((a) => a.group === 'class') },
    { key: 'item', label: 'Предметы', items: actions.filter((a) => a.group === 'item') },
    { key: 'spell', label: 'Заклинания', items: actions.filter((a) => a.group === 'spell') },
  ];

  const body = (
    <>
      {error && <p className="issues">{error}</p>}

      {showResources && resourceKeys.length > 0 && (
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
        </div>
      )}

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
      </div>

      {groups.map(({ key, label, items }) => items.length > 0 && (
        <div key={key} className="sheet-group">
          <h3 className="sheet-h3">{label}</h3>
          <div className={actionsAsIcons ? 'cs-action-tiles' : 'cs-action-lines'}>
            {items.map((action) => {
              const { disabled, reason } = disabledInfo(action);
              const weaponPreview = weaponAttackPreview(action.mechanics, ctx, runtime.equipment) ?? undefined;
              return (
                <div key={action.id} data-action-id={action.id} style={actionsAsIcons ? { display: 'contents' } : undefined}>
                <SheetActionLine
                  name={action.name}
                  imageUrl={action.imageUrl}
                  sourceLabel={action.sourceLabel ?? (action.group === 'basic' ? 'Базовое действие' : undefined)}
                  description={action.group === 'basic' ? action.description ?? action.name : undefined}
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

      {showEffects && runtime.activeEffects.length > 0 && (
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
