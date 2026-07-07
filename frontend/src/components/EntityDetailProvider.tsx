/**
 * Глобальный хост детальных окон сущностей: клик по ссылке [[label|type:id]] открывает
 * соответствующий *DetailModal (без per-host обвязки). Резолвит сущность по id (кэш),
 * затем рендерит нужную модалку. Удаление — реальный вызов API + закрытие.
 */
import { useCallback, useState, type ReactNode } from 'react';
import type { Card, Spell, Action, PassiveEffect, Concept } from '../types';
import { cardsApi, spellsApi, actionsApi, effectsApi, conceptsApi } from '../api/client';
import type { EntityRefType } from './EntityRefRegistry';
import { useEntityRef, evictEntity } from './EntityRefRegistry';
import { EntityDetailContext } from '../contexts/entityDetail';
import SpellDetailModal from './SpellDetailModal';
import ActionDetailModal from './ActionDetailModal';
import EffectDetailModal from './EffectDetailModal';
import CardDetailModal from './CardDetailModal';
import ConceptDetailModal from './ConceptDetailModal';

const DELETERS: Record<EntityRefType, (id: string) => Promise<void>> = {
  card: (id) => cardsApi.deleteCard(id),
  spell: (id) => spellsApi.deleteSpell(id),
  action: (id) => actionsApi.deleteAction(id),
  effect: (id) => effectsApi.deleteEffect(id),
  concept: (id) => conceptsApi.deleteConcept(id),
};

/** Загружает сущность по ссылке и рендерит подходящую детальную модалку. */
const DetailHost = ({ type, id, onClose }: { type: EntityRefType; id: string; onClose: () => void }) => {
  const { entity, loading, error } = useEntityRef(type, id);

  const handleDelete = useCallback(async (entId: string) => {
    try { await DELETERS[type](entId); evictEntity(type, id); evictEntity(type, entId); } finally { onClose(); }
  }, [type, id, onClose]);

  if (loading) return null;
  if (error || !entity) return null;

  switch (type) {
    case 'card': return <CardDetailModal card={entity as Card} isOpen onClose={onClose} onDelete={handleDelete} />;
    case 'spell': return <SpellDetailModal spell={entity as Spell} isOpen onClose={onClose} onDelete={handleDelete} />;
    case 'action': return <ActionDetailModal action={entity as Action} isOpen onClose={onClose} onDelete={handleDelete} />;
    case 'effect': return <EffectDetailModal effect={entity as PassiveEffect} isOpen onClose={onClose} onDelete={handleDelete} />;
    case 'concept': return <ConceptDetailModal concept={entity as Concept} isOpen onClose={onClose} onDelete={handleDelete} />;
    default: return null;
  }
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
