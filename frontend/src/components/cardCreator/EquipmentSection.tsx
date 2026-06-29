import React, { useEffect, useRef } from 'react';
import { UseFormRegister, FieldErrors, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { CreateCardRequest, Properties, CardRef } from '../../types';
import { PROPERTIES_OPTIONS, BONUS_TYPE_OPTIONS, EQUIPMENT_SLOTS } from '../../types';
import { ITEM_TYPE_OPTIONS, CONTAINER_MODE_OPTIONS } from '../../constants/itemTypes';
import ItemRefSelector from '../ItemRefSelector';
import { PHYSICAL_DAMAGE_TYPES, ELEMENTAL_DAMAGE_TYPES } from '../../utils/damageTypes';
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
  const battle_profile = watch('battle_profile');
  const { showToast } = useToast();
  const lastProcessedName = useRef<string>('');
  const [battleProfileText, setBattleProfileText] = React.useState<string>('');

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

  useEffect(() => {
    if (battle_profile && typeof battle_profile === 'object') {
      setBattleProfileText(JSON.stringify(battle_profile, null, 2));
    } else {
      setBattleProfileText('');
    }
  }, [battle_profile]);

  const applyBattleProfile = () => {
    if (!battleProfileText.trim()) {
      setValue('battle_profile', null);
      return;
    }
    try {
      const parsed = JSON.parse(battleProfileText);
      setValue('battle_profile', parsed);
      showToast({
        type: 'success',
        title: 'Боевой профиль сохранён',
        message: 'JSON боевого профиля успешно применён',
      });
    } catch (e) {
      showToast({
        type: 'error',
        title: 'Ошибка JSON',
        message: 'Проверьте формат battle_profile',
      });
    }
  };

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
          onChange={(tags) => setValue('tags', tags)}
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

      {/* Боевой профиль (интеграция с battle) */}
      <div className="border-t border-gray-200 pt-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Боевой профиль (battle_profile JSON)
        </label>
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={8}
          value={battleProfileText}
          onChange={(e) => setBattleProfileText(e.target.value)}
          placeholder={`{\n  "ready": true,\n  "kind": "weapon",\n  "damage_dice": "1d8",\n  "damage_type": "slashing",\n  "to_hit_bonus": 1,\n  "ac_bonus": null\n}`}
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={applyBattleProfile}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Применить JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setBattleProfileText('');
              setValue('battle_profile', null);
            }}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            Очистить
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Используется эндпоинтом <code>/api/cards/:id/battle-stats</code> для подготовки предмета к бою.
        </p>
      </div>
    </div>
  );
};
