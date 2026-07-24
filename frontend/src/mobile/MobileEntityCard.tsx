import type { ReactNode } from 'react';
import type { Action, Card, Feat, PassiveEffect, Spell } from '../types';
import ActionPreview from '../components/ActionPreview';
import CardPreview from '../components/CardPreview';
import EffectPreview from '../components/EffectPreview';
import EntityRefPreview from '../components/EntityRefPreview';
import {
  ENTITY_TYPE_LABEL,
  useEntityRef,
  type EntityRefType,
} from '../components/EntityRefRegistry';
import FeatPreview from '../components/FeatPreview';
import SpellPreview from '../components/SpellPreview';
import { FormattedText } from '../utils/formattedText';
import MobileOverlay from './MobileOverlay';

export type MobileEntityView =
  | { kind: 'card'; entity: Card }
  | { kind: 'spell'; entity: Spell; spellcasting?: { saveDC?: number; attack?: number } }
  | { kind: 'action'; entity: Action; sourceLabel?: string }
  | { kind: 'effect'; entity: PassiveEffect; sourceLabel?: string }
  | { kind: 'feat'; entity: Feat }
  | { kind: 'text'; title: string; description?: string | null; detail?: string };

export const mobileEntityTitle = (view: MobileEntityView) =>
  view.kind === 'text' ? view.title : view.entity.name;

export function MobileEntityPreview({ view }: { view: MobileEntityView }) {
  switch (view.kind) {
    case 'card':
      return <CardPreview card={view.entity} disableHover />;
    case 'spell':
      return <SpellPreview spell={view.entity} spellcasting={view.spellcasting} disableHover />;
    case 'action':
      return <ActionPreview action={view.entity} sourceLabel={view.sourceLabel} disableHover />;
    case 'effect':
      return <EffectPreview effect={view.entity} sourceLabel={view.sourceLabel} disableHover />;
    case 'feat':
      return <FeatPreview feat={view.entity} disableHover />;
    case 'text':
      return (
        <article className="m-entity-text-card">
          {view.detail && <p className="m-entity-detail">{view.detail}</p>}
          <h2>{view.title}</h2>
          <div className="m-entity-description">
            <FormattedText text={view.description || 'Подробное описание отсутствует.'} />
          </div>
        </article>
      );
  }
}

export function MobileEntityOverlay({
  view,
  onClose,
  footer,
}: {
  view: MobileEntityView;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <MobileOverlay title={mobileEntityTitle(view)} onClose={onClose} footer={footer}>
      <div className="m-mobile-entity-card">
        <MobileEntityPreview view={view} />
      </div>
    </MobileOverlay>
  );
}

export function MobileLinkedEntityOverlay({
  type,
  id,
  onClose,
}: {
  type: EntityRefType;
  id: string;
  onClose: () => void;
}) {
  const { entity, loading, error } = useEntityRef(type, id);
  const title = entity && 'name' in entity && typeof entity.name === 'string'
    ? entity.name
    : ENTITY_TYPE_LABEL[type];

  return (
    <MobileOverlay title={title} onClose={onClose}>
      <div className="m-mobile-entity-card">
        {loading && <div className="m-loading">Загрузка карточки…</div>}
        {error && <div className="m-inline-error">Не удалось загрузить сущность.</div>}
        {entity && <EntityRefPreview type={type} id={id} />}
      </div>
    </MobileOverlay>
  );
}
