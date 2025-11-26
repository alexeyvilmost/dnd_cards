import React, { useEffect, useRef } from 'react';
import { UseFormRegister, FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest, Properties } from '../../types';
import { PROPERTIES_OPTIONS, BONUS_TYPE_OPTIONS, EQUIPMENT_SLOTS } from '../../types';
import { ITEM_TYPE_OPTIONS } from '../../constants/itemTypes';
import PropertySelector from '../PropertySelector';
import TagsInput from '../TagsInput';
import weaponTypesData from '../../../utils/weapon_types.json';
import { useToast } from '../../contexts/ToastContext';

interface EquipmentSectionProps {
  register: UseFormRegister<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
  setValue: UseFormSetValue<CreateCardRequest>;
  watch: UseFormWatch<CreateCardRequest>;
}

export const EquipmentSection: React.FC<EquipmentSectionProps> = ({ register, errors, setValue, watch }) => {
  const properties = watch('properties');
  const tags = watch('tags');
  const bonus_type = watch('bonus_type');
  const name = watch('name');
  const weapon_type = watch('weapon_type');
  const { showToast } = useToast();
  const lastProcessedName = useRef<string>('');

  // Функция для поиска типа оружия по названию
  const findWeaponTypeByName = (cardName: string): { name: string; russian_name: string } | null => {
    if (!cardName || cardName.trim() === '') return null;

    const normalizedName = cardName.trim().toLowerCase();
    
    // Ищем совпадение в всех категориях оружия
    for (const category of weaponTypesData.basic) {
      if (category.weapons) {
        for (const weapon of category.weapons) {
          const normalizedWeaponName = weapon.russian_name.toLowerCase();
          // Проверяем, содержит ли название карточки название оружия
          if (normalizedName.includes(normalizedWeaponName)) {
            return weapon;
          }
        }
      }
    }
    
    return null;
  };

  // Автоматическое заполнение типа оружия при изменении названия
  useEffect(() => {
    // Пропускаем если название не изменилось или пустое
    if (!name || name === lastProcessedName.current) {
      return;
    }

    // Пропускаем если weapon_type уже заполнен
    if (weapon_type) {
      lastProcessedName.current = name;
      return;
    }

    // Ищем совпадение
    const foundWeapon = findWeaponTypeByName(name);
    
    if (foundWeapon) {
      // Автоматически заполняем weapon_type
      setValue('weapon_type', foundWeapon.name);
      lastProcessedName.current = name;
      
      // Показываем уведомление
      showToast({
        type: 'info',
        title: 'Тип оружия автоматически заполнен',
        message: `Обнаружено оружие "${foundWeapon.russian_name}" в названии. Тип оружия установлен автоматически.`,
        duration: 5000,
      });
    } else {
      lastProcessedName.current = name;
    }
  }, [name, weapon_type, setValue, showToast]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Настройки снаряжения</h2>

      {/* Тип предмета и слот экипировки */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Тип предмета
          </label>
          <select
            {...register('type')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Выберите тип</option>
            {ITEM_TYPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Слот экипировки
          </label>
          <select
            {...register('slot')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Не экипируется</option>
            {EQUIPMENT_SLOTS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Теги */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Теги
        </label>
        <TagsInput
          value={tags || []}
          onChange={(tags) => setValue('tags', tags)}
          placeholder="Короткий меч, Магическое, Одноручное"
        />
      </div>

      {/* Настройка */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Настройка
        </label>
        <textarea
          {...register('attunement')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          placeholder="Описание настройки на артефакт..."
        />
      </div>

      {/* Свойства */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Свойства
        </label>
        <PropertySelector
          value={properties || []}
          onChange={(properties) => setValue('properties', properties)}
        />
      </div>

      {/* Бонус */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Тип бонуса
          </label>
          <select
            {...register('bonus_type')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Выберите тип</option>
            {BONUS_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Значение бонуса
          </label>
          <input
            {...register('bonus_value')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="+1"
          />
        </div>
      </div>

      {/* Тип урона и тип оружия - показывается только если выбран тип бонуса "Урон" */}
      {bonus_type === 'damage' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Тип урона
            </label>
            <select
              {...register('damage_type')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Выберите тип урона</option>
              <option value="slashing">Рубящий</option>
              <option value="piercing">Колющий</option>
              <option value="bludgeoning">Дробящий</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Тип оружия
            </label>
            <select
              {...register('weapon_type')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Выберите тип оружия</option>
              {weaponTypesData.basic.map(category => (
                category.weapons && category.weapons.length > 0 && (
                  <optgroup key={category.name} label={category.russian_name}>
                    {category.weapons.map(weapon => (
                      <option key={weapon.name} value={weapon.name}>
                        {weapon.russian_name}
                      </option>
                    ))}
                  </optgroup>
                )
              ))}
            </select>
          </div>
        </>
      )}

      {/* Тип брони - показывается только если выбран тип бонуса "Защита" */}
      {bonus_type === 'defense' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Тип брони
          </label>
          <select
            {...register('defense_type')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Выберите тип брони</option>
            <option value="light">Легкая</option>
            <option value="medium">Средняя</option>
            <option value="heavy">Тяжелая</option>
          </select>
        </div>
      )}
    </div>
  );
};
