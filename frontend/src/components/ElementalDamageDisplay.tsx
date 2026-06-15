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
          color,
          lineHeight: 1,
          marginLeft: '2px',
          marginRight: '2px',
          ...fontStyle,
        }}
      >
        +
      </span>
      <span
        style={{
          color,
          lineHeight: 1,
          marginRight: '2px',
          ...fontStyle,
        }}
      >
        {value}
      </span>
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: iconSize,
          height: iconSize,
          flexShrink: 0,
          backgroundColor: color,
          WebkitMaskImage: `url(${iconPath})`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskImage: `url(${iconPath})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
        }}
      />
    </>
  );
};

export default ElementalDamageDisplay;
