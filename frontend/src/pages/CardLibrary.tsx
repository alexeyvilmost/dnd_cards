import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Image as ImageIcon, Edit, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';

const CardLibrary = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [propertiesFilter, setPropertiesFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Загрузка карточек
  const loadCards = async () => {
    try {
      setLoading(true);
      const params: any = {};
      
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      if (propertiesFilter) params.properties = propertiesFilter;
      
      const response = await cardsApi.getCards(params);
      setCards(response.cards);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCards();
  }, [search, rarityFilter, propertiesFilter]);

  // Генерация изображения
  const handleGenerateImage = async (cardId: string) => {
    try {
      await cardsApi.generateImage({ card_id: cardId });
      loadCards(); // Перезагружаем карточки для обновления изображения
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка генерации изображения');
    }
  };

  // Удаление карточки
  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту карточку?')) return;
    
    try {
      await cardsApi.deleteCard(cardId);
      loadCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления карточки');
    }
  };

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-fantasy font-bold text-gray-900">
          Библиотека карточек
        </h1>
        <Link
          to="/create"
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={18} />
          <span>Создать карту</span>
        </Link>
      </div>

      {/* Поиск и фильтры */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Поиск */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск по названию..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-10"
              />
            </div>
          </div>

          {/* Кнопка фильтров */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center space-x-2"
          >
            <Filter size={18} />
            <span>Фильтры</span>
          </button>
        </div>

        {/* Панель фильтров */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Фильтр по редкости */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Редкость
              </label>
              <select
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все редкости</option>
                {RARITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Фильтр по свойствам */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Свойства
              </label>
              <select
                value={propertiesFilter}
                onChange={(e) => setPropertiesFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все свойства</option>
                {PROPERTIES_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Сообщение об ошибке */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Загрузка */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Список карточек */}
      {!loading && cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Карточки не найдены</p>
          <Link to="/create" className="btn-primary mt-4 inline-block">
            Создать первую карточку
          </Link>
        </div>
      )}

      {!loading && cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {cards.map((card) => {
            const isExtended = card.description && card.description.length > 100;
            return (
              <div 
                key={card.id} 
                className={`relative group flex justify-center ${isExtended ? 'sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
              >
                <CardPreview card={card} />
              
              {/* Действия */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div className="flex space-x-1">
                  <button
                    onClick={() => handleGenerateImage(card.id)}
                    className="bg-blue-600 hover:bg-blue-700 text-white p-1 rounded"
                    title="Сгенерировать изображение"
                  >
                    <ImageIcon size={14} />
                  </button>
                  <Link
                    to={`/edit/${card.id}`}
                    className="bg-gray-600 hover:bg-gray-700 text-white p-1 rounded"
                    title="Редактировать"
                  >
                    <Edit size={14} />
                  </Link>
                  <button
                    onClick={() => handleDeleteCard(card.id)}
                    className="bg-red-600 hover:bg-red-700 text-white p-1 rounded"
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
};

export default CardLibrary;
