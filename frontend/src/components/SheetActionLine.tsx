import { useEffect, useRef, useState, type ReactNode } from 'react';
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
          disabled={disabled}
          title={disabled ? disabledTitle : name}
          onClick={onActivate}
          onMouseEnter={onEnter}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={onLeave}
        />
      )}
      {/* Превью доступно ВСЕГДА (в т.ч. когда действие недоступно): показывает суть
          из данных сущности; причина недоступности — отдельным слоем, не вместо. */}
      {hover && (effectRef || actionRef || spellRef || description) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 340),
            top: Math.min(pos.y + 8, window.innerHeight - 200),
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
      )}
    </>
  );
};

export default SheetActionLine;
