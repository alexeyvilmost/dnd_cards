import type { Card } from '../types';

interface SVGCardPreviewProps {
  card: Card;
  width?: number;
  height?: number;
}

const SVGCardPreview = ({ card, width = 397, height = 280 }: SVGCardPreviewProps) => {
  const isExtended = Boolean(card.is_extended);
  const cardWidth = isExtended ? 397 : 198;
  const cardHeight = 280;

  // Получаем цвета редкости
  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return '#6b7280';
      case 'uncommon': return '#10b981';
      case 'rare': return '#3b82f6';
      case 'epic': return '#8b5cf6';
      case 'legendary': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getBorderColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return '#9ca3af';
      case 'uncommon': return '#10b981';
      case 'rare': return '#3b82f6';
      case 'very_rare': return '#8b5cf6';
      case 'artifact': return '#f59e0b';
      default: return '#d1d5db';
    }
  };

  // Форматирование цены и веса
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return `${price}`;
  };

  const formatWeight = (weight: number): string => {
    return `${weight}`;
  };

  // Маркер редкости
  const getRarityMarker = () => {
    switch (card.rarity) {
      case 'common': return '•';
      case 'uncommon': return ':';
      case 'rare': return '✦';
      case 'very_rare': return '✧';
      case 'artifact': return '★';
      default: return '•';
    }
  };

  const rarityColor = getRarityColor(card.rarity);
  const borderColor = getBorderColor(card.rarity);

  // Размеры шрифта для заголовка
  const getTitleFontSize = () => {
    if (isExtended) {
      if (card.name.length > 20) return 18;
      if (card.name.length > 15) return 20;
      return 20;
    } else {
      if (card.name.length > 20) return 12;
      if (card.name.length > 15) return 14;
      return 14;
    }
  };

  const titleFontSize = getTitleFontSize();

  return (
    <svg 
      width={cardWidth} 
      height={cardHeight} 
      viewBox={`0 0 ${cardWidth} ${cardHeight}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ backgroundColor: 'white' }}
    >
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.1)"/>
        </filter>
      </defs>

      {/* Фон карты */}
      <rect 
        x="0" 
        y="0" 
        width={cardWidth} 
        height={cardHeight} 
        fill="white" 
        stroke={borderColor} 
        strokeWidth="4" 
        rx="8" 
        ry="8"
        filter="url(#shadow)"
      />

      {/* Маркер редкости */}
      <text 
        x="8" 
        y="16" 
        fontSize="12" 
        fill={rarityColor}
        fontFamily="Arial, sans-serif"
      >
        {getRarityMarker()}
      </text>

      {isExtended ? (
        // Расширенный формат
        <>
          {/* Заголовок */}
          <text 
            x={cardWidth / 4} 
            y="24" 
            fontSize={titleFontSize} 
            fill={rarityColor}
            fontWeight="bold"
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.name}
          </text>

          {/* Разделительная линия */}
          <line 
            x1={cardWidth / 2} 
            y1="0" 
            x2={cardWidth / 2} 
            y2={cardHeight} 
            stroke="#e5e7eb" 
            strokeWidth="1"
          />

          {/* Левая половина - изображение */}
          <rect 
            x="4" 
            y="32" 
            width={cardWidth / 2 - 8} 
            height="144" 
            fill="#f9fafb" 
            rx="4" 
            ry="4"
          />
          
          {/* Плейсхолдер для изображения */}
          <text 
            x={cardWidth / 4} 
            y={cardHeight / 2} 
            fontSize="12" 
            fill="#9ca3af"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.image_url ? 'Изображение' : 'Нет изображения'}
          </text>

          {/* Свойства в левой половине */}
          <rect 
            x="4" 
            y="180" 
            width={cardWidth / 2 - 8} 
            height="60" 
            fill="#f9fafb"
          />
          
          <text 
            x={cardWidth / 4} 
            y="210" 
            fontSize="12" 
            fill={rarityColor}
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.show_detailed_description && card.detailed_description ? 
              card.detailed_description : 
              (card.properties || 'Нет свойств')
            }
          </text>

          {/* Правая половина - описание */}
          <rect 
            x={cardWidth / 2 + 4} 
            y="32" 
            width={cardWidth / 2 - 8} 
            height={cardHeight - 40} 
            fill="#f9fafb"
          />
          
          <text 
            x={cardWidth * 3 / 4} 
            y="60" 
            fontSize={card.text_font_size || 14} 
            fill="#374151"
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.description || 'Нет описания'}
          </text>
        </>
      ) : (
        // Стандартный формат
        <>
          {/* Заголовок */}
          <text 
            x={cardWidth / 2} 
            y="24" 
            fontSize={titleFontSize} 
            fill={rarityColor}
            fontWeight="bold"
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.name}
          </text>

          {/* Свойства под заголовком */}
          <text 
            x={cardWidth / 2} 
            y="40" 
            fontSize="12" 
            fill={rarityColor}
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.properties || 'Нет свойств'}
          </text>

          {/* Изображение */}
          <rect 
            x="4" 
            y="48" 
            width={cardWidth - 8} 
            height="144" 
            fill="#f9fafb" 
            rx="4" 
            ry="4"
          />
          
          <text 
            x={cardWidth / 2} 
            y={120} 
            fontSize="12" 
            fill="#9ca3af"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.image_url ? 'Изображение' : 'Нет изображения'}
          </text>

          {/* Описание */}
          <rect 
            x="4" 
            y="196" 
            width={cardWidth - 8} 
            height="60" 
            fill="#f9fafb"
          />
          
          <text 
            x={cardWidth / 2} 
            y="226" 
            fontSize={card.text_font_size || 14} 
            fill="#374151"
            fontFamily="fantasy"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {card.description || 'Нет описания'}
          </text>
        </>
      )}

      {/* Нижняя панель с весом, ценой и номером карты */}
      <rect 
        x="0" 
        y={cardHeight - 24} 
        width={cardWidth} 
        height="24" 
        fill="white" 
        stroke="#e5e7eb" 
        strokeWidth="1"
      />

      {/* Вес */}
      {card.weight && (
        <g>
          <text 
            x="12" 
            y={cardHeight - 8} 
            fontSize="10" 
            fill="#111827"
            fontFamily="fantasy"
            fontWeight="500"
          >
            {formatWeight(card.weight)}
          </text>
          <circle 
            cx="24" 
            cy={cardHeight - 12} 
            r="3" 
            fill="#111827"
          />
        </g>
      )}

      {/* Цена */}
      {card.price && (
        <g>
          <text 
            x="40" 
            y={cardHeight - 8} 
            fontSize="10" 
            fill="#d97706"
            fontFamily="fantasy"
            fontWeight="bold"
          >
            {formatPrice(card.price)}
          </text>
          <circle 
            cx="52" 
            cy={cardHeight - 12} 
            r="3" 
            fill="#d97706"
          />
        </g>
      )}

      {/* Номер карты */}
      <text 
        x={cardWidth - 12} 
        y={cardHeight - 8} 
        fontSize="10" 
        fill="#9ca3af"
        fontFamily="monospace"
        textAnchor="end"
      >
        {card.card_number}
      </text>
    </svg>
  );
};

export default SVGCardPreview;
