import { useMemo, type ReactNode } from 'react';
import type { ResourceDefinition } from '../types';
import type { ResourceOption } from '../utils/resources';
import type { ValueBreakdown } from '../mvp/contracts';
import type { RollModifier } from '../mvp/contracts';
import HoverCard from './HoverCard';
import ResourcePreview from './ResourcePreview';

interface ResourceHoverPreviewProps {
  resourceId: string;
  option?: ResourceOption;
  maximum?: ValueBreakdown;
  sources?: RollModifier[];
  children: ReactNode;
}

/** Ресурсная плитка с тем же превью, что используется в библиотеке ресурсов. */
export default function ResourceHoverPreview({ resourceId, option, maximum, sources, children }: ResourceHoverPreviewProps) {
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
          {!maximum && sources && sources.length > 0 && (
            <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.14)' }}>
              <strong style={{ display: 'block', marginBottom: 5 }}>Максимум ресурса: {sources.reduce((sum, part) => sum + part.value, 0)}</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {sources.map((part, index) => (
                  <li key={`${part.source}-${index}`}>
                    {part.source}: {part.value >= 0 ? '+' : ''}{part.value}{part.reason ? ` — ${part.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ResourcePreview resource={resource} maximum={maximum} disableHover />
        </div>
      )}
    >
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </HoverCard>
  );
}
