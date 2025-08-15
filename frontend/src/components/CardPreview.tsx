import { useState } from 'react';
import QRCode from 'qrcode';
import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';

interface CardPreviewProps {
  card: Card;
  className?: string;
}

const CardPreview = ({ card, className = '' }: CardPreviewProps) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  // Генерация QR-кода
  useState(() => {
    const generateQR = async () => {
      try {
        const url = await QRCode.toDataURL(card.card_number, {
          width: 40,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
        setQrCodeUrl(url);
      } catch (error) {
        console.error('Ошибка генерации QR-кода:', error);
      }
    };
    generateQR();
  });

  const rarityOption = RARITY_OPTIONS.find(option => option.value === card.rarity);
  const propertiesOption = PROPERTIES_OPTIONS.find(option => option.value === card.properties);

  const getBorderClass = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'card-border-common';
      case 'uncommon': return 'card-border-uncommon';
      case 'rare': return 'card-border-rare';
      case 'very_rare': return 'card-border-very-rare';
      case 'artifact': return 'card-border-artifact';
      default: return 'card-border';
    }
  };

  return (
    <div className={`card-preview ${getBorderClass(card.rarity)} ${className}`}>
      {/* Заголовок */}
      <div className="p-2 text-center border-b border-gray-200">
        <h3 className="text-sm font-bold text-gray-900 leading-tight">
          {card.name}
        </h3>
        <div className="flex justify-center items-center space-x-2 mt-1">
          <span className="text-xs text-gray-600">
            {rarityOption?.label}
          </span>
          <span className="text-xs text-gray-400">•</span>
          <span className="text-xs text-gray-600">
            {propertiesOption?.label}
          </span>
        </div>
      </div>

      {/* Изображение */}
      <div className="flex-1 p-2 flex items-center justify-center">
        {card.image_url ? (
          <img
            src={card.image_url}
            alt={card.name}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="w-full h-full bg-gray-100 rounded flex items-center justify-center">
            <span className="text-xs text-gray-500">Нет изображения</span>
          </div>
        )}
      </div>

      {/* Описание */}
      <div className="p-2 border-t border-gray-200">
        <p className="text-xs text-gray-700 leading-tight">
          {card.description}
        </p>
      </div>

      {/* QR-код */}
      {qrCodeUrl && (
        <div className="absolute bottom-1 right-1">
          <img
            src={qrCodeUrl}
            alt="QR Code"
            className="w-8 h-8"
          />
        </div>
      )}
    </div>
  );
};

export default CardPreview;
