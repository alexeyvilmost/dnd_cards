import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Package, Weight, Coins, Shield, Heart, Zap, User, Sword, Star, Eye, Plus, X } from 'lucide-react';
import { charactersApi } from '../api/charactersApi';
import { inventoryApi } from '../api/inventoryApi';
import { useAuth } from '../contexts/AuthContext';
import type { Character, CharacterData, Inventory } from '../types';
import CardDetailModal from '../components/CardDetailModal';
import CardPreview from '../components/CardPreview';

const CharacterDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [character, setCharacter] = useState<Character | null>(null);
  const [characterData, setCharacterData] = useState<CharacterData | null>(null);
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [showCardDetailModal, setShowCardDetailModal] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<any>(null);
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [draggedItem, setDraggedItem] = useState<any>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const isOpeningRef = useRef<boolean>(false);
  const openingTimerRef = useRef<number | null>(null);
  const isMouseDownRef = useRef<boolean>(false);

  // Отслеживаем изменение состояния модала для дебага кликов
  useEffect(() => {
    console.log('MODAL STATE CHANGED:', { showCardDetailModal });
  }, [showCardDetailModal]);

  useEffect(() => {
    if (id) {
      loadCharacter();
    }
  }, [id]);

  const loadCharacter = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const character = await charactersApi.getCharacter(id);
      setCharacter(character);

      // Парсим JSON данные персонажа
      try {
        const parsed = JSON.parse(character.data);
        setCharacterData(parsed);
      } catch (parseError) {
        console.error('Error parsing character data:', parseError);
        setError('Ошибка парсинга данных персонажа');
      }

      // Загружаем инвентари персонажа
      await loadInventories(id);
    } catch (err) {
      setError('Ошибка загрузки персонажа');
      console.error('Error loading character:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadInventories = async (characterId: string) => {
    try {
      const inventories = await charactersApi.getCharacterInventories(characterId);
      setInventories(inventories);
    } catch (err) {
      console.error('Ошибка загрузки инвентарей:', err);
      // Не показываем ошибку пользователю, просто логируем
    }
  };

  const calculateCarryingCapacity = (strength: number): number => {
    return strength * 15; // Грузоподъемность = Сила * 15 фт
  };

  const calculateCurrentWeight = (): number => {
    if (!character?.inventories) return 0;
    
    let totalWeight = 0;
    character.inventories.forEach(inventory => {
      inventory.items?.forEach(item => {
        if (item.card.weight) {
          totalWeight += item.card.weight * item.quantity;
        }
      });
    });
    return totalWeight;
  };

  const getModifier = (score: number): string => {
    const modifier = Math.floor((score - 10) / 2);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  const getStatNameInRussian = (statKey: string): string => {
    const statNames: { [key: string]: string } = {
      'str': 'СИЛ',
      'dex': 'ЛОВ',
      'con': 'ТЕЛ',
      'int': 'ИНТ',
      'wis': 'МУД',
      'cha': 'ХАР'
    };
    return statNames[statKey.toLowerCase()] || statKey.toUpperCase();
  };

  const getSkillNameInRussian = (skillName: string): string => {
    const skillNames: { [key: string]: string } = {
      'acrobatics': 'Акробатика',
      'animal handling': 'Обращение с животными',
      'arcana': 'Магия',
      'athletics': 'Атлетика',
      'deception': 'Обман',
      'history': 'История',
      'insight': 'Проницательность',
      'intimidation': 'Запугивание',
      'investigation': 'Расследование',
      'medicine': 'Медицина',
      'nature': 'Природа',
      'perception': 'Восприятие',
      'performance': 'Выступление',
      'persuasion': 'Убеждение',
      'religion': 'Религия',
      'sleight of hand': 'Ловкость рук',
      'stealth': 'Скрытность',
      'survival': 'Выживание'
    };
    return skillNames[skillName.toLowerCase()] || skillName;
  };

  const getSavingThrowBonus = (statKey: string): { bonus: string; isProficient: boolean } => {
    if (!characterData?.saves || !characterData?.stats) {
      return { bonus: '+0', isProficient: false };
    }
    
    const save = characterData.saves[statKey];
    const statScore = characterData.stats[statKey]?.score || 10;
    const proficiencyBonus = characterData.proficiency || 0;
    const isProficient = save?.isProf === true || save?.isProf === 1;
    
    const baseModifier = Math.floor((statScore - 10) / 2);
    const totalBonus = baseModifier + (isProficient ? proficiencyBonus : 0);
    
    return {
      bonus: totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`,
      isProficient
    };
  };

  // Функция для парсинга блока traits
  const parseTraitsContent = (content: any[]): JSX.Element[] => {
    if (!content || !Array.isArray(content)) {
      return [];
    }

    return content.map((item, index) => {
      if (item.type === 'paragraph') {
        if (!item.content || !Array.isArray(item.content)) {
          // Пустой параграф - добавляем отступ
          return <div key={index} className="mb-2"></div>;
        }

        return (
          <p key={index} className="mb-2 leading-relaxed">
            {item.content.map((textItem: any, textIndex: number) => {
              if (textItem.type === 'text') {
                let className = '';
                if (textItem.marks) {
                  if (textItem.marks.some((mark: any) => mark.type === 'bold')) {
                    className += ' font-bold';
                  }
                  if (textItem.marks.some((mark: any) => mark.type === 'italic')) {
                    className += ' italic';
                  }
                  if (textItem.marks.some((mark: any) => mark.type === 'underline')) {
                    className += ' underline';
                  }
                }
                return (
                  <span key={textIndex} className={className}>
                    {textItem.text}
                  </span>
                );
              }
              return null;
            })}
          </p>
        );
      }

      if (item.type === 'bulletList') {
        return (
          <ul key={index} className="list-disc list-inside mb-3 ml-6 space-y-1">
            {item.content?.map((listItem: any, listIndex: number) => {
              if (listItem.type === 'listItem' && listItem.content) {
                return (
                  <li key={listIndex} className="leading-relaxed">
                    {listItem.content.map((listContentItem: any, listContentIndex: number) => {
                      if (listContentItem.type === 'paragraph') {
                        return (
                          <div key={listContentIndex}>
                            {listContentItem.content?.map((textItem: any, textIndex: number) => {
                              if (textItem.type === 'text') {
                                let className = '';
                                if (textItem.marks) {
                                  if (textItem.marks.some((mark: any) => mark.type === 'bold')) {
                                    className += ' font-bold';
                                  }
                                  if (textItem.marks.some((mark: any) => mark.type === 'italic')) {
                                    className += ' italic';
                                  }
                                  if (textItem.marks.some((mark: any) => mark.type === 'underline')) {
                                    className += ' underline';
                                  }
                                }
                                return (
                                  <span key={textIndex} className={className}>
                                    {textItem.text}
                                  </span>
                                );
                              }
                              return null;
                            })}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </li>
                );
              }
              return null;
            })}
          </ul>
        );
      }

      return null;
    }).filter(Boolean);
  };

  const getSkillBonus = (skillName: string): string => {
    if (!characterData?.skills || !characterData?.stats) return '+0';
    
    const skill = characterData.skills[skillName];
    if (!skill) return '+0';
    
    const baseStat = skill.baseStat;
    const statScore = characterData.stats[baseStat]?.score || 10;
    const statModifier = Math.floor((statScore - 10) / 2);
    const proficiencyBonus = characterData.proficiency || 0;
    const isProficient = skill.isProf === 1 || skill.isProf === true;
    
    const totalBonus = statModifier + (isProficient ? proficiencyBonus : 0);
    return totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
  };

  const getPassivePerception = (): number => {
    if (!characterData?.stats) return 10;
    
    const wisdomScore = characterData.stats.wis?.score || 10;
    const wisdomModifier = Math.floor((wisdomScore - 10) / 2);
    const proficiencyBonus = characterData.proficiency || 0;
    const perceptionSkill = characterData.skills?.perception;
    const isProficient = perceptionSkill?.isProf === 1 || perceptionSkill?.isProf === true;
    
    return 10 + wisdomModifier + (isProficient ? proficiencyBonus : 0);
  };

  const tabs = [
    { id: 'basic', name: 'Основное', icon: User },
    { id: 'class-race', name: 'Класс и Раса', icon: Star },
    { id: 'inventory', name: 'Инвентарь', icon: Package },
    { id: 'actions', name: 'Действия', icon: Sword },
    { id: 'passives', name: 'Пассивы', icon: Eye },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg text-gray-600">Загрузка персонажа...</div>
      </div>
    );
  }

  if (error || !character || !characterData) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error || 'Персонаж не найден'}</div>
        <Link to="/characters" className="btn-primary">
          Вернуться к списку
        </Link>
      </div>
    );
  }

  const strength = characterData.stats?.str?.score || 10;
  const carryingCapacity = calculateCarryingCapacity(strength);
  const currentWeight = calculateCurrentWeight();
  const weightPercentage = carryingCapacity > 0 ? (currentWeight / carryingCapacity) * 100 : 0;

  // Компонент сетки инвентаря
  const InventoryGrid: React.FC<{ characterData: CharacterData | null }> = ({ characterData }) => {
    const equipmentSlots = 16; // 2 строки по 8 слотов для экипировки
    const inventorySlots = 48; // 6 строк по 8 слотов для обычного инвентаря
    const totalSlots = equipmentSlots + inventorySlots;
    const downPos = useRef<{x: number; y: number} | null>(null);
    
    // Получаем все предметы из всех инвентарей
    const allItems = inventories.flatMap(inventory => 
      inventory.items.map(item => ({
        ...item,
        inventoryName: inventory.name
      }))
    );

    // Разделяем предметы на экипированные и неэкипированные
    const equippedItems = allItems.filter(item => item.is_equipped);
    const unequippedItems = allItems.filter(item => !item.is_equipped);

    // Функция для поиска экипированного предмета для конкретного слота
    const getEquippedItemForSlot = (slotType: string, slotIndex: number) => {
      // Для универсальных слотов возвращаем null (они не привязаны к конкретному типу)
      if (slotType === 'versatile') return null;
      
      return equippedItems.find(item => 
        item.card.slot === slotType
      ) || null;
    };

    // Определяем слоты экипировки
    const equipmentSlotTypes = [
      // Первая строка: Правая рука, правая рука, кольцо, шлем, перчатки, плащ, *, *
      ['one_hand', 'one_hand', 'ring', 'head', 'arms', 'cloak', 'versatile', 'versatile'],
      // Вторая строка: Левая рука, левая рука, кольцо, торс, сапоги, ожерелье, *, *
      ['one_hand', 'one_hand', 'ring', 'body', 'feet', 'necklace', 'versatile', 'versatile']
    ];

    // Функция для получения иконки слота
    const getSlotIcon = (slotType: string, isLeftHand: boolean = false) => {
      const iconMap: { [key: string]: string } = {
        'one_hand': 'hand.png',
        'ring': 'ring.png',
        'head': 'helm.png',
        'arms': 'gloves.png',
        'cloak': 'cloak.png',
        'body': 'armor.png',
        'feet': 'boots.png',
        'necklace': 'necklace.png',
        'versatile': 'hand.png' // Для универсальных слотов используем иконку руки
      };
      
      const iconPath = iconMap[slotType] || 'hand.png';
      return `/icons/slots/${iconPath}`;
    };
    

    const handleAddItemClick = () => {
      setShowAddItemModal(true);
    };

    const handleItemClick = (item: any) => {
      // Защита от дребезга/двойных открытий
      console.log('CLICK DETECTED')
      if (isOpeningRef.current) {
        return;
      }
      isOpeningRef.current = true;
      if (openingTimerRef.current) {
        clearTimeout(openingTimerRef.current);
      }
      openingTimerRef.current = window.setTimeout(() => {
        isOpeningRef.current = false;
      }, 250);
      console.log('ITEM CLICK START:', { itemName: item?.card?.name });
      if (item && item.card) {
        setSelectedCard(item.card);
        setShowCardDetailModal(true);
        setTimeout(() => {
          console.log('ITEM CLICK AFTER SET: modal should be open');
        }, 0);
      }
    };

    const handleMouseEnter = (item: any, slotIndex: number) => {
      if (item && item.card) {
        setHoveredItem(item);
        setHoveredSlotIndex(slotIndex);
      }
    };

    const handleMouseLeave = () => {
      // Если в момент leave кнопка мыши зажата, игнорируем, чтобы не срывать click
      if (isMouseDownRef.current) return;
      setHoveredItem(null);
      setHoveredSlotIndex(null);
    };

    // Прячем hover-карту при уходе курсора за пределы окна
    useEffect(() => {
      const onWindowMouseOut = (e: MouseEvent) => {
        const to = (e.relatedTarget || (e as any).toElement) as Node | null;
        if (!to) {
          // курсор ушёл из окна
          setHoveredItem(null);
          setHoveredSlotIndex(null);
        }
      };
      window.addEventListener('mouseout', onWindowMouseOut);
      return () => window.removeEventListener('mouseout', onWindowMouseOut);
    }, []);

    // Функция экипировки предмета
    const handleEquipItem = async (item: any, isEquipped: boolean) => {
      try {
        await inventoryApi.equipItem(item.id, isEquipped);
        // Перезагружаем инвентари для обновления состояния
        if (id) {
          await loadInventories(id);
        }
      } catch (error) {
        console.error('Ошибка экипировки предмета:', error);
      }
    };

    // Drag & Drop обработчики
    const handleDragStart = (e: React.DragEvent, item: any) => {
      setDraggedItem(item);
      e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragEnd = () => {
      setDraggedItem(null);
      setDragOverSlot(null);
    };

    const handleDragOver = (e: React.DragEvent, slotIndex: number, isEquipmentSlot: boolean) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      if (isEquipmentSlot) {
        setDragOverSlot(slotIndex);
      } else {
        setDragOverSlot(null);
      }
    };

    const handleDragLeave = () => {
      setDragOverSlot(null);
    };

    const handleDrop = async (e: React.DragEvent, slotIndex: number, isEquipmentSlot: boolean) => {
      e.preventDefault();
      setDragOverSlot(null);
      
      if (!draggedItem) return;

      if (isEquipmentSlot) {
        // Перетаскивание в слот экипировки - экипируем предмет
        const row = Math.floor(slotIndex / 8);
        const col = slotIndex % 8;
        const targetSlotType = equipmentSlotTypes[row][col];
        
        // Проверяем совместимость слота
        const canEquip = draggedItem.card.slot === targetSlotType || targetSlotType === 'versatile';
        
        if (canEquip) {
          await handleEquipItem(draggedItem, true);
        } else {
          console.log('Предмет нельзя экипировать в этот слот');
        }
      } else {
        // Перетаскивание в рюкзак - снимаем предмет
        if (draggedItem.is_equipped) {
          await handleEquipItem(draggedItem, false);
        }
      }
      
      setDraggedItem(null);
    };

    return (
      <div className="relative" onMouseLeave={handleMouseLeave}>
        {/* Секция экипировки */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Экипировка</h3>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: equipmentSlots }, (_, index) => {
              const row = Math.floor(index / 8);
              const col = index % 8;
              const slotType = equipmentSlotTypes[row][col];
              const isLeftHand = row === 1 && (col === 0 || col === 1); // Левая рука во второй строке
              
              // Ищем экипированный предмет для этого слота
              const equippedItem = getEquippedItemForSlot(slotType, index);
              
              return (
                <div
                  key={index}
                  className={`w-16 h-16 border border-gray-300 rounded flex items-center justify-center relative group cursor-pointer ${
                    equippedItem ? 'bg-white' : 'bg-gray-100'
                  } ${
                    dragOverSlot === index ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                  title={equippedItem ? `${equippedItem.card.name} (${equippedItem.quantity})` : `Слот: ${slotType}`}
                  onClick={() => {
                    if (equippedItem) {
                      handleItemClick(equippedItem);
                    }
                  }}
                  onDragOver={(e) => handleDragOver(e, index, true)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index, true)}
                >
                  {equippedItem ? (
                    <div 
                      className="relative w-full h-full flex items-center justify-center"
                    >
                      {equippedItem.card.image_url ? (
                        <img
                          src={equippedItem.card.image_url}
                          alt={equippedItem.card.name}
                          className="w-14 h-14 object-cover rounded pointer-events-none"
                          draggable
                          onDragStart={(e) => handleDragStart(e, equippedItem)}
                          onDragEnd={handleDragEnd}
                        />
                      ) : (
                        <div 
                          className="w-14 h-14 bg-gray-300 rounded flex items-center justify-center pointer-events-none"
                        >
                          <Package className="w-6 h-6 text-gray-500" />
                        </div>
                      )}
                      {/* Единый интерактивный слой поверх изображения: hover + click */}
                      <div
                        className="absolute inset-0 z-10 cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => {
                          isMouseDownRef.current = true;
                          downPos.current = { x: e.clientX, y: e.clientY };
                          (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        }}
                        onPointerUp={(e) => {
                          isMouseDownRef.current = false;
                          (e.currentTarget as Element).releasePointerCapture(e.pointerId);

                          const start = downPos.current;
                          downPos.current = null;
                          if (!start) return;
                          const dx = Math.abs(e.clientX - start.x);
                          const dy = Math.abs(e.clientY - start.y);
                          const CLICK_TOLERANCE = 5;

                          if (dx <= CLICK_TOLERANCE && dy <= CLICK_TOLERANCE) {
                            handleItemClick(equippedItem);
                          }
                        }}
                        onPointerCancel={() => {
                          isMouseDownRef.current = false;
                          downPos.current = null;
                        }}
                        onPointerEnter={(e) => {
                          handleMouseEnter(equippedItem, index);
                        }}
                        onPointerLeave={() => {
                          handleMouseLeave();
                        }}
                      />
                      {equippedItem.quantity > 1 && (
                        <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                          {equippedItem.quantity}
                        </div>
                      )}
                      
                      {/* Hover карточка прямо в слоте */}
                      {hoveredItem && hoveredItem.card && hoveredSlotIndex === index && (
                        <div
                          className="absolute z-50 pointer-events-auto"
                          style={{
                            right: '100%',
                            top: '-20px',
                            marginRight: '2px',
                          }}
                          onMouseEnter={() => {
                            // Не скрываем карточку при наведении на неё
                          }}
                          onMouseLeave={() => {
                            // Скрываем только при уходе с карточки
                            setHoveredItem(null);
                            setHoveredSlotIndex(null);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleItemClick(hoveredItem);
                          }}
                        >
                          <div className="scale-75 origin-top-right cursor-pointer">
                            <CardPreview card={hoveredItem.card} disableHover={true} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-14 h-14 bg-gray-100 rounded flex items-center justify-center pointer-events-none">
                      {/* Показываем иконку только для первых 6 слотов в каждом ряду */}
                      {col < 6 ? (
                        <img
                          src={getSlotIcon(slotType, isLeftHand)}
                          alt={slotType}
                          className={`w-8 h-8 opacity-50 ${isLeftHand ? 'scale-x-[-1]' : ''}`}
                        />
                      ) : (
                        <div className="w-8 h-8 border-2 border-dashed border-gray-400 rounded"></div>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
        </div>

        {/* Секция обычного инвентаря */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Рюкзак</h3>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: inventorySlots }, (_, index) => {
              const item = unequippedItems[index]; // Показываем только неэкипированные предметы в рюкзаке
              const isLastSlot = index === inventorySlots - 1;
              
              return (
                <div
                  key={index}
                  className={`w-16 h-16 border border-gray-300 rounded flex items-center justify-center relative group cursor-pointer ${
                    item ? 'bg-white' : 
                    isLastSlot ? 'bg-blue-50' : 'bg-gray-200'
                  }`}
                  title={item ? `${item.card.name} (${item.quantity})` : isLastSlot ? 'Добавить предмет' : 'Пустой слот'}
                  onClick={() => {
                    if (isLastSlot) {
                      handleAddItemClick();
                    } else if (item) {
                      handleItemClick(item);
                    }
                  }}
                  onDragOver={(e) => handleDragOver(e, index, false)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index, false)}
                >
                  {item ? (
                    <div 
                      className="relative w-full h-full flex items-center justify-center"
                    >
                      {item.card.image_url ? (
                        <img
                          src={item.card.image_url}
                          alt={item.card.name}
                          className="w-14 h-14 object-cover rounded pointer-events-none"
                          draggable
                          onDragStart={(e) => handleDragStart(e, item)}
                          onDragEnd={handleDragEnd}
                        />
                      ) : (
                        <div 
                          className="w-14 h-14 bg-gray-300 rounded flex items-center justify-center pointer-events-none"
                        >
                          <Package className="w-6 h-6 text-gray-500" />
                        </div>
                      )}
                      {/* Единый интерактивный слой поверх изображения: hover + click */}
                      <div
                        className="absolute inset-0 z-10 cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => {
                          isMouseDownRef.current = true;
                          downPos.current = { x: e.clientX, y: e.clientY };
                          (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        }}
                        onPointerUp={(e) => {
                          isMouseDownRef.current = false;
                          (e.currentTarget as Element).releasePointerCapture(e.pointerId);

                          const start = downPos.current;
                          downPos.current = null;
                          if (!start) return;
                          const dx = Math.abs(e.clientX - start.x);
                          const dy = Math.abs(e.clientY - start.y);
                          const CLICK_TOLERANCE = 5;

                          if (dx <= CLICK_TOLERANCE && dy <= CLICK_TOLERANCE) {
                            handleItemClick(item);
                          }
                        }}
                        onPointerCancel={() => {
                          isMouseDownRef.current = false;
                          downPos.current = null;
                        }}
                        onPointerEnter={(e) => {
                          handleMouseEnter(item, equipmentSlots + index);
                        }}
                        onPointerLeave={() => {
                          handleMouseLeave();
                        }}
                      />
                      {item.quantity > 1 && (
                        <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none">
                          {item.quantity}
                        </div>
                      )}
                      
                      {/* Hover карточка */}
                      {hoveredItem && hoveredItem.card && hoveredSlotIndex === (equipmentSlots + index) && (
                        <div
                          className="absolute z-50 pointer-events-auto"
                          style={{
                            right: '100%',
                            top: '-20px',
                            marginRight: '2px',
                          }}
                          onMouseEnter={() => {}}
                          onMouseLeave={() => {
                            setHoveredItem(null);
                            setHoveredSlotIndex(null);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleItemClick(hoveredItem);
                          }}
                        >
                          <div className="scale-75 origin-top-right cursor-pointer">
                            <CardPreview card={hoveredItem.card} disableHover={true} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : isLastSlot ? (
                    <div 
                      className="w-14 h-14 bg-blue-100 rounded flex items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddItemClick();
                      }}
                    >
                      <Plus className="w-6 h-6 text-blue-600" />
                    </div>
                  ) : (
                    <div className="w-14 h-14 bg-gray-200 rounded flex items-center justify-center pointer-events-none">
                      <div className="w-8 h-8 border-2 border-dashed border-gray-400 rounded"></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderBasicTab = () => (
    <div className="space-y-6">
      {/* Характеристики и Навыки */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex gap-6">
          {/* Характеристики - узкий столбец */}
          <div className="w-1/5">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Характеристики</h2>
            <div className="space-y-1">
              {Object.entries(characterData.stats || {}).map(([key, stat]) => {
                const savingThrow = getSavingThrowBonus(key);
                const statNameInRussian = getStatNameInRussian(key);
                return (
                  <div key={key} className="flex">
                    {/* Название характеристики - 25% */}
                    <div className="flex items-center justify-center p-2 bg-gray-50 rounded-l-lg w-1/4">
                      <div className="text-xs text-gray-600 uppercase">{statNameInRussian}</div>
                    </div>
                    
                    {/* Значение характеристики - 25% */}
                    <div className="flex items-center justify-center p-2 bg-gray-50 w-1/4">
                      <div className="text-xs text-gray-500">{stat.score}</div>
                    </div>
                    
                    {/* Модификатор характеристики - 25% */}
                    <div className="flex items-center justify-center p-2 bg-gray-50 w-1/4">
                      <div className="text-sm font-bold text-gray-900">{getModifier(stat.score)}</div>
                    </div>
                    
                    {/* Спасбросок - 25% */}
                    <div className="flex items-center justify-center p-2 bg-gray-50 rounded-r-lg w-1/4">
                      <div 
                        className={`text-sm ${savingThrow.isProficient ? 'font-bold' : 'font-normal'} text-gray-900 cursor-help relative z-10`}
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
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xs text-blue-600 font-medium mb-1">Уровень</div>
                <div className="text-lg font-bold text-blue-900">{characterData.info?.level?.value || 1}</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xs text-purple-600 font-medium mb-1">Мастерство</div>
                <div className="text-lg font-bold text-purple-900">+{characterData.proficiency || 2}</div>
              </div>
            </div>
            
            {/* Блок защиты, скорости, здоровья и пассивного восприятия - 2x2 */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xs text-green-600 font-medium mb-1">Защита</div>
                <div className="text-lg font-bold text-green-900">{characterData.vitality?.ac?.value || 10}</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <div className="text-xs text-orange-600 font-medium mb-1">Скорость</div>
                <div className="text-lg font-bold text-orange-900">{characterData.vitality?.speed?.value || 30}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xs text-red-600 font-medium mb-1">Хиты</div>
                <div className="text-lg font-bold text-red-900">{characterData.vitality?.hp_current?.value || 0}/{characterData.vitality?.hp_max?.value || 0}</div>
              </div>
              <div className="bg-indigo-50 rounded-lg p-3 text-center">
                <div className="text-xs text-indigo-600 font-medium mb-1">Восприятие</div>
                <div className="text-lg font-bold text-indigo-900">{10 + (characterData.stats?.wis?.score ? Math.floor((characterData.stats.wis.score - 10) / 2) : 0) + (characterData.skills?.perception?.isProf ? (characterData.proficiency || 2) : 0)}</div>
              </div>
            </div>
          </div>

          {/* Навыки - уменьшенный столбец */}
          <div className="w-1/5">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Навыки</h2>
            <div className="grid grid-cols-1 gap-1">
              {Object.entries(characterData.skills || {}).map(([skillName, skill]) => {
                const isProficient = skill.isProf === 1 || skill.isProf === true;
                return (
                  <div key={skillName} className={`flex items-center justify-between p-1.5 rounded-lg ${isProficient ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                    <div className="flex items-center space-x-1">
                      <span className="text-xs font-medium text-gray-900">{getSkillNameInRussian(skillName)}</span>
                      {isProficient && <span className="text-xs bg-green-100 text-green-800 px-1 py-0.5 rounded">М</span>}
                    </div>
                    <div className="text-xs font-bold text-gray-900">{getSkillBonus(skillName)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Инвентарь */}
          <div className="w-3/5">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Инвентарь</h2>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <InventoryGrid characterData={characterData} />
            </div>
          </div>
        </div>
      </div>




      {/* Языки */}
      {characterData.prof?.value && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Языки и владения</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг языков из prof */}
              <p>Языки и владения персонажа</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderClassRaceTab = () => (
    <div className="space-y-6">
      {/* Информация о классе и расе */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Класс и Раса</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Раса</h3>
            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="font-medium text-blue-900">{characterData.info?.race?.value}</div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Класс</h3>
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="font-medium text-green-900">{characterData.info?.charClass?.value}</div>
              <div className="text-sm text-green-700">Уровень {characterData.info?.level?.value}</div>
            </div>
          </div>
        </div>
      </div>


      {/* Особенности класса и расы */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Особенности класса и расы</h2>
        <div className="prose max-w-none">
          <div className="text-gray-700 text-sm leading-relaxed">
            {characterData.text?.traits?.value?.data?.content ? 
              parseTraitsContent(characterData.text.traits.value.data.content) : 
              <p className="text-gray-500">Данные о способностях не найдены</p>
            }
          </div>
        </div>
      </div>
    </div>
  );

  const renderInventoryTab = () => (
    <div className="space-y-6">
      {/* Грузоподъемность */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <Weight className="h-5 w-5 mr-2" />
          Грузоподъемность
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">Текущий вес</div>
              <div className="text-xl font-bold text-gray-900">{currentWeight.toFixed(1)} фт</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">Максимум</div>
              <div className="text-xl font-bold text-gray-900">{carryingCapacity} фт</div>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                weightPercentage > 100 ? 'bg-red-500' :
                weightPercentage > 75 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(weightPercentage, 100)}%` }}
            />
          </div>
          <div className="text-center text-sm text-gray-600">
            {weightPercentage.toFixed(1)}% загруженности
          </div>
        </div>
      </div>

      {/* Инвентари */}
      {inventories && inventories.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Инвентари
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inventories.map((inventory) => (
              <Link
                key={inventory.id}
                to={`/inventory/${inventory.id}`}
                className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <div className="font-medium text-gray-900 mb-1">{inventory.name}</div>
                <div className="text-sm text-gray-600">
                  {inventory.items?.length || 0} предметов
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Нет инвентарей</h3>
          <p className="text-gray-600">У этого персонажа пока нет инвентарей</p>
        </div>
      )}
    </div>
  );

  const renderActionsTab = () => (
    <div className="space-y-6">
      {/* Оружие */}
      {characterData.weaponsList && characterData.weaponsList.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Оружие</h2>
          <div className="space-y-3">
            {characterData.weaponsList.map((weapon) => (
              <div key={weapon.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">{weapon.name.value}</div>
                  <div className="text-sm text-gray-600">{weapon.dmg.value}</div>
                  {weapon.notes.value && (
                    <div className="text-xs text-gray-500 mt-1">{weapon.notes.value}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900 text-lg">{weapon.mod.value}</div>
                  {weapon.isProf && (
                    <div className="text-xs text-green-600">Мастерство</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Sword className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Нет оружия</h3>
          <p className="text-gray-600">У этого персонажа пока нет оружия</p>
        </div>
      )}

      {/* Заклинания */}
      {characterData.spells && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Заклинания</h2>
          <div className="prose max-w-none">
            <p className="text-gray-600">Информация о заклинаниях персонажа</p>
          </div>
        </div>
      )}
    </div>
  );

  const renderPassivesTab = () => (
    <div className="space-y-6">
      {/* Снаряжение */}
      {characterData.feats && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Снаряжение</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг снаряжения из feats */}
              <p>Снаряжение персонажа</p>
            </div>
          </div>
        </div>
      )}

      {/* Союзники и особенности */}
      {characterData.allies && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Союзники и особенности</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг союзников из allies */}
              <p>Союзники и особенности персонажа</p>
            </div>
          </div>
        </div>
      )}

      {/* Условия */}
      {characterData.conditions && characterData.conditions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Активные условия</h2>
          <div className="space-y-2">
            {characterData.conditions.map((condition, index) => (
              <div key={index} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="font-medium text-yellow-900">{condition}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/characters"
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Назад</span>
          </Link>
          <div>
            <h1 className="text-3xl font-fantasy font-bold text-gray-900">
              {characterData.name?.value || character.name}
            </h1>
            <p className="text-gray-600">
              {characterData.info?.race?.value} • {characterData.info?.charClass?.value} {characterData.info?.level?.value} ур.
            </p>
          </div>
        </div>
        <Link
          to={`/characters/${character.id}/edit`}
          className="btn-primary flex items-center space-x-2"
        >
          <Edit size={18} />
          <span>Редактировать</span>
        </Link>
      </div>

      {/* Вкладки */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
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
          </nav>
        </div>

        {/* Содержимое вкладок */}
        <div className="p-6">
          {activeTab === 'basic' && renderBasicTab()}
          {activeTab === 'class-race' && renderClassRaceTab()}
          {activeTab === 'inventory' && renderInventoryTab()}
          {activeTab === 'actions' && renderActionsTab()}
          {activeTab === 'passives' && renderPassivesTab()}
        </div>
      </div>


      {/* Модал добавления предмета */}
      {showAddItemModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-semibold text-gray-900">Добавить предмет</h3>
                <button
                  onClick={() => setShowAddItemModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <p className="text-gray-600">Выберите предмет для добавления в инвентарь:</p>
                
                {/* Здесь можно добавить список доступных карточек или поиск */}
                <div className="text-center py-8">
                  <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-500">Функция добавления предметов будет реализована позже</p>
                  <p className="text-sm text-gray-400 mt-2">Пока что можно использовать существующий интерфейс инвентаря</p>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    onClick={() => setShowAddItemModal(false)}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={() => {
                      // Здесь будет логика добавления предмета
                      setShowAddItemModal(false);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Добавить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

      {/* Модал детального просмотра карточки */}
      {/* modal render debug removed */}
      <CardDetailModal
        card={selectedCard}
        isOpen={showCardDetailModal}
        onClose={() => {
          
          setShowCardDetailModal(false);
          setSelectedCard(null);
        }}
        onEdit={(cardId: string) => {
          
          navigate(`/card-creator?edit=${cardId}`);
        }}
        onDelete={(cardId: string) => {
          
          // Здесь можно добавить логику удаления из инвентаря
        }}
      />
    </div>
  );
};

export default CharacterDetail;