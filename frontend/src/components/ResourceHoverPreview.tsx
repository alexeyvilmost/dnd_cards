import { useMemo, type ReactNode } from 'react';
import type { ResourceDefinition } from '../types';
import type { ResourceOption } from '../utils/resources';
import HoverCard from './HoverCard';
import ResourcePreview from './ResourcePreview';

interface ResourceHoverPreviewProps {
  resourceId: string;
  option?: ResourceOption;
  children: ReactNode;
}

/** Ресурсная плитка с тем же превью, что используется в библиотеке ресурсов. */
export default function ResourceHoverPreview({ resourceId, option, children }: ResourceHoverPreviewProps) {
  const resource = useMemo<ResourceDefinition>(() => ({
    id: resourceId,
    resource_id: resourceId,
    name: option?.label || resourceId,
    description: option?.description,
    category: option?.category,
    image_url: option?.imageUrl,
    image_url_spent: option?.imageUrlSpent,
    recharge: option?.recharge,
    sort_order: option?.sortOrder,
  }), [resourceId, option]);

  return (
    <HoverCard
      content={(
        <div role="tooltip" style={{ width: 340, maxWidth: 'calc(100vw - 16px)' }}>
          <ResourcePreview resource={resource} disableHover />
        </div>
      )}
    >
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </HoverCard>
  );
}
