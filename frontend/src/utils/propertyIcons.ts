import React from 'react';

// Маппинг свойств на иконки
export const PROPERTY_ICONS: Record<string, string> = {
  'consumable': '🧪', // Зелье
  'single_use': '💥', // Взрыв
  'light': '🪶', // Перо
  'heavy': '⚒️', // Молот
  'finesse': '⚔️', // Скрещенные мечи
  'thrown': '🏹', // Лук со стрелой
  'versatile': '🖐️', // Рука
  'two-handed': '🤲', // Две руки
  'reach': '👆', // Указательный палец
  'ammunition': '🏹', // Лук
  'loading': '🎯', // Мишень
  'special': '⭐', // Звезда
};

// Функция для определения, когда показывать иконки вместо текста
export const shouldShowIcons = (properties: string[], maxTextLength: number = 30): boolean => {
  const textLength = properties.map(p => getPropertyLabel(p)).join(', ').length;
  return textLength > maxTextLength;
};

// Функция для получения иконки свойства
export const getPropertyIcon = (property: string): string => {
  return PROPERTY_ICONS[property] || '❓';
};

// Функция для отображения свойств с иконками
export const renderProperties = (properties: string[], maxTextLength: number = 30): React.ReactElement => {
  if (shouldShowIcons(properties, maxTextLength)) {
    return React.createElement('div', { className: 'flex items-center space-x-1' },
      properties.map((property, index) => 
        React.createElement('span', { 
          key: index, 
          className: 'text-lg', 
          title: getPropertyLabel(property) 
        }, getPropertyIcon(property))
      )
    );
  } else {
    return React.createElement('span', {}, 
      properties.map(p => getPropertyLabel(p)).join(', ')
    );
  }
};

// Импортируем функцию перевода из propertyLabels
import { getPropertyLabel } from './propertyLabels';
