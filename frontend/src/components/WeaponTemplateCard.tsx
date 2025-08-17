import React from 'react';
import { WeaponTemplate } from '../types';
import { getPropertyLabel, getWeaponCategoryLabel, getDamageTypeLabel } from '../utils/propertyLabels';
import { renderProperties } from '../utils/propertyIcons';
import { useCardTilt } from '../hooks/useCardTilt';

interface WeaponTemplateCardProps {
  template: WeaponTemplate;
  onClick: () => void;
  className?: string;
}

const WeaponTemplateCard: React.FC<WeaponTemplateCardProps> = ({ template, onClick, className = '' }) => {
  const { cardRef, tiltStyle, handleMouseMove, handleMouseLeave } = useCardTilt();
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
      return `${(price / 1000).toFixed(1)}K зм`;
    }
    return `${price} зм`;
  };

  // Функция форматирования веса
  const formatWeight = (weight: number): string => {
    return `${weight} фнт.`;
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
    if (!description) return 'text-xs';
    
    const length = description.length;
    // Для шаблонов описания теперь короткие, используем стандартные размеры
    if (length > 35) return 'text-[10px]';
    if (length > 25) return 'text-[11px]';
    return 'text-xs';
  };

  const description = generateDescription(template);

  return (
    <div 
      ref={cardRef}
      className={`card-preview bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor()} border-4 ${className} cursor-pointer transition-all duration-300 ease-out transform hover:scale-105 hover:-translate-y-2 hover:shadow-2xl group ${getRarityGlowColor()}`}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={tiltStyle}
    >
      {/* Заголовок */}
      <div className="p-1 text-center border-b border-gray-200">
        <h3 className={getTitleClass()}>
          {template.name}
        </h3>
                            <div className={`${getPropertiesFontSize(template.properties)} font-medium ${getRarityColor()} flex justify-center items-center`}>
                      {renderProperties(template.properties)}
                    </div>
      </div>

      {/* Изображение - без отступов */}
      <div className="flex items-center justify-center min-h-[64px]">
        <img
          src={template.image_path}
          alt={template.name}
          className="max-w-[80%] max-h-[80%] object-contain rounded"
          onError={(e) => {
            // Если изображение не загружается, заменяем на дефолтное
            const target = e.target as HTMLImageElement;
            target.src = '/default_image.png';
          }}
        />
      </div>

      {/* Описание и бонусы */}
      <div className="p-2 bg-gray-50 border-t border-gray-200 flex-1 min-h-[60px] relative overflow-hidden">
        {/* Описание - ограничено 75% при наличии бонусов */}
        <div className="w-[75%]">
          <p className={`text-gray-700 leading-relaxed font-fantasy ${getDescriptionFontSize(description)}`}>
            {description}
          </p>
        </div>
        
        {/* Бонусы - абсолютно позиционированные справа */}
        <>
          {/* Разделительная линия - доходит до нижней панели */}
          <div className="absolute right-[25%] top-0 bottom-0 w-px bg-gray-300"></div>
          
          {/* Бонусы - центрированы в блоке описания */}
          <div className="absolute right-0 top-0 bottom-0 w-[25%] flex flex-col justify-center items-center space-y-0.5">
            <div className="text-[9px] text-gray-900 font-fantasy font-medium leading-none">
              {getBonusShortName('damage')}
            </div>
            <div className="text-[11px] font-fantasy font-bold text-gray-900 leading-none">
              {getBonusShortValue(template.damage)}
            </div>
            {/* Тип урона для оружия */}
            <div className="text-[8px] text-gray-600 font-fantasy leading-none">
              {getDamageTypeLabel(template.damage_type)}
            </div>
          </div>
        </>
      </div>

      {/* Вес, цена и номер карточки - абсолютно позиционированные */}
      <div className="absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-between pointer-events-none z-10 bg-white">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-gray-900 font-fantasy font-medium">
            {formatWeight(template.weight)}
          </span>
          <span className="text-[10px] text-yellow-600 font-fantasy font-bold">
            {formatPrice(template.price)}
          </span>
        </div>
        <span className="text-[10px] text-gray-400 font-mono">
          TEMPLATE
        </span>
      </div>
    </div>
  );
};

export default WeaponTemplateCard;
