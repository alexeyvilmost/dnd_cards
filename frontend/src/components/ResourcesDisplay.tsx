import React from 'react';
import { getChargeIcon, getChargeRussianName } from '../utils/chargeIcons';

interface ResourcesDisplayProps {
  resources: Record<string, number>;
  maxResources?: Record<string, number>;
}

export const ResourcesDisplay: React.FC<ResourcesDisplayProps> = ({
  resources,
  maxResources = {},
}) => {
  if (!resources || Object.keys(resources).length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        Нет ресурсов для отображения
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {Object.entries(resources).map(([resourceId, currentValue]) => {
        const maxValue = maxResources[resourceId];
        const iconPath = getChargeIcon(resourceId);
        const resourceName = getChargeRussianName(resourceId);

        return (
          <div
            key={resourceId}
            className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center space-x-3"
          >
            {iconPath && (
              <img
                src={iconPath}
                alt={resourceName}
                className="w-8 h-8 flex-shrink-0"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 text-sm">{resourceName}</div>
              <div className="text-lg font-bold text-blue-600">
                {currentValue}
                {maxValue !== undefined && maxValue !== null && (
                  <span className="text-gray-500 font-normal"> / {maxValue}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
