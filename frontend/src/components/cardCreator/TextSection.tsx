import React, { useMemo } from 'react';
import { UseFormRegister, FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest } from '../../types';

interface TextSectionProps {
  register: UseFormRegister<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
  setValue: UseFormSetValue<CreateCardRequest>;
  watch: UseFormWatch<CreateCardRequest>;
}

export const TextSection: React.FC<TextSectionProps> = ({ register, errors, setValue, watch }) => {
  const memoizedWatchedValues = useMemo(() => watch(), [watch]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Текст</h2>

      {/* Расширенная карта */}
      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            {...register('is_extended')}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Расширенная карта</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Расширенная карта имеет больший размер и больше места для описания
        </p>
      </div>

      {/* Настройки текста описания */}
      <div className="space-y-4 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700">Настройки текста описания</h3>
        
        {/* Дублирование поля описания */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Описание
          </label>
          <textarea
            {...register('description', { required: 'Описание обязательно' })}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Введите описание эффекта"
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
          )}
        </div>
        
        {/* Выравнивание текста и размер шрифта */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Выравнивание текста
            </label>
            <select
              {...register('text_alignment')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">По умолчанию (по центру)</option>
              <option value="left">Влево</option>
              <option value="center">По центру</option>
              <option value="right">Вправо</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Размер шрифта (8-24)
            </label>
            <input
              type="number"
              min="8"
              max="24"
              {...register('text_font_size', { valueAsNumber: true })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="14 (по умолчанию)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Пустое = авторазмер
            </p>
          </div>
        </div>
      </div>

      {/* Настройки отображения */}
      <div className="space-y-4 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700">Настройки отображения</h3>
        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              {...register('show_detailed_description')}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">
              Показывать детальное описание вместо свойств
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-1">
            В расширенных картах под картинкой будет показано детальное описание вместо списка свойств
          </p>
        </div>
      </div>

      {/* Настройки детального описания */}
      <div className="space-y-4 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-700">Настройки детального описания</h3>
        
        {/* Детальное описание */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Детальное описание
          </label>
          <textarea
            {...register('detailed_description')}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Введите подробное описание (необязательно)"
          />
          <p className="mt-1 text-sm text-gray-500">
            Подробное описание будет отображаться в модальном окне с детальным просмотром карты
          </p>
        </div>
        
        {/* Выравнивание и размер шрифта детального описания */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Выравнивание детального описания
            </label>
            <select
              {...register('detailed_description_alignment')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">По умолчанию (влево)</option>
              <option value="left">Влево</option>
              <option value="center">По центру</option>
              <option value="right">Вправо</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Размер шрифта детального описания (8-24)
            </label>
            <input
              type="number"
              min="8"
              max="24"
              {...register('detailed_description_font_size', { valueAsNumber: true })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="12 (по умолчанию)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Пустое = авторазмер
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
