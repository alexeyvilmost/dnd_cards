import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {FormattedText} from '../../utils/formattedText';
import {dismissEntityPreviews} from '../../utils/previewLifecycle';

type SelectionEntity = {id: string; name: string; description?: string | null};

/** One reversible picker for species, subspecies and classes. Only presentation
 * changes: choosing and replacing still use the forge's existing draft handlers. */
export default function ForgeEntitySelection<T extends SelectionEntity>({entities, selectedId, onSelect, onBeginChange, onExpandedChange, entityKind, renderCard, children, emptyText}: {
  entities: readonly T[]; selectedId?: string | null; onSelect: (id: string) => void;
  onBeginChange?: () => void; entityKind?: 'races' | 'classes' | 'backgrounds';
  onExpandedChange?: (expanded:boolean) => void;
  renderCard: (entity: T, select: () => void) => ReactNode;
  children?: (entity: T) => ReactNode; emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(!selectedId);
  const card = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const previousRect = useRef<DOMRect | null>(null);
  const previousGridIndex = useRef(-1);
  const previousSelectedId = useRef(selectedId);
  const selected = entities.find(entity => entity.id === selectedId);
  useEffect(() => {
    if (!selectedId) setExpanded(true);
    else if(previousSelectedId.current!==selectedId) setExpanded(false);
    previousSelectedId.current=selectedId;
  }, [selectedId]);
  useEffect(() => {onExpandedChange?.(expanded || !selected);}, [expanded, selected, onExpandedChange]);
  useLayoutEffect(() => {
    const from = previousRect.current; previousRect.current = null;
    const element = expanded ? grid.current?.children[previousGridIndex.current]?.querySelector<HTMLElement>('.forge-square-card') : card.current;
    if (!from || !element) return;
    // Returning to the grid must not reopen the cancelled card's focus preview.
    (expanded ? grid.current : element.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
    if (!element.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const to = element.getBoundingClientRect();
    const animation = element.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`}, {transform:'translate(0,0)'}],
      {duration:320, easing:'cubic-bezier(.22,.65,.3,1)'});
    return () => animation.cancel();
  }, [selectedId, expanded]);
  const select = (entity: T) => {
    dismissEntityPreviews();
    const index = entities.indexOf(entity);
    previousRect.current = grid.current?.children[index]?.querySelector('.forge-square-card')?.getBoundingClientRect() ?? null;
    setExpanded(false); onExpandedChange?.(false); if(entity.id!==selectedId) onSelect(entity.id);
  };
  const change = () => {
    dismissEntityPreviews();
    previousGridIndex.current=entities.findIndex(entity=>entity.id===selectedId);
    previousRect.current = card.current?.querySelector('.forge-square-card')?.getBoundingClientRect() ?? null;
    setExpanded(true); onExpandedChange?.(true); onBeginChange?.();
  };
  if (expanded || !selected) return <div ref={grid} tabIndex={-1} className="forge-square-grid forge-selection-grid">
    {entities.map(entity => <div key={entity.id}>{renderCard(entity, () => select(entity))}</div>)}
    {!entities.length && <p className="forge-note">{emptyText ?? 'Нет вариантов в каталоге.'}</p>}
  </div>;
  return <div className="forge-selected-entity" key={selected.id}>
    <div className="forge-selected-entity__card" ref={card}>
      {renderCard(selected, change)}
      <button className="forge-btn forge-selected-entity__change" type="button" onClick={change} aria-label={`Изменить: ${selected.name}`}>Изменить</button>
      {entityKind && <a className="forge-selected-entity__details" href={`/entity/${entityKind}/${encodeURIComponent(selected.id)}`} target="_blank" rel="noopener noreferrer" aria-label={`Подробнее: ${selected.name} (в новой вкладке)`}>Подробнее ↗</a>}
    </div>
    <div className="forge-selected-entity__story"><h3>{selected.name}</h3>
      {selected.description && <FormattedText text={selected.description} emptyText=""/>}
      {children?.(selected)}
    </div>
  </div>;
}
