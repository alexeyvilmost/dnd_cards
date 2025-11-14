import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { ArrowLeft } from 'lucide-react';
import { getAllBackstories, getBackstoryByRussianName, type Backstory } from '../utils/backstories';
import { getAllRaces, getRaceByRussianName, type Race } from '../utils/races';
import { getRuleRussianName } from '../utils/characterRules';
import { getToolRussianName } from '../utils/tools';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import CardPreview from '../components/CardPreview';

const CLASSES = [
  { id: 'barbarian', name: 'Варвар', description: 'Яростный воин первобытных инстинктов' },
  { id: 'bard', name: 'Бард', description: 'Вдохновляющий музыкант, чья сила исходит от искусства' },
  { id: 'cleric', name: 'Жрец', description: 'Божественный посредник, наделенный магией богов' },
  { id: 'druid', name: 'Друид', description: 'Жрец древних сил природы' },
  { id: 'fighter', name: 'Воин', description: 'Мастер боевых искусств' },
  { id: 'monk', name: 'Монах', description: 'Мастер боевых искусств, использующий силу тела' },
  { id: 'paladin', name: 'Паладин', description: 'Святой воин, связанный священной клятвой' },
  { id: 'ranger', name: 'Следопыт', description: 'Воин, использующий превосходство природы' },
  { id: 'rogue', name: 'Плут', description: 'Хитрый и находчивый искатель приключений' },
  { id: 'sorcerer', name: 'Чародей', description: 'Заклинатель, черпающий магию из внутренней силы' },
  { id: 'warlock', name: 'Колдун', description: 'Искатель знаний, заключивший сделку с потусторонней сущностью' },
  { id: 'wizard', name: 'Маг', description: 'Ученый-заклинатель, способный манипулировать структурой реальности' },
];

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
  const [selectedStats, setSelectedStats] = useState<{ [key: string]: number }>({});

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

  // Состояние для загруженных карт экипировки
  const [equipmentCards, setEquipmentCards] = useState<Record<string, Card>>({});
  const [loadingCards, setLoadingCards] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Загружаем карты экипировки при изменении выбранной предыстории
  useEffect(() => {
    const loadEquipmentCards = async () => {
      if (!selectedBackstoryData?.equipment || selectedBackstoryData.equipment.length === 0) {
        setEquipmentCards({});
        return;
      }

      setLoadingCards(true);
      const cards: Record<string, Card> = {};

      try {
        await Promise.all(
          selectedBackstoryData.equipment.map(async (cardId) => {
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
  }, [selectedBackstoryData]);

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

  const handleCreateCharacter = async () => {
    // Сбрасываем ошибку перед проверками
    setError(null);

    if (!characterName.trim()) {
      setError('Введите имя персонажа');
      return;
    }

    if (!selectedBackground || !selectedRace || !selectedClass) {
      setError('Выберите предысторию, расу и класс');
      return;
    }

    // Проверяем, что все характеристики заполнены
    const requiredStats = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const missingStats = requiredStats.filter(stat => !selectedStats[stat] || selectedStats[stat] < 1);
    if (missingStats.length > 0) {
      setError('Заполните все характеристики');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Получаем русские названия для расы и класса
      const raceName = selectedRaceData?.russian_name || selectedRace;
      const className = CLASSES.find(c => c.id === selectedClass)?.name || selectedClass;
      
      // Получаем данные предыстории для сохранения навыков и инструментов
      const backstoryData = selectedBackground ? getBackstoryByRussianName(selectedBackground) : null;

      // Рассчитываем начальные HP
      const constitution = selectedStats['constitution'] || 10;
      const maxHP = calculateMaxHP(selectedClass, constitution, 1);

      const payload = {
        name: characterName.trim(),
        race: raceName,
        class: className,
        level: 1,
        speed: 30, // Базовое значение скорости
        strength: selectedStats['strength'] || 10,
        dexterity: selectedStats['dexterity'] || 10,
        constitution: constitution,
        intelligence: selectedStats['intelligence'] || 10,
        wisdom: selectedStats['wisdom'] || 10,
        charisma: selectedStats['charisma'] || 10,
        max_hp: maxHP,
        current_hp: maxHP,
        saving_throw_proficiencies: [], // TODO: Добавить на основе класса
        skill_proficiencies: backstoryData?.skill_proficiencies || [], // Навыки из предыстории
      };

      await apiClient.post('/api/characters-v2', payload);
      navigate('/characters-v3');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать персонажа');
    } finally {
      setLoading(false);
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
                        onClick={() => setSelectedBackground(bg.russian_name)}
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
                        onClick={() => setSelectedRace(race.russian_name)}
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
                    {CLASSES.map((cls) => (
                      <div
                        key={cls.id}
                        onClick={() => setSelectedClass(cls.id)}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedClass === cls.id
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h4 className="font-semibold text-gray-900">{cls.name}</h4>
                        <p className="text-sm text-gray-600 mt-1">{cls.description}</p>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'stats' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Распределите характеристики</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Стандартный массив: 15, 14, 13, 12, 10, 8
                    </p>
                    {['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map((stat) => (
                      <div key={stat} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                        <label className="font-medium text-gray-700 capitalize">
                          {getStatName(stat)}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={selectedStats[stat] || ''}
                          onChange={(e) => setSelectedStats({ ...selectedStats, [stat]: parseInt(e.target.value) || 0 })}
                          className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center"
                        />
                      </div>
                    ))}
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
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Предыстория: {selectedBackstoryData.russian_name}</h4>
                    
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

                    {/* Снаряжение */}
                    {selectedBackstoryData.equipment && selectedBackstoryData.equipment.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Стартовое снаряжение:</h5>
                        <div className="grid grid-cols-4 gap-0">
                          {selectedBackstoryData.equipment.map((cardId) => {
                            const card = equipmentCards[cardId];
                            return (
                              <div
                                key={cardId}
                                className="w-16 h-16 border rounded flex items-center justify-center relative border-gray-400 bg-white cursor-pointer hover:bg-gray-50 transition-colors group border-l-4 border-l-gray-400"
                                title={card ? `${card.name} (1) - клик для просмотра` : 'Загрузка...'}
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
                                  card.image_url ? (
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
                                  )
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

                {/* Выбранная раса */}
                {selectedRaceData && (
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Раса: {selectedRaceData.russian_name}</h4>
                    
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
                                {lang}
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

                {/* Выбранный класс */}
                {selectedClass && (
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-2">Класс</h4>
                    <p className="text-sm text-gray-600">
                      {CLASSES.find(c => c.id === selectedClass)?.name}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      {CLASSES.find(c => c.id === selectedClass)?.description}
                    </p>
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
                  )
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
    </div>
  );
};

export default CreateCharacterV3;

