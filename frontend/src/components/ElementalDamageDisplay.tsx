import type { CSSProperties } from 'react';
import { getElementalDamageColor, getElementalDamageIconPath } from '../utils/elementalDamage';

interface ElementalDamageDisplayProps {
  value: string;
  type: string;
  iconSize?: number;
  fontStyle?: CSSProperties;
}

const ElementalDamageDisplay = ({
  value,
  type,
  iconSize = 10,
  fontStyle,
}: ElementalDamageDisplayProps) => {
  const color = getElementalDamageColor(type);
  const iconPath = getElementalDamageIconPath(type);

  return (
    <>
      <span
        style={{
          ...fontStyle,
          color,
          lineHeight: 1,
          marginLeft: '2px',
          marginRight: '2px',
        }}
      >
        +
      </span>
      <span
        style={{
          ...fontStyle,
          color,
          lineHeight: 1,
          marginRight: '2px',
        }}
      >
        {value}
      </span>
      <img
        src={iconPath}
        alt={type}
        aria-hidden
        style={{
          display: 'inline-block',
          width: iconSize,
          height: iconSize,
          flexShrink: 0,
          objectFit: 'contain',
        }}
      />
    </>
  );
};

export default ElementalDamageDisplay;
