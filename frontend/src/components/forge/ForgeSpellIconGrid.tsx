import { useState } from 'react';
import type { Spell } from '../../types';
import { getSpellLevelLabel } from '../../types';
import SpellPreview from '../SpellPreview';

type Props = {
  spells: Spell[];
  className?: string;
};

const ForgeSpellIconGrid = ({ spells, className }: Props) => {
  const [hovered, setHovered] = useState<Spell | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  if (!spells.length) return null;

  return (
    <>
      <div className={className ?? 'forge-spell-icon-grid'}>
        {spells.map((spell) => (
          <div
            key={spell.id}
            className="forge-spell-icon ready"
            title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
            onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
            onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHovered(null)}
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
