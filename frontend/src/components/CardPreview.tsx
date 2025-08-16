import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';

interface CardPreviewProps {
  card: Card;
  className?: string;
}

const CardPreview = ({ card, className = '' }: CardPreviewProps) => {
  const rarityOption = RARITY_OPTIONS.find(option => option.value === card.rarity);
  const propertiesOption = PROPERTIES_OPTIONS.find(option => option.value === card.properties);

  // Функция для определения размера шрифта заголовка
  const getTitleFontSize = (title: string) => {
    if (title.length > 20) return 'text-xs';
    if (title.length > 15) return 'text-sm';
    return 'text-sm';
  };

  const getBorderColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'border-white';
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

  return (
    <div className={`card-preview bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor(card.rarity)} border-4 ${className}`}>
      {/* Заголовок */}
      <div className="p-1 text-center border-b border-gray-200">
        <h3 className={`${getTitleFontSize(card.name)} font-bold text-gray-900 leading-tight mb-0.5 min-h-[1.2rem] flex items-center justify-center`}>
          {card.name}
        </h3>
        <div className={`text-xs font-medium ${getRarityColor(card.rarity)}`}>
          {propertiesOption?.label || ''}
        </div>
      </div>

      {/* Изображение - фиксированный размер 80% */}
      <div className="p-2 flex items-center justify-center min-h-[64px]">
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

      {/* Описание */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 flex-1 min-h-[60px]">
        <p className="text-xs text-gray-700 leading-relaxed">
          {card.description || 'Нет описания'}
        </p>
      </div>

      {/* Номер карточки */}
      <div className="absolute bottom-1 right-1">
        <span className="text-xs text-gray-400 font-mono">
          {card.card_number}
        </span>
      </div>
    </div>
  );
};

export default CardPreview;
