import React, { useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { PROPERTIES_OPTIONS, type Properties } from '../types';

interface PropertySelectorProps {
  value: Properties;
  onChange: (properties: Properties) => void;
}

// Иконки для свойств
const getPropertyIcon = (property: string) => {
  const iconMap: { [key: string]: string } = {
    'consumable': '/icons/consumable.png',
    'single_use': '/icons/single_use.png',
    'light': '/icons/light.png',
    'heavy': '/icons/heavy.png',
    'finesse': '/icons/finesse.png',
    'thrown': '/icons/thrown.png',
    'versatile': '/icons/versatile.png',
    'two-handed': '/icons/two_handed.png',
    'reach': '/icons/reach.png',
    'ammunition': '/icons/ammunition.png',
    'loading': '/icons/loading.png',
    'special': '/icons/special.png'
  };
  
  return iconMap[property] || '/icons/special.png';
};

const PropertySelector: React.FC<PropertySelectorProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (property: string) => {
    const newValue = value.includes(property as any)
      ? value.filter(p => p !== property)
      : [...value, property as any];
    onChange(newValue);
  };

  const selectedCount = value.length;
  const selectedLabels = value.map(prop => 
    PROPERTIES_OPTIONS.find(option => option.value === prop)?.label
  ).filter(Boolean);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center justify-between"
      >
        <span className="text-sm text-gray-700">
          {selectedCount === 0 
            ? 'Выберите свойства' 
            : selectedCount === 1 
              ? selectedLabels[0]
              : `${selectedCount} свойств выбрано`
          }
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {PROPERTIES_OPTIONS.map((option) => {
            const isSelected = value.includes(option.value as any);
            return (
              <label
                key={option.value}
                className="flex items-center space-x-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggle(option.value)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <img 
                  src={getPropertyIcon(option.value)} 
                  alt={option.label}
                  className="w-5 h-5 object-contain"
                />
                <span className="text-sm text-gray-700 flex-1">{option.label}</span>
                {isSelected && <Check className="w-4 h-4 text-blue-600" />}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PropertySelector;
