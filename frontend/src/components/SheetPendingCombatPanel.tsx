import { useEffect, useState } from 'react';
import type {
  DecisionResponse,
  PendingResolution,
  ReactionActionOption,
  ReactionSpellSourceOption,
} from '../rules-core/domain';
import { resourceLabel } from '../utils/resources';

export interface SheetPendingCombatPanelProps {
  pending: PendingResolution;
  viewingCharacterId: string;
  /** Writable character sheet allowed to answer for a scene-owned actor. */
  decisionProxyCharacterId?: string;
  actorNames?: Readonly<Record<string, string>>;
  busy?: boolean;
  onResolve: (response: DecisionResponse) => void | Promise<void>;
}

export interface SheetReactionDecisionOption {
  id: string;
  label: string;
  response: Extract<DecisionResponse, { kind: 'reaction' }>;
}

function spellResponse(
  action: ReactionActionOption,
  source: ReactionSpellSourceOption,
): Extract<DecisionResponse, { kind: 'reaction' }> {
  return {
    kind: 'reaction',
    actionId: action.actionId,
    spell: {
      grantId: source.grantId,
      mode: 'normal',
      ...(source.payment.kind === 'free_use' ? { preferFreeUse: true } : {}),
      ...(source.payment.kind === 'slot' ? { preferFreeUse: false } : {}),
    },
  };
}

/** UI choices are a lossless projection of the pending request, not a spell-name switch. */
export function sheetReactionDecisionOptions(
  options: readonly ReactionActionOption[],
): SheetReactionDecisionOption[] {
  return options.flatMap((action) => {
    if (action.spellSources?.length) {
      return action.spellSources.map((source) => ({
        id: `${action.actionId}:${source.grantId}:${source.payment.kind}:${source.payment.resource ?? ''}`,
        label: `${action.label} · ${source.payment.kind === 'free_use'
          ? 'бесплатное использование'
          : source.payment.kind === 'slot'
            ? resourceLabel([], source.payment.resource) || 'ячейка'
            : 'без стоимости'}`,
        response: spellResponse(action, source),
      }));
    }
    return [{
      id: action.actionId,
      label: action.label,
      response: { kind: 'reaction' as const, actionId: action.actionId },
    }];
  });
}

export function pendingSheetCombatDecisionActorId(pending: PendingResolution): string | null {
  return pending.request.actorId;
}

