import React, { useState, useEffect } from 'react';
import { ArrowLeft, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import TemplateViewer from './TemplateViewer';

interface EquipmentSelectorProps {
  onClose?: () => void;
}

const EquipmentSelector: React.FC<EquipmentSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [showArmorModal, setShowArmorModal] = useState(false);
  const [selectedArmorType, setSelectedArmorType] = useState<string | null>(null);

  useEffect(() => {
    loadEquipmentTemplates();
  }, []);

  const loadEquipmentTemplates = async () => {
    try {
      setLoading(true);
      const response = await cardsApi.getCards({ template_only: true, limit: 100 });
      const equipmentTemplates = response.cards.filter(card => 
        card.type === 'armor' || 
        card.type === 'equipment' ||
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

  const equipmentSlots = [
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

  const armorTypes = [
    {
      id: 'light',
      name: 'Легкая броня',
      description: 'Кожа, стеганая - +1-3 КЗ, без штрафа к скрытности',
      color: 'bg-green-50 border-green-200 hover:bg-green-100',
      iconColor: 'text-green-600'
    },
    {
      id: 'medium',
      name: 'Средняя броня',
      description: 'Кольчуга, чешуйчатая - +3-5 КЗ, штраф к скрытности -1',
      color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100',
      iconColor: 'text-yellow-600'
    },
    {
      id: 'heavy',
      name: 'Тяжелая броня',
      description: 'Пластинчатая, кольчужная - +6+ КЗ, штраф к скрытности -2',
      color: 'bg-red-50 border-red-200 hover:bg-red-100',
      iconColor: 'text-red-600'
    }
  ];

  const getFilteredTemplates = (slotId: string, armorType?: string) => {
    let filtered = templates.filter(template => template.slot === slotId);
    
    if (armorType) {
      // Фильтруем по типу брони (это можно расширить логикой)
      filtered = filtered.filter(template => {
        // Здесь можно добавить логику фильтрации по типу брони
        return true; // Пока возвращаем все
      });
    }
    
    return filtered;
  };

  const handleSlotSelect = (slotId: string) => {
    const slot = equipmentSlots.find(s => s.id === slotId);
    if (slot?.isArmor) {
      setSelectedSlot(slotId);
      setShowArmorModal(true);
    } else {
      setSelectedSlot(slotId);
    }
  };

  const handleArmorTypeSelect = (armorType: string) => {
    setSelectedArmorType(armorType);
    setShowArmorModal(false);
    // Переходим к выбору шаблонов с учетом типа брони
  };

  const handleTemplateSelect = (template: Card) => {
    const params = new URLSearchParams();
    params.set('template_id', template.id);
    if (selectedArmorType) {
      params.set('armor_type', selectedArmorType);
    }
    navigate(`/card-creator?${params.toString()}`);
  };

  const handleBack = () => {
    if (selectedSlot) {
      setSelectedSlot(null);
      setSelectedArmorType(null);
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

        {showArmorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                Последний вопрос!
              </h3>
              <p className="text-gray-600 mb-6">
                Этот тип экипировки может быть броней, если это так, нажмите на вариант ниже.
                <br />
                <span className="text-sm text-gray-500">
                  (Для эффективного ношения брони нужно владение этим типом)
                </span>
              </p>
              
              <div className="space-y-3">
                {armorTypes.map((armor) => (
                  <button
                    key={armor.id}
                    onClick={() => handleArmorTypeSelect(armor.id)}
                    className={`
                      ${armor.color}
                      border-2 rounded-lg p-4 text-left w-full transition-all duration-200
                      hover:scale-105 hover:shadow-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                    `}
                  >
                    <h4 className="font-semibold text-gray-900 mb-1">
                      {armor.name}
                    </h4>
                    <p className="text-sm text-gray-600">
                      {armor.description}
                    </p>
                  </button>
                ))}
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowArmorModal(false)}
                  className="text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Пропустить
                </button>
              </div>
            </div>
          </div>
        )}

        {!selectedSlot ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {equipmentSlots.map((slot) => {
              const templateCount = getFilteredTemplates(slot.id).length;
              
              return (
                <button
                  key={slot.id}
                  onClick={() => handleSlotSelect(slot.id)}
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
              {selectedArmorType && (
                <div className="mt-2">
                  <span className="inline-block bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full">
                    {armorTypes.find(armor => armor.id === selectedArmorType)?.name}
                  </span>
                </div>
              )}
            </div>

            <TemplateViewer
              templates={getFilteredTemplates(selectedSlot, selectedArmorType || undefined)}
              onTemplateSelect={handleTemplateSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default EquipmentSelector;
