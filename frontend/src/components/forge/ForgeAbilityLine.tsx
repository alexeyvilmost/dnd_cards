import { useState, type ReactNode } from 'react';
import type { PassiveEffect, Action } from '../../types';
import EffectHoverCard from './EffectHoverCard';
import ActionHoverCard from './ActionHoverCard';
import SheetEntityRow from '../SheetEntityRow';

type ForgeAbilityLineProps = {
  name: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  sourceLabel?: string;
  /** Вторая строка (напр. «Вид · Эльф»). */
  detail?: ReactNode;
  effect?: PassiveEffect;
  action?: Action;
};

const ForgeAbilityLine = ({ name, imageUrl, fallbackImageUrl, sourceLabel, detail, effect, action }: ForgeAbilityLineProps) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const iconUrl = imageUrl?.trim() || fallbackImageUrl?.trim() || null;

  return (
    <>
      <SheetEntityRow
        imageUrl={iconUrl}
        name={name}
        detail={detail}
        title={name}
        onMouseEnter={(e) => { setHover(true); setPos({ x: e.clientX, y: e.clientY }); }}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(false)}
      />
      {hover && (effect || action) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
          }}
        >
          {effect && <EffectHoverCard effect={effect} sourceLabel={sourceLabel} />}
          {action && <ActionHoverCard action={action} sourceLabel={sourceLabel} />}
        </div>
      )}
    </>
  );
};

export default ForgeAbilityLine;
