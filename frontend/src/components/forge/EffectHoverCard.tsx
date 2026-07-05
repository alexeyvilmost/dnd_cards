import type { PassiveEffect } from '../../types';

type EffectHoverCardProps = {
  effect: PassiveEffect;
  sourceLabel?: string;
};

/** Описание, если оно информативно (не пустое и не повторяет имя). */
function usefulText(effect: PassiveEffect): string | null {
  for (const t of [effect.description, effect.detailed_description]) {
    const s = (t || '').trim();
    if (s && s !== effect.name.trim()) return s;
  }
  return null;
}

const EffectHoverCard = ({ effect, sourceLabel }: EffectHoverCardProps) => {
  const desc = usefulText(effect);
  return (
    <div className="forge-effect-card">
      {effect.image_url?.trim() && (
        <div className="forge-effect-card-art">
          <img src={effect.image_url} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}
      <div className="forge-effect-card-body">
        <div className="forge-effect-card-title">{effect.name}</div>
        <div className="forge-effect-card-type">{sourceLabel || 'Способность'}</div>
        {desc && <p className="forge-effect-card-desc">{desc}</p>}
      </div>
    </div>
  );
};

export default EffectHoverCard;
