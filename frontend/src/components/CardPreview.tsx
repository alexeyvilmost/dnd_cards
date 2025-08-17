import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import { getPropertyLabel } from '../utils/propertyLabels';
import { renderProperties } from '../utils/propertyIcons';
import { useCardTilt } from '../hooks/useCardTilt';

interface CardPreviewProps {
  card: Card;
  className?: string;
}

const CardPreview = ({ card, className = '' }: CardPreviewProps) => {
  console.log('CardPreview component rendered for card:', card.name);
  const rarityOption = RARITY_OPTIONS.find(option => option.value === card.rarity);
  // Для совместимости с одним свойством и массивом свойств
  const propertiesArray = Array.isArray(card.properties) ? card.properties : (card.properties ? [card.properties] : []);
  console.log('CardPreview - card.properties:', card.properties);
  console.log('CardPreview - propertiesArray:', propertiesArray);
  const propertiesLabels = propertiesArray.map(prop => {
    const option = PROPERTIES_OPTIONS.find(opt => opt.value === prop);
    return option?.label || prop;
  }).join(', ');
  const { cardRef, tiltStyle, handleMouseMove, handleMouseLeave } = useCardTilt();

  // Функция для определения размера шрифта заголовка
  const getTitleFontSize = (title: string) => {
    if (title.length > 20) return 'text-xs';
    if (title.length > 15) return 'text-sm';
    return 'text-sm';
  };

  const getBorderColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'border-gray-400';
      case 'uncommon': return 'border-green-500';
      case 'rare': return 'border-blue-500';
      case 'very_rare': return 'border-purple-500';
      case 'artifact': return 'border-orange-500';
      default: return 'border-gray-300';
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getRarityGlowColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'group-hover:shadow-gray-400/50';
      case 'uncommon': return 'group-hover:shadow-green-400/50';
      case 'rare': return 'group-hover:shadow-blue-400/50';
      case 'very_rare': return 'group-hover:shadow-purple-400/50';
      case 'artifact': return 'group-hover:shadow-orange-400/50';
      default: return 'group-hover:shadow-gray-400/50';
    }
  };

  // Функция форматирования цены
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return price.toString();
  };

  // Функция форматирования веса
  const formatWeight = (weight: number): string => {
    return `${weight} фнт.`;
  };

  // Функция для определения размера шрифта описания
  const getDescriptionFontSize = (description: string): string => {
    if (!description) return 'text-xs';
    
    const length = description.length;
    const hasBonus = card.bonus_type && card.bonus_value;
    
    // Если есть бонус, уменьшаем шрифт намного раньше
    if (hasBonus) {
      if (length > 50) return 'text-[8px]';
      if (length > 35) return 'text-[9px]';
      if (length > 25) return 'text-[10px]';
      return 'text-xs';
    }
    
    // Если нет бонуса, используем стандартные размеры
    if (length > 70) return 'text-[9px]';
    if (length > 50) return 'text-[10px]';
    if (length > 35) return 'text-[11px]';
    return 'text-xs';
  };

  // Функция для получения сокращенного названия бонуса
  const getBonusShortName = (bonusType: string): string => {
    switch (bonusType) {
      case 'damage': return 'УРОН';
      case 'defense': return 'ЗАЩ';
      case 'attack': return 'АТК';
      case 'armor_class': return 'КБ';
      case 'initiative': return 'ИНИ';
      case 'stealth': return 'СКР';
      case 'strength': return 'СИЛ';
      case 'dexterity': return 'ЛОВ';
      case 'constitution': return 'ТЕЛ';
      case 'intelligence': return 'ИНТ';
      case 'wisdom': return 'МДР';
      case 'charisma': return 'ХАР';
      default: return bonusType.toUpperCase();
    }
  };

  // Функция для получения сокращенного значения бонуса
  const getBonusShortValue = (bonusValue: string): string => {
    if (bonusValue.toLowerCase() === 'advantage') return 'ADV';
    return bonusValue;
  };

  // Функция для извлечения типа урона из описания
  const getDamageTypeFromDescription = (description: string): string => {
    if (description.includes('колющий')) return 'колющий';
    if (description.includes('рубящий')) return 'рубящий';
    if (description.includes('дробящий')) return 'дробящий';
    return '';
  };

  return (
    <div 
      ref={cardRef}
      className={`card-preview bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor(card.rarity)} border-4 ${className} transition-all duration-300 ease-out transform hover:scale-105 hover:-translate-y-2 hover:shadow-2xl group ${getRarityGlowColor(card.rarity)}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={tiltStyle}
    >
      {/* Заголовок */}
      <div className="p-1 text-center border-b border-gray-200">
        <h3 className={`${getTitleFontSize(card.name)} font-bold text-gray-900 leading-tight mb-0.5 min-h-[1.2rem] flex items-center justify-center`}>
          {card.name}
        </h3>
        <div className={`text-xs font-medium ${getRarityColor(card.rarity)} flex justify-center items-center`}>
          {(() => {
            console.log('About to call renderProperties for card:', card.name, 'with properties:', propertiesArray);
            return renderProperties(propertiesArray);
          })()}
        </div>
      </div>

      {/* Изображение - без отступов */}
      <div className="flex items-center justify-center min-h-[64px]">
        {card.image_url && card.image_url.trim() !== '' ? (
          <img
            src={card.image_url}
            alt={card.name}
            className="max-w-[80%] max-h-[80%] object-contain rounded"
            onError={(e) => {
              // Если изображение не загружается, заменяем на дефолтное
              const target = e.target as HTMLImageElement;
              target.src = '/default_image.png';
            }}
          />
        ) : (
          <img
            src="/default_image.png"
            alt="Default D&D"
            className="max-w-[80%] max-h-[80%] object-contain rounded"
          />
        )}
      </div>

      {/* Описание и бонусы */}
      <div className="p-2 pb-6 bg-gray-50 border-t border-gray-200 flex-1 min-h-[60px] relative overflow-hidden">
        {/* Описание - ограничено 75% при наличии бонусов */}
        <div className={`${card.bonus_type && card.bonus_value ? 'w-[75%]' : 'w-full'}`}>
          <p className={`text-gray-700 leading-relaxed ${getDescriptionFontSize(card.description)}`}>
            {card.description || 'Нет описания'}
          </p>
        </div>
        
        {/* Бонусы - абсолютно позиционированные справа */}
        {card.bonus_type && card.bonus_value && (
          <>
            {/* Разделительная линия */}
            <div className="absolute right-[25%] top-0 bottom-0 w-px bg-gray-300"></div>
            
            {/* Бонусы */}
            <div className="absolute right-0 top-0 bottom-0 w-[25%] flex flex-col justify-center items-center space-y-0.5">
              <div className="text-[9px] text-gray-900 font-medium leading-none">
                {getBonusShortName(card.bonus_type)}
              </div>
              <div className="text-[11px] font-bold text-gray-900 leading-none">
                {getBonusShortValue(card.bonus_value)}
              </div>
              {/* Тип урона для оружия */}
              {card.bonus_type === 'damage' && (
                <div className="text-[8px] text-gray-600 leading-none">
                  {getDamageTypeFromDescription(card.description)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Вес, цена и номер карточки - абсолютно позиционированные */}
      <div className="absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-between pointer-events-none z-10 bg-white">
        <div className="flex items-center space-x-2">
          {card.weight && (
            <span className="text-[10px] text-gray-900 font-medium">
              {formatWeight(card.weight)}
            </span>
          )}
          {card.price && (
            <span className="text-[10px] text-yellow-600 font-bold">
              {formatPrice(card.price)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400 font-mono">
          {card.card_number}
        </span>
      </div>
    </div>
  );
};

export default CardPreview;
