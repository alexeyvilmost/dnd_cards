import { useState } from 'react';
import type { Feat } from '../../types';
import ForgeEntityIcon from './ForgeEntityIcon';
import FeatPreview from '../FeatPreview';

/**
 * Черта в виде строки-как-эффект: маленькая иконка + подчёркнутый текст,
 * превью-карточка при наведении (единый стиль с ForgeAbilityLine).
 */
const ForgeFeatLine = ({ feat }: { feat: Feat }) => {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  return (
    <>
      <span
        className="sum-sub forge-ability-line"
        style={{ display: 'inline-flex' }}
        onMouseEnter={(e) => { setHover(true); setPos({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={() => setHover(false)}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      >
        <ForgeEntityIcon imageUrl={feat.image_url ?? null} alt={feat.name} size={20} />
        <span className="forge-ability-link">{feat.name}</span>
      </span>
      {hover && (
        <div
          className="forge-effect-popover"
          style={{
            left: Math.min(pos.x + 12, window.innerWidth - 340),
            top: Math.min(pos.y + 8, window.innerHeight - 200),
          }}
        >
          <FeatPreview feat={feat} disableHover />
        </div>
      )}
    </>
  );
};

export default ForgeFeatLine;
