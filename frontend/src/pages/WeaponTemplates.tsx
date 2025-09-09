import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3X3, List } from 'lucide-react';
import { cardsApi } from '../api/client';
import { Card } from '../types';
import { ITEM_TYPE_OPTIONS } from '../constants/itemTypes';
import CardPreview from '../components/CardPreview';
import { getRarityColor } from '../utils/rarityColors';

const WeaponTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<Card[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<Card[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [hoveredTemplate, setHoveredTemplate] = useState<Card | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [templates, selectedCategory, searchTerm]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({
        // Показываем только карты, которые являются шаблонами
        template_only: true,
        limit: 100
      });
      setTemplates(response.cards);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTemplates = () => {
    let filtered = templates;

    // Фильтр по типу (оружие, доспех и т.д.)
    if (selectedCategory) {
      filtered = filtered.filter(template => template.type === selectedCategory);
    }

    // Фильтр по поиску
    if (searchTerm) {
      filtered = filtered.filter(template =>
        template.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredTemplates(filtered);
  };

  const handleTemplateSelect = (template: Card) => {
    // Передаем только ID шаблона, остальную информацию загрузим с бэкенда
    navigate(`/card-creator?template_id=${template.id}`);
  };

  // Функция для получения цвета полоски редкости
  const getRarityBorderColor = (rarity: string): string => {
    switch (rarity?.toLowerCase()) {
      case 'common':
      case 'обычное':
        return 'border-l-gray-400'; // Серая полоска для обычных предметов
      case 'uncommon':
      case 'необычное':
        return 'border-l-green-500';
      case 'rare':
      case 'редкое':
        return 'border-l-blue-500';
      case 'very_rare':
      case 'очень редкое':
        return 'border-l-purple-500';
      case 'epic':
      case 'эпическое':
        return 'border-l-purple-500';
      case 'legendary':
      case 'легендарное':
        return 'border-l-orange-500';
      case 'artifact':
      case 'артефакт':
        return 'border-l-orange-500';
      default:
        return 'border-l-gray-400'; // По умолчанию серая
    }
  };





  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Загрузка шаблонов...</div>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-3xl font-fantasy font-bold text-gray-900 mb-4">Шаблоны оружия</h1>
            <p className="text-gray-600">Выберите шаблон оружия для создания карты</p>
          </div>

          {/* Фильтры */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Поиск по названию..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="sm:w-64">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Все категории</option>
                {ITEM_TYPE_OPTIONS.map(category => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Переключатель режимов отображения */}
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
                <Grid3X3 size={18} />
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
                <List size={18} />
              </button>
            </div>
          </div>

        {/* Счетчик результатов */}
        <div className="mb-4 text-sm text-gray-600">
          Найдено: {filteredTemplates.length} из {templates.length}
        </div>

        {/* Отображение в зависимости от режима */}
        {viewMode === 'grid' ? (
          /* Сетка шаблонов */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
            {filteredTemplates.map((template) => (
              <CardPreview
                key={template.id}
                card={template}
                onClick={() => handleTemplateSelect(template)}
              />
            ))}
          </div>
        ) : (
          /* Список названий в три колонки */
          <div className="relative">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="relative"
                  onMouseEnter={() => setHoveredTemplate(template)}
                  onMouseLeave={() => setHoveredTemplate(null)}
                >
                  <button
                    onClick={() => handleTemplateSelect(template)}
                    className={`w-full text-left p-3 rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:shadow-md hover:bg-gray-50 text-gray-900 border-l-4 ${getRarityBorderColor(template.rarity)}`}
                  >
                    <div className="flex items-center space-x-3">
                      {/* Маленькая картинка слева */}
                      <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                        {template.image_url && template.image_url.trim() !== '' ? (
                          <img
                            src={template.image_url}
                            alt={template.name}
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
                          {template.name}
                        </div>
                        
                        {/* Нижняя панель с весом, ценой, уроном */}
                        <div className="flex items-center justify-between mt-1 text-xs">
                          <div className="flex items-center space-x-2">
                            {template.weight && (
                              <div className="flex items-center space-x-1">
                                <span className="text-gray-900 font-medium">
                                  {template.weight}
                                </span>
                                <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                              </div>
                            )}
                            {template.price && (
                              <div className="flex items-center space-x-1">
                                <span className="text-yellow-600 font-bold">
                                  {template.price >= 1000 ? `${(template.price / 1000).toFixed(1)}K` : template.price}
                                </span>
                                <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                              </div>
                            )}
                            {template.bonus_value && (
                              <div className="flex items-center space-x-0.5">
                                <span className="text-gray-900 font-medium">
                                  {template.bonus_value}
                                </span>
                                {template.damage_type && (
                                  <img src={`/icons/${template.damage_type}.png`} alt={template.damage_type} className="w-3 h-3" />
                                )}
                              </div>
                            )}
                          </div>
                          <span className="text-gray-400 font-mono">
                            {template.card_number}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
            
            {/* Показ шаблона при наведении */}
            {hoveredTemplate && (
              <div className="fixed top-4 right-4 z-50 pointer-events-none">
                <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
                  <CardPreview
                    card={hoveredTemplate}
                    onClick={() => {}}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {filteredTemplates.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">
              {searchTerm || selectedCategory ? 'Шаблоны не найдены' : 'Шаблоны не загружены'}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
};

export default WeaponTemplates;
