import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PassiveEffect, Action } from '../../types';
import { usePinMode } from '../../hooks/usePinMode';
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
  // Режим закрепления (T): превью не закрывается при уходе мыши и становится интерактивным.
  const { pinModeActive } = usePinMode();
  const prevPin = useRef(pinModeActive);
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setHover(false);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);
  const onLeave = () => { if (!pinModeActive) setHover(false); };

  return (
    <>
      <SheetEntityRow
        imageUrl={iconUrl}
        name={name}
        detail={detail}
        title={name}
        onMouseEnter={(e) => { setHover(true); setPos({ x: e.clientX, y: e.clientY }); }}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={onLeave}
      />
      {hover && (effect || action) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
            pointerEvents: pinModeActive ? 'auto' : 'none',
          }}
          onMouseLeave={onLeave}
        >
          {effect && <EffectHoverCard effect={effect} sourceLabel={sourceLabel} />}
          {action && <ActionHoverCard action={action} sourceLabel={sourceLabel} />}
        </div>
      )}
    </>
  );
};

export default ForgeAbilityLine;
