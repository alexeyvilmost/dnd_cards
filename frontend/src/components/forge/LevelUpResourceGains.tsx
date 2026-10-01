import {useState} from 'react';
import type {RollModifier, ValueBreakdown} from '../../mvp/contracts';
import type {ResourceOption} from '../../utils/resources';
import {findResource} from '../../utils/resources';
import {resourceView} from '../../utils/eventDisplay';
import ResourceHoverPreview from '../ResourceHoverPreview';

export default function LevelUpResourceGains({gains, options, sources, maximumBreakdowns}: {
  gains: Array<{key: string; before: number; after: number; delta: number}>;
  options: ResourceOption[];
  sources: Record<string, RollModifier[]>;
  maximumBreakdowns?: Record<string, ValueBreakdown>;
}) {
  const [failedIcons,setFailedIcons]=useState<ReadonlySet<string>>(new Set());
  return <div className="levelup-resources">{gains.map(gain => {
    const {label, icon} = resourceView(options, gain.key);
    return <ResourceHoverPreview key={gain.key} resourceId={gain.key} option={findResource(options, gain.key)??{id:gain.key,label}}
      maximum={maximumBreakdowns?.[gain.key]??{value:gain.after, parts:sources[gain.key] ?? []}}>
      <button type="button" className="levelup-resource" aria-label={`${label}: максимум ${gain.before} → ${gain.after}`}>
        {!failedIcons.has(icon)&&<img src={icon} alt="" className="levelup-resource-icon"
          onError={()=>setFailedIcons(previous=>new Set([...previous,icon]))}/>}
        <span className="levelup-resource-name">{label}</span>
        <span className="levelup-resource-delta">{gain.before > 0 ? `${gain.before} → ${gain.after}` : `+${gain.delta}`}</span>
      </button>
    </ResourceHoverPreview>;
  })}</div>;
}
