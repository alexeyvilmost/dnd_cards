import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { Effect } from '../../types';
import { analyzeDescriptionForEffects } from '../../utils/descriptionAnalyzer';
import { useToast } from '../../contexts/ToastContext';

interface EffectsSectionProps {
  effects: Effect[];
  onEffectsChange: (effects: Effect[]) => void;
  description?: string;
}

const EffectsSection: React.FC<EffectsSectionProps> = ({ effects, onEffectsChange, description }) => {
  const [expandedEffect, setExpandedEffect] = useState<number | null>(null);
  const { showToast } = useToast();
  

  const analyzeDescription = () => {
    if (!description || description.trim() === '') {
      showToast({
        type: 'warning',
        title: 'Описание пустое',
        message: 'Добавьте описание карты для автоматического анализа эффектов.'
      });
      return;
    }

    const foundEffects = analyzeDescriptionForEffects(description);
    
    if (foundEffects.length === 0) {
      showToast({
        type: 'info',
        title: 'Эффекты не найдены',
        message: 'В описании не найдено эффектов. Убедитесь, что в описании есть фразы вида "Сила +1", "Атлетика -2" и т.д.'
      });
      return;
    }

    // Сохраняем предыдущие эффекты для возможности отмены
    const previousEffects = [...effects];
    
    // Добавляем найденные эффекты к существующим
    const newEffects = [...effects, ...foundEffects];
    onEffectsChange(newEffects);
    
    showToast({
      type: 'success',
      title: 'Эффекты найдены',
      message: `Найдено и добавлено ${foundEffects.length} эффектов из описания.`,
      effects: foundEffects,
      onUndo: () => {
        // Отменяем добавление эффектов
        onEffectsChange(previousEffects);
        console.log('🔄 [EFFECTS SECTION] Отменено добавление эффектов');
      },
      undoLabel: 'Отменить добавление'
    });
  };

  const addEffect = () => {
    const newEffect: Effect = {
      targetType: 'characteristic',
      targetSpecific: 'strength',
      modifier: '+',
      value: 1
    };
    onEffectsChange([...effects, newEffect]);
    setExpandedEffect(effects.length); // Индекс нового эффекта
  };

  const removeEffect = (index: number) => {
    onEffectsChange(effects.filter((_, i) => i !== index));
    if (expandedEffect === index) {
      setExpandedEffect(null);
    } else if (expandedEffect !== null && expandedEffect > index) {
      // Сдвигаем индекс развернутого эффекта, если удаляем элемент перед ним
      setExpandedEffect(expandedEffect - 1);
    }
  };

  const updateEffect = (index: number, updates: Partial<Effect>) => {
    onEffectsChange(effects.map((effect, i) => 
      i === index ? { ...effect, ...updates } : effect
    ));
  };

  const getTargetOptions = (targetType: string) => {
    switch (targetType) {
      case 'characteristic':
        return [
          { value: 'all', label: 'Все характеристики' },
          { value: 'strength', label: 'Сила' },
          { value: 'dexterity', label: 'Ловкость' },
          { value: 'constitution', label: 'Телосложение' },
          { value: 'intelligence', label: 'Интеллект' },
          { value: 'wisdom', label: 'Мудрость' },
          { value: 'charisma', label: 'Харизма' }
        ];
      case 'skill':
        return [
          { value: 'all', label: 'Все навыки' },
          { value: 'athletics', label: 'Атлетика' },
          { value: 'acrobatics', label: 'Акробатика' },
          { value: 'sleight_of_hand', label: 'Ловкость рук' },
          { value: 'stealth', label: 'Скрытность' },
          { value: 'arcana', label: 'Магия' },
          { value: 'history', label: 'История' },
          { value: 'investigation', label: 'Расследование' },
          { value: 'nature', label: 'Природа' },
          { value: 'religion', label: 'Религия' },
          { value: 'animal_handling', label: 'Дрессировка' },
          { value: 'insight', label: 'Проницательность' },
          { value: 'medicine', label: 'Медицина' },
          { value: 'perception', label: 'Восприятие' },
          { value: 'survival', label: 'Выживание' },
          { value: 'deception', label: 'Обман' },
          { value: 'intimidation', label: 'Запугивание' },
          { value: 'performance', label: 'Выступление' },
          { value: 'persuasion', label: 'Убеждение' }
        ];
      case 'saving_throw':
        return [
          { value: 'all', label: 'Все спасброски' },
          { value: 'strength', label: 'Спасбросок Силы' },
          { value: 'dexterity', label: 'Спасбросок Ловкости' },
          { value: 'constitution', label: 'Спасбросок Телосложения' },
          { value: 'intelligence', label: 'Спасбросок Интеллекта' },
          { value: 'wisdom', label: 'Спасбросок Мудрости' },
          { value: 'charisma', label: 'Спасбросок Харизмы' }
        ];
      default:
        return [];
    }
  };

  const getEffectDescription = (effect: Effect, index: number) => {
    const targetOptions = getTargetOptions(effect.targetType);
    const targetLabel = targetOptions.find(opt => opt.value === effect.targetSpecific)?.label || 'Неизвестно';
    
    const typeLabels = {
      characteristic: 'Характеристика',
      skill: 'Навык',
      saving_throw: 'Спасбросок'
    };

    return `${typeLabels[effect.targetType]} - ${targetLabel} ${effect.modifier}${effect.value}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Эффекты предмета</h3>
        <div className="flex items-center gap-2">
          {description && description.trim() !== '' && (
            <button
              type="button"
              onClick={analyzeDescription}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              title="Автоматически найти эффекты в описании"
            >
              <Search className="w-4 h-4" />
              Найти в описании
            </button>
          )}
          <button
            type="button"
            onClick={addEffect}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить эффект
          </button>
        </div>
      </div>

      {effects.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">✨</div>
          <p>Эффекты не добавлены</p>
          <p className="text-sm">Нажмите "Добавить эффект" для создания первого эффекта</p>
        </div>
      ) : (
        <div className="space-y-3">
          {effects.map((effect, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg bg-white shadow-sm"
            >
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedEffect(expandedEffect === index ? null : index)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✨</span>
                  <div>
                    <div className="font-medium text-gray-900">
                      {getEffectDescription(effect, index)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEffect(index);
                    }}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    title="Удалить эффект"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expandedEffect === index ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>

              {expandedEffect === index && (
                <div className="border-t border-gray-200 p-4 space-y-4">
                  {/* Тип влияния */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Влияние на
                    </label>
                    <select
                      value={effect.targetType}
                      onChange={(e) => {
                        updateEffect(index, { 
                          targetType: e.target.value as Effect['targetType'],
                          targetSpecific: 'all' // Сбрасываем при смене типа
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="characteristic">Характеристику</option>
                      <option value="skill">Навык</option>
                      <option value="saving_throw">Спасбросок</option>
                    </select>
                  </div>

                  {/* Конкретная цель */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Конкретная цель
                    </label>
                    <select
                      value={effect.targetSpecific}
                      onChange={(e) => updateEffect(index, { targetSpecific: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {getTargetOptions(effect.targetType).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Модификатор и значение */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Модификатор
                      </label>
                      <select
                        value={effect.modifier}
                        onChange={(e) => updateEffect(index, { modifier: e.target.value as '+' | '-' })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="+">+ (Увеличение)</option>
                        <option value="-">- (Уменьшение)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Значение
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={effect.value}
                        onChange={(e) => updateEffect(index, { value: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EffectsSection;