export default function SheetPendingCombatPanel({
  pending,
  viewingCharacterId,
  decisionProxyCharacterId,
  actorNames = {},
  busy = false,
  onResolve,
}: SheetPendingCombatPanelProps) {
  const [manualD20, setManualD20] = useState('');
  const [selectedAbility, setSelectedAbility] = useState<string>('');
  const decidingActorId = pendingSheetCombatDecisionActorId(pending);
  const decidingName = decidingActorId ? actorNames[decidingActorId] ?? decidingActorId : '';

  useEffect(() => {
    setManualD20('');
    setSelectedAbility('');
  }, [pending.id]);

  if (pending.request.type !== 'saving_throw'
    && pending.request.type !== 'reaction') {
    return (
      <section className="sheet-group" role="alert" data-testid="sheet-combat-unsupported-pending">
        Продолжение «{pending.type}» не поддержано этим интерфейсом. Состояние сохранено без изменений.
      </section>
    );
  }

  const canResolve = decidingActorId === viewingCharacterId
    || decisionProxyCharacterId === viewingCharacterId;
  if (!canResolve) {
    return (
      <section className="sheet-group" role="status" data-testid="sheet-combat-awaiting-target">
        <h3 className="sheet-h3">Ожидается решение</h3>
        <p>Решение принимает {decidingName} в своём листе.</p>
        {decidingActorId ? (
          <a className="forge-btn ghost" href={`/characters-v3/${decidingActorId}`}>
            Открыть лист цели
          </a>
        ) : null}
      </section>
    );
  }

  if (pending.request.type === 'saving_throw') {
    const saveRequest = pending.request;
    if (!Number.isSafeInteger(saveRequest.dc)
      || saveRequest.dc < 1
      || !saveRequest.ability) {
      return (
        <section className="sheet-group" role="alert">
          Сохранённый запрос спасброска не содержит корректных compiled DC/ability; решение заблокировано.
        </section>
      );
    }
    const abilityOptions = saveRequest.abilityOptions?.length
      ? saveRequest.abilityOptions
      : [saveRequest.ability];
    const ability = abilityOptions.includes(selectedAbility as typeof saveRequest.ability)
      ? selectedAbility as typeof saveRequest.ability
      : saveRequest.ability;
    const d20 = Number(manualD20);
    const manualValid = Number.isSafeInteger(d20) && d20 >= 1 && d20 <= 20;
    const title = pending.type === 'concentration_save'
      ? `Концентрация: спасбросок ${ability.toUpperCase()}`
      : `Спасбросок ${ability.toUpperCase()}`;
    return (
      <section
        className="sheet-group"
        role="group"
        aria-label="Ожидающий спасбросок"
        data-testid={pending.type === 'target_save'
          ? 'sheet-combat-target-save'
          : 'sheet-combat-saving-throw'}
      >
        <h3 className="sheet-h3">{title}</h3>
        <p>
          {decidingName}: СЛ {saveRequest.dc}.
          {pending.type === 'concentration_save'
            ? ` Получено урона: ${pending.damage}.`
            : ''}
          {' '}Решение восстановлено из общего снимка боя.
        </p>
        {abilityOptions.length > 1 ? (
          <label className="sheet-target-field">
            <span>Характеристика</span>
            <select
              className="forge-input"
              aria-label="Характеристика спасброска"
              value={ability}
              onChange={(event) => setSelectedAbility(event.target.value)}
            >
              {abilityOptions.map((option) => (
                <option key={option} value={option}>{option.toUpperCase()}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="sheet-target-field">
          <span>Результат d20</span>
          <input
            className="forge-input sheet-target-num"
            aria-label="Результат d20 спасброска"
            type="number"
            min={1}
            max={20}
            value={manualD20}
            onChange={(event) => setManualD20(event.target.value)}
          />
        </label>
        <div className="flex gap-2 flex-wrap mt-2">
          <button
            type="button"
            className="forge-btn"
            disabled={busy || !manualValid}
            onClick={() => onResolve({
              kind: 'roll',
              roll: { mode: 'manual', dice: [{ sides: 20, value: d20 }] },
              ...(saveRequest.abilityOptions?.length ? { selectedAbility: ability } : {}),
            })}
          >
            Применить d20
          </button>
          <button
            type="button"
            className="forge-btn ghost"
            disabled={busy}
            onClick={() => onResolve({
              kind: 'roll',
              roll: { mode: 'system' },
              ...(saveRequest.abilityOptions?.length ? { selectedAbility: ability } : {}),
            })}
          >
            Бросить автоматически
          </button>
        </div>
      </section>
    );
  }

  if (pending.request.type !== 'reaction') return null;
  const options = sheetReactionDecisionOptions(pending.request.options);
  const trigger = pending.request.trigger;
  const sourceName = actorNames[trigger.sourceActorId] ?? trigger.sourceActorId;
  const reactionCopy = (() => {
    switch (trigger.type) {
      case 'damage_taken':
        return {
          title: 'Реакция перед получением урона',
          detail: `${decidingName}: входящий урон — ${trigger.amount}`
            + `${trigger.damageTypes.length ? ` (${trigger.damageTypes.join(', ')})` : ''}.`,
        };
      case 'hit_by_attack':
        return {
          title: 'Реакция на попадание',
          detail: `${sourceName}: результат атаки ${trigger.attackTotal}; исходный КД ${trigger.originalAc}.`,
        };
      case 'targeted_by_magic_missile':
        return {
          title: 'Реакция на Волшебную стрелу',
          detail: `${decidingName}: направлено дротиков — ${trigger.dartCount}.`,
        };
      case 'protection_before_attack':
        return {
          title: 'Реакция перед атакой',
          detail: `${decidingName} может защитить цель атаки ${trigger.targetActorId}.`,
        };
    }
  })();
  return (
    <section
      className="sheet-group"
      role="group"
      aria-label="Ожидающая реакция"
      data-testid={pending.type === 'damage_reaction'
        ? 'sheet-combat-damage-reaction'
        : pending.type === 'magic_missile_reaction'
          ? 'sheet-combat-magic-missile-reaction'
          : 'sheet-combat-reaction'}
    >
      <h3 className="sheet-h3">{reactionCopy.title}</h3>
      <p>{reactionCopy.detail}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="forge-btn"
            disabled={busy}
            onClick={() => onResolve(option.response)}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className="forge-btn ghost"
          disabled={busy}
          onClick={() => onResolve({ kind: 'reaction', actionId: null })}
        >
          Не использовать реакцию
        </button>
      </div>
    </section>
  );
}
