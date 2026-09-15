import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Action, Card, PassiveEffect, Spell } from '../types';
import type {RuntimeState} from '../mvp/contracts';
import ItemPreview from './ItemPreview';
import CardPreview from './CardPreview';
import {useSiteSettings} from '../settings';
import type { WeaponAttackPreview } from '../engine/weapon';
import { usePinMode } from '../hooks/usePinMode';
import ForgeEntityIcon from './forge/ForgeEntityIcon';
import EffectPreview from './EffectPreview';
import ActionPreview from './ActionPreview';
import SpellPreview from './SpellPreview';
import SheetEntityRow from './SheetEntityRow';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { useViewportPopoverPosition } from '../hooks/useViewportPopoverPosition';

export { fitActionPopoverToViewport } from '../hooks/useViewportPopoverPosition';

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
  selected?: boolean;
  disabledTitle?: string;
  inlineDisabledReason?: boolean;
  level?: number;
  actionRef?: Action;
  itemRef?: Card;
  runtime?: Pick<RuntimeState,'resources'|'maxResources'>;
  effectRef?: PassiveEffect;
  spellRef?: Spell;
  /** Контекст заклинателя (лист): СЛ спасброска и бонус атаки заклинаниями для превью. */
  spellcasting?: { saveDC?: number; attack?: number };
  /** Числа оружейной атаки (из оружия в руке) для подсказки действия-атаки. */
  weaponAttackPreview?: WeaponAttackPreview;
  /** 'row' — строка (по умолчанию); 'icon' — плитка (настройка отображения действий). */
  variant?: 'row' | 'icon';
  /** Explicit passive-toggle skin; uses the same entity preview and input handlers. */
  iconShape?: 'square' | 'round';
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
  selected,
  disabledTitle,
  inlineDisabledReason = true,
  level,
  actionRef,
  itemRef, runtime,
  effectRef,
  spellRef,
  spellcasting,
  weaponAttackPreview,
  variant = 'row',
  iconShape = 'square',
  disableHover = false,
  inspectMode = false,
  onActivate,
}: Props) => {
  const [hover, setHover] = useState(false);
  const settings=useSiteSettings();
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const { popoverRef, popoverPos } = useViewportPopoverPosition(hover, pos);
  // Режим закрепления (T): превью не закрывается при уходе мыши и интерактивно.
  const { pinModeActive } = usePinMode();
  const prevPin = useRef(pinModeActive);
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setHover(false);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);

  const onEnter = (e: React.MouseEvent) => {
    if (disableHover) return;
    setHover(true);
    setPos({ x: e.clientX, y: e.clientY });
  };
  const onLeave = () => { if (!pinModeActive) setHover(false); };
  const onFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (disableHover) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPos({x: bounds.right, y: bounds.top}); setHover(true);
  };

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          className={`cs-action-tile${iconShape === 'round' ? ' cs-action-tile--round' : ''}${disabled ? ' cs-action-tile--disabled' : ''}${selected ? ' is-selected' : ''}`}
          aria-pressed={selected}
          aria-disabled={(disabled && !inspectMode) || undefined}
          aria-label={disabled && disabledTitle ? `${name}: ${disabledTitle}` : name}
          title={disabled ? disabledTitle : iconShape === 'round' ? undefined : name}
          onClick={disabled && !inspectMode ? undefined : onActivate}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onFocus={onFocus}
          onBlur={onLeave}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        >
          <ForgeEntityIcon imageUrl={imageUrl?.trim() || null} alt={name} fill />
          {iconShape === 'round' && <span className="passive-orbit" aria-hidden="true"/>}
          {level != null && level > 0 && (
            <span className="cs-action-tile-lvl">{TILE_ROMAN[level - 1] ?? level}</span>
          )}
        </button>
      ) : (
        <SheetEntityRow
          selected={selected}
          imageUrl={imageUrl}
          name={name}
          detail={<>{detail}{inlineDisabledReason && disabled && disabledTitle && <span className="cs-action-inline-reason">{disabledTitle}</span>}</>}
          disabled={disabled && !inspectMode}
          title={disabled ? disabledTitle : name}
          onClick={onActivate}
          onMouseEnter={onEnter}
          onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={onLeave}
          onFocus={onFocus}
          onBlur={onLeave}
        />
      )}
      {/* Превью доступно ВСЕГДА (в т.ч. когда действие недоступно): показывает суть
          из данных сущности; причина недоступности — отдельным слоем, не вместо. */}
      {!disableHover && hover && (itemRef || effectRef || actionRef || spellRef || description) && createPortal((
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
          {itemRef && (settings.itemPreview==='interface'?<ItemPreview card={itemRef} disableHover/>:<CardPreview card={itemRef} disableHover/>)}
          {actionRef && <ActionPreview action={actionRef} runtime={runtime} sourceLabel={sourceLabel} weaponAttackPreview={weaponAttackPreview} disableHover />}
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
