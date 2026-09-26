import LibraryTagControl from '../components/library/LibraryTagControl';
import { previewAnchor } from '../utils/previewAnchor';
import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  Filter, Plus, Grid3X3, List, LayoutTemplate, X, Dices, Hash, Lightbulb,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import LibrarySidebar from '../components/library/LibrarySidebar';
import LibrarySearch from '../components/library/LibrarySearch';
import LibrarySectionHero from '../components/library/LibrarySectionHero';
import { useIsMobile } from '../hooks/useIsMobile';
import { cardsApi, effectsApi, actionsApi, spellsApi, featsApi, backgroundsApi, racesApi, classesApi, resourcesApi, variablesApi, conceptsApi } from '../api/client';
import type { Card, PassiveEffect, Action, Spell, Feat, Background, Race, CharacterClass, ResourceDefinition, Variable, Concept } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS, PASSIVE_EFFECT_TYPE_OPTIONS, getSpellLevelLabel, SPELL_SCHOOL_OPTIONS, SPELL_CLASS_OPTIONS, FEAT_CATEGORY_OPTIONS, ABILITY_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import EffectPreview from '../components/EffectPreview';
import ActionPreview from '../components/ActionPreview';
import SpellPreview from '../components/SpellPreview';
import { usePinMode } from '../hooks/usePinMode';
import FeatPreview from '../components/FeatPreview';
import BackgroundPreview from '../components/BackgroundPreview';
import RacePreview from '../components/RacePreview';
import ClassPreview from '../components/ClassPreview';
import CardDetailModal from '../components/CardDetailModal';
import EffectDetailModal from '../components/EffectDetailModal';
import ActionDetailModal from '../components/ActionDetailModal';
import SpellDetailModal from '../components/SpellDetailModal';
import FeatDetailModal from '../components/FeatDetailModal';
import BackgroundDetailModal from '../components/BackgroundDetailModal';
import RaceDetailModal from '../components/RaceDetailModal';
import ClassDetailModal from '../components/ClassDetailModal';
import ConceptPreview from '../components/ConceptPreview';
import ConceptDetailModal from '../components/ConceptDetailModal';
import ResourcePreview, { resourceCategoryLabel, resourceRechargeLabel } from '../components/ResourcePreview';
import VariablePreview, { variableTypeLabel } from '../components/VariablePreview';
import ResourceDetailModal from '../components/ResourceDetailModal';
import VariableDetailModal from '../components/VariableDetailModal';
import { evictEntity } from '../components/EntityRefRegistry';
import { resourceIcon, resourceLabel, useResourceOptions } from '../utils/resources';
import { getRarityColor } from '../utils/rarityColors';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import ElementalDamageDisplay from '../components/ElementalDamageDisplay';
import CurrencyPriceInline from '../components/CurrencyPriceInline';
import { hasElementalDamage } from '../utils/elementalDamage';
import {
  type LibraryContentType,
  type LibraryViewMode,
} from '../utils/libraryUrlParams';
import { buildLibrarySearchParams, parseLibrarySearchParams, useLibrarySearchParams } from '../components/library/libraryNavigation';
import LibraryRarityFilter from '../components/library/LibraryRarityFilter';
import LibraryBulkTags, { LibrarySelectionCheckbox, useLibrarySelection } from '../components/library/LibraryBulkTags';
import { itemLibraryApi } from '../components/library/itemLibraryApi';
import { useAuth } from '../contexts/AuthContext';
import { useContentPermissions } from '../hooks/useContentPermissions';
import './CardLibrary.css';
import ItemPreview from '../components/ItemPreview';
import PassiveLibrary from '../components/PassiveLibrary';
import { useSiteSettings } from '../settings';

/** «Интерфейс» рисуем только для предметов; для прочих типов (в т.ч. из ссылки) — «Список». */
const clampView = (v: LibraryViewMode, type: LibraryContentType): LibraryViewMode =>
  v === 'interface' && type !== 'cards' ? 'list' : v;

const RESOURCE_CATEGORY_OPTIONS = [
  { value: 'action_cost', label: 'Стоимость действия' },
  { value: 'class_resource', label: 'Ресурс класса' },
  { value: 'character_resource', label: 'Ресурс персонажа' },
  { value: 'item_resource', label: 'Ресурс предмета' },
  { value: 'character', label: 'Персонаж' },
];

function splitRacesByKind(list: Race[]) {
  const mainRaces: Race[] = [];
  const subraces: Race[] = [];
  for (const race of list) {
    if (race.is_subrace) subraces.push(race);
    else mainRaces.push(race);
  }
  return { mainRaces, subraces };
}

function raceSubtypeLabel(race: Race, parentById: Map<string, Race>): string {
  if (!race.is_subrace) return 'Вид';
  const parent = race.parent_race_id ? parentById.get(race.parent_race_id) : undefined;
  return parent ? `Подвид · ${parent.name}` : 'Подвид';
}

function spellGroupLabel(level: number): string {
  return level === 0 ? 'Заговоры' : `${level}-й круг`;
}

function groupSpellsByLevel(list: Spell[]): { level: number; label: string; spells: Spell[] }[] {
  const byLevel = new Map<number, Spell[]>();
  for (const spell of list) {
    const bucket = byLevel.get(spell.level);
    if (bucket) bucket.push(spell);
    else byLevel.set(spell.level, [spell]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, spells]) => ({ level, label: spellGroupLabel(level), spells }));
}

const FEAT_GROUP_LABELS: Record<string, string> = {
  origin: 'Черты происхождения',
  general: 'Универсальные черты',
  fighting_style: 'Боевые стили',
  epic_boon: 'Эпические дары',
};

function groupFeatsByCategory(list: Feat[]): { category: string; label: string; feats: Feat[] }[] {
  const byCategory = new Map<string, Feat[]>();
  for (const feat of list) {
    const bucket = byCategory.get(feat.category);
    if (bucket) bucket.push(feat);
    else byCategory.set(feat.category, [feat]);
  }
  const knownOrder = Object.keys(FEAT_GROUP_LABELS);
  const orderedCategories = [
    ...knownOrder.filter((category) => byCategory.has(category)),
    ...[...byCategory.keys()].filter((category) => !knownOrder.includes(category)),
  ];
  return orderedCategories.map((category) => ({
    category,
    label:
      FEAT_GROUP_LABELS[category]
      || FEAT_CATEGORY_OPTIONS.find((o) => o.value === category)?.label
      || category,
    feats: byCategory.get(category)!,
  }));
}

function splitClassesByKind(list: CharacterClass[]) {
  const mainClasses: CharacterClass[] = [];
  const subclasses: CharacterClass[] = [];
  for (const characterClass of list) {
    if (characterClass.is_subclass) subclasses.push(characterClass);
    else mainClasses.push(characterClass);
  }
  return { mainClasses, subclasses };
}

function classSubtypeLabel(characterClass: CharacterClass, parentById: Map<string, CharacterClass>): string {
  if (!characterClass.is_subclass) return 'Класс';
  const parent = characterClass.parent_class_id ? parentById.get(characterClass.parent_class_id) : undefined;
  return parent ? `Подкласс · ${parent.name}` : 'Подкласс';
}

