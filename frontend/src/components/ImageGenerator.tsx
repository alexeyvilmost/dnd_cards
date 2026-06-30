import React, { useState } from 'react';
import { Wand2, Loader2, AlertCircle, CheckCircle, Gamepad2, BookOpen } from 'lucide-react';
import { imagesApi, type ImageGenerationStyle, type ImageGenerationQuality } from '../api/imagesApi';

interface ImageGeneratorProps {
  entityType: 'card' | 'weapon_template';
  entityId?: string; // Опционально для новых карт
  entityName: string;
  entityRarity: string;
  entityDescription?: string;
  entityPromptExtra?: string;
  entityItemType?: string;
  entityWeaponType?: string;
  entitySlot?: string;
  entityProperties?: string[];
  onImageGenerated: (imageUrl: string) => void;
  disabled?: boolean;
  className?: string;
  // Колбэк для создания карты перед генерацией (если нет ID)
  onCreateEntity?: () => Promise<string>; // Возвращает ID созданной сущности
  variant?: 'full' | 'compact';
}

const ImageGenerator: React.FC<ImageGeneratorProps> = ({
  entityType,
  entityId,
  entityName,
  entityRarity,
  entityDescription,
  entityPromptExtra,
  entityItemType,
  entityWeaponType,
  entitySlot,
  entityProperties,
  onImageGenerated,
  disabled = false,
  className = '',
  onCreateEntity,
  variant = 'full',
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [style, setStyle] = useState<ImageGenerationStyle>('fantasy');
  const [quality, setQuality] = useState<ImageGenerationQuality>('high');


  const handleGenerate = async () => {
    if (!entityName.trim()) {
      setError('Введите название карты для генерации изображения');
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(false);

      let targetEntityId = entityId;

      // Если нет ID и есть колбэк для создания, создаем сущность
      if (!targetEntityId && onCreateEntity) {
        try {
          targetEntityId = await onCreateEntity();
        } catch (createError) {
          setError('Не удалось создать карту перед генерацией');
          setIsGenerating(false);
          return;
        }
      }

      // Если все еще нет ID, показываем ошибку
      if (!targetEntityId) {
        setError('Сначала сохраните карту, затем генерируйте изображение');
        setIsGenerating(false);
        return;
      }

      const response = await imagesApi.generateImage(entityType, targetEntityId, undefined, {
        name: entityName,
        description: entityDescription || '',
        rarity: entityRarity,
        image_prompt_extra: entityPromptExtra,
        type: entityItemType,
        weapon_type: entityWeaponType,
        slot: entitySlot,
        properties: entityProperties,
      }, style, quality);
      
      if (response.success) {
        onImageGenerated(response.image_url);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError('Не удалось сгенерировать изображение');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации изображения');
    } finally {
      setIsGenerating(false);
    }
  };


  const getRarityLabel = (rarity: string) => {
    switch (rarity) {
      case 'common':
        return 'Обычная';
      case 'uncommon':
        return 'Необычная';
      case 'rare':
        return 'Редкая';
      case 'very_rare':
        return 'Очень редкая';
      case 'artifact':
        return 'Артефакт';
      default:
        return rarity;
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common':
        return 'text-gray-600';
      case 'uncommon':
        return 'text-green-600';
      case 'rare':
        return 'text-blue-600';
      case 'very_rare':
        return 'text-purple-600';
      case 'artifact':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  const isGenerateDisabled =
    disabled || isGenerating || !entityName.trim() || (!entityId && !onCreateEntity);

  if (variant === 'compact') {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerateDisabled}
          title="Сгенерировать изображение"
          className={`
            flex items-center justify-center w-10 h-10 rounded-lg shrink-0
            transition-all duration-200
            ${isGenerateDisabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : isGenerating
              ? 'bg-purple-400 text-white'
              : success
              ? 'bg-green-500 text-white'
              : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-md hover:shadow-lg'
            }
          `}
        >
          {isGenerating ? (
            <Loader2 size={18} className="animate-spin" />
          ) : success ? (
            <CheckCircle size={18} />
          ) : (
            <Wand2 size={18} />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Генерация изображения</h3>
          <p className="text-xs text-gray-500">
            Создать изображение с помощью ИИ на основе названия и редкости
          </p>
        </div>
        <div className="text-right">
          <div className={`text-xs font-medium ${getRarityColor(entityRarity)}`}>
            {getRarityLabel(entityRarity)}
          </div>
          {entityRarity !== 'common' && (
            <div className="text-xs text-gray-500">
              С цветовым акцентом
            </div>
          )}
        </div>
      </div>

      {/* Переключатель стиля */}
      <div>
        <div className="text-xs font-medium text-gray-700 mb-1">Стиль</div>
        <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg">
          <button
            type="button"
            onClick={() => setStyle('fantasy')}
            disabled={isGenerating}
            className={`flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              style === 'fantasy'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <BookOpen size={14} />
            <span>Фэнтези</span>
          </button>
          <button
            type="button"
            onClick={() => setStyle('game')}
            disabled={isGenerating}
            className={`flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              style === 'game'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Gamepad2 size={14} />
            <span>Видеоигровой</span>
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {style === 'fantasy'
            ? 'Книжная иллюстрация в стиле официальных артов D&D'
            : 'Яркая видеоигровая иконка предмета'}
        </p>
      </div>

      {/* Переключатель качества */}
      <div>
        <div className="text-xs font-medium text-gray-700 mb-1">Качество</div>
        <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-lg">
          {([
            { value: 'low', label: 'Низкое' },
            { value: 'medium', label: 'Среднее' },
            { value: 'high', label: 'Высокое' },
          ] as { value: ImageGenerationQuality; label: string }[]).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setQuality(option.value)}
              disabled={isGenerating}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                quality === option.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Чем выше качество, тем дольше и дороже генерация
        </p>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={disabled || isGenerating || !entityName.trim() || (!entityId && !onCreateEntity)}
        className={`
          w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg border
          transition-all duration-200
          ${disabled || !entityName.trim() || (!entityId && !onCreateEntity)
            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
            : isGenerating
            ? 'bg-blue-100 border-blue-300 text-blue-700'
            : success
            ? 'bg-green-100 border-green-300 text-green-700'
            : 'bg-gradient-to-r from-purple-500 to-pink-500 border-transparent text-white hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-xl'
          }
        `}
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>Генерация...</span>
          </>
        ) : success ? (
          <>
            <CheckCircle size={16} />
            <span>Готово!</span>
          </>
        ) : (
          <>
            <Wand2 size={16} />
            <span>{entityId || onCreateEntity ? 'Сгенерировать изображение' : 'Сначала сохраните карту'}</span>
          </>
        )}
      </button>

      {!entityId && !onCreateEntity && (
        <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
          💡 Сначала сохраните карту, чтобы сгенерировать для неё изображение
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-red-600 text-sm">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {!entityName.trim() && (
        <div className="text-xs text-gray-500">
          Введите название карты для генерации изображения
        </div>
      )}

    </div>
  );
};

export default ImageGenerator;
