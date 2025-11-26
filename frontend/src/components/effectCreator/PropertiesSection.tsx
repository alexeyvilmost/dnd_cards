import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import type { CreatePassiveEffectRequest } from '../../types';
import damageTypesData from '../../../utils/damage_types.json';
import weaponTypesData from '../../../utils/weapon_types.json';
import armorTypesData from '../../../utils/armor_types.json';
import languagesData from '../../../utils/languages.json';

interface PropertiesSectionProps {
  setValue: UseFormSetValue<CreatePassiveEffectRequest>;
  watch: UseFormWatch<CreatePassiveEffectRequest>;
}

interface ResistanceEntry {
  damageType: string;
  resistanceType: 'resistance' | 'immune' | 'vulnerability';
}

interface DamageType {
  name: string;
  russian_name: string;
  type?: string;
}

const RESISTANCE_TYPES = [
  { value: 'resistance', label: 'Устойчивость' },
  { value: 'immune', label: 'Иммунитет' },
  { value: 'vulnerability', label: 'Уязвимость' },
];

export const PropertiesSection: React.FC<PropertiesSectionProps> = ({
  setValue,
  watch
}) => {
  const script = watch('script') as any;
  const [resistances, setResistances] = useState<ResistanceEntry[]>([]);
  const [weaponProficiencies, setWeaponProficiencies] = useState<string[]>([]);
  const [armorProficiencies, setArmorProficiencies] = useState<string[]>([]);
  const [languageProficiencies, setLanguageProficiencies] = useState<string[]>([]);
  const previousScriptRef = useRef<string | null>(null);

  // Загружаем типы урона из JSON
  const damageTypes = useMemo(() => {
    if (damageTypesData && damageTypesData.basic && Array.isArray(damageTypesData.basic)) {
      return damageTypesData.basic.map((type: DamageType) => ({
        value: type.name,
        label: type.russian_name
      }));
    }
    return [];
  }, []);

  // Загружаем типы оружия из JSON
  const weaponOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; group?: string }> = [];
    
    // Категории оружия
    options.push({ value: 'simple_melee', label: 'Простое рукопашное' });
    options.push({ value: 'simple_ranged', label: 'Простое дальнобойное' });
    options.push({ value: 'martial_melee', label: 'Воинское рукопашное' });
    options.push({ value: 'martial_ranged', label: 'Воинское дальнобойное' });
    
    // Конкретные типы оружия
    if (weaponTypesData && weaponTypesData.basic && Array.isArray(weaponTypesData.basic)) {
      weaponTypesData.basic.forEach((category: any) => {
        if (category.weapons && Array.isArray(category.weapons)) {
          category.weapons.forEach((weapon: any) => {
            options.push({
              value: weapon.name,
              label: weapon.russian_name,
              group: category.russian_name
            });
          });
        }
      });
    }
    
    return options;
  }, []);

  // Загружаем типы доспехов из JSON
  const armorOptions = useMemo(() => {
    if (armorTypesData && armorTypesData.basic && Array.isArray(armorTypesData.basic)) {
      return armorTypesData.basic.map((type: any) => ({
        value: type.name,
        label: type.russian_name
      }));
    }
    return [];
  }, []);

  // Загружаем языки из JSON
  const languageOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; group?: string }> = [];
    
    if (languagesData && languagesData.basic && Array.isArray(languagesData.basic)) {
      languagesData.basic.forEach((lang: any) => {
        options.push({
          value: lang.name,
          label: lang.russian_name,
          group: 'Обычные'
        });
      });
    }
    
    if (languagesData && languagesData.exotic && Array.isArray(languagesData.exotic)) {
      languagesData.exotic.forEach((lang: any) => {
        options.push({
          value: lang.name,
          label: lang.russian_name,
          group: 'Экзотические'
        });
      });
    }
    
    return options;
  }, []);

  // Загружаем данные из script при монтировании или изменении script
  useEffect(() => {
    // Преобразуем script в строку для сравнения
    const currentScriptStr = script ? JSON.stringify(script) : null;
    
    // Проверяем, изменился ли script
    if (currentScriptStr !== previousScriptRef.current) {
      console.log('[PropertiesSection] Script изменился, загружаем данные:', script);
      
      if (script && typeof script === 'object') {
        // Загружаем сопротивления
        if (script.resistance && typeof script.resistance === 'object') {
          const resistanceData = script.resistance;
          const entries: ResistanceEntry[] = [];
          
          for (const [damageType, resistanceType] of Object.entries(resistanceData)) {
            if (typeof resistanceType === 'string' && 
                ['resistance', 'immune', 'vulnerability'].includes(resistanceType)) {
              entries.push({
                damageType,
                resistanceType: resistanceType as 'resistance' | 'immune' | 'vulnerability'
              });
            }
          }
          
          console.log('[PropertiesSection] Загружены сопротивления:', entries);
          setResistances(entries);
        } else {
          setResistances([]);
        }
        
        // Загружаем владения оружием
        if (script.weapon_proficiencies && Array.isArray(script.weapon_proficiencies)) {
          console.log('[PropertiesSection] Загружены владения оружием:', script.weapon_proficiencies);
          setWeaponProficiencies([...script.weapon_proficiencies]);
        } else {
          setWeaponProficiencies([]);
        }
        
        // Загружаем владения доспехами
        if (script.armor_proficiencies && Array.isArray(script.armor_proficiencies)) {
          console.log('[PropertiesSection] Загружены владения доспехами:', script.armor_proficiencies);
          setArmorProficiencies([...script.armor_proficiencies]);
        } else {
          setArmorProficiencies([]);
        }
        
        // Загружаем владения языками
        if (script.language_proficiencies && Array.isArray(script.language_proficiencies)) {
          console.log('[PropertiesSection] Загружены владения языками:', script.language_proficiencies);
          setLanguageProficiencies([...script.language_proficiencies]);
        } else {
          setLanguageProficiencies([]);
        }
        
        previousScriptRef.current = currentScriptStr;
      } else {
        // Если script стал null или не объект, очищаем все данные
        console.log('[PropertiesSection] Script пустой, очищаем данные');
        setResistances([]);
        setWeaponProficiencies([]);
        setArmorProficiencies([]);
        setLanguageProficiencies([]);
        previousScriptRef.current = null;
      }
    }
  }, [script]);

  // Сохраняем все свойства в script при изменении
  useEffect(() => {
    // Создаем новый script объект на основе текущего script и состояний
    const newScript: any = { ...(script && typeof script === 'object' ? script : {}) };
    
    // Сохраняем сопротивления
    if (resistances.length > 0) {
      const resistanceData: Record<string, string> = {};
      resistances.forEach(entry => {
        if (entry.damageType) {
          resistanceData[entry.damageType] = entry.resistanceType;
        }
      });
      if (Object.keys(resistanceData).length > 0) {
        newScript.resistance = resistanceData;
      } else {
        delete newScript.resistance;
      }
    } else {
      delete newScript.resistance;
    }
    
    // Сохраняем владения оружием
    const filteredWeapons = weaponProficiencies.filter(p => p && p.trim() !== '');
    if (filteredWeapons.length > 0) {
      newScript.weapon_proficiencies = filteredWeapons;
    } else {
      delete newScript.weapon_proficiencies;
    }
    
    // Сохраняем владения доспехами
    const filteredArmor = armorProficiencies.filter(p => p && p.trim() !== '');
    if (filteredArmor.length > 0) {
      newScript.armor_proficiencies = filteredArmor;
    } else {
      delete newScript.armor_proficiencies;
    }
    
    // Сохраняем владения языками
    const filteredLanguages = languageProficiencies.filter(p => p && p.trim() !== '');
    if (filteredLanguages.length > 0) {
      newScript.language_proficiencies = filteredLanguages;
    } else {
      delete newScript.language_proficiencies;
    }
    
    // Формируем финальный script
    const finalScript = Object.keys(newScript).length > 0 ? newScript : null;
    const finalScriptStr = finalScript ? JSON.stringify(finalScript) : null;
    
    // Проверяем, изменился ли script
    const currentScriptStr = script ? JSON.stringify(script) : null;
    
    // Сохраняем только если действительно изменилось
    if (finalScriptStr !== currentScriptStr) {
      console.log('[PropertiesSection] Сохраняем script в форму:', finalScript);
      console.log('[PropertiesSection] Владения оружием:', filteredWeapons);
      console.log('[PropertiesSection] Владения доспехами:', filteredArmor);
      console.log('[PropertiesSection] Владения языками:', filteredLanguages);
      
      // Обновляем ref только после успешного сохранения
      previousScriptRef.current = finalScriptStr;
      setValue('script', finalScript, { shouldDirty: true, shouldValidate: false });
    }
  }, [resistances, weaponProficiencies, armorProficiencies, languageProficiencies, setValue, script]);

  const addResistance = () => {
    setResistances([...resistances, { damageType: 'fire', resistanceType: 'resistance' }]);
  };

  const removeResistance = (index: number) => {
    setResistances(resistances.filter((_, i) => i !== index));
  };

  const updateResistance = (index: number, field: 'damageType' | 'resistanceType', value: string) => {
    const updated = [...resistances];
    updated[index] = { ...updated[index], [field]: value };
    setResistances(updated);
  };

  const addWeaponProficiency = () => {
    setWeaponProficiencies([...weaponProficiencies, '']);
  };

  const removeWeaponProficiency = (index: number) => {
    setWeaponProficiencies(weaponProficiencies.filter((_, i) => i !== index));
  };

  const updateWeaponProficiency = (index: number, value: string) => {
    const updated = [...weaponProficiencies];
    updated[index] = value;
    setWeaponProficiencies(updated);
  };

  const addArmorProficiency = () => {
    setArmorProficiencies([...armorProficiencies, '']);
  };

  const removeArmorProficiency = (index: number) => {
    setArmorProficiencies(armorProficiencies.filter((_, i) => i !== index));
  };

  const updateArmorProficiency = (index: number, value: string) => {
    const updated = [...armorProficiencies];
    updated[index] = value;
    setArmorProficiencies(updated);
  };

  const addLanguageProficiency = () => {
    setLanguageProficiencies([...languageProficiencies, '']);
  };

  const removeLanguageProficiency = (index: number) => {
    setLanguageProficiencies(languageProficiencies.filter((_, i) => i !== index));
  };

  const updateLanguageProficiency = (index: number, value: string) => {
    const updated = [...languageProficiencies];
    updated[index] = value;
    setLanguageProficiencies(updated);
  };

  return (
    <div className="space-y-6">
      {/* Устойчивость / Иммунитет / Уязвимость */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Устойчивость / Иммунитет / Уязвимость</h3>
        
        <div className="space-y-3">
          {resistances.map((entry, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <select
                value={entry.damageType}
                onChange={(e) => updateResistance(index, 'damageType', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {damageTypes.length > 0 ? (
                  damageTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))
                ) : (
                  <option value="">Загрузка типов урона...</option>
                )}
              </select>
              
              <select
                value={entry.resistanceType}
                onChange={(e) => updateResistance(index, 'resistanceType', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {RESISTANCE_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              
              <button
                type="button"
                onClick={() => removeResistance(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          
          <button
            type="button"
            onClick={addResistance}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={18} />
            <span>Добавить устойчивость/иммунитет/уязвимость</span>
          </button>
        </div>
      </div>

      {/* Владения оружием */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Владения оружием</h3>
        
        <div className="space-y-3">
          {weaponProficiencies.map((proficiency, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <select
                value={proficiency}
                onChange={(e) => updateWeaponProficiency(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Выберите владение оружием</option>
                {weaponOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              
              <button
                type="button"
                onClick={() => removeWeaponProficiency(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          
          <button
            type="button"
            onClick={addWeaponProficiency}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={18} />
            <span>Добавить владение оружием</span>
          </button>
        </div>
      </div>

      {/* Владения доспехами */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Владения доспехами и щитами</h3>
        
        <div className="space-y-3">
          {armorProficiencies.map((proficiency, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <select
                value={proficiency}
                onChange={(e) => updateArmorProficiency(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Выберите владение доспехом</option>
                {armorOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              
              <button
                type="button"
                onClick={() => removeArmorProficiency(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          
          <button
            type="button"
            onClick={addArmorProficiency}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={18} />
            <span>Добавить владение доспехом</span>
          </button>
        </div>
      </div>

      {/* Владения языками */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Владения языками</h3>
        
        <div className="space-y-3">
          {languageProficiencies.map((proficiency, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <select
                value={proficiency}
                onChange={(e) => updateLanguageProficiency(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Выберите язык</option>
                {languageOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              
              <button
                type="button"
                onClick={() => removeLanguageProficiency(index)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          
          <button
            type="button"
            onClick={addLanguageProficiency}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={18} />
            <span>Добавить язык</span>
          </button>
        </div>
      </div>
    </div>
  );
};

