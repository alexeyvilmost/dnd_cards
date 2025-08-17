import React, { useRef, useState } from 'react';
import { Upload, Clipboard, X } from 'lucide-react';

interface ImageUploaderProps {
  onImageUpload: (imageUrl: string) => void;
  currentImageUrl?: string;
  className?: string;
}

const ImageUploader = ({ onImageUpload, currentImageUrl, className = '' }: ImageUploaderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Обработка загрузки из буфера обмена
  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          await processImageFile(file);
        }
        break;
      }
    }
  };

  // Обработка загрузки файла
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processImageFile(file);
    }
  };

  // Обработка drag & drop
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        await processImageFile(file);
      }
    }
  };

  // Обработка файла изображения
  const processImageFile = async (file: File) => {
    try {
      setIsLoading(true);
      
      // Создаем canvas для обрезки изображения
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Устанавливаем размеры canvas (максимальные размеры для карточки)
        const maxWidth = 300;
        const maxHeight = 400;
        
        // Вычисляем новые размеры с сохранением пропорций
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Заполняем белым фоном
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
        }
        
        // Рисуем изображение с обрезкой
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Конвертируем в base64
        const imageUrl = canvas.toDataURL('image/jpeg', 0.8);
        onImageUpload(imageUrl);
        setIsLoading(false);
      };
      
      img.src = URL.createObjectURL(file);
    } catch (error) {
      console.error('Ошибка обработки изображения:', error);
      setIsLoading(false);
    }
  };

  // Удаление текущего изображения
  const handleRemoveImage = () => {
    onImageUpload('');
  };

  return (
    <div 
      className={`relative border-2 border-dashed border-gray-300 rounded-lg p-4 text-center ${className}`}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
    >
      {currentImageUrl ? (
        <div className="relative">
          <img
            src={currentImageUrl}
            alt="Загруженное изображение"
            className="max-w-full max-h-48 mx-auto rounded"
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className={`space-y-4 ${isDragOver ? 'bg-blue-50' : ''}`}>
          <div className="text-gray-400">
            <Upload size={48} className="mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700 mb-1">
              Загрузите изображение
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Перетащите файл, вставьте из буфера или нажмите кнопку
            </p>
          </div>
          
          <div className="flex justify-center space-x-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
            >
              <Upload size={16} />
              <span>Выбрать файл</span>
            </button>
            
            <button
              type="button"
              onClick={() => navigator.clipboard.read().then(async (items) => {
                for (const item of items) {
                  if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
                    const file = await item.getType('image/png') || await item.getType('image/jpeg');
                    if (file) {
                      await processImageFile(new File([file], 'clipboard-image.png'));
                    }
                    break;
                  }
                }
              })}
              disabled={isLoading}
              className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
            >
              <Clipboard size={16} />
              <span>Вставить</span>
            </button>
          </div>
          
          {isLoading && (
            <div className="text-sm text-gray-500">
              Обработка изображения...
            </div>
          )}
        </div>
      )}
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};

export default ImageUploader;
