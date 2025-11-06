import type { PassiveEffect } from '../types';
import { RARITY_OPTIONS } from '../types';
import { getRarityColor } from '../utils/rarityColors';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';

interface EffectPreviewProps {
  effect: PassiveEffect;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const EffectPreview = ({ effect, className = '', disableHover = false, onClick }: EffectPreviewProps) => {
  const isExtended = Boolean(effect.is_extended);

  const getTitleFontSize = (title: string) => {
    if (isExtended) {
      if (title.length > 20) return 'text-lg';
      if (title.length > 15) return 'text-xl';
      return 'text-xl';
    } else {
      if (title.length > 20) return 'text-xs';
      if (title.length > 15) return 'text-sm';
      return 'text-sm';
    }
  };

  const getBorderColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'border-gray-400';
      case 'uncommon': return 'border-green-500';
      case 'rare': return 'border-blue-500';
      case 'very_rare': return 'border-purple-500';
      case 'artifact': return 'border-orange-500';
      default: return 'border-gray-300';
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getRarityGlowColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'group-hover:shadow-gray-400/50';
      case 'uncommon': return 'group-hover:shadow-green-400/50';
      case 'rare': return 'group-hover:shadow-blue-400/50';
      case 'very_rare': return 'group-hover:shadow-purple-400/50';
      case 'artifact': return 'group-hover:shadow-orange-400/50';
      default: return 'group-hover:shadow-gray-400/50';
    }
  };

  const getTitleClass = (rarity: string, name: string) => {
    const baseClass = `${getTitleFontSize(name)} font-fantasy font-bold leading-tight mb-0.5 min-h-[1.2rem] flex items-center justify-center`;
    const rarityColor = getRarityColor(rarity);
    
    switch (rarity) {
      case 'very_rare': return `${baseClass} title-gradient-very-rare`;
      case 'artifact': return `${baseClass} title-gradient-artifact`;
      default: return `${baseClass} ${rarityColor}`;
    }
  };

  const getEffectTypeLabel = (effectType: string) => {
    return PASSIVE_EFFECT_TYPE_OPTIONS.find(opt => opt.value === effectType)?.label || effectType;
  };

  return (
    <div 
      className={`card-preview relative bg-white rounded-lg shadow-md overflow-hidden ${getBorderColor(effect.rarity)} border-4 ${className} transition-all duration-300 ease-out group ${getRarityGlowColor(effect.rarity)} ${isExtended ? 'w-[397px] h-[280px]' : 'w-[198px] h-[280px]'} ${!disableHover ? 'hover:scale-105 hover:-translate-y-2 hover:shadow-2xl' : ''} flex flex-col ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {/* Метка редкости */}
      <div className="absolute top-0.5 left-1 text-sm font-bold select-none">
        <span 
          title={getRaritySymbolDescription(effect.rarity)}
          aria-label={getRaritySymbolDescription(effect.rarity)}
          className={`${getRarityColor(effect.rarity)} drop-shadow-lg`}
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }}
        >
          {getRaritySymbol(effect.rarity)}
        </span>
      </div>

      {isExtended ? (
        // Расширенный формат
        <>
          <div className="flex flex-1">
            {/* Левая половина */}
            <div className="w-1/2 flex flex-col">
              <div className="px-1 py-0.5 text-center">
                <h3 className={getTitleClass(effect.rarity, effect.name)}>
                  {effect.name}
                </h3>
              </div>

              <div className="flex items-center justify-center w-full h-36">
                {effect.image_url && effect.image_url.trim() !== '' ? (
                  <img
                    src={effect.image_url}
                    alt={effect.name}
                    className="w-full h-full object-contain rounded"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/default_image.png';
                    }}
                  />
                ) : (
                  <img
                    src="/default_image.png"
                    alt="Default D&D"
                    className="w-full h-full object-contain rounded"
                  />
                )}
              </div>

              <div className="px-2 pt-0 pb-2 bg-gray-50 flex-1 min-h-[60px]">
                <div className="text-xs text-gray-600 space-y-1">
                  <div><strong>Тип:</strong> {getEffectTypeLabel(effect.effect_type)}</div>
                  {effect.condition_description && (
                    <div><strong>Условие:</strong> {effect.condition_description}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Правая половина - описание */}
            <div className="w-1/2 px-2 pt-2 pb-2 bg-white flex-1 flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <p 
                  className={`text-xs font-fantasy whitespace-pre-wrap`}
                  style={{
                    fontSize: effect.description_font_size ? `${effect.description_font_size}px` : '12px',
                    textAlign: (effect.text_alignment || 'center') as 'left' | 'center' | 'right'
                  }}
                >
                  {effect.description || 'Нет описания'}
                </p>
                {effect.show_detailed_description && effect.detailed_description && (
                  <p 
                    className={`text-xs font-fantasy whitespace-pre-wrap mt-2`}
                    style={{
                      fontSize: effect.detailed_description_font_size ? `${effect.detailed_description_font_size}px` : '12px',
                      textAlign: (effect.detailed_description_alignment || 'left') as 'left' | 'center' | 'right'
                    }}
                  >
                    {effect.detailed_description}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Нижняя часть - номер карты */}
          <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center text-xs">
            <span className={`font-mono ${effect.card_number ? 'text-gray-900' : 'text-gray-400'}`}>
              {effect.card_number || 'Без номера'}
            </span>
          </div>
        </>
      ) : (
        // Стандартный формат
        <>
          <div className="px-1 py-0.5 text-center">
            <h3 className={getTitleClass(effect.rarity, effect.name)}>
              {effect.name}
            </h3>
          </div>

          <div className="flex items-center justify-center w-full h-36">
            {effect.image_url && effect.image_url.trim() !== '' ? (
              <img
                src={effect.image_url}
                alt={effect.name}
                className="w-full h-full object-contain rounded"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '/default_image.png';
                }}
              />
            ) : (
              <img
                src="/default_image.png"
                alt="Default D&D"
                className="w-full h-full object-contain rounded"
              />
            )}
          </div>

          <div className="px-2 pt-1 pb-2 bg-gray-50 flex-1 min-h-[60px] overflow-y-auto">
            <p 
              className={`text-xs font-fantasy whitespace-pre-wrap`}
              style={{
                fontSize: effect.description_font_size ? `${effect.description_font_size}px` : '10px',
                textAlign: (effect.text_alignment || 'center') as 'left' | 'center' | 'right'
              }}
            >
              {effect.description || 'Нет описания'}
            </p>
          </div>

          {/* Нижняя часть */}
          <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center text-xs">
            <span className={`font-mono ${effect.card_number ? 'text-gray-900' : 'text-gray-400'}`}>
              {effect.card_number || 'Без номера'}
            </span>
            <div className="text-gray-600 text-[10px]">
              {getEffectTypeLabel(effect.effect_type)}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EffectPreview;
