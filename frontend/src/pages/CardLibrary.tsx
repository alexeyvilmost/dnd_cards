import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Filter, Plus, Package, Users, User, Sword, Grid3X3, List } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { cardsApi, effectsApi, actionsApi, spellsApi, featsApi, backgroundsApi } from '../api/client';
import type { Card, PassiveEffect, Action, Spell, Feat, Background } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS, ACTION_RESOURCE_OPTIONS, getSpellLevelLabel, SPELL_SCHOOL_OPTIONS, SPELL_CLASS_OPTIONS, FEAT_CATEGORY_OPTIONS, ABILITY_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import EffectPreview from '../components/EffectPreview';
import ActionPreview from '../components/ActionPreview';
import SpellPreview from '../components/SpellPreview';
import FeatPreview from '../components/FeatPreview';
import BackgroundPreview from '../components/BackgroundPreview';
import CardDetailModal from '../components/CardDetailModal';
import EffectDetailModal from '../components/EffectDetailModal';
import ActionDetailModal from '../components/ActionDetailModal';
import SpellDetailModal from '../components/SpellDetailModal';
import FeatDetailModal from '../components/FeatDetailModal';
import BackgroundDetailModal from '../components/BackgroundDetailModal';
import { getRarityColor } from '../utils/rarityColors';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import ElementalDamageDisplay from '../components/ElementalDamageDisplay';
import CurrencyPriceInline from '../components/CurrencyPriceInline';
import { hasElementalDamage } from '../utils/elementalDamage';
import {
  buildLibrarySearchParams,
  parseLibrarySearchParams,
} from '../utils/libraryUrlParams';

