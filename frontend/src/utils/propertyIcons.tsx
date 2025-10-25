import React from 'react';

// Маппинг свойств на иконки
export const PROPERTY_ICONS: Record<string, string> = {
  'consumable': '/icons/consumable.png?v=1',
  'single_use': '/icons/single_use.png?v=1',
  'light': '/icons/light.png?v=1',
  'heavy': '/icons/heavy.png?v=1',
  'finesse': '/icons/finesse.png?v=1',
  'thrown': '/icons/thrown.png?v=1',
  'versatile': '/icons/versatile.png?v=1',
  'two-handed': '/icons/two_handed.png?v=1',
  'reach': '/icons/reach.png?v=1',
  'ammunition': '/icons/ammunition.png?v=1',
  'loading': '/icons/loading.png?v=1',
  'special': '/icons/special.png?v=1',
  'shield': '/icons/shield.png?v=1',
  'ring': '/icons/ring.png?v=1',
  'necklace': '/icons/necklace.png?v=1',
  'cloak': '/icons/cloak.png?v=1',
};

// Функция для определения, когда показывать иконки вместо текста
export const shouldShowIcons = (properties: string[], isExtended: boolean = false): boolean => {
  // Для обычных карточек - если больше 2 свойств
  // Для расширенных карточек - если больше 3 свойств
  const maxProperties = isExtended ? 3 : 2;
  return properties.length > maxProperties;
};

// Функция для получения иконки свойства
export const getPropertyIcon = (property: string): string => {
  return PROPERTY_ICONS[property] || property; // Возвращаем название свойства, если иконки нет
};

// Функция для отображения свойств с иконками (VERSION 7)
export const renderProperties = (properties: string[], isExtended: boolean = false): JSX.Element => {
  console.log('renderProperties VERSION 7 called with:', properties, 'length:', properties.length, 'isExtended:', isExtended);
  console.log('Properties type:', typeof properties, 'isArray:', Array.isArray(properties));
  console.log('Properties content:', JSON.stringify(properties));
  
  // Если свойств нет или они пустые, показываем пустую строку
  if (!properties || properties.length === 0) {
    return <span className="text-center w-full text-gray-400">Нет свойств</span>;
  }
  
  // Обрабатываем случай, когда properties приходит как массив строк с JSON
  let cleanProperties = properties;
  if (properties.length === 1 && properties[0].startsWith('[')) {
    try {
      // Пытаемся распарсить JSON из первой строки
      const parsed = JSON.parse(properties[0]);
      if (Array.isArray(parsed)) {
        cleanProperties = parsed;
      }
    } catch (e) {
      console.error('Failed to parse properties JSON:', e);
    }
  }
  
  // Определяем, нужно ли показывать иконки
  const shouldUseIcons = shouldShowIcons(cleanProperties, isExtended);
  
  // Если не нужно показывать иконки, показываем как текст
  if (!shouldUseIcons) {
    if (isExtended) {
      // Для расширенных карт - по одной на строку без точек
      return (
        <div className="flex flex-col items-center justify-center space-y-1 w-full">
          {cleanProperties.map((property, index) => (
            <span key={index} className="text-center font-fantasy text-xs">
              {getPropertyLabel(property)}
            </span>
          ))}
        </div>
      );
    } else {
      // Для обычных карт - в одну строку с точками
      return (
        <div className="flex items-center justify-center space-x-1 w-full">
          {cleanProperties.map((property, index) => (
            <span key={index} className="text-center font-fantasy text-xs">
              {getPropertyLabel(property)}
              {index < cleanProperties.length - 1 && <span className="mx-1">•</span>}
            </span>
          ))}
        </div>
      );
    }
  }
  
  // Если несколько свойств и нужно показывать иконки
  return (
    <div className="flex items-center justify-center space-x-1 w-full">
      {cleanProperties.map((property, index) => {
        const iconPath = getPropertyIcon(property);
        const isImage = iconPath.startsWith('/');
        
        return (
          <span key={index} className="inline-flex items-center justify-center" title={getPropertyLabel(property)}>
            {isImage ? (
              <img 
                src={iconPath} 
                alt={getPropertyLabel(property)}
                className="w-4 h-4 object-contain"
                onLoad={() => console.log('Icon loaded successfully:', iconPath)}
                onError={(e) => {
                  console.error('Failed to load icon:', iconPath, 'for property:', property);
                  // Если изображение не загрузилось, показываем текст свойства
                  e.currentTarget.style.display = 'none';
                  const errorSpan = document.createElement('span');
                  errorSpan.textContent = getPropertyLabel(property);
                  errorSpan.className = 'text-xs font-fantasy font-medium';
                  e.currentTarget.parentNode?.appendChild(errorSpan);
                }}
              />
            ) : (
              <span className="text-xs font-fantasy font-medium">{getPropertyLabel(property)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
};

// Импортируем функцию перевода из propertyLabels
import { getPropertyLabel } from './propertyLabels';
