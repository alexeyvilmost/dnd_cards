import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Package, Weight, Coins, Shield, Heart, Zap, User, Sword, Star, Plus, X, Dices, Eye } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import ItemSelector from '../components/ItemSelector';
import CardPreview from '../components/CardPreview';
import CardDetailModal from '../components/CardDetailModal';
import ActionAttackModal from '../components/ActionAttackModal';
import { Card, Action } from '../types';
import { actionsApi } from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { getRussianName } from '../utils/russianTranslations';
import { getRarityBorderColor } from '../utils/rarityColors';
import {
  CharacterV3,
  calculateDerivedStats,
  getStatName,
  getFullStatName,
  getSkillName,
  getSavingThrowName,
  hasSkillProficiency,
  hasSavingThrowProficiency,
  getStatValue,
} from '../utils/characterCalculationsV3';
import {
  getAllSkillNames,
  getDependentNames,
  getRule,
  getPrimaryStatForSkill,
  getRuleDependencyNames,
  getRuleFormulas,
  getRuleRussianName,
  normalizeRuleIdentifier,
} from '../utils/characterRules';
import {
  evaluateCharacterFormula,
  formatSignedValue,
  selectRuleFormula,
} from '../utils/characterFormulaEvaluator';

const CharacterDetailV3: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  // const { } = useAuth(); // User context not needed in this component
  const [character, setCharacter] = useState<CharacterV3 | null>(null);
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

  // Кэш для эффектов экипированных предметов
  const [equippedEffectsCache, setEquippedEffectsCache] = useState<{
    characteristicBonuses: { [key: string]: number };
    skillBonuses: { [key: string]: number };
    savingThrowBonuses: { [key: string]: number };
  }>({
    characteristicBonuses: {},
    skillBonuses: {},
    savingThrowBonuses: {}
  });

  // Флаг для отслеживания изменений экипировки
  const [equipmentChanged, setEquipmentChanged] = useState(false);
  
  // Состояние для действий
  const [actions, setActions] = useState<{ [key: string]: Action }>({});
  const [loadingActions, setLoadingActions] = useState(false);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  
  const allSkillNames = useMemo(() => getAllSkillNames(), []);
  const skillDependencies = useMemo(
    () => (selectedSkill ? getRuleDependencyNames(selectedSkill) : []),
    [selectedSkill]
  );

  useEffect(() => {
    if (id) {
      loadCharacter();
    }
  }, [id]);

  // Загружаем действия персонажа
  useEffect(() => {
    const loadActions = async () => {
      try {
        setLoadingActions(true);
        const actionIds = ['action_unarmed_strike', 'action_melee_attack'];
        const loadedActions: { [key: string]: Action } = {};

        await Promise.all(
          actionIds.map(async (actionId) => {
            try {
              // Пытаемся найти по card_number через поиск
              const response = await actionsApi.getActions({ search: actionId, limit: 100 });
              const action = response.actions.find(a => a.card_number === actionId);
              if (action) {
                loadedActions[actionId] = action;
              }
            } catch (error) {
              console.warn(`Ошибка загрузки действия ${actionId}:`, error);
            }
          })
        );

        setActions(loadedActions);
      } catch (error) {
        console.error('Ошибка загрузки действий:', error);
      } finally {
        setLoadingActions(false);
      }
    };

    loadActions();
  }, []);

  // Обновляем кэш эффектов только при изменении экипировки
  useEffect(() => {
    if (equipmentChanged && characterInventories.length > 0) {
      console.log('🔄 [EFFECTS] Обновляем кэш эффектов экипировки');
      const newEffects = getEquippedItemEffects();
      setEquippedEffectsCache(newEffects);
      
      // Обновляем информацию о защите локально (без API вызова)
      updateArmorInfoFromInventories();
      
      setEquipmentChanged(false);
    }
  }, [equipmentChanged, characterInventories]);

  const loadCharacter = async () => {
    if (!id) return;

    const startTime = performance.now();
    console.log('🚀 [PERF] Начало загрузки персонажа');

    try {
      setLoading(true);
      setError(null);
      
      const characterStartTime = performance.now();
      const response = await apiClient.get<CharacterV3>(`/api/characters-v2/${id}`);
      const characterEndTime = performance.now();
      console.log(`⏱️ [PERF] Загрузка персонажа: ${(characterEndTime - characterStartTime).toFixed(2)}ms`);
      
      setCharacter(response.data);
      
      // Загружаем инвентари персонажа (передаем ID напрямую)
      const inventoriesStartTime = performance.now();
      await loadCharacterInventoriesById(response.data.id);
      const inventoriesEndTime = performance.now();
      console.log(`⏱️ [PERF] Загрузка инвентарей: ${(inventoriesEndTime - inventoriesStartTime).toFixed(2)}ms`);
      
      // Обновляем информацию о защите на основе инвентарей
      updateArmorInfoFromInventories();
      
      // Загружаем информацию о защите (для совместимости)
      const armorStartTime = performance.now();
      await loadArmorInfo(response.data.id);
      const armorEndTime = performance.now();
      console.log(`⏱️ [PERF] Загрузка информации о защите: ${(armorEndTime - armorStartTime).toFixed(2)}ms`);
      
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
    return loadCharacterInventoriesById(character.id);
  };

  const loadCharacterInventoriesById = async (characterId: string) => {
    const startTime = performance.now();
    console.log('📦 [PERF] Начало загрузки инвентарей');

    try {
      const apiStartTime = performance.now();
      const response = await apiClient.get(`/api/characters-v2/${characterId}/inventories`);
      const apiEndTime = performance.now();
      console.log(`🌐 [PERF] API запрос инвентарей: ${(apiEndTime - apiStartTime).toFixed(2)}ms`);
      
      console.log('Инвентари персонажа:', response.data);
      
      const stateStartTime = performance.now();
      setCharacterInventories(response.data || []);
      setEquipmentChanged(true); // Устанавливаем флаг изменения экипировки при первой загрузке
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
      navigate('/characters-v3');
    } catch (err) {
      setError('Ошибка удаления персонажа');
      console.error('Error deleting character:', err);
    }
  };

  const [isAddingItems, setIsAddingItems] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<any>(null);
  const [hoveredSlotRef, setHoveredSlotRef] = useState<HTMLDivElement | null>(null);
  
  // Состояние для информации о защите
  const [armorInfo, setArmorInfo] = useState<any>(null);

  // Модал подробного просмотра карты
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<any | null>(null);

  const openCardDetail = (item: any) => {
    if (!item || !item.card) return;
    setSelectedCard(item.card as Card);
    setSelectedInventoryItem(item);
    setShowCardDetailModal(true);
  };

  const closeCardDetail = () => {
    setShowCardDetailModal(false);
    setSelectedCard(null);
    setSelectedInventoryItem(null);
  };

  const handleEditCardFromModal = (cardId: string) => {
    setShowCardDetailModal(false);
    window.location.href = `/edit/${cardId}`;
  };

  const handleDeleteCardFromModal = (_cardId: string) => {
    // Удаление карт из инвентаря персонажа V3 (API V2) не поддерживается из этого модала
    closeCardDetail();
  };

  // Вспомогательная функция для получения информации о броне из инвентарей
  const getSimulatedArmorInfo = (inventories: any[]) => {
    let simulatedEquippedArmorType: string | null = null;
    let simulatedEquippedShield = false;

    inventories.forEach(inv => {
      if (inv.items && inv.items.length > 0) {
        inv.items.forEach((item: any) => {
          // Ищем только предметы в слоте "body"
          if (item.equipped_slot === 'body') {
            // Проверяем, является ли предмет бронёй (по типу или наличию properties с armor)
            if (item.card?.type === 'armor' || (item.card?.properties && item.card.properties.some((prop: string) => prop.includes('armor')))) {
              // Определяем тип брони из properties
              if (item.card.properties.includes('light_armor')) {
                simulatedEquippedArmorType = 'Легкая броня';
              } else if (item.card.properties.includes('medium_armor')) {
                simulatedEquippedArmorType = 'Средняя броня';
              } else if (item.card.properties.includes('heavy_armor')) {
                simulatedEquippedArmorType = 'Тяжелая броня';
              } else if (item.card.properties.includes('cloth')) {
                simulatedEquippedArmorType = 'Ткань';
              }
            }
          }
        });
      }
    });
    return { simulatedEquippedArmorType, simulatedEquippedShield };
  };

  // Функция для обновления информации о защите из инвентарей (без API)
  const updateArmorInfoFromInventories = () => {
    console.log('🛡️ [ARMOR] Updating armor info from inventories');
    if (!characterInventories || characterInventories.length === 0) {
      console.log('🛡️ [ARMOR] No inventories available');
      return;
    }
    
    let equippedArmorType: string | null = null;
    let armorBonus = 0;
    
    characterInventories.forEach(inv => {
      if (inv.items) {
        inv.items.forEach((item: any) => {
          // Ищем только предметы в слоте "body"
          if (item.equipped_slot === 'body') {
            console.log('🛡️ [ARMOR] Found item in body slot:', item.card?.name);
            console.log('🛡️ [ARMOR] Full card structure:', item.card);
            console.log('🛡️ [ARMOR] Card properties:', item.card?.properties);
            console.log('🛡️ [ARMOR] Card armor_type:', item.card?.armor_type);
            console.log('🛡️ [ARMOR] Card armor_bonus:', item.card?.armor_bonus);
            
            // Проверяем, является ли предмет бронёй (по типу или наличию properties с armor)
            if (item.card?.type === 'armor' || (item.card?.properties && item.card.properties.some((prop: string) => prop.includes('armor')))) {
              // Определяем тип брони из properties
              if (item.card.properties.includes('light_armor')) {
                equippedArmorType = 'Легкая броня';
              } else if (item.card.properties.includes('medium_armor')) {
                equippedArmorType = 'Средняя броня';
              } else if (item.card.properties.includes('heavy_armor')) {
                equippedArmorType = 'Тяжелая броня';
              } else if (item.card.properties.includes('cloth')) {
                equippedArmorType = 'Ткань';
              }
              
              // Получаем бонус брони из bonus_value
              armorBonus = parseInt(item.card.bonus_value) || 0;
              console.log('🛡️ [ARMOR] Armor found in body slot:', equippedArmorType, 'bonus:', armorBonus);
            }
          }
        });
      }
    });
    
    // Обновляем armorInfo локально
    const newArmorInfo = {
      armor_type: equippedArmorType || 'Без брони',
      details: {
        armor_bonus: armorBonus,
        max_dex_bonus: equippedArmorType === 'Средняя броня' ? 2 : undefined
      }
    };
    
    console.log('🛡️ [ARMOR] Setting new armorInfo:', newArmorInfo);
    setArmorInfo(newArmorInfo);
    
    console.log('🛡️ [ARMOR] Обновлена информация о защите локально:', {
      armor_type: equippedArmorType || 'Без брони',
      armor_bonus: armorBonus
    });
  };

  // Функция для расчета изменений характеристик при экипировке/снятии предмета
  // Функция для определения типа оружия (ближний/дальний бой) по тегам
  const getWeaponType = (card: any): 'melee' | 'ranged' | null => {
    if (!card || card.type !== 'weapon') return null;
    
    const tags = card.tags || [];
    const hasMelee = tags.some((tag: string) => tag === 'Ближнее');
    const hasRanged = tags.some((tag: string) => tag === 'Дальнобойное');
    
    if (hasRanged) return 'ranged';
    if (hasMelee) return 'melee';
    
    // Если тегов нет, проверяем свойства
    const properties = card.properties || [];
    const hasAmmunition = properties.some((prop: string) => prop === 'ammunition' || prop === 'loading');
    
    return hasAmmunition ? 'ranged' : 'melee'; // По умолчанию считаем ближним, если нет дальнобойных свойств
  };

  const calculateStatChanges = (item: any, isEquipping: boolean) => {
    console.log('📊 [CHANGES] Calculating changes for:', item.card?.name, 'isEquipping:', isEquipping);
    console.log('📊 [CHANGES] Item effects:', item.card?.effects);
    
    const changes: string[] = [];
    
    // Обрабатываем эффекты предмета (если есть)
    if (item.card?.effects && Array.isArray(item.card.effects) && item.card.effects.length > 0) {
      item.card.effects.forEach((effect: any) => {
      const bonus = effect.modifier === '+' ? effect.value : -effect.value;
      const multiplier = isEquipping ? 1 : -1;
      const actualBonus = bonus * multiplier;
      
      if (effect.targetType === 'characteristic') {
        if (effect.targetSpecific === 'all') {
          ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(stat => {
            const currentValue = getActualStatValue(stat);
            const newValue = currentValue + actualBonus;
            changes.push(`${getRussianName('characteristic', stat)} ${currentValue} → ${newValue}`);
          });
        } else {
          const currentValue = getActualStatValue(effect.targetSpecific);
          const newValue = currentValue + actualBonus;
          changes.push(`${getRussianName('characteristic', effect.targetSpecific)} ${currentValue} → ${newValue}`);
        }
      } else if (effect.targetType === 'skill') {
        if (effect.targetSpecific === 'all') {
          const allSkills = allSkillNames;
          allSkills.forEach(skill => {
            const currentValue = getActualSkillValue(skill);
            const newValue = currentValue + actualBonus;
            const currentSign = currentValue >= 0 ? '+' : '';
            const newSign = newValue >= 0 ? '+' : '';
            changes.push(`${getRussianName('skill', skill)} ${currentSign}${currentValue} → ${newSign}${newValue}`);
          });
        } else {
          const currentValue = getActualSkillValue(effect.targetSpecific);
          const newValue = currentValue + actualBonus;
          const currentSign = currentValue >= 0 ? '+' : '';
          const newSign = newValue >= 0 ? '+' : '';
          changes.push(`${getRussianName('skill', effect.targetSpecific)} ${currentSign}${currentValue} → ${newSign}${newValue}`);
        }
      } else if (effect.targetType === 'saving_throw') {
        if (effect.targetSpecific === 'all') {
          ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(stat => {
            const currentSavingThrow = getSavingThrowBonus(stat);
            const currentValue = parseInt(currentSavingThrow.bonus.replace('+', '')) || 0;
            const newValue = currentValue + actualBonus;
            const currentSign = currentValue >= 0 ? '+' : '';
            const newSign = newValue >= 0 ? '+' : '';
            changes.push(`Спасбросок ${getRussianName('characteristic', stat)} ${currentSign}${currentValue} → ${newSign}${newValue}`);
          });
        } else {
          const currentSavingThrow = getSavingThrowBonus(effect.targetSpecific);
          const currentValue = parseInt(currentSavingThrow.bonus.replace('+', '')) || 0;
          const newValue = currentValue + actualBonus;
          const currentSign = currentValue >= 0 ? '+' : '';
          const newSign = newValue >= 0 ? '+' : '';
          changes.push(`Спасбросок ${getRussianName('characteristic', effect.targetSpecific)} ${currentSign}${currentValue} → ${newSign}${newValue}`);
        }
      }
      });
    }

    // Добавляем изменения защиты, если предмет влияет на броню
    console.log('🛡️ [DEFENSE] Item analysis:', {
      hasSlot: !!item.card?.slot,
      slot: item.card?.slot,
      type: item.card?.type,
      isArmorSlot: item.card?.slot && ['head', 'chest', 'legs', 'feet', 'hands', 'body', 'armor'].includes(item.card.slot),
      isArmorType: item.card?.type === 'armor' || item.card?.type === 'shield'
    });
    
    // Проверяем, что предмет влияет на защиту (предметы брони в слоте "body")
    const affectsDefense = item.card?.slot === 'body' && (
      item.card?.type === 'armor' || 
      item.card?.armor_type ||
      (item.card?.properties && item.card.properties.some((prop: string) => 
        prop.includes('armor') || prop.includes('cloth')
      ))
    );
    
    console.log('🛡️ [DEFENSE] Affects defense check:', {
      slot: item.card?.slot,
      type: item.card?.type,
      properties: item.card?.properties,
      affectsDefense
    });
    
    if (affectsDefense) {
      console.log('🛡️ [DEFENSE] Checking defense changes for slot:', item.card.slot);
      
      // 1. Рассчитываем защиту ДО экипировки/снятия (используем текущее состояние)
      const currentDefense = getActualDerivedStatValue('ac');
      console.log('🛡️ [DEFENSE] Current defense:', currentDefense);

      // 2. Создаем временные инвентари для симуляции нового состояния
      let tempInventories = JSON.parse(JSON.stringify(characterInventories)); // Deep copy

      if (isEquipping) {
        // Симулируем экипировку предмета
        tempInventories = tempInventories.map((inv: any) => {
          if (inv.type === 'equipment') {
            return {
              ...inv,
              items: inv.items.map((i: any) => {
                // Если это экипируемый предмет, устанавливаем его слот
                if (i.id === item.id) {
                  return { ...i, equipped_slot: item.card.slot };
                }
                // Если другой предмет в том же слоте, снимаем его
                if (i.equipped_slot === item.card.slot && i.id !== item.id) {
                  return { ...i, equipped_slot: null };
                }
                return i;
              })
            };
          }
          return inv;
        });
      } else { // isUnequipping
        // Симулируем снятие предмета
        tempInventories = tempInventories.map((inv: any) => {
          if (inv.type === 'equipment') {
            return {
              ...inv,
              items: inv.items.map((i: any) => {
                if (i.id === item.id) {
                  return { ...i, equipped_slot: null };
                }
                return i;
              })
            };
          }
          return inv;
        });
      }

      // 3. Рассчитываем эффекты для симулированных инвентарей
      const simulatedEffectsCache = getEquippedItemEffects(tempInventories);

      // 4. Рассчитываем симулированное значение ловкости
      // Базовое значение ловкости (без эффектов)
      const baseDexValue = modifiedStats['dexterity'] !== undefined ? modifiedStats['dexterity'] : getStatValue(character, 'dexterity');
      // Добавляем бонусы ловкости из симулированных эффектов
      const simulatedDexterityValue = baseDexValue + (simulatedEffectsCache.characteristicBonuses['dexterity'] || 0);

      // 5. Определяем симулированный тип брони и щита
      const { simulatedEquippedArmorType, simulatedEquippedShield } = getSimulatedArmorInfo(tempInventories);

      // 6. Рассчитываем новую защиту с симулированными значениями
      // Локальная функция для расчета защиты
      const calculateDefense = (dexValue: number, armorType: string | null, armorBonus: number) => {
        const dexMod = Math.floor((dexValue - 10) / 2);
        
        // Если нет брони, используем базовую формулу
        if (!armorType || armorType === 'Без брони') {
          return 10 + dexMod;
        }
        
        // Рассчитываем с учетом типа брони
        let finalAC = armorBonus; // armorBonus уже содержит базовое значение брони
        
        switch (armorType) {
          case 'Ткань':
          case 'Легкая броня':
            finalAC += dexMod; // Полный бонус от ловкости
            break;
          case 'Средняя броня':
            finalAC += Math.min(dexMod, 2); // Максимум +2 от ловкости
            break;
          case 'Тяжелая броня':
            // Тяжелая броня не получает бонус от ловкости
            break;
        }
        
        return finalAC;
      };
      
      // Находим информацию о броне из симулированных инвентарей
      let simulatedArmorType = null;
      let simulatedArmorBonus = 0;
      
      tempInventories.forEach(inv => {
        if (inv.items) {
          inv.items.forEach((item: any) => {
            // Ищем только предметы в слоте "body"
            if (item.equipped_slot === 'body' && (item.card?.type === 'armor' || (item.card?.properties && item.card.properties.some((prop: string) => prop.includes('armor'))))) {
              // Определяем тип брони из properties
              if (item.card.properties.includes('light_armor')) {
                simulatedArmorType = 'Легкая броня';
              } else if (item.card.properties.includes('medium_armor')) {
                simulatedArmorType = 'Средняя броня';
              } else if (item.card.properties.includes('heavy_armor')) {
                simulatedArmorType = 'Тяжелая броня';
              } else if (item.card.properties.includes('cloth')) {
                simulatedArmorType = 'Ткань';
              }
              
              // Получаем бонус брони из bonus_value
              simulatedArmorBonus = parseInt(item.card.bonus_value) || 0;
            }
          });
        }
      });
      
      const newDefense = calculateDefense(simulatedDexterityValue, simulatedArmorType, simulatedArmorBonus);
      console.log('🛡️ [DEFENSE] New defense:', newDefense);

      // 7. Если защита изменилась, добавляем в список изменений
      if (currentDefense !== newDefense) {
        console.log('🛡️ [DEFENSE] Defense changed, adding to changes');
        changes.push(`Защита ${currentDefense} → ${newDefense}`);
      } else {
        console.log('🛡️ [DEFENSE] No defense change');
      }
    }

    console.log('📊 [CHANGES] Calculated changes:', changes);
    return changes;
  };

  // Функция для оптимистичного обновления инвентаря при экипировке
  // Функция для определения, какие слоты нужно освободить при экипировке оружия
  const getSlotsToUnequip = (slotType: string, card: any): string[] => {
    console.log('🔍 [FRONTEND_SLOTS] Определение слотов для освобождения:', { slotType, cardName: card?.name, cardType: card?.type });
    
    if (!card || card.type !== 'weapon') {
      console.log('🔍 [FRONTEND_SLOTS] Предмет не является оружием, освобождаем только слот', slotType);
      // Для не-оружия просто освобождаем тот же слот
      return [slotType];
    }

    const weaponType = getWeaponType(card);
    console.log('🔍 [FRONTEND_SLOTS] Тип оружия:', weaponType);

    const slotsToUnequip: string[] = [];
    
    // Определяем, какие слоты нужно освободить в зависимости от типа экипируемого оружия
    if (slotType === 'melee_two_hands' || slotType === 'ranged_two_hands') {
      // Двуручное оружие освобождает все слоты соответствующего ряда
      if (slotType === 'melee_two_hands') {
        // Освобождаем все слоты ближнего боя (верхний ряд)
        slotsToUnequip.push('melee_one_hand', 'melee_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Двуручное оружие ближнего боя - освобождаем слоты:', slotsToUnequip);
      } else {
        // Освобождаем все слоты дальнего боя (нижний ряд)
        slotsToUnequip.push('ranged_one_hand', 'ranged_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Двуручное оружие дальнего боя - освобождаем слоты:', slotsToUnequip);
      }
    } else if (slotType === 'melee_one_hand' || slotType === 'ranged_one_hand') {
      // Одноручное оружие освобождает все слоты соответствующего ряда
      if (slotType === 'melee_one_hand') {
        // Освобождаем все слоты ближнего боя (верхний ряд)
        slotsToUnequip.push('melee_one_hand', 'melee_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Одноручное оружие ближнего боя - освобождаем слоты:', slotsToUnequip);
      } else {
        // Освобождаем все слоты дальнего боя (нижний ряд)
        slotsToUnequip.push('ranged_one_hand', 'ranged_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Одноручное оружие дальнего боя - освобождаем слоты:', slotsToUnequip);
      }
    } else if (slotType === 'two_hands') {
      // Старый формат двуручного оружия - определяем тип по оружию
      if (weaponType === 'melee') {
        slotsToUnequip.push('melee_one_hand', 'melee_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Двуручное оружие ближнего боя (старый формат) - освобождаем слоты:', slotsToUnequip);
      } else {
        slotsToUnequip.push('ranged_one_hand', 'ranged_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Двуручное оружие дальнего боя (старый формат) - освобождаем слоты:', slotsToUnequip);
      }
    } else if (slotType === 'one_hand') {
      // Старый формат одноручного оружия - определяем тип по оружию
      if (weaponType === 'melee') {
        slotsToUnequip.push('melee_one_hand', 'melee_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Одноручное оружие ближнего боя (старый формат) - освобождаем слоты:', slotsToUnequip);
      } else {
        slotsToUnequip.push('ranged_one_hand', 'ranged_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Одноручное оружие дальнего боя (старый формат) - освобождаем слоты:', slotsToUnequip);
      }
    } else if (slotType === 'versatile') {
      // Универсальное оружие - определяем тип по оружию
      if (weaponType === 'melee') {
        slotsToUnequip.push('melee_one_hand', 'melee_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Универсальное оружие ближнего боя - освобождаем слоты:', slotsToUnequip);
      } else {
        slotsToUnequip.push('ranged_one_hand', 'ranged_two_hands', 'one_hand', 'versatile', 'two_hands');
        console.log('🔍 [FRONTEND_SLOTS] Универсальное оружие дальнего боя - освобождаем слоты:', slotsToUnequip);
      }
    } else {
      // Для других типов слотов просто освобождаем тот же слот
      slotsToUnequip.push(slotType);
      console.log('🔍 [FRONTEND_SLOTS] Другой тип слота - освобождаем только слот', slotType);
    }

    console.log('🔍 [FRONTEND_SLOTS] Итоговый список слотов для освобождения:', slotsToUnequip);
    return slotsToUnequip;
  };

  // Функция для проверки, нужно ли снимать предмет при экипировке нового оружия
  const shouldUnequipItem = (item: any, slotsToUnequip: string[], newItemCard: any): boolean => {
    console.log('🔍 [FRONTEND_UNEQUIP] Проверка предмета:', { 
      itemId: item.id, 
      itemName: item.card?.name, 
      equippedSlot: item.equipped_slot,
      slotsToUnequip 
    });
    
    if (!item.equipped_slot || !item.card) {
      console.log('🔍 [FRONTEND_UNEQUIP] Предмет не экипирован или нет карты');
      return false;
    }
    
    const equippedSlot = item.equipped_slot;
    
    // Если слот точно совпадает с одним из слотов для освобождения
    if (slotsToUnequip.includes(equippedSlot)) {
      console.log('✅ [FRONTEND_UNEQUIP] Слот точно совпадает:', equippedSlot, '-> СНИМАТЬ');
      return true;
    }
    
    // Специальная логика для оружия: проверяем, находится ли оно в соответствующем ряду
    if (item.card.type === 'weapon') {
      const weaponType = getWeaponType(item.card);
      const newWeaponType = getWeaponType(newItemCard);
      console.log('🔍 [FRONTEND_UNEQUIP] Тип текущего оружия:', weaponType, 'Тип нового оружия:', newWeaponType);
      
      // Определяем, какие типы слотов нужно освободить
      const hasMeleeSlots = slotsToUnequip.some(slot => 
        slot === 'melee_one_hand' || slot === 'melee_two_hands' || 
        (slot === 'one_hand' && newWeaponType === 'melee') ||
        (slot === 'versatile' && newWeaponType === 'melee')
      );
      const hasRangedSlots = slotsToUnequip.some(slot => 
        slot === 'ranged_one_hand' || slot === 'ranged_two_hands' || 
        (slot === 'one_hand' && newWeaponType === 'ranged') ||
        (slot === 'versatile' && newWeaponType === 'ranged')
      );
      
      console.log('🔍 [FRONTEND_UNEQUIP] hasMeleeSlots:', hasMeleeSlots, 'hasRangedSlots:', hasRangedSlots);
      
      // Если экипируем оружие ближнего боя, снимаем все оружие ближнего боя
      if (weaponType === 'melee' && hasMeleeSlots) {
        console.log('✅ [FRONTEND_UNEQUIP] Оружие ближнего боя и есть слоты для ближнего боя -> СНИМАТЬ');
        return true;
      }
      // Если экипируем оружие дальнего боя, снимаем все оружие дальнего боя
      if (weaponType === 'ranged' && hasRangedSlots) {
        console.log('✅ [FRONTEND_UNEQUIP] Оружие дальнего боя и есть слоты для дальнего боя -> СНИМАТЬ');
        return true;
      }
    } else {
      console.log('🔍 [FRONTEND_UNEQUIP] Предмет не является оружием (type:', item.card.type, ')');
    }
    
    console.log('❌ [FRONTEND_UNEQUIP] Предмет НЕ нужно снимать');
    return false;
  };

  const optimisticallyEquipItem = (item: any, slotType: string) => {
    console.log('🎯 [FRONTEND_EQUIP] Экипируем предмет:', { itemId: item.id, itemName: item.card?.name, slotType });
    
    if (!characterInventories || characterInventories.length === 0) {
      console.log('⚠️ [FRONTEND_EQUIP] Нет инвентарей');
      return;
    }
    
    // Определяем, какие слоты нужно освободить
    const slotsToUnequip = getSlotsToUnequip(slotType, item.card);
    console.log('🎯 [FRONTEND_EQUIP] Слоты для освобождения:', slotsToUnequip);
    
    setEquipmentChanged(true); // Устанавливаем флаг изменения экипировки
    setCharacterInventories(prevInventories => {
      let unequippedCount = 0;
      const updated = prevInventories.map(inventory => {
        if (inventory.character_id === character?.id) {
          return {
            ...inventory,
            items: inventory.items.map(invItem => {
              // Экипируем новый предмет
              if (invItem.id === item.id) {
                console.log('🎯 [FRONTEND_EQUIP] Экипируем новый предмет:', invItem.card?.name);
                return {
                  ...invItem,
                  equipped_slot: slotType
                };
              }
              // Снимаем предметы из слотов, которые нужно освободить
              if (shouldUnequipItem(invItem, slotsToUnequip, item.card)) {
                unequippedCount++;
                console.log('🎯 [FRONTEND_EQUIP] Снимаем предмет:', invItem.card?.name);
                return {
                  ...invItem,
                  equipped_slot: null
                };
              }
              return invItem;
            })
          };
        }
        return inventory;
      });
      console.log('🎯 [FRONTEND_EQUIP] Всего снято предметов:', unequippedCount);
      return updated;
    });
  };

  // Функция для оптимистичного обновления инвентаря при снятии
  const optimisticallyUnequipItem = (item: any) => {
    if (!characterInventories || characterInventories.length === 0) return;
    
    setEquipmentChanged(true); // Устанавливаем флаг изменения экипировки
    setCharacterInventories(prevInventories => {
      return prevInventories.map(inventory => {
        if (inventory.character_id === character?.id) {
          return {
            ...inventory,
            items: inventory.items.map(invItem => {
              if (invItem.id === item.id) {
                return {
                  ...invItem,
                  equipped_slot: null
                };
              }
              return invItem;
            })
          };
        }
        return inventory;
      });
    });
  };

  // Функция для отката изменений при ошибке
  const rollbackInventoryChanges = (item: any, wasEquipping: boolean) => {
    if (!characterInventories || characterInventories.length === 0) return;
    
    setCharacterInventories(prevInventories => {
      return prevInventories.map(inventory => {
        if (inventory.character_id === character?.id) {
          return {
            ...inventory,
            items: inventory.items.map(invItem => {
              if (invItem.id === item.id) {
                return {
                  ...invItem,
                  equipped_slot: wasEquipping ? null : item.equipped_slot
                };
              }
              return invItem;
            })
          };
        }
        return inventory;
      });
    });
  };

  // Функция для анализа эффектов экипированных предметов
  const getEquippedItemEffects = (inventoriesToAnalyze?: any[]) => {
    const inventories = inventoriesToAnalyze || characterInventories;
    if (!inventories || inventories.length === 0) {
      console.log('🔍 [EFFECTS] Нет инвентарей персонажа');
      return {
        characteristicBonuses: {},
        skillBonuses: {},
        savingThrowBonuses: {}
      };
    }

    const characteristicBonuses: { [key: string]: number } = {};
    const skillBonuses: { [key: string]: number } = {};
    const savingThrowBonuses: { [key: string]: number } = {};

    console.log('🔍 [EFFECTS] Анализируем инвентари:', inventories);

    // Проходим по всем инвентарям персонажа
    inventories.forEach((inventory, inventoryIndex) => {
      console.log(`🔍 [EFFECTS] Инвентарь ${inventoryIndex}:`, inventory);
      if (inventory.items && inventory.items.length > 0) {
        inventory.items.forEach((item: any, itemIndex: number) => {
          console.log(`🔍 [EFFECTS] Предмет ${itemIndex}:`, {
            name: item.card?.name,
            equipped_slot: item.equipped_slot,
            effects: item.card?.effects
          });
          
          // Проверяем, экипирован ли предмет
          if (item.equipped_slot && item.equipped_slot !== 'null' && item.equipped_slot !== '') {
            console.log(`✅ [EFFECTS] Предмет "${item.card?.name}" экипирован в слот "${item.equipped_slot}"`);
            
            // Анализируем эффекты предмета
            if (item.card?.effects && Array.isArray(item.card.effects) && item.card.effects.length > 0) {
              console.log(`✨ [EFFECTS] У предмета "${item.card?.name}" есть эффекты:`, item.card.effects);
              
              item.card.effects.forEach((effect: any, effectIndex: number) => {
                console.log(`🎯 [EFFECTS] Эффект ${effectIndex}:`, effect);
                const bonus = effect.modifier === '+' ? effect.value : -effect.value;
                
                if (effect.targetType === 'characteristic') {
                  if (effect.targetSpecific === 'all') {
                    // Применяем ко всем характеристикам
                    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(stat => {
                      characteristicBonuses[stat] = (characteristicBonuses[stat] || 0) + bonus;
                    });
                  } else {
                    // Применяем к конкретной характеристике
                    characteristicBonuses[effect.targetSpecific] = (characteristicBonuses[effect.targetSpecific] || 0) + bonus;
                  }
                } else if (effect.targetType === 'skill') {
                  if (effect.targetSpecific === 'all') {
                    // Применяем ко всем навыкам
                    const allSkills = allSkillNames;
                    allSkills.forEach(skill => {
                      skillBonuses[skill] = (skillBonuses[skill] || 0) + bonus;
                    });
                  } else {
                    // Применяем к конкретному навыку
                    console.log(`🎯 [EFFECTS] Применяем бонус ${bonus} к навыку "${effect.targetSpecific}"`);
                    skillBonuses[effect.targetSpecific] = (skillBonuses[effect.targetSpecific] || 0) + bonus;
                  }
                } else if (effect.targetType === 'saving_throw') {
                  if (effect.targetSpecific === 'all') {
                    // Применяем ко всем спасброскам
                    ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].forEach(stat => {
                      savingThrowBonuses[stat] = (savingThrowBonuses[stat] || 0) + bonus;
                    });
                  } else {
                    // Применяем к конкретному спасброску
                    savingThrowBonuses[effect.targetSpecific] = (savingThrowBonuses[effect.targetSpecific] || 0) + bonus;
                  }
                }
              });
            }
          }
        });
      }
    });

    console.log('🎯 [EFFECTS] Итоговые бонусы:', {
      characteristicBonuses,
      skillBonuses,
      savingThrowBonuses
    });

    return {
      characteristicBonuses,
      skillBonuses,
      savingThrowBonuses
    };
  };
  
  // Состояние для модального окна кубика
  const [showDiceModal, setShowDiceModal] = useState(false);
  const [diceResult, setDiceResult] = useState<{
    skillName: string;
    skillBonus: number;
    diceRoll: number;
    finalResult: number;
    isRolling: boolean;
    rollType: 'normal' | 'advantage' | 'disadvantage';
    secondDice?: number;
    selectedDice?: number;
  } | null>(null);

  // Функция для загрузки информации о защите
  const loadArmorInfo = async (characterId: string) => {
    try {
      const response = await apiClient.get(`/api/characters-v2/${characterId}/armor`);
      setArmorInfo(response.data);
      console.log('🛡️ [ARMOR] Загружена информация о защите:', response.data);
    } catch (error) {
      console.error('❌ [ARMOR] Ошибка загрузки информации о защите:', error);
      // В случае ошибки используем базовую защиту
      setArmorInfo(null);
    }
  };

  // Функция для броска кубика навыка
  const rollSkillDice = (skillName: string, rollType: 'normal' | 'advantage' | 'disadvantage' = 'normal', shouldRoll: boolean = true) => {
    if (!character) return;
    
    const skillBonus = getActualSkillValue(skillName);
    
    if (!shouldRoll) {
      // При первом открытии показываем "?" вместо броска
      setDiceResult({
        skillName,
        skillBonus,
        diceRoll: 0, // 0 будет означать "?"
        finalResult: 0, // 0 будет означать "?"
        isRolling: false,
        rollType,
        secondDice: rollType !== 'normal' ? 0 : undefined,
        selectedDice: 0
      });
      setShowDiceModal(true);
      return;
    }
    
    // Генерируем случайные значения сразу, без задержки
    const firstDice = Math.floor(Math.random() * 20) + 1;
    const secondDice = rollType !== 'normal' ? Math.floor(Math.random() * 20) + 1 : undefined;
    
    let selectedDice: number;
    if (rollType === 'advantage') {
      selectedDice = Math.max(firstDice, secondDice!);
    } else if (rollType === 'disadvantage') {
      selectedDice = Math.min(firstDice, secondDice!);
    } else {
      selectedDice = firstDice;
    }
    
    const finalResult = selectedDice + skillBonus;
    
    setDiceResult({
      skillName,
      skillBonus,
      diceRoll: firstDice,
      finalResult,
      isRolling: false,
      rollType,
      secondDice,
      selectedDice
    });
    
    setShowDiceModal(true);
  };

  // Компонент анимированного кубика

  // Компонент анимированного финального результата
  const AnimatedFinalResult = ({ isRolling, finalValue, skillBonus }: { isRolling: boolean; finalValue: number; skillBonus: number }) => {
    const [displayValue, setDisplayValue] = useState(1 + skillBonus);
    
    useEffect(() => {
      if (isRolling) {
        const interval = setInterval(() => {
          const randomDice = Math.floor(Math.random() * 20) + 1;
          setDisplayValue(randomDice + skillBonus);
        }, 100); // Меняем число каждые 100мс
        
        return () => clearInterval(interval);
      } else {
        setDisplayValue(finalValue);
      }
    }, [isRolling, finalValue, skillBonus]);
    
    return (
      <span className="inline-block w-12 text-center">
        <span className={isRolling ? 'animate-pulse' : ''}>
          {displayValue === 0 ? '?' : displayValue}
        </span>
      </span>
    );
  };


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

  // Получить актуальное значение характеристики (с учетом модификаций и эффектов)
  const getActualStatValue = (statKey: string): number => {
    if (!character) return 0;
    
    // Базовое значение характеристики
    const baseValue = modifiedStats[statKey] !== undefined ? modifiedStats[statKey] : getStatValue(character, statKey);
    
    // Получаем бонусы от эффектов экипированных предметов из кэша
    const effectBonus = equippedEffectsCache.characteristicBonuses[statKey] || 0;
    
    return baseValue + effectBonus;
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

  const abilityKeys: Array<'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma'> = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ];

  const normalizeFormulaKey = (rawKey: string): string =>
    rawKey.trim().toUpperCase().replace(/[\s-]+/g, '_');

  const formatSignedWithParens = (value: number): string =>
    `(${formatSignedValue(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0)})`;

  const getNormalizedSkillKey = (skillName: string): string => normalizeRuleIdentifier(skillName);

  type SkillFormulaResult = {
    value: number;
    expression: string;
  };

  const buildCommonFormulaContext = (extraValues: Record<string, number> = {}): Record<string, number> => {
    const context: Record<string, number> = {};

    abilityKeys.forEach((ability) => {
      const abilityValue = getActualStatValue(ability);
      context[`${ability.toUpperCase()}_VALUE`] = abilityValue;
      context[`${ability.toUpperCase()}_MOD`] = Math.floor((abilityValue - 10) / 2);
    });

    const levelValue =
      modifiedDerivedStats['level'] !== undefined ? modifiedDerivedStats['level'] : character?.level ?? 1;
    
    // Вычисляем бонус мастерства по формуле из правил (без циклической зависимости)
    let proficiencyValue = 0;
    if (modifiedDerivedStats['proficiency'] !== undefined || modifiedDerivedStats['proficiency_bonus'] !== undefined) {
      proficiencyValue = modifiedDerivedStats['proficiency'] ?? modifiedDerivedStats['proficiency_bonus'] ?? 0;
    } else {
      // Используем формулу напрямую, чтобы избежать циклической зависимости
      try {
        const formulas = getRuleFormulas('proficiency_bonus');
        if (formulas.length > 0) {
          const selectedFormula = selectRuleFormula(formulas, {});
          if (selectedFormula) {
            const tempContext: Record<string, number> = { LEVEL: levelValue };
            const evaluation = evaluateCharacterFormula(selectedFormula.formula, tempContext);
            proficiencyValue = Math.round(evaluation.value);
          } else {
            proficiencyValue = Math.floor((levelValue - 1) / 4) + 2;
          }
        } else {
          proficiencyValue = Math.floor((levelValue - 1) / 4) + 2;
        }
      } catch (error) {
        console.error('[PROFICIENCY] Ошибка вычисления бонуса мастерства в контексте:', error);
        proficiencyValue = Math.floor((levelValue - 1) / 4) + 2;
      }
    }

    context.LEVEL = levelValue;
    context.PROFICIENCY_BONUS = proficiencyValue;
    context.EQUIPMENT_EFFECTS = 0;

    Object.entries(extraValues).forEach(([key, value]) => {
      context[normalizeFormulaKey(key)] = Number.isFinite(value) ? Number(value) : 0;
    });

    return context;
  };

  const computeSkillRuleResult = (skillName: string): SkillFormulaResult | null => {
    if (!character) {
      return null;
    }

    const normalizedSkillKey = getNormalizedSkillKey(skillName);
    const statKey = getSkillStat(skillName);
    const isProficient =
      hasSkillProficiency(character, skillName) || customSkillProficiencies[normalizedSkillKey];
    const isCompetent = skillCompetencies[normalizedSkillKey] || false;
    const proficiencyLevel = isCompetent ? 'expert' : isProficient ? 'proficient' : 'none';

    const formulas = getRuleFormulas(skillName);
    const equipmentEffect = equippedEffectsCache.skillBonuses[normalizedSkillKey] || 0;

    const context = buildCommonFormulaContext({
      EQUIPMENT_EFFECTS: equipmentEffect,
    });

    const selectedFormula = selectRuleFormula(formulas, { proficiency: proficiencyLevel });

    if (selectedFormula) {
      const evaluation = evaluateCharacterFormula(selectedFormula.formula, context);
      const normalizedValue = Math.round(evaluation.value);
      const expression = `${evaluation.displayExpression} = ${formatSignedValue(normalizedValue)}`;

      return {
        value: normalizedValue,
        expression,
      };
    }

    const statModifier = context[`${statKey.toUpperCase()}_MOD`] ?? 0;
    const proficiencyBonus = context.PROFICIENCY_BONUS ?? 0;

    let computedValue = statModifier;
    const parts: string[] = [
      `${formatSignedWithParens(statModifier)} (мод ${getStatNameInRussian(statKey)})`,
    ];

    if (isProficient) {
      computedValue += proficiencyBonus;
      parts.push(`${formatSignedWithParens(proficiencyBonus)} (бонус мастерства)`);
    }

    if (isCompetent) {
      computedValue += proficiencyBonus;
      parts.push(`${formatSignedWithParens(proficiencyBonus)} (компетенция)`);
    }

    if (equipmentEffect) {
      computedValue += equipmentEffect;
      parts.push(`${formatSignedWithParens(equipmentEffect)} (эффекты предметов)`);
    }

    return {
      value: computedValue,
      expression: `${parts.join(' + ')} = ${formatSignedValue(computedValue)}`,
    };
  };

  const normalizeArmorTypeForRules = (armorType?: string | null): string => {
    if (!armorType) {
      return 'none';
    }

    const lower = armorType.toLowerCase();

    if (lower.includes('без')) return 'none';
    if (lower.includes('cloth') || lower.includes('ткан')) return 'cloth';
    if (lower.includes('лег')) return 'light';
    if (lower.includes('сред')) return 'medium';
    if (lower.includes('тяж')) return 'heavy';

    return normalizeRuleIdentifier(armorType);
  };

  type ArmorFormulaResult = {
    value: number;
    expression: string;
  };

  const computeProficiencyBonusFromRules = (): ArmorFormulaResult | null => {
    if (!character) {
      return null;
    }

    const formulas = getRuleFormulas('proficiency_bonus');
    if (!formulas.length) {
      return null;
    }

    const levelValue =
      modifiedDerivedStats['level'] !== undefined ? modifiedDerivedStats['level'] : character.level;

    const context = buildCommonFormulaContext({
      LEVEL: levelValue,
    });

    const selectedFormula = selectRuleFormula(formulas, {});
    if (!selectedFormula) {
      return null;
    }

    const evaluation = evaluateCharacterFormula(selectedFormula.formula, context);
    const normalizedValue = Math.round(evaluation.value);
    const expression = `${evaluation.displayExpression} = ${formatSignedValue(normalizedValue)}`;

    return {
      value: normalizedValue,
      expression,
    };
  };

  const computeArmorClassFromRules = (): ArmorFormulaResult | null => {
    if (!character) {
      return null;
    }

    const formulas = getRuleFormulas('armor_class');
    if (!formulas.length) {
      return null;
    }

    const armorTypeNormalized = normalizeArmorTypeForRules(armorInfo?.armor_type);
    const armorBonus =
      armorInfo?.details?.armor_bonus !== undefined ? armorInfo.details.armor_bonus : 0;
    const equipmentBonus =
      (equippedEffectsCache.characteristicBonuses['ac'] || 0) +
      (equippedEffectsCache.characteristicBonuses['armor_class'] || 0);

    const context = buildCommonFormulaContext({
      ARMOR_BONUS: armorBonus,
      EQUIPMENT_EFFECTS: equipmentBonus,
      BASE_AC: 10,
    });

    const selectedFormula = selectRuleFormula(formulas, { armor_type: armorTypeNormalized });
    if (!selectedFormula) {
      return null;
    }

    const evaluation = evaluateCharacterFormula(selectedFormula.formula, context);
    const normalizedValue = Math.round(evaluation.value);
    const expression = `${evaluation.displayExpression} = ${formatSignedValue(normalizedValue)}`;

    return {
      value: normalizedValue,
      expression,
    };
  };

  const getProficiencyBonusCalculation = (): string => {
    const formulaResult = computeProficiencyBonusFromRules();
    if (formulaResult) {
      return formulaResult.expression;
    }
    // Fallback к базовому расчету
    const levelValue = modifiedDerivedStats['level'] !== undefined ? modifiedDerivedStats['level'] : character?.level ?? 1;
    const value = Math.floor((levelValue - 1) / 4) + 2;
    return `(${levelValue} - 1) ÷ 4 + 2 = ${value}`;
  };

  const computePassivePerceptionFromRules = (): ArmorFormulaResult | null => {
    if (!character) {
      return null;
    }

    const formulas = getRuleFormulas('passive_perception');
    if (!formulas.length) {
      return null;
    }

    // Получаем фактическое значение навыка perception (с учетом ручных модификаций)
    const perceptionValue = getActualSkillValue('perception');

    // Получаем эффекты предметов для passive_perception
    const equipmentEffect =
      (equippedEffectsCache.characteristicBonuses['passive_perception'] || 0) +
      (equippedEffectsCache.characteristicBonuses['passive perception'] || 0);

    const context = buildCommonFormulaContext({
      PERCEPTION_SKILL_VALUE: perceptionValue,
      EQUIPMENT_EFFECTS: equipmentEffect,
    });

    const selectedFormula = selectRuleFormula(formulas, {});
    if (!selectedFormula) {
      return null;
    }

    const evaluation = evaluateCharacterFormula(selectedFormula.formula, context);
    const normalizedValue = Math.round(evaluation.value);
    const expression = `${evaluation.displayExpression} = ${formatSignedValue(normalizedValue)}`;

    return {
      value: normalizedValue,
      expression,
    };
  };

  const getPassivePerceptionCalculation = (): string => {
    const formulaResult = computePassivePerceptionFromRules();
    if (formulaResult) {
      return formulaResult.expression;
    }
    // Fallback к базовому расчету (с учетом ручных модификаций)
    const perceptionValue = getActualSkillValue('perception');
    const equipmentEffect =
      (equippedEffectsCache.characteristicBonuses['passive_perception'] || 0) +
      (equippedEffectsCache.characteristicBonuses['passive perception'] || 0);
    const value = 10 + perceptionValue + equipmentEffect;
    return `10 + ${perceptionValue}(Восприятие)${equipmentEffect ? ` + ${equipmentEffect}(Эффекты предметов)` : ''} = ${value}`;
  };

  const getArmorClassCalculation = (): string => {
    const formulaResult = computeArmorClassFromRules();
    if (formulaResult) {
      return formulaResult.expression;
    }

    const dexMod = Math.floor((getActualStatValue('dexterity') - 10) / 2);
    const equipmentBonus =
      (equippedEffectsCache.characteristicBonuses['ac'] || 0) +
      (equippedEffectsCache.characteristicBonuses['armor_class'] || 0);

    if (armorInfo) {
      const armorTypeNormalized = normalizeArmorTypeForRules(armorInfo.armor_type);
      const armorBonusValue = armorInfo.details?.armor_bonus ?? 0;
      let finalAC = 0;
      const parts: string[] = [];

      if (armorTypeNormalized === 'none') {
        finalAC = 10 + dexMod;
        parts.push('(10)', `${formatSignedWithParens(dexMod)} (мод ЛОВ)`);
      } else {
        finalAC = armorBonusValue;
        parts.push(`${formatSignedWithParens(armorBonusValue)} (база брони)`);

        switch (armorTypeNormalized) {
          case 'light':
          case 'cloth':
            finalAC += dexMod;
            parts.push(`${formatSignedWithParens(dexMod)} (мод ЛОВ)`);
            break;
          case 'medium': {
            const cappedDex = Math.min(dexMod, 2);
            finalAC += cappedDex;
            parts.push(`${formatSignedWithParens(cappedDex)} (лимит ЛОВ +2)`);
            break;
          }
          case 'heavy':
            break;
          default:
            finalAC = 10 + dexMod;
            parts.length = 0;
            parts.push('(10)', `${formatSignedWithParens(dexMod)} (мод ЛОВ)`);
            break;
        }
      }

      if (equipmentBonus) {
        finalAC += equipmentBonus;
        parts.push(`${formatSignedWithParens(equipmentBonus)} (эффекты предметов)`);
      }

      return `${parts.join(' + ')} = ${formatSignedValue(finalAC)}`;
    }

    const baseAC = 10 + dexMod + equipmentBonus;
    const parts = ['(10)', `${formatSignedWithParens(dexMod)} (мод ЛОВ)`];
    if (equipmentBonus) {
      parts.push(`${formatSignedWithParens(equipmentBonus)} (эффекты предметов)`);
    }
    return `${parts.join(' + ')} = ${formatSignedValue(baseAC)}`;
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


  // Получить актуальное значение навыка (с учетом модификаций и эффектов)
  const getActualSkillValue = (skillKey: string): number => {
    if (!character) return 0;

    const normalizedKey = getNormalizedSkillKey(skillKey);

    if (modifiedSkills[normalizedKey] !== undefined) {
      return modifiedSkills[normalizedKey];
    }

    const result = computeSkillRuleResult(skillKey);
    return result ? Math.round(result.value) : 0;
  };

  // Изменить значение навыка
  const updateSkillValue = (skillKey: string, newValue: number) => {
    const normalizedKey = getNormalizedSkillKey(skillKey);
    setModifiedSkills(prev => ({
      ...prev,
      [normalizedKey]: newValue
    }));
  };

  // Вернуться к обычному расчету навыка
  const resetSkillValue = (skillKey: string) => {
    const normalizedKey = getNormalizedSkillKey(skillKey);
    setModifiedSkills(prev => {
      const newSkills = { ...prev };
      delete newSkills[normalizedKey];
      return newSkills;
    });
  };

  // Переключить компетенцию навыка
  const toggleSkillCompetency = (skillKey: string) => {
    // Компетенцию можно получить только если есть владение навыком
    const normalizedKey = getNormalizedSkillKey(skillKey);
    const hasProficiency =
      hasSkillProficiency(character, skillKey) || customSkillProficiencies[normalizedKey];
    if (!hasProficiency) return;
    
    setSkillCompetencies(prev => ({
      ...prev,
      [normalizedKey]: !prev[normalizedKey]
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
    const normalizedKey = getNormalizedSkillKey(skillKey);
    const currentlyProficient = customSkillProficiencies[normalizedKey] ?? false;

    setCustomSkillProficiencies(prev => ({
      ...prev,
      [normalizedKey]: !prev[normalizedKey]
    }));
    
    // Если убираем владение навыком, убираем и компетенцию
    if (currentlyProficient) {
      setSkillCompetencies(prev => ({
        ...prev,
        [normalizedKey]: false
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
      case 'proficiency_bonus':
        if (modifiedDerivedStats[statKey] !== undefined) {
          return modifiedDerivedStats[statKey];
        }
        // Пытаемся вычислить бонус мастерства по декларативным формулам
        try {
          const formulaResult = computeProficiencyBonusFromRules();
          if (formulaResult) {
            return formulaResult.value;
          }
        } catch (error) {
          console.error('[PROFICIENCY] Ошибка вычисления формулы бонуса мастерства:', error);
        }
        // Fallback к базовому расчету при отсутствии декларативной формулы
        const levelValue = modifiedDerivedStats['level'] !== undefined ? modifiedDerivedStats['level'] : character.level;
        return Math.floor((levelValue - 1) / 4) + 2;
      case 'ac':
      case 'armor_class':
        if (modifiedDerivedStats[statKey] !== undefined) {
          return modifiedDerivedStats[statKey];
        }
        // Пытаемся вычислить защиту по декларативным формулам
        try {
          const formulaResult = computeArmorClassFromRules();
          if (formulaResult) {
            return formulaResult.value;
          }
        } catch (error) {
          console.error('[ARMOR] Ошибка вычисления формулы защиты:', error);
        }

        // Fallback к базовому расчету при отсутствии декларативной формулы
        const dexModifier = Math.floor((getActualStatValue('dexterity') - 10) / 2);
        const equipmentBonus =
          (equippedEffectsCache.characteristicBonuses['ac'] || 0) +
          (equippedEffectsCache.characteristicBonuses['armor_class'] || 0);

        if (armorInfo) {
          const armorTypeNormalized = normalizeArmorTypeForRules(armorInfo.armor_type);
          const armorBonusValue = armorInfo.details?.armor_bonus ?? 0;

          switch (armorTypeNormalized) {
            case 'none':
              return 10 + dexModifier + equipmentBonus;
            case 'cloth':
            case 'light':
              return armorBonusValue + dexModifier + equipmentBonus;
            case 'medium':
              return armorBonusValue + Math.min(dexModifier, 2) + equipmentBonus;
            case 'heavy':
              return armorBonusValue + equipmentBonus;
            default:
              return 10 + dexModifier + equipmentBonus;
          }
        }

        return 10 + dexModifier + equipmentBonus;
      case 'speed':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.speed;
      case 'max_hp':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.max_hp;
      case 'current_hp':
        return modifiedDerivedStats[statKey] !== undefined ? modifiedDerivedStats[statKey] : character.current_hp;
      case 'passive_perception':
        if (modifiedDerivedStats[statKey] !== undefined) {
          return modifiedDerivedStats[statKey];
        }
        // Пытаемся вычислить пассивное восприятие по декларативным формулам
        try {
          const formulaResult = computePassivePerceptionFromRules();
          if (formulaResult) {
            return formulaResult.value;
          }
        } catch (error) {
          console.error('[PASSIVE_PERCEPTION] Ошибка вычисления формулы пассивного восприятия:', error);
        }
        // Fallback к базовому расчету при отсутствии декларативной формулы (с учетом ручных модификаций)
        const perceptionValue = getActualSkillValue('perception');
        const equipmentEffect =
          (equippedEffectsCache.characteristicBonuses['passive_perception'] || 0) +
          (equippedEffectsCache.characteristicBonuses['passive perception'] || 0);
        return 10 + perceptionValue + equipmentEffect;
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
    const normalizedStat = statKey.toLowerCase();
    if (statNames[normalizedStat]) {
      return statNames[normalizedStat];
    }
    const russianName = getRuleRussianName(statKey);
    return russianName ? russianName.toUpperCase() : statKey.toUpperCase();
  };

  // Функция для получения цвета линии характеристики
  const getStatBorderColor = (statKey: string): string => {
    const statColors: { [key: string]: string } = {
      'strength': 'border-l-4 border-l-red-500', // Сила - красная
      'dexterity': 'border-l-4 border-l-green-500', // Ловкость - зеленая
      'constitution': 'border-l-4 border-l-gray-500', // Телосложение - серая
      'intelligence': 'border-l-4 border-l-blue-500', // Интеллект - синяя
      'wisdom': 'border-l-4 border-l-yellow-500', // Мудрость - желтая
      'charisma': 'border-l-4 border-l-purple-500' // Харизма - фиолетовая
    };
    return statColors[statKey.toLowerCase()] || 'border-l-4 border-l-gray-500';
  };

  // Функция для получения цвета линии навыка на основе связанной характеристики
  const getSkillBorderColor = (skillName: string): string => {
    const statKey = getSkillStat(skillName);
    return getStatBorderColor(statKey);
  };

  const getRuleTypeLabel = (type?: string): string => {
    const labels: Record<string, string> = {
      stat: 'Характеристика',
      skill: 'Навык',
      derived: 'Производная',
      base: 'Базовый параметр',
      context: 'Контекст',
    };
    if (!type) {
      return 'Неизвестно';
    }
    return labels[type] ?? type;
  };

  // Функция для получения порядка характеристики для сортировки навыков
  const getStatOrder = (statKey: string): number => {
    const statOrder: { [key: string]: number } = {
      'strength': 1,     // Сила
      'dexterity': 2,    // Ловкость
      'constitution': 3, // Телосложение
      'intelligence': 4, // Интеллект
      'wisdom': 5,       // Мудрость
      'charisma': 6      // Харизма
    };
    return statOrder[statKey.toLowerCase()] || 7;
  };

  // Функция для получения связанной характеристики навыка
  const getSkillStat = (skillName: string): string => {
    return getPrimaryStatForSkill(skillName) || 'strength';
  };

  // Функция для получения названия навыка на русском
  const getSkillNameInRussian = (skillName: string): string => {
    return getRuleRussianName(skillName) || getSkillName(skillName);
  };

  // Функция для получения бонуса спасброска
  const getSavingThrowBonus = (statKey: string): { bonus: string; isProficient: boolean } => {
    if (!character) {
      return { bonus: '+0', isProficient: false };
    }
    
    const statValue = getActualStatValue(statKey);
    const proficiencyBonus = getActualDerivedStatValue('proficiency');
    const isProficient = hasSavingThrowProficiency(character, statKey) || customSavingThrowProficiencies[statKey];
    
    const baseModifier = Math.floor((statValue - 10) / 2);
    
    // Получаем бонусы от эффектов экипированных предметов из кэша
    const effectBonus = equippedEffectsCache.savingThrowBonuses[statKey] || 0;
    
    const totalBonus = baseModifier + (isProficient ? proficiencyBonus : 0) + effectBonus;
    
    return {
      bonus: totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`,
      isProficient
    };
  };

  // Функция для получения бонуса навыка
  const getSkillBonus = (skillName: string): string => {
    if (!character) return '+0';

    const normalizedKey = getNormalizedSkillKey(skillName);

    if (modifiedSkills[normalizedKey] !== undefined) {
      return formatSignedValue(modifiedSkills[normalizedKey]);
    }

    const result = computeSkillRuleResult(skillName);
    return result ? formatSignedValue(Math.round(result.value)) : '+0';
  };

  // Функция для получения детального расчета навыка
  const getSkillCalculation = (skillName: string): string => {
    const result = computeSkillRuleResult(skillName);
    return result?.expression ?? '';
  };

  // Компонент сетки инвентаря (копия упрощенной версии для V2)
  const InventoryGrid: React.FC<{ inventories: any[] }> = ({ inventories }) => {

    const handleItemMouseEnter = (item: any, event: React.MouseEvent) => {
      setHoveredItem(item);
      // Сохраняем ссылку на слот для позиционирования карточки
      setHoveredSlotRef(event.currentTarget as HTMLDivElement);
    };

    const handleItemMouseLeave = () => {
      setHoveredItem(null);
      setHoveredSlotRef(null);
    };


    // Функция для определения правильного слота экипировки на основе типа оружия и позиции
    const getEquipSlotForWeapon = (card: any, slotType: string, row: number, col: number): string => {
      // Если это не оружие или не one_hand слот, возвращаем исходный тип слота
      if (!card || card.type !== 'weapon' || slotType !== 'one_hand') {
        return slotType;
      }

      const weaponType = getWeaponType(card);
      const properties = card.properties || [];
      const isTwoHanded = properties.some((prop: string) => prop === 'two-handed');
      const isVersatile = properties.some((prop: string) => prop === 'versatile');

      // Двуручное оружие занимает два слота в одном ряду
      if (isTwoHanded) {
        if (weaponType === 'ranged') {
          return row === 1 && (col === 0 || col === 1) ? 'ranged_two_hands' : slotType;
        } else {
          return row === 0 && (col === 0 || col === 1) ? 'melee_two_hands' : slotType;
        }
      }

      // Универсальное оружие может быть в любом ряду, но только в одном слоте
      if (isVersatile) {
        if (row === 0 && (col === 0 || col === 1)) {
          return 'melee_one_hand';
        } else if (row === 1 && (col === 0 || col === 1)) {
          return 'ranged_one_hand';
        }
        return slotType;
      }

      // Одноручное оружие: ближний бой - верхний ряд, дальний бой - нижний ряд
      if (weaponType === 'ranged') {
        return row === 1 && (col === 0 || col === 1) ? 'ranged_one_hand' : slotType;
      } else if (weaponType === 'melee') {
        return row === 0 && (col === 0 || col === 1) ? 'melee_one_hand' : slotType;
      }

      return slotType;
    };

    // Функция для проверки, может ли предмет быть экипирован в этот слот
    const canEquipInSlot = (item: any, slotType: string, row: number, col: number): boolean => {
      if (!item.card) return false;
      
      const card = item.card;
      
      // Если это не оружие или не one_hand слот, используем стандартную проверку
      if (card.type !== 'weapon' || slotType !== 'one_hand') {
        return card.slot === slotType;
      }

      const weaponType = getWeaponType(card);
      const properties = card.properties || [];
      const isTwoHanded = properties.some((prop: string) => prop === 'two-handed');
      const isVersatile = properties.some((prop: string) => prop === 'versatile');

      // Двуручное оружие может быть только в первом слоте своего ряда
      if (isTwoHanded) {
        if (weaponType === 'ranged') {
          return row === 1 && col === 0;
        } else {
          return row === 0 && col === 0;
        }
      }

      // Универсальное оружие может быть в любом слоте one_hand
      if (isVersatile) {
        return (row === 0 || row === 1) && (col === 0 || col === 1);
      }

      // Одноручное оружие: ближний бой - верхний ряд, дальний бой - нижний ряд
      if (weaponType === 'ranged') {
        return row === 1 && (col === 0 || col === 1);
      } else if (weaponType === 'melee') {
        return row === 0 && (col === 0 || col === 1);
      }

      return false;
    };

    // Функция для определения правильного слота для экипировки оружия
    const determineEquipSlot = (item: any): string => {
      if (!item.card) return item.card?.slot || '';
      
      const card = item.card;
      const baseSlot = card.slot || '';
      
      // Если это не оружие или не one_hand слот, возвращаем базовый слот
      if (card.type !== 'weapon' || baseSlot !== 'one_hand') {
        return baseSlot;
      }

      const weaponType = getWeaponType(card);
      const properties = card.properties || [];
      const isTwoHanded = properties.some((prop: string) => prop === 'two-handed');
      const isVersatile = properties.some((prop: string) => prop === 'versatile');

      // Используем специфичные типы слотов для различения ближнего и дальнего боя
      if (isTwoHanded) {
        return weaponType === 'ranged' ? 'ranged_two_hands' : 'melee_two_hands';
      }

      if (isVersatile) {
        // Универсальное оружие по умолчанию экипируется как ближний бой
        // Пользователь может перетащить его в другой слот, если нужно
        return 'melee_one_hand';
      }

      // Одноручное оружие: ближний бой - melee_one_hand, дальний бой - ranged_one_hand
      if (weaponType === 'ranged') {
        return 'ranged_one_hand';
      } else if (weaponType === 'melee') {
        return 'melee_one_hand';
      }

      // По умолчанию считаем ближним боем
      return 'melee_one_hand';
    };

    // Обработчики двойного клика для экипировки/снятия
    const handleEquipItem = async (item: any) => {
      if (!character || !item.card?.slot) return;
      
      // Определяем правильный слот для экипировки
      const equipSlot = determineEquipSlot(item);
      
      console.log('🎯 [EQUIP] Equipping item:', item.card?.name, 'to slot:', equipSlot);
      
      // Рассчитываем изменения характеристик ДО оптимистичного обновления
      const changes = calculateStatChanges(item, true);
      
      // Сохраняем предыдущее состояние для возможного отката
      const previousEquippedSlot = item.equipped_slot;
      
      // Оптимистично обновляем UI
      optimisticallyEquipItem(item, equipSlot);
      
      // Показываем Toast-уведомление с изменениями
      console.log('🍞 [TOAST] Showing equip toast, changes:', changes);
      if (changes.length > 0) {
        showToast({
          type: 'success',
          title: `Экипирован: ${item.card?.name}`,
          message: `Изменения характеристик:\n${changes.join('\n')}`
        });
      } else {
        console.log('🍞 [TOAST] No changes, skipping toast');
      }
      
      try {
        // Отправляем запрос на бекенд (не ждем ответа)
        apiClient.post(`/api/characters-v2/${character.id}/equip`, {
          item_id: item.id,
          slot_type: equipSlot
        }).then(response => {
          console.log('🎯 [EQUIP] Equip response:', response.data);
        }).catch(error => {
          console.error('🎯 [EQUIP] Error equipping item:', error);
          
          // Откатываем изменения при ошибке
          rollbackInventoryChanges(item, true);
          
          // Показываем уведомление об ошибке
          showToast({
            type: 'error',
            title: `Ошибка экипировки: ${item.card?.name}`,
            message: 'Изменения отменены'
          });
        });
        
      } catch (error) {
        console.error('🎯 [EQUIP] Error equipping item:', error);
        
        // Откатываем изменения при ошибке
        rollbackInventoryChanges(item, true);
        
        // Показываем уведомление об ошибке
        showToast({
          type: 'error',
          title: `Ошибка экипировки: ${item.card?.name}`,
          message: 'Изменения отменены'
        });
      }
    };

    const handleUnequipItem = async (item: any) => {
      if (!character) return;
      
      console.log('🎯 [UNEQUIP] Unequipping item:', item.card?.name);
      
      // Рассчитываем изменения характеристик ДО оптимистичного обновления
      const changes = calculateStatChanges(item, false);
      
      // Сохраняем предыдущее состояние для возможного отката
      const previousEquippedSlot = item.equipped_slot;
      
      // Оптимистично обновляем UI
      optimisticallyUnequipItem(item);
      
      // Показываем Toast-уведомление с изменениями
      console.log('🍞 [TOAST] Showing unequip toast, changes:', changes);
      if (changes.length > 0) {
        showToast({
          type: 'info',
          title: `Снят: ${item.card?.name}`,
          message: `Изменения характеристик:\n${changes.join('\n')}`
        });
      } else {
        console.log('🍞 [TOAST] No changes, skipping toast');
      }
      
      try {
        // Отправляем запрос на бекенд (не ждем ответа)
        apiClient.post(`/api/characters-v2/${character.id}/equip`, {
          item_id: item.id,
          slot_type: null
        }).then(response => {
          console.log('🎯 [UNEQUIP] Unequip response:', response.data);
        }).catch(error => {
          console.error('🎯 [UNEQUIP] Error unequipping item:', error);
          
          // Откатываем изменения при ошибке
          rollbackInventoryChanges(item, false);
          
          // Показываем уведомление об ошибке
          showToast({
            type: 'error',
            title: `Ошибка снятия: ${item.card?.name}`,
            message: 'Изменения отменены'
          });
        });
          
        } catch (error) {
        console.error('🎯 [UNEQUIP] Error unequipping item:', error);
        
        // Откатываем изменения при ошибке
        rollbackInventoryChanges(item, false);
        
        // Показываем уведомление об ошибке
        showToast({
          type: 'error',
          title: `Ошибка снятия: ${item.card?.name}`,
          message: 'Изменения отменены'
        });
      }
    };
    
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
    const getSlotIcon = (slotType: string, row: number, col: number) => {
      // Специальная логика для слотов рук в зависимости от позиции
      if (slotType === 'one_hand') {
        if (row === 0 && (col === 0 || col === 1)) {
          // Верхние две руки (слева) - оружие ближнего боя
          return '/icons/melee-hand.png';
        } else if (row === 1 && (col === 0 || col === 1)) {
          // Нижние две руки (слева) - оружие дальнего боя
          return '/icons/bow-hand.png';
        }
      }
      
      if (slotType === 'versatile') {
        // Четыре руки справа - свободные слоты (пояс)
        return '/icons/belt.png';
      }
      
      // Обычные иконки для остальных слотов
      const iconMap: { [key: string]: string } = {
        'ring': 'ring.png',
        'head': 'helm.png',
        'arms': 'gloves.png',
        'cloak': 'cloak.png',
        'body': 'armor.png',
        'feet': 'boots.png',
        'necklace': 'necklace.png'
      };
      
      const iconPath = iconMap[slotType] || 'hand.png';
      return `/icons/slots/${iconPath}`;
    };

    const handleAddItemClick = () => {
      setShowItemSelector(true);
    };

    return (
      <div 
        className="relative"
        onMouseEnter={() => setHoveredItem(null)}
      >
        {/* Секция экипировки */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Экипировка</h3>
          <div
            className="grid grid-cols-8 gap-1"
            onMouseEnter={() => setHoveredItem(null)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {Array.from({ length: equipmentSlots }, (_, index) => {
              const row = Math.floor(index / 8);
              const col = index % 8;
              const slotType = equipmentSlotTypes[row][col];
              const iconPath = getSlotIcon(slotType, row, col);
              
              // Ищем предмет, экипированный в этот конкретный слот
              // Для оружия учитываем позицию и тип оружия
              const equippedItem = inventories
                .flatMap(inv => inv.items || [])
                .find(item => {
                  if (!item.equipped_slot) return false;
                  
                  // Если это слот one_hand для оружия, используем специальную логику
                  if (slotType === 'one_hand' && item.card?.type === 'weapon') {
                    const equippedSlot = item.equipped_slot;
                    const properties = item.card.properties || [];
                    const isTwoHanded = properties.some((prop: string) => prop === 'two-handed');
                    
                    // Проверяем новые специфичные типы слотов
                    if (equippedSlot === 'melee_one_hand') {
                      // Одноручное оружие ближнего боя отображается только в первом слоте верхнего ряда
                      return row === 0 && col === 0;
                    }
                    if (equippedSlot === 'ranged_one_hand') {
                      // Одноручное оружие дальнего боя отображается только в первом слоте нижнего ряда
                      return row === 1 && col === 0;
                    }
                    if (equippedSlot === 'melee_two_hands') {
                      // Двуручное оружие ближнего боя занимает два слота в верхнем ряду
                      return row === 0 && (col === 0 || col === 1);
                    }
                    if (equippedSlot === 'ranged_two_hands') {
                      // Двуручное оружие дальнего боя занимает два слота в нижнем ряду
                      return row === 1 && (col === 0 || col === 1);
                    }
                    
                    // Обратная совместимость: если используется старый формат 'one_hand'
                    // Определяем тип оружия и позицию
                    const weaponType = getWeaponType(item.card);
                    
                    if (isTwoHanded) {
                      // Двуручное оружие занимает два слота
                      if (weaponType === 'ranged') {
                        return row === 1 && (col === 0 || col === 1);
                      } else {
                        return row === 0 && (col === 0 || col === 1);
                      }
                    }
                    
                    // Одноручное оружие отображается только в первом слоте соответствующего ряда
                    if (weaponType === 'ranged') {
                      return row === 1 && col === 0;
                    } else if (weaponType === 'melee') {
                      return row === 0 && col === 0;
                    }
                    
                    // Если тип оружия не определен, показываем только в первом подходящем слоте
                    return row === 0 && col === 0;
                  }
                  
                  // Для остальных предметов используем стандартную проверку
                  return item.equipped_slot === slotType;
                });
              
              return (
                <div
                  key={index}
                  className={`w-16 h-16 border border-gray-300 rounded flex items-center justify-center bg-gray-100 relative cursor-pointer group ${
                    equippedItem ? getRarityBorderColor(equippedItem.card?.rarity) : ''
                  }`}
                  title={equippedItem ? `${equippedItem.card?.name || 'Предмет'} (экипирован) - клик для снятия` : `Слот: ${slotType}`}
                  onMouseEnter={equippedItem ? (e) => {
                    e.stopPropagation(); // Останавливаем всплытие события
                    handleItemMouseEnter(equippedItem, e);
                  } : undefined}
                  onMouseLeave={equippedItem ? handleItemMouseLeave : undefined}
                  onClick={equippedItem ? () => handleUnequipItem(equippedItem) : undefined}
                >
                  {equippedItem ? (
                    <>
                    <img 
                      src={equippedItem.card?.image_url || '/default_image.png'} 
                      alt={equippedItem.card?.name || 'Предмет'}
                      className="w-16 h-16 object-contain rounded"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = '/default_image.png';
                      }}
                    />
                    {/* Кнопка просмотра (глаз) при hover */}
                    <button
                      type="button"
                      className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-white/90 hover:bg-white text-gray-800 shadow-sm border border-gray-200"
                      onClick={(e) => { e.stopPropagation(); openCardDetail(equippedItem); }}
                      title="Просмотр"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    </>
                  ) : (
                    <img 
                      src={iconPath} 
                      alt={slotType}
                      className="w-8 h-8 opacity-40"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Секция рюкзака */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Рюкзак</h3>
          <div
            className="grid grid-cols-8 gap-1"
            onMouseEnter={() => setHoveredItem(null)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {Array.from({ length: inventorySlots }, (_, index) => {
              const isLastSlot = index === inventorySlots - 1;
              
              // Находим предмет в этом слоте
              // Пока что просто берем первые предметы из инвентарей, исключая экипированные
              const allItems = characterInventories.flatMap(inv => inv.items || []).filter(item => !item.equipped_slot);
              const inventoryItem = allItems[index];
              
              return (
                <div
                  key={index}
                  className={`w-16 h-16 border rounded flex items-center justify-center relative ${
                    isLastSlot
                      ? 'bg-blue-50 border-blue-300 cursor-pointer hover:bg-blue-100 transition-colors'
                      : inventoryItem
                        ? `border-gray-400 bg-white cursor-pointer hover:bg-gray-50 transition-colors group ${getRarityBorderColor(inventoryItem.card?.rarity)}`
                        : 'border-dashed border-gray-300 bg-gray-50'
                  }`}
                  title={
                    isLastSlot
                      ? 'Добавить предмет'
                      : inventoryItem
                        ? `${inventoryItem.card?.name || 'Предмет'} (${inventoryItem.quantity || 1}) - клик для экипировки`
                        : `Слот рюкзака ${index + 1}`
                  }
                  data-inventory-item={inventoryItem ? 'true' : undefined}
                  onClick={isLastSlot ? handleAddItemClick : (inventoryItem ? () => handleEquipItem(inventoryItem) : undefined)}
                  onMouseEnter={inventoryItem ? (e) => {
                    e.stopPropagation(); // Останавливаем всплытие события
                    handleItemMouseEnter(inventoryItem, e);
                  } : undefined}
                  onMouseLeave={inventoryItem ? handleItemMouseLeave : undefined}
                >
                  {isLastSlot ? (
                    <Plus className="w-6 h-6 text-blue-600" />
                  ) : inventoryItem ? (
                    <div className="w-full h-full flex items-center justify-center">
                      {inventoryItem.card?.image_url ? (
                        <img 
                          src={inventoryItem.card.image_url} 
                          alt={inventoryItem.card.name}
                          className="w-16 h-16 object-contain rounded"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = '/default_image.png';
                          }}
                        />
                      ) : (
                        <Package className="w-8 h-8 text-gray-600" />
                      )}
                      {/* Кнопка просмотра (глаз) при hover */}
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-white/90 hover:bg-white text-gray-800 shadow-sm border border-gray-200"
                        onClick={(e) => { e.stopPropagation(); openCardDetail(inventoryItem); }}
                        title="Просмотр"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
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
                  
                  const statBorderColor = getStatBorderColor(statKey);
                  
                  return (
                    <div key={statKey} className={`flex cursor-pointer hover:bg-gray-50 transition-colors bg-white border border-gray-200 rounded-lg ${statBorderColor}`} onClick={() => openStatModal(statKey)}>
                      {/* Название характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 rounded-l-lg w-1/4">
                        <div className="text-xs text-gray-600 uppercase font-medium">{statNameInRussian}</div>
                      </div>
                      
                      {/* Значение характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 w-1/4">
                        <div className={`text-xs ${isModified ? 'text-purple-600 font-semibold' : 'text-gray-500'}`}>{statValue}</div>
                      </div>
                      
                      {/* Модификатор характеристики - 25% */}
                      <div className="flex items-center justify-center p-2 w-1/4">
                        <div className={`text-sm font-bold ${isModified ? 'text-purple-600' : 'text-gray-900'}`}>{getModifier(statValue)}</div>
                      </div>
                      
                      {/* Спасбросок - 25% */}
                      <div className="flex items-center justify-center p-2 rounded-r-lg w-1/4">
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
                {allSkillNames
                  .slice()
                  .sort((a, b) => {
                    const statA = getSkillStat(a);
                    const statB = getSkillStat(b);
                    const orderA = getStatOrder(statA);
                    const orderB = getStatOrder(statB);

                    // Если характеристики одинаковые, сортируем по алфавиту
                    if (orderA === orderB) {
                      return getSkillNameInRussian(a).localeCompare(getSkillNameInRussian(b), 'ru');
                    }

                    return orderA - orderB;
                  })
                  .map((skillName) => {
                    const normalizedSkillKey = getNormalizedSkillKey(skillName);
                    const isProficient =
                      hasSkillProficiency(character, skillName) ||
                      customSkillProficiencies[normalizedSkillKey];
                    const isCompetent = skillCompetencies[normalizedSkillKey] || false;
                    const isModified = modifiedSkills[normalizedSkillKey] !== undefined;
                    const currentBonus = getActualSkillValue(skillName);

                    const skillBorderColor = getSkillBorderColor(skillName);

                    return (
                    <div 
                      key={skillName} 
                      className={`group relative flex items-center justify-between p-1.5 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors bg-white border border-gray-200 ${skillBorderColor} ${
                        isProficient || isCompetent ? 'border-green-200' : ''
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
                      <div className="flex items-center space-x-1">
                        <div className={`text-xs font-bold ${isModified ? 'text-purple-600' : 'text-gray-900'}`}>
                          {currentBonus >= 0 ? `+${currentBonus}` : currentBonus}
                        </div>
                        {/* Кнопка кубика - появляется при наведении */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            rollSkillDice(skillName, 'normal', false);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-blue-100 rounded-full"
                          title="Бросить кубик"
                        >
                          <Dices className="w-3 h-3 text-blue-600" />
                        </button>
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
                <InventoryGrid inventories={characterInventories} />
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
          <InventoryGrid inventories={characterInventories} />
        </div>
      </div>
    );
  };

  // Проверяем наличие оружия в слотах ближнего боя
  const hasMeleeWeapon = () => {
    if (!characterInventories || characterInventories.length === 0) return false;
    
    const allItems = characterInventories.flatMap(inv => inv.items || []);
    return allItems.some(item => {
      if (!item.equipped_slot || !item.card) return false;
      const slot = item.equipped_slot;
      const isMeleeSlot = slot === 'melee_one_hand' || slot === 'melee_two_hands' || 
                         slot === 'one_hand' || slot === 'versatile' || slot === 'two_hands';
      
      if (!isMeleeSlot) return false;
      
      // Проверяем, что это оружие ближнего боя
      const weaponType = getWeaponType(item.card);
      return weaponType === 'melee';
    });
  };

  const handleActionClick = (action: Action) => {
    if (action.card_number === 'action_melee_attack' && !hasMeleeWeapon()) {
      return; // Не открываем модальное окно, если нет оружия
    }
    
    setSelectedAction(action);
    setShowActionModal(true);
  };

  const getEquippedMeleeWeapon = (): Card | null => {
    if (!characterInventories || characterInventories.length === 0) return null;
    
    const allItems = characterInventories.flatMap(inv => inv.items || []);
    const meleeWeapon = allItems.find(item => {
      if (!item.equipped_slot || !item.card) return false;
      const slot = item.equipped_slot;
      const isMeleeSlot = slot === 'melee_one_hand' || slot === 'melee_two_hands' || 
                         slot === 'one_hand' || slot === 'versatile' || slot === 'two_hands';
      
      if (!isMeleeSlot) return false;
      
      const weaponType = getWeaponType(item.card);
      return weaponType === 'melee';
    });
    
    return meleeWeapon?.card || null;
  };

  const renderActionsTab = () => {
    const unarmedStrike = actions['action_unarmed_strike'];
    const meleeAttack = actions['action_melee_attack'];
    const meleeWeaponEquipped = hasMeleeWeapon();
    const equippedWeapon = getEquippedMeleeWeapon();
    
    // Отладочная информация
    if (unarmedStrike) {
      console.log('[Actions] Безоружный удар:', {
        name: unarmedStrike.name,
        image_url: unarmedStrike.image_url,
        hasImage: !!(unarmedStrike.image_url && unarmedStrike.image_url.trim() !== '')
      });
    }
    if (meleeAttack) {
      console.log('[Actions] Удар в ближнем бою:', {
        name: meleeAttack.name,
        image_url: meleeAttack.image_url,
        hasImage: !!(meleeAttack.image_url && meleeAttack.image_url.trim() !== '')
      });
    }

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Действия</h2>
          
          {loadingActions ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-4">Загрузка действий...</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {/* Безоружный удар - всегда доступен */}
              {unarmedStrike && (
                <button
                  onClick={() => handleActionClick(unarmedStrike)}
                  className="flex items-center space-x-3 bg-amber-900 hover:bg-amber-800 text-white px-6 py-4 rounded-lg border-2 border-black transition-all hover:scale-105 shadow-lg"
                >
                  {unarmedStrike.image_url && unarmedStrike.image_url.trim() !== '' && (
                    <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
                      <img
                        src={unarmedStrike.image_url}
                        alt={unarmedStrike.name}
                        className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(255,140,0,0.8)]"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <span className="text-lg font-semibold">Безоружный удар</span>
                </button>
              )}

              {/* Удар в ближнем бою - доступен только с оружием */}
              {meleeAttack && (
                <button
                  onClick={() => handleActionClick(meleeAttack)}
                  disabled={!meleeWeaponEquipped}
                  className={`flex items-center space-x-3 px-6 py-4 rounded-lg border-2 border-black transition-all shadow-lg ${
                    meleeWeaponEquipped
                      ? 'bg-amber-900 hover:bg-amber-800 text-white hover:scale-105 cursor-pointer'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-60'
                  }`}
                  title={!meleeWeaponEquipped ? 'Доступно только при экипированном оружии ближнего боя' : ''}
                >
                  {meleeAttack.image_url && meleeAttack.image_url.trim() !== '' && (
                    <div className={`w-12 h-12 flex items-center justify-center flex-shrink-0 ${
                      !meleeWeaponEquipped ? 'opacity-50' : ''
                    }`}>
                      <img
                        src={meleeAttack.image_url}
                        alt={meleeAttack.name}
                        className={`w-full h-full object-contain ${
                          meleeWeaponEquipped ? 'filter drop-shadow-[0_0_8px_rgba(255,140,0,0.8)]' : ''
                        }`}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <span className="text-lg font-semibold">Удар в ближнем бою</span>
                </button>
              )}

              {!unarmedStrike && !meleeAttack && (
                <div className="text-center py-8 w-full">
                  <p className="text-gray-500">Действия не найдены</p>
                </div>
              )}
            </div>
          )}
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
            to="/characters-v3"
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
                to="/characters-v3"
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
                to={`/characters-v3/${character.id}/edit`}
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
          <div className={`bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto ${getStatBorderColor(selectedStat)}`}>
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
                    
                    {/* Бонусы от эффектов экипированных предметов */}
                    {(() => {
                      const effectBonus = equippedEffectsCache.characteristicBonuses[selectedStat] || 0;
                      if (effectBonus !== 0) {
                        return (
                          <div className="bg-purple-50 p-3 rounded-md mt-2">
                            <div className="text-sm font-medium text-purple-900 mb-1">
                              Бонус от экипированных предметов:
                            </div>
                            <div className="text-lg font-bold text-purple-900">
                              {effectBonus > 0 ? `+${effectBonus}` : `${effectBonus}`}
                            </div>
                            <div className="text-xs text-purple-700">
                              Влияние эффектов предметов на характеристику
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Бонус к спасброскам:</h4>
                    <div className="bg-green-50 p-3 rounded-md">
                      <div className="text-lg font-bold text-green-900">
                        {getSavingThrowBonus(selectedStat).bonus}
                      </div>
                      <div className="text-xs text-green-700">
                        {Math.floor((getActualStatValue(selectedStat) - 10) / 2)} + {getSavingThrowBonus(selectedStat).isProficient ? getActualDerivedStatValue('proficiency') : 0}(Бонус владения) = {getSavingThrowBonus(selectedStat).bonus}
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
                    
                    {/* Бонусы от эффектов экипированных предметов для спасбросков */}
                    {(() => {
                      const effectBonus = equippedEffectsCache.savingThrowBonuses[selectedStat] || 0;
                      if (effectBonus !== 0) {
                        return (
                          <div className="bg-purple-50 p-3 rounded-md mt-2">
                            <div className="text-sm font-medium text-purple-900 mb-1">
                              Бонус от экипированных предметов:
                            </div>
                            <div className="text-lg font-bold text-purple-900">
                              {effectBonus > 0 ? `+${effectBonus}` : `${effectBonus}`}
                            </div>
                            <div className="text-xs text-purple-700">
                              Влияние эффектов предметов на спасбросок
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Связанные навыки:</h4>
                    <div className="space-y-1">
                      {getDependentNames(selectedStat, 'skill')
                        .sort((a, b) => getSkillNameInRussian(a).localeCompare(getSkillNameInRussian(b), 'ru'))
                        .map((skill) => {
                          const normalizedSkillKey = getNormalizedSkillKey(skill);
                          const isProficient =
                            hasSkillProficiency(character, skill) ||
                            customSkillProficiencies[normalizedSkillKey];
                          return (
                            <div
                              key={skill}
                              className={`flex items-center justify-between p-2 rounded ${
                                isProficient ? 'bg-green-50' : 'bg-gray-50'
                              }`}
                            >
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
          <div className={`bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto ${getSkillBorderColor(selectedSkill)}`}>
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
                        {modifiedSkills[getNormalizedSkillKey(selectedSkill)] !== undefined && (
                          <span className="text-purple-600 font-medium block mt-1">
                            → {modifiedSkills[getNormalizedSkillKey(selectedSkill)]} (Изменено игроком)
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* Бонусы от эффектов экипированных предметов */}
                    {(() => {
                      const effectBonus =
                        equippedEffectsCache.skillBonuses[getNormalizedSkillKey(selectedSkill)] || 0;
                      if (effectBonus !== 0) {
                        return (
                          <div className="bg-purple-50 p-3 rounded-md mt-2">
                            <div className="text-sm font-medium text-purple-900 mb-1">
                              Бонус от экипированных предметов:
                            </div>
                            <div className="text-lg font-bold text-purple-900">
                              {effectBonus > 0 ? `+${effectBonus}` : `${effectBonus}`}
                            </div>
                            <div className="text-xs text-purple-700">
                              Влияние эффектов предметов на навык
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {modifiedSkills[getNormalizedSkillKey(selectedSkill)] !== undefined && (
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
                            hasSkillProficiency(character, selectedSkill) ||
                            customSkillProficiencies[getNormalizedSkillKey(selectedSkill)]
                              ? 'bg-green-600 text-white' 
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {(hasSkillProficiency(character, selectedSkill) ||
                            customSkillProficiencies[getNormalizedSkillKey(selectedSkill)])
                            ? '✓ Да'
                            : '✗ Нет'}
                        </button>
                      </div>
                      
                      <div className={`flex items-center justify-between p-3 rounded-md ${
                        (hasSkillProficiency(character, selectedSkill) ||
                          customSkillProficiencies[getNormalizedSkillKey(selectedSkill)])
                          ? 'bg-blue-50' 
                          : 'bg-gray-100'
                      }`}>
                        <span className="text-sm text-gray-700">Компетентен</span>
                        <button
                          onClick={() => toggleSkillCompetency(selectedSkill)}
                          disabled={
                            !(
                              hasSkillProficiency(character, selectedSkill) ||
                              customSkillProficiencies[getNormalizedSkillKey(selectedSkill)]
                            )
                          }
                          className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                            skillCompetencies[getNormalizedSkillKey(selectedSkill)] 
                              ? 'bg-blue-600 text-white' 
                              : hasSkillProficiency(character, selectedSkill) ||
                                customSkillProficiencies[getNormalizedSkillKey(selectedSkill)]
                                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {skillCompetencies[getNormalizedSkillKey(selectedSkill)] ? '✓ Да' : '✗ Нет'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Декларативные зависимости:</h4>
                    <div className="bg-gray-50 p-3 rounded-md space-y-1">
                      {skillDependencies.length === 0 ? (
                        <p className="text-xs text-gray-500">Для этого навыка пока не задано правил зависимостей.</p>
                      ) : (
                        skillDependencies.map((dependencyName) => {
                          const dependencyRule = getRule(dependencyName);
                          const dependencyLabel = getRuleRussianName(dependencyName) || dependencyName;
                          const dependencyTypeLabel = getRuleTypeLabel(dependencyRule?.type);
                          return (
                            <div
                              key={dependencyName}
                              className="flex items-center justify-between text-xs text-gray-600"
                            >
                              <span>{dependencyLabel}</span>
                              <span className="text-gray-400 font-semibold">{dependencyTypeLabel}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Детализация бонусов:</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Базовый модификатор:</span>
                        <span className="font-medium">{getSkillBonus(selectedSkill)}</span>
                      </div>
                      {(hasSkillProficiency(character, selectedSkill) ||
                        customSkillProficiencies[getNormalizedSkillKey(selectedSkill)]) && (
                        <div className="flex justify-between text-green-700">
                          <span>Бонус мастерства:</span>
                          <span className="font-medium">+{getActualDerivedStatValue('proficiency')}</span>
                        </div>
                      )}
                      {skillCompetencies[getNormalizedSkillKey(selectedSkill)] && (
                        <div className="flex justify-between text-blue-700">
                          <span>Компетенция:</span>
                          <span className="font-medium">+{getActualDerivedStatValue('proficiency')}</span>
                        </div>
                      )}
                      {modifiedSkills[getNormalizedSkillKey(selectedSkill)] !== undefined && (
                        <div className="flex justify-between text-purple-700">
                          <span>Ручная модификация:</span>
                          <span className="font-medium">
                            {modifiedSkills[getNormalizedSkillKey(selectedSkill)] >= 0 
                              ? `+${modifiedSkills[getNormalizedSkillKey(selectedSkill)]}`
                              : modifiedSkills[getNormalizedSkillKey(selectedSkill)]}
                          </span>
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
                            {getProficiencyBonusCalculation()}
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <span className="text-purple-600 font-medium">
                                {' '}→ {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </span>
                            )}
                          </>
                        )}
                        {selectedDerivedStat === 'ac' && (
                          <>
                            {armorInfo && (
                              <div className="space-y-2">
                                <div>
                                  <strong>Базовая защита:</strong> {armorInfo.base_ac}{' '}
                                  {armorInfo.details?.base_formula && (
                                    <span>({armorInfo.details.base_formula})</span>
                                  )}
                                </div>
                                {armorInfo.armor_name && (
                                  <div>
                                    <strong>Экипированная броня:</strong> {armorInfo.armor_name} ({armorInfo.armor_type})
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="mt-2">
                              <strong>Расчет по правилам:</strong> {getArmorClassCalculation()}
                            </div>
                            <div className="font-bold text-lg mt-2">
                              <strong>Итоговая защита:</strong> {getActualDerivedStatValue('ac')}
                            </div>
                            {modifiedDerivedStats[selectedDerivedStat] !== undefined && (
                              <div className="mt-2 text-purple-600 font-medium">
                                → {modifiedDerivedStats[selectedDerivedStat]} (Изменено игроком)
                              </div>
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
                            {getPassivePerceptionCalculation()}
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

      {/* Модальное окно кубика */}
      {showDiceModal && diceResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 ${getSkillBorderColor(diceResult.skillName)}`}>
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
              {/* Результат кубика(ов) */}
              <div className="flex items-center space-x-2">
                <div className="text-3xl font-bold text-blue-600">
                  {diceResult.diceRoll > 0 ? diceResult.diceRoll : '?'}
                </div>
                {diceResult.rollType !== 'normal' && diceResult.secondDice !== undefined && diceResult.secondDice > 0 && (
                  <>
                    <span className="text-xl text-gray-400">и</span>
                    <div className="text-3xl font-bold text-blue-600">
                      {diceResult.secondDice}
                    </div>
                    <span className="text-lg text-gray-500">
                      (выбрано {diceResult.rollType === 'advantage' 
                        ? Math.max(diceResult.diceRoll, diceResult.secondDice)
                        : Math.min(diceResult.diceRoll, diceResult.secondDice)})
                    </span>
                  </>
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
                {diceResult.finalResult > 0 ? diceResult.finalResult : '?'}
              </div>
            </div>
            
            <div className="mt-6 flex justify-center space-x-3">
              <button
                onClick={() => rollSkillDice(diceResult.skillName, 'disadvantage')}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                title="Помеха - бросается два кубика, выбирается наименьший"
              >
                Помеха
              </button>
              <button
                onClick={() => rollSkillDice(diceResult.skillName)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Бросить
              </button>
              <button
                onClick={() => rollSkillDice(diceResult.skillName, 'advantage')}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                title="Преимущество - бросается два кубика, выбирается наибольший"
              >
                Преимущество
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Карточка при наведении - привязана к слоту */}
      {hoveredItem && hoveredItem.card && hoveredSlotRef && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoveredSlotRef.getBoundingClientRect().right + 10,
            top: hoveredSlotRef.getBoundingClientRect().top - 10,
            width: '200px'
          }}
        >
          <CardPreview 
            card={hoveredItem.card}
            showQuantity={true}
            quantity={hoveredItem.quantity}
          />
        </div>
      )}

      {/* Модал броска атаки */}
      {showActionModal && selectedAction && character && (
        <ActionAttackModal
          action={selectedAction}
          character={character}
          weapon={selectedAction.card_number === 'action_melee_attack' ? getEquippedMeleeWeapon() : null}
          onClose={() => {
            setShowActionModal(false);
            setSelectedAction(null);
          }}
        />
      )}

      {/* Модал подробного просмотра карты (как в библиотеке) */}
      <CardDetailModal
        card={selectedCard}
        isOpen={showCardDetailModal}
        onClose={closeCardDetail}
        onEdit={handleEditCardFromModal}
        onDelete={handleDeleteCardFromModal}
        inventoryItem={selectedInventoryItem}
      />
    </div>
  );
};

export default CharacterDetailV3;