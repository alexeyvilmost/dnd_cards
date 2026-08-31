import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorldObjectSize } from '../rules-core/worldObjects';
import type { DancingLightsWorldPolicy } from '../rules-core/worldSpellPolicies';
import {
  buildSheetWorldInput,
  initialSheetWorldInputDraft,
  sheetWorldInputNeedsObject,
  sheetWorldFactsPreview,
  type SheetWorldInputFormContext,
  type SheetWorldInputFormDraft,
  type SheetWorldInputFormIssue,
  type SheetWorldInputFormResult,
} from '../character/sheetWorldInputForm';
import '../contexts/DiceDialog.css';

const SIZES: WorldObjectSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

interface DialogState {
  title: string;
  context: SheetWorldInputFormContext;
  draft: SheetWorldInputFormDraft;
}

export type SheetWorldInputDraftPatch = Omit<Partial<SheetWorldInputFormDraft>, 'facts'> & {
  facts?: Partial<SheetWorldInputFormDraft['facts']>;
};

export interface SheetWorldInputDialogApi {
  request(
    context: SheetWorldInputFormContext,
    title: string,
    newObjectId: string,
    initialDraft?: SheetWorldInputDraftPatch,
  ): Promise<SheetWorldInputFormResult | null>;
  dialog: ReactNode;
}

function updateFacts(
  draft: SheetWorldInputFormDraft,
  patch: Partial<SheetWorldInputFormDraft['facts']>,
): SheetWorldInputFormDraft {
  return { ...draft, facts: { ...draft.facts, ...patch } };
}

function IssueList({ issues }: { issues: SheetWorldInputFormIssue[] }) {
  if (!issues.length) return null;
  return (
    <div role="alert" className="issues" aria-label="Ошибки явных фактов">
      <ul>{issues.map((issue) => <li key={`${issue.fieldId}:${issue.message}`}>{issue.message}</li>)}</ul>
    </div>
  );
}

