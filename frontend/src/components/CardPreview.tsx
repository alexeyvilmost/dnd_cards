import type { Card } from '../types';
import { FormattedText } from '../utils/formattedText';
import { renderProperties } from '../utils/propertyIcons';
import CardBottomPanel from './CardBottomPanel';
import { getCardBorderWrapperStyle } from '../utils/cardStyles';
import { getCardDescriptionFontSize } from '../utils/cardTextStyles';
import { getEffectiveRarityColor } from '../utils/rarityVisuals';

// Функция для получения значения цвета редкости для inline стилей
interface CardPreviewProps {
  card: Card;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const CardPreview = ({ card, className = '', disableHover = false, onClick }: CardPreviewProps) => {
  // Для совместимости с одним свойством и массивом свойств
  const propertiesArray = (Array.isArray(card.properties) ? card.properties : (card.properties ? [card.properties] : []))
    .filter((property) => typeof property === 'string' && property.trim() !== '');
  const hasProperties = propertiesArray.length > 0;
  const hasDetailedDescription = Boolean(card.show_detailed_description && card.detailed_description?.trim());
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

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-orange-600';
      case 'relic': return 'text-red-600';
      case 'custom': return '';
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
      case 'relic': return 'group-hover:shadow-red-400/50';
      case 'custom': return 'group-hover:shadow-red-400/40';
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
      case 'relic': return `${baseClass} ${rarityColor}`;
      case 'custom': return `${baseClass}`;
      default: return `${baseClass} ${rarityColor}`;
    }
  };

  // Функция для получения класса усиленного свечения
  const getEnhancedGlowClass = (rarity: string) => {
    switch (rarity) {
      case 'very_rare': return 'hover:glow-very-rare';
      case 'artifact': return 'hover:glow-artifact';
      case 'relic': return 'hover:glow-relic';
      default: return '';
    }
  };

  const getTitleStyle = (rarity: string): React.CSSProperties | undefined => {
    if (rarity === 'custom' && card.custom_rarity_color) {
      return { color: card.custom_rarity_color };
    }
    return undefined;
  };

  return (
    <div
      className={`card-preview rounded-lg shadow-md ${className} transition-all duration-300 ease-out group ${getRarityGlowColor(card.rarity)} ${getEnhancedGlowClass(card.rarity)} ${isExtended ? 'w-[396px] h-[280px]' : 'w-[198px] h-[280px]'} ${!disableHover && className.includes('card-preview-large') ? '' : !disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      style={getCardBorderWrapperStyle(card.rarity, card.custom_rarity_color)}
      onClick={onClick}
    >
      <div className="relative bg-white rounded-[6px] overflow-hidden flex flex-col h-full w-full">
      {/* Значок необходимости настройки */}
      {card.requires_attunement && (
        <div className="absolute top-1 right-1 select-none z-10">
          <img
            src="/icons/attunement.png"
            alt="Требуется настройка"
            title="Требуется настройка"
            className="w-4 h-4"
          />
        </div>
      )}
      {isExtended ? (
        // Расширенный формат для карт с большим описанием
        <>
          {/* Основной контент - горизонтальная компоновка */}
          <div className="flex flex-1">
            {/* Левая половина - заголовок, изображение, свойства и бонусы */}
            <div className="w-1/2 min-w-0 flex flex-col">
              {/* Заголовок только над левой половиной */}
              <div className="px-1 py-0.5 text-center">
                <h3 className={getTitleClass(card.rarity, card.name)} style={getTitleStyle(card.rarity)}>
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

              {(hasProperties || hasDetailedDescription) && (
                <div className="px-2 pt-0 pb-2 bg-gray-50 flex-1 min-h-[60px] relative overflow-hidden">
                  <div className="w-full">
                    {card.show_detailed_description && card.detailed_description && card.detailed_description.trim() !== '' ? (
                      <div
                        className="text-xs font-fantasy whitespace-pre-wrap"
                        style={{
                          fontSize: card.detailed_description_font_size ? `${card.detailed_description_font_size}px` : '12px',
                          textAlign: (card.detailed_description_alignment || 'left') as React.CSSProperties['textAlign'],
                          color: getEffectiveRarityColor(card.rarity, card.custom_rarity_color)
                        }}
                      >
                        {card.detailed_description}
                      </div>
                    ) : (
                      <div className={`text-xs font-medium ${getRarityColor(card.rarity)} flex justify-center items-center whitespace-pre-wrap`}>
                        {renderProperties(propertiesArray, Boolean(isExtended))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Правая половина - только описание */}
            <div className="w-1/2 min-w-0 p-2 bg-gray-50 border-l border-gray-200 flex flex-col min-h-[280px]">
              {/* Описание и детальное описание */}
              <div className="flex-1 overflow-hidden flex flex-col justify-start pt-2 space-y-2">
                {/* Основное описание */}
                <p 
                  className={`text-gray-700 leading-tight font-fantasy whitespace-pre-wrap`} 
                  style={{
                    fontSize: getCardDescriptionFontSize(card),
                    textAlign: (card.text_alignment || 'center') as React.CSSProperties['textAlign']
                  }}
                >
                  <FormattedText text={card.description || ''} />
                </p>
                
              </div>
            </div>
          </div>

          <CardBottomPanel card={card} variant="absolute" />
        </>
      ) : (
        // Стандартный формат
        <>
          {/* Заголовок */}
          <div className="px-1 py-0.5 text-center">
            <h3 className={getTitleClass(card.rarity, card.name)} style={getTitleStyle(card.rarity)}>
              {card.name}
            </h3>
            {hasProperties && (
              <div className={`text-xs font-medium ${getRarityColor(card.rarity)} flex justify-center items-center whitespace-pre-wrap`}>
                {renderProperties(propertiesArray, Boolean(isExtended))}
              </div>
            )}
          </div>

          {/* Изображение - без отступов */}
          <div className="flex items-center justify-center w-full h-36">
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
                fontSize: getCardDescriptionFontSize(card),
                textAlign: (card.text_alignment || 'center') as React.CSSProperties['textAlign']
              }}
            >
              <FormattedText text={card.description || ''} />
            </p>
          </div>

          <CardBottomPanel card={card} variant="flow" />
        </>
      )}
      </div>
    </div>
  );
};

export default CardPreview;
