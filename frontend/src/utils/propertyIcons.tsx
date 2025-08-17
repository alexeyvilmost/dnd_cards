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
};

// Функция для определения, когда показывать иконки вместо текста
export const shouldShowIcons = (properties: string[], maxTextLength: number = 15): boolean => {
  // Принудительно показываем иконки для всех карточек с несколькими свойствами
  return properties.length > 1;
};

// Функция для получения иконки свойства
export const getPropertyIcon = (property: string): string => {
  return PROPERTY_ICONS[property] || property; // Возвращаем название свойства, если иконки нет
};

// Функция для отображения свойств с иконками (VERSION 4)
export const renderProperties = (properties: string[], maxTextLength: number = 30): JSX.Element => {
  console.log('renderProperties VERSION 4 called with:', properties, 'length:', properties.length);
  
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
  
  // Если только одно свойство, показываем его как текст
  if (cleanProperties.length === 1) {
    return (
      <span className="text-center w-full">
        {getPropertyLabel(cleanProperties[0])}
      </span>
    );
  }
  
  // Если несколько свойств, показываем иконки
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
                  errorSpan.className = 'text-xs font-medium';
                  e.currentTarget.parentNode?.appendChild(errorSpan);
                }}
              />
            ) : (
              <span className="text-xs font-medium">{getPropertyLabel(property)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
};

// Импортируем функцию перевода из propertyLabels
import { getPropertyLabel } from './propertyLabels';