function ObjectEditor(input: {
  dialog: DialogState;
  setDraft: (updater: (draft: SheetWorldInputFormDraft) => SheetWorldInputFormDraft) => void;
}) {
  const { context, draft } = input.dialog;
  const objects = Object.values(context.runtime.world.objects)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const patch = (value: Partial<SheetWorldInputFormDraft>) => input.setDraft((current) => ({
    ...current,
    ...value,
  }));
  return (
    <fieldset className="dice-dialog-list">
      <legend>Объект сценария</legend>
      {context.form === 'purify_food_drink' ? (
        <div id="sheet-world-area-objects" tabIndex={-1}>
          {objects.map((object) => (
            <label key={object.id} className="dice-dialog-row">
              <input
                type="checkbox"
                checked={draft.selectedObjectIds.includes(object.id)}
                onChange={(event) => patch({
                  selectedObjectIds: event.target.checked
                    ? [...new Set([...draft.selectedObjectIds, object.id])]
                    : draft.selectedObjectIds.filter((id) => id !== object.id),
                })}
              />
              <span>{object.name}</span>
            </label>
          ))}
        </div>
      ) : (
        <label className="dice-dialog-row" htmlFor="sheet-world-object">
          <span>Существующий объект</span>
          <select
            id="sheet-world-object"
            value={draft.objectId}
            disabled={draft.createObject}
            onChange={(event) => patch({ objectId: event.target.value })}
          >
            <option value="">— выберите объект —</option>
            {objects.map((object) => (
              <option key={object.id} value={object.id}>{object.name} · {object.size}</option>
            ))}
          </select>
        </label>
      )}
      <label className="dice-dialog-row">
        <input
          type="checkbox"
          checked={draft.createObject}
          onChange={(event) => patch({ createObject: event.target.checked })}
        />
        <span>Добавить новый объект сценария</span>
      </label>
      {draft.createObject && (
        <div className="dice-dialog-list">
          <label className="dice-dialog-row" htmlFor="sheet-world-new-object-name">
            <span>Название объекта</span>
            <input
              id="sheet-world-new-object-name"
              value={draft.newObjectName}
              onChange={(event) => patch({ newObjectName: event.target.value })}
            />
          </label>
          <label className="dice-dialog-row" htmlFor="sheet-world-new-object-kind">
            <span>Категория</span>
            <select
              id="sheet-world-new-object-kind"
              value={draft.newObjectKind}
              onChange={(event) => patch({
                newObjectKind: event.target.value as SheetWorldInputFormDraft['newObjectKind'],
              })}
            >
              <option value="item">Предмет</option>
              <option value="environment">Окружение</option>
            </select>
          </label>
          <label className="dice-dialog-row" htmlFor="sheet-world-new-object-size">
            <span>Размер</span>
            <select
              id="sheet-world-new-object-size"
              value={draft.newObjectSize}
              onChange={(event) => patch({ newObjectSize: event.target.value as WorldObjectSize })}
            >
              {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label className="dice-dialog-row" htmlFor="sheet-world-new-object-profile">
            <span>Явное состояние</span>
            <select
              id="sheet-world-new-object-profile"
              value={draft.newObjectProfile}
              onChange={(event) => patch({
                newObjectProfile: event.target.value as SheetWorldInputFormDraft['newObjectProfile'],
              })}
            >
              <option value="plain">Обычный объект</option>
              <option value="broken">Разрыв или поломка</option>
              <option value="plant">Нераспустившееся растение</option>
              <option value="flame">Свеча/факел/костёр</option>
              <option value="food">Еда</option>
              <option value="drink">Напиток</option>
            </select>
          </label>
          {draft.newObjectProfile === 'broken' && (
            <label className="dice-dialog-row" htmlFor="sheet-world-break-dimension">
              <span>Размер повреждения, футы</span>
              <input
                id="sheet-world-break-dimension"
                type="number"
                min={0}
                value={draft.breakDimensionFt}
                onChange={(event) => patch({ breakDimensionFt: event.target.value })}
              />
            </label>
          )}
          {(draft.newObjectProfile === 'food' || draft.newObjectProfile === 'drink') && (
            <label className="dice-dialog-row">
              <input
                type="checkbox"
                checked={draft.foodMagical}
                onChange={(event) => patch({ foodMagical: event.target.checked })}
              />
              <span>Магическая пища или напиток</span>
            </label>
          )}
        </div>
      )}
    </fieldset>
  );
}

function SpecificFields(input: {
  dialog: DialogState;
  setDraft: (updater: (draft: SheetWorldInputFormDraft) => SheetWorldInputFormDraft) => void;
}) {
  const { context, draft } = input.dialog;
  const patch = (value: Partial<SheetWorldInputFormDraft>) => input.setDraft((current) => ({
    ...current,
    ...value,
  }));
  return (
    <fieldset className="dice-dialog-list">
      <legend>Вариант действия</legend>
      {context.form === 'minor_illusion' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-form">
          <span>Форма</span>
          <select id="sheet-world-form" value={draft.form} onChange={(event) => patch({ form: event.target.value })}>
            <option value="sound">Звук</option>
            <option value="image">Изображение</option>
          </select>
        </label>
      )}
      {context.form === 'dancing_lights' && (
        <>
          <label className="dice-dialog-row" htmlFor="sheet-world-form">
            <span>Форма огней</span>
            <select id="sheet-world-form" value={draft.form} onChange={(event) => patch({ form: event.target.value })}>
              <option value="individual">Отдельные огни</option>
              <option value="medium_humanoid">Гуманоид Среднего размера</option>
            </select>
          </label>
          <label className="dice-dialog-row" htmlFor="sheet-world-placements">
            <span>Дистанции каждого огня, футы</span>
            <input
              id="sheet-world-placements"
              value={draft.placementDistancesFt}
              onChange={(event) => patch({ placementDistancesFt: event.target.value })}
            />
          </label>
          <label className="dice-dialog-row">
            <input
              type="checkbox"
              checked={draft.placementsWithinSeparation}
              onChange={(event) => patch({ placementsWithinSeparation: event.target.checked })}
            />
            <span>
              Подтверждаю: каждый огонь находится в пределах {
                (context.parsed.policy as DancingLightsWorldPolicy).requiredSeparationFt
              } футов хотя бы от одного другого огня
            </span>
          </label>
        </>
      )}
      {context.form === 'druidcraft' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-option">
          <span>Эффект</span>
          <select id="sheet-world-option" value={draft.option} onChange={(event) => patch({ option: event.target.value })}>
            <option value="weather_sensor">Прогноз погоды</option>
            <option value="bloom">Распустить растение</option>
            <option value="sensory_effect">Безвредный сенсорный эффект</option>
            <option value="fire_play">Зажечь или погасить огонь</option>
          </select>
        </label>
      )}
      {context.form === 'prestidigitation' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-option">
          <span>Эффект</span>
          <select id="sheet-world-option" value={draft.option} onChange={(event) => patch({ option: event.target.value })}>
            <option value="sensory_effect">Сенсорный эффект</option>
            <option value="fire_play">Огонь</option>
            <option value="clean_or_soil">Очистить или испачкать</option>
            <option value="minor_sensation">Малое ощущение</option>
            <option value="magic_mark">Метка</option>
            <option value="minor_creation">Малая безделушка</option>
          </select>
        </label>
      )}
      {(draft.option === 'fire_play' || draft.option === 'clean_or_soil') && (
        <label className="dice-dialog-row" htmlFor="sheet-world-operation">
          <span>Операция</span>
          <select id="sheet-world-operation" value={draft.operation} onChange={(event) => patch({ operation: event.target.value })}>
            {draft.option === 'fire_play' ? (
              <><option value="light">Зажечь</option><option value="snuff">Погасить</option></>
            ) : (
              <><option value="clean">Очистить</option><option value="soil">Испачкать</option></>
            )}
          </select>
        </label>
      )}
      {(context.form === 'minor_illusion'
        || ['weather_sensor', 'sensory_effect', 'minor_sensation', 'magic_mark', 'minor_creation']
          .includes(draft.option)) && (
        <label className="dice-dialog-row" htmlFor="sheet-world-description">
          <span>Явное описание</span>
          <textarea
            id="sheet-world-description"
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </label>
      )}
      {context.form === 'minor_illusion' && draft.form === 'image' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-image-size">
          <span>Сторона куба изображения, футы</span>
          <input id="sheet-world-image-size" type="number" min={0} value={draft.imageCubeSideFt} onChange={(event) => patch({ imageCubeSideFt: event.target.value })} />
        </label>
      )}
      {context.form === 'druidcraft' && draft.option === 'sensory_effect' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-sensory-size">
          <span>Сторона куба эффекта, футы</span>
          <input id="sheet-world-sensory-size" type="number" min={0} value={draft.sensoryCubeSideFt} onChange={(event) => patch({ sensoryCubeSideFt: event.target.value })} />
        </label>
      )}
      {context.form === 'purify_food_drink' && (
        <label className="dice-dialog-row" htmlFor="sheet-world-sphere-center">
          <span>Дистанция до центра сферы, футы</span>
          <input id="sheet-world-sphere-center" type="number" min={0} value={draft.sphereCenterDistanceFt} onChange={(event) => patch({ sphereCenterDistanceFt: event.target.value })} />
        </label>
      )}
      {context.form === 'prestidigitation' && draft.option === 'minor_creation' && (
        <>
          <label className="dice-dialog-row" htmlFor="sheet-world-creation-size">
            <span>Размер безделушки</span>
            <select id="sheet-world-creation-size" value={draft.creationSize} onChange={(event) => patch({ creationSize: event.target.value as WorldObjectSize })}>
              {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label className="dice-dialog-row">
            <input type="checkbox" checked={draft.creationFitsInHand} onChange={(event) => patch({ creationFitsInHand: event.target.checked })} />
            <span>Безделушка помещается в руке</span>
          </label>
        </>
      )}
    </fieldset>
  );
}

