/**
 * Диспетчер превью по ссылке (type, id): грузит сущность (кэш) и рендерит подходящий
 * существующий *Preview. Единая точка «ссылка → превью» — без переписывания превью.
 */
import type { CSSProperties } from 'react';
import type { Card, Spell, Action, PassiveEffect, Concept } from '../types';
import type { EntityRefType } from './EntityRefRegistry';
import { useEntityRef } from './EntityRefRegistry';
import CardPreview from './CardPreview';
import SpellPreview from './SpellPreview';
import ActionPreview from './ActionPreview';
import EffectPreview from './EffectPreview';
import ConceptPreview from './ConceptPreview';

interface EntityRefPreviewProps {
  type: EntityRefType;
  id: string;
}

const pillStyle: CSSProperties = {
  background: '#1c1813', color: '#e8dcc0', border: '1px solid #6b5836',
  borderRadius: 10, padding: '8px 14px', fontSize: 13, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
};

const EntityRefPreview: React.FC<EntityRefPreviewProps> = ({ type, id }) => {
  const { entity, loading, error } = useEntityRef(type, id);

  if (loading) return <div style={pillStyle}>Загрузка…</div>;
  if (error || !entity) return <div style={{ ...pillStyle, color: '#e0a0a0' }}>Ссылка не найдена</div>;

  switch (type) {
    case 'card': return <CardPreview card={entity as Card} disableHover />;
    case 'spell': return <SpellPreview spell={entity as Spell} disableHover />;
    case 'action': return <ActionPreview action={entity as Action} disableHover />;
    case 'effect': return <EffectPreview effect={entity as PassiveEffect} disableHover />;
    case 'concept': return <ConceptPreview concept={entity as Concept} disableHover />;
    default: return null;
  }
};

export default EntityRefPreview;
