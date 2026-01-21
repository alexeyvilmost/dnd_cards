import React from 'react';
import { RotateCcw, Moon } from 'lucide-react';

interface TurnControlsProps {
  onTurnEnd: () => void;
  onLongRest: () => void;
  disabled?: boolean;
}

export const TurnControls: React.FC<TurnControlsProps> = ({
  onTurnEnd,
  onLongRest,
  disabled = false,
}) => {
  return (
    <div className="flex items-center space-x-4">
      <button
        onClick={onTurnEnd}
        disabled={disabled}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg border-2 border-black transition-all ${
          disabled
            ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700 text-white hover:scale-105 shadow-lg'
        }`}
        title="Завершить текущий ход (обновляет действия, уменьшает длительность эффектов)"
      >
        <RotateCcw className="w-5 h-5" />
        <span>Следующий ход</span>
      </button>
      
      <button
        onClick={onLongRest}
        disabled={disabled}
        className={`flex items-center space-x-2 px-4 py-2 rounded-lg border-2 border-black transition-all ${
          disabled
            ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
            : 'bg-purple-600 hover:bg-purple-700 text-white hover:scale-105 shadow-lg'
        }`}
        title="Длинный отдых (восстанавливает ресурсы, здоровье до максимума)"
      >
        <Moon className="w-5 h-5" />
        <span>Следующий день</span>
      </button>
    </div>
  );
};
