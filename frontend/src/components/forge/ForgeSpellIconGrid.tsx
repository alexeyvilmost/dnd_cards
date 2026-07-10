import { useState } from 'react';
import type { Spell } from '../../types';
import { getSpellLevelLabel, SPELL_SCHOOL_OPTIONS } from '../../types';
import { useSiteSettings } from '../../settings';
import SpellPreview from '../SpellPreview';
import SheetEntityRow from '../SheetEntityRow';

type Props = {
  spells: Spell[];
  className?: string;
};

// Вторая строка ряда заклинания — как на листе (SheetActionsPanel.actionDetail):
// «Заговор»/«N уровень» + школа.
const spellSchoolLabel = (s?: string | null) => SPELL_SCHOOL_OPTIONS.find((o) => o.value === s)?.label || s || '';
export const spellDetail = (spell: Spell): string => {
  const lvl = spell.level ?? 0;
  const base = lvl === 0 ? 'Заговор' : `${lvl} уровень`;
  return spell.school ? `${base} · ${spellSchoolLabel(spell.school)}` : base;
};

/**
 * Заклинания персонажа: плитки-иконки или строки — по настройке сайта
 * («Отображение сущностей» → Заклинания). Ховер показывает карточку заклинания.
 */
const ForgeSpellIconGrid = ({ spells, className }: Props) => {
  const { entityDisplay } = useSiteSettings();
  const [hovered, setHovered] = useState<Spell | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  if (!spells.length) return null;

  const hoverProps = (spell: Spell) => ({
    onMouseEnter: (e: React.MouseEvent) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); },
    onMouseMove: (e: React.MouseEvent) => setMouse({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHovered(null),
  });

  return (
    <>
      {entityDisplay.spells === 'row' ? (
        <div className="sheet-item-cols">
          {spells.map((spell) => (
            <SheetEntityRow
              key={spell.id}
              imageUrl={spell.image_url}
              name={spell.name}
              detail={spellDetail(spell)}
              title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
              {...hoverProps(spell)}
            />
          ))}
        </div>
      ) : (
        <div className={className ?? 'forge-spell-icon-grid'}>
          {spells.map((spell) => (
            <div
              key={spell.id}
              className="forge-spell-icon ready"
              title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
              {...hoverProps(spell)}
            >
              <img
                src={spell.image_url?.trim() || '/default_image.png'}
                alt={spell.name}
                onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
              />
              {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
            </div>
          ))}
        </div>
      )}
      {hovered && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: Math.min(mouse.x + 16, window.innerWidth - 360),
            top: Math.min(Math.max(mouse.y - 40, 10), window.innerHeight - 20),
            transform: mouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
          }}
        >
          <SpellPreview spell={hovered} disableHover />
        </div>
      )}
    </>
  );
};

export default ForgeSpellIconGrid;
