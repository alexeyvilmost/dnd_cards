import type { ReactNode } from 'react';
import type { Card } from '../types';
import {
  bottomPanelFontStyle,
  bottomPanelPriceInlineStyle,
  bottomPanelValueInlineStyle,
} from '../utils/cardBottomPanelStyles';

const ICON_SIZE = 10;
const COIN_FILTER =
  'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)';

const iconStyle = {
  width: `${ICON_SIZE}px`,
  height: `${ICON_SIZE}px`,
  display: 'block',
  flexShrink: 0,
} as const;

const barBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  pointerEvents: 'none' as const,
  zIndex: 10,
  backgroundColor: 'white',
  borderTop: '1px solid #e5e7eb',
  boxSizing: 'border-box' as const,
};

const statsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  ...bottomPanelFontStyle,
};

const groupStyle = (isLast: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  marginRight: isLast ? 0 : '8px',
});

const valueStyle = (tight = false) => ({
  ...(tight ? bottomPanelValueInlineStyle : bottomPanelValueInlineStyle),
  lineHeight: 1,
  marginRight: tight ? '2px' : '4px',
});

const formatPrice = (price: number): string => {
  if (price >= 1000) {
    return `${(price / 1000).toFixed(1)}K`;
  }
  return `${price}`;
};

const formatWeight = (weight: number): string => `${weight}`;

const getBonusShortValue = (bonusValue: string): string => {
  if (bonusValue.toLowerCase() === 'advantage') return 'ADV';
  return bonusValue;
};

const getDamageTypeLabel = (damageType: string): string => {
  switch (damageType) {
    case 'piercing':
      return 'колющий';
    case 'slashing':
      return 'рубящий';
    case 'bludgeoning':
      return 'дробящий';
    default:
      return '';
  }
};

const renderDefenseIcons = (defenseType: string) => {
  switch (defenseType) {
    case 'cloth':
      return <img src="/icons/cloth.png" alt="Тканевая броня" style={iconStyle} />;
    case 'light':
      return <img src="/icons/defense.png" alt="Легкая броня" style={iconStyle} />;
    case 'medium':
      return (
        <div style={{ display: 'flex' }}>
          <img src="/icons/defense.png" alt="Средняя броня" style={iconStyle} />
          <img src="/icons/defense.png" alt="Средняя броня" style={iconStyle} />
        </div>
      );
    case 'heavy':
      return (
        <div style={{ display: 'flex' }}>
          <img src="/icons/defense.png" alt="Тяжелая броня" style={iconStyle} />
          <img src="/icons/defense.png" alt="Тяжелая броня" style={iconStyle} />
          <img src="/icons/defense.png" alt="Тяжелая броня" style={iconStyle} />
        </div>
      );
    default:
      return null;
  }
};

interface CardBottomPanelProps {
  card: Card;
  variant: 'flow' | 'absolute';
}

const CardBottomPanel = ({ card, variant }: CardBottomPanelProps) => {
  const containerStyle =
    variant === 'absolute'
      ? {
          ...barBaseStyle,
          position: 'absolute' as const,
          bottom: '2px',
          left: '2px',
          right: '2px',
        }
      : {
          ...barBaseStyle,
          padding: '4px',
        };

  type StatItem = { key: string; node: ReactNode };
  const items: StatItem[] = [];

  if (card.weight) {
    items.push({
      key: 'weight',
      node: (
        <>
          <span style={valueStyle()}>{formatWeight(card.weight)}</span>
          <img src="/icons/weight.png" alt="Вес" style={iconStyle} />
        </>
      ),
    });
  }

  if (card.price) {
    items.push({
      key: 'price',
      node: (
        <>
          <span style={{ ...bottomPanelPriceInlineStyle, lineHeight: 1, marginRight: '4px' }}>{formatPrice(card.price)}</span>
          <img src="/icons/coin.png" alt="Монеты" style={{ ...iconStyle, filter: COIN_FILTER }} />
        </>
      ),
    });
  }

  if (card.bonus_type && card.bonus_value) {
    items.push({
      key: 'bonus',
      node: (
        <>
          <span style={valueStyle(true)}>{getBonusShortValue(card.bonus_value)}</span>
          {card.bonus_type === 'damage' && card.damage_type && (
            <img
              src={`/icons/${card.damage_type}.png`}
              alt={getDamageTypeLabel(card.damage_type)}
              style={iconStyle}
            />
          )}
          {card.bonus_type === 'defense' && card.defense_type && renderDefenseIcons(card.defense_type)}
          {card.bonus_type === 'defense' && card.type === 'щит' && (
            <img src="/icons/defense.png" alt="Защита" style={iconStyle} />
          )}
        </>
      ),
    });
  }

  if (card.range) {
    items.push({
      key: 'range',
      node: (
        <>
          <span style={{ ...valueStyle(true), whiteSpace: 'nowrap' }}>{card.range}</span>
          <img src="/icons/range.png" alt="Дальность" style={iconStyle} />
        </>
      ),
    });
  }

  return (
    <div style={containerStyle}>
      <div style={statsRowStyle}>
        {items.map((item, index) => (
          <div key={item.key} style={groupStyle(index === items.length - 1)}>
            {item.node}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CardBottomPanel;
