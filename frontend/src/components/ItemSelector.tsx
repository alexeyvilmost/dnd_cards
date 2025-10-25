import React, { useState, useEffect } from 'react';
import { X, Eye, Check } from 'lucide-react';
import { apiClient } from '../api/client';
import { Card } from '../types';
import CardPreview from './CardPreview';

interface ItemSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItems: (items: Card[]) => void;
  characterId: string;
}

const ItemSelector: React.FC<ItemSelectorProps> = ({ isOpen, onClose, onAddItems, characterId }) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen) {
      loadCards();
    }
  }, [isOpen]);

  const loadCards = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/api/cards', {
        params: {
          exclude_template_only: true, // Показываем только обычные карты
          limit: 100
        }
      });
      setCards(response.data.cards || []);
    } catch (error) {
      console.error('Ошибка загрузки карт:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleItemToggle = (cardId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(cardId)) {
      newSelected.delete(cardId);
    } else {
      newSelected.add(cardId);
    }
    setSelectedItems(newSelected);
  };

  const [isAdding, setIsAdding] = useState(false);

  const handleAddSelected = async () => {
    if (isAdding) return; // Защита от двойного нажатия
    
    setIsAdding(true);
    try {
      const selectedCards = cards.filter(card => selectedItems.has(card.id));
      onAddItems(selectedCards);
      onClose();
    } finally {
      setIsAdding(false);
    }
  };

  const handleCardPreview = (card: Card) => {
    // TODO: Открыть детальный просмотр карты
    console.log('Preview card:', card);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-11/12 h-5/6 max-w-7xl flex flex-col">
        {/* Заголовок */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Выбор предметов</h2>
            <p className="text-gray-600 mt-1">
              Выберите предметы для добавления в инвентарь
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg border ${
                  viewMode === 'grid' 
                    ? 'bg-blue-100 border-blue-300 text-blue-700' 
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
                title="Сетка"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg border ${
                  viewMode === 'list' 
                    ? 'bg-blue-100 border-blue-300 text-blue-700' 
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
                title="Список"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Загрузка предметов...</p>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-6">
              {viewMode === 'grid' ? (
                /* Сетка предметов */
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {cards.map((card) => (
                    <div key={card.id} className="relative group">
                      <div
                        className={`relative cursor-pointer transition-all duration-200 ${
                          selectedItems.has(card.id) 
                            ? 'ring-2 ring-blue-500 ring-offset-2' 
                            : 'hover:shadow-lg'
                        }`}
                        onClick={() => handleItemToggle(card.id)}
                      >
                        <CardPreview card={card} />
                        
                        {/* Чекбокс выбора */}
                        <div className="absolute top-2 left-2 z-10">
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            selectedItems.has(card.id)
                              ? 'bg-blue-500 border-blue-500'
                              : 'bg-white border-gray-300'
                          }`}>
                            {selectedItems.has(card.id) && (
                              <Check size={16} className="text-white" />
                            )}
                          </div>
                        </div>

                        {/* Кнопка просмотра */}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCardPreview(card);
                            }}
                            className="p-1.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 shadow-lg"
                            title="Просмотр"
                          >
                            <Eye size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Список названий - точно как в библиотеке */
                <div className="relative">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        className="relative"
                        onMouseEnter={() => setHoveredCard(card)}
                        onMouseLeave={() => setHoveredCard(null)}
                        onMouseMove={(e) => {
                          setMousePosition({ x: e.clientX, y: e.clientY });
                        }}
                      >
                        <div
                          onClick={() => handleItemToggle(card.id)}
                          className={`group w-full text-left p-3 rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:shadow-md hover:bg-gray-50 border-l-4 cursor-pointer ${
                            selectedItems.has(card.id)
                              ? 'ring-2 ring-blue-500 ring-offset-2'
                              : ''
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            {/* Чекбокс */}
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              selectedItems.has(card.id)
                                ? 'bg-blue-500 border-blue-500'
                                : 'bg-white border-gray-300'
                            }`}>
                              {selectedItems.has(card.id) && (
                                <Check size={12} className="text-white" />
                              )}
                            </div>

                            {/* Маленькая картинка слева */}
                            <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                              {card.image_url && card.image_url.trim() !== '' ? (
                                <img
                                  src={card.image_url}
                                  alt={card.name}
                                  className="w-full h-full object-contain"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = '/default_image.png';
                                  }}
                                />
                              ) : (
                                <img
                                  src="/default_image.png"
                                  alt="Default D&D"
                                  className="w-full h-full object-contain"
                                />
                              )}
                            </div>
                            
                            {/* Текст справа */}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate text-gray-900">
                                {card.name}
                              </div>
                              
                              {/* Нижняя панель с весом, ценой, номером карты */}
                              <div className="flex items-center justify-between mt-1 text-xs">
                                <div className="flex items-center space-x-2">
                                  {card.weight && (
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-900 font-medium">
                                        {card.weight}
                                      </span>
                                      <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                                    </div>
                                  )}
                                  {card.price && (
                                    <div className="flex items-center space-x-1">
                                      <span className="text-yellow-600 font-bold">
                                        {card.price >= 1000 ? `${(card.price / 1000).toFixed(1)}K` : card.price}
                                      </span>
                                      <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                                    </div>
                                  )}
                                  {card.bonus_type && card.bonus_value && (
                                    <div className="flex items-center space-x-0.5">
                                      <span className="text-gray-900 font-medium">
                                        {card.bonus_value.toLowerCase() === 'advantage' ? 'ADV' : card.bonus_value}
                                      </span>
                                      {card.bonus_type === 'damage' && card.damage_type && (
                                        <img src={`/icons/${card.damage_type}.png`} alt={card.damage_type} className="w-3 h-3" />
                                      )}
                                      {card.bonus_type === 'defense' && card.defense_type && (
                                        <img src="/icons/defense.png" alt="Защита" className="w-3 h-3" />
                                      )}
                                    </div>
                                  )}
                                </div>
                                <span className="text-gray-400 font-mono">
                                  {card.card_number}
                                </span>
                              </div>
                            </div>

                            {/* Кнопка просмотра */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCardPreview(card);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                              title="Подробнее"
                            >
                              <Eye size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Футер с кнопками */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Выбрано предметов: {selectedItems.size}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleAddSelected}
              disabled={selectedItems.size === 0 || isAdding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isAdding ? 'Добавление...' : `Добавить (${selectedItems.size})`}
            </button>
          </div>
        </div>

        {/* Всплывающая карточка при наведении */}
        {hoveredCard && viewMode === 'list' && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: Math.min(mousePosition.x + 10, window.innerWidth - 220),
              top: Math.max(mousePosition.y - 10, 10),
              transform: mousePosition.y < 300 ? 'translateY(0)' : 'translateY(-100%)'
            }}
          >
            <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
              <CardPreview card={hoveredCard} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemSelector;
