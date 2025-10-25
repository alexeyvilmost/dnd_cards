import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Package, Weight, Coins, Shield, Heart, Zap, User, Sword, Star, Eye, Plus, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import ItemSelector from '../components/ItemSelector';
import { Card } from '../types';
import { 
  CharacterV2, 
  calculateDerivedStats, 
  getStatName, 
  getFullStatName,
  getSkillName,
  getSavingThrowName,
  hasSkillProficiency,
  hasSavingThrowProficiency,
  getStatValue
} from '../utils/characterCalculations';

const CharacterDetailV2: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [character, setCharacter] = useState<CharacterV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [selectedStat, setSelectedStat] = useState<string | null>(null);
  const [showStatModal, setShowStatModal] = useState(false);
  const [modifiedStats, setModifiedStats] = useState<{ [key: string]: number }>({});
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [modifiedSkills, setModifiedSkills] = useState<{ [key: string]: number }>({});
  const [skillCompetencies, setSkillCompetencies] = useState<{ [key: string]: boolean }>({});
  const [customSavingThrowProficiencies, setCustomSavingThrowProficiencies] = useState<{ [key: string]: boolean }>({});
  const [customSkillProficiencies, setCustomSkillProficiencies] = useState<{ [key: string]: boolean }>({});
  
  // Состояние для модального окна выбора предметов
  const [showItemSelector, setShowItemSelector] = useState(false);
  
  // Состояние для инвентарей персонажа
  const [characterInventories, setCharacterInventories] = useState<any[]>([]);
  
  // Состояния для модальных окон производных характеристик
  const [selectedDerivedStat, setSelectedDerivedStat] = useState<string | null>(null);
  const [showDerivedStatModal, setShowDerivedStatModal] = useState(false);
  const [modifiedDerivedStats, setModifiedDerivedStats] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    if (id) {
      loadCharacter();
    }
  }, [id]);

  const loadCharacter = async () => {
    if (!id) return;

    const startTime = performance.now();
    console.log('🚀 [PERF] Начало загрузки персонажа');

    try {
      setLoading(true);
      setError(null);
      
      const characterStartTime = performance.now();
      const response = await apiClient.get<CharacterV2>(`/api/characters-v2/${id}`);
      const characterEndTime = performance.now();
      console.log(`⏱️ [PERF] Загрузка персонажа: ${(characterEndTime - characterStartTime).toFixed(2)}ms`);
      
      setCharacter(response.data);
      
      // Загружаем инвентари персонажа
      const inventoriesStartTime = performance.now();
      await loadCharacterInventories();
      const inventoriesEndTime = performance.now();
      console.log(`⏱️ [PERF] Загрузка инвентарей: ${(inventoriesEndTime - inventoriesStartTime).toFixed(2)}ms`);
      
      const totalTime = performance.now() - startTime;
      console.log(`✅ [PERF] Общее время загрузки: ${totalTime.toFixed(2)}ms`);
    } catch (err) {
      setError('Ошибка загрузки персонажа');
      console.error('Error loading character:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCharacterInventories = async () => {
    if (!character) return;

    const startTime = performance.now();
    console.log('📦 [PERF] Начало загрузки инвентарей');

    try {
      const apiStartTime = performance.now();
      const response = await apiClient.get(`/api/characters-v2/${character.id}/inventories`);
      const apiEndTime = performance.now();
      console.log(`🌐 [PERF] API запрос инвентарей: ${(apiEndTime - apiStartTime).toFixed(2)}ms`);
      
      console.log('Инвентари персонажа:', response.data);
      
      const stateStartTime = performance.now();
      setCharacterInventories(response.data || []);
      const stateEndTime = performance.now();
      console.log(`🔄 [PERF] Обновление состояния: ${(stateEndTime - stateStartTime).toFixed(2)}ms`);
      
      const totalTime = performance.now() - startTime;
      console.log(`✅ [PERF] Общее время загрузки инвентарей: ${totalTime.toFixed(2)}ms`);
    } catch (err) {
      console.error('Ошибка загрузки инвентарей персонажа:', err);
    }
  };

  const handleDeleteCharacter = async () => {
    if (!character || !window.confirm('Вы уверены, что хотите удалить этого персонажа?')) {
      return;
    }

    try {
      await apiClient.delete(`/api/characters-v2/${character.id}`);
      navigate('/characters-v2');
    } catch (err) {
      setError('Ошибка удаления персонажа');
      console.error('Error deleting character:', err);
    }
  };

  const [isAddingItems, setIsAddingItems] = useState(false);

  const handleAddItems = async (items: Card[]) => {
    if (isAddingItems) return; // Защита от двойного нажатия
    
    const startTime = performance.now();
    console.log('➕ [PERF] Начало добавления предметов');

    setIsAddingItems(true);
    try {
      if (!character) {
        console.error('Персонаж не найден');
        return;
      }

      const cardIds = items.map(item => item.id);
      
      const apiStartTime = performance.now();
      const response = await apiClient.post(`/api/characters-v2/${character.id}/inventories/items`, {
        card_ids: cardIds
      });
      const apiEndTime = performance.now();
      console.log(`🌐 [PERF] API запрос добавления предметов: ${(apiEndTime - apiStartTime).toFixed(2)}ms`);

      console.log('Предметы добавлены в инвентарь:', response.data);
      
      // Обновляем инвентари персонажа
      const reloadStartTime = performance.now();
      await loadCharacterInventories();
      const reloadEndTime = performance.now();
      console.log(`🔄 [PERF] Перезагрузка инвентарей: ${(reloadEndTime - reloadStartTime).toFixed(2)}ms`);
      
      setShowItemSelector(false);
      
      const totalTime = performance.now() - startTime;
      console.log(`✅ [PERF] Общее время добавления предметов: ${totalTime.toFixed(2)}ms`);
    } catch (error) {
      console.error('Ошибка добавления предметов:', error);
      // TODO: Показать уведомление об ошибке пользователю
    } finally {
      setIsAddingItems(false);
    }
  };

  // Функции для работы с модальным окном характеристик
  const openStatModal = (statKey: string) => {
    setSelectedStat(statKey);
    setShowStatModal(true);
  };

  const closeStatModal = () => {
    setShowStatModal(false);
    setSelectedStat(null);
  };

  // Получить актуальное значение характеристики (с учетом модификаций)
  const getActualStatValue = (statKey: string): number => {
    if (!character) return 0;
    return modifiedStats[statKey] !== undefined ? modifiedStats[statKey] : getStatValue(character, statKey);
  };

  // Изменить значение характеристики
  const updateStatValue = (statKey: string, newValue: number) => {
    setModifiedStats(prev => ({
      ...prev,
      [statKey]: newValue
    }));
  };

  // Вернуться к обычному расчету
  const resetStatValue = (statKey: string) => {
    setModifiedStats(prev => {
      const newStats = { ...prev };
      delete newStats[statKey];
      return newStats;
    });
  };

  // Функции для работы с модальным окном навыков
  const openSkillModal = (skillKey: string) => {
    setSelectedSkill(skillKey);
    setShowSkillModal(true);
  };

  const closeSkillModal = () => {
    setShowSkillModal(false);
    setSelectedSkill(null);
  };

  // Получить актуальное значение навыка (с учетом модификаций)
  const getActualSkillValue = (skillKey: string): number => {
    if (!character) return 0;
    return modifiedSkills[skillKey] !== undefined ? modifiedSkills[skillKey] : parseInt(getSkillBonus(skillKey).replace('+', '').replace('-', '')) || 0;
  };

  // Изменить значение навыка
  const updateSkillValue = (skillKey: string, newValue: number) => {
    setModifiedSkills(prev => ({
      ...prev,
      [skillKey]: newValue
    }));
  };

  // Вернуться к обычному расчету навыка
  const resetSkillValue = (skillKey: string) => {
    setModifiedSkills(prev => {
      const newSkills = { ...prev };
      delete newSkills[skillKey];
      return newSkills;
    });
  };

  // Переключить компетенцию навыка
  const toggleSkillCompetency = (skillKey: string) => {
    // Компетенцию можно получить только если есть владение навыком
    const hasProficiency = hasSkillProficiency(character, skillKey) || customSkillProficiencies[skillKey.toLowerCase()];
    if (!hasProficiency) return;
    
    setSkillCompetencies(prev => ({
      ...prev,
      [skillKey]: !prev[skillKey]
    }));
  };

  // Переключить владение спасброском
  const toggleSavingThrowProficiency = (statKey: string) => {
    setCustomSavingThrowProficiencies(prev => ({
      ...prev,
      [statKey]: !prev[statKey]
    }));
  };

  // Переключить владение навыком
  const toggleSkillProficiency = (skillKey: string) => {
    setCustomSkillProficiencies(prev => ({
      ...prev,
      [skillKey]: !prev[skillKey]
    }));
    
    // Если убираем владение навыком, убираем и компетенцию
    if (customSkillProficiencies[skillKey.toLowerCase()]) {
      setSkillCompetencies(prev => ({
        ...prev,
        [skillKey]: false
      }));
    }
  };

  // Функции для работы с модальными окнами производных характеристик
  const openDerivedStatModal = (statKey: string) => {
    setSelectedDerivedStat(statKey);
    setShowDerivedStatModal(true);
  };

  const closeDerivedStatModal = () => {
    setShowDerivedStatModal(false);
    setSelectedDerivedStat(null);
  };

  // Получить актуальное значение производной характеристики
  const getActualDerivedStatValue = (statKey: string): number => {
    if (!character) return 0;
    
    switch (statKey) {
      case 'level':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.level;
      case 'proficiency':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : Math.floor((character.level - 1) / 4) + 2;
      case 'ac':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : 10 + Math.floor((getActualStatValue('dexterity') - 10) / 2);
      case 'speed':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.speed;
      case 'max_hp':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.max_hp;
      case 'current_hp':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.current_hp;
      case 'passive_perception':
        const wisModifier = Math.floor((getActualStatValue('wisdom') - 10) / 2);
        const perceptionProficient = hasSkillProficiency(character, 'perception') || customSkillProficiencies['perception'];
        const proficiencyBonus = Math.floor((character.level - 1) / 4) + 2;
        const basePerception = 10 + wisModifier + (perceptionProficient ? proficiencyBonus : 0);
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : basePerception;
      default:
        return 0;
    }
  };

  // Изменить значение производной характеристики
  const updateDerivedStatValue = (statKey: string, newValue: number) => {
    setModifiedDerivedStats(prev => ({
      ...prev,
      [statKey]: newValue
    }));
  };

  // Вернуться к обычному расчету производной характеристики
  const resetDerivedStatValue = (statKey: string) => {
    setModifiedDerivedStats(prev => {
      const newStats = { ...prev };
      delete newStats[statKey];
      return newStats;
    });
  };

  // Функция для получения модификатора с знаком
  const getModifier = (score: number): string => {
    const modifier = Math.floor((score - 10) / 2);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  // Функция для получения названия характеристики на русском
  const getStatNameInRussian = (statKey: string): string => {
    const statNames: { [key: string]: string } = {
      'strength': 'СИЛ',
      'dexterity': 'ЛОВ',
      'constitution': 'ТЕЛ',
      'intelligence': 'ИНТ',
      'wisdom': 'МУД',
      'charisma': 'ХАР'
    };
    return statNames[statKey.toLowerCase()] || statKey.toUpperCase();
  };

  // Функция для получения названия навыка на русском
  const getSkillNameInRussian = (skillName: string): string => {
    return getSkillName(skillName);
  };

  // Функция для получения бонуса спасброска
  const getSavingThrowBonus = (statKey: string): { bonus: string; isProficient: boolean } => {
    if (!character) {
      return { bonus: '+0', isProficient: false };
    }
    
    const statValue = getActualStatValue(statKey);
    const proficiencyBonus = Math.floor((character.level - 1) / 4) + 2;
    const isProficient = hasSavingThrowProficiency(character, statKey) || customSavingThrowProficiencies[statKey];
    
    const baseModifier = Math.floor((statValue - 10) / 2);
    const totalBonus = baseModifier + (isProficient ? proficiencyBonus : 0);
    
    return {
      bonus: totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`,
      isProficient
    };
  };

  // Функция для получения бонуса навыка
  const getSkillBonus = (skillName: string): string => {
    if (!character) return '+0';
    
    const skillToStatMap: { [key: string]: string } = {
      'acrobatics': 'dexterity',
      'animal_handling': 'wisdom',
      'arcana': 'intelligence',
      'athletics': 'strength',
      'deception': 'charisma',
      'history': 'intelligence',
      'insight': 'wisdom',
      'intimidation': 'charisma',
      'investigation': 'intelligence',
      'medicine': 'wisdom',
      'nature': 'intelligence',
      'perception': 'wisdom',
      'performance': 'charisma',
      'persuasion': 'charisma',
      'religion': 'intelligence',
      'sleight_of_hand': 'dexterity',
      'stealth': 'dexterity',
      'survival': 'wisdom'
    };

    const statKey = skillToStatMap[skillName.toLowerCase()] || 'strength';
    const statValue = getActualStatValue(statKey);
    const proficiencyBonus = Math.floor((character.level - 1) / 4) + 2;
    const isProficient = hasSkillProficiency(character, skillName) || customSkillProficiencies[skillName.toLowerCase()];
    const isCompetent = skillCompetencies[skillName.toLowerCase()] || false;
    
    const baseModifier = Math.floor((statValue - 10) / 2);
    let totalBonus = baseModifier;
    
    if (isProficient) {
      totalBonus += proficiencyBonus;
    }
    
    // Компетенция добавляет бонус мастерства еще раз
    if (isCompetent) {
      totalBonus += proficiencyBonus;
    }
    
    return totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
  };

  // Функция для получения детального расчета навыка
  const getSkillCalculation = (skillName: string): string => {
    if (!character) return '';
    
    const skillToStatMap: { [key: string]: string } = {
      'acrobatics': 'dexterity',
      'animal_handling': 'wisdom',
      'arcana': 'intelligence',
      'athletics': 'strength',
      'deception': 'charisma',
      'history': 'intelligence',
      'insight': 'wisdom',
      'intimidation': 'charisma',
      'investigation': 'intelligence',
      'medicine': 'wisdom',
      'nature': 'intelligence',
      'perception': 'wisdom',
      'performance': 'charisma',
      'persuasion': 'charisma',
      'religion': 'intelligence',
      'sleight_of_hand': 'dexterity',
      'stealth': 'dexterity',
      'survival': 'wisdom'
    };

    const statKey = skillToStatMap[skillName.toLowerCase()] || 'strength';
    const statValue = getActualStatValue(statKey);
    const proficiencyBonus = Math.floor((character.level - 1) / 4) + 2;
    const isProficient = hasSkillProficiency(character, skillName) || customSkillProficiencies[skillName.toLowerCase()];
    const isCompetent = skillCompetencies[skillName.toLowerCase()] || false;
    
    const baseModifier = Math.floor((statValue - 10) / 2);
    let calculation = `${baseModifier}(Модификатор ${getStatNameInRussian(statKey)})`;
    
    if (isProficient) {
      calculation += ` + ${proficiencyBonus}(Бонус мастерства)`;
    }
    
    if (isCompetent) {
      calculation += ` + ${proficiencyBonus}(Компетенция)`;
    }
    
    const totalBonus = baseModifier + (isProficient ? proficiencyBonus : 0) + (isCompetent ? proficiencyBonus : 0);
    calculation += ` = ${totalBonus >= 0 ? '+' : ''}${totalBonus}`;
    
    return calculation;
  };

  // Компонент сетки инвентаря (упрощенная версия для V2)
  const InventoryGrid: React.FC<{ character: CharacterV2 | null; inventories: any[] }> = ({ character, inventories }) => {
    const renderStartTime = performance.now();
    console.log('🎨 [PERF] Начало рендеринга InventoryGrid');
    
    const equipmentSlots = 16; // 2 строки по 8 слотов для экипировки
    const inventorySlots = 48; // 6 строк по 8 слотов для обычного инвентаря
    
    // Определяем слоты экипировки
    const equipmentSlotTypes = [
      // Первая строка: Правая рука, правая рука, кольцо, шлем, перчатки, плащ, *, *
      ['one_hand', 'one_hand', 'ring', 'head', 'arms', 'cloak', 'versatile', 'versatile'],
      // Вторая строка: Левая рука, левая рука, кольцо, торс, сапоги, ожерелье, *, *
      ['one_hand', 'one_hand', 'ring', 'body', 'feet', 'necklace', 'versatile', 'versatile']
    ];

    // Функция для получения иконки слота
    const getSlotIcon = (slotType: string) => {
      const iconMap: { [key: string]: string } = {
        'one_hand': 'hand.png',
        'ring': 'ring.png',
        'head': 'helm.png',
        'arms': 'gloves.png',
        'cloak': 'cloak.png',
        'body': 'armor.png',
        'feet': 'boots.png',
        'necklace': 'necklace.png',
        'versatile': 'hand.png'
      };
      
      const iconPath = iconMap[slotType] || 'hand.png';
      return `/icons/slots/${iconPath}`;
    };

    const handleAddItemClick = () => {
      setShowItemSelector(true);
    };

    return (
      <div className="relative">
        {/* Секция экипировки */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Экипировка</h3>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: equipmentSlots }, (_, index) => {
              const row = Math.floor(index / 8);
              const col = index % 8;
              const slotType = equipmentSlotTypes[row][col];
              const iconPath = getSlotIcon(slotType);
              
              return (
                <div
                  key={index}
                  className="w-16 h-16 border border-gray-300 rounded flex items-center justify-center bg-gray-100 relative"
                  title={`Слот: ${slotType}`}
                >
                  <img 
                    src={iconPath} 
                    alt={slotType}
                    className="w-8 h-8 opacity-40"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Секция рюкзака */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Рюкзак</h3>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: inventorySlots }, (_, index) => {
              const isLastSlot = index === inventorySlots - 1;
              
              // Находим предмет в этом слоте
              // Пока что просто берем первые предметы из инвентарей
              const allItems = inventories.flatMap(inv => inv.items || []);
              const inventoryItem = allItems[index];
              
              return (
                <div
                  key={index}
                  className={`w-16 h-16 border rounded flex items-center justify-center relative ${
                    isLastSlot 
                      ? 'bg-blue-50 border-blue-300 cursor-pointer hover:bg-blue-100 transition-colors' 
                      : inventoryItem
                        ? 'border-gray-400 bg-white cursor-pointer hover:bg-gray-50 transition-colors'
                        : 'border-dashed border-gray-300 bg-gray-50'
                  }`}
                  title={
                    isLastSlot 
                      ? 'Добавить предмет' 
                      : inventoryItem 
                        ? `${inventoryItem.card?.name || 'Предмет'} (${inventoryItem.quantity || 1})`
                        : `Слот рюкзака ${index + 1}`
                  }
                  onClick={isLastSlot ? handleAddItemClick : undefined}
                >
                  {isLastSlot ? (
                    <Plus className="w-6 h-6 text-blue-600" />
                  ) : inventoryItem ? (
                    <div className="w-full h-full flex items-center justify-center">
                      {inventoryItem.card?.image_url ? (
                        <img 
                          src={inventoryItem.card.image_url} 
                          alt={inventoryItem.card.name}
                          className="w-12 h-12 object-contain rounded"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = '/default_image.png';
                          }}
                        />
                      ) : (
                        <Package className="w-6 h-6 text-gray-600" />
                      )}
                      {inventoryItem.quantity > 1 && (
                        <div className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                          {inventoryItem.quantity}
                        </div>
                      )}
                    </div>
                  ) : index < 6 ? (
                    <Package className="w-4 h-4 text-gray-300" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderBasicTab = () => {
    if (!character) return null;

    // Создаем временный объект персонажа с актуальными значениями характеристик
    const characterWithActualStats = {
      ...character,
      strength: getActualStatValue('strength'),
      dexterity: getActualStatValue('dexterity'),
      constitution: getActualStatValue('constitution'),
      intelligence: getActualStatValue('intelligence'),
      wisdom: getActualStatValue('wisdom'),
      charisma: getActualStatValue('charisma'),
      level: getActualDerivedStatValue('level'),
      max_hp: getActualDerivedStatValue('max_hp'),
      current_hp: getActualDerivedStatValue('current_hp'),
      speed: getActualDerivedStatValue('speed')
    };

    const derivedStats = calculateDerivedStats(characterWithActualStats);
    const stats = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

    return (
      <div className="space-y-6">
        {/* Характеристики и Навыки */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex gap-6">
            {/* Характеристики - узкий столбец */}
            <div className="w-1/5">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Характеристики</h2>
              <div className="space-y-1">
                {stats.map((statKey) => {
                  const statValue = getActualStatValue(statKey);
                  const savingThrow = getSavingThrowBonus(statKey);
                  const statNameInRussian = getStatNameInRussian(statKey);
                  const isModified = modifiedStats[statKey] !== undefined;
                  
                  return (
                    <div key={statKey} className="flex cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => openStatModal(statKey)}>
                      {/* Название характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 bg-gray-50 rounded-l-lg w-1/4">
                        <div className="text-xs text-gray-600 uppercase">{statNameInRussian}</div>
                      </div>
                      
                      {/* Значение характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 bg-gray-50 w-1/4">
                        <div className={`text-xs ${isModified ? 'text-purple-600 font-semibold' : 'text-gray-500'}`}>{statValue}</div>
                      </div>
                      
                      {/* Модификатор характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 bg-gray-50 w-1/4">
                        <div className={`text-sm font-bold ${isModified ? 'text-purple-600' : 'text-gray-900'}`}>{getModifier(statValue)}</div>
                      </div>
                      
                      {/* Спасбросок - 25% */}
                      <div className="flex items-center justify-center p-2 bg-gray-50 rounded-r-lg w-1/4">
                        <div 
                          className={`text-sm ${savingThrow.isProficient ? 'font-bold' : 'font-normal'} ${isModified ? 'text-purple-600' : 'text-gray-900'} cursor-help relative z-10`}
                          title={`Спасбросок ${statNameInRussian} ${savingThrow.bonus}`}
                          style={{ zIndex: 10 }}
                        >
                          {savingThrow.bonus}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Блок уровня и мастерства - 2x2 */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div 
                  className="bg-blue-50 rounded-lg p-3 text-center cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => openDerivedStatModal('level')}
                >
                  <div className="text-xs text-blue-600 font-medium mb-1">Уровень</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['level'] !== undefined ? 'text-purple-600' : 'text-blue-900'}`}>
                    {getActualDerivedStatValue('level')}
                  </div>
                </div>
                <div 
                  className="bg-purple-50 rounded-lg p-3 text-center cursor-pointer hover:bg-purple-100 transition-colors"
                  onClick={() => openDerivedStatModal('proficiency')}
                >
                  <div className="text-xs text-purple-600 font-medium mb-1">Мастерство</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['proficiency'] !== undefined ? 'text-purple-600' : 'text-purple-900'}`}>
                    +{getActualDerivedStatValue('proficiency')}
                  </div>
                </div>
              </div>

              {/* Блок защиты, скорости, здоровья и пассивного восприятия - 2x2 */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div 
                  className="bg-green-50 rounded-lg p-3 text-center cursor-pointer hover:bg-green-100 transition-colors"
                  onClick={() => openDerivedStatModal('ac')}
                >
                  <div className="text-xs text-green-600 font-medium mb-1">Защита</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['ac'] !== undefined ? 'text-purple-600' : 'text-green-900'}`}>
                    {getActualDerivedStatValue('ac')}
                  </div>
                </div>
                <div 
                  className="bg-orange-50 rounded-lg p-3 text-center cursor-pointer hover:bg-orange-100 transition-colors"
                  onClick={() => openDerivedStatModal('speed')}
                >
                  <div className="text-xs text-orange-600 font-medium mb-1">Скорость</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['speed'] !== undefined ? 'text-purple-600' : 'text-orange-900'}`}>
                    {getActualDerivedStatValue('speed')}
                  </div>
                </div>
                <div 
                  className="bg-red-50 rounded-lg p-3 text-center cursor-pointer hover:bg-red-100 transition-colors"
                  onClick={() => openDerivedStatModal('hp')}
                >
                  <div className="text-xs text-red-600 font-medium mb-1">Хиты</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['current_hp'] !== undefined || modifiedDerivedStats['max_hp'] !== undefined ? 'text-purple-600' : 'text-red-900'}`}>
                    {getActualDerivedStatValue('current_hp')}/{getActualDerivedStatValue('max_hp')}
                  </div>
                </div>
                <div 
                  className="bg-indigo-50 rounded-lg p-3 text-center cursor-pointer hover:bg-indigo-100 transition-colors"
                  onClick={() => openDerivedStatModal('passive_perception')}
                >
                  <div className="text-xs text-indigo-600 font-medium mb-1">Восприятие</div>
                  <div className={`text-lg font-bold ${modifiedDerivedStats['passive_perception'] !== undefined ? 'text-purple-600' : 'text-indigo-900'}`}>
                    {getActualDerivedStatValue('passive_perception')}
                  </div>
                </div>
              </div>
            </div>

            {/* Навыки - уменьшенный столбец */}
            <div className="w-1/5">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Навыки</h2>
              <div className="grid grid-cols-1 gap-1">
                {[
                  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
                  'history', 'insight', 'intimidation', 'investigation', 'medicine',
                  'nature', 'perception', 'performance', 'persuasion', 'religion',
                  'sleight_of_hand', 'stealth', 'survival'
                ].map((skillName) => {
                  const isProficient = hasSkillProficiency(character, skillName) || customSkillProficiencies[skillName.toLowerCase()];
                  const isCompetent = skillCompetencies[skillName.toLowerCase()] || false;
                  const isModified = modifiedSkills[skillName.toLowerCase()] !== undefined;
                  const currentBonus = getSkillBonus(skillName);
                  
                  return (
                    <div 
                      key={skillName} 
                      className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors ${
                        isProficient || isCompetent ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
                      }`}
                      onClick={() => openSkillModal(skillName)}
                    >
                      <div className="flex items-center space-x-1">
                        <span className={`text-xs font-medium ${isModified ? 'text-purple-600' : 'text-gray-900'}`}>
                          {getSkillNameInRussian(skillName)}
                        </span>
                        {isProficient && <span className="text-xs bg-green-100 text-green-800 px-1 py-0.5 rounded">М</span>}
                        {isCompetent && <span className="text-xs bg-blue-100 text-blue-800 px-1 py-0.5 rounded">К</span>}
                      </div>
                      <div className={`text-xs font-bold ${isModified ? 'text-purple-600' : 'text-gray-900'}`}>
                        {currentBonus}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Инвентарь */}
            <div className="w-3/5">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Инвентарь</h2>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <InventoryGrid character={character} inventories={characterInventories} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderClassRaceTab = () => {
    if (!character) return null;

    return (
      <div className="space-y-6">
        {/* Информация о классе и расе */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Класс и Раса</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Раса</h3>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="font-medium text-blue-900">{character.race}</div>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Класс</h3>
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="font-medium text-green-900">{character.class}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderInventoryTab = () => {
    if (!character) return null;

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Инвентарь</h2>
          <InventoryGrid character={character} inventories={characterInventories} />
        </div>
      </div>
    );
  };

  const renderActionsTab = () => {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Действия</h2>
          <div className="text-center py-8">
            <Sword className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">Действия персонажа будут реализованы позже</p>
          </div>
        </div>
      </div>
    );
  };

  const renderPassivesTab = () => {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Пассивы</h2>
          <div className="text-center py-8">
            <Star className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">Пассивные способности персонажа будут реализованы позже</p>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка персонажа...</p>
        </div>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">❌</div>
          <p className="text-gray-600">{error || 'Персонаж не найден'}</p>
          <Link
            to="/characters-v2"
            className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Вернуться к списку
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'basic', name: 'Основное', icon: User },
    { id: 'class-race', name: 'Класс и Раса', icon: Star },
    { id: 'inventory', name: 'Инвентарь', icon: Package },
    { id: 'actions', name: 'Действия', icon: Sword },
    { id: 'passives', name: 'Пассивы', icon: Star }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <Link
                to="/characters-v2"
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Назад
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{character.name}</h1>
                <p className="text-gray-600">
                  {character.race} • {character.class} {character.level} ур.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Link
                to={`/characters-v2/${character.id}/edit`}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Edit className="w-4 h-4 mr-2" />
                Редактировать
              </Link>
              <button
                onClick={handleDeleteCharacter}
                className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
              >
                Удалить
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Содержимое вкладок */}
        {activeTab === 'basic' && renderBasicTab()}
        {activeTab === 'class-race' && renderClassRaceTab()}
        {activeTab === 'inventory' && renderInventoryTab()}
        {activeTab === 'actions' && renderActionsTab()}
        {activeTab === 'passives' && renderPassivesTab()}
      </div>

      {/* Модальное окно характеристик */}
      {showStatModal && selectedStat && character && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  {getStatNameInRussian(selectedStat)} - {getFullStatName(selectedStat)}
                </h3>
                <button
                  onClick={closeStatModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Левая половина - Финальное значение и расчеты */}
                <div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Финальное значение
                    </label>
                    <input
                      type="number"
                      value={getActualStatValue(selectedStat)}
                      onChange={(e) => updateStatValue(selectedStat, parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      min="1"
                      max="30"
                    />
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Расчет характеристики:</h4>
                    <div className="bg-gray-50 p-3 rounded-md">
                      <div className="text-sm text-gray-600">
                        {getStatValue(character, selectedStat)} (Изначальная {getFullStatName(selectedStat).toLowerCase()})
                        {modifiedStats[selectedStat] !== undefined && (
                          <span className="text-purple-600 font-medium">
                            {' '}→ {modifiedStats[selectedStat]} (Изменено игроком)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {modifiedStats[selectedStat] !== undefined && (
                    <button
                      onClick={() => resetStatValue(selectedStat)}
                      className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Вернуться к обычному расчету
                    </button>
                  )}
                </div>

                {/* Правая половина - Модификаторы и навыки */}
                <div>
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Модификатор характеристики:</h4>
                    <div className="bg-blue-50 p-3 rounded-md mb-2">
                      <div className="text-lg font-bold text-blue-900">
                        {getModifier(getActualStatValue(selectedStat))}
                      </div>
                      <div className="text-xs text-blue-700">
                        ({getActualStatValue(selectedStat)} - 10) ÷ 2 = {getModifier(getActualStatValue(selectedStat))}
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Бонус к спасброскам:</h4>
                    <div className="bg-green-50 p-3 rounded-md">
                      <div className="text-lg font-bold text-green-900">
                        {getSavingThrowBonus(selectedStat).bonus}
                      </div>
                      <div className="text-xs text-green-700">
                        {Math.floor((getActualStatValue(selectedStat) - 10) / 2)} + {getSavingThrowBonus(selectedStat).isProficient ? Math.floor((character.level - 1) / 4) + 2 : 0}(Бонус владения) = {getSavingThrowBonus(selectedStat).bonus}
                      </div>
                      
                      <div className="flex items-center justify-between mt-3 p-2 bg-white rounded border">
                        <span className="text-sm text-gray-700">Владеет спасброском</span>
                        <button
                          onClick={() => toggleSavingThrowProficiency(selectedStat)}
                          className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                            getSavingThrowBonus(selectedStat).isProficient
                              ? 'bg-green-600 text-white' 
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {getSavingThrowBonus(selectedStat).isProficient ? '✓ Да' : '✗ Нет'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Связанные навыки:</h4>
                    <div className="space-y-1">
                      {[
                        { skill: 'acrobatics', stat: 'dexterity' },
                        { skill: 'animal_handling', stat: 'wisdom' },
                        { skill: 'arcana', stat: 'intelligence' },
                        { skill: 'athletics', stat: 'strength' },
                        { skill: 'deception', stat: 'charisma' },
                        { skill: 'history', stat: 'intelligence' },
                        { skill: 'insight', stat: 'wisdom' },
                        { skill: 'intimidation', stat: 'charisma' },
                        { skill: 'investigation', stat: 'intelligence' },
                        { skill: 'medicine', stat: 'wisdom' },
                        { skill: 'nature', stat: 'intelligence' },
                        { skill: 'perception', stat: 'wisdom' },
                        { skill: 'performance', stat: 'charisma' },
                        { skill: 'persuasion', stat: 'charisma' },
                        { skill: 'religion', stat: 'intelligence' },
                        { skill: 'sleight_of_hand', stat: 'dexterity' },
                        { skill: 'stealth', stat: 'dexterity' },
                        { skill: 'survival', stat: 'wisdom' }
                      ].filter(item => item.stat === selectedStat).map(({ skill }) => {
                        const isProficient = hasSkillProficiency(character, skill) || customSkillProficiencies[skill.toLowerCase()];
                        return (
                          <div key={skill} className={`flex items-center justify-between p-2 rounded ${isProficient ? 'bg-green-50' : 'bg-gray-50'}`}>
                            <span className={`text-sm ${isProficient ? 'text-green-800 font-medium' : 'text-gray-700'}`}>
                              {getSkillNameInRussian(skill)}
                            </span>
                            <span className={`text-sm font-bold ${isProficient ? 'text-green-800' : 'text-gray-700'}`}>
                              {getSkillBonus(skill)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно навыков */}
      {showSkillModal && selectedSkill && character && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  {getSkillNameInRussian(selectedSkill)}
                </h3>
                <button
                  onClick={closeSkillModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Левая половина - Финальное значение и расчеты */}
                <div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Финальное значение
                    </label>
                    <input
                      type="number"
                      value={getActualSkillValue(selectedSkill)}
                      onChange={(e) => updateSkillValue(selectedSkill, parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Расчет навыка:</h4>
                    <div className="bg-gray-50 p-3 rounded-md">
                      <div className="text-sm text-gray-600">
                        {getSkillCalculation(selectedSkill)}
                        {modifiedSkills[selectedSkill.toLowerCase()] !== undefined && (
                          <span className="text-purple-600 font-medium block mt-1">
                            → {modifiedSkills[selectedSkill.toLowerCase()]} (Изменено игроком)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {modifiedSkills[selectedSkill.toLowerCase()] !== undefined && (
                    <button
                      onClick={() => resetSkillValue(selectedSkill)}
                      className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Вернуться к обычному расчету
                    </button>
                  )}
                </div>

                {/* Правая половина - Владения и компетенция */}
                <div>
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Владения:</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded-md">
                        <span className="text-sm text-gray-700">Владеет навыком</span>
                        <button
                          onClick={() => toggleSkillProficiency(selectedSkill)}
                          className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                            hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()]
                              ? 'bg-green-600 text-white' 
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {(hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()]) ? '✓ Да' : '✗ Нет'}
                        </button>
                      </div>
                      
                      <div className={`flex items-center justify-between p-3 rounded-md ${
                        (hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()]) 
                          ? 'bg-blue-50' 
                          : 'bg-gray-100'
                      }`}>
                        <span className="text-sm text-gray-700">Компетентен</span>
                        <button
                          onClick={() => toggleSkillCompetency(selectedSkill)}
                          disabled={!(hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()])}
                          className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                            skillCompetencies[selectedSkill.toLowerCase()] 
                              ? 'bg-blue-600 text-white' 
                              : (hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()])
                                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {skillCompetencies[selectedSkill.toLowerCase()] ? '✓ Да' : '✗ Нет'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Детализация бонусов:</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Базовый модификатор:</span>
                        <span className="font-medium">{getSkillBonus(selectedSkill)}</span>
                      </div>
                      {(hasSkillProficiency(character, selectedSkill) || customSkillProficiencies[selectedSkill.toLowerCase()]) && (
                        <div className="flex justify-between text-green-700">
                          <span>Бонус мастерства:</span>
                          <span className="font-medium">+{Math.floor((character.level - 1) / 4) + 2}</span>
                        </div>
                      )}
                      {skillCompetencies[selectedSkill.toLowerCase()] && (
                        <div className="flex justify-between text-blue-700">
                          <span>Компетенция:</span>
                          <span className="font-medium">+{Math.floor((character.level - 1) / 4) + 2}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Объяснение:</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      <p>• <strong>Владение</strong> - персонаж знает этот навык и получает бонус мастерства</p>
                      <p>• <strong>Компетенция</strong> - персонаж особенно хорош в этом навыке и получает двойной бонус мастерства</p>
                      <p>• Изменение значения навыка перезаписывает автоматический расчет</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно производных характеристик */}
      {showDerivedStatModal && selectedDerivedStat && character && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  {selectedDerivedStat === 'level' && 'Уровень'}
                  {selectedDerivedStat === 'proficiency' && 'Мастерство'}
                  {selectedDerivedStat === 'ac' && 'Защита'}
                  {selectedDerivedStat === 'speed' && 'Скорость'}
                  {selectedDerivedStat === 'hp' && 'Хиты'}
                  {selectedDerivedStat === 'passive_perception' && 'Пассивное восприятие'}
                </h3>
                <button
                  onClick={closeDerivedStatModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Левая половина - Финальное значение и расчеты */}
                <div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Финальное значение
                    </label>
                    {selectedDerivedStat === 'hp' ? (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Максимальные хиты</label>
                          <input
                            type="number"
                            value={getActualDerivedStatValue('max_hp')}
                            onChange={(e) => updateDerivedStatValue('max_hp', parseInt(e.target.value) || 0)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            min="1"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Текущие хиты</label>
                          <input
                            type="number"
                            value={getActualDerivedStatValue('current_hp')}
                            onChange={(e) => updateDerivedStatValue('current_hp', parseInt(e.target.value) || 0)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            min="0"
                            max={getActualDerivedStatValue('max_hp')}
                          />
                        </div>
                      </div>
                    ) : (
                      <input
                        type="number"
                        value={getActualDerivedStatValue(selectedDerivedStat)}
                        onChange={(e) => updateDerivedStatValue(selectedDerivedStat, parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min="1"
                        max={selectedDerivedStat === 'level' ? 20 : undefined}
                      />
                    )}
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Расчет:</h4>
                    <div className="bg-gray-50 p-3 rounded-md">
                      <div className="text-sm text-gray-600">
                        {selectedDerivedStat === 'level' && (
                          <>
                            {character.level} (Изначальный уровень)
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'proficiency' && (
                          <>
                            ({character.level} - 1) ÷ 4 + 2 = {Math.floor((character.level - 1) / 4) + 2} (Базовый расчет)
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'ac' && (
                          <>
                            10 + {Math.floor((getActualStatValue('dexterity') - 10) / 2)}(Модификатор ЛВК) = {10 + Math.floor((getActualStatValue('dexterity') - 10) / 2)} (Базовая защита)
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'speed' && (
                          <>
                            {character.speed} (Изначальная скорость)
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'hp' && (
                          <>
                            {character.max_hp}/{character.current_hp} (Изначальные хиты)
                            {(modifiedDerivedStats['max_hp'] !== undefined || modifiedDerivedStats['current_hp'] !== undefined) && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {getActualDerivedStatValue('max_hp')}/{getActualDerivedStatValue('current_hp')} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'passive_perception' && (
                          <>
                            10 + {Math.floor((getActualStatValue('wisdom') - 10) / 2)}(Модификатор МДР) + {(hasSkillProficiency(character, 'perception') || customSkillProficiencies['perception']) ? Math.floor((character.level - 1) / 4) + 2 : 0}(Бонус владения восприятием) = {10 + Math.floor((getActualStatValue('wisdom') - 10) / 2) + ((hasSkillProficiency(character, 'perception') || customSkillProficiencies['perception']) ? Math.floor((character.level - 1) / 4) + 2 : 0)}
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {(modifiedDerivedStats[selectedDerivedStat] !== undefined || 
                    (selectedDerivedStat === 'hp' && (modifiedDerivedStats['max_hp'] !== undefined || modifiedDerivedStats['current_hp'] !== undefined))) && (
                    <button
                      onClick={() => {
                        if (selectedDerivedStat === 'hp') {
                          resetDerivedStatValue('max_hp');
                          resetDerivedStatValue('current_hp');
                        } else {
                          resetDerivedStatValue(selectedDerivedStat);
                        }
                      }}
                      className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Вернуться к обычному расчету
                    </button>
                  )}
                </div>

                {/* Правая половина - Дополнительная информация */}
                <div>
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Информация:</h4>
                    <div className="bg-blue-50 p-3 rounded-md">
                      <div className="text-sm text-blue-800">
                        {selectedDerivedStat === 'level' && (
                          <>
                            <p className="font-medium mb-1">Уровень персонажа:</p>
                            <p>• Определяет бонус мастерства</p>
                            <p>• Влияет на количество заклинаний</p>
                            <p>• Максимум: 20 уровней</p>
                          </>
                        )}
                        {selectedDerivedStat === 'proficiency' && (
                          <>
                            <p className="font-medium mb-1">Бонус мастерства:</p>
                            <p>• Добавляется к владениям</p>
                            <p>• Рассчитывается от уровня</p>
                            <p>• Влияет на спасброски и навыки</p>
                          </>
                        )}
                        {selectedDerivedStat === 'ac' && (
                          <>
                            <p className="font-medium mb-1">Класс защиты:</p>
                            <p>• Базовая защита без брони</p>
                            <p>• 10 + модификатор ЛВК</p>
                            <p>• Броня может изменять формулу</p>
                          </>
                        )}
                        {selectedDerivedStat === 'speed' && (
                          <>
                            <p className="font-medium mb-1">Скорость:</p>
                            <p>• Расстояние за ход</p>
                            <p>• Зависит от расы</p>
                            <p>• Может изменяться эффектами</p>
                          </>
                        )}
                        {selectedDerivedStat === 'hp' && (
                          <>
                            <p className="font-medium mb-1">Хиты:</p>
                            <p>• Максимальные - полное здоровье</p>
                            <p>• Текущие - актуальное состояние</p>
                            <p>• При 0 - персонаж теряет сознание</p>
                          </>
                        )}
                        {selectedDerivedStat === 'passive_perception' && (
                          <>
                            <p className="font-medium mb-1">Пассивное восприятие:</p>
                            <p>• 10 + модификатор МДР</p>
                            <p>• + бонус владения восприятием</p>
                            <p>• Используется для обнаружения скрытых существ</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Влияние на другие характеристики:</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      {selectedDerivedStat === 'level' && (
                        <>
                          <p>• <strong>Мастерство:</strong> ({character.level} - 1) ÷ 4 + 2</p>
                          <p>• <strong>Заклинания:</strong> количество зависит от уровня</p>
                          <p>• <strong>Умения класса:</strong> получаются на определенных уровнях</p>
                        </>
                      )}
                      {selectedDerivedStat === 'proficiency' && (
                        <>
                          <p>• <strong>Спасброски:</strong> +{getActualDerivedStatValue('proficiency')} при владении</p>
                          <p>• <strong>Навыки:</strong> +{getActualDerivedStatValue('proficiency')} при владении</p>
                          <p>• <strong>Атаки:</strong> +{getActualDerivedStatValue('proficiency')} к броску атаки</p>
                        </>
                      )}
                      {selectedDerivedStat === 'ac' && (
                        <>
                          <p>• <strong>Сложность попадания:</strong> противник должен выбросить ≥ {getActualDerivedStatValue('ac')}</p>
                          <p>• <strong>Уклонение:</strong> защита от атак ближнего и дальнего боя</p>
                        </>
                      )}
                      {selectedDerivedStat === 'speed' && (
                        <>
                          <p>• <strong>Движение:</strong> {getActualDerivedStatValue('speed')} футов за ход</p>
                          <p>• <strong>Бег:</strong> ×2 ({getActualDerivedStatValue('speed') * 2} футов)</p>
                        </>
                      )}
                      {selectedDerivedStat === 'hp' && (
                        <>
                          <p>• <strong>Смерть:</strong> при достижении -{getActualDerivedStatValue('max_hp')} хитов</p>
                          <p>• <strong>Спасброски смерти:</strong> при 0 хитах</p>
                        </>
                      )}
                      {selectedDerivedStat === 'passive_perception' && (
                        <>
                          <p>• <strong>Обнаружение:</strong> скрытые существа с проверкой &lt; {getActualDerivedStatValue('passive_perception')}</p>
                          <p>• <strong>Скрытность:</strong> противник должен превзойти это значение</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно выбора предметов */}
      <ItemSelector
        isOpen={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        onAddItems={handleAddItems}
        characterId={character?.id || ''}
      />
    </div>
  );
};

export default CharacterDetailV2;