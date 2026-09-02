import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleDot } from 'lucide-react';
import { effectsApi } from '../api/client';
import type { ActiveEffectDisplayGroup } from '../engine/effects';
import type { PassiveEffect } from '../types';
import EffectPreview from './EffectPreview';
import HoverCard from './HoverCard';

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
}: {
  group: ActiveEffectDisplayGroup;
  className?: string;
  actions?: ReactNode;
}) {
  const entity = useActiveEffectEntity(group);
  const icon = entity?.image_url?.trim();
  const body = (
    <span className="active-effect-card__body">
      <span className="active-effect-card__icon" aria-hidden="true">
        {icon
          ? <img src={icon} alt="" onError={(event) => { event.currentTarget.src = '/default_image.png'; }} />
          : <CircleDot size={18} />}
      </span>
      <span className="active-effect-card__summary">
        <strong>{group.name}</strong>
        {group.source && <small>Источник: {group.source}</small>}
        <small>Длительность: {group.duration}</small>
        {group.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
      </span>
    </span>
  );

  return (
    <span className={`active-effect-card ${className}`.trim()}>
      {entity ? (
        <HoverCard
          className="active-effect-card__hover"
          content={<EffectPreview effect={entity} disableHover sourceLabel={group.source ?? 'Активный эффект'} />}
        >
          {body}
        </HoverCard>
      ) : body}
      {actions && <span className="active-effect-card__actions">{actions}</span>}
    </span>
  );
}
