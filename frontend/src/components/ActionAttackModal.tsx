import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import ActionPreview from './ActionPreview';
import CardPreview from './CardPreview';
import type { Action, Card } from '../types';
import { getStatValue, getModifier, getProficiencyBonus } from '../utils/characterCalculationsV3';
import { CharacterV3 } from '../utils/characterCalculationsV3';

interface ActionAttackModalProps {
  action: Action;
  character: CharacterV3;
  weapon?: Card | null;
  onClose: () => void;
}

interface DiceResult {
  isRolling: boolean;
  diceRoll: number;
  secondDice?: number;
  rollType: 'normal' | 'advantage' | 'disadvantage';
  finalResult: number;
  attackBonus: number;
  modifiers: Array<{ name: string; value: number }>;
}

interface DamageResult {
  isRolling: boolean;
  diceRolls: number[];
  finalResult: number;
  modifiers: Array<{ name: string; value: number }>;
}

const ActionAttackModal: React.FC<ActionAttackModalProps> = ({ action, character, weapon, onClose }) => {
  const [attackResult, setAttackResult] = useState<DiceResult>({
    isRolling: false,
    diceRoll: 0,
    rollType: 'normal',
    finalResult: 0,
    attackBonus: 0,
    modifiers: []
  });

  const [damageResult, setDamageResult] = useState<DamageResult>({
    isRolling: false,
    diceRolls: [],
    finalResult: 0,
    modifiers: []
  });

  // Определяем атрибут для атаки (сила для ближнего боя)
  const attackStat = 'strength';
  const attackStatValue = getStatValue(character, attackStat);
  const attackStatModifier = getModifier(attackStatValue);

  // Вычисляем бонус мастерства
  const proficiencyBonus = getProficiencyBonus(character.level || 1);

  // Инициализируем модификаторы атаки
  useEffect(() => {
    const modifiers: Array<{ name: string; value: number }> = [
      { name: `Модификатор ${attackStat === 'strength' ? 'Силы' : 'Ловкости'}`, value: attackStatModifier },
      { name: 'Бонус мастерства', value: proficiencyBonus }
    ];

    const totalBonus = modifiers.reduce((sum, mod) => sum + mod.value, 0);

    setAttackResult(prev => ({
      ...prev,
      attackBonus: totalBonus,
      modifiers
    }));
  }, [character, attackStat, attackStatModifier, proficiencyBonus]);

  // Инициализируем модификаторы урона
  useEffect(() => {
    const modifiers: Array<{ name: string; value: number }> = [
      { name: `Модификатор ${attackStat === 'strength' ? 'Силы' : 'Ловкости'}`, value: attackStatModifier }
    ];

    setDamageResult(prev => ({
      ...prev,
      modifiers
    }));
  }, [attackStat, attackStatModifier]);

  const rollAttackDice = (rollType: 'normal' | 'advantage' | 'disadvantage' = 'normal') => {
    // Генерируем случайные значения сразу, без задержки
    const firstRoll = Math.floor(Math.random() * 20) + 1;
    let secondRoll: number | undefined;
    let finalRoll: number;

    if (rollType === 'advantage') {
      secondRoll = Math.floor(Math.random() * 20) + 1;
      finalRoll = Math.max(firstRoll, secondRoll);
    } else if (rollType === 'disadvantage') {
      secondRoll = Math.floor(Math.random() * 20) + 1;
      finalRoll = Math.min(firstRoll, secondRoll);
    } else {
      finalRoll = firstRoll;
    }

    const finalResult = finalRoll + attackResult.attackBonus;

    setAttackResult(prev => ({
      ...prev,
      isRolling: false,
      diceRoll: firstRoll,
      secondDice: secondRoll,
      finalResult,
      rollType
    }));
  };

  const rollDamageDice = () => {
    if (action.card_number === 'action_unarmed_strike') {
      // Безоружный удар - всегда 1 урон
      setDamageResult(prev => ({
        ...prev,
        isRolling: false,
        diceRolls: [],
        finalResult: 1 + attackStatModifier
      }));
      return;
    }

    // Урон от оружия
    // Пытаемся найти кубик урона в bonus_value или описании
    let damageDice: string | null = null;
    
    if (weapon?.bonus_value) {
      // Пытаемся найти паттерн типа "1d6" или "2d4" в bonus_value
      const diceMatch = weapon.bonus_value.match(/(\d+)d(\d+)/);
      if (diceMatch) {
        damageDice = diceMatch[0];
      }
    }
    
    // Если не нашли в bonus_value, пытаемся найти в описании
    if (!damageDice && weapon?.description) {
      const diceMatch = weapon.description.match(/(\d+)d(\d+)/);
      if (diceMatch) {
        damageDice = diceMatch[0];
      }
    }
    
    if (!damageDice) {
      // Если кубик урона не найден, используем базовый урон
      setDamageResult(prev => ({
        ...prev,
        isRolling: false,
        diceRolls: [],
        finalResult: attackStatModifier
      }));
      return;
    }

    // Парсим кубик урона (например, "1d6" или "2d4")
    const diceMatch = damageDice.match(/(\d+)d(\d+)/);
    if (!diceMatch) {
      setDamageResult(prev => ({
        ...prev,
        isRolling: false,
        diceRolls: [],
        finalResult: attackStatModifier
      }));
      return;
    }

    const numDice = parseInt(diceMatch[1]);
    const diceSize = parseInt(diceMatch[2]);

    // Генерируем случайные значения сразу, без задержки
    const rolls: number[] = [];
    for (let i = 0; i < numDice; i++) {
      rolls.push(Math.floor(Math.random() * diceSize) + 1);
    }

    const totalDamage = rolls.reduce((sum, roll) => sum + roll, 0) + attackStatModifier;

    setDamageResult(prev => ({
      ...prev,
      isRolling: false,
      diceRolls: rolls,
      finalResult: totalDamage
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Бросок атаки</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6 p-6">
          {/* Левая часть - карточка действия и атрибут */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Действие</h3>
              <ActionPreview action={action} disableHover={true} />
            </div>
            <div className="mt-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Атрибут атаки</h3>
              <div className="bg-gray-100 rounded-lg p-4">
                <div className="text-sm text-gray-600 mb-1">Сила</div>
                <div className="text-2xl font-bold text-gray-900">{attackStatValue}</div>
                <div className="text-sm text-gray-500 mt-1">
                  Модификатор: {attackStatModifier >= 0 ? '+' : ''}{attackStatModifier}
                </div>
              </div>
            </div>
          </div>

          {/* Средняя часть - бросок атаки и урона */}
          <div className="space-y-4">
            {/* Бросок атаки */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Бросок атаки</h3>
              
              <div className="bg-gray-50 rounded-lg p-4">
                {/* Результат броска */}
                {attackResult.diceRoll > 0 ? (
                  <div className="text-center mb-4">
                    <div className="text-sm text-gray-600 mb-1">Результат броска</div>
                    <div className="flex items-center justify-center space-x-2 mb-2">
                      <div className="text-3xl font-bold text-blue-600">
                        {attackResult.diceRoll}
                      </div>
                      {attackResult.rollType !== 'normal' && attackResult.secondDice !== undefined && (
                        <>
                          <span className="text-xl text-gray-400">и</span>
                          <div className="text-3xl font-bold text-blue-600">
                            {attackResult.secondDice}
                          </div>
                          <span className="text-lg text-gray-500">
                            (выбрано {attackResult.rollType === 'advantage' 
                              ? Math.max(attackResult.diceRoll, attackResult.secondDice)
                              : Math.min(attackResult.diceRoll, attackResult.secondDice)})
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 mt-2">
                      + {attackResult.attackBonus} = <span className="text-xl font-bold text-green-600">{attackResult.finalResult}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center mb-4 text-gray-500">
                    Нажмите кнопку "Бросить" для броска атаки
                  </div>
                )}

                {/* Кнопки броска */}
                <div className="flex justify-center space-x-3 mb-4">
                  <button
                    onClick={() => rollAttackDice('disadvantage')}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    title="Помеха - бросается два кубика, выбирается наименьший"
                  >
                    Помеха
                  </button>
                  <button
                    onClick={() => rollAttackDice('normal')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Бросить
                  </button>
                  <button
                    onClick={() => rollAttackDice('advantage')}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    title="Преимущество - бросается два кубика, выбирается наибольший"
                  >
                    Преимущество
                  </button>
                </div>

                {/* Модификаторы */}
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Модификаторы:</h4>
                  <div className="space-y-1">
                    {attackResult.modifiers.map((mod, index) => (
                      <div key={index} className="text-sm text-gray-600 flex justify-between">
                        <span>{mod.name}:</span>
                        <span className="font-semibold">{mod.value >= 0 ? '+' : ''}{mod.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Бросок урона */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Бросок урона</h3>
              
              <div className="bg-gray-50 rounded-lg p-4">
                {action.card_number === 'action_unarmed_strike' ? (
                  // Безоружный удар - всегда 1
                  <div className="text-center mb-4">
                    <div className="text-sm text-gray-600 mb-1">Безоружный удар</div>
                    <div className="text-3xl font-bold text-red-600">1</div>
                    {damageResult.modifiers.length > 0 && (
                      <div className="text-sm text-gray-600 mt-2">
                        + {damageResult.modifiers[0].value} = <span className="text-xl font-bold text-green-600">{damageResult.finalResult}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  // Урон от оружия
                  <>
                    {damageResult.diceRolls.length > 0 && (
                      <div className="text-center mb-4">
                        <div className="text-sm text-gray-600 mb-1">Бросок кубика урона</div>
                        <div className="text-2xl font-bold text-red-600">
                          {damageResult.diceRolls.join(' + ')} = {damageResult.diceRolls.reduce((sum, roll) => sum + roll, 0)}
                        </div>
                        {damageResult.modifiers.length > 0 && (
                          <div className="text-sm text-gray-600 mt-2">
                            + {damageResult.modifiers[0].value} = <span className="text-xl font-bold text-green-600">{damageResult.finalResult}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex justify-center mb-4">
                      <button
                        onClick={rollDamageDice}
                        disabled={damageResult.isRolling}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                      >
                        {damageResult.isRolling ? 'Бросок...' : 'Бросить урон'}
                      </button>
                    </div>
                  </>
                )}

                {/* Модификаторы урона */}
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Модификаторы:</h4>
                  <div className="space-y-1">
                    {damageResult.modifiers.map((mod, index) => (
                      <div key={index} className="text-sm text-gray-600 flex justify-between">
                        <span>{mod.name}:</span>
                        <span className="font-semibold">{mod.value >= 0 ? '+' : ''}{mod.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Правая часть - экипированное оружие */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Экипированное оружие</h3>
            
            <div className="bg-gray-50 rounded-lg p-4">
              {weapon ? (
                <CardPreview card={weapon} disableHover={true} />
              ) : (
                <div className="text-center text-gray-500 py-8">
                  {action.card_number === 'action_unarmed_strike' 
                    ? 'Безоружный удар не требует оружия'
                    : 'Оружие не экипировано'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionAttackModal;
