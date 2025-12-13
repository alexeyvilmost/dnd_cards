import React, { useEffect } from 'react';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Action } from '../types';
import { ACTION_RESOURCE_OPTIONS, ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { getChargeById, getChargeImagePath } from '../utils/charges';
import ActionPreview from './ActionPreview';

interface ActionDetailModalProps {
  action: Action | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (actionId: string) => void;
  onDelete: (actionId: string) => void;
}

const ActionDetailModal: React.FC<ActionDetailModalProps> = ({
  action,
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

  if (!isOpen || !action) return null;

  const getResourceLabel = (resource: string) => {
    return ACTION_RESOURCE_OPTIONS.find(opt => opt.value === resource)?.label || resource;
  };

  const getRechargeLabel = (recharge?: string | null) => {
    if (!recharge) return '';
    return ACTION_RECHARGE_OPTIONS.find(opt => opt.value === recharge)?.label || recharge;
  };

  const getActionTypeLabel = (actionType: string) => {
    return ACTION_TYPE_OPTIONS.find(opt => opt.value === actionType)?.label || actionType;
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
          <h2 className="text-2xl font-bold text-gray-900">{action.name}</h2>
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
              <ActionPreview action={action} disableHover={true} />
            </div>

            {/* Правая колонка - детальная информация */}
            <div className="space-y-4">
              {/* Тип действия */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Тип действия</h3>
                <p className="text-gray-900">{getActionTypeLabel(action.action_type)}</p>
              </div>

              {/* Ресурсы */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Ресурсы</h3>
                {action.resources && action.resources.length > 0 ? (
                  <div className="space-y-1">
                    {action.resources.map((resourceId) => {
                      const charge = getChargeById(resourceId);
                      if (charge) {
                        return (
                          <div key={resourceId} className="flex items-center gap-2">
                            <img 
                              src={getChargeImagePath(charge.image)} 
                              alt={charge.russian_name}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                            <span className="text-gray-900">{charge.russian_name}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={resourceId} className="text-gray-900">
                          {getResourceLabel(resourceId)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-900">{getResourceLabel(action.resource)}</p>
                )}
              </div>

              {/* Дальность */}
              {action.distance && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Дальность</h3>
                  <p className="text-gray-900">{action.distance}</p>
                </div>
              )}

              {/* Перезарядка */}
              {action.recharge && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Перезарядка</h3>
                  <p className="text-gray-900">
                    {getRechargeLabel(action.recharge)}
                    {action.recharge === 'custom' && action.recharge_custom && ` (${action.recharge_custom})`}
                  </p>
                </div>
              )}

              {/* Описание */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{action.description}</p>
              </div>

              {/* Детальное описание */}
              {action.detailed_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Детальное описание</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{action.detailed_description}</p>
                </div>
              )}

              {/* ID действия */}
              {action.card_number && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">ID действия</h3>
                  <p className="text-gray-900 font-mono">{action.card_number}</p>
                </div>
              )}

              {/* Автор */}
              {action.author && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Автор</h3>
                  <p className="text-gray-900">{action.author}</p>
                </div>
              )}

              {/* Источник */}
              {action.source && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Источник</h3>
                  <p className="text-gray-900">{action.source}</p>
                </div>
              )}
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => onEdit(action.id)}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Редактировать</span>
            </button>
            <button
              onClick={() => onDelete(action.id)}
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

export default ActionDetailModal;

