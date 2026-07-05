import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import TemplateViewer from './TemplateViewer';

interface WeaponSelectorProps {
  onClose?: () => void;
}

const WeaponSelector: React.FC<WeaponSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWeaponTemplates();
  }, []);

  const loadWeaponTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({ template_only: true, limit: 100 });
      const weaponTemplates = response.cards.filter(card => card.type === 'weapon');
      setTemplates(weaponTemplates);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов оружия:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    {
      id: 'simple_melee',
      name: '⚔️ Простое рукопашное',
      description: 'Базовое оружие ближнего боя',
      filter: (card: Card) =>
        (card.tags as string[] | null | undefined)?.includes('Простое') && (card.tags as string[] | null | undefined)?.includes('Ближнее')
    },
    {
      id: 'simple_ranged',
      name: '🏹 Простое дальнобойное',
      description: 'Базовое оружие дальнего боя',
      filter: (card: Card) =>
        (card.tags as string[] | null | undefined)?.includes('Простое') && (card.tags as string[] | null | undefined)?.includes('Дальнобойное')
    },
    {
      id: 'martial_melee',
      name: '⚔️ Воинское рукопашное',
      description: 'Профессиональное оружие ближнего боя',
      filter: (card: Card) =>
        (card.tags as string[] | null | undefined)?.includes('Воинское') && (card.tags as string[] | null | undefined)?.includes('Ближнее')
    },
    {
      id: 'martial_ranged',
      name: '🏹 Воинское дальнобойное',
      description: 'Профессиональное оружие дальнего боя',
      filter: (card: Card) =>
        (card.tags as string[] | null | undefined)?.includes('Воинское') && (card.tags as string[] | null | undefined)?.includes('Дальнобойное')
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
        loadWeaponTemplates();
      } catch (error) {
        console.error('Ошибка удаления шаблона:', error);
        alert('Ошибка при удалении шаблона');
      }
    }
  };

  const handleBack = () => {
    if (onClose) {
      onClose();
    } else {
      navigate('/card-creator');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка шаблонов оружия...</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Оружие</h1>
        </div>

        <div className="space-y-8">
          {categories.map((category) => {
            const categoryTemplates = getFilteredTemplates(category.id);
            
            if (categoryTemplates.length === 0) return null;

            return (
              <div key={category.id} className="space-y-4">
                {/* Заголовок категории */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {category.name}
                    </h2>
                    <p className="text-gray-600 text-sm">
                      {category.description}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    {categoryTemplates.length} шаблонов
                  </div>
                </div>

                {/* Горизонтальный разделитель */}
                <div className="border-t border-gray-200"></div>

                {/* Шаблоны категории */}
                <TemplateViewer
                  templates={categoryTemplates}
                  onTemplateSelect={handleTemplateSelect}
                  onTemplateEdit={handleTemplateEdit}
                  onTemplateDelete={handleTemplateDelete}
                  showCount={false}
                  defaultViewMode="list"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WeaponSelector;
