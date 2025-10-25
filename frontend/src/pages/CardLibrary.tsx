import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Package, Users, User, Sword, Grid3X3, List } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import CardDetailModal from '../components/CardDetailModal';
import { getRarityColor } from '../utils/rarityColors';

const CardLibrary = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [propertiesFilter, setPropertiesFilter] = useState<string>('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<string>('cards'); // 'all', 'cards', 'mixed', 'templates'
  const [slotFilter, setSlotFilter] = useState<string>('');
  const [armorTypeFilter, setArmorTypeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('created_desc'); // 'rarity_asc', 'rarity_desc', 'price_asc', 'price_desc', 'created_asc', 'created_desc', 'updated_asc', 'updated_desc'
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

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
        limit: 50
      };
      
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      if (propertiesFilter) params.properties = propertiesFilter;
      if (slotFilter) params.slot = slotFilter;
      if (armorTypeFilter) params.armor_type = armorTypeFilter;
      if (sortBy) params.sort_by = sortBy;
      
      // Фильтр по типу шаблона
      switch (templateTypeFilter) {
        case 'cards':
          params.exclude_template_only = true;
          break;
        case 'templates':
          params.template_only = true;
          break;
        case 'mixed':
          // Показываем и карты, и шаблоны
          break;
        case 'all':
          // Показываем всё
          break;
      }
      
      const response = await cardsApi.getCards(params);
      
      if (append) {
        setCards(prev => [...prev, ...response.cards]);
      } else {
        setCards(response.cards);
      }
      
      setTotalCards(response.total);
      setCurrentPage(page);
      setHasMore(response.cards.length === 50 && cards.length + response.cards.length < response.total);
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
  }, [search, rarityFilter, propertiesFilter, templateTypeFilter, slotFilter, armorTypeFilter, sortBy]);

  // Автоматическая подгрузка при прокрутке
  useEffect(() => {
    const handleScroll = () => {
      // Проверяем, когда пользователь прокрутил до конца страницы (с запасом в 1000px)
      if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 1000) {
        if (hasMore && !loadingMore && !loading) {
          loadMoreCards();
        }
      }
    };

    // Добавляем обработчик прокрутки
    window.addEventListener('scroll', handleScroll);
    
    // Очищаем обработчик при размонтировании компонента
    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadingMore, loading, currentPage]);

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

  // Функция для получения цвета полоски редкости
  const getRarityBorderColor = (rarity: string): string => {
    switch (rarity?.toLowerCase()) {
      case 'common':
      case 'обычное':
        return 'border-l-gray-400'; // Серая полоска для обычных предметов
      case 'uncommon':
      case 'необычное':
        return 'border-l-green-500';
      case 'rare':
      case 'редкое':
        return 'border-l-blue-500';
      case 'very_rare':
      case 'очень редкое':
        return 'border-l-purple-500';
      case 'epic':
      case 'эпическое':
        return 'border-l-purple-500';
      case 'legendary':
      case 'легендарное':
        return 'border-l-orange-500';
      case 'artifact':
      case 'артефакт':
        return 'border-l-orange-500';
      default:
        return 'border-l-gray-400'; // По умолчанию серая
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Заголовок */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-fantasy font-bold text-gray-900">
          Библиотека карточек
        </h1>
        <Link
          to="/create"
          className="btn-primary flex items-center space-x-2 w-full sm:w-auto justify-center"
        >
          <Plus size={18} />
          <span>Создать карту</span>
        </Link>
      </div>

      {/* Быстрые действия */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Быстрые действия</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-4">
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
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          {/* Поиск */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-10 text-sm sm:text-base"
              />
            </div>
          </div>

          {/* Переключатель режимов отображения */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg border ${
                viewMode === 'grid' 
                  ? 'bg-blue-100 border-blue-300 text-blue-700' 
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title="Сетка"
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg border ${
                viewMode === 'list' 
                  ? 'bg-blue-100 border-blue-300 text-blue-700' 
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title="Список"
            >
              <List size={18} />
            </button>
          </div>

          {/* Кнопка фильтров */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center justify-center space-x-2 text-sm sm:text-base"
          >
            <Filter size={18} />
            <span>Фильтры</span>
          </button>
        </div>

        {/* Панель фильтров */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

            {/* Фильтр по типу шаблона */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип шаблона
              </label>
              <select
                value={templateTypeFilter}
                onChange={(e) => setTemplateTypeFilter(e.target.value)}
                className="input-field"
              >
                <option value="cards">Обычные карты</option>
                <option value="templates">Только шаблоны</option>
                <option value="mixed">Шаблоны и обычные</option>
                <option value="all">Все</option>
              </select>
            </div>

            {/* Фильтр по слоту экипировки */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Слот экипировки
              </label>
              <select
                value={slotFilter}
                onChange={(e) => setSlotFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все слоты</option>
                <option value="none">Не экипируется</option>
                <option value="head">Голова</option>
                <option value="body">Тело</option>
                <option value="arms">Наручи</option>
                <option value="feet">Обувь</option>
                <option value="cloak">Плащ</option>
                <option value="one_hand">Одна рука</option>
                <option value="versatile">Универсальное</option>
                <option value="two_hands">Две руки</option>
                <option value="necklace">Ожерелье</option>
                <option value="ring">Кольцо</option>
              </select>
            </div>

            {/* Фильтр по типу брони */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип брони
              </label>
              <select
                value={armorTypeFilter}
                onChange={(e) => setArmorTypeFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все типы</option>
                <option value="light">Лёгкая</option>
                <option value="medium">Средняя</option>
                <option value="heavy">Тяжелая</option>
                <option value="cloth">Ткань</option>
              </select>
            </div>

            {/* Сортировка */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Сортировка
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="input-field"
              >
                <option value="created_desc">По дате добавления (новые)</option>
                <option value="created_asc">По дате добавления (старые)</option>
                <option value="updated_desc">По дате изменения (новые)</option>
                <option value="updated_asc">По дате изменения (старые)</option>
                <option value="rarity_asc">По редкости (обычные)</option>
                <option value="rarity_desc">По редкости (артефакты)</option>
                <option value="price_asc">По стоимости (дешевые)</option>
                <option value="price_desc">По стоимости (дорогие)</option>
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
          
          {/* Отображение в зависимости от режима */}
          {viewMode === 'grid' ? (
            /* Сетка карт */
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
              {cards.map((card) => {
                const isExtended = Boolean(card.is_extended);
                return (
                  <div 
                    key={card.id} 
                    className={`relative group flex justify-center cursor-pointer ${isExtended ? 'col-span-2 sm:col-span-2' : ''}`}
                    onClick={() => handleCardClick(card)}
                  >
                    <div className="w-full max-w-[198px] mx-auto">
                      <CardPreview card={card} />
                    </div>
                  </div>
              );
              })}
            </div>
          ) : (
            /* Список названий */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="relative"
                    onMouseEnter={() => setHoveredCard(card)}
                    onMouseLeave={() => setHoveredCard(null)}
                    onMouseMove={(e) => {
                      setMousePosition({ x: e.clientX, y: e.clientY });
                    }}
                  >
                    <button
                      onClick={() => handleCardClick(card)}
                      className={`w-full text-left p-3 rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:shadow-md hover:bg-gray-50 border-l-4 ${getRarityBorderColor(card.rarity)}`}
                    >
                      <div className="flex items-center space-x-3">
                        {/* Маленькая картинка слева */}
                        <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                          {card.image_url && card.image_url.trim() !== '' ? (
                            <img
                              src={card.image_url}
                              alt={card.name}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = '/default_image.png';
                              }}
                            />
                          ) : (
                            <img
                              src="/default_image.png"
                              alt="Default D&D"
                              className="w-full h-full object-contain"
                            />
                          )}
                        </div>
                        
                        {/* Текст справа */}
                        <div className="flex-1 min-w-0">
                          <div className={`font-medium truncate ${getRarityColor(card.rarity)}`}>
                            {card.name}
                          </div>
                          
                          {/* Нижняя панель с весом, ценой, номером карты */}
                          <div className="flex items-center justify-between mt-1 text-xs">
                            <div className="flex items-center space-x-2">
                              {card.weight && (
                                <div className="flex items-center space-x-1">
                                  <span className="text-gray-900 font-medium">
                                    {card.weight}
                                  </span>
                                  <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                                </div>
                              )}
                              {card.price && (
                                <div className="flex items-center space-x-1">
                                  <span className="text-yellow-600 font-bold">
                                    {card.price >= 1000 ? `${(card.price / 1000).toFixed(1)}K` : card.price}
                                  </span>
                                  <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                                </div>
                              )}
                              {card.bonus_type && card.bonus_value && (
                                <div className="flex items-center space-x-0.5">
                                  <span className="text-gray-900 font-medium">
                                    {card.bonus_value.toLowerCase() === 'advantage' ? 'ADV' : card.bonus_value}
                                  </span>
                                  {card.bonus_type === 'damage' && card.damage_type && (
                                    <img src={`/icons/${card.damage_type}.png`} alt={card.damage_type} className="w-3 h-3" />
                                  )}
                                  {card.bonus_type === 'defense' && card.defense_type && (
                                    <img src="/icons/defense.png" alt="Защита" className="w-3 h-3" />
                                  )}
                                </div>
                              )}
                            </div>
                            <span className="text-gray-400 font-mono">
                              {card.card_number}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
              
              {/* Индикатор загрузки при автоматической подгрузке */}
              {loadingMore && (
                <div className="mt-4 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    Загрузка карт...
                  </div>
                </div>
              )}
              
              {/* Показ карточки при наведении */}
              {hoveredCard && (
                <div 
                  className="fixed z-50 pointer-events-none"
                  style={{
                    left: Math.min(mousePosition.x + 10, window.innerWidth - 220),
                    top: Math.max(mousePosition.y - 10, 10),
                    transform: mousePosition.y < 300 ? 'translateY(0)' : 'translateY(-100%)'
                  }}
                >
                  <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
                    <CardPreview card={hoveredCard} />
                  </div>
                </div>
              )}
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
