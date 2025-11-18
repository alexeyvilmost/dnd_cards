import type { PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';

interface EffectPreviewProps {
  effect: PassiveEffect;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const EffectPreview = ({ effect, className = '', disableHover = false, onClick }: EffectPreviewProps) => {
  const getEffectTypeLabel = (effectType: string) => {
    return PASSIVE_EFFECT_TYPE_OPTIONS.find(opt => opt.value === effectType)?.label || effectType;
  };

  return (
    <div 
      className={`relative bg-slate-800 rounded-lg shadow-md overflow-visible border-black border-2 ${className} transition-all duration-300 ease-out group ${!disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} flex flex-col w-[350px] ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Изображение в правом верхнем углу, вылезает за пределы */}
      {effect.image_url && effect.image_url.trim() !== '' && (
        <div className="absolute -top-6 -right-6 w-32 h-32 z-10 pointer-events-none">
          <img
            src={effect.image_url}
            alt={effect.name}
            className="w-full h-full object-contain"
            style={{
              filter: 'drop-shadow(0 0 12px rgba(59, 130, 246, 0.6))',
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = '/default_image.png';
            }}
          />
        </div>
      )}

      {/* Контент карточки */}
      <div className="flex flex-col p-5 text-white relative z-0">
        {/* Название */}
        <div className="mb-2">
          <h3 className="text-xl font-bold text-white font-fantasy">
            {effect.name || 'Название эффекта'}
          </h3>
        </div>

        {/* Тип эффекта */}
        <div className="mb-3">
          <span className="text-sm text-gray-300">
            {getEffectTypeLabel(effect.effect_type)}
          </span>
        </div>

        {/* Описание */}
        <div className="mb-4 flex-1">
          <p 
            className="text-white font-fantasy whitespace-pre-wrap leading-relaxed"
            style={{
              fontSize: effect.description_font_size ? `${effect.description_font_size}px` : '14px',
              textAlign: (effect.text_alignment || 'left') as 'left' | 'center' | 'right'
            }}
          >
            {effect.description || 'Нет описания'}
          </p>
        </div>

        {/* Дополнительное описание, если включено */}
        {effect.show_detailed_description && effect.detailed_description && (
          <div className="mb-4">
            <p 
              className="text-white font-fantasy whitespace-pre-wrap leading-relaxed"
              style={{
                fontSize: effect.detailed_description_font_size ? `${effect.detailed_description_font_size}px` : '12px',
                textAlign: (effect.detailed_description_alignment || 'left') as 'left' | 'center' | 'right'
              }}
            >
              {effect.detailed_description}
            </p>
          </div>
        )}

        {/* Условие, если есть */}
        {effect.condition_description && (
          <div className="mb-2 text-sm text-gray-300">
            <strong>Условие:</strong> {effect.condition_description}
          </div>
        )}
      </div>
    </div>
  );
};

export default EffectPreview;
