import { useMemo, useState, type ReactNode } from 'react';
import type { ResourceDefinition } from '../types';
import type { ResourceOption } from '../utils/resources';
import ResourcePreview from './ResourcePreview';

interface ResourceHoverPreviewProps {
  resourceId: string;
  option?: ResourceOption;
  children: ReactNode;
}

/** Ресурсная плитка с тем же превью, что используется в библиотеке ресурсов. */
export default function ResourceHoverPreview({ resourceId, option, children }: ResourceHoverPreviewProps) {
  const [hovered, setHovered] = useState(false);

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
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 340,
            maxWidth: 'min(340px, calc(100vw - 16px))',
            zIndex: 80,
            pointerEvents: 'none',
          }}
        >
          <ResourcePreview resource={resource} disableHover />
        </span>
      )}
    </span>
  );
}
