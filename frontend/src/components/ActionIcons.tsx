import React, { useState, useEffect } from 'react';
import { actionsApi } from '../api/client';
import type { Action } from '../types';
import ActionPreview from './ActionPreview';

interface ActionIconsProps {
  actionIds: string[];
  className?: string;
}

export const ActionIcons: React.FC<ActionIconsProps> = ({ actionIds, className = '' }) => {
  const [actions, setActions] = useState<Record<string, Action>>({});
  const [loading, setLoading] = useState(true);
  const [hoveredAction, setHoveredAction] = useState<Action | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Загружаем действия из API
  useEffect(() => {
    const loadActions = async () => {
      if (!actionIds || actionIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const loadedActions: Record<string, Action> = {};

        // Загружаем действия параллельно по ID
        await Promise.all(
          actionIds.map(async (actionId) => {
            try {
              // Сначала пытаемся найти напрямую по card_number через getAction
              try {
                const action = await actionsApi.getAction(actionId);
                if (action && action.card_number === actionId) {
                  console.log(`[ActionIcons] Найдено действие ${actionId}:`, action.name);
                  loadedActions[actionId] = action;
                  return;
                }
              } catch (directError) {
                // Если прямой поиск не сработал, пробуем через поиск
                console.log(`[ActionIcons] Прямой поиск не сработал для ${actionId}, пробуем через поиск`);
              }
              
              // Если прямой поиск не сработал, используем поиск
              const response = await actionsApi.getActions({ search: actionId, limit: 100 });
              const action = response.actions.find(a => a.card_number === actionId);
              if (action) {
                console.log(`[ActionIcons] Найдено действие ${actionId} через поиск:`, action.name);
                loadedActions[actionId] = action;
              } else {
                console.warn(`[ActionIcons] Действие ${actionId} не найдено`);
              }
            } catch (error) {
              console.warn(`[ActionIcons] Ошибка загрузки действия ${actionId}:`, error);
            }
          })
        );

        console.log(`[ActionIcons] Загружено действий: ${Object.keys(loadedActions).length} из ${actionIds.length}`);
        setActions(loadedActions);
      } catch (error) {
        console.error('Ошибка загрузки действий:', error);
      } finally {
        setLoading(false);
      }
    };

    loadActions();
  }, [actionIds]);

  // Отслеживаем позицию мыши для тултипа
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    if (hoveredAction) {
      window.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [hoveredAction]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-pulse text-gray-400 text-sm">Загрузка действий...</div>
      </div>
    );
  }

  if (actionIds.length === 0 || Object.keys(actions).length === 0) {
    return null;
  }

  return (
    <>
      <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        {actionIds.map((actionId) => {
          const action = actions[actionId];
          if (!action) return null;

          return (
            <div
              key={actionId}
              className="relative group"
              onMouseEnter={() => setHoveredAction(action)}
              onMouseLeave={() => setHoveredAction(null)}
            >
              {/* Иконка действия */}
              <div className="w-10 h-10 rounded-lg bg-amber-900 shadow-md overflow-hidden cursor-pointer hover:shadow-lg hover:scale-105 transition-all">
                {action.image_url ? (
                  <img
                    src={action.image_url}
                    alt={action.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/default_image.png';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-amber-200 text-xl">
                    ⚔️
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Тултип с превью действия */}
      {hoveredAction && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${mousePosition.x + 15}px`,
            top: `${mousePosition.y + 15}px`,
          }}
        >
          <div className="scale-110 origin-top-left">
            <ActionPreview action={hoveredAction} disableHover={true} />
          </div>
        </div>
      )}
    </>
  );
};

