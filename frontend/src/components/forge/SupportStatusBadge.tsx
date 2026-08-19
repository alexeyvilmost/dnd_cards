import {
  supportStatusOf,
  supportStatusPresentation,
  testCoverageOf,
  isMechanicsLocked,
  type SupportableEntity,
} from '../../content/supportStatus';
import { useSiteSettings } from '../../settings';

type SupportStatusBadgeProps = {
  entity: SupportableEntity | null | undefined;
  compact?: boolean;
};

const SupportStatusBadge = ({ entity, compact = false }: SupportStatusBadgeProps) => {
  const { playerMode } = useSiteSettings();
  if (playerMode) return null;
  const status = supportStatusOf(entity);
  const presentation = supportStatusPresentation(status);
  const coverage = testCoverageOf(entity);
  const locked = isMechanicsLocked(entity);
  const title = [
    presentation.label,
    coverage
      ? `Сценарии заявленного scope: ${coverage.passed}/${coverage.required}; scope ${coverage.scope}`
      : 'Точное покрытие не опубликовано',
    locked ? 'Механика закреплена' : null,
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
      <span>{coverage ? `${coverage.passed}/${coverage.required}` : (compact ? '—' : presentation.label)}</span>
      {!compact && coverage && <span> сценариев · {presentation.label}{locked ? ' · закреплено' : ''}</span>}
    </span>
  );
};

export default SupportStatusBadge;