const CardLibrary = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = useMemo(() => parseLibrarySearchParams(searchParams), []);
  const urlInitialized = useRef(false);
  const skipFilterUrlSync = useRef(false);
  const openingCardFromUrl = useRef(false);

  const [contentType, setContentType] = useState<'cards' | 'effects' | 'actions' | 'spells' | 'feats' | 'backgrounds'>(initialFilters.contentType);
  const [cards, setCards] = useState<Card[]>([]);
  const [effects, setEffects] = useState<PassiveEffect[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialFilters.search);
  const [rarityFilter, setRarityFilter] = useState<string>(initialFilters.rarity);
  const [propertiesFilter, setPropertiesFilter] = useState<string>(initialFilters.properties);
  const [templateTypeFilter, setTemplateTypeFilter] = useState<string>(initialFilters.templateType);

  // Функция для получения цвета номера карты в зависимости от наличия эффектов
  const getCardNumberColor = (card: Card) => {
    const hasEffects = card.effects && Array.isArray(card.effects) && card.effects.length > 0;
    return hasEffects ? 'text-gray-900' : 'text-gray-400';
  };
  const [slotFilter, setSlotFilter] = useState<string>(initialFilters.slot);
  const [armorTypeFilter, setArmorTypeFilter] = useState<string>(initialFilters.armorType);
  const [sortBy, setSortBy] = useState<string>(initialFilters.sortBy);
  // Фильтры заклинаний
  const [spellLevel, setSpellLevel] = useState<string>('');
  const [spellClass, setSpellClass] = useState<string>('');
  const [spellSubclass, setSpellSubclass] = useState<string>('');
  const [spellSchool, setSpellSchool] = useState<string>('');
  const [spellConcentration, setSpellConcentration] = useState<string>('');
  const [spellRitual, setSpellRitual] = useState<string>('');
  // Фильтры черт
  const [featCategory, setFeatCategory] = useState<string>('');
  const [featRepeatable, setFeatRepeatable] = useState<string>('');
  const [featAbility, setFeatAbility] = useState<string>('');
  // Фильтры предысторий
  const [bgAbility, setBgAbility] = useState<string>('');
  const [bgSkill, setBgSkill] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<PassiveEffect | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [selectedFeat, setSelectedFeat] = useState<Feat | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<Background | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEffectModalOpen, setIsEffectModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [isSpellModalOpen, setIsSpellModalOpen] = useState(false);
  const [isFeatModalOpen, setIsFeatModalOpen] = useState(false);
  const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialFilters.viewMode);
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [hoveredSpell, setHoveredSpell] = useState<Spell | null>(null);
  const [hoveredFeat, setHoveredFeat] = useState<Feat | null>(null);
  const [hoveredBackground, setHoveredBackground] = useState<Background | null>(null);
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

  // Загрузка действий
  const loadActions = async (page = 1, append = false) => {
    try {
      console.log(`📥 [CARD LIBRARY] Загружаем действия: страница ${page}, append: ${append}`);
      
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
      
      const response = await actionsApi.getActions(params);
      
      if (append) {
        setActions(prev => {
          // Фильтруем дубликаты по ID
          const existingIds = new Set(prev.map(action => action.id));
          const newActions = response.actions.filter(action => !existingIds.has(action.id));
          const combinedActions = [...prev, ...newActions];
          
          console.log(`📊 [CARD LIBRARY] Добавляем действия: получено ${response.actions.length}, новых ${newActions.length}, всего ${combinedActions.length}`);
          
          setHasMore(response.actions.length === 50 && combinedActions.length < response.total);
          return combinedActions;
        });
      } else {
        setActions(response.actions);
        setHasMore(response.actions.length === 50 && response.actions.length < response.total);
        console.log(`📊 [CARD LIBRARY] Загружено действий: ${response.actions.length}, всего в базе: ${response.total}`);
      }
      
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки действий');
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

  // Загрузка заклинаний
  const loadSpells = async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const params: any = { page, limit: 50 };
      if (search) params.search = search;
      if (spellLevel !== '') params.level = Number(spellLevel);
      if (spellClass) params.class = spellClass;
      if (spellSubclass) params.subclass = spellSubclass;
      if (spellSchool) params.school = spellSchool;
      if (spellConcentration) params.concentration = spellConcentration;
      if (spellRitual) params.ritual = spellRitual;

      const response = await spellsApi.getSpells(params);

      if (append) {
        setSpells(prev => {
          const existingIds = new Set(prev.map(spell => spell.id));
          const newSpells = response.spells.filter(spell => !existingIds.has(spell.id));
          const combinedSpells = [...prev, ...newSpells];
          setHasMore(response.spells.length === 50 && combinedSpells.length < response.total);
          return combinedSpells;
        });
      } else {
        setSpells(response.spells);
        setHasMore(response.spells.length === 50 && response.spells.length < response.total);
      }

      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки заклинаний');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Загрузка черт
  const loadFeats = async (page = 1, append = false) => {
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (search) params.search = search;
      if (featCategory) params.category = featCategory;
      if (featRepeatable) params.repeatable = featRepeatable;
      if (featAbility) params.ability = featAbility;
      const response = await featsApi.getFeats(params);
      if (append) {
        setFeats(prev => {
          const existing = new Set(prev.map(f => f.id));
          const combined = [...prev, ...response.feats.filter(f => !existing.has(f.id))];
          setHasMore(response.feats.length === 50 && combined.length < response.total);
          return combined;
        });
      } else {
        setFeats(response.feats);
        setHasMore(response.feats.length === 50 && response.feats.length < response.total);
      }
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки черт');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Загрузка предысторий
  const loadBackgrounds = async (page = 1, append = false) => {
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (search) params.search = search;
      if (bgAbility) params.ability = bgAbility;
      if (bgSkill) params.skill = bgSkill;
      const response = await backgroundsApi.getBackgrounds(params);
      if (append) {
        setBackgrounds(prev => {
          const existing = new Set(prev.map(b => b.id));
          const combined = [...prev, ...response.backgrounds.filter(b => !existing.has(b.id))];
          setHasMore(response.backgrounds.length === 50 && combined.length < response.total);
          return combined;
        });
      } else {
        setBackgrounds(response.backgrounds);
        setHasMore(response.backgrounds.length === 50 && response.backgrounds.length < response.total);
      }
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки предысторий');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setCards([]);
    setEffects([]);
    setActions([]);
    setSpells([]);
    setFeats([]);
    setBackgrounds([]);
    if (contentType === 'cards') {
      loadCards(1, false);
    } else if (contentType === 'effects') {
      loadEffects(1, false);
    } else if (contentType === 'actions') {
      loadActions(1, false);
    } else if (contentType === 'spells') {
      loadSpells(1, false);
    } else if (contentType === 'feats') {
      loadFeats(1, false);
    } else if (contentType === 'backgrounds') {
      loadBackgrounds(1, false);
    }
  }, [contentType, search, rarityFilter, propertiesFilter, templateTypeFilter, slotFilter, armorTypeFilter, sortBy, spellLevel, spellClass, spellSubclass, spellSchool, spellConcentration, spellRitual, featCategory, featRepeatable, featAbility, bgAbility, bgSkill]);

  const currentFilters = useMemo(
    () => ({
      contentType,
      search,
      rarity: rarityFilter,
      properties: propertiesFilter,
      templateType: templateTypeFilter,
      slot: slotFilter,
      armorType: armorTypeFilter,
      sortBy,
      viewMode,
    }),
    [
      contentType,
      search,
      rarityFilter,
      propertiesFilter,
      templateTypeFilter,
      slotFilter,
      armorTypeFilter,
      sortBy,
      viewMode,
    ]
  );

  const lastWrittenParamsRef = useRef(searchParams.toString());

  // Синхронизация фильтров → URL (можно скопировать ссылку и вернуться к тому же набору)
  useEffect(() => {
    if (!urlInitialized.current) {
      urlInitialized.current = true;
      lastWrittenParamsRef.current = searchParams.toString();
      return;
    }
    if (skipFilterUrlSync.current) {
      skipFilterUrlSync.current = false;
      return;
    }

    const built = buildLibrarySearchParams(currentFilters, searchParams);
    const cardId = searchParams.get('card');
    if (cardId) {
      built.set('card', cardId);
    }

    const nextStr = built.toString();
    if (nextStr !== searchParams.toString()) {
      lastWrittenParamsRef.current = nextStr;
      setSearchParams(built, { replace: true });
    }
  }, [currentFilters, searchParams, setSearchParams]);

  // Синхронизация URL → фильтры (кнопка «Назад» / прямой переход по ссылке)
  useEffect(() => {
    if (!urlInitialized.current) return;

    const currentStr = searchParams.toString();
    if (currentStr === lastWrittenParamsRef.current) return;

    const parsed = parseLibrarySearchParams(searchParams);
    skipFilterUrlSync.current = true;
    setContentType(parsed.contentType);
    setSearch(parsed.search);
    setRarityFilter(parsed.rarity);
    setPropertiesFilter(parsed.properties);
    setTemplateTypeFilter(parsed.templateType);
    setSlotFilter(parsed.slot);
    setArmorTypeFilter(parsed.armorType);
    setSortBy(parsed.sortBy);
    setViewMode(parsed.viewMode);
    lastWrittenParamsRef.current = currentStr;
  }, [searchParams]);

  // Открытие / закрытие карты по параметру ?card=
  useEffect(() => {
    const cardId = searchParams.get('card');

    if (!cardId) {
      if (isModalOpen) {
        setIsModalOpen(false);
        setSelectedCard(null);
      }
      return;
    }

    if (selectedCard?.id === cardId && isModalOpen) {
      return;
    }

    const found = cards.find((c) => c.id === cardId);
    if (found) {
      setSelectedCard(found);
      setIsModalOpen(true);
      return;
    }

    if (openingCardFromUrl.current) {
      return;
    }

    openingCardFromUrl.current = true;
    cardsApi
      .getCard(cardId)
      .then((card) => {
        setSelectedCard(card);
        setIsModalOpen(true);
      })
      .catch(() => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('card');
          return next;
        }, { replace: true });
      })
      .finally(() => {
        openingCardFromUrl.current = false;
      });
  }, [searchParams, cards, selectedCard?.id, setSearchParams]);

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
      } else if (contentType === 'effects') {
        loadEffects(currentPage + 1, true);
      } else if (contentType === 'actions') {
        loadActions(currentPage + 1, true);
      } else if (contentType === 'spells') {
        loadSpells(currentPage + 1, true);
      } else if (contentType === 'feats') {
        loadFeats(currentPage + 1, true);
      } else if (contentType === 'backgrounds') {
        loadBackgrounds(currentPage + 1, true);
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
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('card', card.id);
      lastWrittenParamsRef.current = next.toString();
      return next;
    }, { replace: false });
  };

  // Закрытие модального окна
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCard(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('card');
      lastWrittenParamsRef.current = next.toString();
      return next;
    }, { replace: true });
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

  // Обработчики для действий
  const handleActionClick = (action: Action) => {
    setSelectedAction(action);
    setIsActionModalOpen(true);
  };

  const handleCloseActionModal = () => {
    setIsActionModalOpen(false);
    setSelectedAction(null);
  };

  const handleEditAction = (actionId: string) => {
    setIsActionModalOpen(false);
    window.location.href = `/action-creator?edit=${actionId}`;
  };

  const handleDeleteAction = async (actionId: string) => {
    if (!confirm('Вы уверены, что хотите удалить это действие?')) return;
    
    try {
      await actionsApi.deleteAction(actionId);
      if (contentType === 'actions') {
        loadActions(1, false);
      }
      setIsActionModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления действия');
    }
  };

  // Обработчики для заклинаний
  const handleSpellClick = (spell: Spell) => {
    setSelectedSpell(spell);
    setIsSpellModalOpen(true);
  };

  const handleCloseSpellModal = () => {
    setIsSpellModalOpen(false);
    setSelectedSpell(null);
  };

  // Обработчики для черт
  const handleFeatClick = (feat: Feat) => {
    setSelectedFeat(feat);
    setIsFeatModalOpen(true);
  };
  const handleDeleteFeat = async (featId: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту черту?')) return;
    try {
      await featsApi.deleteFeat(featId);
      if (contentType === 'feats') loadFeats(1, false);
      setIsFeatModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления черты');
    }
  };

  // Обработчики для предысторий
  const handleBackgroundClick = (bg: Background) => {
    setSelectedBackground(bg);
    setIsBackgroundModalOpen(true);
  };
  const handleDeleteBackground = async (bgId: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту предысторию?')) return;
    try {
      await backgroundsApi.deleteBackground(bgId);
      if (contentType === 'backgrounds') loadBackgrounds(1, false);
      setIsBackgroundModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления предыстории');
    }
  };

  const handleDeleteSpell = async (spellId: string) => {
    if (!confirm('Вы уверены, что хотите удалить это заклинание?')) return;

    try {
      await spellsApi.deleteSpell(spellId);
      if (contentType === 'spells') {
        loadSpells(1, false);
      }
      setIsSpellModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления заклинания');
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

  // Получение метки ресурса действия для отображения
  const getActionResourceLabel = (resource: string) => {
    const option = ACTION_RESOURCE_OPTIONS.find(opt => opt.value === resource);
    return option?.label || resource;
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
      case 'relic':
      case 'реликвия':
        return 'border-l-red-500';
      case 'custom':
      case 'кастомная':
        return 'border-l-gray-500';
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
          {/* Переключатель предметы/эффекты/действия */}
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
            <button
              onClick={() => setContentType('actions')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'actions'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Действия
            </button>
            <button
              onClick={() => setContentType('spells')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'spells'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Заклинания
            </button>
            <button
              onClick={() => setContentType('feats')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'feats'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Черты
            </button>
            <button
              onClick={() => setContentType('backgrounds')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                contentType === 'backgrounds'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Предыстории
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
            {/* Фильтр по редкости - не для заклинаний */}
            {contentType !== 'spells' && (
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
            )}

            {/* ── Фильтры заклинаний ── */}
            {contentType === 'spells' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Уровень</label>
                  <select value={spellLevel} onChange={(e) => setSpellLevel(e.target.value)} className="input-field">
                    <option value="">Все уровни</option>
                    <option value="0">Заговор</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((lvl) => (
                      <option key={lvl} value={String(lvl)}>{lvl} уровень</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Класс</label>
                  <select value={spellClass} onChange={(e) => setSpellClass(e.target.value)} className="input-field">
                    <option value="">Все классы</option>
                    {SPELL_CLASS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Подкласс</label>
                  <input
                    type="text"
                    value={spellSubclass}
                    onChange={(e) => setSpellSubclass(e.target.value)}
                    placeholder="Например: Магия войны"
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Школа</label>
                  <select value={spellSchool} onChange={(e) => setSpellSchool(e.target.value)} className="input-field">
                    <option value="">Все школы</option>
                    {SPELL_SCHOOL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Концентрация</label>
                  <select value={spellConcentration} onChange={(e) => setSpellConcentration(e.target.value)} className="input-field">
                    <option value="">Не важно</option>
                    <option value="true">Да</option>
                    <option value="false">Нет</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ритуал</label>
                  <select value={spellRitual} onChange={(e) => setSpellRitual(e.target.value)} className="input-field">
                    <option value="">Не важно</option>
                    <option value="true">Да</option>
                    <option value="false">Нет</option>
                  </select>
                </div>
              </>
            )}

            {contentType === 'feats' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Категория</label>
                  <select value={featCategory} onChange={(e) => setFeatCategory(e.target.value)} className="input-field">
                    <option value="">Все категории</option>
                    {FEAT_CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Повышает характеристику</label>
                  <select value={featAbility} onChange={(e) => setFeatAbility(e.target.value)} className="input-field">
                    <option value="">Не важно</option>
                    {ABILITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Повторяемая</label>
                  <select value={featRepeatable} onChange={(e) => setFeatRepeatable(e.target.value)} className="input-field">
                    <option value="">Не важно</option>
                    <option value="true">Да</option>
                    <option value="false">Нет</option>
                  </select>
                </div>
              </>
            )}

            {contentType === 'backgrounds' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Характеристика</label>
                  <select value={bgAbility} onChange={(e) => setBgAbility(e.target.value)} className="input-field">
                    <option value="">Не важно</option>
                    {ABILITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Навык</label>
                  <input
                    type="text"
                    value={bgSkill}
                    onChange={(e) => setBgSkill(e.target.value)}
                    placeholder="Например: Скрытность"
                    className="input-field"
                  />
                </div>
              </>
            )}

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

      {!loading && contentType === 'actions' && actions.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Действия не найдены</p>
          <Link to="/action-creator" className="btn-primary mt-4 inline-block">
            Создать первое действие
          </Link>
        </div>
      )}

      {!loading && contentType === 'spells' && spells.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Заклинания не найдены</p>
          <Link to="/spell-creator" className="btn-primary mt-4 inline-block">
            Создать первое заклинание
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
                                  <CurrencyPriceInline
                                    price={card.price}
                                    currency={card.price_currency}
                                    abbreviate={card.price_abbreviated}
                                  />
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
                                  {card.bonus_type === 'damage' &&
                                    hasElementalDamage(card) &&
                                    card.elemental_damage_value &&
                                    card.elemental_damage_type && (
                                      <ElementalDamageDisplay
                                        value={card.elemental_damage_value}
                                        type={card.elemental_damage_type}
                                        iconSize={12}
                                        fontStyle={{ fontSize: '12px', fontWeight: 500 }}
                                      />
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

      {/* Отображение действий */}
      {!loading && contentType === 'actions' && actions.length > 0 && (
        <>
          {/* Счетчик действий */}
          <div className="mb-4 text-sm text-gray-600">
            Показано: {actions.length} из {totalCards} действий
          </div>
          
          {/* Отображение в зависимости от режима */}
          {viewMode === 'grid' ? (
            /* Сетка действий */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {actions.map((action) => (
                <div key={action.id} className="flex justify-center">
                  <ActionPreview action={action} onClick={() => handleActionClick(action)} />
                </div>
              ))}
            </div>
          ) : (
            /* Список действий */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleActionClick(action)}
                    className="w-full text-left p-3 rounded-lg border-2 border-black bg-amber-900 text-white transition-all duration-200 hover:shadow-md hover:bg-amber-800"
                  >
                    <div className="flex items-center space-x-3">
                      {/* Маленькая картинка слева */}
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        {action.image_url && action.image_url.trim() !== '' ? (
                          <img
                            src={action.image_url}
                            alt={action.name}
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
                          {action.name}
                        </div>
                        
                        {/* Нижняя панель с ресурсом действия */}
                        <div className="flex items-center mt-1 text-xs">
                          <div className="text-amber-200">
                            {getActionResourceLabel(action.resource)}
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
                    Загрузка действий...
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Отображение заклинаний */}
      {!loading && contentType === 'spells' && spells.length > 0 && (
        <>
          {/* Счетчик заклинаний */}
          <div className="mb-4 text-sm text-gray-600">
            Показано: {spells.length} из {totalCards} заклинаний
          </div>

          {viewMode === 'grid' ? (
            /* Сетка заклинаний */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {spells.map((spell) => (
                <div key={spell.id} className="flex justify-center">
                  <SpellPreview spell={spell} onClick={() => handleSpellClick(spell)} />
                </div>
              ))}
            </div>
          ) : (
            /* Список заклинаний */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {spells.map((spell) => (
                  <button
                    key={spell.id}
                    onClick={() => handleSpellClick(spell)}
                    onMouseEnter={() => setHoveredSpell(spell)}
                    onMouseLeave={() => setHoveredSpell(null)}
                    onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img
                          src={spell.image_url && spell.image_url.trim() !== '' ? spell.image_url : '/default_image.png'}
                          alt={spell.name}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/default_image.png';
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>
                          {spell.name}
                        </div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">
                          {getSpellLevelLabel(spell.level)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {loadingMore && (
                <div className="mt-4 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    Загрузка заклинаний...
                  </div>
                </div>
              )}

              {/* Детальная карточка при наведении (как в design_preview) */}
              {hoveredSpell && (
                <div
                  className="fixed z-50 pointer-events-none"
                  style={{
                    left: Math.min(mousePosition.x + 16, window.innerWidth - 360),
                    top: Math.min(Math.max(mousePosition.y - 40, 10), window.innerHeight - 20),
                    transform: mousePosition.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
                  }}
                >
                  <SpellPreview spell={hoveredSpell} disableHover={true} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Черты ── */}
      {!loading && contentType === 'feats' && feats.length === 0 && (
        <div className="text-center py-12 text-gray-500">Черты не найдены</div>
      )}
      {!loading && contentType === 'feats' && feats.length > 0 && (
        <>
          <div className="mb-4 text-sm text-gray-600">Показано: {feats.length} из {totalCards} черт</div>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {feats.map((feat) => (
                <div key={feat.id} className="flex justify-center">
                  <FeatPreview feat={feat} onClick={() => handleFeatClick(feat)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {feats.map((feat) => (
                  <button
                    key={feat.id}
                    onClick={() => handleFeatClick(feat)}
                    onMouseEnter={() => setHoveredFeat(feat)}
                    onMouseLeave={() => setHoveredFeat(null)}
                    onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img src={feat.image_url && feat.image_url.trim() !== '' ? feat.image_url : '/default_image.png'} alt={feat.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{feat.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">{FEAT_CATEGORY_OPTIONS.find(o => o.value === feat.category)?.label || feat.category}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {hoveredFeat && (
                <div className="fixed z-50 pointer-events-none" style={{ left: Math.min(mousePosition.x + 16, window.innerWidth - 360), top: Math.min(Math.max(mousePosition.y - 40, 10), window.innerHeight - 20), transform: mousePosition.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)' }}>
                  <FeatPreview feat={hoveredFeat} disableHover={true} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Предыстории ── */}
      {!loading && contentType === 'backgrounds' && backgrounds.length === 0 && (
        <div className="text-center py-12 text-gray-500">Предыстории не найдены</div>
      )}
      {!loading && contentType === 'backgrounds' && backgrounds.length > 0 && (
        <>
          <div className="mb-4 text-sm text-gray-600">Показано: {backgrounds.length} из {totalCards} предысторий</div>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {backgrounds.map((bg) => (
                <div key={bg.id} className="flex justify-center">
                  <BackgroundPreview background={bg} onClick={() => handleBackgroundClick(bg)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {backgrounds.map((bg) => (
                  <button
                    key={bg.id}
                    onClick={() => handleBackgroundClick(bg)}
                    onMouseEnter={() => setHoveredBackground(bg)}
                    onMouseLeave={() => setHoveredBackground(null)}
                    onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img src={bg.image_url && bg.image_url.trim() !== '' ? bg.image_url : '/default_image.png'} alt={bg.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{bg.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">Предыстория</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {hoveredBackground && (
                <div className="fixed z-50 pointer-events-none" style={{ left: Math.min(mousePosition.x + 16, window.innerWidth - 360), top: Math.min(Math.max(mousePosition.y - 40, 10), window.innerHeight - 20), transform: mousePosition.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)' }}>
                  <BackgroundPreview background={hoveredBackground} disableHover={true} />
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

      {/* Модальное окно с детальной информацией о действии */}
      <ActionDetailModal
        action={selectedAction}
        isOpen={isActionModalOpen}
        onClose={handleCloseActionModal}
        onEdit={handleEditAction}
        onDelete={handleDeleteAction}
      />

      {/* Модальное окно с детальной информацией о заклинании */}
      <SpellDetailModal
        spell={selectedSpell}
        isOpen={isSpellModalOpen}
        onClose={handleCloseSpellModal}
        onDelete={handleDeleteSpell}
      />

      <FeatDetailModal
        feat={selectedFeat}
        isOpen={isFeatModalOpen}
        onClose={() => { setIsFeatModalOpen(false); setSelectedFeat(null); }}
        onDelete={handleDeleteFeat}
      />

      <BackgroundDetailModal
        background={selectedBackground}
        isOpen={isBackgroundModalOpen}
        onClose={() => { setIsBackgroundModalOpen(false); setSelectedBackground(null); }}
        onDelete={handleDeleteBackground}
      />
    </div>
  );
};

export default CardLibrary;
