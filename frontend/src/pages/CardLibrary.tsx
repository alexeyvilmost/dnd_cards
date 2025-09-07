import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Package, Users, User, Sword } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import CardDetailModal from '../components/CardDetailModal';

const CardLibrary = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [propertiesFilter, setPropertiesFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Загрузка карточек
  const loadCards = async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      
      const params: any = {
        page,
        limit: 20
      };
      
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      if (propertiesFilter) params.properties = propertiesFilter;
      
      const response = await cardsApi.getCards(params);
      
      if (append) {
        setCards(prev => [...prev, ...response.cards]);
      } else {
        setCards(response.cards);
      }
      
      setTotalCards(response.total);
      setCurrentPage(page);
      setHasMore(response.cards.length === 20 && cards.length + response.cards.length < response.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setCards([]);
    loadCards(1, false);
  }, [search, rarityFilter, propertiesFilter]);

  // Функция для загрузки следующей страницы
  const loadMoreCards = () => {
    if (!loadingMore && hasMore) {
      loadCards(currentPage + 1, true);
    }
  };

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
      setIsModalOpen(false); // Закрываем модальное окно
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления карточки');
    }
  };

  // Открытие модального окна
  const handleCardClick = (card: Card) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  // Закрытие модального окна
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCard(null);
  };

  // Редактирование карточки
  const handleEditCard = (cardId: string) => {
    setIsModalOpen(false);
    // Здесь можно добавить навигацию к редактированию
    window.location.href = `/edit/${cardId}`;
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

      {/* Быстрые действия */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Быстрые действия</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Link
            to="/inventory"
            className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <Package className="h-8 w-8 text-blue-600 group-hover:text-blue-700 mb-2" />
            <span className="text-sm font-medium text-gray-900">Инвентарь</span>
            <span className="text-xs text-gray-500 text-center">Управление предметами</span>
          </Link>
          
          <Link
            to="/groups"
            className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors group"
          >
            <Users className="h-8 w-8 text-green-600 group-hover:text-green-700 mb-2" />
            <span className="text-sm font-medium text-gray-900">Группы</span>
            <span className="text-xs text-gray-500 text-center">Игровые группы</span>
          </Link>
          
          <Link
            to="/templates"
            className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors group"
          >
            <Sword className="h-8 w-8 text-purple-600 group-hover:text-purple-700 mb-2" />
            <span className="text-sm font-medium text-gray-900">Шаблоны</span>
            <span className="text-xs text-gray-500 text-center">Оружие и предметы</span>
          </Link>
          
          <Link
            to="/export"
            className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors group"
          >
            <svg className="h-8 w-8 text-orange-600 group-hover:text-orange-700 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-gray-900">Экспорт</span>
            <span className="text-xs text-gray-500 text-center">Скачать карточки</span>
          </Link>
          
          <Link
            to="/inventory/create"
            className="flex flex-col items-center p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
          >
            <Plus className="h-8 w-8 text-indigo-600 group-hover:text-indigo-700 mb-2" />
            <span className="text-sm font-medium text-gray-900">Создать инвентарь</span>
            <span className="text-xs text-gray-500 text-center">Новый инвентарь</span>
          </Link>
        </div>
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
        <>
          {/* Счетчик карт */}
          <div className="mb-4 text-sm text-gray-600">
            Показано: {cards.length} из {totalCards} карт
          </div>
          
          {/* Сетка карт */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
            {cards.map((card) => {
              const isExtended = Boolean(card.is_extended);
              return (
                <div 
                  key={card.id} 
                  className={`relative group flex justify-center cursor-pointer ${isExtended ? 'sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
                  onClick={() => handleCardClick(card)}
                >
                  <CardPreview card={card} />
                </div>
            );
            })}
          </div>
          
          {/* Кнопка "Загрузить еще" */}
          {hasMore && (
            <div className="mt-8 text-center">
              <button
                onClick={loadMoreCards}
                disabled={loadingMore}
                className="btn-primary px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Загрузка...
                  </div>
                ) : (
                  'Загрузить еще'
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Модальное окно с детальной информацией */}
      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onEdit={handleEditCard}
        onDelete={handleDeleteCard}
      />
    </div>
  );
};

export default CardLibrary;
