import React from 'react';
import { WeaponTemplate } from '../types';
import { getPropertyLabel, getWeaponCategoryLabel, getDamageTypeLabel } from '../utils/propertyLabels';
import { renderProperties } from '../utils/propertyIcons';

interface WeaponTemplateCardProps {
  template: WeaponTemplate;
  onClick: () => void;
  className?: string;
}

const WeaponTemplateCard: React.FC<WeaponTemplateCardProps> = ({ template, onClick, className = '' }) => {
  // Функция для определения размера шрифта заголовка
  const getTitleFontSize = (title: string) => {
    if (title.length > 20) return 'text-xs';
    if (title.length > 15) return 'text-sm';
    return 'text-sm';
  };

  // Функция для определения размера шрифта свойств
  const getPropertiesFontSize = (properties: string[]) => {
    const text = properties.map(p => getPropertyLabel(p)).join(', ');
    if (text.length > 40) return 'text-[8px]';
    if (text.length > 30) return 'text-[9px]';
    if (text.length > 20) return 'text-[10px]';
    return 'text-xs';
  };

  // Функция для получения цвета обводки (все шаблоны - обычные)
  const getBorderColor = () => 'border-gray-400';

  // Функция для получения цвета редкости
  const getRarityColor = () => 'text-gray-600';

  const getRarityGlowColor = () => {
    // Для шаблонов оружия используем серое свечение
    return 'group-hover:shadow-gray-400/50';
  };

  // Функция для получения класса заголовка (шаблоны всегда обычные)
  const getTitleClass = () => {
    return `${getTitleFontSize(template.name)} font-fantasy font-bold text-gray-900 leading-tight mb-0.5 min-h-[1.2rem] flex items-center justify-center`;
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



  // Функция для получения типа урона из поля damage_type
  const getDamageTypeLabel = (damageType: string): string => {
    switch (damageType) {
      case 'piercing': return 'колющий';
      case 'slashing': return 'рубящий';
      case 'bludgeoning': return 'дробящий';
      default: return '';
    }
  };

  // Генерируем описание для шаблона
  const generateDescription = (template: WeaponTemplate): string => {
    return `${template.name} - это ${getWeaponCategoryLabel(template.category)} оружие.`;
  };

  // Функция для определения размера шрифта описания
  const getDescriptionFontSize = (description: string): string => {
    return 'text-sm';
  };

  const description = generateDescription(template);

  return (
    <div 
      className={`card-preview bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor()} border-4 ${className} cursor-pointer transition-all duration-300 ease-out transform hover:scale-105 hover:-translate-y-2 hover:shadow-2xl group ${getRarityGlowColor()} flex flex-col`}
      onClick={onClick}
    >
      {/* Заголовок */}
      <div className="px-1 py-0.5 text-center">
        <h3 className={getTitleClass()}>
          {template.name}
        </h3>
                            <div className={`${getPropertiesFontSize(template.properties)} font-medium ${getRarityColor()} flex justify-center items-center`}>
                      {renderProperties(template.properties)}
                    </div>
      </div>

      {/* Изображение - без отступов */}
      <div className="flex items-center justify-center h-36">
        <img
          src={template.image_cloudinary_url || template.image_path || '/default_image.png'}
          alt={template.name}
          className="w-full h-full object-contain rounded"
          onError={(e) => {
            // Если изображение не загружается, заменяем на дефолтное
            const target = e.target as HTMLImageElement;
            target.src = '/default_image.png';
          }}
        />
      </div>

      {/* Описание */}
      <div className="px-2 pt-0 pb-8 bg-gray-50 flex-1 min-h-[60px] relative overflow-hidden">
        <div className="w-full">
          <p 
            className={`text-gray-700 leading-relaxed font-fantasy`}
            style={{ 
              fontSize: template.description_font_size ? `${template.description_font_size}px` : 
                      getDescriptionFontSize(description) === 'text-sm' ? '14px' : 
                      getDescriptionFontSize(description).replace('text-[', '').replace('px]', 'px')
            }}
          >
            {description}
          </p>
        </div>
      </div>

      {/* Вес, цена, бонусы и номер карточки - приклеены к низу */}
      <div className="flex items-center justify-between pointer-events-none z-10 bg-white border-t border-gray-200 p-1">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <span className="text-[10px] text-gray-900 font-fantasy font-medium">
              {formatWeight(template.weight)}
            </span>
            <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
          </div>
          <div className="flex items-center space-x-1">
            <span className="text-[10px] text-yellow-600 font-fantasy font-bold">
              {formatPrice(template.price)}
            </span>
            <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
          </div>
          <div className="flex items-center space-x-0.5">
            <span className="text-[10px] text-gray-900 font-fantasy font-medium">
              {getBonusShortValue(template.damage)}
            </span>
            <img src={`/icons/${template.damage_type}.png`} alt={getDamageTypeLabel(template.damage_type)} className="w-3 h-3" />
          </div>
        </div>
        <span className="text-[10px] text-gray-400 font-mono">
          TEMPLATE
        </span>
      </div>
    </div>
  );
};

export default WeaponTemplateCard;