const CardLibrary = () => {
  const navigate = useNavigate();
  const { admin, canCreate, canEdit } = useContentPermissions();
  const [searchParams, setSearchParams] = useLibrarySearchParams();
  const { token } = useAuth();
  const initialFilters = useMemo(() => parseLibrarySearchParams(searchParams), []);
  const resourceOptions = useResourceOptions();
  const isMobile = useIsMobile();
  const urlInitialized = useRef(false);
  const skipFilterUrlSync = useRef(false);

  const [contentType, setContentType] = useState<LibraryContentType>(initialFilters.contentType);
  const [cards, setCards] = useState<Card[]>([]);
  const cardsIdentity = useRef(token);
  const [effects, setEffects] = useState<PassiveEffect[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [resources, setResources] = useState<ResourceDefinition[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialFilters.search);
  const [tagFilter,setTagFilter]=useState(initialFilters.tag??'');
  const [tagRevision,setTagRevision]=useState(0);
  useEffect(()=>{const refresh=()=>setTagRevision(v=>v+1);window.addEventListener('entity-tags-changed',refresh);return()=>window.removeEventListener('entity-tags-changed',refresh)},[]);
  const catalogRequestSequence = useRef(0);
  const previousContentType = useRef<LibraryContentType>(initialFilters.contentType);
  const [rarityFilter, setRarityFilter] = useState<string>(initialFilters.rarity);
  const [effectTypeFilter, setEffectTypeFilter] = useState<string>(initialFilters.effectType);
  const [propertiesFilter, setPropertiesFilter] = useState<string>(initialFilters.properties);
  const [templateTypeFilter, setTemplateTypeFilter] = useState<string>(initialFilters.templateType);

  // Функция для получения цвета номера карты в зависимости от наличия эффектов
  const getCardNumberColor = (card: Card) => {
    const hasEffects = card.effects && Array.isArray(card.effects) && card.effects.length > 0;
    return hasEffects ? 'text-gray-900' : 'text-gray-400';
  };
  const [slotFilter, setSlotFilter] = useState<string>(initialFilters.slot);
  const [armorTypeFilter, setArmorTypeFilter] = useState<string>(initialFilters.armorType);
  const [resourceCategoryFilter, setResourceCategoryFilter] = useState<string>(initialFilters.resourceCategory);
  const [sortBy, setSortBy] = useState<string>(initialFilters.sortBy);
  // Фильтры заклинаний
  const [spellLevel, setSpellLevel] = useState<string>(initialFilters.spellLevel);
  const [spellClass, setSpellClass] = useState<string>(initialFilters.spellClass);
  const [spellSubclass, setSpellSubclass] = useState<string>(initialFilters.spellSubclass);
  const [spellSchool, setSpellSchool] = useState<string>(initialFilters.spellSchool);
  const [spellConcentration, setSpellConcentration] = useState<string>(initialFilters.spellConcentration);
  const [spellRitual, setSpellRitual] = useState<string>(initialFilters.spellRitual);
  // Фильтры черт
  const [featCategory, setFeatCategory] = useState<string>(initialFilters.featCategory);
  const [featRepeatable, setFeatRepeatable] = useState<string>(initialFilters.featRepeatable);
  const [featAbility, setFeatAbility] = useState<string>(initialFilters.featAbility);
  // Фильтры предысторий
  const [bgAbility, setBgAbility] = useState<string>(initialFilters.backgroundAbility);
  const [bgSkill, setBgSkill] = useState<string>(initialFilters.backgroundSkill);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<PassiveEffect | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [selectedFeat, setSelectedFeat] = useState<Feat | null>(null);
  const [selectedBackground, setSelectedBackground] = useState<Background | null>(null);
  const [selectedRace, setSelectedRace] = useState<Race | null>(null);
  const [isRaceModalOpen, setIsRaceModalOpen] = useState(false);
  const [hoveredRace, setHoveredRace] = useState<Race | null>(null);
  const [selectedClass, setSelectedClass] = useState<CharacterClass | null>(null);
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [hoveredClass, setHoveredClass] = useState<CharacterClass | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [selectedResource, setSelectedResource] = useState<ResourceDefinition | null>(null);
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null);
  const [isVariableModalOpen, setIsVariableModalOpen] = useState(false);
  const [isConceptModalOpen, setIsConceptModalOpen] = useState(false);
  const [hoveredConcept, setHoveredConcept] = useState<Concept | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEffectModalOpen, setIsEffectModalOpen] = useState(false);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [isSpellModalOpen, setIsSpellModalOpen] = useState(false);
  const [isFeatModalOpen, setIsFeatModalOpen] = useState(false);
  const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCards, setTotalCards] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  // Отдельная настройка: превью предмета при наведении — карточка или интерфейс (стат-блок).
  const { itemPreview } = useSiteSettings();
  // Режим просмотра библиотеки — её собственный, по умолчанию «Список» для всех типов
  // (см. parseLibraryParams). Настройка «Отображение сущностей» сюда НЕ влияет: она про
  // лист персонажа и кузню. Явный ?view= в URL и ручной тумблер работают поверх.
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() =>
    clampView(initialFilters.viewMode, initialFilters.contentType),
  );
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [hoveredEffect, setHoveredEffect] = useState<PassiveEffect | null>(null);
  const [hoveredAction, setHoveredAction] = useState<Action | null>(null);
  const [hoveredResource, setHoveredResource] = useState<ResourceDefinition | null>(null);
  const [hoveredVariable, setHoveredVariable] = useState<Variable | null>(null);
  const [hoveredSpell, setHoveredSpell] = useState<Spell | null>(null);
  const [hoveredFeat, setHoveredFeat] = useState<Feat | null>(null);
  const [hoveredBackground, setHoveredBackground] = useState<Background | null>(null);
  const previewPositionRef = useRef<HTMLDivElement | null>(null);

  // Режим закрепления (клавиша T): превью не закрываются при уходе мыши и становятся
  // интерактивными (можно навести на ссылки внутри). При выходе из режима — закрыть все.
  const { pinModeActive } = usePinMode();
  const leaveHover = (clear: () => void) => () => { if (!pinModeActive) clear(); };
  const previewStyle = (base: CSSProperties): CSSProperties => ({
    ...base,
    pointerEvents: pinModeActive ? 'auto' : 'none',
  });
  // Position once from the trigger centre; keep the existing frame-based fitting.
  const pendingMouse = useRef({ x: 0, y: 0 });
  const mouseRafRef = useRef<number | null>(null);
  const placePreview = ({x, y}: {x: number; y: number}) => {
    pendingMouse.current = { x, y };
    if (mouseRafRef.current != null) return;
    mouseRafRef.current = requestAnimationFrame(() => {
      mouseRafRef.current = null;
      const preview = previewPositionRef.current;
      if (!preview) return;
      const { x: pointerX, y: pointerY } = pendingMouse.current;
      const width = preview.offsetWidth || 360;
      const height = preview.offsetHeight || 320;
      const left = Math.max(10, Math.min(pointerX + 16, window.innerWidth - width - 10));
      const top = pointerY > window.innerHeight / 2
        ? Math.max(10, pointerY - height - 16)
        : Math.min(pointerY + 16, window.innerHeight - height - 10);
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      preview.style.transform = 'none';
    });
  };
  // Position after React has mounted the newly hovered card. The previous
  // animation-frame-only path raced the first render and failed intermittently.
  useLayoutEffect(() => {
    const preview = previewPositionRef.current;
    if (!preview) return;
    const { x, y } = pendingMouse.current;
    const width = preview.offsetWidth || 360;
    const height = preview.offsetHeight || 320;
    preview.style.left = `${Math.max(10, Math.min(x + 16, window.innerWidth - width - 10))}px`;
    preview.style.top = `${y > window.innerHeight / 2 ? Math.max(10, y - height - 16) : Math.min(y + 16, window.innerHeight - height - 10)}px`;
  }, [hoveredCard, hoveredEffect, hoveredAction, hoveredResource, hoveredVariable, hoveredConcept, hoveredSpell, hoveredFeat, hoveredBackground, hoveredRace, hoveredClass]);
  useEffect(() => () => { if (mouseRafRef.current != null) cancelAnimationFrame(mouseRafRef.current); }, []);
  const prevPinRef = useRef(pinModeActive);
  useEffect(() => {
    if (prevPinRef.current && !pinModeActive) {
      setHoveredConcept(null);
      setHoveredCard(null); setHoveredSpell(null); setHoveredFeat(null);
      setHoveredBackground(null); setHoveredRace(null); setHoveredClass(null);
    }
    prevPinRef.current = pinModeActive;
  }, [pinModeActive]);

  const { mainRaces, subraces: subraceRaces } = useMemo(() => splitRacesByKind(races), [races]);
  const raceParentById = useMemo(
    () => new Map(mainRaces.map((r) => [r.id, r])),
    [mainRaces],
  );
  const spellGroups = useMemo(() => groupSpellsByLevel(spells), [spells]);
  const featGroups = useMemo(() => groupFeatsByCategory(feats), [feats]);
  const { mainClasses, subclasses: subclassClasses } = useMemo(() => splitClassesByKind(classes), [classes]);
  const classParentById = useMemo(
    () => new Map(mainClasses.map((c) => [c.id, c])),
    [mainClasses],
  );

  // Загрузка карточек
  const loadCards = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
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
      
      if (tagFilter) params.tag = tagFilter;
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
      
      const response = await itemLibraryApi.list(params);
      if (requestSequence !== catalogRequestSequence.current) return;
      cardsIdentity.current = token;
      
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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Загрузка действий
  const loadActions = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
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
      
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      
      const response = await actionsApi.getActions(params);
      if (requestSequence !== catalogRequestSequence.current) return;
      
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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки действий');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Загрузка эффектов
  const loadEffects = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
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
      
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      if (effectTypeFilter) params.effect_type = effectTypeFilter;
      
      const response = await effectsApi.getEffects(params);
      if (requestSequence !== catalogRequestSequence.current) return;
      
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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки эффектов');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Загрузка заклинаний
  const loadSpells = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const params: any = { page, limit: 50 };
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      if (spellLevel !== '') params.level = Number(spellLevel);
      if (spellClass) params.class = spellClass;
      if (spellSubclass) params.subclass = spellSubclass;
      if (spellSchool) params.school = spellSchool;
      if (spellConcentration) params.concentration = spellConcentration;
      if (spellRitual) params.ritual = spellRitual;

      const response = await spellsApi.getSpells(params);
      if (requestSequence !== catalogRequestSequence.current) return;

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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки заклинаний');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Загрузка черт
  const loadFeats = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      if (featCategory) params.category = featCategory;
      if (featRepeatable) params.repeatable = featRepeatable;
      if (featAbility) params.ability = featAbility;
      const response = await featsApi.getFeats(params);
      if (requestSequence !== catalogRequestSequence.current) return;
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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки черт');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Загрузка предысторий
  const loadBackgrounds = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      if (bgAbility) params.ability = bgAbility;
      if (bgSkill) params.skill = bgSkill;
      const response = await backgroundsApi.getBackgrounds(params);
      if (requestSequence !== catalogRequestSequence.current) return;
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
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки предысторий');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadRaces = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      const response = await racesApi.getRaces(params);
      if (requestSequence !== catalogRequestSequence.current) return;
      if (append) {
        setRaces(prev => {
          const existing = new Set(prev.map(r => r.id));
          const combined = [...prev, ...response.races.filter(r => !existing.has(r.id))];
          setHasMore(response.races.length === 50 && combined.length < response.total);
          return combined;
        });
      } else {
        setRaces(response.races);
        setHasMore(response.races.length === 50 && response.races.length < response.total);
      }
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки видов');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadClasses = async (page = 1, append = false) => {
    const requestSequence = catalogRequestSequence.current;
    try {
      if (page === 1) setLoading(true); else setLoadingMore(true);
      const params: any = { page, limit: 50 };
      if (tagFilter) params.tag = tagFilter;
      if (search) params.search = search;
      const response = await classesApi.getClasses(params);
      if (requestSequence !== catalogRequestSequence.current) return;
      if (append) {
        setClasses(prev => {
          const existing = new Set(prev.map(c => c.id));
          const combined = [...prev, ...response.classes.filter(c => !existing.has(c.id))];
          setHasMore(response.classes.length === 50 && combined.length < response.total);
          return combined;
        });
      } else {
        setClasses(response.classes);
        setHasMore(response.classes.length === 50 && response.classes.length < response.total);
      }
      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки классов');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadResources = async () => {
    const requestSequence = catalogRequestSequence.current;
    try {
      setLoading(true);
      const response = await resourcesApi.getResources({ category: resourceCategoryFilter || undefined, tag:tagFilter||undefined });
      if (requestSequence !== catalogRequestSequence.current) return;
      const normalizedSearch = search.trim().toLowerCase();
      const filtered = normalizedSearch
        ? response.resources.filter((resource) => {
            const text = [
              resource.name,
              resource.resource_id,
              resource.description || '',
              resource.category || '',
              resource.recharge || '',
            ].join(' ').toLowerCase();
            return text.includes(normalizedSearch);
          })
        : response.resources;

      setResources(filtered);
      setTotalCards(filtered.length);
      setHasMore(false);
      setCurrentPage(1);
      setError(null);
    } catch (err) {
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки ресурсов');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Переменные раньше в библиотеке не грузились вовсе: вкладка была заглушкой со ссылкой
  // на конструктор. Теперь это полноценный раздел, как понятия.
  const loadVariables = async () => {
    const requestSequence = catalogRequestSequence.current;
    try {
      setLoading(true);
      const response = await variablesApi.getVariables({tag:tagFilter||undefined});
      if (requestSequence !== catalogRequestSequence.current) return;
      const list = response.variables || [];
      const normalizedSearch = search.trim().toLowerCase();
      const filtered = normalizedSearch
        ? list.filter((variable) =>
            [variable.name, variable.name_en || '', variable.variable_id, variable.description || '']
              .join(' ')
              .toLowerCase()
              .includes(normalizedSearch))
        : list;
      setVariables(filtered);
      setTotalCards(filtered.length);
      setHasMore(false);
      setCurrentPage(1);
      setError(null);
    } catch (err) {
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки переменных');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadConcepts = async () => {
    const requestSequence = catalogRequestSequence.current;
    try {
      setLoading(true);
      const response = await conceptsApi.getConcepts({tag:tagFilter||undefined});
      if (requestSequence !== catalogRequestSequence.current) return;
      const list = response.concepts || [];
      const normalizedSearch = search.trim().toLowerCase();
      const filtered = normalizedSearch
        ? list.filter((concept) =>
            [concept.name, concept.concept_id, concept.description || '']
              .join(' ')
              .toLowerCase()
              .includes(normalizedSearch))
        : list;
      setConcepts(filtered);
      setTotalCards(filtered.length);
      setHasMore(false);
      setCurrentPage(1);
      setError(null);
    } catch (err) {
      if (requestSequence !== catalogRequestSequence.current) return;
      setError(err instanceof Error ? err.message : 'Ошибка загрузки понятий');
    } finally {
      if (requestSequence === catalogRequestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    catalogRequestSequence.current += 1;
    setCurrentPage(1);
    if (cardsIdentity.current !== token) {
      setCards([]);
      setTotalCards(0);
    }
    if (previousContentType.current !== contentType) {
      setCards([]); setEffects([]); setActions([]); setSpells([]); setFeats([]);
      setBackgrounds([]); setRaces([]); setClasses([]); setResources([]); setConcepts([]);
      previousContentType.current = contentType;
    }
    if (contentType === 'cards') {
      loadCards(1, false);
    } else if (contentType === 'effects') {
      loadEffects(1, false);
    } else if (contentType === 'passives') {
      setLoading(false); setLoadingMore(false); setHasMore(false);
    } else if (contentType === 'actions') {
      loadActions(1, false);
    } else if (contentType === 'spells') {
      loadSpells(1, false);
    } else if (contentType === 'feats') {
      loadFeats(1, false);
    } else if (contentType === 'backgrounds') {
      loadBackgrounds(1, false);
    } else if (contentType === 'races') {
      loadRaces(1, false);
    } else if (contentType === 'classes') {
      loadClasses(1, false);
    } else if (contentType === 'resources') {
      loadResources();
    } else if (contentType === 'variables') {
      loadVariables();
    } else if (contentType === 'concepts') {
      loadConcepts();
    }
  }, [token, contentType, search, tagFilter, tagRevision, rarityFilter, effectTypeFilter, propertiesFilter, templateTypeFilter, slotFilter, armorTypeFilter, resourceCategoryFilter, sortBy, spellLevel, spellClass, spellSubclass, spellSchool, spellConcentration, spellRitual, featCategory, featRepeatable, featAbility, bgAbility, bgSkill]);

  const currentFilters = useMemo(
    () => ({
      contentType,
      search,
      tag:tagFilter,
      rarity: rarityFilter,
      effectType: effectTypeFilter,
      properties: propertiesFilter,
      templateType: templateTypeFilter,
      slot: slotFilter,
      armorType: armorTypeFilter,
      resourceCategory: resourceCategoryFilter,
      sortBy,
      viewMode,
      spellLevel,
      spellClass,
      spellSubclass,
      spellSchool,
      spellConcentration,
      spellRitual,
      featCategory,
      featRepeatable,
      featAbility,
      backgroundAbility: bgAbility,
      backgroundSkill: bgSkill,
    }),
    [
      contentType,
      search,
      tagFilter,
      rarityFilter,
      effectTypeFilter,
      propertiesFilter,
      templateTypeFilter,
      slotFilter,
      armorTypeFilter,
      resourceCategoryFilter,
      sortBy,
      viewMode,
      spellLevel,
      spellClass,
      spellSubclass,
      spellSchool,
      spellConcentration,
      spellRitual,
      featCategory,
      featRepeatable,
      featAbility,
      bgAbility,
      bgSkill,
    ]
  );

  const lastWrittenParamsRef = useRef(searchParams.toString());
  const selection = useLibrarySelection(token, JSON.stringify({ ...currentFilters, viewMode: undefined }));

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

    // An external navigation must hydrate filters before they write the URL.
    if (searchParams.toString() !== lastWrittenParamsRef.current) return;

    const built = buildLibrarySearchParams(currentFilters, searchParams);
    const cardId = searchParams.get('card');
    if (cardId) {
      built.set('card', cardId);
    }

    const nextStr = built.toString();
    if (nextStr !== searchParams.toString()) {
      lastWrittenParamsRef.current = nextStr;
      // Committed searches are history entries; other filters retain their
      // established replace behavior. Back/forward hydrate the common control.
      setSearchParams(built, { replace: currentFilters.search === searchParams.get('q') || (!currentFilters.search && !searchParams.has('q')) });
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
    setTagFilter(parsed.tag??"");
    setRarityFilter(parsed.rarity);
    setEffectTypeFilter(parsed.effectType);
    setPropertiesFilter(parsed.properties);
    setTemplateTypeFilter(parsed.templateType);
    setSlotFilter(parsed.slot);
    setArmorTypeFilter(parsed.armorType);
    setResourceCategoryFilter(parsed.resourceCategory);
    setSortBy(parsed.sortBy);
    setViewMode(clampView(parsed.viewMode, parsed.contentType));
    setSpellLevel(parsed.spellLevel);
    setSpellClass(parsed.spellClass);
    setSpellSubclass(parsed.spellSubclass);
    setSpellSchool(parsed.spellSchool);
    setSpellConcentration(parsed.spellConcentration);
    setSpellRitual(parsed.spellRitual);
    setFeatCategory(parsed.featCategory);
    setFeatRepeatable(parsed.featRepeatable);
    setFeatAbility(parsed.featAbility);
    setBgAbility(parsed.backgroundAbility);
    setBgSkill(parsed.backgroundSkill);
    lastWrittenParamsRef.current = currentStr;
  }, [searchParams]);

  // Older links to ?card= now resolve to the canonical full entity page.
  useEffect(() => {
    const cardId = searchParams.get('card');
    if (cardId) navigate(`/entity/cards/${encodeURIComponent(cardId)}`, { replace: true });
  }, [searchParams, navigate]);

  // Автоматическая подгрузка при прокрутке
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    
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
      } else if (contentType === 'races') {
        loadRaces(currentPage + 1, true);
      } else if (contentType === 'classes') {
        loadClasses(currentPage + 1, true);
      }
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
    if (selection.enabled) { selection.toggle(card.id); return; }
    if (!canEdit(card)) { navigate(`/entity/cards/${card.id}`); return; }
    setSelectedCard(card);
    setIsModalOpen(true);
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
    if (!canEdit(effect)) { navigate(`/entity/effects/${effect.id}`); return; }
    setSelectedEffect(effect);
    setIsEffectModalOpen(true);
  };

  const handleCloseEffectModal = () => {
    setIsEffectModalOpen(false);
    setSelectedEffect(null);
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
    if (!canEdit(action)) { navigate(`/entity/actions/${action.id}`); return; }
    setSelectedAction(action);
    setIsActionModalOpen(true);
  };

  const handleCloseActionModal = () => {
    setIsActionModalOpen(false);
    setSelectedAction(null);
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
    if (!canEdit(spell)) { navigate(`/entity/spells/${spell.id}`); return; }
    setSelectedSpell(spell);
    setIsSpellModalOpen(true);
  };

  const handleCloseSpellModal = () => {
    setIsSpellModalOpen(false);
    setSelectedSpell(null);
  };

  // Обработчики для черт
  const handleFeatClick = (feat: Feat) => {
    if (!canEdit(feat)) { navigate(`/entity/feats/${feat.id}`); return; }
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
    if (!canEdit(bg)) { navigate(`/entity/backgrounds/${bg.id}`); return; }
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

  // Обработчики для видов (рас)
  const handleRaceClick = (race: Race) => {
    if (!canEdit(race)) { navigate(`/entity/races/${race.id}`); return; }
    setSelectedRace(race);
    setIsRaceModalOpen(true);
  };
  const handleDeleteRace = async (raceId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот вид?')) return;
    try {
      await racesApi.deleteRace(raceId);
      if (contentType === 'races') loadRaces(1, false);
      setIsRaceModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления вида');
    }
  };

  const handleClassClick = (characterClass: CharacterClass) => {
    if (!canEdit(characterClass)) { navigate(`/entity/classes/${characterClass.id}`); return; }
    setSelectedClass(characterClass);
    setIsClassModalOpen(true);
  };
  const handleDeleteClass = async (classId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот класс?')) return;
    try {
      await classesApi.deleteClass(classId);
      if (contentType === 'classes') loadClasses(1, false);
      setIsClassModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления класса');
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

  // Заклинание обновили в модалке (сменили картинку) — освежаем список и выбранное.
  const handleSpellUpdated = (updated: Spell) => {
    setSpells((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedSpell((prev) => (prev && prev.id === updated.id ? updated : prev));
  };

  const handleDeleteResource = async (resourceId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот ресурс?')) return;
    try {
      await resourcesApi.deleteResource(resourceId);
      evictEntity('resource', resourceId);
      setIsResourceModalOpen(false);
      setSelectedResource(null);
      if (contentType === 'resources') loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления ресурса');
    }
  };

  const handleResourceClick = (resource: ResourceDefinition) => {
    if (!canEdit(resource)) { navigate(`/entity/resources/${resource.id}`); return; }
    setSelectedResource(resource);
    setIsResourceModalOpen(true);
  };

  const handleVariableClick = (variable: Variable) => {
    if (!canEdit(variable)) { navigate(`/entity/variables/${variable.id}`); return; }
    setSelectedVariable(variable);
    setIsVariableModalOpen(true);
  };

  const handleDeleteVariable = async (variableId: string) => {
    if (!confirm('Удалить переменную?')) return;
    try {
      await variablesApi.deleteVariable(variableId);
      evictEntity('variable', variableId);
      setIsVariableModalOpen(false);
      setSelectedVariable(null);
      if (contentType === 'variables') loadVariables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления переменной');
    }
  };

  const handleConceptClick = (concept: Concept) => {
    if (!canEdit(concept)) { navigate(`/entity/concepts/${concept.id}`); return; }
    setSelectedConcept(concept);
    setIsConceptModalOpen(true);
  };

  const handleDeleteConcept = async (conceptId: string) => {
    if (!confirm('Удалить понятие?')) return;
    try {
      await conceptsApi.deleteConcept(conceptId);
      evictEntity('concept', conceptId);
      setIsConceptModalOpen(false);
      setSelectedConcept(null);
      if (contentType === 'concepts') loadConcepts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления понятия');
    }
  };

  // Получение типа эффекта для отображения
  const getEffectTypeLabel = (effectType: string) => {
    return PASSIVE_EFFECT_TYPE_OPTIONS.find((opt) => opt.value === effectType)?.label || effectType;
  };

  // Получение метки ресурса действия для отображения
  const getActionResourceLabel = (resource: string) => {
    return resourceLabel(resourceOptions, resource);
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

  const createTargetByType: Record<LibraryContentType, { to: string; label: string }> = {
    cards: { to: '/create', label: 'Создать карту' },
    effects: { to: '/effect-creator', label: 'Создать эффект' },
    passives: { to: '/library?type=passives', label: 'Оформление пассивов' },
    actions: { to: '/action-creator', label: 'Создать действие' },
    spells: { to: '/spell-creator', label: 'Создать заклинание' },
    feats: { to: '/feat-creator', label: 'Создать черту' },
    backgrounds: { to: '/background-creator', label: 'Создать предысторию' },
    races: { to: '/race-creator', label: 'Создать вид' },
    classes: { to: '/class-creator', label: 'Создать класс' },
    resources: { to: '/resource-creator', label: 'Создать ресурс' },
    variables: { to: '/variable-creator', label: 'Создать переменную' },
    concepts: { to: '/concept-creator', label: 'Создать понятие' },
  };
  const createTarget = createTargetByType[contentType];

  const handleContentTypeChange = (next: LibraryContentType) => {
    if (next !== 'cards') setRarityFilter(value => value.split(',')[0] ?? '');
    setContentType(next);
    // Выбранный вручную режим держим между вкладками; «Интерфейс» есть только у предметов,
    // поэтому при уходе на другой тип сбрасываем его в «Список».
    if (next !== 'cards') setViewMode((v) => (v === 'interface' ? 'list' : v));
  };
  // Счётчик активных фильтров — бейдж на кнопке «Фильтры». (Тип шаблона и
  // сортировка всегда заданы, поэтому в счётчик не входят.)
  const activeFilterCount = [
    rarityFilter, effectTypeFilter, propertiesFilter, slotFilter,
    armorTypeFilter, resourceCategoryFilter, spellLevel, spellClass, spellSubclass,
    spellSchool, spellConcentration, spellRitual, featCategory, featRepeatable,
    featAbility, bgAbility, bgSkill, tagFilter,
  ].filter(Boolean).length;
  const resetFilters = () => {
    setTagFilter('');
    setRarityFilter('');
    setEffectTypeFilter('');
    setPropertiesFilter('');
    setSlotFilter('');
    setArmorTypeFilter('');
    setResourceCategoryFilter('');
    setSpellLevel('');
    setSpellClass('');
    setSpellSubclass('');
    setSpellSchool('');
    setSpellConcentration('');
    setSpellRitual('');
    setFeatCategory('');
    setFeatRepeatable('');
    setFeatAbility('');
    setBgAbility('');
    setBgSkill('');
  };

  return (
    <div className="card-library library-shell" data-content-type={contentType} data-view-mode={viewMode}>
      <LibrarySidebar active={contentType} onSelectContent={handleContentTypeChange} />
      <div className="library-shell__content">
      {/* Заголовок */}
      <LibrarySectionHero type={contentType} subtitle="Библиотека" action={canCreate(contentType) && <Link
          to={createTarget.to}
          className="library-chrome-button library-chrome-button--primary"
        >
          <Plus size={18} />
          <span>{createTarget.label}</span>
        </Link>} />

      {admin && contentType === 'cards' && <LibraryBulkTags selection={selection} visibleIDs={loading ? [] : cards.map(card => card.id)} />}

      {/* Поиск и фильтры */}
      <div className="lib-toolbar library-chrome-panel">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          {/* Поиск */}
          <LibrarySearch value={search} onSearch={setSearch} />

          {/* Переключатель режимов отображения */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('grid')}
              className="library-chrome-button"
              aria-pressed={viewMode === 'grid'}
              aria-label="Сетка"
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="library-chrome-button"
              aria-pressed={viewMode === 'list'}
              aria-label="Список"
            >
              <List size={18} />
            </button>
            {contentType === 'cards' && (
              <button
                onClick={() => setViewMode('interface')}
                className="library-chrome-button"
                aria-pressed={viewMode === 'interface'}
                aria-label="Интерфейс (стат-блок)"
              >
                <LayoutTemplate size={18} />
              </button>
            )}
          </div>

          {/* Кнопка фильтров */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="library-chrome-button"
            aria-expanded={showFilters}
          >
            <Filter size={18} />
            <span>Фильтры</span>
            {activeFilterCount > 0 && (
              <span className="library-chrome-badge">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Панель фильтров — на мобильных нижний лист (bottom sheet) со сценой */}
        {isMobile && showFilters && (
          <div className="lib-scrim" onClick={() => setShowFilters(false)} />
        )}
        {showFilters && (
          <div className={`library-chrome-filters ${isMobile ? 'lib-filters-sheet' : 'mt-4 pt-4 border-t'}`}>
            {isMobile && (
              <div className="lib-filters-head">
                <span className="text-base font-semibold text-gray-800">Фильтры</span>
                <button
                  type="button"
                  onClick={() => setShowFilters(false)}
                  className="library-chrome-button"
                  aria-label="Закрыть фильтры"
                >
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <LibraryTagControl value={tagFilter} onChange={setTagFilter}/>
            {/* Фильтр по редкости - не для заклинаний */}
            {contentType === 'cards' && <LibraryRarityFilter value={rarityFilter} onChange={setRarityFilter} />}
            {contentType !== 'cards' && contentType !== 'spells' && contentType !== 'resources' && (
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

            {contentType === 'resources' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Категория ресурса
                </label>
                <select
                  value={resourceCategoryFilter}
                  onChange={(e) => setResourceCategoryFilter(e.target.value)}
                  className="input-field"
                >
                  <option value="">Все категории</option>
                  {RESOURCE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {contentType === 'effects' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип эффекта
                </label>
                <select
                  value={effectTypeFilter}
                  onChange={(e) => setEffectTypeFilter(e.target.value)}
                  className="input-field"
                >
                  <option value="">Все типы</option>
                  {PASSIVE_EFFECT_TYPE_OPTIONS.map((option) => (
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
            {contentType !== 'resources' && (
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
            )}
            </div>
            {isMobile && (
              <div className="lib-filters-foot">
                <button type="button" onClick={resetFilters} className="library-chrome-button flex-1">
                  Сбросить
                </button>
                <button type="button" onClick={() => setShowFilters(false)} className="library-chrome-button library-chrome-button--primary flex-1">
                  Показать
                </button>
              </div>
            )}
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
      {contentType === 'passives' && <PassiveLibrary tag={tagFilter} search={search} mode={viewMode === 'list' ? 'row' : 'icon'}/>}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Список карточек или эффектов */}
      {!loading && contentType === 'cards' && cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Карточки не найдены</p>
          <Link to="/create" className="btn-primary mt-4 inline-block" style={{ display: canCreate('cards') ? undefined : 'none' }}>
            Создать первую карточку
          </Link>
        </div>
      )}

      {!loading && contentType === 'effects' && effects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Эффекты не найдены</p>
          <Link to="/effect-creator" className="btn-primary mt-4 inline-block" style={{ display: canCreate('effects') ? undefined : 'none' }}>
            Создать первый эффект
          </Link>
        </div>
      )}

      {!loading && contentType === 'actions' && actions.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Действия не найдены</p>
          <Link to="/action-creator" className="btn-primary mt-4 inline-block" style={{ display: canCreate('actions') ? undefined : 'none' }}>
            Создать первое действие
          </Link>
        </div>
      )}

      {!loading && contentType === 'spells' && spells.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Заклинания не найдены</p>
          <Link to="/spell-creator" className="btn-primary mt-4 inline-block" style={{ display: canCreate('spells') ? undefined : 'none' }}>
            Создать первое заклинание
          </Link>
        </div>
      )}

      {!loading && contentType === 'resources' && resources.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Ресурсы не найдены</p>
          <Link to="/resource-creator" className="btn-primary mt-4 inline-block" style={{ display: canCreate('resources') ? undefined : 'none' }}>
            Создать первый ресурс
          </Link>
        </div>
      )}

      {!loading && contentType === 'variables' && variables.length === 0 && (
        <div className="text-center py-12 text-gray-500">Переменные не найдены</div>
      )}

      {!loading && contentType === 'variables' && variables.length > 0 && (
        <>
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {variables.length} из {totalCards} переменных
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {variables.map((variable) => (
                <div key={variable.variable_id} className="flex justify-center">
                  <VariablePreview variable={variable} onClick={() => handleVariableClick(variable)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
              {variables.map((variable) => (
                <button
                  type="button"
                  key={variable.variable_id}
                 onClick={() => handleVariableClick(variable)}
                  onMouseEnter={(e) => { setHoveredVariable(variable); placePreview(previewAnchor(e.currentTarget)); }}
                  onMouseLeave={leaveHover(() => setHoveredVariable(null))}
                  className="library-entity-row w-full text-left p-3 rounded-lg transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    {variable.image_url?.trim()
                      ? <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent"><img src={variable.image_url} alt="" className="w-full h-full object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} /></div>
                      : <span className="library-entity-fallback" aria-hidden="true">{variable.var_type === 'dice' ? <Dices size={25} /> : <Hash size={25} />}</span>}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-gray-900">{variable.name}</div>
                      <div className="text-xs text-gray-500 truncate">{variable.variable_id} · {variableTypeLabel(variable.var_type)}</div>
                      <div className="text-xs text-gray-400 truncate">По умолчанию: {variable.default_value || '—'}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && contentType === 'concepts' && concepts.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg mb-2">Понятия (глоссарий) для ссылок в текстах</p>
          <p className="text-gray-400 text-sm mb-4 max-w-xl mx-auto">
            Понятие — это пояснение, не выражаемое отдельной сущностью (напр. «Спасбросок»).
            На него ссылаются из любого текста: <code>[[Спасбросок|concept:saving_throw]]</code>.
          </p>
          <Link to="/concept-creator" className="btn-primary inline-block" style={{ display: canCreate('concepts') ? undefined : 'none' }}>
            Создать понятие
          </Link>
        </div>
      )}

      {!loading && contentType === 'concepts' && concepts.length > 0 && (
        <>
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {concepts.length} из {totalCards} понятий
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {concepts.map((concept) => (
                <div key={concept.concept_id} className="flex justify-center">
                  <ConceptPreview concept={concept} onClick={() => handleConceptClick(concept)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {concepts.map((concept) => (
                  <button type="button"
                    key={concept.concept_id}
                    onClick={() => handleConceptClick(concept)}
                    onMouseEnter={(e) => { setHoveredConcept(concept); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredConcept(null))}
                    className="library-entity-row w-full text-left p-3 rounded-lg transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      {concept.image_url?.trim()
                        ? <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent"><img src={concept.image_url} alt="" className="w-full h-full object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} /></div>
                        : <span className="library-entity-fallback" aria-hidden="true"><Lightbulb size={25} /></span>}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-gray-900">{concept.name}</div>
                        <div className="text-xs font-mono text-gray-500 truncate">{concept.concept_id}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {hoveredConcept && (
                <div
                  ref={previewPositionRef}
                  className="fixed z-50 entity-preview-enter"
                  style={previewStyle({
                    left: -10_000,
                    top: 10,
                  })}
                >
                  <ConceptPreview concept={hoveredConcept} disableHover />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && contentType === 'cards' && cards.length > 0 && (
        <>
          {/* Счетчик карт */}
          <div className="mb-4 text-sm library-chrome-status">
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
                    className={`library-selectable relative group flex justify-center cursor-pointer ${isExtended ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
                    data-selected={selection.enabled && selection.selected.has(card.id)}
                    onClick={() => handleCardClick(card)}
                  >
                    <LibrarySelectionCheckbox selection={selection} id={card.id} name={card.name} />
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
          ) : viewMode === 'interface' ? (
            /* Стат-блок в стиле превью заклинания (только предметы) */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-10 pt-7">
              {cards.map((card) => (
                <div key={card.id} className="library-selectable relative flex justify-center" data-selected={selection.enabled && selection.selected.has(card.id)}>
                  <LibrarySelectionCheckbox selection={selection} id={card.id} name={card.name} />
                  <ItemPreview card={card} onClick={() => handleCardClick(card)} />
                </div>
              ))}
              {loadingMore && (
                <div className="col-span-full mt-2 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    Загрузка карт...
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Список названий */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="library-selectable relative"
                    data-selected={selection.enabled && selection.selected.has(card.id)}
                    onMouseEnter={(e) => { setHoveredCard(card); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredCard(null))}
                  >
                    <LibrarySelectionCheckbox selection={selection} id={card.id} name={card.name} />
                    <button
                      onClick={() => handleCardClick(card)}
                      className={`library-item-row w-full text-left p-3 rounded-lg transition-all duration-200 border-l-4 ${getRarityBorderColor(card.rarity)}`}
                    >
                      <div className="flex items-center space-x-3">
                        {/* Картинка слева: без рамки, крупнее относительно строки */}
                        <div className="flex-shrink-0 w-16 h-16 rounded overflow-hidden">
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
                              aria-description={getRaritySymbolDescription(card.rarity)}
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
                                    <img src="/icons/defense.png" alt="КД" className="w-3 h-3" />
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
                  ref={previewPositionRef}
                  className="fixed z-50 entity-preview-enter"
                  style={previewStyle({
                    left: -10_000,
                    top: 10,
                  })}
                >
                  {itemPreview === 'interface' ? (
                    <ItemPreview card={hoveredCard} disableHover />
                  ) : (
                    <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
                      <CardPreview card={hoveredCard} />
                    </div>
                  )}
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
          <div className="mb-4 text-sm library-chrome-status">
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
                    onMouseEnter={(e) => { setHoveredEffect(effect); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredEffect(null))}
                    className="library-entity-row w-full text-left p-3 rounded-lg transition-all duration-200"
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
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {actions.length} из {totalCards} действий
          </div>
          
          {/* Отображение в зависимости от режима */}
          {viewMode === 'grid' ? (
            /* Сетка действий */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {actions.map((action) => (
                <div key={action.id} className="flex justify-center">
                  <ActionPreview action={action} onClick={() => handleActionClick(action)} resources={resourceOptions} />
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
                    onMouseEnter={(e) => { setHoveredAction(action); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredAction(null))}
                    className="library-entity-row w-full text-left p-3 rounded-lg transition-all duration-200"
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
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {spells.length} из {totalCards} заклинаний
          </div>

          {viewMode === 'grid' ? (
            /* Сетка заклинаний */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {spellGroups.map((group, groupIndex) => (
                <Fragment key={group.level}>
                  <div className={`col-span-full ${groupIndex > 0 ? 'border-t border-gray-300 my-2 pt-6' : ''}`}>
                    <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">{group.label}</div>
                  </div>
                  {group.spells.map((spell) => (
                    <div key={spell.id} className="flex justify-center">
                      <SpellPreview spell={spell} onClick={() => handleSpellClick(spell)} />
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          ) : (
            /* Список заклинаний */
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {spellGroups.map((group, groupIndex) => (
                  <Fragment key={group.level}>
                    <div className={`col-span-full ${groupIndex > 0 ? 'border-t border-[#8a7320]/40 my-3 pt-4' : ''} pb-1`}>
                      <div className="text-xs font-medium uppercase tracking-wide text-[#a59886]">{group.label}</div>
                    </div>
                    {group.spells.map((spell) => (
                      <button
                        key={spell.id}
                        onClick={() => handleSpellClick(spell)}
                        onMouseEnter={(e) => { setHoveredSpell(spell); placePreview(previewAnchor(e.currentTarget)); }}
                        onMouseLeave={leaveHover(() => setHoveredSpell(null))}
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
                  </Fragment>
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
                  ref={previewPositionRef}
                  className="fixed z-50 entity-preview-enter"
                  style={previewStyle({
                    left: -10_000,
                    top: 10,
                  })}
                  onMouseLeave={leaveHover(() => setHoveredSpell(null))}
                >
                  <SpellPreview spell={hoveredSpell} disableHover={true} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Ресурсы ── */}
      {!loading && contentType === 'resources' && resources.length > 0 && (
        <>
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {resources.length} из {totalCards} ресурсов
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {resources.map((resource) => (
                <div key={resource.resource_id} className="flex justify-center">
                  <ResourcePreview resource={resource} onClick={() => handleResourceClick(resource)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
              {resources.map((resource) => (
                <button
                  type="button"
                  key={resource.resource_id}
                 onClick={() => handleResourceClick(resource)}
                  onMouseEnter={(e) => { setHoveredResource(resource); placePreview(previewAnchor(e.currentTarget)); }}
                  onMouseLeave={leaveHover(() => setHoveredResource(null))}
                  className="library-entity-row w-full text-left p-3 rounded-lg transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                      <img
                        src={resource.image_url || resourceIcon(resourceOptions, resource.resource_id)}
                        alt=""
                        className="w-full h-full object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-gray-900">{resource.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {resource.resource_id} · {resourceCategoryLabel(resource.category)}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {resourceRechargeLabel(resource.recharge)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
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
          <div className="mb-4 text-sm library-chrome-status">Показано: {feats.length} из {totalCards} черт</div>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {featGroups.map((group, groupIndex) => (
                <Fragment key={group.category}>
                  <div className={`col-span-full ${groupIndex > 0 ? 'border-t border-gray-300 my-2 pt-6' : ''}`}>
                    <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">{group.label}</div>
                  </div>
                  {group.feats.map((feat) => (
                    <div key={feat.id} className="flex justify-center">
                      <FeatPreview feat={feat} onClick={() => handleFeatClick(feat)} />
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {featGroups.map((group, groupIndex) => (
                  <Fragment key={group.category}>
                    <div className={`col-span-full ${groupIndex > 0 ? 'border-t border-[#8a7320]/40 my-3 pt-4' : ''} pb-1`}>
                      <div className="text-xs font-medium uppercase tracking-wide text-[#a59886]">{group.label}</div>
                    </div>
                    {group.feats.map((feat) => (
                      <button
                        key={feat.id}
                        onClick={() => handleFeatClick(feat)}
                        onMouseEnter={(e) => { setHoveredFeat(feat); placePreview(previewAnchor(e.currentTarget)); }}
                        onMouseLeave={leaveHover(() => setHoveredFeat(null))}
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
                  </Fragment>
                ))}
              </div>
              {hoveredFeat && (
                <div ref={previewPositionRef} className="fixed z-50 entity-preview-enter" style={previewStyle({ left: -10_000, top: 10 })}>
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
          <div className="mb-4 text-sm library-chrome-status">Показано: {backgrounds.length} из {totalCards} предысторий</div>
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
                    onMouseEnter={(e) => { setHoveredBackground(bg); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredBackground(null))}
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
                <div ref={previewPositionRef} className="fixed z-50 entity-preview-enter" style={previewStyle({ left: -10_000, top: 10 })}>
                  <BackgroundPreview background={hoveredBackground} disableHover={true} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && contentType === 'races' && races.length === 0 && (
        <div className="text-center py-12 text-gray-500">Виды не найдены</div>
      )}
      {!loading && contentType === 'classes' && classes.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Классы не найдены</p>
          <Link to="/class-creator" className="btn-primary mt-4 inline-block" style={{ display: canCreate('classes') ? undefined : 'none' }}>
            Создать первый класс
          </Link>
        </div>
      )}
      {!loading && contentType === 'races' && races.length > 0 && (
        <>
          <div className="mb-4 text-sm library-chrome-status">
            Показано: {mainRaces.length} {mainRaces.length === 1 ? 'вид' : mainRaces.length < 5 ? 'вида' : 'видов'}
            {subraceRaces.length > 0 && (
              <>, {subraceRaces.length} {subraceRaces.length === 1 ? 'подвид' : subraceRaces.length < 5 ? 'подвида' : 'подвидов'}</>
            )}
            {' '}(всего {races.length} из {totalCards})
          </div>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {mainRaces.map((race) => (
                <div key={race.id} className="flex justify-center">
                  <RacePreview race={race} onClick={() => handleRaceClick(race)} />
                </div>
              ))}
              {mainRaces.length > 0 && subraceRaces.length > 0 && (
                <div className="col-span-full border-t border-gray-300 my-2 pt-6">
                  <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Подвиды</div>
                </div>
              )}
              {subraceRaces.map((race) => (
                <div key={race.id} className="flex justify-center">
                  <RacePreview
                    race={race}
                    parentRaceName={race.parent_race_id ? raceParentById.get(race.parent_race_id)?.name : undefined}
                    onClick={() => handleRaceClick(race)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {mainRaces.map((race) => (
                  <button
                    key={race.id}
                    onClick={() => handleRaceClick(race)}
                    onMouseEnter={(e) => { setHoveredRace(race); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredRace(null))}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img src={race.image_url && race.image_url.trim() !== '' ? race.image_url : '/default_image.png'} alt={race.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{race.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">{raceSubtypeLabel(race, raceParentById)}</div>
                      </div>
                    </div>
                  </button>
                ))}
                {mainRaces.length > 0 && subraceRaces.length > 0 && (
                  <div className="col-span-full border-t border-[#8a7320]/40 my-3 pt-4 pb-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-[#a59886]">Подвиды</div>
                  </div>
                )}
                {subraceRaces.map((race) => (
                  <button
                    key={race.id}
                    onClick={() => handleRaceClick(race)}
                    onMouseEnter={(e) => { setHoveredRace(race); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredRace(null))}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img src={race.image_url && race.image_url.trim() !== '' ? race.image_url : '/default_image.png'} alt={race.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{race.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">{raceSubtypeLabel(race, raceParentById)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {hoveredRace && (
                <div ref={previewPositionRef} className="fixed z-50 entity-preview-enter" style={previewStyle({ left: -10_000, top: 10 })}>
                  <RacePreview
                    race={hoveredRace}
                    parentRaceName={hoveredRace.parent_race_id ? raceParentById.get(hoveredRace.parent_race_id)?.name : undefined}
                    disableHover={true}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && contentType === 'classes' && classes.length > 0 && (
        <>
          <div className="mb-4 text-sm library-chrome-status">Показано: {classes.length} из {totalCards} классов</div>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-8">
              {mainClasses.map((characterClass) => (
                <div key={characterClass.id} className="flex justify-center">
                  <ClassPreview characterClass={characterClass} onClick={() => handleClassClick(characterClass)} />
                </div>
              ))}
              {mainClasses.length > 0 && subclassClasses.length > 0 && (
                <div className="col-span-full border-t border-gray-300 my-2 pt-6">
                  <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">Подклассы</div>
                </div>
              )}
              {subclassClasses.map((characterClass) => (
                <div key={characterClass.id} className="flex justify-center">
                  <ClassPreview characterClass={characterClass} onClick={() => handleClassClick(characterClass)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {mainClasses.map((characterClass) => (
                  <button
                    key={characterClass.id}
                    onClick={() => handleClassClick(characterClass)}
                    onMouseEnter={(e) => { setHoveredClass(characterClass); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredClass(null))}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img
                          src={characterClass.image_url && characterClass.image_url.trim() !== '' ? characterClass.image_url : '/default_image.png'}
                          alt={characterClass.name}
                          className="w-full h-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{characterClass.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">
                          {classSubtypeLabel(characterClass, classParentById)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {mainClasses.length > 0 && subclassClasses.length > 0 && (
                  <div className="col-span-full border-t border-[#8a7320]/40 my-3 pt-4 pb-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-[#a59886]">Подклассы</div>
                  </div>
                )}
                {subclassClasses.map((characterClass) => (
                  <button
                    key={characterClass.id}
                    onClick={() => handleClassClick(characterClass)}
                    onMouseEnter={(e) => { setHoveredClass(characterClass); placePreview(previewAnchor(e.currentTarget)); }}
                    onMouseLeave={leaveHover(() => setHoveredClass(null))}
                    className="w-full text-left p-3 rounded-lg border border-[#8a7320] bg-gradient-to-br from-[#2b2520] to-[#191410] text-[#ece3d4] transition-all duration-200 hover:shadow-md hover:border-[#c9a227]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-[55px] h-[55px] rounded overflow-hidden bg-transparent">
                        <img
                          src={characterClass.image_url && characterClass.image_url.trim() !== '' ? characterClass.image_url : '/default_image.png'}
                          alt={characterClass.name}
                          className="w-full h-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" style={{ fontFamily: 'Georgia, serif', color: '#f3ead4' }}>{characterClass.name}</div>
                        <div className="flex items-center mt-1 text-xs text-[#a59886]">
                          {classSubtypeLabel(characterClass, classParentById)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {hoveredClass && (
                <div ref={previewPositionRef} className="fixed z-50 entity-preview-enter" style={previewStyle({ left: -10_000, top: 10 })}>
                  <ClassPreview characterClass={hoveredClass} disableHover={true} />
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
        onImageUpdated={(cardId, imageUrl) => {
          setCards(rows => rows.map(row => row.id === cardId ? { ...row, image_url: imageUrl } : row));
          setSelectedCard(row => row?.id === cardId ? { ...row, image_url: imageUrl } : row);
        }}
      />

      {/* Модальное окно с детальной информацией об эффекте */}
      {(hoveredEffect || hoveredAction || hoveredResource || hoveredVariable) && viewMode === 'list' && (
        <div ref={previewPositionRef} className="fixed z-50 entity-preview-enter" style={previewStyle({ left: -10_000, top: 10 })}>
          {hoveredEffect && contentType === 'effects' && <EffectPreview effect={hoveredEffect} disableHover />}
          {hoveredAction && contentType === 'actions' && <ActionPreview action={hoveredAction} resources={resourceOptions} disableHover />}
          {hoveredResource && contentType === 'resources' && <ResourcePreview resource={hoveredResource} disableHover />}
          {hoveredVariable && contentType === 'variables' && <VariablePreview variable={hoveredVariable} disableHover />}
        </div>
      )}

      <EffectDetailModal
        effect={selectedEffect}
        isOpen={isEffectModalOpen}
        onClose={handleCloseEffectModal}
        onDelete={handleDeleteEffect}
      />

      {/* Модальное окно с детальной информацией о действии */}
      <ActionDetailModal
        action={selectedAction}
        isOpen={isActionModalOpen}
        onClose={handleCloseActionModal}
        onDelete={handleDeleteAction}
      />

      {/* Модальное окно с детальной информацией о заклинании */}
      <SpellDetailModal
        spell={selectedSpell}
        isOpen={isSpellModalOpen}
        onClose={handleCloseSpellModal}
        onDelete={handleDeleteSpell}
        onUpdated={handleSpellUpdated}
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

      <RaceDetailModal
        race={selectedRace}
        isOpen={isRaceModalOpen}
        onClose={() => { setIsRaceModalOpen(false); setSelectedRace(null); }}
        onDelete={handleDeleteRace}
      />

      <ClassDetailModal
        characterClass={selectedClass}
        isOpen={isClassModalOpen}
        onClose={() => { setIsClassModalOpen(false); setSelectedClass(null); }}
        onDelete={handleDeleteClass}
      />

      <ConceptDetailModal
        concept={selectedConcept}
        isOpen={isConceptModalOpen}
        onClose={() => { setIsConceptModalOpen(false); setSelectedConcept(null); }}
        onDelete={handleDeleteConcept}
      />

      <ResourceDetailModal
        resource={selectedResource}
        isOpen={isResourceModalOpen}
        onClose={() => { setIsResourceModalOpen(false); setSelectedResource(null); }}
        onDelete={handleDeleteResource}
      />

      <VariableDetailModal
        variable={selectedVariable}
        isOpen={isVariableModalOpen}
        onClose={() => { setIsVariableModalOpen(false); setSelectedVariable(null); }}
        onDelete={handleDeleteVariable}
      />
      </div>
    </div>
  );
};

export default CardLibrary;
