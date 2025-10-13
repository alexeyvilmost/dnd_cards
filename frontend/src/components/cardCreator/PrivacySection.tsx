import React from 'react';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { CreateCardRequest } from '../../types';

interface PrivacySectionProps {
  register: UseFormRegister<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
}

export const PrivacySection: React.FC<PrivacySectionProps> = ({ register, errors }) => {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Настройки приватности</h2>

      {/* Тип шаблона */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Тип шаблона
        </label>
        <select
          {...register('is_template')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="false">Обычная карта</option>
          <option value="template">Карта и шаблон</option>
          <option value="only_template">Только шаблон</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          Шаблоны используются для быстрого создания новых карт
        </p>
      </div>

      {/* Автор */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Автор
        </label>
        <input
          type="text"
          {...register('author')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Admin"
        />
      </div>

      {/* Источник */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Источник
        </label>
        <input
          type="text"
          {...register('source')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Player's Handbook"
        />
      </div>
    </div>
  );
};
