import React from 'react';
import { Eye } from 'lucide-react';
import { Action } from '../types';
import { getChargeIcon, getChargeRussianName } from '../utils/chargeIcons';

interface ActionButtonProps {
  action: Action;
  isAvailable: boolean;
  resources?: Record<string, number>;
  onClick: () => void;
  onInfoClick?: () => void;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  action,
  isAvailable,
  resources = {},
  onClick,
  onInfoClick,
}) => {
  // Получаем все ресурсы действия
  const getActionResources = (action: Action): string[] => {
    const resources: string[] = [];
    
    // Ресурсы из поля resource (строка через запятую)
    if (action.resource) {
      const resourceParts = String(action.resource).split(',').map(r => r.trim());
      resources.push(...resourceParts);
    }
    
    // Ресурсы из поля resources (массив)
    if (action.resources && Array.isArray(action.resources)) {
      resources.push(...action.resources);
    }
    
    // Ресурсы из script.resource_cost (массив)
    if (action.script?.resource_cost && Array.isArray(action.script.resource_cost)) {
      resources.push(...action.script.resource_cost);
    }
    
    // Убираем дубликаты
    return [...new Set(resources)];
  };

  const allResources = getActionResources(action);

  return (
    <button
      onClick={onClick}
      disabled={!isAvailable}
      className={`flex items-center space-x-3 px-6 py-4 rounded-lg border-2 border-black transition-all shadow-lg ${
        isAvailable
          ? 'bg-amber-900 hover:bg-amber-800 text-white hover:scale-105 cursor-pointer'
          : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-60'
      }`}
      title={!isAvailable ? 'Действие недоступно' : ''}
    >
      {/* Иконки ресурсов */}
      <div className="flex items-center space-x-1">
        {allResources.map((resource, idx) => {
          const iconPath = getChargeIcon(resource);
          if (iconPath) {
            return (
              <img
                key={idx}
                src={iconPath}
                alt={getChargeRussianName(resource)}
                className="w-6 h-6"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            );
          }
          return null;
        })}
      </div>
      
      {/* Иконка действия */}
      {action.image_url && action.image_url.trim() !== '' && (
        <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
          <img
            src={action.image_url}
            alt={action.name}
            className={`w-full h-full object-contain ${
              isAvailable ? 'filter drop-shadow-[0_0_8px_rgba(255,140,0,0.8)]' : ''
            }`}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        </div>
      )}
      
      <span className="text-lg font-semibold">{action.name}</span>
      
      {/* Показываем количество зарядов для специальных ресурсов */}
      {allResources.includes('rage_charge') && resources['rage_charges'] !== undefined && (
        <span className="text-sm opacity-75">({resources['rage_charges']})</span>
      )}
      
      {/* Кнопка информации */}
      {onInfoClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInfoClick();
          }}
          className="ml-2 p-1 hover:bg-amber-700 rounded"
          title="Подробнее"
        >
          <Eye className="w-4 h-4" />
        </button>
      )}
    </button>
  );
};
