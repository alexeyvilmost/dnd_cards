import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import { getPropertyLabel } from '../utils/propertyLabels';
import { renderProperties } from '../utils/propertyIcons';
import { getRarityColor } from '../utils/rarityColors';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';

// Функция для получения значения цвета редкости для inline стилей
const getRarityColorValue = (rarity: string) => {
  switch (rarity) {
    case 'common':
      return '#6b7280'; // gray-500
    case 'uncommon':
      return '#10b981'; // emerald-500
    case 'rare':
      return '#3b82f6'; // blue-500
    case 'epic':
      return '#8b5cf6'; // violet-500
    case 'legendary':
      return '#f59e0b'; // amber-500
    default:
      return '#6b7280';
  }
};

interface CardPreviewProps {
  card: Card;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const CardPreview = ({ card, className = '', disableHover = false, onClick }: CardPreviewProps) => {
  const rarityOption = RARITY_OPTIONS.find(option => option.value === card.rarity);
  // Для совместимости с одним свойством и массивом свойств
  const propertiesArray = Array.isArray(card.properties) ? card.properties : (card.properties ? [card.properties] : []);
  const propertiesLabels = propertiesArray.map(prop => {
    const option = PROPERTIES_OPTIONS.find(opt => opt.value === prop);
    return option?.label || prop;
  }).join(', ');
  const isLarge = className.includes('card-preview-large');
  const isExtended = Boolean(card.is_extended);

  // Функция для определения размера шрифта заголовка
  const getTitleFontSize = (title: string) => {
    if (isExtended) {
      // Для расширенных карт используем больший шрифт
      if (title.length > 20) return 'text-lg';
      if (title.length > 15) return 'text-xl';
      return 'text-xl';
    } else {
      // Для обычных карт используем стандартный размер
      if (title.length > 20) return 'text-xs';
      if (title.length > 15) return 'text-sm';
      return 'text-sm';
    }
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

  // Функция для получения класса заголовка в зависимости от редкости
  const getTitleClass = (rarity: string, name: string) => {
    const baseClass = `${getTitleFontSize(name)} font-fantasy font-bold leading-tight mb-0.5 min-h-[1.2rem] flex items-center justify-center`;
    const rarityColor = getRarityColor(rarity);
    
    switch (rarity) {
      case 'very_rare': return `${baseClass} title-gradient-very-rare`;
      case 'artifact': return `${baseClass} title-gradient-artifact`;
      default: return `${baseClass} ${rarityColor}`;
    }
  };

  // Функция для получения цвета номера карты в зависимости от наличия эффектов
  const getCardNumberColor = (card: Card) => {
    const hasEffects = card.effects && Array.isArray(card.effects) && card.effects.length > 0;
    return hasEffects ? 'text-gray-900' : 'text-gray-400';
  };

  // Функция для получения класса усиленного свечения
  const getEnhancedGlowClass = (rarity: string) => {
    switch (rarity) {
      case 'very_rare': return 'hover:glow-very-rare';
      case 'artifact': return 'hover:glow-artifact';
      default: return '';
    }
  };

  // Функция форматирования цены
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return `${price}`;
  };

  // Функция форматирования веса
  const formatWeight = (weight: number): string => {
    return `${weight}`;
  };

  // Функция для определения размера шрифта описания
  const getDescriptionFontSize = (description: string): string => {
    return 'text-sm';
  };

  // Функция для получения сокращенного названия бонуса
  const getBonusShortName = (bonusType: string): string => {
    switch (bonusType) {
      case 'damage': return 'УРОН';
      case 'defense': return 'ЗАЩ';
      default: return bonusType.toUpperCase();
    }
  };

  // Функция для получения сокращенного значения бонуса
  const getBonusShortValue = (bonusValue: string): string => {
    if (bonusValue.toLowerCase() === 'advantage') return 'ADV';
    return bonusValue;
  };

  // Функция для получения типа урона из поля damage_type
  const getDamageTypeLabel = (damageType: string): string => {
    switch (damageType) {
      case 'piercing': return 'колющий';
      case 'slashing': return 'рубящий';
      case 'bludgeoning': return 'дробящий';
      default: return '';
    }
  };

  // Функция для получения типа защиты из поля defense_type
  const getDefenseTypeLabel = (defenseType: string): string => {
    switch (defenseType) {
      case 'cloth': return 'тканевая';
      case 'light': return 'легкая';
      case 'medium': return 'средняя';
      case 'heavy': return 'тяжелая';
      default: return '';
    }
  };

  // Функция для отображения иконок защиты
  const renderDefenseIcons = (defenseType: string) => {
    switch (defenseType) {
      case 'cloth':
        return <img src="/icons/cloth.png" alt="Тканевая броня" className="w-3 h-3" />;
      case 'light':
        return <img src="/icons/defense.png" alt="Легкая броня" className="w-3 h-3" />;
      case 'medium':
        return (
          <div className="flex space-x-0">
            <img src="/icons/defense.png" alt="Средняя броня" className="w-3 h-3" />
            <img src="/icons/defense.png" alt="Средняя броня" className="w-3 h-3" />
          </div>
        );
      case 'heavy':
        return (
          <div className="flex space-x-0">
            <img src="/icons/defense.png" alt="Тяжелая броня" className="w-3 h-3" />
            <img src="/icons/defense.png" alt="Тяжелая броня" className="w-3 h-3" />
            <img src="/icons/defense.png" alt="Тяжелая броня" className="w-3 h-3" />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div 
      className={`card-preview relative bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor(card.rarity)} border-4 ${className} transition-all duration-300 ease-out group ${getRarityGlowColor(card.rarity)} ${getEnhancedGlowClass(card.rarity)} ${isExtended ? 'w-[397px] h-[280px]' : 'w-[198px] h-[280px]'} ${!disableHover && className.includes('card-preview-large') ? '' : !disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} flex flex-col ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Метка редкости для слабовидящих */}
      <div className="absolute top-0.5 left-1 text-sm font-bold select-none">
        <span 
          title={getRaritySymbolDescription(card.rarity)}
          aria-label={getRaritySymbolDescription(card.rarity)}
          className={`${getRarityColor(card.rarity)} drop-shadow-lg`}
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}
        >
          {getRaritySymbol(card.rarity)}
        </span>
      </div>
      {isExtended ? (
        // Расширенный формат для карт с большим описанием
        <>
          {/* Основной контент - горизонтальная компоновка */}
          <div className="flex flex-1">
            {/* Левая половина - заголовок, изображение, свойства и бонусы */}
            <div className="w-1/2 flex flex-col">
              {/* Заголовок только над левой половиной */}
              <div className="px-1 py-0.5 text-center">
                <h3 className={getTitleClass(card.rarity, card.name)}>
                  {card.name}
                </h3>
              </div>

              {/* Изображение - стандартный размер */}
              <div className="flex items-center justify-center w-full h-36">
                {card.image_url && card.image_url.trim() !== '' ? (
                  <img
                    src={card.image_url}
                    alt={card.name}
                    className="w-full h-full object-contain rounded"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/default_image.png';
                    }}
                  />
                ) : (
                  <img
                    src="/default_image.png"
                    alt="Default D&D"
                    className="w-full h-full object-contain rounded"
                  />
                )}
              </div>

              {/* Свойства */}
              <div className="px-2 pt-0 pb-2 bg-gray-50 flex-1 min-h-[60px] relative overflow-hidden">
                <div className="w-full">
                  {card.show_detailed_description && card.detailed_description && card.detailed_description.trim() !== '' ? (
                    <div 
                      className={`text-xs font-fantasy whitespace-pre-wrap`}
                      style={{
                        fontSize: card.detailed_description_font_size ? `${card.detailed_description_font_size}px` : '12px',
                        textAlign: card.detailed_description_alignment || 'left',
                        color: getRarityColorValue(card.rarity)
                      }}
                    >
                      {card.detailed_description}
                    </div>
                  ) : (
                    <div className={`text-xs font-medium ${getRarityColor(card.rarity)} flex justify-center items-center whitespace-pre-wrap`}>
                      {(() => {
                        return renderProperties(propertiesArray, Boolean(isExtended));
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Правая половина - только описание */}
            <div className="w-1/2 p-2 bg-gray-50 border-l border-gray-200 flex flex-col min-h-[280px]">
              {/* Описание и детальное описание */}
              <div className="flex-1 overflow-hidden flex flex-col justify-start pt-2 space-y-2">
                {/* Основное описание */}
                <p 
                  className={`text-gray-700 leading-tight font-fantasy whitespace-pre-wrap`} 
                  style={{ 
                    fontSize: card.text_font_size ? `${card.text_font_size}px` : 
                            card.description_font_size ? `${card.description_font_size}px` : 
                            getDescriptionFontSize(card.description || '') === 'text-sm' ? '14px' : 
                            getDescriptionFontSize(card.description || '').replace('text-[', '').replace('px]', 'px'),
                    textAlign: card.text_alignment || 'center'
                  }}
                >
                  {card.description || 'Нет описания'}
                </p>
                
              </div>
            </div>
          </div>

          {/* Вес, цена, бонусы и номер карточки - абсолютно позиционированные */}
          <div className="absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-between pointer-events-none z-10 bg-white border-t border-gray-200">
            <div className="flex items-center space-x-2">
              {card.weight && (
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-gray-900 font-fantasy font-medium">
                    {formatWeight(card.weight)}
                  </span>
                  <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                </div>
              )}
              {card.price && (
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-yellow-600 font-fantasy font-bold">
                    {formatPrice(card.price)}
                  </span>
                  <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                </div>
              )}
              {card.bonus_type && card.bonus_value && (
                <div className="flex items-center space-x-0.5">
                  <span className="text-[10px] text-gray-900 font-fantasy font-medium">
                    {getBonusShortValue(card.bonus_value)}
                  </span>
                  {card.bonus_type === 'damage' && card.damage_type && (
                    <img src={`/icons/${card.damage_type}.png`} alt={getDamageTypeLabel(card.damage_type)} className="w-3 h-3" />
                  )}
                  {card.bonus_type === 'defense' && card.defense_type && (
                    renderDefenseIcons(card.defense_type)
                  )}
                  {card.bonus_type === 'defense' && card.type === 'щит' && (
                    <img src="/icons/defense.png" alt="Защита" className="w-3 h-3" />
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <span className={`text-[10px] ${getCardNumberColor(card)} font-mono`}>
                {card.card_number}
              </span>
            </div>
          </div>
        </>
      ) : (
        // Стандартный формат
        <>
          {/* Заголовок */}
          <div className="px-1 py-0.5 text-center">
            <h3 className={getTitleClass(card.rarity, card.name)}>
              {card.name}
            </h3>
            <div className={`text-xs font-medium ${getRarityColor(card.rarity)} flex justify-center items-center whitespace-pre-wrap`}>
              {(() => {
                return renderProperties(propertiesArray, Boolean(isExtended));
              })()}
            </div>
          </div>

          {/* Изображение - без отступов */}
          <div className="flex items-center justify-center h-36">
            {card.image_url && card.image_url.trim() !== '' ? (
              <img
                src={card.image_url}
                alt={card.name}
                className="w-full h-full object-contain rounded"
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
                className="w-full h-full object-contain rounded"
              />
            )}
          </div>

          {/* Описание */}
          <div className="px-1 pt-2 pb-8 bg-gray-50 flex-1 relative overflow-hidden flex flex-col justify-start">
            <p 
              className={`text-gray-700 leading-tight font-fantasy whitespace-pre-wrap`}
              style={{ 
                fontSize: card.text_font_size ? `${card.text_font_size}px` : 
                        card.description_font_size ? `${card.description_font_size}px` : 
                        getDescriptionFontSize(card.description || '') === 'text-sm' ? '14px' : 
                        getDescriptionFontSize(card.description || '').replace('text-[', '').replace('px]', 'px'),
                textAlign: card.text_alignment || 'center'
              }}
            >
              {card.description || 'Нет описания'}
            </p>
          </div>

          {/* Вес, цена, бонусы и номер карточки - приклеены к низу */}
          <div className="flex items-center justify-between pointer-events-none z-10 bg-white border-t border-gray-200 p-1">
            <div className="flex items-center space-x-2">
              {card.weight && (
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-gray-900 font-fantasy font-medium">
                    {formatWeight(card.weight)}
                  </span>
                  <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                </div>
              )}
              {card.price && (
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-yellow-600 font-fantasy font-bold">
                    {formatPrice(card.price)}
                  </span>
                  <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                </div>
              )}
              {card.bonus_type && card.bonus_value && (
                <div className="flex items-center space-x-0.5">
                  <span className="text-[10px] text-gray-900 font-fantasy font-medium">
                    {getBonusShortValue(card.bonus_value)}
                  </span>
                  {card.bonus_type === 'damage' && card.damage_type && (
                    <img src={`/icons/${card.damage_type}.png`} alt={getDamageTypeLabel(card.damage_type)} className="w-3 h-3" />
                  )}
                  {card.bonus_type === 'defense' && card.defense_type && (
                    renderDefenseIcons(card.defense_type)
                  )}
                  {card.bonus_type === 'defense' && card.type === 'щит' && (
                    <img src="/icons/defense.png" alt="Защита" className="w-3 h-3" />
                  )}
                </div>
              )}
            </div>
            <span className={`text-[10px] ${getCardNumberColor(card)} font-mono`}>
              {card.card_number}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default CardPreview;
