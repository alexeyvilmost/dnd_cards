import React, { useState } from 'react';
import { X } from 'lucide-react';
import Dice3D from '../components/Dice3D';

const DiceTest: React.FC = () => {
  const [showDiceModal, setShowDiceModal] = useState(true);
  const [diceResult, setDiceResult] = useState<{
    skillName: string;
    skillBonus: number;
    diceRoll: number;
    finalResult: number;
    isRolling: boolean;
    rollType: 'normal' | 'advantage' | 'disadvantage';
    secondDice?: number;
    selectedDice?: number;
  }>({
    skillName: 'athletics',
    skillBonus: 4,
    diceRoll: 15,
    finalResult: 19,
    isRolling: false,
    rollType: 'normal',
  });

  const getSkillBorderColor = (skillName: string) => {
    return 'border-l-4 border-l-green-500';
  };

  const getSkillNameInRussian = (skillName: string) => {
    const skillNames: { [key: string]: string } = {
      'athletics': 'Атлетика',
      'acrobatics': 'Акробатика',
      'sleight_of_hand': 'Ловкость рук',
      'stealth': 'Скрытность',
      'arcana': 'Магия',
      'history': 'История',
      'investigation': 'Расследование',
      'nature': 'Природа',
      'religion': 'Религия',
      'animal_handling': 'Уход за животными',
      'insight': 'Проницательность',
      'medicine': 'Медицина',
      'perception': 'Восприятие',
      'survival': 'Выживание',
      'deception': 'Обман',
      'intimidation': 'Запугивание',
      'performance': 'Выступление',
      'persuasion': 'Убеждение',
    };
    return skillNames[skillName] || skillName;
  };

  const rollDice = (rollType: 'normal' | 'advantage' | 'disadvantage' = 'normal') => {
    // Предотвращаем повторные вызовы во время броска
    if (diceResult.isRolling) {
      return;
    }

    // Генерируем случайные значения один раз
    const firstDice = Math.floor(Math.random() * 20) + 1;
    let secondDice: number | undefined;
    let selectedDice: number;

    if (rollType === 'advantage' || rollType === 'disadvantage') {
      secondDice = Math.floor(Math.random() * 20) + 1;
      selectedDice = rollType === 'advantage' 
        ? Math.max(firstDice, secondDice)
        : Math.min(firstDice, secondDice);
    } else {
      selectedDice = firstDice;
    }

    const finalResult = selectedDice + diceResult.skillBonus;

    // Устанавливаем состояние с isRolling=true и значениями одним обновлением
    setDiceResult({
      ...diceResult,
      diceRoll: firstDice,
      secondDice,
      selectedDice,
      finalResult,
      isRolling: true,
      rollType,
    });

    // После завершения анимации (через 0.5 секунды) останавливаем анимацию
    setTimeout(() => {
      setDiceResult(prev => ({
        ...prev,
        isRolling: false,
      }));
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Тест кубика</h1>
        <p className="text-gray-600 mb-6">
          Эта страница для тестирования отображения 3D кубика в модальном окне броска.
        </p>
        <button
          onClick={() => setShowDiceModal(true)}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Показать модальное окно броска
        </button>
      </div>

      {showDiceModal && diceResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 p-24 ${getSkillBorderColor(diceResult.skillName)}`}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-gray-900">
                Бросок: {getSkillNameInRussian(diceResult.skillName)}
              </h3>
              <button
                onClick={() => setShowDiceModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {/* Результат броска */}
            <div className="flex items-center justify-center space-x-4 mb-6">
              {/* Первый кубик */}
              <div className="flex items-center space-x-2">
                <Dice3D 
                  isRolling={diceResult.isRolling} 
                  finalValue={diceResult.isRolling ? diceResult.diceRoll : undefined}
                />
                
                {/* Второй кубик (только для преимущества/помехи) */}
                {diceResult.rollType !== 'normal' && diceResult.secondDice !== undefined && (
                  <Dice3D 
                    isRolling={diceResult.isRolling} 
                    finalValue={diceResult.isRolling ? diceResult.secondDice : undefined}
                  />
                )}
              </div>
              
              {/* Плюс */}
              <div className="text-2xl font-bold text-gray-600">+</div>
              
              {/* Бонус навыка */}
              <div className="text-2xl font-bold text-blue-600 w-8 text-center">
                {diceResult.skillBonus}
              </div>
              
              {/* Равно */}
              <div className="text-2xl font-bold text-gray-600">=</div>
              
              {/* Финальный результат */}
              <div className="text-3xl font-bold text-green-600">
                {diceResult.isRolling ? '...' : diceResult.finalResult}
              </div>
            </div>
            
            <div className="mt-6 flex justify-center space-x-3">
              <button
                onClick={() => rollDice('disadvantage')}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                title="Помеха - бросается два кубика, выбирается наименьший"
              >
                Помеха
              </button>
              <button
                onClick={() => rollDice('normal')}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Бросить
              </button>
              <button
                onClick={() => rollDice('advantage')}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                title="Преимущество - бросается два кубика, выбирается наибольший"
              >
                Преимущество
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiceTest;
