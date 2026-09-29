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
  description?: string;
  disabled?: boolean;
  reason?: string;
  defaultSelected?: boolean;
  defaultFacts?: Partial<SpatialFacts>;
  /** Scene targets already own provenance/geometry facts; the user supplies distance only. */
  factEntryMode?: 'full' | 'distance_only';
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
  distanceToFirstTargetFt: string;
  lineOfSight: 'unknown' | 'yes' | 'no';
  cover: NonNullable<SpatialFacts['cover']> | '';
  willing: 'unknown' | 'yes' | 'no';
  darts: string;
}

interface DialogState {
  title: string;
  action: RuleActionDefinition;
  castLevel?: number;
  actorLevel?: number;
  candidates: SheetCombatTargetCandidate[];
  drafts: Record<string, TargetDraft>;
  /** Ordered attack/effect slots; a data declaration may allow repeats. */
  slots: string[];
  requireTarget: boolean;
}

export interface SheetCombatTargetDialogApi {
  request(input: {
    title: string;
    action: RuleActionDefinition;
    castLevel?: number;
    actorLevel?: number;
    candidates: SheetCombatTargetCandidate[];
    /** Product workflow constraint: this command must declare at least one actor target. */
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
    factsSource: candidate.defaultFacts?.factsSource ?? '',
    boardRevision: candidate.defaultFacts?.boardRevision === undefined
      ? ''
      : String(candidate.defaultFacts.boardRevision),
    relation: candidate.defaultFacts?.relation ?? '',
    distanceFt: candidate.defaultFacts?.distanceFt === undefined
      ? ''
      : String(candidate.defaultFacts.distanceFt),
    distanceToFirstTargetFt: candidate.defaultFacts?.distanceToFirstTargetFt === undefined
      ? ''
      : String(candidate.defaultFacts.distanceToFirstTargetFt),
    lineOfSight: candidate.defaultFacts?.lineOfSight === undefined
      ? 'unknown'
      : candidate.defaultFacts.lineOfSight ? 'yes' : 'no',
    cover: candidate.defaultFacts?.cover ?? '',
    willing: candidate.defaultFacts?.willing === undefined
      ? 'unknown'
      : candidate.defaultFacts.willing ? 'yes' : 'no',
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
    actorLevel?: number;
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
        candidate.defaultSelected ?? false,
      )];
    }));
    setError(null);
    setState({
      title: input.title,
      action: input.action,
      castLevel: input.castLevel,
      actorLevel: input.actorLevel,
      candidates: input.candidates,
      drafts,
      slots: input.candidates.filter(candidate=>candidate.defaultSelected&&!candidate.disabled).map(candidate=>candidate.id),
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

  const toggleCandidate = (id: string, selected: boolean) => setState((current) => {
    if (!current) return current;
    const policy = sheetCombatDeclarationPolicy(current.action, current.castLevel, current.actorLevel);
    const drafts = { ...current.drafts };
    if (selected) {
      for (const candidate of current.candidates) {
        if (candidate.id === id) continue;
        // A scene target is selected initially to make the common one-target
        // flow immediate. Choosing a real sheet replaces that implicit
        // default. For multi-target actions the user can explicitly add the
        // scene target again afterwards.
        if (policy.maxTargets === 1 || candidate.defaultSelected) {
          drafts[candidate.id] = { ...drafts[candidate.id], selected: false };
        }
      }
    }
    drafts[id] = { ...drafts[id], selected };
    const slots = selected
      ? [...(policy.maxTargets === 1 ? [] : current.slots.filter((slot) => slot !== id && drafts[slot]?.selected)), id]
      : current.slots.filter((slot) => slot !== id);
    return { ...current, drafts, slots };
  });

  const addSlot=(id:string)=>setState(current=>{
    if(!current)return current;
    const policy=sheetCombatDeclarationPolicy(current.action,current.castLevel,current.actorLevel);
    if(current.slots.length>=policy.maxTargets||current.candidates.find(candidate=>candidate.id===id)?.disabled)return current;
    return {...current,slots:[...current.slots,id],drafts:{...current.drafts,[id]:{...current.drafts[id],selected:true}}};
  });
  const removeSlot=(index:number)=>setState(current=>{
    if(!current)return current;
    const slots=current.slots.filter((_,slotIndex)=>slotIndex!==index);
    const id=current.slots[index];
    return {...current,slots,drafts:{...current.drafts,[id]:{...current.drafts[id],selected:slots.includes(id)}}};
  });

  const submit = () => {
    if (!state) return;
    try {
      const policy = sheetCombatDeclarationPolicy(state.action, state.castLevel, state.actorLevel);
      const selected = state.candidates.filter((candidate) => state.drafts[candidate.id].selected);
      const targetSlots=state.slots;
      const minimum = state.requireTarget ? Math.max(1, policy.minTargets) : policy.minTargets;
      if (targetSlots.length < minimum || targetSlots.length > policy.maxTargets) {
        throw new Error(`Выберите от ${minimum} до ${policy.maxTargets} целей`);
      }
      const targets: SheetCombatTargetFactDraft[] = targetSlots.map((id, index) => {
        const candidate=state.candidates.find(row=>row.id===id);
        if(!candidate||candidate.disabled)throw new Error('Цель больше недоступна');
        const draft = state.drafts[candidate.id];
        return {
          targetId: candidate.id,
          factsSource: draft.factsSource as SpatialFacts['factsSource'],
          boardRevision: Number(draft.boardRevision),
          relation: draft.relation as Relation,
          distanceFt: Number(draft.distanceFt),
          ...(index > 0 && policy.additionalTargetsWithinFtOfFirst !== undefined
            ? { distanceToFirstTargetFt: Number(draft.distanceToFirstTargetFt) } : {}),
          lineOfSight: draft.lineOfSight === 'yes',
          cover: draft.cover as NonNullable<SpatialFacts['cover']>,
          ...(policy.requiresWilling ? { willing: draft.willing === 'yes' } : {}),
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
      for (const [targetIndex, target] of targets.entries()) {
        const draft = state.drafts[target.targetId];
        if (!draft.factsSource || !draft.relation || !draft.cover
          || draft.lineOfSight === 'unknown' || draft.distanceFt.trim() === ''
          || (policy.requiresWilling && draft.willing === 'unknown')
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
        if (targetIndex > 0 && policy.additionalTargetsWithinFtOfFirst !== undefined
          && (draft.distanceToFirstTargetFt.trim() === ''
            || !Number.isFinite(target.distanceToFirstTargetFt)
            || target.distanceToFirstTargetFt! < 0
            || target.distanceToFirstTargetFt! > policy.additionalTargetsWithinFtOfFirst)) {
          throw new Error(`Дополнительная цель должна быть в пределах ${policy.additionalTargetsWithinFtOfFirst} фт. от первой`);
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
    const policy = sheetCombatDeclarationPolicy(state.action, state.castLevel, state.actorLevel);
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
            <p className="dice-dialog-summary" aria-live="polite" data-testid="sheet-target-counter">
              Выбрано {state.slots.length} из {policy.maxTargets}; осталось {Math.max(0,policy.maxTargets-state.slots.length)}.
            </p>
            {policy.allowRepeatTargets&&state.slots.length>0&&<ol className="sheet-target-slots" aria-label="Порядок целей">
              {state.slots.map((id,index)=><li key={`${index}:${id}`}>
                <span>{index+1}. {state.candidates.find(candidate=>candidate.id===id)?.name??id}</span>{' '}
                <button type="button" onClick={()=>removeSlot(index)} aria-label={`Убрать цель ${index+1}`}>Убрать</button>
              </li>)}
            </ol>}
            <div className="sheet-target-list" data-testid="sheet-combat-target-list">
              {state.candidates.map((candidate) => {
                const draft = state.drafts[candidate.id];
                return (
                  <fieldset
                    key={candidate.id}
                    className={`sheet-target-card${candidate.factEntryMode === 'distance_only' ? ' sheet-target-card--scene' : ''}`}
                    data-target-id={candidate.id}
                  >
                    <legend>
                      {policy.allowRepeatTargets?<>
                        <span>{candidate.name}</span>{' '}
                        <button type="button" disabled={candidate.disabled||state.slots.length>=policy.maxTargets} onClick={()=>addSlot(candidate.id)} aria-label={`Добавить цель ${candidate.name}`}>
                          Добавить цель{state.slots.filter(id=>id===candidate.id).length?` (${state.slots.filter(id=>id===candidate.id).length})`:''}
                        </button>
                      </>:<label>
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          disabled={candidate.disabled}
                          onChange={(event) => toggleCandidate(candidate.id, event.target.checked)}
                        />{' '}{candidate.name}
                      </label>}
                    </legend>
                    {candidate.description && <p className="sheet-target-description">{candidate.description}</p>}
                    {candidate.disabled && <p className="sheet-target-disabled-reason">{candidate.reason}</p>}
                    {draft.selected && !candidate.disabled && (
                      <>
                        {candidate.factEntryMode !== 'distance_only' && (
                          <label className="sheet-target-row">
                            <span>Отношение</span>
                            <select value={draft.relation} onChange={(event) => patch(candidate.id, { relation: event.target.value as Relation })}>
                              <option value="">Укажите отношение</option>
                              {policy.allowedRelations.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                            </select>
                          </label>
                        )}
                        <label className="sheet-target-row">
                          <span>Дистанция, футы</span>
                          <input type="number" min={0} max={policy.rangeFt} value={draft.distanceFt} onChange={(event) => patch(candidate.id, { distanceFt: event.target.value })} />
                        </label>
                        {policy.additionalTargetsWithinFtOfFirst !== undefined && state.slots.indexOf(candidate.id) > 0 && (
                          <label className="sheet-target-row">
                            <span>Дистанция до первой цели, футы</span>
                            <input type="number" min={0} max={policy.additionalTargetsWithinFtOfFirst} value={draft.distanceToFirstTargetFt}
                              onChange={(event) => patch(candidate.id, { distanceToFirstTargetFt: event.target.value })} />
                          </label>
                        )}
                        {candidate.factEntryMode !== 'distance_only' && (
                          <>
                            <label className="sheet-target-row">
                              <span>Ревизия сцены</span>
                              <input type="number" min={0} step={1} value={draft.boardRevision} onChange={(event) => patch(candidate.id, { boardRevision: event.target.value })} />
                            </label>
                            {policy.requiresWilling && (
                              <label className="sheet-target-row">
                                <span>Согласие цели</span>
                                <select value={draft.willing} onChange={(event) => patch(candidate.id, { willing: event.target.value as TargetDraft['willing'] })}>
                                  <option value="unknown">Укажите явно</option>
                                  <option value="yes">Согласна</option>
                                  <option value="no">Не согласна</option>
                                </select>
                              </label>
                            )}
                            <label className="sheet-target-row">
                              <span>Источник фактов</span>
                              <select value={draft.factsSource} onChange={(event) => patch(candidate.id, { factsSource: event.target.value as SpatialFacts['factsSource'] })}>
                                <option value="">Укажите источник</option>
                                <option value="scenario">Сцена</option>
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
                          </>
                        )}
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
