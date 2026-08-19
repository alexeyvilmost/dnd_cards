import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Relation, RuleActionDefinition, SpatialFacts } from '../rules-core/domain';
import {
  sheetCombatDeclarationPolicy,
  type SheetCombatTargetFactDraft,
} from '../character/sheetCombatDeclaration';
import '../contexts/DiceDialog.css';
import './SheetCombatTargetDialog.css';

export interface SheetCombatTargetCandidate {
  id: string;
  name: string;
  disabled?: boolean;
  reason?: string;
}

export interface SheetCombatTargetDialogResult {
  targets: SheetCombatTargetFactDraft[];
  dartAllocation?: Record<string, number>;
}

interface TargetDraft {
  selected: boolean;
  factsSource: SpatialFacts['factsSource'] | '';
  boardRevision: string;
  relation: Relation | '';
  distanceFt: string;
  lineOfSight: 'unknown' | 'yes' | 'no';
  cover: NonNullable<SpatialFacts['cover']> | '';
  darts: string;
}

interface DialogState {
  title: string;
  action: RuleActionDefinition;
  castLevel?: number;
  candidates: SheetCombatTargetCandidate[];
  drafts: Record<string, TargetDraft>;
  requireTarget: boolean;
}

export interface SheetCombatTargetDialogApi {
  request(input: {
    title: string;
    action: RuleActionDefinition;
    castLevel?: number;
    candidates: SheetCombatTargetCandidate[];
    /** Product workflow constraint: this command must exercise at least two sheets. */
    requireTarget?: boolean;
  }): Promise<SheetCombatTargetDialogResult | null>;
  dialog: ReactNode;
}

function initialDraft(
  candidate: SheetCombatTargetCandidate,
  select: boolean,
): TargetDraft {
  return {
    selected: select && !candidate.disabled,
    factsSource: '',
    boardRevision: '',
    relation: '',
    distanceFt: '',
    lineOfSight: 'unknown',
    cover: '',
    darts: '',
  };
}

