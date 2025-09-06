import React, { useState } from 'react';
import { Wand2, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { imagesApi } from '../api/imagesApi';

interface ImageGeneratorProps {
  entityType: 'card' | 'weapon_template';
  entityId: string;
  entityName: string;
  entityRarity: string;
  onImageGenerated: (imageUrl: string) => void;
  disabled?: boolean;
  className?: string;
}

const ImageGenerator: React.FC<ImageGeneratorProps> = ({
  entityType,
  entityId,
  entityName,
  entityRarity,
  onImageGenerated,
  disabled = false,
  className = '',
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);


  const handleGenerate = async () => {
    if (!entityName.trim()) {
      setError('Введите название карты для генерации изображения');
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setSuccess(false);

      const response = await imagesApi.generateImage(entityType, entityId);
      
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

      <button
        type="button"
        onClick={handleGenerate}
        disabled={disabled || isGenerating || !entityName.trim()}
        className={`
          w-full flex items-center justify-center space-x-2 px-4 py-2 rounded-lg border
          transition-all duration-200
          ${disabled || !entityName.trim()
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
            <span>Сгенерировать изображение</span>
          </>
        )}
      </button>

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
