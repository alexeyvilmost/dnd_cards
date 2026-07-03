import { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { actionNeedsTarget, collectSheetActions, type SheetAction } from '../character/actionSheet';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { canPay } from '../engine/cost';
import { executeAction, InsufficientResourcesError } from '../engine/execute';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import type { Card } from '../types';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import SheetActionLine from './SheetActionLine';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  equipCards: Map<string, Card>;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  embedded?: boolean;
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  second_wind: 'Второе дыхание',
  heroic_inspiration: 'Вдохновение',
};

const RESOURCE_ICONS: Record<string, string> = {
  action: '/icons/resources/action.png',
  bonus_action: '/icons/resources/bonus_action.png',
  reaction: '/icons/resources/reaction.png',
  spell_slot: '/icons/resources/spell_slot.png',
  warlock_spell_slot: '/icons/resources/warlock_spell_slot.png',
};

function persistPayload(state: RuntimeState) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    resources: state.resources,
    max_resources: state.maxResources,
    active_effects: state.activeEffects,
    turn_state: { temp_hp: state.hp.temp },
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
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetAc, setTargetAc] = useState(10);

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );
  const passives = useMemo(() => collectPassiveMechanics(assembled), [assembled]);

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
    }),
    [ruleState, character, equippedCards, assembled.klass, passives],
  );

  const actions = useMemo(() => collectSheetActions(assembled), [assembled]);
  const resourceKeys = Object.keys(runtime.maxResources).filter((k) => runtime.maxResources[k] > 0);

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const runAction = (action: SheetAction) => {
    const mech = { ...action.mechanics, name: action.name };
    const activation = mech.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    if (cost.length && !canPay(runtime, cost).ok) return;

    const needsTarget = actionNeedsTarget(mech);
    const target = needsTarget
      ? {
          ac: targetAc,
          saveMods: { dex: 0, con: 0, str: 0, int: 0, wis: 0, cha: 0 },
        }
      : undefined;

    try {
      const { state, events } = executeAction(runtime, mech, {
        character: ctx,
        target,
        rng: () => Math.random(),
      });
      apply(state, events);
    } catch (e) {
      if (e instanceof InsufficientResourcesError) {
        setError('Недостаточно ресурсов');
        return;
      }
      throw e;
    }
  };

  const isDisabled = (action: SheetAction): boolean => {
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    if (!cost.length) return busy;
    return busy || !canPay(runtime, cost).ok;
  };

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  const groups: { key: SheetAction['group']; label: string; items: SheetAction[] }[] = [
    { key: 'basic', label: 'Базовые', items: actions.filter((a) => a.group === 'basic') },
    { key: 'race', label: 'Вид', items: actions.filter((a) => a.group === 'race') },
    { key: 'class', label: 'Класс', items: actions.filter((a) => a.group === 'class') },
    { key: 'spell', label: 'Заклинания', items: actions.filter((a) => a.group === 'spell') },
  ];

  const body = (
    <>
      {error && <p className="issues">{error}</p>}

      {resourceKeys.length > 0 && (
        <div className="cs-resources">
          {resourceKeys.map((key) => (
            <div key={key} className="cs-resource" title={key}>
              {RESOURCE_ICONS[key] && (
                <img src={RESOURCE_ICONS[key]} alt="" className="cs-resource-icon" />
              )}
              <span className="cs-resource-l">{RESOURCE_LABELS[key] ?? key}</span>
              <span className="cs-resource-v">
                {runtime.resources[key] ?? 0}/{runtime.maxResources[key]}
              </span>
            </div>
          ))}
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
          <div className="cs-action-lines">
            {items.map((action) => {
              const disabled = isDisabled(action);
              return (
                <SheetActionLine
                  key={action.id}
                  name={action.name}
                  imageUrl={action.imageUrl}
                  sourceLabel={action.sourceLabel ?? (action.group === 'basic' ? 'Базовое действие' : undefined)}
                  description={action.group === 'basic' ? action.name : undefined}
                  level={action.level}
                  actionRef={action.actionRef}
                  effectRef={action.effectRef}
                  spellRef={action.spellRef}
                  disabled={disabled}
                  disabledTitle="Недостаточно ресурсов"
                  onActivate={() => runAction(action)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {runtime.activeEffects.length > 0 && (
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
