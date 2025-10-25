import React, { useState, useEffect } from 'react';
import { ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import TemplateViewer from './TemplateViewer';

interface IngredientSelectorProps {
  onClose?: () => void;
}

const IngredientSelector: React.FC<IngredientSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    loadIngredientTemplates();
  }, []);

  const loadIngredientTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({ template_only: true, limit: 100 });
      const ingredientTemplates = response.cards.filter(card => card.type === 'ingredient');
      setTemplates(ingredientTemplates);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов ингредиентов:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    {
      id: 'plant',
      name: '🌿 Растительные',
      description: 'Травы, корни, цветы и плоды',
      color: 'bg-green-50 border-green-200 hover:bg-green-100',
      filter: (card: Card) => 
        card.slot === 'ingredient_plant' ||
        card.description?.toLowerCase().includes('трава') ||
        card.description?.toLowerCase().includes('корень') ||
        card.description?.toLowerCase().includes('цветок') ||
        card.description?.toLowerCase().includes('плод')
    },
    {
      id: 'mineral',
      name: '⛰️ Минеральные',
      description: 'Камни, кристаллы и металлы',
      color: 'bg-gray-50 border-gray-200 hover:bg-gray-100',
      filter: (card: Card) => 
        card.slot === 'ingredient_mineral' ||
        card.description?.toLowerCase().includes('камень') ||
        card.description?.toLowerCase().includes('кристалл') ||
        card.description?.toLowerCase().includes('металл') ||
        card.description?.toLowerCase().includes('руда')
    },
    {
      id: 'animal',
      name: '🐾 Животные',
      description: 'Части животных и их продукты',
      color: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
      filter: (card: Card) => 
        card.slot === 'ingredient_animal' ||
        card.description?.toLowerCase().includes('кровь') ||
        card.description?.toLowerCase().includes('кость') ||
        card.description?.toLowerCase().includes('шерсть') ||
        card.description?.toLowerCase().includes('чешуя')
    },
    {
      id: 'magical',
      name: '✨ Магические',
      description: 'Магические компоненты и артефакты',
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
      filter: (card: Card) => 
        card.slot === 'ingredient_magical' ||
        card.description?.toLowerCase().includes('магический') ||
        card.description?.toLowerCase().includes('энергия') ||
        card.description?.toLowerCase().includes('дух') ||
        card.description?.toLowerCase().includes('эссенция')
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

  const handleTemplateEdit = (template: Card) => {
    navigate(`/edit/${template.id}`);
  };

  const handleTemplateDelete = async (template: Card) => {
    if (window.confirm(`Вы уверены, что хотите удалить шаблон "${template.name}"?`)) {
      try {
        await cardsApi.deleteCard(template.id);
        // Перезагружаем список шаблонов
        loadIngredientTemplates();
      } catch (error) {
        console.error('Ошибка удаления шаблона:', error);
        alert('Ошибка при удалении шаблона');
      }
    }
  };

  const handleCategorySelect = (categoryId: string) => {
    const filteredTemplates = getFilteredTemplates(categoryId);
    
    // Если в категории только один шаблон, сразу переходим к созданию
    if (filteredTemplates.length === 1) {
      handleTemplateSelect(filteredTemplates[0]);
    } else {
      setSelectedCategory(categoryId);
    }
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
          <p className="text-gray-600">Загрузка шаблонов ингредиентов...</p>
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
            {selectedCategory ? 'Выберите шаблон ингредиента' : 'Ингредиент'}
          </h1>
        </div>

        {!selectedCategory ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {categories.map((category) => {
              const templateCount = getFilteredTemplates(category.id).length;
              
              return (
                <button
                  key={category.id}
                  onClick={() => handleCategorySelect(category.id)}
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
              onTemplateEdit={handleTemplateEdit}
              onTemplateDelete={handleTemplateDelete}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default IngredientSelector;
