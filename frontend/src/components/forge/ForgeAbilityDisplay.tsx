import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Action, PassiveEffect } from '../../types';
import type { EntityDisplayMode } from '../../settings';
import { usePinMode } from '../../hooks/usePinMode';
import ForgeAbilityLine from './ForgeAbilityLine';
import EffectHoverCard from './EffectHoverCard';
import ActionHoverCard from './ActionHoverCard';

export type AbilityEntry = {
  key: string;
  name: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  sourceLabel?: string;
  /** Вторая строка ряда (напр. «Вид · Эльф», «Базовое действие»). */
  detail?: ReactNode;
  effect?: PassiveEffect;
  action?: Action;
};

type Props = {
  entries: AbilityEntry[];
  /** 'row' — строки с маленькой иконкой (ForgeAbilityLine), 'icon' — плитки в стиле заклинаний. */
  mode: EntityDisplayMode;
  /** Класс контейнера для строчного режима (sheet-ability-lines / forge-ability-lines). */
  linesClassName?: string;
};

/**
 * Список способностей (эффектов/действий) с переключаемым режимом отображения.
 * Ховер-карточки (EffectHoverCard/ActionHoverCard) работают в обоих режимах.
 */
const ForgeAbilityDisplay = ({ entries, mode, linesClassName = 'forge-ability-lines' }: Props) => {
  const [hovered, setHovered] = useState<AbilityEntry | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Режим закрепления (T): превью не закрывается при уходе мыши и становится интерактивным.
  const { pinModeActive } = usePinMode();
  const prevPin = useRef(pinModeActive);
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setHovered(null);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);
  const onLeave = () => { if (!pinModeActive) setHovered(null); };

  if (!entries.length) return null;

  if (mode === 'row') {
    return (
      <div className={linesClassName}>
        {entries.map((entry) => (
          <ForgeAbilityLine
            key={entry.key}
            name={entry.name}
            imageUrl={entry.imageUrl}
            fallbackImageUrl={entry.fallbackImageUrl}
            sourceLabel={entry.sourceLabel}
            detail={entry.detail}
            effect={entry.effect}
            action={entry.action}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="forge-spell-icon-grid sheet-spell-grid">
        {entries.map((entry) => {
          const url = entry.imageUrl?.trim() || entry.fallbackImageUrl?.trim() || '/default_image.png';
          return (
            <div
              key={entry.key}
              className="forge-spell-icon ready"
              title={entry.name}
              onMouseEnter={(e) => { setHovered(entry); setPos({ x: e.clientX, y: e.clientY }); }}
              onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={onLeave}
            >
              <img
                src={url}
                alt={entry.name}
                onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
              />
            </div>
          );
        })}
      </div>
      {hovered && (hovered.effect || hovered.action) && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 320),
            top: Math.min(pos.y + 8, window.innerHeight - 180),
            pointerEvents: pinModeActive ? 'auto' : 'none',
          }}
          onMouseLeave={onLeave}
        >
          {hovered.effect && <EffectHoverCard effect={hovered.effect} sourceLabel={hovered.sourceLabel} />}
          {hovered.action && !hovered.effect && (
            <ActionHoverCard action={hovered.action} sourceLabel={hovered.sourceLabel} />
          )}
        </div>
      )}
    </>
  );
};

export default ForgeAbilityDisplay;
