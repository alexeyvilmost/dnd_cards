import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Action, PassiveEffect, Spell } from '../types';
import type { WeaponAttackPreview } from '../engine/weapon';
import { usePinMode } from '../hooks/usePinMode';
import ForgeEntityIcon from './forge/ForgeEntityIcon';
import EffectPreview from './EffectPreview';
import ActionPreview from './ActionPreview';
import SpellPreview from './SpellPreview';
import SheetEntityRow from './SheetEntityRow';
import { SPELL_CARD_CSS } from './spellCardStyle';

// Уровень заклинания в углу иконки — римской цифрой (I..IX).
const TILE_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export function fitActionPopoverToViewport(
  anchor: { x: number; y: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 12,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const left = Math.max(margin, Math.min(anchor.x + gap, maxLeft));
  const below = anchor.y + gap;
  const preferredTop = below + popover.height <= viewport.height - margin
    ? below
    : anchor.y - popover.height - gap;
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  return { left, top: Math.max(margin, Math.min(preferredTop, maxTop)) };
}

type Props = {
  name: string;
  imageUrl?: string | null;
  sourceLabel?: string;
  description?: string;
  /** Вторая строка ряда (напр. «Базовое действие», «1 уровень · Иллюзия»). */
  detail?: ReactNode;
  disabled?: boolean;
  disabledTitle?: string;
  level?: number;
  actionRef?: Action;
  effectRef?: PassiveEffect;
  spellRef?: Spell;
  /** Контекст заклинателя (лист): СЛ спасброска и бонус атаки заклинаниями для превью. */
  spellcasting?: { saveDC?: number; attack?: number };
  /** Числа оружейной атаки (из оружия в руке) для подсказки действия-атаки. */
  weaponAttackPreview?: WeaponAttackPreview;
  /** 'row' — строка (по умолчанию); 'icon' — плитка (настройка отображения действий). */
  variant?: 'row' | 'icon';
  disableHover?: boolean;
  /** В режиме просмотра недоступное действие всё равно можно открыть и изучить. */
  inspectMode?: boolean;
  onActivate: () => void;
};

const SheetActionLine = ({
  name,
  imageUrl,
  sourceLabel,
  description,
  detail,
  disabled,
  disabledTitle,
  level,
  actionRef,
  effectRef,
  spellRef,
  spellcasting,
  weaponAttackPreview,
  variant = 'row',
  disableHover = false,
  inspectMode = false,
  onActivate,
}: Props) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [popoverPos, setPopoverPos] = useState({ left: 8, top: 8 });
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Режим закрепления (T): превью не закрывается при уходе мыши и интерактивно.
  const { pinModeActive } = usePinMode();
  const prevPin = useRef(pinModeActive);
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setHover(false);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);

  useLayoutEffect(() => {
    if (!hover || !popoverRef.current) return undefined;
    const place = () => {
      const rect = popoverRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = fitActionPopoverToViewport(
        pos,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPopoverPos((current) => current.left === next.left && current.top === next.top ? current : next);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [hover, pos]);

  const onEnter = (e: React.MouseEvent) => {
    if (disableHover) return;
    setHover(true);
    setPos({ x: e.clientX, y: e.clientY });
  };
  const onLeave = () => { if (!pinModeActive) setHover(false); };

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          className={`cs-action-tile${disabled ? ' cs-action-tile--disabled' : ''}`}
          aria-disabled={(disabled && !inspectMode) || undefined}
          title={disabled ? disabledTitle : name}
          onClick={disabled && !inspectMode ? undefined : onActivate}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        >
          <ForgeEntityIcon imageUrl={imageUrl?.trim() || null} alt={name} fill />
          {level != null && level > 0 && (
            <span className="cs-action-tile-lvl">{TILE_ROMAN[level - 1] ?? level}</span>
          )}
        </button>
      ) : (
        <SheetEntityRow
          imageUrl={imageUrl}
          name={name}
          detail={detail}
          disabled={disabled && !inspectMode}
          title={disabled ? disabledTitle : name}
          onClick={onActivate}
          onMouseEnter={onEnter}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={onLeave}
        />
      )}
      {/* Превью доступно ВСЕГДА (в т.ч. когда действие недоступно): показывает суть
          из данных сущности; причина недоступности — отдельным слоем, не вместо. */}
      {!disableHover && hover && (effectRef || actionRef || spellRef || description) && createPortal((
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
          {effectRef && <EffectPreview effect={effectRef} sourceLabel={sourceLabel} disableHover />}
          {actionRef && <ActionPreview action={actionRef} sourceLabel={sourceLabel} weaponAttackPreview={weaponAttackPreview} disableHover />}
          {spellRef && <SpellPreview spell={spellRef} disableHover spellcasting={spellcasting} />}
          {!effectRef && !actionRef && !spellRef && description && (
            <div className="sp-tip">
              <style>{SPELL_CARD_CSS}</style>
              <h3>{name}</h3>
              <div className="sp-subtype">{sourceLabel || 'Базовое действие'}</div>
              <div className="sp-desc">{description}</div>
              <div className="sp-spacer" />
            </div>
          )}
          {disabled && disabledTitle && (
            <div className="cs-action-disabled-reason">{disabledTitle}</div>
          )}
        </div>
      ), document.body)}
    </>
  );
};

export default SheetActionLine;
