import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { ArrowLeft, X, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import { getAllBackstories, getBackstoryByRussianName, type Backstory } from '../utils/backstories';
import { getAllRaces, getRaceByRussianName, type Race } from '../utils/races';
import { getAllClasses, getClass, getClassByRussianName, type Class } from '../utils/classes';
import { getRuleRussianName } from '../utils/characterRules';
import { getToolRussianName } from '../utils/tools';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import CardPreview from '../components/CardPreview';
import { EffectIcons } from '../components/EffectIcons';
import { ActionIcons } from '../components/ActionIcons';
import languagesData from '../../utils/languages.json';

const getStatName = (stat: string): string => {
  const names: { [key: string]: string } = {
    'strength': 'СИЛ',
    'dexterity': 'ЛВК',
    'constitution': 'ТЕЛ',
    'intelligence': 'ИНТ',
    'wisdom': 'МДР',
    'charisma': 'ХАР'
  };
  return names[stat] || stat.toUpperCase();
};

// Функция для расчета стоимости значения характеристики в системе Point Buy
const getPointBuyCost = (value: number): number => {
  const costMap: { [key: number]: number } = {
    8: 0,
    9: 1,
    10: 2,
    11: 3,
    12: 4,
    13: 5,
    14: 7,
    15: 9
  };
  return costMap[value] || 0;
};

// Функция для расчета общего количества потраченных очков
const calculateTotalPointsSpent = (stats: { [key: string]: number }): number => {
  return Object.values(stats).reduce((total, value) => {
    return total + getPointBuyCost(value || 8);
  }, 0);
};

// Функция для получения русского названия языка
const getLanguageRussianName = (langName: string): string => {
  // Ищем в обычных языках
  const basicLang = languagesData.basic?.find((l: any) => l.name === langName);
  if (basicLang) return basicLang.russian_name;
  
  // Ищем в экзотических языках
  const exoticLang = languagesData.exotic?.find((l: any) => l.name === langName);
  if (exoticLang) return exoticLang.russian_name;
  
  // Если не найдено, возвращаем оригинальное название
  return langName;
};

const CreateCharacterV3: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'background' | 'race' | 'class' | 'stats'>('background');
  
  // Состояние выбора персонажа
  const [characterName, setCharacterName] = useState<string>('');
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [selectedRace, setSelectedRace] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedClassData, setSelectedClassData] = useState<Class | null>(null);
  const [selectedClassSkills, setSelectedClassSkills] = useState<string[]>([]);
  const [selectedStats, setSelectedStats] = useState<{ [key: string]: number }>({
    strength: 8,
    dexterity: 8,
    constitution: 8,
    intelligence: 8,
    wisdom: 8,
    charisma: 8
  });
  
  // Состояние для отслеживания развернутых блоков (только один может быть открыт)
  const [expandedSection, setExpandedSection] = useState<'background' | 'race' | 'class' | null>(null);

  const POINT_BUY_TOTAL = 27;

  // Загружаем предыстории из JSON файлов
  const backgrounds = useMemo(() => {
    const loaded = getAllBackstories();
    // Сортируем по русскому названию для удобства
    return loaded.sort((a, b) => a.russian_name.localeCompare(b.russian_name, 'ru'));
  }, []);

  // Загружаем расы из JSON файлов
  const races = useMemo(() => {
    const loaded = getAllRaces();
    // Сортируем по русскому названию для удобства
    return loaded.sort((a, b) => a.russian_name.localeCompare(b.russian_name, 'ru'));
  }, []);

  // Получаем выбранную предысторию
  const selectedBackstoryData = useMemo(() => {
    if (!selectedBackground) return null;
    return getBackstoryByRussianName(selectedBackground) || null;
  }, [selectedBackground]);

  // Получаем выбранную расу
  const selectedRaceData = useMemo(() => {
    if (!selectedRace) return null;
    return getRaceByRussianName(selectedRace) || null;
  }, [selectedRace]);


  // Инициализация характеристик при выборе класса
  useEffect(() => {
    if (selectedClassData?.recommended_attributes) {
      setSelectedStats(selectedClassData.recommended_attributes);
    } else {
      // Изначально заполняем восьмерками
      setSelectedStats({
        strength: 8,
        dexterity: 8,
        constitution: 8,
        intelligence: 8,
        wisdom: 8,
        charisma: 8
      });
    }
    // Сбрасываем выбранные навыки класса при смене класса
    setSelectedClassSkills([]);
  }, [selectedClassData]);

  // Расчет потраченных очков
  const pointsSpent = useMemo(() => {
    return calculateTotalPointsSpent(selectedStats);
  }, [selectedStats]);

  const pointsRemaining = POINT_BUY_TOTAL - pointsSpent;

  // Функция для изменения значения характеристики
  const changeStatValue = (stat: string, delta: number) => {
    const currentValue = selectedStats[stat] || 8;
    const newValue = currentValue + delta;
    
    // Проверяем границы: минимум 8, максимум 15
    if (newValue < 8 || newValue > 15) {
      return;
    }
    
    // Проверяем, хватит ли очков для увеличения
    if (delta > 0) {
      const newCost = getPointBuyCost(newValue);
      const currentCost = getPointBuyCost(currentValue);
      const costDifference = newCost - currentCost;
      
      if (pointsRemaining < costDifference) {
        return;
      }
    }
    
    setSelectedStats({ ...selectedStats, [stat]: newValue });
  };

  // Получение бонуса расы для характеристики
  const getRaceBonus = (stat: string): number => {
    if (!selectedRaceData?.ability_scores) return 0;
    return selectedRaceData.ability_scores[stat] || 0;
  };

  // Получение итогового значения характеристики (базовое + бонус расы)
  const getFinalStatValue = (stat: string): number => {
    const baseValue = selectedStats[stat] || 8;
    return baseValue + getRaceBonus(stat);
  };

  // Получение навыков предыстории
  const getBackstorySkills = (): string[] => {
    return selectedBackstoryData?.skill_proficiencies || [];
  };

  // Проверка, есть ли навык в предыстории
  const isSkillFromBackstory = (skill: string): boolean => {
    return getBackstorySkills().includes(skill);
  };

  // Переключение выбора навыка класса
  const toggleClassSkill = (skill: string) => {
    if (selectedClassSkills.includes(skill)) {
      // Убираем навык
      setSelectedClassSkills(selectedClassSkills.filter(s => s !== skill));
    } else {
      // Добавляем навык, если не превышен лимит
      const maxSkills = selectedClassData?.skills?.count || 0;
      if (selectedClassSkills.length < maxSkills) {
        setSelectedClassSkills([...selectedClassSkills, skill]);
      }
    }
  };

  // Состояние для загруженных карт экипировки
  const [equipmentCards, setEquipmentCards] = useState<Record<string, Card>>({});
  const [loadingCards, setLoadingCards] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Снаряжение от предыстории
  const backstoryEquipment = useMemo(() => {
    return selectedBackstoryData?.equipment || [];
  }, [selectedBackstoryData?.equipment]);

  // Подсчитываем количество каждого предмета предыстории
  const backstoryEquipmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    backstoryEquipment.forEach((cardId) => {
      counts[cardId] = (counts[cardId] || 0) + 1;
    });
    return counts;
  }, [backstoryEquipment]);

  // Уникальные ID предметов предыстории (без дубликатов)
  const uniqueBackstoryEquipmentIds = useMemo(() => {
    return Array.from(new Set(backstoryEquipment));
  }, [backstoryEquipment]);

  // Снаряжение от класса
  const classEquipment = useMemo(() => {
    return selectedClassData?.equipment || [];
  }, [selectedClassData?.equipment]);

  // Подсчитываем количество каждого предмета класса
  const classEquipmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    classEquipment.forEach((cardId) => {
      counts[cardId] = (counts[cardId] || 0) + 1;
    });
    return counts;
  }, [classEquipment]);

  // Уникальные ID предметов класса (без дубликатов)
  const uniqueClassEquipmentIds = useMemo(() => {
    return Array.from(new Set(classEquipment));
  }, [classEquipment]);

  // Объединяем все уникальные ID для загрузки карт
  const allUniqueEquipmentIds = useMemo(() => {
    return Array.from(new Set([...uniqueBackstoryEquipmentIds, ...uniqueClassEquipmentIds]));
  }, [uniqueBackstoryEquipmentIds, uniqueClassEquipmentIds]);

  // Загружаем карты экипировки при изменении выбранной предыстории или класса
  useEffect(() => {
    const loadEquipmentCards = async () => {
      if (allUniqueEquipmentIds.length === 0) {
        setEquipmentCards({});
        return;
      }

      setLoadingCards(true);
      const cards: Record<string, Card> = {};

      try {
        await Promise.all(
          allUniqueEquipmentIds.map(async (cardId) => {
            try {
              const card = await cardsApi.getCard(cardId);
              cards[cardId] = card;
            } catch (error) {
              console.warn(`Не удалось загрузить карту ${cardId}:`, error);
            }
          })
        );
        setEquipmentCards(cards);
      } catch (error) {
        console.error('Ошибка загрузки карт экипировки:', error);
      } finally {
        setLoadingCards(false);
      }
    };

    loadEquipmentCards();
  }, [allUniqueEquipmentIds.join(',')]);

  // Функция для получения цвета границы характеристики
  const getStatBorderColor = (statKey: string): string => {
    const statColors: { [key: string]: string } = {
      'strength': 'border-l-4 border-l-red-500',
      'dexterity': 'border-l-4 border-l-green-500',
      'constitution': 'border-l-4 border-l-gray-500',
      'intelligence': 'border-l-4 border-l-blue-500',
      'wisdom': 'border-l-4 border-l-yellow-500',
      'charisma': 'border-l-4 border-l-purple-500',
    };
    return statColors[statKey.toLowerCase()] || 'border-l-4 border-l-gray-500';
  };

  // Функция для получения цвета границы навыка
  const getSkillBorderColor = (skillName: string): string => {
    const skillToStat: { [key: string]: string } = {
      'athletics': 'strength',
      'acrobatics': 'dexterity',
      'sleight_of_hand': 'dexterity',
      'stealth': 'dexterity',
      'arcana': 'intelligence',
      'history': 'intelligence',
      'investigation': 'intelligence',
      'nature': 'intelligence',
      'religion': 'intelligence',
      'animal_handling': 'wisdom',
      'insight': 'wisdom',
      'medicine': 'wisdom',
      'perception': 'wisdom',
      'survival': 'wisdom',
      'deception': 'charisma',
      'intimidation': 'charisma',
      'performance': 'charisma',
      'persuasion': 'charisma',
    };

    const stat = skillToStat[skillName.toLowerCase()];
    return getStatBorderColor(stat);
  };

  // Базовые значения HP для классов (DnD 5e)
  const getClassHitDie = (classId: string): number => {
    // Пытаемся получить класс из JSON файлов
    const classData = getClass(classId);
    if (classData?.hit_dice) {
      // Извлекаем число из строки типа "1d12"
      const match = classData.hit_dice.match(/d(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    // Fallback на старые значения
    const hitDieMap: { [key: string]: number } = {
      'barbarian': 12,
      'fighter': 10,
      'paladin': 10,
      'ranger': 10,
      'cleric': 8,
      'druid': 8,
      'monk': 8,
      'rogue': 8,
      'bard': 8,
      'sorcerer': 6,
      'warlock': 8,
      'wizard': 6,
    };
    return hitDieMap[classId] || 8;
  };

  const calculateMaxHP = (classId: string, constitution: number, level: number = 1): number => {
    const hitDie = getClassHitDie(classId);
    const constitutionModifier = Math.floor((constitution - 10) / 2);
    // На 1 уровне: максимальное значение кости + модификатор конституции
    return hitDie + constitutionModifier;
  };

  // Проверка валидности формы
  const validateForm = (): string | null => {
    if (!characterName.trim()) {
      return 'Введите имя персонажа';
    }

    if (!selectedBackground || !selectedRace || !selectedClass) {
      return 'Выберите предысторию, расу и класс';
    }

    // Проверяем, что все характеристики заполнены
    const requiredStats = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const missingStats = requiredStats.filter(stat => !selectedStats[stat] || selectedStats[stat] < 1);
    if (missingStats.length > 0) {
      return 'Заполните все характеристики';
    }

    // Проверяем, что все очки Point Buy потрачены
    const totalSpent = calculateTotalPointsSpent(selectedStats);
    if (totalSpent !== POINT_BUY_TOTAL) {
      return `Необходимо потратить все ${POINT_BUY_TOTAL} очков Point Buy. Потрачено: ${totalSpent}`;
    }

    // Проверяем, что выбрано нужное количество навыков класса
    if (selectedClassData?.skills && selectedClassData.skills.count > 0) {
      const requiredSkillsCount = selectedClassData.skills.count;
      if (selectedClassSkills.length !== requiredSkillsCount) {
        return `Необходимо выбрать ${requiredSkillsCount} навык${requiredSkillsCount > 1 ? (requiredSkillsCount < 5 ? 'а' : 'ов') : ''} из класса. Выбрано: ${selectedClassSkills.length}`;
      }
    }

    return null;
  };

  // Открытие модального окна подтверждения
  const handleCreateCharacter = () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setShowConfirmModal(true);
  };

  // Реальное создание персонажа
  const handleConfirmCreateCharacter = async () => {
    try {
      setLoading(true);
      setError(null);

      // Получаем русские названия для расы и класса
      const raceName = selectedRaceData?.russian_name || selectedRace;
      const className = selectedClassData?.russian_name || selectedClass;
      
      // Получаем данные предыстории для сохранения навыков и инструментов
      const backstoryData = selectedBackground ? getBackstoryByRussianName(selectedBackground) : null;

      // Используем итоговые значения характеристик (базовое + бонус расы)
      const finalStrength = getFinalStatValue('strength');
      const finalDexterity = getFinalStatValue('dexterity');
      const finalConstitution = getFinalStatValue('constitution');
      const finalIntelligence = getFinalStatValue('intelligence');
      const finalWisdom = getFinalStatValue('wisdom');
      const finalCharisma = getFinalStatValue('charisma');

      const payload = {
        name: characterName.trim(),
        race: raceName,
        class: className,
        level: 1,
        speed: 30, // Базовое значение скорости
        strength: finalStrength,
        dexterity: finalDexterity,
        constitution: finalConstitution,
        intelligence: finalIntelligence,
        wisdom: finalWisdom,
        charisma: finalCharisma,
        max_hp: calculateMaxHP(selectedClass, finalConstitution, 1),
        current_hp: calculateMaxHP(selectedClass, finalConstitution, 1),
        saving_throw_proficiencies: selectedClassData?.saving_throws || [], // Спасброски из класса
        skill_proficiencies: [
          ...(backstoryData?.skill_proficiencies || []),
          ...selectedClassSkills
        ].filter((skill, index, self) => self.indexOf(skill) === index), // Навыки из предыстории и класса (без дубликатов)
      };

      // Создаем персонажа
      const characterResponse = await apiClient.post('/api/characters-v2', payload);
      const characterId = characterResponse.data.id;

      // Собираем все предметы от предыстории и класса для добавления в инвентарь
      const allEquipmentIds: string[] = [];
      
      // Добавляем предметы от предыстории (с учетом количества)
      if (backstoryEquipment && backstoryEquipment.length > 0) {
        allEquipmentIds.push(...backstoryEquipment);
      }
      
      // Добавляем предметы от класса (с учетом количества)
      if (classEquipment && classEquipment.length > 0) {
        allEquipmentIds.push(...classEquipment);
      }

      // Добавляем предметы в инвентарь персонажа, если они есть
      if (allEquipmentIds.length > 0) {
        try {
          await apiClient.post(`/api/characters-v2/${characterId}/inventories/items`, {
            card_ids: allEquipmentIds
          });
        } catch (inventoryError) {
          console.error('Ошибка добавления предметов в инвентарь:', inventoryError);
          // Не прерываем создание персонажа, если не удалось добавить предметы
        }
      }

      navigate('/characters-v3');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать персонажа');
      setLoading(false);
      setShowConfirmModal(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <button
            onClick={() => navigate('/characters-v3')}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Назад</span>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Создание персонажа</h1>
            <p className="text-gray-600 mt-2">
              Выберите параметры для нового персонажа
            </p>
          </div>
        </div>

        {/* Основной контент - три колонки */}
        <div className="bg-white rounded-lg shadow-xl">
          <div className="flex p-4 gap-4">
            {/* Вертикальное меню слева */}
            <div className="w-16 bg-gray-50 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center py-4 space-y-2 flex-shrink-0">
              <button
                onClick={() => setActiveTab('background')}
                className={`
                  relative group w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-all duration-200
                  ${activeTab === 'background' 
                    ? 'bg-blue-100 text-blue-600 shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }
                `}
              >
                <span>📜</span>
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  <div className="font-medium">Предыстория</div>
                  <div className="text-xs text-gray-300">Происхождение персонажа</div>
                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('race')}
                className={`
                  relative group w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-all duration-200
                  ${activeTab === 'race' 
                    ? 'bg-blue-100 text-blue-600 shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }
                `}
              >
                <span>🧙</span>
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  <div className="font-medium">Раса</div>
                  <div className="text-xs text-gray-300">Расовые особенности</div>
                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('class')}
                className={`
                  relative group w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-all duration-200
                  ${activeTab === 'class' 
                    ? 'bg-blue-100 text-blue-600 shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }
                `}
              >
                <span>⚔️</span>
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  <div className="font-medium">Класс</div>
                  <div className="text-xs text-gray-300">Классовые способности</div>
                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('stats')}
                className={`
                  relative group w-12 h-12 rounded-lg flex items-center justify-center text-2xl transition-all duration-200
                  ${activeTab === 'stats' 
                    ? 'bg-blue-100 text-blue-600 shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                  }
                `}
              >
                <span>📊</span>
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                  <div className="font-medium">Характеристики</div>
                  <div className="text-xs text-gray-300">Распределение характеристик</div>
                  <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-gray-900"></div>
                </div>
              </button>
            </div>

            {/* Левая панель - выбор */}
            <div className="flex-1 border-r border-gray-200">
              {/* Поле для имени персонажа */}
              <div className="p-6 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Имя персонажа *
                </label>
                <input
                  type="text"
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  placeholder="Введите имя персонажа"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Контент выбора */}
              <div className="p-6">
                {activeTab === 'background' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Выберите предысторию</h3>
                    {backgrounds.map((bg) => (
                      <div
                        key={bg.name}
                        onClick={() => {
                          setSelectedBackground(bg.russian_name);
                          setExpandedSection('background');
                        }}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedBackground === bg.russian_name
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h4 className="font-semibold text-gray-900">{bg.russian_name}</h4>
                        {bg.skill_proficiencies && bg.skill_proficiencies.length > 0 && (
                          <p className="text-sm text-gray-600 mt-1">
                            Навыки: {bg.skill_proficiencies.map(s => getRuleRussianName(s) || s).join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'race' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Выберите расу</h3>
                    {races.map((race) => (
                      <div
                        key={race.name}
                        onClick={() => {
                          setSelectedRace(race.russian_name);
                          setExpandedSection('race');
                        }}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedRace === race.russian_name
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h4 className="font-semibold text-gray-900">{race.russian_name}</h4>
                        {race.ability_scores && Object.keys(race.ability_scores).length > 0 && (
                          <p className="text-sm text-gray-600 mt-1">
                            Бонусы характеристик: {Object.entries(race.ability_scores)
                              .map(([stat, value]) => `${getStatName(stat)} +${value}`)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'class' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Выберите класс</h3>
                    {getAllClasses().map((cls) => (
                      <div
                        key={cls.name}
                        onClick={() => {
                          setSelectedClass(cls.name);
                          setSelectedClassData(cls);
                          setExpandedSection('class');
                        }}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedClass === cls.name
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h4 className="font-semibold text-gray-900">{cls.russian_name}</h4>
                        {cls.description && (
                          <p className="text-sm text-gray-600 mt-1">{cls.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'stats' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Распределите характеристики</h3>
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-gray-700 mb-2">
                        <span className="font-semibold">Система Point Buy:</span> У вас есть 27 очков для распределения
                      </p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Потрачено очков:</span>
                        <span className={`font-semibold ${pointsSpent === POINT_BUY_TOTAL ? 'text-green-600' : 'text-red-600'}`}>
                          {pointsSpent} / {POINT_BUY_TOTAL}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-gray-600">Осталось очков:</span>
                        <span className={`font-semibold ${pointsRemaining === 0 ? 'text-green-600' : pointsRemaining < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                          {pointsRemaining}
                        </span>
                      </div>
                      {pointsSpent !== POINT_BUY_TOTAL && (
                        <p className="text-xs text-red-600 mt-2">
                          ⚠️ Необходимо потратить все {POINT_BUY_TOTAL} очков для сохранения персонажа
                        </p>
                      )}
                    </div>
                    {['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map((stat) => {
                      const baseValue = selectedStats[stat] || 8;
                      const raceBonus = getRaceBonus(stat);
                      const finalValue = getFinalStatValue(stat);
                      const modifier = Math.floor((finalValue - 10) / 2);
                      const statCost = getPointBuyCost(baseValue);
                      const canIncrease = baseValue < 15 && pointsRemaining >= (getPointBuyCost(baseValue + 1) - statCost);
                      const canDecrease = baseValue > 8;
                      
                      return (
                        <div 
                          key={stat} 
                          className={`flex items-center justify-between p-4 border border-gray-200 rounded-lg ${getStatBorderColor(stat)} bg-white`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <label className="font-medium text-gray-900">
                                {getStatName(stat)}
                              </label>
                              {raceBonus > 0 && (
                                <span className="text-xs text-green-600 font-semibold">
                                  +{raceBonus} (раса)
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              Стоимость: {statCost} очков
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col items-center">
                              <button
                                onClick={() => changeStatValue(stat, 1)}
                                disabled={!canIncrease}
                                className={`p-1 rounded ${canIncrease ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
                                title="Увеличить"
                              >
                                <ChevronUp size={20} />
                              </button>
                              <div className="text-center min-w-[60px]">
                                <div className="text-lg font-bold text-gray-900">{baseValue}</div>
                                {raceBonus > 0 && (
                                  <div className="text-xs text-green-600">
                                    = {finalValue}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500">
                                  {modifier >= 0 ? '+' : ''}{modifier}
                                </div>
                              </div>
                              <button
                                onClick={() => changeStatValue(stat, -1)}
                                disabled={!canDecrease}
                                className={`p-1 rounded ${canDecrease ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
                                title="Уменьшить"
                              >
                                <ChevronDown size={20} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Правая панель - свойства и умения */}
            <div className="flex-1 p-6 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Получаемые свойства и умения</h3>
              
              <div className="space-y-6">
                {/* Выбранная предыстория */}
                {selectedBackstoryData && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedSection(expandedSection === 'background' ? null : 'background')}
                      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
                    >
                      <h4 className="font-semibold text-gray-900">Предыстория: {selectedBackstoryData.russian_name}</h4>
                      {expandedSection === 'background' ? (
                        <ChevronDown size={20} className="text-gray-500" />
                      ) : (
                        <ChevronRight size={20} className="text-gray-500" />
                      )}
                    </button>
                    {expandedSection === 'background' && (
                      <div className="p-4 border-t border-gray-200">
                    
                    {/* Навыки */}
                    {selectedBackstoryData.skill_proficiencies && selectedBackstoryData.skill_proficiencies.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение навыками:</h5>
                        <div className="space-y-1">
                          {selectedBackstoryData.skill_proficiencies.map((skill) => {
                            const skillRussianName = getRuleRussianName(skill);
                            return (
                              <div
                                key={skill}
                                className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 ${getSkillBorderColor(skill)} hover:bg-gray-100 transition-colors`}
                              >
                                <span className="text-xs font-medium text-gray-900">
                                  {skillRussianName || skill}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Инструменты */}
                    {selectedBackstoryData.tool_proficiencies && selectedBackstoryData.tool_proficiencies.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение инструментами:</h5>
                        <div className="space-y-1">
                          {selectedBackstoryData.tool_proficiencies.map((tool) => (
                            <div
                              key={tool}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-green-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {getToolRussianName(tool)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Снаряжение от предыстории */}
                    {uniqueBackstoryEquipmentIds.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Стартовое снаряжение:</h5>
                        <div className="grid grid-cols-4 gap-0">
                          {uniqueBackstoryEquipmentIds.map((cardId) => {
                            const card = equipmentCards[cardId];
                            const count = backstoryEquipmentCounts[cardId] || 1;
                            return (
                              <div
                                key={cardId}
                                className="w-16 h-16 border rounded flex items-center justify-center relative border-gray-400 bg-white cursor-pointer hover:bg-gray-50 transition-colors group border-l-4 border-l-gray-400"
                                title={card ? `${card.name}${count > 1 ? ` (${count})` : ''} - клик для просмотра` : 'Загрузка...'}
                                data-inventory-item="true"
                                onMouseEnter={(e) => {
                                  if (card) {
                                    setHoveredCard(card);
                                    setMousePosition({ x: e.clientX, y: e.clientY });
                                  }
                                }}
                                onMouseMove={(e) => {
                                  if (card) {
                                    setMousePosition({ x: e.clientX, y: e.clientY });
                                  }
                                }}
                                onMouseLeave={() => {
                                  setHoveredCard(null);
                                }}
                              >
                                {loadingCards ? (
                                  <div className="text-xs text-gray-400">...</div>
                                ) : card ? (
                                  <>
                                    {card.image_url ? (
                                      <img
                                        src={card.image_url}
                                        alt={card.name}
                                        className="w-full h-full object-contain rounded"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.src = '/default_image.png';
                                        }}
                                      />
                                    ) : (
                                      <div className="text-xs text-gray-400 text-center px-1 truncate">{card.name}</div>
                                    )}
                                    {count > 1 && (
                                      <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                                        {count}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-xs text-gray-400">?</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Золото */}
                    {selectedBackstoryData.gold !== undefined && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Стартовое золото:</h5>
                        <div className="flex items-center space-x-1 bg-white border border-gray-200 rounded-lg p-2">
                          <span className="text-xs text-yellow-600 font-fantasy font-bold">
                            {selectedBackstoryData.gold}
                          </span>
                          <img
                            src="/icons/coin.png"
                            alt="Монеты"
                            className="w-3 h-3"
                            style={{
                              filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)',
                            }}
                          />
                        </div>
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                )}

                {/* Выбранная раса */}
                {selectedRaceData && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedSection(expandedSection === 'race' ? null : 'race')}
                      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
                    >
                      <h4 className="font-semibold text-gray-900">Раса: {selectedRaceData.russian_name}</h4>
                      {expandedSection === 'race' ? (
                        <ChevronDown size={20} className="text-gray-500" />
                      ) : (
                        <ChevronRight size={20} className="text-gray-500" />
                      )}
                    </button>
                    {expandedSection === 'race' && (
                      <div className="p-4 border-t border-gray-200">
                    
                    {/* Бонусы характеристик */}
                    {selectedRaceData.ability_scores && Object.keys(selectedRaceData.ability_scores).length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Бонусы характеристик:</h5>
                        <div className="space-y-1">
                          {Object.entries(selectedRaceData.ability_scores).map(([stat, value]) => (
                            <div
                              key={stat}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 ${getStatBorderColor(stat)} hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {getStatName(stat)}: +{value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Владение инструментами */}
                    {selectedRaceData.tool_proficiencies && selectedRaceData.tool_proficiencies.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение инструментами:</h5>
                        <div className="space-y-1">
                          {selectedRaceData.tool_proficiencies.map((tool) => (
                            <div
                              key={tool}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-green-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {getToolRussianName(tool)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Владение языками */}
                    {selectedRaceData.language_proficiencies && selectedRaceData.language_proficiencies.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение языками:</h5>
                        <div className="space-y-1">
                          {selectedRaceData.language_proficiencies.map((lang) => (
                            <div
                              key={lang}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-blue-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {getLanguageRussianName(lang)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Владение оружием */}
                    {selectedRaceData.weapon_proficiencies && selectedRaceData.weapon_proficiencies.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение оружием:</h5>
                        <div className="space-y-1">
                          {selectedRaceData.weapon_proficiencies.map((weapon) => (
                            <div
                              key={weapon}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-red-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {weapon}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Владение броней */}
                    {selectedRaceData.armor_proficiencies && selectedRaceData.armor_proficiencies.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение броней:</h5>
                        <div className="space-y-1">
                          {selectedRaceData.armor_proficiencies.map((armor) => (
                            <div
                              key={armor}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-gray-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {armor}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Сопротивление урону */}
                    {selectedRaceData.damage_resistance && selectedRaceData.damage_resistance.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Сопротивление урону:</h5>
                        <div className="space-y-1">
                          {selectedRaceData.damage_resistance.map((resistance) => (
                            <div
                              key={resistance}
                              className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 border-l-4 border-l-purple-500 hover:bg-gray-100 transition-colors`}
                            >
                              <span className="text-xs font-medium text-gray-900">
                                {resistance}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Эффекты */}
                    {selectedRaceData.effects && selectedRaceData.effects.length > 0 && (
                      <div className="mb-3 bg-slate-800 rounded-lg p-3">
                        <h5 className="text-sm font-medium text-white mb-2">Эффекты:</h5>
                        <EffectIcons effectIds={selectedRaceData.effects} />
                      </div>
                    )}


                    {/* Размер */}
                    {selectedRaceData.size && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Размер:</h5>
                        <p className="text-sm text-gray-600">{selectedRaceData.size}</p>
                      </div>
                    )}

                    {/* Скорость */}
                    {selectedRaceData.speed !== undefined && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Скорость:</h5>
                        <p className="text-sm text-gray-600">{selectedRaceData.speed} фт.</p>
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                )}

                {/* Выбранный класс */}
                {selectedClassData && (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedSection(expandedSection === 'class' ? null : 'class')}
                      className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
                    >
                      <h4 className="font-semibold text-gray-900">Класс: {selectedClassData.russian_name}</h4>
                      {expandedSection === 'class' ? (
                        <ChevronDown size={20} className="text-gray-500" />
                      ) : (
                        <ChevronRight size={20} className="text-gray-500" />
                      )}
                    </button>
                    {expandedSection === 'class' && (
                      <div className="p-4 border-t border-gray-200">
                    
                    {selectedClassData.description && (
                      <p className="text-sm text-gray-600 mb-3">{selectedClassData.description}</p>
                    )}

                    {selectedClassData.hit_dice && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Кость хитов:</h5>
                        <p className="text-sm text-gray-600">{selectedClassData.hit_dice}</p>
                      </div>
                    )}

                    {/* Владение навыками класса */}
                    {selectedClassSkills.length > 0 && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Владение навыками:</h5>
                        <div className="space-y-1">
                          {selectedClassSkills.map((skill) => {
                            const skillRussianName = getRuleRussianName(skill);
                            return (
                              <div
                                key={skill}
                                className={`group relative flex items-center justify-between p-1.5 rounded-lg bg-white border border-gray-200 ${getSkillBorderColor(skill)} hover:bg-gray-100 transition-colors`}
                              >
                                <span className="text-xs font-medium text-gray-900">
                                  {skillRussianName || skill}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Выбор навыков класса */}
                    {selectedClassData.skills && selectedClassData.skills.variants && selectedClassData.skills.variants.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">
                          Выберите {selectedClassData.skills.count} навык{selectedClassData.skills.count > 1 ? (selectedClassData.skills.count < 5 ? 'а' : 'ов') : ''}:
                          {selectedClassSkills.length > 0 && (
                            <span className="ml-2 text-blue-600">
                              ({selectedClassSkills.length} / {selectedClassData.skills.count})
                            </span>
                          )}
                        </h5>
                        <div className="space-y-1">
                          {selectedClassData.skills.variants.map((skill) => {
                            const skillRussianName = getRuleRussianName(skill) || skill;
                            const isSelected = selectedClassSkills.includes(skill);
                            const isFromBackstory = isSkillFromBackstory(skill);
                            const canSelect = !isSelected && selectedClassSkills.length < (selectedClassData.skills?.count || 0);
                            
                            return (
                              <button
                                key={skill}
                                onClick={() => toggleClassSkill(skill)}
                                disabled={!canSelect && !isSelected}
                                className={`
                                  w-full text-left p-2 rounded-lg border transition-all
                                  ${isSelected 
                                    ? 'bg-blue-100 border-blue-300 text-blue-900' 
                                    : isFromBackstory
                                    ? 'bg-green-50 border-green-200 text-gray-500 cursor-not-allowed opacity-60'
                                    : canSelect
                                    ? 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50 hover:border-gray-300'
                                    : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                  }
                                `}
                                title={
                                  isFromBackstory 
                                    ? 'Этот навык уже дает предыстория (двойное владение не дает эффекта)' 
                                    : isSelected 
                                    ? 'Нажмите, чтобы убрать навык' 
                                    : canSelect 
                                    ? 'Нажмите, чтобы выбрать навык' 
                                    : 'Достигнут лимит выбора навыков'
                                }
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium">
                                    {skillRussianName}
                                  </span>
                                  {isFromBackstory && (
                                    <span className="text-xs text-green-600 ml-2">
                                      (из предыстории)
                                    </span>
                                  )}
                                  {isSelected && (
                                    <span className="text-xs text-blue-600 ml-2">
                                      ✓
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {selectedClassSkills.length > 0 && (
                          <div className="mt-2 p-2 bg-blue-50 rounded-lg">
                            <p className="text-xs text-blue-700 font-medium mb-1">Выбранные навыки:</p>
                            <div className="flex flex-wrap gap-1">
                              {selectedClassSkills.map((skill) => {
                                const skillRussianName = getRuleRussianName(skill) || skill;
                                return (
                                  <span
                                    key={skill}
                                    className="px-2 py-1 bg-blue-200 text-blue-800 rounded text-xs"
                                  >
                                    {skillRussianName}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Снаряжение класса */}
                    {uniqueClassEquipmentIds.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Стартовое снаряжение:</h5>
                        <div className="grid grid-cols-4 gap-0">
                          {uniqueClassEquipmentIds.map((cardId) => {
                            const card = equipmentCards[cardId];
                            const count = classEquipmentCounts[cardId] || 1;
                            return (
                              <div
                                key={cardId}
                                className="w-16 h-16 border rounded flex items-center justify-center relative border-gray-400 bg-white cursor-pointer hover:bg-gray-50 transition-colors group border-l-4 border-l-gray-400"
                                title={card ? `${card.name}${count > 1 ? ` (${count})` : ''} - клик для просмотра` : 'Загрузка...'}
                                data-inventory-item="true"
                                onMouseEnter={(e) => {
                                  if (card) {
                                    setHoveredCard(card);
                                    setMousePosition({ x: e.clientX, y: e.clientY });
                                  }
                                }}
                                onMouseMove={(e) => {
                                  if (card) {
                                    setMousePosition({ x: e.clientX, y: e.clientY });
                                  }
                                }}
                                onMouseLeave={() => {
                                  setHoveredCard(null);
                                }}
                              >
                                {loadingCards ? (
                                  <div className="text-xs text-gray-400">...</div>
                                ) : card ? (
                                  <>
                                    {card.image_url ? (
                                      <img
                                        src={card.image_url}
                                        alt={card.name}
                                        className="w-full h-full object-contain rounded"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.src = '/default_image.png';
                                        }}
                                      />
                                    ) : (
                                      <div className="text-xs text-gray-400 text-center px-1 truncate">{card.name}</div>
                                    )}
                                    {count > 1 && (
                                      <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                                        {count}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-xs text-gray-400">?</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Прогрессия по уровням */}
                    {selectedClassData.level_progression && Object.keys(selectedClassData.level_progression).length > 0 && (
                      <div className="space-y-4">
                        {Object.entries(selectedClassData.level_progression).map(([level, progression]) => (
                          <div key={level} className="border-t border-gray-200 pt-3">
                            <h5 className="text-sm font-medium text-gray-700 mb-2">Уровень {level}</h5>
                            
                            {/* Эффекты уровня */}
                            {progression.effects && progression.effects.length > 0 && (
                              <div className="mb-3 bg-slate-800 rounded-lg p-3">
                                <h6 className="text-sm font-medium text-white mb-2">Эффекты:</h6>
                                <EffectIcons effectIds={progression.effects} />
                              </div>
                            )}

                            {/* Действия уровня */}
                            {progression.actions && progression.actions.length > 0 && (
                              <div className="mb-3 bg-amber-900 rounded-lg p-3">
                                <h6 className="text-sm font-medium text-white mb-2">Действия:</h6>
                                <ActionIcons actionIds={progression.actions} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                      </div>
                    )}
                  </div>
                )}

                {/* Характеристики */}
                {Object.keys(selectedStats).length > 0 && (
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-2">Характеристики</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(selectedStats).map(([stat, value]) => (
                        <div key={stat} className="flex justify-between text-sm">
                          <span className="text-gray-600 capitalize">{getStatName(stat)}:</span>
                          <span className="font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Заглушка для будущих свойств */}
                {(!selectedBackground && !selectedRace && !selectedClass && Object.keys(selectedStats).length === 0) && (
                  <div className="text-center py-12 text-gray-400">
                    <p>Выберите параметры персонажа, чтобы увидеть получаемые свойства и умения</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Футер с кнопками */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200">
            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}
            <div className="flex items-center space-x-4 ml-auto">
              <button
                onClick={() => navigate('/characters-v3')}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={loading}
              >
                Отмена
              </button>
              <button
                onClick={handleCreateCharacter}
                disabled={
                  !characterName.trim() || 
                  !selectedBackground || 
                  !selectedRace || 
                  !selectedClass || 
                  loading ||
                  !['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].every(
                    stat => selectedStats[stat] && selectedStats[stat] >= 1
                  ) ||
                  pointsSpent !== POINT_BUY_TOTAL ||
                  (selectedClassData?.skills && selectedClassData.skills.count > 0 && selectedClassSkills.length !== selectedClassData.skills.count)
                }
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {loading ? 'Создание...' : 'Создать персонажа'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Показ карточки при наведении */}
      {hoveredCard && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: Math.min(mousePosition.x + 10, window.innerWidth - 220),
            top: Math.max(mousePosition.y - 10, 10),
            transform: mousePosition.y < 300 ? 'translateY(0)' : 'translateY(-100%)',
          }}
        >
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
            <CardPreview card={hoveredCard} />
          </div>
        </div>
      )}

      {/* Модальное окно подтверждения создания персонажа */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Заголовок */}
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-900">Подтверждение создания персонажа</h2>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Контент - сводка */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Основная информация */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Основная информация</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Имя:</span>
                      <span className="font-medium text-gray-900">{characterName}</span>
                    </div>
                    {selectedRaceData && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Раса:</span>
                        <span className="font-medium text-gray-900">{selectedRaceData.russian_name}</span>
                      </div>
                    )}
                    {selectedClassData && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Класс:</span>
                        <span className="font-medium text-gray-900">{selectedClassData.russian_name}</span>
                      </div>
                    )}
                    {selectedBackstoryData && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Предыстория:</span>
                        <span className="font-medium text-gray-900">{selectedBackstoryData.russian_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600">Уровень:</span>
                      <span className="font-medium text-gray-900">1</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Максимальные HP:</span>
                      <span className="font-medium text-gray-900">
                        {calculateMaxHP(selectedClass || '', getFinalStatValue('constitution'), 1)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Характеристики */}
                {Object.keys(selectedStats).length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Характеристики</h3>
                    <div className="grid grid-cols-3 gap-3">
                      {Object.entries(selectedStats).map(([stat, baseValue]) => {
                        const finalValue = getFinalStatValue(stat);
                        const modifier = Math.floor((finalValue - 10) / 2);
                        const raceBonus = getRaceBonus(stat);
                        return (
                          <div key={stat} className="bg-gray-50 rounded-lg p-3">
                            <div className="text-sm text-gray-600">{getStatName(stat)}</div>
                            <div className="text-xl font-bold text-gray-900">
                              {finalValue}
                              {raceBonus > 0 && (
                                <span className="text-sm text-green-600 ml-1">
                                  ({baseValue} + {raceBonus})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              Модификатор: {modifier >= 0 ? '+' : ''}{modifier}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Снаряжение */}
                {(uniqueBackstoryEquipmentIds.length > 0 || uniqueClassEquipmentIds.length > 0) && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Стартовое снаряжение</h3>
                    <div className="grid grid-cols-6 gap-2">
                      {uniqueBackstoryEquipmentIds.map((cardId) => {
                        const card = equipmentCards[cardId];
                        const count = backstoryEquipmentCounts[cardId] || 1;
                        return card ? (
                          <div
                            key={`backstory-${cardId}`}
                            className="w-16 h-16 border rounded flex items-center justify-center relative border-gray-400 bg-white border-l-4 border-l-gray-400"
                            title={`${card.name}${count > 1 ? ` (${count})` : ''}`}
                          >
                            {card.image_url ? (
                              <img
                                src={card.image_url}
                                alt={card.name}
                                className="w-full h-full object-contain rounded"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.src = '/default_image.png';
                                }}
                              />
                            ) : (
                              <div className="text-xs text-gray-400 text-center px-1 truncate">{card.name}</div>
                            )}
                            {count > 1 && (
                              <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                                {count}
                              </div>
                            )}
                          </div>
                        ) : null;
                      })}
                      {uniqueClassEquipmentIds.map((cardId) => {
                        const card = equipmentCards[cardId];
                        const count = classEquipmentCounts[cardId] || 1;
                        return card ? (
                          <div
                            key={`class-${cardId}`}
                            className="w-16 h-16 border rounded flex items-center justify-center relative border-gray-400 bg-white border-l-4 border-l-gray-400"
                            title={`${card.name}${count > 1 ? ` (${count})` : ''}`}
                          >
                            {card.image_url ? (
                              <img
                                src={card.image_url}
                                alt={card.name}
                                className="w-full h-full object-contain rounded"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.src = '/default_image.png';
                                }}
                              />
                            ) : (
                              <div className="text-xs text-gray-400 text-center px-1 truncate">{card.name}</div>
                            )}
                            {count > 1 && (
                              <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                                {count}
                              </div>
                            )}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}

                {/* Эффекты расы */}
                {selectedRaceData?.effects && selectedRaceData.effects.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Эффекты расы</h3>
                    <div className="bg-slate-800 rounded-lg p-3">
                      <EffectIcons effectIds={selectedRaceData.effects} />
                    </div>
                  </div>
                )}

                {/* Эффекты и действия класса */}
                {selectedClassData?.level_progression && Object.keys(selectedClassData.level_progression).length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Эффекты и действия класса</h3>
                    <div className="space-y-3">
                      {Object.entries(selectedClassData.level_progression).map(([level, progression]) => (
                        <div key={level} className="border border-gray-200 rounded-lg p-3">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Уровень {level}</h4>
                          {progression.effects && progression.effects.length > 0 && (
                            <div className="mb-2 bg-slate-800 rounded-lg p-2">
                              <div className="text-xs text-white mb-1">Эффекты:</div>
                              <EffectIcons effectIds={progression.effects} />
                            </div>
                          )}
                          {progression.actions && progression.actions.length > 0 && (
                            <div className="bg-amber-900 rounded-lg p-2">
                              <div className="text-xs text-white mb-1">Действия:</div>
                              <ActionIcons actionIds={progression.actions} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Навыки предыстории */}
                {selectedBackstoryData?.skill_proficiencies && selectedBackstoryData.skill_proficiencies.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Навыки предыстории</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedBackstoryData.skill_proficiencies.map((skill) => (
                        <span
                          key={skill}
                          className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                        >
                          {getRuleRussianName(skill)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Навыки класса */}
                {selectedClassSkills.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Навыки класса</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedClassSkills.map((skill) => (
                        <span
                          key={skill}
                          className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm"
                        >
                          {getRuleRussianName(skill)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Владения расы */}
                {(selectedRaceData?.weapon_proficiencies?.length || 
                  selectedRaceData?.armor_proficiencies?.length || 
                  selectedRaceData?.language_proficiencies?.length) && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Владения расы</h3>
                    <div className="space-y-2">
                      {selectedRaceData.weapon_proficiencies && selectedRaceData.weapon_proficiencies.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-700">Оружие: </span>
                          <span className="text-sm text-gray-600">
                            {selectedRaceData.weapon_proficiencies.join(', ')}
                          </span>
                        </div>
                      )}
                      {selectedRaceData.armor_proficiencies && selectedRaceData.armor_proficiencies.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-700">Доспехи: </span>
                          <span className="text-sm text-gray-600">
                            {selectedRaceData.armor_proficiencies.join(', ')}
                          </span>
                        </div>
                      )}
                      {selectedRaceData.language_proficiencies && selectedRaceData.language_proficiencies.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-700">Языки: </span>
                          <span className="text-sm text-gray-600">
                            {selectedRaceData.language_proficiencies.map(lang => getLanguageRussianName(lang)).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Футер с кнопками */}
            <div className="flex items-center justify-end gap-4 p-6 border-t bg-gray-50">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={loading}
              >
                Отменить
              </button>
              <button
                onClick={handleConfirmCreateCharacter}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Создание...' : 'Начать приключение'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateCharacterV3;

