import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, Check, Plus } from 'lucide-react';
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
    'special': '/icons/special.png',
    'shield': '/icons/shield.png',
    'ring': '/icons/ring.png',
    'necklace': '/icons/necklace.png',
    'cloak': '/icons/cloak.png',
    'equipment': '/icons/belt.png',
    'jewelry': '/icons/slots/ring.png',
    'musical_instrument': '/icons/special.png',
    'artisan_tool': '/icons/melee-hand.png',
    'ammo': '/icons/ammunition.png',
  };
  
  return iconMap[property] || '/icons/special.png';
};

export const normalizeCustomProperty = (property: string): string =>
  property.trim().replace(/\s+/g, ' ');

const hasProperty = (properties: Properties, candidate: string): boolean => {
  const normalizedCandidate = candidate.toLocaleLowerCase('ru');
  return properties.some((property) =>
    normalizeCustomProperty(property).toLocaleLowerCase('ru') === normalizedCandidate
  );
};

export const appendCustomProperty = (properties: Properties, property: string): Properties => {
  const normalizedProperty = normalizeCustomProperty(property);
  if (!normalizedProperty || hasProperty(properties, normalizedProperty)) return properties;
  return [...properties, normalizedProperty];
};

const PropertySelector: React.FC<PropertySelectorProps> = ({ value, onChange }) => {
  const customPropertyInputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [customProperty, setCustomProperty] = useState('');

  const handleToggle = (property: string) => {
    const newValue = value.includes(property)
      ? value.filter(p => p !== property)
      : [...value, property];
    onChange(newValue);
  };

  const normalizedCustomProperty = normalizeCustomProperty(customProperty);
  const customPropertyExists = normalizedCustomProperty !== ''
    && hasProperty(value, normalizedCustomProperty);

  const handleAddCustomProperty = () => {
    if (!normalizedCustomProperty || customPropertyExists) return;
    onChange(appendCustomProperty(value, normalizedCustomProperty));
    setCustomProperty('');
  };

  const options = useMemo(() => {
    const knownValues = new Set(PROPERTIES_OPTIONS.map((option) => option.value));
    const customOptions = value
      .filter((property) => !knownValues.has(property as typeof PROPERTIES_OPTIONS[number]['value']))
      .map((property) => ({ value: property, label: property, custom: true as const }));

    return [
      ...PROPERTIES_OPTIONS.map((option) => ({ ...option, custom: false as const })),
      ...customOptions,
    ];
  }, [value]);

  const selectedCount = value.length;
  const selectedLabels = value.map(prop => 
    PROPERTIES_OPTIONS.find(option => option.value === prop)?.label || prop
  );

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
          {options.map((option) => {
            const isSelected = value.includes(option.value);
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
                <span className="text-sm text-gray-700 flex-1">
                  {option.label}
                  {option.custom && (
                    <span className="block text-xs text-gray-400">Пользовательское свойство</span>
                  )}
                </span>
                {isSelected && <Check className="w-4 h-4 text-blue-600" />}
              </label>
            );
          })}
          <div className="sticky bottom-0 border-t border-gray-200 bg-white p-3">
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={customPropertyInputId}>
              Нет нужного свойства?
            </label>
            <div className="flex gap-2">
              <input
                id={customPropertyInputId}
                type="text"
                value={customProperty}
                onChange={(event) => setCustomProperty(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddCustomProperty();
                  }
                }}
                placeholder="Введите название"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleAddCustomProperty}
                disabled={!normalizedCustomProperty || customPropertyExists}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Plus className="h-4 w-4" />
                Добавить
              </button>
            </div>
            {customPropertyExists && (
              <p className="mt-1 text-xs text-amber-600">Это свойство уже выбрано.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PropertySelector;