export function useSheetCombatTargetDialog(): SheetCombatTargetDialogApi {
  const [state, setState] = useState<DialogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((result: SheetCombatTargetDialogResult | null) => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const finish = useCallback((result: SheetCombatTargetDialogResult | null) => {
    setState(null);
    setError(null);
    resolver.current?.(result);
    resolver.current = null;
    const focusTarget = returnFocus.current;
    returnFocus.current = null;
    if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
  }, []);

  const request = useCallback((input: {
    title: string;
    action: RuleActionDefinition;
    castLevel?: number;
    candidates: SheetCombatTargetCandidate[];
    requireTarget?: boolean;
  }): Promise<SheetCombatTargetDialogResult | null> => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    returnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const drafts = Object.fromEntries(input.candidates.map((candidate) => {
      return [candidate.id, initialDraft(
        candidate,
        false,
      )];
    }));
    setError(null);
    setState({
      title: input.title,
      action: input.action,
      castLevel: input.castLevel,
      candidates: input.candidates,
      drafts,
      requireTarget: input.requireTarget ?? false,
    });
  }), []);

  useEffect(() => {
    if (!state) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [finish, state]);

  const patch = (id: string, value: Partial<TargetDraft>) => setState((current) => (
    current ? {
      ...current,
      drafts: {
        ...current.drafts,
        [id]: { ...current.drafts[id], ...value },
      },
    } : current
  ));

  const submit = () => {
    if (!state) return;
    try {
      const policy = sheetCombatDeclarationPolicy(state.action, state.castLevel);
      const selected = state.candidates.filter((candidate) => state.drafts[candidate.id].selected);
      const minimum = state.requireTarget ? Math.max(1, policy.minTargets) : policy.minTargets;
      if (selected.length < minimum || selected.length > policy.maxTargets) {
        throw new Error(`Выберите от ${minimum} до ${policy.maxTargets} целей`);
      }
      const targets: SheetCombatTargetFactDraft[] = selected.map((candidate) => {
        const draft = state.drafts[candidate.id];
        return {
          targetId: candidate.id,
          factsSource: draft.factsSource as SpatialFacts['factsSource'],
          boardRevision: Number(draft.boardRevision),
          relation: draft.relation as Relation,
          distanceFt: Number(draft.distanceFt),
          lineOfSight: draft.lineOfSight === 'yes',
          cover: draft.cover as NonNullable<SpatialFacts['cover']>,
        };
      });
      const dartAllocation = policy.dartCount === undefined
        ? undefined
        : Object.fromEntries(selected.map((candidate) => [
          candidate.id,
          Number(state.drafts[candidate.id].darts),
        ]));
      // Reuse the pure builder's validation in the caller; catch obvious UI
      // mistakes here so focus remains in this modal.
      if (policy.dartCount !== undefined
        && Object.values(dartAllocation ?? {}).reduce((sum, value) => sum + value, 0)
          !== policy.dartCount) {
        throw new Error(`Распределите ровно ${policy.dartCount} дротика(ов)`);
      }
      for (const target of targets) {
        const draft = state.drafts[target.targetId];
        if (!draft.factsSource || !draft.relation || !draft.cover
          || draft.lineOfSight === 'unknown' || draft.distanceFt.trim() === ''
          || draft.boardRevision.trim() === '') {
          throw new Error('Для каждой цели явно укажите все наблюдаемые факты');
        }
        if (!Number.isSafeInteger(target.boardRevision) || target.boardRevision < 0) {
          throw new Error('Ревизия сцены должна быть неотрицательным целым числом');
        }
        if (!Number.isFinite(target.distanceFt) || target.distanceFt < 0
          || target.distanceFt > policy.rangeFt) {
          throw new Error(`Дистанция должна быть от 0 до ${policy.rangeFt} фт.`);
        }
        if (policy.requiresLineOfSight && !target.lineOfSight) {
          throw new Error('Для этого действия нужна линия обзора');
        }
      }
      finish({ targets, ...(dartAllocation ? { dartAllocation } : {}) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dialogContent = state ? (() => {
    const policy = sheetCombatDeclarationPolicy(state.action, state.castLevel);
    return (
      <div className="dice-dialog-backdrop" onClick={() => finish(null)}>
        <div className="dice-dialog-wrap" onClick={(event) => event.stopPropagation()}>
          <div className="dice-dialog sheet-target-dialog" role="dialog" aria-modal="true" aria-label="Цели и факты боя">
            <div className="dice-dialog-title">{state.title}</div>
            <p className="dice-dialog-summary">
              {policy.targetingShape === 'area'
                ? `Область из механики; дальность до ${policy.rangeFt} фт.`
                : `Дистанция: до ${policy.rangeFt} фт.`}
              {policy.dartCount ? ` Дротиков: ${policy.dartCount}.` : ''}
            </p>
            <div className="sheet-target-list" data-testid="sheet-combat-target-list">
              {state.candidates.map((candidate) => {
                const draft = state.drafts[candidate.id];
                return (
                  <fieldset key={candidate.id} className="sheet-target-card">
                    <legend>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          disabled={candidate.disabled}
                          onChange={(event) => patch(candidate.id, {
                            selected: event.target.checked,
                          })}
                        />{' '}{candidate.name}
                      </label>
                    </legend>
                    {candidate.disabled && <p className="sheet-target-disabled-reason">{candidate.reason}</p>}
                    {draft.selected && !candidate.disabled && (
                      <>
                        <label className="sheet-target-row">
                          <span>Отношение</span>
                          <select value={draft.relation} onChange={(event) => patch(candidate.id, { relation: event.target.value as Relation })}>
                            <option value="">Укажите отношение</option>
                            {policy.allowedRelations.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                          </select>
                        </label>
                        <label className="sheet-target-row">
                          <span>Дистанция, футы</span>
                          <input type="number" min={0} max={policy.rangeFt} value={draft.distanceFt} onChange={(event) => patch(candidate.id, { distanceFt: event.target.value })} />
                        </label>
                        <label className="sheet-target-row">
                          <span>Ревизия сцены</span>
                          <input type="number" min={0} step={1} value={draft.boardRevision} onChange={(event) => patch(candidate.id, { boardRevision: event.target.value })} />
                        </label>
                        <label className="sheet-target-row">
                          <span>Источник фактов</span>
                          <select value={draft.factsSource} onChange={(event) => patch(candidate.id, { factsSource: event.target.value as SpatialFacts['factsSource'] })}>
                            <option value="">Укажите источник</option>
                            <option value="scenario">Сценарий</option>
                            <option value="board">Доска</option>
                            <option value="gm_ruling">Решение мастера</option>
                          </select>
                        </label>
                        <label className="sheet-target-row">
                          <span>Линия обзора</span>
                          <select value={draft.lineOfSight} onChange={(event) => patch(candidate.id, { lineOfSight: event.target.value as TargetDraft['lineOfSight'] })}>
                            <option value="unknown">Укажите явно</option>
                            <option value="yes">Есть</option>
                            <option value="no">Нет</option>
                          </select>
                        </label>
                        <label className="sheet-target-row">
                          <span>Укрытие</span>
                          <select value={draft.cover} onChange={(event) => patch(candidate.id, { cover: event.target.value as TargetDraft['cover'] })}>
                            <option value="">Укажите укрытие</option>
                            <option value="none">Нет</option>
                            <option value="half">Половина</option>
                            <option value="three_quarters">Три четверти</option>
                            <option value="total">Полное</option>
                          </select>
                        </label>
                        {policy.dartCount !== undefined && (
                          <label className="sheet-target-row">
                            <span>Дротиков</span>
                            <input type="number" min={1} max={policy.dartCount} step={1} value={draft.darts} onChange={(event) => patch(candidate.id, { darts: event.target.value })} />
                          </label>
                        )}
                      </>
                    )}
                  </fieldset>
                );
              })}
            </div>
            {error && <div role="alert" className="issues">{error}</div>}
            <div className="dice-dialog-actions">
              <button type="button" className="dice-dialog-btn primary" onClick={submit}>Подтвердить цели</button>
              <button type="button" className="dice-dialog-btn ghost" onClick={() => finish(null)}>Отмена</button>
            </div>
          </div>
        </div>
      </div>
    );
  })() : null;

  // The sheet has transformed/sticky layout layers. A document-level portal
  // gives this modal a real top-level stacking context so banners and the
  // mobile-version suggestion cannot intercept its controls.
  const dialog = dialogContent && typeof document !== 'undefined'
    ? createPortal(dialogContent, document.body)
    : dialogContent;
  return { request, dialog };
}
