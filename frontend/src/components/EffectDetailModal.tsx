import React, { useEffect } from 'react';
import { X, Edit, Trash2 } from 'lucide-react';
import type { PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import EffectPreview from './EffectPreview';

interface EffectDetailModalProps {
  effect: PassiveEffect | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (effectId: string) => void;
  onDelete: (effectId: string) => void;
}

const EffectDetailModal: React.FC<EffectDetailModalProps> = ({
  effect,
  isOpen,
  onClose,
  onEdit,
  onDelete,
}) => {
  // Обработчик для закрытия по Esc
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !effect) return null;

  const getEffectTypeLabel = (effectType: string) => {
    return PASSIVE_EFFECT_TYPE_OPTIONS.find(opt => opt.value === effectType)?.label || effectType;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Затемнение фона */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      
      {/* Модальное окно */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Заголовок */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{effect.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Содержимое */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Левая колонка - превью карточки */}
            <div className="flex justify-center">
              <EffectPreview effect={effect} disableHover={true} />
            </div>

            {/* Правая колонка - детальная информация */}
            <div className="space-y-4">
              {/* Тип эффекта */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Тип эффекта</h3>
                <p className="text-gray-900">{getEffectTypeLabel(effect.effect_type)}</p>
              </div>

              {/* Описание */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{effect.description}</p>
              </div>

              {/* Детальное описание */}
              {effect.detailed_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Детальное описание</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{effect.detailed_description}</p>
                </div>
              )}

              {/* Условие */}
              {effect.condition_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Условие</h3>
                  <p className="text-gray-900">{effect.condition_description}</p>
                </div>
              )}

              {/* ID эффекта */}
              {effect.card_number && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">ID эффекта</h3>
                  <p className="text-gray-900 font-mono">{effect.card_number}</p>
                </div>
              )}

              {/* Автор */}
              {effect.author && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Автор</h3>
                  <p className="text-gray-900">{effect.author}</p>
                </div>
              )}

              {/* Источник */}
              {effect.source && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Источник</h3>
                  <p className="text-gray-900">{effect.source}</p>
                </div>
              )}
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => onEdit(effect.id)}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Редактировать</span>
            </button>
            <button
              onClick={() => onDelete(effect.id)}
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

export default EffectDetailModal;

