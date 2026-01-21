import React, { useState, useEffect } from 'react';
import { X, Undo2, CheckCircle, Info, AlertCircle } from 'lucide-react';
import type { Effect } from '../types';
import { getRussianName } from '../utils/russianTranslations';

export interface ToastProps {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
  onUndo?: () => void;
  undoLabel?: string;
  effects?: Effect[];
}

const Toast: React.FC<ToastProps> = ({
  id,
  type,
  title,
  message,
  duration = 10000,
  onClose,
  onUndo,
  undoLabel = 'Отменить',
  effects
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Анимация появления
    const showTimer = setTimeout(() => setIsVisible(true), 100);
    
    // Автоматическое скрытие
    const hideTimer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [duration]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => {
      onClose(id);
    }, 300);
  };

  const handleUndo = () => {
    if (onUndo) {
      onUndo();
      handleClose();
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBackgroundColor = () => {
    return 'bg-white border-gray-200';
  };

  const getLeftBorderColor = () => {
    switch (type) {
      case 'success':
        return 'border-l-4 border-l-green-500';
      case 'info':
        return 'border-l-4 border-l-blue-500';
      case 'warning':
        return 'border-l-4 border-l-yellow-500';
      case 'error':
        return 'border-l-4 border-l-red-500';
      default:
        return 'border-l-4 border-l-blue-500';
    }
  };

  const getTextColor = () => {
    return 'text-gray-800';
  };

  return (
    <div
      className={`
        max-w-sm w-full
        transform transition-all duration-300 ease-in-out
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        ${getBackgroundColor()}
        ${getLeftBorderColor()}
        border rounded-lg shadow-lg p-4
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${getTextColor()}`}>
            {title}
          </div>
          
          {message && (
            <div className={`text-sm mt-1 ${getTextColor()} opacity-90`}>
              {message.split('\n').map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          )}
          
          {/* Список эффектов */}
          {effects && effects.length > 0 && (
            <div className="mt-2 space-y-1">
              {effects.map((effect, index) => {
                const russianName = getRussianName(effect.targetType, effect.targetSpecific);
                const typeName = effect.targetType === 'characteristic' ? 'Характеристика' : 
                                effect.targetType === 'saving_throw' ? 'Спасбросок' : 'Навык';
                return (
                  <div key={index} className={`text-xs ${getTextColor()} opacity-75`}>
                    • {typeName} - {russianName} {effect.modifier}{effect.value}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Кнопки действий */}
          <div className="flex items-center gap-2 mt-3">
            {onUndo && (
              <button
                onClick={handleUndo}
                className="
                  flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium
                  transition-colors hover:bg-gray-100
                  text-gray-600 hover:text-gray-800
                "
              >
                <Undo2 className="w-3 h-3" />
                {undoLabel}
              </button>
            )}
            
            <button
              onClick={handleClose}
              className="
                flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium
                transition-colors hover:bg-gray-100
                text-gray-600 hover:text-gray-800
              "
            >
              <X className="w-3 h-3" />
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Toast;
