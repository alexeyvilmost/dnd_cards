import {
  supportStatusOf,
  supportStatusPresentation,
  type SupportableEntity,
} from '../../content/supportStatus';

type SupportStatusBadgeProps = {
  entity: SupportableEntity | null | undefined;
  compact?: boolean;
};

const SupportStatusBadge = ({ entity, compact = false }: SupportStatusBadgeProps) => {
  const status = supportStatusOf(entity);
  const presentation = supportStatusPresentation(status);
  const title = [
    presentation.label,
    entity?.support?.note,
    ...(entity?.support?.limitations ?? []),
  ].filter(Boolean).join(' · ');

  return (
    <span
      className={`support-status-badge support-status-badge--${presentation.tone}${compact ? ' support-status-badge--compact' : ''}`}
      title={title}
      aria-label={presentation.label}
    >
      <span className="support-status-badge__dot" aria-hidden />
      {!compact && <span>{presentation.label}</span>}
    </span>
  );
};

export default SupportStatusBadge;
