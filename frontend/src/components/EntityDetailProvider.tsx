/**
 * Глобальный хост детальных окон сущностей: клик по ссылке [[label|type:id]] открывает
 * соответствующий *DetailModal (без per-host обвязки). Резолвит сущность по id (кэш),
 * затем рендерит нужную модалку. Удаление — реальный вызов API + закрытие.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Card, Spell, Action, PassiveEffect, Concept, ResourceDefinition, Variable } from '../types';
import { cardsApi, spellsApi, actionsApi, effectsApi, conceptsApi, resourcesApi, variablesApi } from '../api/client';
import type { EntityRefType } from './EntityRefRegistry';
import { useEntityRef, evictEntity } from './EntityRefRegistry';
import { EntityDetailContext } from '../contexts/entityDetail';
const SpellDetailModal = lazy(() => import('./SpellDetailModal'));
const ActionDetailModal = lazy(() => import('./ActionDetailModal'));
const EffectDetailModal = lazy(() => import('./EffectDetailModal'));
const CardDetailModal = lazy(() => import('./CardDetailModal'));
const ConceptDetailModal = lazy(() => import('./ConceptDetailModal'));
const ResourceDetailModal = lazy(() => import('./ResourceDetailModal'));
const VariableDetailModal = lazy(() => import('./VariableDetailModal'));

const DELETERS: Record<EntityRefType, (id: string) => Promise<void>> = {
  card: (id) => cardsApi.deleteCard(id),
  spell: (id) => spellsApi.deleteSpell(id),
  action: (id) => actionsApi.deleteAction(id),
  effect: (id) => effectsApi.deleteEffect(id),
  concept: (id) => conceptsApi.deleteConcept(id),
  resource: (id) => resourcesApi.deleteResource(id),
  variable: (id) => variablesApi.deleteVariable(id),
};

const stateBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 10020, display: 'grid', placeItems: 'center',
  padding: 24, background: 'rgba(12, 10, 8, 0.72)',
};

const statePanel: React.CSSProperties = {
  width: 'min(420px, 100%)', padding: 20, border: '1px solid #b79b67', borderRadius: 12,
  color: '#f1e8d8', background: '#211c17', boxShadow: '0 18px 60px rgba(0,0,0,.45)',
};

function DetailState({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Состояние карточки сущности"
      style={stateBackdrop}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div style={statePanel}>
        {children}
        <button ref={closeButton} type="button" onClick={onClose} style={{ marginTop: 16 }}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

/** Загружает сущность по ссылке и рендерит подходящую детальную модалку. */
const DetailHost = ({ type, id, onClose }: { type: EntityRefType; id: string; onClose: () => void }) => {
  const { entity, loading, error } = useEntityRef(type, id);

  const handleDelete = useCallback(async (entId: string) => {
    try { await DELETERS[type](entId); evictEntity(type, id); evictEntity(type, entId); } finally { onClose(); }
  }, [type, id, onClose]);

  if (loading) {
    return <DetailState onClose={onClose}><div role="status">Загрузка карточки…</div></DetailState>;
  }
  if (error || !entity) {
    return (
      <DetailState onClose={onClose}>
        <strong>Не удалось загрузить карточку.</strong>
        <p style={{ margin: '8px 0 0', color: '#cfc2ad' }}>Проверьте соединение и повторите открытие ссылки.</p>
      </DetailState>
    );
  }

  // Смена изображения из детального окна → сбросить кэш, чтобы на след. открытии подтянуть новое.
  const onImageUpdated = () => evictEntity(type, id);

  let modal: ReactNode = null;
  switch (type) {
    case 'card': modal = <CardDetailModal card={entity as Card} isOpen onClose={onClose} onDelete={handleDelete} />; break;
    case 'spell': modal = <SpellDetailModal spell={entity as Spell} isOpen onClose={onClose} onDelete={handleDelete} onUpdated={onImageUpdated} />; break;
    case 'action': modal = <ActionDetailModal action={entity as Action} isOpen onClose={onClose} onDelete={handleDelete} onUpdated={onImageUpdated} />; break;
    case 'effect': modal = <EffectDetailModal effect={entity as PassiveEffect} isOpen onClose={onClose} onDelete={handleDelete} onUpdated={onImageUpdated} />; break;
    case 'concept': modal = <ConceptDetailModal concept={entity as Concept} isOpen onClose={onClose} onDelete={handleDelete} />; break;
    case 'resource': modal = <ResourceDetailModal resource={entity as ResourceDefinition} isOpen onClose={onClose} onDelete={handleDelete} />; break;
    case 'variable': modal = <VariableDetailModal variable={entity as Variable} isOpen onClose={onClose} onDelete={handleDelete} />; break;
  }
  return (
    <Suspense fallback={<DetailState onClose={onClose}><div role="status">Открываем карточку…</div></DetailState>}>
      {modal}
    </Suspense>
  );
};

export function EntityDetailProvider({ children }: { children: ReactNode }) {
  const [ref, setRef] = useState<{ type: EntityRefType; id: string } | null>(null);
  const openEntity = useCallback((type: EntityRefType, id: string) => setRef({ type, id }), []);
  const close = useCallback(() => setRef(null), []);

  return (
    <EntityDetailContext.Provider value={{ openEntity }}>
      {children}
      {ref && <DetailHost key={`${ref.type}:${ref.id}`} type={ref.type} id={ref.id} onClose={close} />}
    </EntityDetailContext.Provider>
  );
}
