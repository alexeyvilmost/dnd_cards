import { useEffect, useRef, useState } from 'react';
import type { Action, PassiveEffect, Spell } from '../types';
import type { WeaponAttackPreview } from '../engine/weapon';
import { usePinMode } from '../hooks/usePinMode';
import ForgeEntityIcon from './forge/ForgeEntityIcon';
import EffectHoverCard from './forge/EffectHoverCard';
import ActionHoverCard from './forge/ActionHoverCard';
import SpellPreview from './SpellPreview';

type Props = {
  name: string;
  imageUrl?: string | null;
  sourceLabel?: string;
  description?: string;
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
  onActivate: () => void;
};

const SheetActionLine = ({
  name,
  imageUrl,
  sourceLabel,
  description,
  disabled,
  disabledTitle,
  level,
  actionRef,
  effectRef,
  spellRef,
  spellcasting,
  weaponAttackPreview,
  variant = 'row',
  onActivate,
}: Props) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Режим закрепления (T): превью не закрывается при уходе мыши и интерактивно.
  const { pinModeActive } = usePinMode();
  const prevPin = useRef(pinModeActive);
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setHover(false);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);

  const onEnter = (e: React.MouseEvent) => {
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
          disabled={disabled}
          title={disabled ? disabledTitle : name}
          onClick={onActivate}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        >
          <ForgeEntityIcon imageUrl={imageUrl?.trim() || null} alt={name} size={40} />
          {level != null && (
            <span className="cs-action-tile-lvl">{level === 0 ? 'З' : level}</span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className={`cs-action-line${disabled ? ' cs-action-line--disabled' : ''}`}
          disabled={disabled}
          title={disabled ? disabledTitle : name}
          onClick={onActivate}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        >
          <ForgeEntityIcon imageUrl={imageUrl?.trim() || null} alt={name} size={20} />
          <span className="cs-action-line-name">{name}</span>
          {level != null && (
            <span className="cs-action-line-lvl">{level === 0 ? 'З' : level}</span>
          )}
        </button>
      )}
      {/* Превью доступно ВСЕГДА (в т.ч. когда действие недоступно): показывает суть
          из данных сущности; причина недоступности — отдельным слоем, не вместо. */}
      {hover && (effectRef || actionRef || spellRef || description) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
            pointerEvents: pinModeActive ? 'auto' : 'none',
          }}
          onMouseLeave={onLeave}
        >
          {effectRef && <EffectHoverCard effect={effectRef} sourceLabel={sourceLabel} />}
          {actionRef && <ActionHoverCard action={actionRef} sourceLabel={sourceLabel} weaponAttackPreview={weaponAttackPreview} />}
          {spellRef && <SpellPreview spell={spellRef} disableHover spellcasting={spellcasting} />}
          {!effectRef && !actionRef && !spellRef && description && (
            <div className="forge-effect-card">
              <div className="forge-effect-card-body">
                <div className="forge-effect-card-title">{name}</div>
                <div className="forge-effect-card-type">{sourceLabel || 'Базовое действие'}</div>
                <p className="forge-effect-card-desc">{description}</p>
              </div>
            </div>
          )}
          {disabled && disabledTitle && (
            <div className="cs-action-disabled-reason">{disabledTitle}</div>
          )}
        </div>
      )}
    </>
  );
};

export default SheetActionLine;
