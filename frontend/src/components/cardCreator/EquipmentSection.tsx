import React, { useEffect, useRef } from 'react';
import { UseFormRegister, FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest, Properties, CardRef } from '../../types';
import { BONUS_TYPE_OPTIONS, EQUIPMENT_SLOTS } from '../../types';
import { ITEM_TYPE_OPTIONS, CONTAINER_MODE_OPTIONS } from '../../constants/itemTypes';
import ItemRefSelector from '../ItemRefSelector';
import { PHYSICAL_DAMAGE_TYPES, ELEMENTAL_DAMAGE_TYPES } from '../../utils/damageTypes';
import PropertySelector from '../PropertySelector';
import TagsInput from '../TagsInput';
import weaponTypesData from '../../../utils/weapon_types.json';
import { useToast } from '../../contexts/ToastContext';
import { useMasteryEffects } from '../../utils/mastery';

interface EquipmentSectionProps {
  register: UseFormRegister<CreateCardRequest>;
  errors: FieldErrors<CreateCardRequest>;
  setValue: UseFormSetValue<CreateCardRequest>;
  watch: UseFormWatch<CreateCardRequest>;
}

export const EquipmentSection: React.FC<EquipmentSectionProps> = ({ register, setValue, watch }) => {
  const properties = watch('properties');
  const tags = watch('tags');
  const bonus_type = watch('bonus_type');
  const name = watch('name');
  const weapon_type = watch('weapon_type');
  const { showToast } = useToast();
  // Список мастерств — данные (эффекты type='Эффект мастерства'), не хардкод.
  const masteryEffects = useMasteryEffects();
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

      {/* Контейнер — показывается только для типа "Контейнер" */}
      {watch('type') === 'container' && (
        <div className="border-t border-gray-200 pt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Тип контейнера</label>
            <select
              {...register('container_mode')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Выберите тип</option>
              {CONTAINER_MODE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              «Всё» — при использовании выдаёт весь список; «На выбор» — одно из содержимого.
            </p>
          </div>
          <ItemRefSelector
            label="Содержимое контейнера"
            value={(watch('contents') as CardRef[]) || []}
            onChange={(refs) => setValue('contents', refs)}
          />
        </div>
      )}

      {/* Теги */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Теги
        </label>
        <TagsInput
          value={tags || []}
          onChange={(tags) => setValue('tags', tags as Properties)}
          placeholder="Короткий меч, Магическое, Одноручное"
        />
      </div>

      {/* Требуется настройка */}
      <div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            {...register('requires_attunement')}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Требуется настройка</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          На карте появится значок настройки в правом верхнем углу
        </p>
      </div>

      {/* Дальность */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Дальность
        </label>
        <input
          {...register('range')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="30/120"
        />
        <p className="text-xs text-gray-500 mt-1">
          Отображается в нижней панели карты
        </p>
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
              <optgroup label="Физический">
                {PHYSICAL_DAMAGE_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </optgroup>
              <optgroup label="Стихийный">
                {ELEMENTAL_DAMAGE_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </optgroup>
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

          {/* Искусность (Weapon Mastery, PHB 2024): у каждого оружия ровно одно свойство.
              Список — данные (эффекты type='Эффект мастерства'), а не хардкод. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Мастерство (искусность)
            </label>
            <select
              {...register('mastery')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Без мастерства</option>
              {masteryEffects.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Свойство искусности оружия. Работает только у персонажа с особенностью «Искусное
              владение оружием» и только для выбранных им видов оружия.
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Дополнительный урон
              <span className="text-gray-400 font-normal ml-1">(необязательно)</span>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Кубы урона</label>
                <input
                  {...register('elemental_damage_value')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="1d4"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Тип урона</label>
                <select
                  {...register('elemental_damage_type')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Не указан</option>
                  <optgroup label="Физический">
                    {PHYSICAL_DAMAGE_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Стихийный">
                    {ELEMENTAL_DAMAGE_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Отображается в нижней панели рядом с основным уроном
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Магический бонус (+N)
            </label>
            <input
              type="number"
              {...register('enchant_bonus', { setValueAs: (v) => (v === '' || v == null ? null : Number(v)) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
            <p className="text-xs text-gray-500 mt-1">
              Прибавляется к броскам атаки и к основному урону (напр. Молот мороза +1). Если пусто — берётся «+N» из названия.
            </p>
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
