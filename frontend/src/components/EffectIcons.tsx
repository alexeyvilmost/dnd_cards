import React, { useState, useEffect } from 'react';
import { effectsApi } from '../api/client';
import type { PassiveEffect } from '../types';
import EffectPreview from './EffectPreview';

interface EffectIconsProps {
  effectIds: string[];
  className?: string;
}

export const EffectIcons: React.FC<EffectIconsProps> = ({ effectIds, className = '' }) => {
  const [effects, setEffects] = useState<Record<string, PassiveEffect>>({});
  const [loading, setLoading] = useState(true);
  const [hoveredEffect, setHoveredEffect] = useState<PassiveEffect | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Загружаем эффекты из API
  useEffect(() => {
    const loadEffects = async () => {
      if (!effectIds || effectIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const loadedEffects: Record<string, PassiveEffect> = {};

        // Загружаем эффекты параллельно
        await Promise.all(
          effectIds.map(async (effectId) => {
            try {
              // Ищем по card_number через поиск
              const effect = await effectsApi.getEffectByCardNumber(effectId);
              if (effect) {
                console.log(`[EffectIcons] Найден эффект ${effectId}:`, effect.name);
                loadedEffects[effectId] = effect;
              } else {
                console.warn(`[EffectIcons] Эффект ${effectId} не найден`);
              }
            } catch (error) {
              console.warn(`[EffectIcons] Ошибка загрузки эффекта ${effectId}:`, error);
            }
          })
        );
        
        console.log(`[EffectIcons] Загружено эффектов: ${Object.keys(loadedEffects).length} из ${effectIds.length}`);

        setEffects(loadedEffects);
      } catch (error) {
        console.error('Ошибка загрузки эффектов:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEffects();
  }, [effectIds]);

  // Отслеживаем позицию мыши для тултипа
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    if (hoveredEffect) {
      window.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [hoveredEffect]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-pulse text-gray-400 text-sm">Загрузка эффектов...</div>
      </div>
    );
  }

  if (effectIds.length === 0 || Object.keys(effects).length === 0) {
    return null;
  }

  return (
    <>
      <div className={`flex items-center gap-2 flex-wrap ${className}`}>
        {effectIds.map((effectId) => {
          const effect = effects[effectId];
          if (!effect) return null;

          return (
            <div
              key={effectId}
              className="relative group"
              onMouseEnter={() => setHoveredEffect(effect)}
              onMouseLeave={() => setHoveredEffect(null)}
            >
              {/* Иконка эффекта */}
              <div className="w-10 h-10 rounded-lg bg-slate-800 shadow-md overflow-hidden cursor-pointer hover:shadow-lg hover:scale-105 transition-all">
                {effect.image_url ? (
                  <img
                    src={effect.image_url}
                    alt={effect.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/default_image.png';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">
                    ✨
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Тултип с превью эффекта */}
      {hoveredEffect && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${mousePosition.x + 15}px`,
            top: `${mousePosition.y + 15}px`,
          }}
        >
          <div className="scale-110 origin-top-left">
            <EffectPreview effect={hoveredEffect} disableHover={true} />
          </div>
        </div>
      )}
    </>
  );
};

