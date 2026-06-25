import type { CSSProperties } from 'react';
import { RARITY_OPTIONS, DEFAULT_CUSTOM_RARITY_COLOR, type Rarity } from '../types';

interface RaritySelectorProps {
  value: string;
  customColor?: string | null;
  onChange: (value: Rarity) => void;
  onCustomColorChange?: (color: string) => void;
  error?: string;
}

const RARITY_CIRCLE_CLASS: Record<string, string> = {
  common: 'bg-gray-300',
  uncommon: 'bg-green-500',
  rare: 'bg-blue-500',
  very_rare: 'bg-purple-500',
  artifact: 'bg-amber-500',
  relic: 'bg-red-500',
};

const RARITY_TEXT_CLASS: Record<string, string> = {
  common: 'text-gray-600',
  uncommon: 'text-green-600',
  rare: 'text-blue-600',
  very_rare: 'text-purple-600',
  artifact: 'text-amber-600',
  relic: 'text-red-600',
  custom: 'text-gray-700',
};

const RaritySelector = ({
  value,
  customColor = DEFAULT_CUSTOM_RARITY_COLOR,
  onChange,
  onCustomColorChange,
  error,
}: RaritySelectorProps) => {
  const selectedOption = RARITY_OPTIONS.find((option) => option.value === value);
  const resolvedCustomColor = customColor || DEFAULT_CUSTOM_RARITY_COLOR;

  const getCircleStyle = (rarity: string): CSSProperties | undefined => {
    if (rarity === 'custom') {
      return { backgroundColor: resolvedCustomColor };
    }
    return undefined;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {RARITY_OPTIONS.map((option) => (
            <div
              key={option.value}
              className="flex flex-col items-center space-y-1 cursor-pointer"
              onClick={() => onChange(option.value as Rarity)}
              title={option.label}
            >
              <div
                className={`w-8 h-8 rounded-full transition-all duration-200 ${
                  RARITY_CIRCLE_CLASS[option.value] ?? 'bg-gray-300'
                } ${
                  value === option.value
                    ? 'ring-2 ring-black ring-offset-2'
                    : 'hover:ring-2 hover:ring-gray-400 hover:ring-offset-1'
                }`}
                style={getCircleStyle(option.value)}
              />
            </div>
          ))}
        </div>

        {value && (
          <div className="flex items-center space-x-2">
            <span className="text-gray-400">•</span>
            <span className={`font-medium ${RARITY_TEXT_CLASS[value] ?? 'text-gray-600'}`}>
              {selectedOption?.label}
            </span>
          </div>
        )}
      </div>

      {value === 'custom' && onCustomColorChange && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600">Цвет редкости:</label>
          <input
            type="color"
            value={resolvedCustomColor}
            onChange={(e) => onCustomColorChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1"
            aria-label="Выбор цвета кастомной редкости"
          />
          <input
            type="text"
            value={resolvedCustomColor}
            onChange={(e) => {
              const next = e.target.value;
              if (/^#[0-9A-Fa-f]{0,6}$/.test(next)) {
                onCustomColorChange(next);
              }
            }}
            onBlur={() => {
              if (!/^#[0-9A-Fa-f]{6}$/.test(resolvedCustomColor)) {
                onCustomColorChange(DEFAULT_CUSTOM_RARITY_COLOR);
              }
            }}
            className="w-28 rounded border border-gray-300 px-2 py-1 font-mono text-sm"
            placeholder="#RRGGBB"
          />
        </div>
      )}

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
};

export default RaritySelector;
