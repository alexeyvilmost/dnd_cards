import type { PassiveEffect } from '../../types';

type EffectHoverCardProps = {
  effect: PassiveEffect;
  sourceLabel?: string;
};

const EffectHoverCard = ({ effect, sourceLabel }: EffectHoverCardProps) => (
  <div className="forge-effect-card">
    {effect.image_url?.trim() && (
      <div className="forge-effect-card-art">
        <img src={effect.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
    )}
    <div className="forge-effect-card-body">
      <div className="forge-effect-card-title">{effect.name}</div>
      <div className="forge-effect-card-type">{sourceLabel || 'Способность'}</div>
      <p className="forge-effect-card-desc">{effect.description}</p>
    </div>
  </div>
);

export default EffectHoverCard;
