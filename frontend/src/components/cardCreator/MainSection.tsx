import React, { useMemo } from 'react';
import { Control, Controller, FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest, DEFAULT_CUSTOM_RARITY_COLOR, type Rarity } from '../../types';
import RaritySelector from '../RaritySelector';
import { FormattedTextarea } from '../FormattedTextarea';
import { CURRENCIES } from '../../utils/currencies';

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
          customColor={memoizedWatchedValues.custom_rarity_color}
          onChange={(rarity) => {
            setValue('rarity', rarity);
            if (rarity !== 'custom') {
              setValue('custom_rarity_color', null);
            } else if (!memoizedWatchedValues.custom_rarity_color) {
              setValue('custom_rarity_color', DEFAULT_CUSTOM_RARITY_COLOR);
            }
          }}
          onCustomColorChange={(color) => setValue('custom_rarity_color', color)}
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

      {/* Цена, валюта и вес */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Цена</label>
          <input
            type="number"
            step="0.01"
            {...register('price', { valueAsNumber: true })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Валюта</label>
          <select
            {...register('price_currency')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Вес (фунты)</label>
          <input
            type="number"
            step="0.1"
            {...register('weight', { valueAsNumber: true })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0.0"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 mt-2">
        <input type="checkbox" {...register('price_abbreviated')} className="w-4 h-4" />
        <span className="text-sm text-gray-700">Сокращать цену (1200 → 1.2K)</span>
      </label>
    </div>
  );
};
