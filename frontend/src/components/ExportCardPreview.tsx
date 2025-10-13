import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import { getPropertyLabel } from '../utils/propertyLabels';
import { renderProperties } from '../utils/propertyIcons';
import { getRarityColor } from '../utils/rarityColors';

// Функция для получения значения цвета редкости для inline стилей
const getRarityColorValue = (rarity: string) => {
  switch (rarity) {
    case 'common':
      return '#6b7280'; // gray-500
    case 'uncommon':
      return '#10b981'; // emerald-500
    case 'rare':
      return '#3b82f6'; // blue-500
    case 'epic':
      return '#8b5cf6'; // violet-500
    case 'legendary':
      return '#f59e0b'; // amber-500
    default:
      return '#6b7280';
  }
};

interface ExportCardPreviewProps {
  card: Card;
  className?: string;
}

const ExportCardPreview = ({ card, className = '' }: ExportCardPreviewProps) => {
  const rarityOption = RARITY_OPTIONS.find(option => option.value === card.rarity);
  // Для совместимости с одним свойством и массивом свойств
  const propertiesArray = Array.isArray(card.properties) ? card.properties : (card.properties ? [card.properties] : []);
  const propertiesLabels = propertiesArray.map(prop => {
    const option = PROPERTIES_OPTIONS.find(opt => opt.value === prop);
    return option?.label || prop;
  }).join(', ');
  const isExtended = Boolean(card.is_extended);

  // Функция для определения размера шрифта заголовка
  const getTitleFontSize = (title: string) => {
    if (isExtended) {
      // Для расширенных карт используем больший шрифт
      if (title.length > 20) return '18px';
      if (title.length > 15) return '20px';
      return '20px';
    } else {
      // Для обычных карт используем стандартный размер
      if (title.length > 20) return '12px';
      if (title.length > 15) return '14px';
      return '14px';
    }
  };

  const getBorderColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return '#9ca3af';
      case 'uncommon': return '#10b981';
      case 'rare': return '#3b82f6';
      case 'very_rare': return '#8b5cf6';
      case 'artifact': return '#f59e0b';
      default: return '#d1d5db';
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return '#4b5563';
      case 'uncommon': return '#059669';
      case 'rare': return '#2563eb';
      case 'very_rare': return '#7c3aed';
      case 'artifact': return '#d97706';
      default: return '#4b5563';
    }
  };

  // Функция для получения класса заголовка в зависимости от редкости
  const getTitleStyle = (rarity: string, name: string) => {
    const baseStyle = {
      fontSize: getTitleFontSize(name),
      fontWeight: 'bold',
      lineHeight: '1.2',
      marginBottom: '2px',
      minHeight: '19px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: getRarityColor(rarity),
      fontFamily: 'fantasy'
    };
    
    return baseStyle;
  };

  // Функция форматирования цены
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `${(price / 1000).toFixed(1)}K`;
    }
    return `${price}`;
  };

  // Функция форматирования веса
  const formatWeight = (weight: number): string => {
    return `${weight}`;
  };

  // Функция для получения сокращенного названия бонуса
  const getBonusShortName = (bonusType: string): string => {
    switch (bonusType) {
      case 'damage': return 'УРОН';
      case 'defense': return 'ЗАЩ';
      default: return bonusType.toUpperCase();
    }
  };

  // Функция для получения сокращенного значения бонуса
  const getBonusShortValue = (bonusValue: string): string => {
    if (bonusValue.toLowerCase() === 'advantage') return 'ADV';
    return bonusValue;
  };

  // Функция для получения типа урона из поля damage_type
  const getDamageTypeLabel = (damageType: string): string => {
    switch (damageType) {
      case 'piercing': return 'колющий';
      case 'slashing': return 'рубящий';
      case 'bludgeoning': return 'дробящий';
      default: return '';
    }
  };

  // Функция для получения типа защиты из поля defense_type
  const getDefenseTypeLabel = (defenseType: string): string => {
    switch (defenseType) {
      case 'cloth': return 'тканевая';
      case 'light': return 'легкая';
      case 'medium': return 'средняя';
      case 'heavy': return 'тяжелая';
      default: return '';
    }
  };

  // Функция для отображения иконок защиты
  const renderDefenseIcons = (defenseType: string) => {
    switch (defenseType) {
      case 'cloth':
        return <img src="/icons/cloth.png" alt="Тканевая броня" style={{ width: '12px', height: '12px' }} />;
      case 'light':
        return <img src="/icons/defense.png" alt="Легкая броня" style={{ width: '12px', height: '12px' }} />;
      case 'medium':
        return (
          <div style={{ display: 'flex', gap: '0px' }}>
            <img src="/icons/defense.png" alt="Средняя броня" style={{ width: '12px', height: '12px' }} />
            <img src="/icons/defense.png" alt="Средняя броня" style={{ width: '12px', height: '12px' }} />
          </div>
        );
      case 'heavy':
        return (
          <div style={{ display: 'flex', gap: '0px' }}>
            <img src="/icons/defense.png" alt="Тяжелая броня" style={{ width: '12px', height: '12px' }} />
            <img src="/icons/defense.png" alt="Тяжелая броня" style={{ width: '12px', height: '12px' }} />
            <img src="/icons/defense.png" alt="Тяжелая броня" style={{ width: '12px', height: '12px' }} />
          </div>
        );
      default:
        return null;
    }
  };

  const cardStyle = {
    position: 'relative' as const,
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    border: `4px solid ${getBorderColor(card.rarity)}`,
    width: isExtended ? '397px' : '198px',
    height: '280px',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: 'Arial, sans-serif'
  };

  const rarityMarkerStyle = {
    position: 'absolute' as const,
    top: '2px',
    left: '4px',
    fontSize: '12px',
    opacity: 0.8,
    userSelect: 'none' as const,
    color: getRarityColor(card.rarity)
  };

  const getRarityMarker = () => {
    switch (card.rarity) {
      case 'common': return '•';
      case 'uncommon': return ':';
      case 'rare': return '✦';
      case 'very_rare': return '✧';
      case 'artifact': return '★';
      default: return '•';
    }
  };

  return (
    <div style={cardStyle} className={className}>
      {/* Метка редкости */}
      <div style={rarityMarkerStyle}>
        {getRarityMarker()}
      </div>

      {isExtended ? (
        // Расширенный формат для карт с большим описанием
        <>
          {/* Основной контент - горизонтальная компоновка */}
          <div style={{ display: 'flex', flex: 1 }}>
            {/* Левая половина - заголовок, изображение, свойства и бонусы */}
            <div style={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
              {/* Заголовок только над левой половиной */}
              <div style={{ padding: '2px 4px', textAlign: 'center' }}>
                <h3 style={getTitleStyle(card.rarity, card.name)}>
                  {card.name}
                </h3>
              </div>

              {/* Изображение - стандартный размер */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '144px' }}>
                {card.image_url && card.image_url.trim() !== '' ? (
                  <img
                    src={card.image_url}
                    alt={card.name}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = '/default_image.png';
                    }}
                  />
                ) : (
                  <img
                    src="/default_image.png"
                    alt="Default D&D"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
                  />
                )}
              </div>

              {/* Свойства */}
              <div style={{ 
                padding: '0px 8px 8px 8px', 
                backgroundColor: '#f9fafb', 
                flex: 1, 
                minHeight: '60px', 
                position: 'relative', 
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div style={{ width: '100%' }}>
                  {card.show_detailed_description && card.detailed_description && card.detailed_description.trim() !== '' ? (
                    <div 
                      style={{
                        fontSize: card.detailed_description_font_size ? `${card.detailed_description_font_size}px` : '12px',
                        textAlign: (card.detailed_description_alignment || 'left') as 'left' | 'center' | 'right',
                        color: getRarityColorValue(card.rarity),
                        fontFamily: 'fantasy',
                        whiteSpace: 'pre-wrap' as const
                      }}
                    >
                      {card.detailed_description}
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '12px',
                      fontWeight: '500',
                      color: getRarityColor(card.rarity),
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      whiteSpace: 'pre-wrap' as const,
                      fontFamily: 'fantasy'
                    }}>
                      {renderProperties(propertiesArray, Boolean(isExtended))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Правая половина - только описание */}
            <div style={{ 
              width: '50%', 
              padding: '8px', 
              backgroundColor: '#f9fafb', 
              borderLeft: '1px solid #e5e7eb', 
              display: 'flex', 
              flexDirection: 'column', 
              minHeight: '280px' 
            }}>
              {/* Описание и детальное описание */}
              <div style={{ 
                flex: 1, 
                overflow: 'hidden', 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'flex-start', 
                paddingTop: '8px', 
                gap: '8px' 
              }}>
                {/* Основное описание */}
                <p 
                  style={{
                    color: '#374151',
                    lineHeight: '1.4',
                    fontFamily: 'fantasy',
                    whiteSpace: 'pre-wrap' as const,
                    fontSize: card.text_font_size ? `${card.text_font_size}px` : 
                              card.description_font_size ? `${card.description_font_size}px` : '14px',
                    textAlign: (card.text_alignment || 'center') as 'left' | 'center' | 'right'
                  }}
                >
                  {card.description || 'Нет описания'}
                </p>
              </div>
            </div>
          </div>

          {/* Вес, цена, бонусы и номер карточки */}
          <div style={{
            position: 'absolute',
            bottom: '2px',
            left: '2px',
            right: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            zIndex: 10,
            backgroundColor: 'white',
            borderTop: '1px solid #e5e7eb'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {card.weight && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#111827', fontFamily: 'fantasy', fontWeight: '500' }}>
                    {formatWeight(card.weight)}
                  </span>
                  <img src="/icons/weight.png" alt="Вес" style={{ width: '12px', height: '12px' }} />
                </div>
              )}
              {card.price && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#d97706', fontFamily: 'fantasy', fontWeight: 'bold' }}>
                    {formatPrice(card.price)}
                  </span>
                  <img 
                    src="/icons/coin.png" 
                    alt="Монеты" 
                    style={{ 
                      width: '12px', 
                      height: '12px',
                      filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)'
                    }} 
                  />
                </div>
              )}
              {card.bonus_type && card.bonus_value && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#111827', fontFamily: 'fantasy', fontWeight: '500' }}>
                    {getBonusShortValue(card.bonus_value)}
                  </span>
                  {card.bonus_type === 'damage' && card.damage_type && (
                    <img src={`/icons/${card.damage_type}.png`} alt={getDamageTypeLabel(card.damage_type)} style={{ width: '12px', height: '12px' }} />
                  )}
                  {card.bonus_type === 'defense' && card.defense_type && (
                    renderDefenseIcons(card.defense_type)
                  )}
                  {card.bonus_type === 'defense' && card.type === 'щит' && (
                    <img src="/icons/defense.png" alt="Защита" style={{ width: '12px', height: '12px' }} />
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: '#9ca3af', fontFamily: 'monospace' }}>
                {card.card_number}
              </span>
            </div>
          </div>
        </>
      ) : (
        // Стандартный формат
        <>
          {/* Заголовок */}
          <div style={{ padding: '2px 4px', textAlign: 'center' }}>
            <h3 style={getTitleStyle(card.rarity, card.name)}>
              {card.name}
            </h3>
            <div style={{
              fontSize: '12px',
              fontWeight: '500',
              color: getRarityColor(card.rarity),
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              whiteSpace: 'pre-wrap' as const,
              fontFamily: 'fantasy'
            }}>
              {renderProperties(propertiesArray, Boolean(isExtended))}
            </div>
          </div>

          {/* Изображение */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '144px' }}>
            {card.image_url && card.image_url.trim() !== '' ? (
              <img
                src={card.image_url}
                alt={card.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '/default_image.png';
                }}
              />
            ) : (
              <img
                src="/default_image.png"
                alt="Default D&D"
                style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '4px' }}
              />
            )}
          </div>

          {/* Описание */}
          <div style={{ 
            padding: '4px 4px 32px 4px', 
            backgroundColor: '#f9fafb', 
            flex: 1, 
            position: 'relative', 
            overflow: 'hidden', 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'flex-start' 
          }}>
            <p 
              style={{
                color: '#374151',
                lineHeight: '1.4',
                fontFamily: 'fantasy',
                whiteSpace: 'pre-wrap' as const,
                fontSize: card.text_font_size ? `${card.text_font_size}px` : 
                          card.description_font_size ? `${card.description_font_size}px` : '14px',
                textAlign: (card.text_alignment || 'center') as 'left' | 'center' | 'right'
              }}
            >
              {card.description || 'Нет описания'}
            </p>
          </div>

          {/* Вес, цена, бонусы и номер карточки */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            zIndex: 10,
            backgroundColor: 'white',
            borderTop: '1px solid #e5e7eb',
            padding: '4px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {card.weight && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#111827', fontFamily: 'fantasy', fontWeight: '500' }}>
                    {formatWeight(card.weight)}
                  </span>
                  <img src="/icons/weight.png" alt="Вес" style={{ width: '12px', height: '12px' }} />
                </div>
              )}
              {card.price && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '10px', color: '#d97706', fontFamily: 'fantasy', fontWeight: 'bold' }}>
                    {formatPrice(card.price)}
                  </span>
                  <img 
                    src="/icons/coin.png" 
                    alt="Монеты" 
                    style={{ 
                      width: '12px', 
                      height: '12px',
                      filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)'
                    }} 
                  />
                </div>
              )}
              {card.bonus_type && card.bonus_value && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#111827', fontFamily: 'fantasy', fontWeight: '500' }}>
                    {getBonusShortValue(card.bonus_value)}
                  </span>
                  {card.bonus_type === 'damage' && card.damage_type && (
                    <img src={`/icons/${card.damage_type}.png`} alt={getDamageTypeLabel(card.damage_type)} style={{ width: '12px', height: '12px' }} />
                  )}
                  {card.bonus_type === 'defense' && card.defense_type && (
                    renderDefenseIcons(card.defense_type)
                  )}
                  {card.bonus_type === 'defense' && card.type === 'щит' && (
                    <img src="/icons/defense.png" alt="Защита" style={{ width: '12px', height: '12px' }} />
                  )}
                </div>
              )}
            </div>
            <span style={{ fontSize: '10px', color: '#9ca3af', fontFamily: 'monospace' }}>
              {card.card_number}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default ExportCardPreview;
