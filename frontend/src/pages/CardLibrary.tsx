import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Package, Users, User, Sword, Grid3X3, List } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cardsApi, effectsApi } from '../api/client';
import type { Card, PassiveEffect } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import EffectPreview from '../components/EffectPreview';
import CardDetailModal from '../components/CardDetailModal';
import EffectDetailModal from '../components/EffectDetailModal';
import { getRarityColor } from '../utils/rarityColors';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';

const CardLibrary = () => {
  const [contentType, setContentType] = useState<'cards' | 'effects'>('cards');
  const [cards, setCards] = useState<Card[]>([]);
  const [effects, setEffects] = useState<PassiveEffect[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [propertiesFilter, setPropertiesFilter] = useState<string>('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<string>('cards'); // 'all', 'cards', 'mixed', 'templates'

  // Функция для получения цвета номера карты в зависимости от наличия эффектов
  const getCardNumberColor = (card: Card) => {
    const hasEffects = card.effects && Array.isArray(card.effects) && card.effects.length > 0;
    return hasEffects ? 'text-gray-900' : 'text-gray-400';
  };
  const [slotFilter, setSlotFilter] = useState<string>('');
  const [armorTypeFilter, setArmorTypeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('created_desc'); // 'rarity_asc', 'rarity_desc', 'price_asc', 'price_desc', 'created_asc', 'created_desc', 'updated_asc', 'updated_desc'
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<PassiveEffect | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEffectModalOpen, setIsEffectModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Загрузка карточек
  const loadCards = async (page = 1, append = false) => {
    try {
      console.log(`📥 [CARD LIBRARY] Загружаем карты: страница ${page}, append: ${append}`);
      
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
        setCards(prev => {
          // Фильтруем дубликаты по ID
          const existingIds = new Set(prev.map(card => card.id));
          const newCards = response.cards.filter(card => !existingIds.has(card.id));
          const combinedCards = [...prev, ...newCards];
          
          console.log(`📊 [CARD LIBRARY] Добавляем карты: получено ${response.cards.length}, новых ${newCards.length}, всего ${combinedCards.length}`);
          
          setHasMore(response.cards.length === 50 && combinedCards.length < response.total);
          return combinedCards;
        });
      } else {
        setCards(response.cards);
        setHasMore(response.cards.length === 50 && response.cards.length < response.total);
        console.log(`📊 [CARD LIBRARY] Загружено карт: ${response.cards.length}, всего в базе: ${response.total}`);
      }
      
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Загрузка эффектов
  const loadEffects = async (page = 1, append = false) => {
    try {
      console.log(`📥 [CARD LIBRARY] Загружаем эффекты: страница ${page}, append: ${append}`);
      
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
      
      const response = await effectsApi.getEffects(params);
      
      if (append) {
        setEffects(prev => {
          // Фильтруем дубликаты по ID
          const existingIds = new Set(prev.map(effect => effect.id));
          const newEffects = response.effects.filter(effect => !existingIds.has(effect.id));
          const combinedEffects = [...prev, ...newEffects];
          
          console.log(`📊 [CARD LIBRARY] Добавляем эффекты: получено ${response.effects.length}, новых ${newEffects.length}, всего ${combinedEffects.length}`);
          
          setHasMore(response.effects.length === 50 && combinedEffects.length < response.total);
          return combinedEffects;
        });
      } else {
        setEffects(response.effects);
        setHasMore(response.effects.length === 50 && response.effects.length < response.total);
        console.log(`📊 [CARD LIBRARY] Загружено эффектов: ${response.effects.length}, всего в базе: ${response.total}`);
      }
      
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки эффектов');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setCards([]);
    setEffects([]);
    if (contentType === 'cards') {
      loadCards(1, false);
    } else {
      loadEffects(1, false);
    }
  }, [contentType, search, rarityFilter, propertiesFilter, templateTypeFilter, slotFilter, armorTypeFilter, sortBy]);

  // Автоматическая подгрузка при прокрутке
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    const handleScroll = () => {
      // Очищаем предыдущий таймер
      clearTimeout(timeoutId);
      
      // Устанавливаем новый таймер с задержкой 100ms
      timeoutId = setTimeout(() => {
        // Проверяем, когда пользователь прокрутил до конца страницы (с запасом в 1000px)
        if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 1000) {
          if (hasMore && !loadingMore && !loading) {
            loadMoreCards();
          }
        }
      }, 100);
    };

    // Добавляем обработчик прокрутки
    window.addEventListener('scroll', handleScroll);
    
    // Очищаем обработчик при размонтировании компонента
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [hasMore, loadingMore, loading, currentPage]);

  // Функция для загрузки следующей страницы
  const loadMoreCards = () => {
    if (!loadingMore && hasMore && !loading) {
      console.log(`🔄 [CARD LIBRARY] Загружаем страницу ${currentPage + 1}`);
      if (contentType === 'cards') {
        loadCards(currentPage + 1, true);
      } else {
        loadEffects(currentPage + 1, true);
      }
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

  // Обработчики для эффектов
  const handleEffectClick = (effect: PassiveEffect) => {
    setSelectedEffect(effect);
    setIsEffectModalOpen(true);
  };

  const handleCloseEffectModal = () => {
    setIsEffectModalOpen(false);
    setSelectedEffect(null);
  };

  const handleEditEffect = (effectId: string) => {
    setIsEffectModalOpen(false);
    window.location.href = `/effect-creator?edit=${effectId}`;
  };

  const handleDeleteEffect = async (effectId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот эффект?')) return;
    
    try {
      await effectsApi.deleteEffect(effectId);
      if (contentType === 'effects') {
        loadEffects(1, false);
      }
      setIsEffectModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления эффекта');
    }
  };

  // Получение типа эффекта для отображения
  const getEffectTypeLabel = (effectType: string) => {
    switch (effectType) {
      case 'passive':
        return 'Пассивное';
      case 'conditional':
        return 'Условное';
      case 'triggered':
        return 'Срабатывающее';
      default:
        return effectType;
    }
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

      {/* Поиск и фильтры */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          {/* Переключатель предметы/эффекты */}
          <div className="flex items-center space-x-2 border border-gray-300 rounded-lg p-1 bg-gray-50">
            <button
              onClick={() => setContentType('cards')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'cards'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Предметы
            </button>
            <button
              onClick={() => setContentType('effects')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'effects'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Эффекты
            </button>
          </div>

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

            {/* Фильтр по свойствам - только для карт */}
            {contentType === 'cards' && (
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
            )}

            {/* Фильтр по типу шаблона - только для карт */}
            {contentType === 'cards' && (
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
            )}

            {/* Фильтр по слоту экипировки - только для карт */}
            {contentType === 'cards' && (
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
            )}

            {/* Фильтр по типу брони - только для карт */}
            {contentType === 'cards' && (
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
            )}

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

      {/* Список карточек или эффектов */}
      {!loading && contentType === 'cards' && cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Карточки не найдены</p>
          <Link to="/create" className="btn-primary mt-4 inline-block">
            Создать первую карточку
          </Link>
        </div>
      )}

      {!loading && contentType === 'effects' && effects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Эффекты не найдены</p>
          <Link to="/effect-creator" className="btn-primary mt-4 inline-block">
            Создать первый эффект
          </Link>
        </div>
      )}

      {!loading && contentType === 'cards' && cards.length > 0 && (
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
                    className={`relative group flex justify-center cursor-pointer ${isExtended ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
                    onClick={() => handleCardClick(card)}
                  >
                    {isExtended ? (
                      <CardPreview card={card} />
                    ) : (
                      <div className="w-full max-w-[198px]">
                        <CardPreview card={card} />
                      </div>
                    )}
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
                          <div className={`font-medium truncate ${getRarityColor(card.rarity)} flex items-center gap-1`}>
                            <span 
                              className="text-lg" 
                              title={getRaritySymbolDescription(card.rarity)}
                              aria-label={getRaritySymbolDescription(card.rarity)}
                            >
                              {getRaritySymbol(card.rarity)}
                            </span>
                            <span>{card.name}</span>
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
                            <span className={`font-mono ${getCardNumberColor(card)}`}>
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

      {/* Отображение эффектов */}
      {!loading && contentType === 'effects' && effects.length > 0 && (
        <>
          {/* Счетчик эффектов */}
          <div className="mb-4 text-sm text-gray-600">
            Показано: {effects.length} из {totalCards} эффектов
          </div>
          
          {/* Отображение в зависимости от режима */}
          {viewMode === 'grid' ? (
            /* Сетка эффектов */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {effects.map((effect) => (
                <div key={effect.id} className="flex justify-center">
                  <EffectPreview effect={effect} onClick={() => handleEffectClick(effect)} />
                </div>
              ))}
            </div>
          ) : (
            /* Список эффектов */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {effects.map((effect) => (
                  <button
                    key={effect.id}
                    onClick={() => handleEffectClick(effect)}
                    className="w-full text-left p-3 rounded-lg border-2 border-black bg-slate-800 text-white transition-all duration-200 hover:shadow-md hover:bg-slate-700"
                  >
                    <div className="flex items-center space-x-3">
                      {/* Маленькая картинка слева */}
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        {effect.image_url && effect.image_url.trim() !== '' ? (
                          <img
                            src={effect.image_url}
                            alt={effect.name}
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
                            className="w-full h-full object-contain opacity-50"
                          />
                        )}
                      </div>
                      
                      {/* Текст справа */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-white">
                          {effect.name}
                        </div>
                        
                        {/* Нижняя панель с типом эффекта */}
                        <div className="flex items-center mt-1 text-xs">
                          <div className="text-gray-300">
                            {getEffectTypeLabel(effect.effect_type)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              
              {/* Индикатор загрузки при автоматической подгрузке */}
              {loadingMore && (
                <div className="mt-4 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    Загрузка эффектов...
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Модальное окно с детальной информацией о карте */}
      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onEdit={handleEditCard}
        onDelete={handleDeleteCard}
      />

      {/* Модальное окно с детальной информацией об эффекте */}
      <EffectDetailModal
        effect={selectedEffect}
        isOpen={isEffectModalOpen}
        onClose={handleCloseEffectModal}
        onEdit={handleEditEffect}
        onDelete={handleDeleteEffect}
      />
    </div>
  );
};

export default CardLibrary;
