import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import type { CreatePassiveEffectRequest } from '../../types';
import damageTypesData from '../../../utils/damage_types.json';

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
  const [isInitialized, setIsInitialized] = useState(false);

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

  // Загружаем сопротивления из script при монтировании или изменении script
  useEffect(() => {
    if (!isInitialized && script && typeof script === 'object' && script.resistance) {
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
      
      setResistances(entries);
      setIsInitialized(true);
    }
  }, [script, isInitialized]);

  // Сохраняем сопротивления в script при изменении
  useEffect(() => {
    if (resistances.length > 0) {
      const resistanceData: Record<string, string> = {};
      resistances.forEach(entry => {
        resistanceData[entry.damageType] = entry.resistanceType;
      });
      
      const newScript = {
        ...(script && typeof script === 'object' ? script : {}),
        resistance: resistanceData
      };
      
      setValue('script', newScript as any);
    } else {
      // Если нет сопротивлений, удаляем поле resistance
      const newScript = { ...(script && typeof script === 'object' ? script : {}) };
      if (newScript.resistance) {
        delete newScript.resistance;
      }
      setValue('script', Object.keys(newScript).length > 0 ? newScript as any : null);
    }
  }, [resistances, setValue, script]);

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

  return (
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
  );
};

