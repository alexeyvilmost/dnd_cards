import React, { useEffect } from 'react';
import { X, Edit, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Card } from '../types';
import CardPreview from './CardPreview';

interface CardDetailModalProps {
  card: Card | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (cardId: string) => void;
  onDelete: (cardId: string) => void;
}

const CardDetailModal: React.FC<CardDetailModalProps> = ({
  card,
  isOpen,
  onClose,
  onEdit,
  onDelete
}) => {
  if (!isOpen || !card) return null;

  // Обработчик для закрытия по Esc
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return `${price}`;
  };

  const formatWeight = (weight: number): string => {
    return `${weight} фнт.`;
  };

  const getRarityLabel = (rarity: string): string => {
    switch (rarity) {
      case 'common': return 'Обычная';
      case 'uncommon': return 'Необычная';
      case 'rare': return 'Редкая';
      case 'very_rare': return 'Очень редкая';
      case 'artifact': return 'Артефакт';
      default: return rarity;
    }
  };

  const getRarityColor = (rarity: string): string => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getPropertyLabels = (properties: string[]): string[] => {
    const labels: Record<string, string> = {
      'consumable': 'Расходуемое',
      'single_use': 'Одноразовое',
      'light': 'Легкое',
      'heavy': 'Тяжелое',
      'finesse': 'Изящное',
      'thrown': 'Метательное',
      'versatile': 'Универсальное',
      'two-handed': 'Двуручное',
      'reach': 'Досягаемости',
      'ammunition': 'Требует боеприпасы',
      'loading': 'Зарядка',
      'special': 'Особое'
    };
    return properties.map(p => labels[p] || p);
  };

  const getDamageTypeLabel = (damageType: string): string => {
    switch (damageType) {
      case 'piercing': return 'колющий';
      case 'slashing': return 'рубящий';
      case 'bludgeoning': return 'дробящий';
      default: return damageType;
    }
  };

  const getDefenseTypeLabel = (defenseType: string): string => {
    switch (defenseType) {
      case 'cloth': return 'тканевая';
      case 'light': return 'легкая';
      case 'medium': return 'средняя';
      case 'heavy': return 'тяжелая';
      default: return defenseType;
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col lg:flex-row bg-transparent text-white rounded-lg shadow-xl max-w-6xl w-full h-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Левая часть: Увеличенная карточка */}
        <div className="flex-shrink-0 flex items-center justify-center p-4 lg:w-1/2">
          <div className="transform scale-[1.5] origin-center">
            <CardPreview card={card} />
          </div>
        </div>

        {/* Правая часть: Детальная информация */}
        <div className="flex-grow p-6 overflow-y-auto lg:w-1/2 space-y-4">
          <div className="flex justify-between items-start">
            <h2 className="font-bold text-3xl font-fantasy">{card.name}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>

          {card.description && (
            <p className="text-lg whitespace-pre-wrap">{card.description}</p>
          )}

          {/* Тип урона и брони */}
          {(card.damage_type || card.defense_type) && (
            <div className="text-sm space-y-1">
              {card.damage_type && (
                <p><strong>Тип урона:</strong> {getDamageTypeLabel(card.damage_type)}</p>
              )}
              {card.defense_type && (
                <p><strong>Тип брони:</strong> {getDefenseTypeLabel(card.defense_type)}</p>
              )}
            </div>
          )}

          {/* Характеристики в столбец */}
          <div className="text-sm space-y-1">
            <p><strong>Редкость:</strong> {getRarityLabel(card.rarity)}</p>
            <p><strong>Номер:</strong> {card.card_number}</p>
            {card.price && <p><strong>Цена:</strong> {formatPrice(card.price)} золота</p>}
            {card.weight && <p><strong>Вес:</strong> {formatWeight(card.weight)}</p>}
            {card.bonus_type && card.bonus_value && (
              <p><strong>Бонус:</strong> {card.bonus_value} ({card.bonus_type === 'damage' ? 'Урон' : 'Защита'})</p>
            )}
            {card.properties && card.properties.length > 0 && (
              <p><strong>Свойства:</strong> {getPropertyLabels(card.properties).join(', ')}</p>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="flex space-x-2 mt-4">
            <button
              onClick={() => onEdit(card.id)}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Изменить</span>
            </button>
            <button
              onClick={() => onDelete(card.id)}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Trash2 size={18} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardDetailModal;
