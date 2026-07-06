import { useState } from 'react';
import type { Spell } from '../../types';
import { getSpellLevelLabel } from '../../types';
import { useSiteSettings } from '../../settings';
import SpellPreview from '../SpellPreview';

type Props = {
  spells: Spell[];
  className?: string;
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
        <div className="forge-spell-rows">
          {spells.map((spell) => (
            <button
              key={spell.id}
              type="button"
              className="forge-spell-row"
              title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
              {...hoverProps(spell)}
            >
              <img
                className="forge-spell-row-img"
                src={spell.image_url?.trim() || '/default_image.png'}
                alt={spell.name}
                onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
              />
              <span className="forge-spell-row-name">{spell.name}</span>
              <span className="forge-spell-row-meta">{getSpellLevelLabel(spell.level)}</span>
            </button>
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
