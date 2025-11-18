import React, { useRef, useState } from 'react';
import { Upload, Clipboard, X, Cloud, Loader2 } from 'lucide-react';
import { imagesApi } from '../api/imagesApi';

interface ImageUploaderProps {
  onImageUpload: (imageUrl: string) => void;
  currentImageUrl?: string;
  className?: string;
  entityType?: 'card' | 'weapon_template';
  entityId?: string;
  enableCloudUpload?: boolean;
}

const ImageUploader = ({ 
  onImageUpload, 
  currentImageUrl, 
  className = '',
  entityType,
  entityId,
  enableCloudUpload = false
}: ImageUploaderProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingToCloud, setIsUploadingToCloud] = useState(false);
  const [cloudUploadError, setCloudUploadError] = useState<string | null>(null);

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
        
        // Для прозрачных изображений не нужно заполнять фон
        // Canvas по умолчанию прозрачный, просто рисуем изображение
        if (ctx) {
          // Рисуем изображение с сохранением прозрачности
          ctx.drawImage(img, 0, 0, width, height);
        }
        
        // Конвертируем в base64 с прозрачностью (PNG)
        const imageUrl = canvas.toDataURL('image/png');
        onImageUpload(imageUrl);
        setIsLoading(false);
      };
      
      // Обрабатываем ошибки загрузки изображения
      img.onerror = () => {
        console.error('Ошибка загрузки изображения');
        setIsLoading(false);
      };
      
      img.src = URL.createObjectURL(file);
    } catch (error) {
      console.error('Ошибка обработки изображения:', error);
      setIsLoading(false);
    }
  };

  // Загрузка изображения в облако
  const handleCloudUpload = async (imageUrl: string) => {
    if (!enableCloudUpload || !entityType || !entityId) {
      return;
    }

    try {
      setIsUploadingToCloud(true);
      setCloudUploadError(null);

      // Конвертируем base64 в File
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], 'image.png', { type: 'image/png' });

      const result = await imagesApi.uploadImage(entityType, entityId, file);
      
      if (result.success) {
        onImageUpload(result.image_url);
      } else {
        setCloudUploadError('Не удалось загрузить изображение в облако');
      }
    } catch (error) {
      setCloudUploadError(error instanceof Error ? error.message : 'Ошибка загрузки в облако');
    } finally {
      setIsUploadingToCloud(false);
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
        <div className="relative space-y-3">
          <img
            src={currentImageUrl}
            alt="Загруженное изображение"
            className="max-w-full max-h-48 mx-auto rounded"
          />
          <div className="flex justify-center space-x-2">
            <button
              type="button"
              onClick={handleRemoveImage}
              className="flex items-center space-x-1 px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm"
            >
              <X size={14} />
              <span>Удалить</span>
            </button>
            {enableCloudUpload && entityType && entityId && (
              <button
                type="button"
                onClick={() => handleCloudUpload(currentImageUrl)}
                disabled={isUploadingToCloud}
                className="flex items-center space-x-1 px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 text-sm"
              >
                {isUploadingToCloud ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Загрузка...</span>
                  </>
                ) : (
                  <>
                    <Cloud size={14} />
                    <span>В облако</span>
                  </>
                )}
              </button>
            )}
          </div>
          {cloudUploadError && (
            <div className="text-red-600 text-sm text-center">
              {cloudUploadError}
            </div>
          )}
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
              onClick={async () => {
                try {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    if (item.types.includes('image/png')) {
                      const blob = await item.getType('image/png');
                      if (blob) {
                        await processImageFile(new File([blob], 'clipboard-image.png', { type: 'image/png' }));
                        break;
                      }
                    } else if (item.types.includes('image/jpeg') || item.types.includes('image/jpg')) {
                      const blob = await item.getType('image/jpeg');
                      if (blob) {
                        await processImageFile(new File([blob], 'clipboard-image.jpg', { type: 'image/jpeg' }));
                        break;
                      }
                    }
                  }
                } catch (error) {
                  console.error('Ошибка чтения из буфера обмена:', error);
                }
              }}
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
