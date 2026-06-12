import React, { useMemo } from 'react';
import { Control, Controller, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest } from '../../types';
import RaritySelector from '../RaritySelector';
import { FormattedTextarea } from '../FormattedTextarea';

interface MainSectionProps {
  register: UseFormRegister<CreateCardRequest>;
  control: Control<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
  setValue: UseFormSetValue<CreateCardRequest>;
  watch: UseFormWatch<CreateCardRequest>;
}

export const MainSection: React.FC<MainSectionProps> = ({ register, control, errors, setValue, watch }) => {
  const memoizedWatchedValues = useMemo(() => watch(), [watch]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Основная информация</h2>
      
      {/* Название */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Название карты
        </label>
        <input
          {...register('name', { required: 'Название обязательно' })}
          type="text"
          placeholder="Введите название карты"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Редкость */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Редкость
        </label>
        <RaritySelector
          value={memoizedWatchedValues.rarity}
          onChange={(rarity) => setValue('rarity', rarity)}
        />
      </div>

      {/* Описание */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Описание
        </label>
        <Controller
          name="description"
          control={control}
          rules={{ required: 'Описание обязательно' }}
          render={({ field, fieldState }) => (
            <FormattedTextarea
              value={field.value || ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              rows={4}
              placeholder="Введите описание эффекта"
              error={fieldState.error?.message}
            />
          )}
        />
      </div>

      {/* Цена и вес */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Цена (золото)
          </label>
          <input
            type="number"
            {...register('price', { valueAsNumber: true })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Вес (фунты)
          </label>
          <input
            type="number"
            step="0.1"
            {...register('weight', { valueAsNumber: true })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0.0"
          />
        </div>
      </div>
    </div>
  );
};
