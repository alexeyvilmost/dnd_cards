import SheetActionLine from '../SheetActionLine';
import ForgeAbilityLine from './ForgeAbilityLine';
import type { Action, PassiveEffect, Feat } from '../../types';
import type { EntityDisplayMode } from '../../settings';
import type { ReactNode } from 'react';

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
  feat?: Feat;
  iconShape?: 'square' | 'round';
};

type Props = {
  entries: AbilityEntry[];
  /** 'row' — строки с маленькой иконкой, 'icon' — плитки в стиле заклинаний. */
  mode: EntityDisplayMode;
  /** Класс контейнера для строчного режима (sheet-ability-lines / forge-ability-lines). */
  linesClassName?: string;
};

/**
 * Список способностей каноничными интерактивными строками SheetActionLine
 * (как правая панель листа). Черты без action/effect остаются на ForgeAbilityLine.
 */
const ForgeAbilityDisplay = ({ entries, mode, linesClassName = 'forge-ability-lines' }: Props) => {
  if (!entries.length) return null;

  const lines = entries.map((entry) => {
    if (entry.feat && !entry.effect && !entry.action) {
      return (
        <ForgeAbilityLine
          key={entry.key}
          name={entry.name}
          imageUrl={entry.imageUrl}
          fallbackImageUrl={entry.fallbackImageUrl}
          sourceLabel={entry.sourceLabel}
          detail={entry.detail}
          feat={entry.feat}
          variant={mode}
          iconShape={entry.iconShape}
        />
      );
    }
    return (
      <SheetActionLine
        key={entry.key}
        name={entry.name}
        imageUrl={entry.imageUrl?.trim() || entry.fallbackImageUrl}
        sourceLabel={entry.sourceLabel}
        detail={entry.detail}
        effectRef={entry.effect}
        actionRef={entry.action}
        variant={mode}
        iconShape={entry.iconShape}
        inspectMode
        onActivate={() => undefined}
      />
    );
  });

  if (mode === 'row') {
    return <div className={linesClassName}>{lines}</div>;
  }

  return (
    <div className="cs-action-tiles forge-spell-icon-grid sheet-spell-grid">
      {lines}
    </div>
  );
};

export default ForgeAbilityDisplay;
