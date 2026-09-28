import type { SupportableEntity } from '../content/supportStatus';
import { supportStatusPresentation } from '../content/supportStatus';
import { useReviewStatus } from '../content/useReviewStatus';
import { useSiteSettings } from '../settings';
import './reviewStatus.css';
import type { TaggedEntityType } from '../api/entityTags';

/** Parent must establish position: relative. The corner never captures pointer events. */
export default function ReviewStatusCorner({ entity, entityType }: {
  entity: (SupportableEntity & { id?: string; key?: string }) | null | undefined;
  entityType?: TaggedEntityType;
}) {
  const { showReviewStatus } = useSiteSettings();
  const status = useReviewStatus(entity, entityType);
  if (!showReviewStatus) return null;
  const presentation = supportStatusPresentation(status);
  return <span className="review-status-corner" data-review-status={status} role="img"
    aria-label={`Статус проверки: ${presentation.label}`} style={{ backgroundColor: presentation.color }} />;
}
