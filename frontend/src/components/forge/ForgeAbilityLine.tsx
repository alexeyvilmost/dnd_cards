import { previewAnchor } from '../../utils/previewAnchor';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PassiveEffect, Action, Feat } from '../../types';
import FeatPreview from '../FeatPreview';
import { usePinMode } from '../../hooks/usePinMode';
import EffectPreview from '../EffectPreview';
import ActionPreview from '../ActionPreview';
import SheetEntityRow from '../SheetEntityRow';
import { useViewportPopoverPosition } from '../../hooks/useViewportPopoverPosition';

type ForgeAbilityLineProps = {
  name: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  sourceLabel?: string;
  /** Вторая строка (напр. «Вид · Эльф»). */
  detail?: ReactNode;
  effect?: PassiveEffect;
  action?: Action;
  feat?: Feat;
};

const ForgeAbilityLine = ({ name, imageUrl, fallbackImageUrl, sourceLabel, detail, effect, action, feat }: ForgeAbilityLineProps) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const { popoverRef, popoverPos } = useViewportPopoverPosition(hover, pos);
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
        className={effect || feat ? 'is-passive' : undefined}
        imageUrl={iconUrl}
        name={name}
        detail={detail}
        title={name}
        onMouseEnter={(e) => { setHover(true); setPos(previewAnchor(e.currentTarget)); }}
        onMouseLeave={onLeave}
      />
      {hover && (effect || action || feat) && (
        <div
          ref={popoverRef}
          className="forge-effect-popover"
          style={{
            left: popoverPos.left,
            top: popoverPos.top,
            pointerEvents: pinModeActive ? 'auto' : 'none',
          }}
          onMouseLeave={onLeave}
        >
          {effect && <EffectPreview effect={effect} sourceLabel={sourceLabel} disableHover />}
          {feat && <FeatPreview feat={feat} disableHover />}
          {action && <ActionPreview action={action} sourceLabel={sourceLabel} disableHover />}
        </div>
      )}
    </>
  );
};

export default ForgeAbilityLine;
