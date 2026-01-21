import React from 'react';
import { X, Clock } from 'lucide-react';
import { ActiveEffect } from '../types';

interface ActiveEffectsListProps {
  effects: ActiveEffect[];
  onEndEffect: (effectId: string) => void;
}

export const ActiveEffectsList: React.FC<ActiveEffectsListProps> = ({
  effects,
  onEndEffect,
}) => {
  if (!effects || effects.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        Нет активных эффектов
      </div>
    );
  }

  const getDurationText = (effect: ActiveEffect): string => {
    if (effect.duration_type === 'rounds') {
      return `${effect.duration_remaining} ход${effect.duration_remaining === 1 ? '' : effect.duration_remaining < 5 ? 'а' : 'ов'}`;
    } else if (effect.duration_type === 'minutes') {
      return `${effect.duration_remaining} мин.`;
    } else if (effect.duration_type === 'hours') {
      return `${effect.duration_remaining} ч.`;
    } else {
      return 'Постоянно';
    }
  };

  return (
    <div className="space-y-2">
      {effects.map((effect) => (
        <div
          key={effect.effect_id}
          className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-3 hover:bg-red-100 transition-colors"
        >
          <div className="flex items-center space-x-3 flex-1">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white font-bold">
                {effect.name.charAt(0).toUpperCase()}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900">{effect.name}</div>
              {effect.duration_type !== 'until_dispelled' && (
                <div className="flex items-center space-x-1 text-sm text-gray-600 mt-1">
                  <Clock className="w-4 h-4" />
                  <span>Осталось: {getDurationText(effect)}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => onEndEffect(effect.effect_id)}
            className="ml-4 p-2 hover:bg-red-200 rounded transition-colors"
            title="Завершить эффект"
          >
            <X className="w-5 h-5 text-red-600" />
          </button>
        </div>
      ))}
    </div>
  );
};
