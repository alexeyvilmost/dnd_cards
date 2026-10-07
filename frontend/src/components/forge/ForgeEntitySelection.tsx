import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {FormattedText} from '../../utils/formattedText';

type SelectionEntity = {id: string; name: string; description?: string | null};

/** One reversible picker for species, subspecies and classes. Only presentation
 * changes: choosing and replacing still use the forge's existing draft handlers. */
export default function ForgeEntitySelection<T extends SelectionEntity>({entities, selectedId, onSelect, renderCard, children, emptyText}: {
  entities: readonly T[]; selectedId?: string | null; onSelect: (id: string) => void;
  renderCard: (entity: T, select: () => void) => ReactNode;
  children?: (entity: T) => ReactNode; emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(!selectedId);
  const card = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const previousRect = useRef<DOMRect | null>(null);
  const selected = entities.find(entity => entity.id === selectedId);
  useEffect(() => {if (!selectedId) setExpanded(true);}, [selectedId]);
  useLayoutEffect(() => {
    const from = previousRect.current; previousRect.current = null;
    const element = card.current;
    if (!from || !element) return;
    element.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    if (!element.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const to = element.getBoundingClientRect();
    const animation = element.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`}, {transform:'translate(0,0)'}],
      {duration:320, easing:'cubic-bezier(.22,.65,.3,1)'});
    return () => animation.cancel();
  }, [selectedId, expanded]);
  const select = (entity: T) => {
    const index = entities.indexOf(entity);
    previousRect.current = grid.current?.children[index]?.querySelector('.forge-square-card')?.getBoundingClientRect() ?? null;
    setExpanded(false); if(entity.id!==selectedId) onSelect(entity.id);
  };
  if (expanded || !selected) return <div ref={grid} className="forge-square-grid forge-selection-grid">
    {entities.map(entity => <div key={entity.id}>{renderCard(entity, () => select(entity))}</div>)}
    {!entities.length && <p className="forge-note">{emptyText ?? 'Нет вариантов в каталоге.'}</p>}
  </div>;
  return <div className="forge-selected-entity" key={selected.id}>
    <div className="forge-selected-entity__card" ref={card}>
      {renderCard(selected, () => setExpanded(true))}
      <button className="forge-btn forge-selected-entity__change" type="button" onClick={() => setExpanded(true)} aria-label={`Изменить: ${selected.name}`}>Изменить</button>
    </div>
    <div className="forge-selected-entity__story"><h3>{selected.name}</h3>
      {selected.description && <FormattedText text={selected.description} emptyText=""/>}
      {children?.(selected)}
    </div>
  </div>;
}