export function useSheetWorldInputDialog(): SheetWorldInputDialogApi {
  const [state, setState] = useState<DialogState | null>(null);
  const [issues, setIssues] = useState<SheetWorldInputFormIssue[]>([]);
  const resolver = useRef<((result: SheetWorldInputFormResult | null) => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const finish = useCallback((result: SheetWorldInputFormResult | null) => {
    setState(null);
    setIssues([]);
    resolver.current?.(result);
    resolver.current = null;
    const focusTarget = returnFocus.current;
    returnFocus.current = null;
    if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
  }, []);

  const request = useCallback((
    context: SheetWorldInputFormContext,
    title: string,
    newObjectId: string,
    initialDraft: SheetWorldInputDraftPatch = {},
  ): Promise<SheetWorldInputFormResult | null> => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    returnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setIssues([]);
    const defaults = initialSheetWorldInputDraft(context, newObjectId);
    setState({
      title,
      context,
      draft: {
        ...defaults,
        ...initialDraft,
        facts: { ...defaults.facts, ...initialDraft.facts },
      },
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

  const setDraft = (updater: (draft: SheetWorldInputFormDraft) => SheetWorldInputFormDraft) => {
    setState((current) => current ? { ...current, draft: updater(current.draft) } : current);
  };

  const submit = () => {
    if (!state) return;
    const built = buildSheetWorldInput(state.context, state.draft);
    if (built.result) {
      finish(built.result);
      return;
    }
    setIssues(built.issues);
    const first = built.issues[0];
    if (first) {
      setTimeout(() => document.getElementById(first.fieldId)?.focus(), 0);
    }
  };

  const dialog = state ? (
    <div className="dice-dialog-backdrop" onClick={() => finish(null)}>
      <div className="dice-dialog-wrap" onClick={(event) => event.stopPropagation()}>
        <div
          className="dice-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Явные факты сценария"
        >
          <div className="dice-dialog-title">{state.title}</div>
          <p className="dice-dialog-summary">
            Подтвердите наблюдаемые факты. Движок запишет их вместе с объявлением действия.
          </p>
          <SpecificFields dialog={state} setDraft={setDraft} />
          {sheetWorldInputNeedsObject(state.context.form, state.draft) && (
            <ObjectEditor dialog={state} setDraft={setDraft} />
          )}
          <fieldset className="dice-dialog-list">
            <legend>Явные факты сценария</legend>
            {state.context.form === 'purify_food_drink' && (
              <p className="dice-dialog-summary">
                Подтверждённые ниже факты будут записаны отдельно для каждого выбранного объекта.
              </p>
            )}
            <label className="dice-dialog-row" htmlFor="sheet-world-facts-source">
              <span>Источник фактов</span>
              <select
                id="sheet-world-facts-source"
                value={state.draft.facts.factsSource}
                onChange={(event) => setDraft((draft) => updateFacts(draft, {
                  factsSource: event.target.value as SheetWorldInputFormDraft['facts']['factsSource'],
                }))}
              >
                <option value="scenario">Сценарий</option>
                <option value="board">Доска</option>
                <option value="gm_ruling">Решение мастера</option>
              </select>
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-board-revision">
              <span>Ревизия доски</span>
              <input id="sheet-world-board-revision" type="number" min={0} value={state.draft.facts.boardRevision} onChange={(event) => setDraft((draft) => updateFacts(draft, { boardRevision: event.target.value }))} />
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-distance">
              <span>Дистанция, футы</span>
              <input id="sheet-world-distance" type="number" min={0} max={state.context.parsed.targeting.rangeFt} value={state.draft.facts.distanceFt} onChange={(event) => setDraft((draft) => updateFacts(draft, { distanceFt: event.target.value }))} />
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-line-of-sight">
              <input id="sheet-world-line-of-sight" type="checkbox" checked={state.draft.facts.lineOfSight} onChange={(event) => setDraft((draft) => updateFacts(draft, { lineOfSight: event.target.checked }))} />
              <span>Есть линия обзора</span>
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-touched">
              <input id="sheet-world-touched" type="checkbox" checked={state.draft.facts.touched} onChange={(event) => setDraft((draft) => updateFacts(draft, { touched: event.target.checked }))} />
              <span>Объект касается заклинателя</span>
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-in-area">
              <input id="sheet-world-in-area" type="checkbox" checked={state.draft.facts.inArea} onChange={(event) => setDraft((draft) => updateFacts(draft, { inArea: event.target.checked }))} />
              <span>Объект находится в области</span>
            </label>
            <label className="dice-dialog-row" htmlFor="sheet-world-entirely-in-area">
              <input id="sheet-world-entirely-in-area" type="checkbox" checked={state.draft.facts.entirelyInArea} onChange={(event) => setDraft((draft) => updateFacts(draft, { entirelyInArea: event.target.checked }))} />
              <span>Объект целиком находится в области</span>
            </label>
            {state.context.form === 'prestidigitation' && (
              <label className="dice-dialog-row" htmlFor="sheet-world-volume">
                <span>Объём объекта, куб. футы</span>
                <input id="sheet-world-volume" type="number" min={0} value={state.draft.facts.volumeCubicFt} onChange={(event) => setDraft((draft) => updateFacts(draft, { volumeCubicFt: event.target.value }))} />
              </label>
            )}
          </fieldset>
          <section aria-label="Факты, которые будут записаны">
            <h4>Будут записаны</h4>
            <pre>{JSON.stringify(
              state.context.form === 'purify_food_drink'
                ? {
                  factsByObject: Object.fromEntries([
                    ...state.draft.selectedObjectIds,
                    ...(state.draft.createObject ? [state.draft.newObjectId] : []),
                  ].filter(Boolean).sort().map((id) => [id, sheetWorldFactsPreview(state.draft)])),
                }
                : sheetWorldFactsPreview(state.draft),
              null,
              2,
            )}</pre>
          </section>
          <IssueList issues={issues} />
          <div className="dice-dialog-actions">
            <button type="button" className="dice-dialog-btn primary" onClick={submit}>
              Подтвердить факты и применить
            </button>
            <button type="button" className="dice-dialog-btn ghost" onClick={() => finish(null)}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { request, dialog };
}
