import type { SupportableEntity } from '../../content/supportStatus';
import ReviewStatusCorner from '../ReviewStatusCorner';

/** Compatibility entry point for existing entity tiles. Certification badges are retired. */
export default function SupportStatusBadge({ entity }: {
  entity: SupportableEntity | null | undefined; compact?: boolean;
}) { return <ReviewStatusCorner entity={entity} />; }
