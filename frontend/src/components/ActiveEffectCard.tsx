import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleDot } from 'lucide-react';
import { effectsApi } from '../api/client';
import type { ActiveEffectDisplayGroup } from '../engine/effects';
import type { PassiveEffect } from '../types';
import EffectPreview from './EffectPreview';
import HoverCard from './HoverCard';
import DialogShell from './DialogShell';
import {useSiteSettings} from '../settings';
import './ActiveEffectCard.css';

function entityReference(group: ActiveEffectDisplayGroup) {
  return group.effects.find((effect) => effect.entityRef)?.entityRef ?? null;
}

/** Resolve the exact library entity carried by a runtime effect. No localized
 * name matching is permitted: runtime provenance is the source of truth. */
export function useActiveEffectEntity(group: ActiveEffectDisplayGroup): PassiveEffect | null {
  const reference = useMemo(() => entityReference(group), [group]);
  const [entity, setEntity] = useState<PassiveEffect | null>(null);

  useEffect(() => {
    let alive = true;
    setEntity(null);
    if (!reference?.id) return () => { alive = false; };
    void effectsApi.getEffect(reference.id)
      .then((loaded) => { if (alive) setEntity(loaded); })
      .catch(() => { if (alive) setEntity(null); });
    return () => { alive = false; };
  }, [reference?.id]);

  return entity;
}

export default function ActiveEffectCard({
  group,
  className = '',
  actions,
  variant: requestedVariant,
  onInspect,
}: {
  group: ActiveEffectDisplayGroup;
  className?: string;
  actions?: ReactNode;
  variant?: 'row' | 'icon';
  onInspect?: (entity: PassiveEffect) => void;
}) {
  const settings = useSiteSettings();
  const variant = requestedVariant ?? settings.entityDisplay.effects;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const entity = useActiveEffectEntity(group);
  const icon = entity?.image_url?.trim();
  const previewEntity: PassiveEffect = entity ?? {
    id: group.key, name: group.name, description: group.instructions.join('\n\n'),
    mechanics: group.effects[0]?.mechanics, rarity: 'common', card_number: '',
    effect_type: 'passive', created_at: '', updated_at: '',
  };
  const footer = <div className="active-effect-preview__footer">
    <span>Источник: {group.source ?? 'Не указан'}</span>
    <span>Длительность: {group.duration}</span>
  </div>;
  const bodyContents = <>
      <span className="active-effect-card__icon" aria-hidden="true">
        {icon
          ? <img src={icon} alt="" onError={(event) => { event.currentTarget.src = '/default_image.png'; }} />
          : <CircleDot size={18} />}
      </span>
      {variant === 'row' && <span className="active-effect-card__summary">
        <strong>{group.name}</strong>
        {group.source && <small>Источник: {group.source}</small>}
        <small>Длительность: {group.duration}</small>
        {group.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
      </span>}
  </>;
  const body = variant === 'icon'
    ? <button type="button" className="active-effect-card__body" aria-label={group.name}
      aria-haspopup="dialog" onClick={() => onInspect ? onInspect(previewEntity) : setDetailsOpen(true)}>{bodyContents}</button>
    : <span className="active-effect-card__body" aria-label={group.name}>{bodyContents}</span>;

  return (
    <span className={`active-effect-card${variant === 'icon' ? ' active-effect-card--icon' : ''} ${className}`.trim()}>
        <HoverCard
          className="active-effect-card__hover"
          disabled={detailsOpen}
          content={<EffectPreview effect={previewEntity} disableHover footer={footer} />}
        >
          {body}
        </HoverCard>
      {variant === 'row' && actions && <span className="active-effect-card__actions">{actions}</span>}
      {detailsOpen && createPortal(<DialogShell label={group.name} wrap onCancel={() => setDetailsOpen(false)}>
        <div className="active-effect-details">
          <EffectPreview effect={previewEntity} disableHover footer={footer} />
          {actions && <div className="active-effect-details__actions">{actions}</div>}
          <button type="button" className="forge-btn ghost" onClick={() => setDetailsOpen(false)}>Закрыть</button>
        </div>
      </DialogShell>, document.body)}
    </span>
  );
}
