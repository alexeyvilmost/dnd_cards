import type { PassiveEffect } from '../../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../../types';

type EffectHoverCardProps = {
  effect: PassiveEffect;
};

const effectTypeLabel = (t: string) =>
  PASSIVE_EFFECT_TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

const EffectHoverCard = ({ effect }: EffectHoverCardProps) => (
  <div className="forge-effect-card">
    {effect.image_url?.trim() && (
      <div className="forge-effect-card-art">
        <img src={effect.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
    )}
    <div className="forge-effect-card-body">
      <div className="forge-effect-card-title">{effect.name}</div>
      <div className="forge-effect-card-type">{effectTypeLabel(effect.effect_type)}</div>
      <p className="forge-effect-card-desc">{effect.description}</p>
    </div>
  </div>
);

export default EffectHoverCard;
