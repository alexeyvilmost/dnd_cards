import { useState } from 'react';
import type { Action, PassiveEffect, Spell } from '../types';
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
  variant = 'row',
  onActivate,
}: Props) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onEnter = (e: React.MouseEvent) => {
    setHover(true);
    setPos({ x: e.clientX, y: e.clientY });
  };

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
          onMouseLeave={() => setHover(false)}
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
          onMouseLeave={() => setHover(false)}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        >
          <ForgeEntityIcon imageUrl={imageUrl?.trim() || null} alt={name} size={20} />
          <span className="cs-action-line-name">{name}</span>
          {level != null && (
            <span className="cs-action-line-lvl">{level === 0 ? 'З' : level}</span>
          )}
        </button>
      )}
      {hover && !disabled && (effectRef || actionRef || spellRef || description) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
          }}
        >
          {effectRef && <EffectHoverCard effect={effectRef} sourceLabel={sourceLabel} />}
          {actionRef && <ActionHoverCard action={actionRef} sourceLabel={sourceLabel} />}
          {spellRef && <SpellPreview spell={spellRef} disableHover />}
          {!effectRef && !actionRef && !spellRef && description && (
            <div className="forge-effect-card">
              <div className="forge-effect-card-body">
                <div className="forge-effect-card-title">{name}</div>
                <div className="forge-effect-card-type">{sourceLabel || 'Базовое действие'}</div>
                <p className="forge-effect-card-desc">{description}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default SheetActionLine;
