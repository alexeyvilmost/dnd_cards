import React, { useState, useEffect } from 'react';
import { X, Search, Filter, Trash2, Edit3, Check, X as XIcon } from 'lucide-react';
import { getImageLibrary, deleteFromLibrary, updateImageLibrary, getRarities, ImageLibraryItem, ImageLibraryFilters } from '../api/imageLibraryApi';

interface ImageLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectImage: (image: ImageLibraryItem) => void;
}

const ImageLibraryModal: React.FC<ImageLibraryModalProps> = ({ isOpen, onClose, onSelectImage }) => {
  const [images, setImages] = useState<ImageLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRarity, setSelectedRarity] = useState('');
  const [rarities, setRarities] = useState<string[]>([]);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ card_name: '', card_rarity: '' });
  const [pagination, setPagination] = useState({ page: 1, limit: 100, total: 0 });
  const [selectedImage, setSelectedImage] = useState<ImageLibraryItem | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Загрузка изображений
  const loadImages = async (filters: ImageLibraryFilters = {}, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    
    try {
      const response = await getImageLibrary({
        page: filters.page || pagination.page,
        limit: filters.limit || pagination.limit,
        search: filters.search !== undefined ? filters.search : searchTerm,
        rarity: filters.rarity !== undefined ? filters.rarity : selectedRarity,
      });
      
      if (append) {
        setImages(prev => [...prev, ...response.images]);
      } else {
        setImages(response.images);
      }
      
      setPagination(response.pagination);
      setHasMore(response.images.length === (filters.limit || pagination.limit));
      
      // Автоматически выбираем первое изображение, если ничего не выбрано
      if (response.images.length > 0 && !selectedImage) {
        setSelectedImage(response.images[0]);
      }
    } catch (error) {
      console.error('Ошибка загрузки изображений:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Загрузка редкостей
  const loadRarities = async () => {
    try {
      const response = await getRarities();
      setRarities(response.rarities);
    } catch (error) {
      console.error('Ошибка загрузки редкостей:', error);
    }
  };

  // Загрузка следующей страницы
  const loadMoreImages = () => {
    if (!loadingMore && hasMore && !loading) {
      loadImages({ page: pagination.page + 1 }, true);
    }
  };

  // Инициализация
  useEffect(() => {
    if (isOpen) {
      loadImages();
      loadRarities();
    }
  }, [isOpen]);

  // Автоматическая подгрузка при прокрутке
  useEffect(() => {
    const handleScroll = () => {
      // Проверяем, когда пользователь прокрутил до конца контейнера с изображениями
      const scrollContainer = document.getElementById('image-scroll-container');
      if (scrollContainer) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
          if (hasMore && !loadingMore && !loading) {
            loadMoreImages();
          }
        }
      }
    };

    if (isOpen) {
      const scrollContainer = document.getElementById('image-scroll-container');
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScroll);
        return () => scrollContainer.removeEventListener('scroll', handleScroll);
      }
    }
  }, [isOpen, hasMore, loadingMore, loading, pagination.page]);

  // Поиск
  const handleSearch = () => {
    setHasMore(true);
    loadImages({ page: 1, search: searchTerm, rarity: selectedRarity });
  };

  // Сброс фильтров
  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedRarity('');
    setHasMore(true);
    loadImages({ page: 1, search: '', rarity: '' });
  };

  // Удаление изображения
  const handleDelete = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить это изображение из библиотеки?')) {
      return;
    }

    try {
      await deleteFromLibrary(id);
      loadImages();
    } catch (error) {
      console.error('Ошибка удаления изображения:', error);
    }
  };

  // Начало редактирования
  const handleStartEdit = (image: ImageLibraryItem) => {
    setEditingImage(image.id);
    setEditForm({
      card_name: image.card_name || '',
      card_rarity: image.card_rarity || '',
    });
  };

  // Сохранение изменений
  const handleSaveEdit = async () => {
    if (!editingImage) return;

    try {
      await updateImageLibrary(editingImage, editForm);
      setEditingImage(null);
      loadImages();
    } catch (error) {
      console.error('Ошибка обновления изображения:', error);
    }
  };

  // Отмена редактирования
  const handleCancelEdit = () => {
    setEditingImage(null);
    setEditForm({ card_name: '', card_rarity: '' });
  };

  // Выбор изображения для предпросмотра
  const handleImageClick = (image: ImageLibraryItem) => {
    setSelectedImage(image);
    setEditingImage(null);
  };

  // Выбор изображения для использования
  const handleSelectImage = (image: ImageLibraryItem) => {
    onSelectImage(image);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl h-[90vh] overflow-hidden flex flex-col image-library-modal">
        {/* Заголовок */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">Библиотека изображений</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Фильтры */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-64">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Поиск по названию
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Введите название карты..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <Search className="absolute right-3 top-2.5 h-5 w-5 text-gray-400" />
              </div>
            </div>

            <div className="min-w-48">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Редкость
              </label>
              <select
                value={selectedRarity}
                onChange={(e) => setSelectedRarity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Все редкости</option>
                {rarities.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {rarity}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <Search size={16} className="inline mr-2" />
                Поиск
              </button>
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                <Filter size={16} className="inline mr-2" />
                Сброс
              </button>
            </div>
          </div>
        </div>

        {/* Основной контент - две колонки */}
        <div className="flex-1 flex overflow-hidden">
          {/* Левая колонка - таблица изображений */}
          <div className="w-1/2 border-r overflow-y-auto" id="image-scroll-container">
            <div className="p-4">
              {loading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : images.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  Изображения не найдены
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      onClick={() => handleImageClick(image)}
                      className={`w-20 h-20 bg-gray-100 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 border-2 ${
                        selectedImage?.id === image.id
                          ? 'border-blue-500 shadow-lg scale-105'
                          : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                      }`}
                    >
                      <img
                        src={image.cloudinary_url}
                        alt={image.card_name || 'Изображение'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Правая колонка - предпросмотр */}
          <div className="w-1/2 flex flex-col">
            {selectedImage ? (
              <>
                {/* Предпросмотр изображения */}
                <div className="flex-1 p-4 flex items-center justify-center bg-gray-50 min-h-0">
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={selectedImage.cloudinary_url}
                      alt={selectedImage.card_name || 'Изображение'}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                      style={{ maxHeight: 'calc(100vh - 400px)' }}
                    />
                  </div>
                </div>

                {/* Информация и кнопки */}
                <div className="h-[200px] p-4 border-t bg-white overflow-y-auto">
                  {editingImage === selectedImage.id ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Название карты
                        </label>
                        <input
                          type="text"
                          value={editForm.card_name}
                          onChange={(e) => setEditForm({ ...editForm, card_name: e.target.value })}
                          placeholder="Введите название карты"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Редкость
                        </label>
                        <select
                          value={editForm.card_rarity}
                          onChange={(e) => setEditForm({ ...editForm, card_rarity: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Выберите редкость</option>
                          <option value="common">Обычная</option>
                          <option value="uncommon">Необычная</option>
                          <option value="rare">Редкая</option>
                          <option value="very_rare">Очень редкая</option>
                          <option value="artifact">Артефакт</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                        >
                          <Check size={16} className="inline mr-2" />
                          Сохранить
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                        >
                          <XIcon size={16} className="inline mr-2" />
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {selectedImage.card_name || 'Без названия'}
                        </h3>
                        {selectedImage.card_rarity && (
                          <p className="text-sm text-gray-600 capitalize">
                            Редкость: {selectedImage.card_rarity}
                          </p>
                        )}
                        <p className="text-sm text-gray-500">
                          Добавлено: {new Date(selectedImage.created_at).toLocaleDateString('ru-RU')}
                        </p>
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSelectImage(selectedImage)}
                          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                        >
                          <Check size={16} className="inline mr-2" />
                          Выбрать
                        </button>
                        <button
                          onClick={() => handleStartEdit(selectedImage)}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                        >
                          <Edit3 size={16} className="inline mr-2" />
                          Редактировать
                        </button>
                        <button
                          onClick={() => handleDelete(selectedImage.id)}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                        >
                          <Trash2 size={16} className="inline mr-2" />
                          Удалить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <div className="text-lg font-medium mb-2">Выберите изображение</div>
                  <div className="text-sm">Кликните на изображение в списке слева для предпросмотра</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Пагинация */}
        {pagination.total > pagination.limit && (
          <div className="p-4 border-t bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Показано {images.length} из {pagination.total} изображений
              </div>
              {/* Индикатор загрузки при автоматической подгрузке */}
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 text-gray-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  Загрузка изображений...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageLibraryModal;
