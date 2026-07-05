import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import TemplateViewer from './TemplateViewer';

const SHIELD_TEMPLATE_ID = 'db34e692-5d67-4afc-99ca-b42ce6f0dc28';

interface EquipmentSlotOption {
  id: string;
  name: string;
  description: string;
  color: string;
  isArmor?: boolean;
  directTemplateId?: string;
}

interface EquipmentSelectorProps {
  onClose?: () => void;
}

const EquipmentSelector: React.FC<EquipmentSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  useEffect(() => {
    loadEquipmentTemplates();
  }, []);

  const loadEquipmentTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({ template_only: true, limit: 100 });
      const equipmentTemplates = response.cards.filter(card =>
        (card.type as string | null | undefined) === 'armor' ||
        (card.type as string | null | undefined) === 'equipment' ||
        card.type === 'shield' ||
        card.type === 'ring' ||
        card.type === 'necklace' ||
        card.type === 'cloak' ||
        card.type === 'helmet' ||
        card.type === 'chest' ||
        card.type === 'gloves' ||
        card.type === 'boots'
      );
      setTemplates(equipmentTemplates);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов экипировки:', error);
    } finally {
      setLoading(false);
    }
  };

  const equipmentSlots: EquipmentSlotOption[] = [
    {
      id: 'shield',
      name: '🛡️ Щит',
      description: 'Щиты для защиты',
      color: 'bg-teal-50 border-teal-200 hover:bg-teal-100',
      directTemplateId: SHIELD_TEMPLATE_ID,
    },
    {
      id: 'body',
      name: '👕 Одежда/Доспех',
      description: 'Основная защита тела',
      color: 'bg-blue-50 border-blue-200 hover:bg-blue-100',
      isArmor: true
    },
    {
      id: 'arms',
      name: '🛡️ Наручи',
      description: 'Защита рук и предплечий',
      color: 'bg-green-50 border-green-200 hover:bg-green-100',
      isArmor: true
    },
    {
      id: 'feet',
      name: '👢 Сапоги',
      description: 'Обувь и защита ног',
      color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100',
      isArmor: false
    },
    {
      id: 'head',
      name: '👑 Головной убор',
      description: 'Шлемы, шляпы, короны',
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100',
      isArmor: false
    },
    {
      id: 'cloak',
      name: '🧥 Плащ',
      description: 'Плащи и накидки',
      color: 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
      isArmor: false
    },
    {
      id: 'necklace',
      name: '💎 Ожерелье',
      description: 'Ожерелья и амулеты',
      color: 'bg-pink-50 border-pink-200 hover:bg-pink-100',
      isArmor: false
    },
    {
      id: 'ring',
      name: '💍 Кольцо',
      description: 'Кольца и перстни',
      color: 'bg-orange-50 border-orange-200 hover:bg-orange-100',
      isArmor: false
    }
  ];


  const getFilteredTemplates = (slotId: string) => {
    return templates.filter(template => template.slot === slotId);
  };

  const handleSlotSelect = (slot: EquipmentSlotOption) => {
    if (slot.directTemplateId) {
      navigate(`/card-creator?template_id=${slot.directTemplateId}`);
      return;
    }

    const filteredTemplates = getFilteredTemplates(slot.id);

    // Если в слоте только один шаблон, сразу переходим к созданию
    if (filteredTemplates.length === 1) {
      handleTemplateSelect(filteredTemplates[0]);
    } else {
      setSelectedSlot(slot.id);
    }
  };


  const handleTemplateSelect = (template: Card) => {
    const params = new URLSearchParams();
    params.set('template_id', template.id);
    navigate(`/card-creator?${params.toString()}`);
  };

  const handleTemplateEdit = (template: Card) => {
    navigate(`/edit/${template.id}`);
  };

  const handleTemplateDelete = async (template: Card) => {
    if (window.confirm(`Вы уверены, что хотите удалить шаблон "${template.name}"?`)) {
      try {
        await cardsApi.deleteCard(template.id);
        // Перезагружаем список шаблонов
        loadEquipmentTemplates();
      } catch (error) {
        console.error('Ошибка удаления шаблона:', error);
        alert('Ошибка при удалении шаблона');
      }
    }
  };

  const handleBack = () => {
    if (selectedSlot) {
      setSelectedSlot(null);
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
          <p className="text-gray-600">Загрузка шаблонов экипировки...</p>
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
            {selectedSlot ? 'Выберите шаблон экипировки' : 'Экипировка'}
          </h1>
        </div>


        {!selectedSlot ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {equipmentSlots.map((slot) => {
              const templateCount = slot.directTemplateId
                ? 1
                : getFilteredTemplates(slot.id).length;
              
              return (
                <button
                  key={slot.id}
                  onClick={() => handleSlotSelect(slot)}
                  className={`
                    ${slot.color}
                    border-2 rounded-xl p-6 text-left transition-all duration-200
                    hover:scale-105 hover:shadow-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  `}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {slot.name}
                      </h3>
                      <p className="text-gray-600 text-sm">
                        {slot.description}
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
                {equipmentSlots.find(slot => slot.id === selectedSlot)?.name}
              </h2>
              <p className="text-gray-600">
                {equipmentSlots.find(slot => slot.id === selectedSlot)?.description}
              </p>
            </div>

            <TemplateViewer
              templates={getFilteredTemplates(selectedSlot)}
              onTemplateSelect={handleTemplateSelect}
              onTemplateEdit={handleTemplateEdit}
              onTemplateDelete={handleTemplateDelete}
              defaultViewMode="grid"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default EquipmentSelector;
