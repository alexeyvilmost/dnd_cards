import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import TemplateViewer from './TemplateViewer';

interface TrinketSelectorProps {
  onClose?: () => void;
}

const TrinketSelector: React.FC<TrinketSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    loadTrinketTemplates();
  }, []);

  const loadTrinketTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({ template_only: true, limit: 100 });
      const trinketTemplates = response.cards.filter(card => card.type === 'trinket');
      setTemplates(trinketTemplates);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов безделушек:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    {
      id: 'jewelry',
      name: '💎 Украшения',
      description: 'Кольца, ожерелья, браслеты',
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
      filter: (card: Card) => 
        card.slot === 'trinket_jewelry' ||
        card.description?.toLowerCase().includes('кольцо') ||
        card.description?.toLowerCase().includes('ожерелье') ||
        card.description?.toLowerCase().includes('браслет') ||
        card.description?.toLowerCase().includes('украшение')
    },
    {
      id: 'toys',
      name: '🧸 Игрушки',
      description: 'Детские игрушки и развлечения',
      color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100',
      filter: (card: Card) => 
        card.slot === 'trinket_toys' ||
        card.description?.toLowerCase().includes('игрушка') ||
        card.description?.toLowerCase().includes('кукла') ||
        card.description?.toLowerCase().includes('мяч') ||
        card.description?.toLowerCase().includes('игра')
    },
    {
      id: 'sentimental',
      name: '❤️ Сентиментальные',
      description: 'Памятные вещи и подарки',
      color: 'bg-pink-50 border-pink-200 hover:bg-pink-100',
      filter: (card: Card) => 
        card.slot === 'trinket_sentimental' ||
        card.description?.toLowerCase().includes('память') ||
        card.description?.toLowerCase().includes('подарок') ||
        card.description?.toLowerCase().includes('любовь') ||
        card.description?.toLowerCase().includes('семья')
    },
    {
      id: 'luxury',
      name: '👑 Роскошь',
      description: 'Дорогие и престижные предметы',
      color: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
      filter: (card: Card) => 
        card.slot === 'trinket_luxury' ||
        card.description?.toLowerCase().includes('золото') ||
        card.description?.toLowerCase().includes('серебро') ||
        card.description?.toLowerCase().includes('драгоценный') ||
        card.description?.toLowerCase().includes('роскошный')
    }
  ];

  const getFilteredTemplates = (categoryId: string) => {
    const category = categories.find(cat => cat.id === categoryId);
    if (!category) return [];
    return templates.filter(category.filter);
  };

  const handleTemplateSelect = (template: Card) => {
    navigate(`/card-creator?template_id=${template.id}`);
  };

  const handleBack = () => {
    if (selectedCategory) {
      setSelectedCategory(null);
    } else {
      if (onClose) {
        onClose();
      } else {
        navigate('/card-creator');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка шаблонов безделушек...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-6">
          <button
            onClick={handleBack}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors mr-4"
          >
            <ArrowLeft size={20} className="mr-2" />
            Назад
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {selectedCategory ? 'Выберите шаблон безделушки' : 'Безделушка'}
          </h1>
        </div>

        {!selectedCategory ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {categories.map((category) => {
              const templateCount = getFilteredTemplates(category.id).length;
              
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`
                    ${category.color}
                    border-2 rounded-xl p-6 text-left transition-all duration-200
                    hover:scale-105 hover:shadow-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  `}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {category.name}
                      </h3>
                      <p className="text-gray-600 text-sm">
                        {category.description}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-gray-700">
                        {templateCount}
                      </div>
                      <div className="text-sm text-gray-500">
                        шаблонов
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {categories.find(cat => cat.id === selectedCategory)?.name}
              </h2>
              <p className="text-gray-600">
                {categories.find(cat => cat.id === selectedCategory)?.description}
              </p>
            </div>

            <TemplateViewer
              templates={getFilteredTemplates(selectedCategory)}
              onTemplateSelect={handleTemplateSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default TrinketSelector;
