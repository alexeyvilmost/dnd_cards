import React, { useEffect, useState, useRef } from 'react';
import { X, Edit, Trash2, Shield, ShieldOff, Wand2, Loader2, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Card, InventoryItem } from '../types';
import { getItemTypeLabel } from '../constants/itemTypes';
import { getEquipmentSlotLabel } from '../types';
import CardPreview from './CardPreview';
import ExportCardPreview from './ExportCardPreview';
import { imagesApi } from '../api/imagesApi';
import { cardsApi } from '../api/client';
import html2canvas from 'html2canvas';

interface CardDetailModalProps {
  card: Card | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  inventoryItem?: InventoryItem | null; // Информация о предмете в инвентаре
  onEquip?: (itemId: string, isEquipped: boolean) => void; // Функция экипировки
}

const CardDetailModal: React.FC<CardDetailModalProps> = ({
  card,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  inventoryItem,
  onEquip
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [cardImage, setCardImage] = useState<string>(card?.image_url || '');
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Отдельный ref для экспорта — рендерим карту без масштабирования и эффектов
  const exportRef = useRef<HTMLDivElement>(null);

  // Обработчик для закрытия по Esc
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, isOpen]);

  // Синхронизируем cardImage с card.image_url
  useEffect(() => {
    if (card?.image_url) {
      setCardImage(card.image_url);
    }
  }, [card?.image_url]);

  if (!isOpen || !card) return null;

  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return `${price}`;
  };

  const formatWeight = (weight: number): string => {
    return `${weight} фнт.`;
  };

  // Функция генерации изображения
  const handleGenerateImage = async () => {
    if (!card) return;
    
    try {
      setIsGenerating(true);
      setGenerateError(null);

      const response = await imagesApi.generateImage('card', card.id, undefined, {
        name: card.name,
        description: card.description,
        rarity: card.rarity,
        image_prompt_extra: card.image_prompt_extra || undefined,
      });
      
      if (response.success) {
        // Обновляем карту с URL изображения
        await cardsApi.updateCard(card.id, { image_url: response.image_url });
        setCardImage(response.image_url);
      } else {
        setGenerateError('Не удалось сгенерировать изображение');
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Ошибка генерации изображения');
    } finally {
      setIsGenerating(false);
    }
  };

  // Функция скачивания карты как PNG
  const handleDownloadCard = async () => {
    if (!exportRef.current || !card) return;
    
    try {
      setIsDownloading(true);
      
      // Конвертируем элемент карты в canvas
      // Экспортируем скрытый элемент без визуального масштабирования
      const isExtended = Boolean(card.is_extended);
      const exportWidth = isExtended ? 397 : 198;
      const exportHeight = 280;

      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: 'white',
        scale: 3, // Большее разрешение для четкости при печати
        logging: false,
        useCORS: true, // Для корректной загрузки внешних изображений
        width: exportWidth,
        height: exportHeight,
        allowTaint: false,
        foreignObjectRendering: false,
      });
      
      // Конвертируем canvas в blob
      canvas.toBlob((blob) => {
        if (!blob) {
          setGenerateError('Не удалось создать изображение');
          return;
        }
        
        // Создаем ссылку для скачивания
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${card.name.replace(/[^a-zа-яё0-9]/gi, '_')}_${card.card_number}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/png', 0.95);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Ошибка при скачивании карты');
    } finally {
      setIsDownloading(false);
    }
  };

  const getRarityLabel = (rarity: string): string => {
    switch (rarity) {
      case 'common': return 'Обычная';
      case 'uncommon': return 'Необычная';
      case 'rare': return 'Редкая';
      case 'very_rare': return 'Очень редкая';
      case 'artifact': return 'Артефакт';
      default: return rarity;
    }
  };

  const getRarityColor = (rarity: string): string => {
    switch (rarity) {
      case 'common': return 'text-gray-600';
      case 'uncommon': return 'text-green-600';
      case 'rare': return 'text-blue-600';
      case 'very_rare': return 'text-purple-600';
      case 'artifact': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getPropertyLabels = (properties: string[]): string[] => {
    const labels: Record<string, string> = {
      'consumable': 'Расходуемое',
      'single_use': 'Одноразовое',
      'light': 'Легкое',
      'heavy': 'Тяжелое',
      		'finesse': 'Фехтовальное',
      'thrown': 'Метательное',
      'versatile': 'Универсальное',
      'two-handed': 'Двуручное',
      'reach': 'Досягаемости',
      'ammunition': 'Требует боеприпасы',
      'loading': 'Зарядка',
      'special': 'Особое'
    };
    return properties.map(p => labels[p] || p);
  };

  const getDamageTypeLabel = (damageType: string): string => {
    switch (damageType) {
      case 'piercing': return 'колющий';
      case 'slashing': return 'рубящий';
      case 'bludgeoning': return 'дробящий';
      default: return damageType;
    }
  };

  const getDefenseTypeLabel = (defenseType: string): string => {
    switch (defenseType) {
      case 'cloth': return 'тканевая';
      case 'light': return 'легкая';
      case 'medium': return 'средняя';
      case 'heavy': return 'тяжелая';
      default: return defenseType;
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`relative flex flex-col lg:flex-row bg-transparent text-white rounded-lg shadow-xl w-full h-full max-h-[90vh] overflow-hidden ${card.is_extended ? 'max-w-7xl' : 'max-w-6xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Левая часть: Увеличенная карточка */}
        <div className={`flex-shrink-0 flex items-center justify-center p-4 ${card.is_extended ? 'lg:w-2/3' : 'lg:w-1/2'}`}>
          <div ref={cardRef} className="transform scale-[1.5] origin-center">
            <CardPreview card={{...card, image_url: cardImage}} disableHover={true} />
          </div>
        </div>

        {/* Правая часть: Детальная информация */}
        <div className={`flex-grow p-6 overflow-y-auto space-y-4 flex flex-col justify-center ${card.is_extended ? 'lg:w-1/3' : 'lg:w-1/2'}`}>
          <div className="flex justify-between items-start">
            <h2 className="font-bold text-3xl font-fantasy">{card.name}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>

          {card.description && (
            <p className="text-lg whitespace-pre-wrap">{card.description}</p>
          )}

          {card.detailed_description && (
            <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-600">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Подробное описание:</h3>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                {card.detailed_description}
              </p>
            </div>
          )}

          {/* Тип урона и брони */}
          {(card.damage_type || card.defense_type) && (
            <div className="text-sm space-y-1">
              {card.damage_type && (
                <p><strong>Тип урона:</strong> {getDamageTypeLabel(card.damage_type)}</p>
              )}
              {card.defense_type && (
                <p><strong>Тип брони:</strong> {getDefenseTypeLabel(card.defense_type)}</p>
              )}
            </div>
          )}

          {/* Характеристики в столбец */}
          <div className="text-sm space-y-1">
            <p><strong>Редкость:</strong> {getRarityLabel(card.rarity)}</p>
            <p><strong>Номер:</strong> {card.card_number}</p>
            {card.author && <p><strong>Автор:</strong> {card.author}</p>}
            {card.source && <p><strong>Источник:</strong> {card.source}</p>}
            {card.type && <p><strong>Тип:</strong> {getItemTypeLabel(card.type)}</p>}
            {card.slot && <p><strong>Слот:</strong> {getEquipmentSlotLabel(card.slot)}</p>}
            {card.price && <p><strong>Цена:</strong> {formatPrice(card.price)} золота</p>}
            {card.weight && <p><strong>Вес:</strong> {formatWeight(card.weight)}</p>}
            {card.bonus_type && card.bonus_value && (
              <p><strong>Бонус:</strong> {card.bonus_value} ({card.bonus_type === 'damage' ? 'Урон' : 'Защита'})</p>
            )}
            {card.properties && card.properties.length > 0 && (
              <p><strong>Свойства:</strong> {getPropertyLabels(card.properties).join(', ')}</p>
            )}
            {card.tags && card.tags.length > 0 && (
              <p><strong>Теги:</strong> {card.tags.join(', ')}</p>
            )}
            {card.attunement && (
              <div>
                <p><strong>Настройка:</strong></p>
                <p className="text-xs text-gray-300 mt-1">{card.attunement}</p>
              </div>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={handleDownloadCard}
              disabled={isDownloading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Download size={18} />
              )}
              <span>{isDownloading ? 'Скачивание...' : 'Скачать карту'}</span>
            </button>
            <button
              onClick={() => onEdit(card.id)}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Изменить</span>
            </button>
            <button
              onClick={() => onDelete(card.id)}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Trash2 size={18} />
              <span>Удалить</span>
            </button>
            {!card.image_url && (
              <button
                onClick={handleGenerateImage}
                disabled={isGenerating}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-2 rounded flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Wand2 size={18} />
                )}
                <span>{isGenerating ? 'Генерация...' : 'Сгенерировать изображение'}</span>
              </button>
            )}
            
            {/* Кнопка экипировки - только для предметов в инвентаре */}
            {inventoryItem && onEquip && card.slot && (
              <button
                onClick={async () => {
                  console.log('Equip button clicked:', { 
                    itemId: inventoryItem.id, 
                    currentState: inventoryItem.is_equipped,
                    newState: !inventoryItem.is_equipped,
                    cardSlot: card.slot
                  });
                  await onEquip(inventoryItem.id, !inventoryItem.is_equipped);
                  // Закрываем модальное окно после успешной экипировки
                  onClose();
                }}
                className={`px-4 py-2 rounded flex items-center space-x-2 ${
                  inventoryItem.is_equipped 
                    ? 'bg-orange-600 hover:bg-orange-700 text-white' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {inventoryItem.is_equipped ? (
                  <>
                    <ShieldOff size={18} />
                    <span>Снять</span>
                  </>
                ) : (
                  <>
                    <Shield size={18} />
                    <span>Надеть</span>
                  </>
                )}
              </button>
            )}
          </div>
          
          {/* Отображение ошибки генерации */}
          {generateError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">{generateError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Скрытый блок для корректного экспорта PNG без масштабирования */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: -10000, top: 0, width: 'auto', height: 'auto' }}
      >
        <div ref={exportRef}>
          <ExportCardPreview card={{...card, image_url: cardImage}} />
        </div>
      </div>
    </div>
  );
};

export default CardDetailModal;
