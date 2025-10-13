import React, { useState } from 'react';
import { UseFormRegister, FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest } from '../../types';
import { Library } from 'lucide-react';
import ImageGenerator from '../ImageGenerator';
import ImageUploader from '../ImageUploader';

interface ImageSectionProps {
  register: UseFormRegister<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
  setValue: UseFormSetValue<CreateCardRequest>;
  watch: UseFormWatch<CreateCardRequest>;
  onImageGenerated: (imageUrl: string) => void;
  onCreateEntity?: () => Promise<string>;
  entityId?: string;
  showImageLibrary: boolean;
  setShowImageLibrary: (show: boolean) => void;
}

export const ImageSection: React.FC<ImageSectionProps> = ({
  register,
  errors,
  setValue,
  watch,
  onImageGenerated,
  onCreateEntity,
  entityId,
  showImageLibrary,
  setShowImageLibrary
}) => {
  const memoizedWatchedValues = watch();
  const cardImage = watch('image_url') || '';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Изображение</h2>

      {/* Дополнительная информация для генерации изображения */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Дополнительная информация для генерации изображения
        </label>
        <textarea
          {...register('image_prompt_extra')}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Опишите особые пожелания к внешнему виду предмета (необязательно)"
        />
        <p className="mt-1 text-sm text-gray-500">
          Например: "с золотыми украшениями", "в стиле эльфийского оружия", "с рунами на лезвии"
        </p>
      </div>

      {/* Генератор изображений */}
      <ImageGenerator
        entityType="card"
        entityId={entityId || ''}
        entityName={memoizedWatchedValues.name}
        entityRarity={memoizedWatchedValues.rarity}
        entityDescription={memoizedWatchedValues.description}
        entityPromptExtra={memoizedWatchedValues.image_prompt_extra}
        onImageGenerated={onImageGenerated}
        onCreateEntity={onCreateEntity}
        disabled={!memoizedWatchedValues.name || memoizedWatchedValues.name === 'Название карты'}
        className="mb-4"
      />

      {/* Кнопка выбора из библиотеки */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowImageLibrary(true)}
          className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center space-x-2"
        >
          <Library size={20} />
          <span>Выбрать из библиотеки</span>
        </button>
      </div>
      
      {/* Загрузчик изображений */}
      <ImageUploader
        onImageUpload={onImageGenerated}
        currentImageUrl={cardImage}
        entityType="card"
        entityId={entityId || ''}
        enableCloudUpload={false}
      />
    </div>
  );
};
