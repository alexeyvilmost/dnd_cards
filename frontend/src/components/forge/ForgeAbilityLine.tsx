import { useState } from 'react';
import type { PassiveEffect, Action } from '../../types';
import ForgeEntityIcon from './ForgeEntityIcon';
import EffectHoverCard from './EffectHoverCard';
import ActionHoverCard from './ActionHoverCard';

type ForgeAbilityLineProps = {
  name: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  effect?: PassiveEffect;
  action?: Action;
};

const ForgeAbilityLine = ({ name, imageUrl, fallbackImageUrl, effect, action }: ForgeAbilityLineProps) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const iconUrl = imageUrl?.trim() || fallbackImageUrl?.trim() || null;

  const onEnter = (e: React.MouseEvent) => {
    setHover(true);
    setPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        className="sum-sub forge-ability-line"
        onMouseEnter={onEnter}
        onMouseLeave={() => setHover(false)}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      >
        <ForgeEntityIcon imageUrl={iconUrl} alt={name} size={20} />
        <span className="forge-ability-link">{name}.</span>
      </div>
      {hover && (effect || action) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
          }}
        >
          {effect && <EffectHoverCard effect={effect} />}
          {action && <ActionHoverCard action={action} />}
        </div>
      )}
    </>
  );
};

export default ForgeAbilityLine;
