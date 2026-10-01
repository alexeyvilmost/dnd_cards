import { previewAnchor } from '../../utils/previewAnchor';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PassiveEffect, Action, Feat } from '../../types';
import FeatPreview from '../FeatPreview';
import { usePinMode } from '../../hooks/usePinMode';
import EffectPreview from '../EffectPreview';
import ActionPreview from '../ActionPreview';
import SheetEntityRow from '../SheetEntityRow';
import { useViewportPopoverPosition } from '../../hooks/useViewportPopoverPosition';
import ForgeEntityIcon from './ForgeEntityIcon';
import '../SheetPassiveToggle.css';

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
  variant?: 'row' | 'icon';
  iconShape?: 'square' | 'round';
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onActivate?: () => void;
};

const ForgeAbilityLine = ({ name, imageUrl, fallbackImageUrl, sourceLabel, detail, effect, action, feat, variant = 'row', iconShape = 'square', selected, disabled, disabledReason, onActivate }: ForgeAbilityLineProps) => {
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
  const openPreview = (target: Element) => { setHover(true); setPos(previewAnchor(target)); };

  return (
    <>
      {variant === 'icon' ? <button type="button"
        className={`cs-action-tile${iconShape === 'round' ? ' cs-action-tile--round' : ''}`}
        aria-label={name} aria-pressed={selected} aria-disabled={disabled || undefined} aria-description={disabledReason}
        onClick={disabled ? undefined : onActivate} onMouseEnter={(event) => openPreview(event.currentTarget)} onMouseLeave={onLeave}
        onFocus={(event) => openPreview(event.currentTarget)} onBlur={onLeave}>
        <ForgeEntityIcon imageUrl={iconUrl} alt={name} fill />
      </button> : <SheetEntityRow
        className={effect || feat ? 'is-passive' : undefined}
        imageUrl={iconUrl}
        name={name}
        detail={disabledReason ?? detail}
        title={disabledReason ?? name}
        selected={selected}
        disabled={disabled}
        onClick={onActivate}
        onMouseEnter={(e) => openPreview(e.currentTarget)}
        onMouseLeave={onLeave}
        onFocus={(e) => openPreview(e.currentTarget)} onBlur={onLeave}
      />}
      {hover && (effect || action || feat) && createPortal((
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
      ), document.body)}
    </>
  );
};

export default ForgeAbilityLine;
