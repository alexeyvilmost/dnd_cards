import { useCallback, useMemo, useState } from 'react';
import { Shield, Sparkles, Swords, Wand2 } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { actionNeedsTarget, collectSheetActions, type SheetAction } from '../character/actionSheet';
import { collectPassiveMechanics } from '../character/resourceInit';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { canPay } from '../engine/cost';
import { executeAction, InsufficientResourcesError } from '../engine/execute';
import type { Card } from '../types';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  equipCards: Map<string, Card>;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
}

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

function actionIcon(action: SheetAction) {
  if (action.id === 'standard-dodge') return <Shield size={14} />;
  if (action.group === 'spell') return <Wand2 size={14} />;
  if (action.group === 'class') return <Sparkles size={14} />;
  return <Swords size={14} />;
}

export default function SheetActionsPanel({
  character,
  assembled,
  ruleState,
  equipCards,
  onUpdated,
  onEvents,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetAc, setTargetAc] = useState(10);
  const [targetDc, setTargetDc] = useState(12);

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

  const groups: { key: SheetAction['group']; label: string; items: SheetAction[] }[] = [
    { key: 'basic', label: 'Базовые', items: actions.filter((a) => a.group === 'basic') },
    { key: 'class', label: 'Класс и вид', items: actions.filter((a) => a.group === 'class') },
    { key: 'spell', label: 'Заклинания', items: actions.filter((a) => a.group === 'spell') },
  ];

  return (
    <section className="sheet-panel sheet-panel-wide">
      <h2 className="sheet-h2">Действия</h2>
      {error && <p className="issues">{error}</p>}

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
          <span>СЛ (спасброски)</span>
          <input
            type="number"
            className="forge-input sheet-target-num"
            value={targetDc}
            min={1}
            max={30}
            onChange={(e) => setTargetDc(Number(e.target.value) || 12)}
          />
        </label>
      </div>

      {groups.map(({ key, label, items }) => items.length > 0 && (
        <div key={key} className="sheet-group">
          <h3 className="sheet-h3">{label}</h3>
          <div className="sheet-combat-actions">
            {items.map((action) => {
              const disabled = isDisabled(action);
              return (
                <button
                  key={action.id}
                  type="button"
                  className={`forge-btn ghost sheet-combat-action${disabled ? ' sheet-combat-action-disabled' : ''}`}
                  disabled={disabled}
                  title={disabled ? 'Недостаточно ресурсов' : action.name}
                  onClick={() => runAction(action)}
                >
                  {actionIcon(action)}
                  {action.name}
                  {action.group === 'spell' && action.level != null && (
                    <span className="sheet-action-lvl">{action.level === 0 ? 'З' : action.level}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="forge-note" style={{ marginTop: 8 }}>
        Атаки и спасброски используют КЗ/СЛ цели выше. Результаты — в журнале с анимацией броска.
      </p>
    </section>
  );
}
