import ForgeEntitySelection from '../components/forge/ForgeEntitySelection';
import ForgeEntityIcon from '../components/forge/ForgeEntityIcon';
import { previewAnchor } from '../utils/previewAnchor';
import { useDeferredValue, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, User, Swords, Shield, ScrollText, Star, Zap, Sparkles, FileText, Settings, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import ForgeTokenDialog from '../components/forge/ForgeTokenDialog';
import { racesApi, classesApi, backgroundsApi, featsApi, spellsApi } from '../api/client';
import type { Race, CharacterClass, Background, Feat, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { characterV3ErrorMessage, charactersV3Api, type PatchCharacterRuntimeRequest } from '../character/api';
import { roguelikeApi } from '../roguelike/api';
import { runHasCharacter } from '../roguelike/navigation';
import { buildCharacterContext } from '../character/runtime';
import { buildResourceRuntimePatch, resourceMaximumBreakdown, syncRuntimeResources } from '../character/resourceInit';
import { projectCharacterStartingEquipmentPatch } from '../character/startingEquipment';
import { runtimeSeedFromSavePayload, saveCharacter } from '../character/saveCharacter';
import { maxAvailableSpellSlotLevel, resolveByLevel } from '../engine/resources';
import { useResourceOptions } from '../utils/resources';
import {
  assemble,
  bundleDependencyKey,
  loadBundle,
  type EntityBundle,
  type AssembledCharacter,
} from '../character/assemble';
import {
  emptyDraft,
  ABILITY_KEYS,
  isCharacterReadOnly,
  type AbilityBonuses,
  type CharacterDraft,
  type AbilityKey,
  type ForgeCharacter,
  type SaveForgeCharacterRequest,
} from '../character/types';
import { bonusOf, reapplyBonuses, reconcileBonusesForBackground } from '../character/pointBuy';
import { computeMulticlassMaxHP } from '../character/derive';
import { addClassLevel, draftClassLevels, multiclassPrerequisiteIssues, normalizedSubclassIds, subclassSelectionIssues } from '../character/multiclass';
import {
  buildSavePayload,
  completionIssues,
  classSkillChoice,
  characterToDraft,
  featOwnedChoicesForSelections,
  levelUpChoicesToShow,
  levelUpReplacementAllowed,
  levelUpReplacementLimits,
  applyForgeResolvedChoices,
  requiredChoiceIssues,
  resolveLineageName,
} from '../character/forgeHelpers';
import { unavailableChoiceOptions } from '../character/choiceAvailability';
import { normalizeSkillId, normalizeSkillList } from '../character/skillNormalize';
import { getSkillGrantSource, grantReason, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState } from '../character/rules/types';
import {
  ForgeNav,
  SummaryPanel,
  ChoiceResolver,
  AbilityAssigner,
  choiceOptionIdByReference,
  featForChoiceOption,
  optionsForChoice,
  recommendedOptionSelection,
  useAutoRecommendedChoices,
  type ForgeSectionDef,
} from '../character/components';
import { useIsMobile } from '../hooks/useIsMobile';
import EntitySquareCard from '../components/forge/EntitySquareCard';
import SheetSettingsDialog from '../components/SheetSettingsDialog';
import ForgeAbilityDisplay from '../components/forge/ForgeAbilityDisplay';
import SheetEntityRow from '../components/SheetEntityRow';
import { spellDetail } from '../components/forge/ForgeSpellIconGrid';
import ForgeTraitsBlock from '../components/forge/ForgeTraitsBlock';
import { useSiteSettings } from '../settings';
import ForgeOriginAbilities from '../components/forge/ForgeOriginAbilities';
import RacePreview from '../components/RacePreview';
import ClassPreview from '../components/ClassPreview';
import BackgroundPreview from '../components/BackgroundPreview';
import SpellPreview from '../components/SpellPreview';
import FeatPreview from '../components/FeatPreview';
import ForgeFeatLine from '../components/forge/ForgeFeatLine';
import { BackgroundEquipment } from '../components/BackgroundEquipment';
import { collectChosenSpellUuids, indexSpells } from '../engine/spellRefs';
import { preparedSpellChoiceAllowsOwnedOption, spellMatchesChoice } from '../character/spellChoices';
import { isEntityUuid } from '../engine/ids';
import { isSpellSelectionChoice, requiresInitialCharacterChoice, type PendingChoice } from '../mechanics/collectChoices';
import { labelOf, SKILLS, ABILITIES } from '../mechanics/registries';
import { FormattedText } from '../utils/formattedText';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { CharacterFormulaProvider, formulaCtxFromCharacter } from '../contexts/CharacterFormulaContext';
import { loadCatalogPages } from '../api/catalogPages';
import { equipmentWeaponMasterySeed, weaponTypesFromEquipmentOption } from '../character/equipmentWeaponMastery';
import { getCardsIndex } from '../utils/cardsIndex';
import {useChoiceDialog} from '../contexts/ChoiceDialogContext';
import {levelUpChoiceSelectionLabels, levelUpDialogChoice, levelUpReturnURL} from '../character/levelUpChoices';
import {levelUpResourceGains, levelUpResourceOptions, type LevelUpSpellGrantSnapshot} from '../character/levelUpPresentation';
import {forgeChoiceUnavailableOptions} from '../character/forgeChoiceAvailability';
import LevelUpChoiceButton from '../components/forge/LevelUpChoiceButton';
import LevelUpSubclassAbilities from '../components/forge/LevelUpSubclassAbilities';
import LevelUpResourceGains from '../components/forge/LevelUpResourceGains';
import LevelUpSpellGrants from '../components/forge/LevelUpSpellGrants';
import SubclassProgressionDialog from '../components/forge/SubclassProgressionDialog';
import { loadPaperIdentityAssembly } from '../paper-sheet/loadPaperIdentityAssembly';
import './CharacterForge.css';

const EMPTY_BUNDLE: EntityBundle = { race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [] };

// Автосейв черновика создания в localStorage (F5/«назад» не теряет выборы).
const FORGE_DRAFT_KEY = 'forge-draft';
const isDraftMeaningful = (d: CharacterDraft) =>
  !!(d.name?.trim() || d.lineageId || d.raceId || d.classId || d.backgroundId || d.featIds?.length);

// Вкладка «Общее» мобильного таб-бара = правый обзор (E6, сквозной шелл).
const FORGE_OVERVIEW_ID = 'overview';

export interface PaperForgeSaveInput {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  payload: SaveForgeCharacterRequest;
  initialRuntime?: PatchCharacterRuntimeRequest;
}

export interface PaperForgeSession {
  draft: CharacterDraft;
  documentId?: string;
  anonymous?: boolean;
  /** The saved, pre-upgrade draft; independent of the in-progress selections. */
  levelUpFrom?: CharacterDraft;
  returnURL: string;
  onDraftChange: (draft: CharacterDraft) => void;
  onSave: (input: PaperForgeSaveInput) => Promise<void>;
}

export interface CharacterForgeProps { paperMode?: boolean; paperSession?: PaperForgeSession }

const CharacterForge = ({ paperMode = false, paperSession }: CharacterForgeProps = {}) => {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const editId = paperMode ? undefined : routeId;
  const [routeSearchParams] = useSearchParams();
  // Paper documents have no run membership or interactive-character runtime.
  const searchParams = paperMode ? new URLSearchParams() : routeSearchParams;
  const { entityDisplay } = useSiteSettings();
  const choiceDialog = useChoiceDialog();

  // Справочники сущностей
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [catalogsReady, setCatalogsReady] = useState(false);
  const [spellCatalogReady, setSpellCatalogReady] = useState(false);

  const [draft, setDraft] = useState<CharacterDraft>(() => paperMode && paperSession ? { ...structuredClone(paperSession.draft), id: undefined } : emptyDraft());
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const paperSaveGeneration = useRef(0);
  useEffect(() => () => { paperSaveGeneration.current += 1; }, []);
  const [restorable, setRestorable] = useState<CharacterDraft | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<{
    refsKey: string;
    value: EntityBundle;
  } | null>(null);
  const bundleCacheRef = useRef(new Map<string, Promise<EntityBundle>>());
  const [active, setActive] = useState('race');
  const isMobile = useIsMobile();
  /** Режим повышения уровня: показываем только новое, база заблокирована. */
  const [levelUp, setLevelUp] = useState<{ fromLevel: number; fromClassLevels: Record<string, number>; selectedClassId: string; committed?: boolean } | null>(() => {
    const from = paperMode ? paperSession?.levelUpFrom : undefined;
    if (!from) return null;
    const fromClassLevels = draftClassLevels(from);
    const selectedClassId = Object.entries(draftClassLevels(paperSession!.draft))
      .find(([id, count]) => count > (fromClassLevels[id] ?? 0))?.[0] ?? from.classId ?? '';
    return { fromLevel: from.level, fromClassLevels, selectedClassId };
  });
  const [prevRefs, setPrevRefs] = useState<{
    effects: Set<string>;
    actions: Set<string>;
    choiceIds: Set<string>;
    choiceCounts: Map<string, number>;
    choiceLevels: Map<string, number>;
    maxHP: number;
    maxResources: Record<string, number>;
    spellGrants: LevelUpSpellGrantSnapshot;
  } | null>(null);
  const originalLevelChoices = useRef<Record<string, string[]>>(structuredClone(paperSession?.levelUpFrom?.resolvedChoices ?? {}));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subclassComparisonOpen, setSubclassComparisonOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paper] = useState<boolean>(() => {
    try { return localStorage.getItem('forge-theme') === 'paper'; } catch { return false; }
  });
  const savedSkillsRef = useRef<string[]>([]);
  const restoredClassSkillsRef = useRef(false);
  const classSkillAutoSeededForRef = useRef<string | null>(null);
  // HP существующего персонажа при редактировании — чтобы правка посреди сессии
  // не восстанавливала хиты (E3). null = создание нового (полный HP).
  const savedHpRef = useRef<number | null>(null);
  const savedMaxHpRef = useRef<number | null>(null);

  // Загрузка справочников. При сбое сети — честный баннер + повтор (иначе
  // игрок видит враньё «Нет видов в базе» вместо ошибки).
  const catalogRequest = useRef(0);
  const loadCatalogs = useCallback(async () => {
    const request = ++catalogRequest.current;
    setCatalogError(false);
    setCatalogsReady(false);
    try {
      const [rr, cc, bb, ff] = await Promise.all([
        loadCatalogPages((page: number) => racesApi.getRaces({ page, limit: 100, fields: 'list' }), 'races', true, () => request === catalogRequest.current),
        loadCatalogPages((page: number) => classesApi.getClasses({ page, limit: 100, fields: 'list' }), 'classes', true, () => request === catalogRequest.current),
        loadCatalogPages((page: number) => backgroundsApi.getBackgrounds({ page, limit: 100, fields: 'list' }), 'backgrounds', true, () => request === catalogRequest.current),
        loadCatalogPages((page: number) => featsApi.getFeats({ page, limit: 200, fields: 'list' }), 'feats', true, () => request === catalogRequest.current),
      ]);
      if (request !== catalogRequest.current) return;
      setRaces(rr.races || []);
      setClasses(cc.classes || []);
      setBackgrounds(bb.backgrounds || []);
      // Все черты: origin — для смены черты происхождения, fighting_style
      // и другие категории — как варианты choice(source:"feat").
      setFeats(ff.feats || []);
      setCatalogsReady(true);
    } catch (e) {
      if (request !== catalogRequest.current) return;
      console.error(e);
      setCatalogError(true);
    }
  }, []);
  useEffect(() => { void loadCatalogs(); return () => { catalogRequest.current += 1; }; }, [loadCatalogs]);

  // A fresh level-1 Forge used to download every spell in the database.
  // Load only cantrips and levels the current character can reach; the cap
  // grows automatically during level-up and official 2024 player spells end
  // at level 9.
  const forgeSpellLevelCap = Math.min(9, Math.max(1, Math.ceil((draft.level || 1) / 2)));
  useEffect(() => {
    let stale = false;
    setSpellCatalogReady(false);
    loadCatalogPages((page: number) => spellsApi.getSpells({ page, limit: 500, max_level: forgeSpellLevelCap, fields: 'list' }), 'spells', true, () => !stale)
      .then((response) => { if (!stale) { setSpells(response.spells || []); setSpellCatalogReady(true); } })
      .catch((reason) => {
        console.error(reason);
        if (!stale) setCatalogError(true);
      });
    return () => { stale = true; };
  }, [forgeSpellLevelCap, catalogRetry]);

  const visibleRaces = races;
  const visibleClasses = classes;
  const visibleBackgrounds = backgrounds;
  const visibleSpells = spells;
  // При входе в режим создания — предложить восстановить сохранённый черновик.
  useEffect(() => {
    if (paperMode) return;
    if (editId) { setRestorable(null); return; }
    try {
      const raw = localStorage.getItem(FORGE_DRAFT_KEY);
      if (!raw) return;
      const parsed = { ...emptyDraft(), ...(JSON.parse(raw) as Partial<CharacterDraft>) };
      if (isDraftMeaningful(parsed)) setRestorable(parsed);
    } catch { /* ignore */ }
  }, [editId, paperMode]);

  const draftHadChoices = useRef(false);
  // Не затираем ожидающий восстановления черновик пустым состоянием при входе.
  // После реального выбора сохраняем и его отмену, даже если черновик стал пустым.
  useEffect(() => {
    if (paperMode) { paperSession?.onDraftChange(draft); return; }
    if (editId) return;
    const meaningful = isDraftMeaningful(draft);
    if (!meaningful && !draftHadChoices.current) return;
    if (meaningful) draftHadChoices.current = true;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(FORGE_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, editId, paperMode, paperSession?.onDraftChange]);

  // Переход «редактирование → создание» без размонтирования (те же роуты
  // /character-forge/:id и /character-forge): сбросить черновик, иначе
  // сохранение перезапишет предыдущего персонажа.
  useEffect(() => {
    if (paperMode) return;
    if (editId) return;
    setDraft(emptyDraft());
    setSavedId(null);
    savedSkillsRef.current = [];
    restoredClassSkillsRef.current = false;
    savedHpRef.current = null;
    savedMaxHpRef.current = null;
  }, [editId, paperMode]);

  // Загрузка существующего черновика для редактирования.
  // ?levelup=1 (кнопка «Поднять уровень» на листе) — особый режим: +1 уровень,
  // показываются только новые умения и выборы (раса/класс/предыстория заблокированы).
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c = await charactersV3Api.get(editId);
        const runId = searchParams.get('roguelike');
        const run = runId ? await roguelikeApi.get(runId) : null;
        if (run && (!runHasCharacter(run, c.id) || run.status !== 'active' || run.phase !== 'camp')) {
          throw new Error('Повышение уровня недоступно в текущем состоянии забега');
        }
        if (isCharacterReadOnly(c)) {
          navigate(`/characters-v3/${c.id}`, {
            replace: true,
            state: { notice: 'Архивный публичный лист доступен только для чтения.' },
          });
          return;
        }
        savedSkillsRef.current = c.skill_proficiencies || [];
        savedHpRef.current = c.current_hp ?? null;
        savedMaxHpRef.current = c.max_hp ?? null;
        restoredClassSkillsRef.current = false;
        const d = characterToDraft(c);
        if (searchParams.get('levelup') === '1') {
          originalLevelChoices.current = structuredClone(d.resolvedChoices);
          const fromLevel = run?.pending_level ? run.pending_level - 1 : d.level || 1;
          const fromClassLevels = draftClassLevels(d);
          if (run?.pending_level && d.classId) fromClassLevels[d.classId] = fromLevel;
          d.level = Math.min(20, fromLevel + 1);
          if (d.classId && fromLevel < 20) d.classLevels = addClassLevel({ ...d, level: fromLevel, classLevels: fromClassLevels }, d.classId);
          setLevelUp({ fromLevel, fromClassLevels, selectedClassId: d.classId ?? '', committed: !!run?.pending_level });
        }
        setDraft(d);
      } catch (e) {
        console.error(e);
        setError(characterV3ErrorMessage(e, 'Не удалось загрузить персонажа'));
      }
    })();

  }, [editId, navigate]);

  // Асинхронный bundle зависит только от прямых ссылок и тех data-driven
  // choice, которые способны прикрепить новые эффекты/черты. Обычные выборы
  // навыков/заклинаний/языков остаются синхронной проекцией и не перезагружают
  // весь граф сущностей.
  const refsKey = bundleDependencyKey(draft, loadedBundle?.value);
  const bundleReady = loadedBundle?.refsKey === refsKey;
  // Во время разрешения нового графа сохраняем предыдущую проекцию на экране:
  // кнопка сохранения закрыта через bundleReady, но кузня больше не моргает пустым
  // состоянием между каждым кликом.
  const bundle = loadedBundle?.value ?? null;
  useEffect(() => {
    let stale = false;
    const draftSnapshot = draft;
    let request = bundleCacheRef.current.get(refsKey);
    if (!request) {
      request = loadBundle(draftSnapshot);
      bundleCacheRef.current.set(refsKey, request);
      // Forge-сессия короткая; ограничиваем кэш последними вариантами, чтобы
      // перебор множества черт не удерживал весь каталог до закрытия страницы.
      if (bundleCacheRef.current.size > 32) {
        const oldest = bundleCacheRef.current.keys().next().value;
        if (oldest) bundleCacheRef.current.delete(oldest);
      }
    }
    void request.then((value) => {
      if (stale) return;
      // Первый запрос мог стартовать до того, как были известны динамические
      // choice-id. Кэшируем и под окончательным ключом, чтобы не делать второй
      // идентичный проход после обнаружения деклараций в загруженном bundle.
      const resolvedKey = bundleDependencyKey(draftSnapshot, value);
      bundleCacheRef.current.set(resolvedKey, Promise.resolve(value));
      setLoadedBundle({ refsKey: resolvedKey, value });
    }).catch((reason) => {
      // Rejected promises must not poison the session cache: the next render or
      // retry should perform a fresh read after a transient backend failure.
      if (bundleCacheRef.current.get(refsKey) === request) {
        bundleCacheRef.current.delete(refsKey);
      }
      if (!stale) {
        console.error('forge bundle', reason);
        setError(characterV3ErrorMessage(reason, 'Не удалось загрузить данные персонажа'));
        if (paperMode) setCatalogError(true);
      }
    });
    return () => { stale = true; };

  }, [refsKey, catalogRetry, paperMode]);

  const spellIndex = useMemo(() => indexSpells(spells), [spells]);

  const baseAssembled = useMemo(
    () => assemble({ ...(bundle ?? EMPTY_BUNDLE), spells: [] }, draft),
    [bundle, draft],
  );

  const chosenSpellUuids = useMemo(
    () => collectChosenSpellUuids(draft, baseAssembled),
    [draft, baseAssembled],
  );

  const persistedSpells = useMemo(() => {
    const list: Spell[] = [];
    for (const id of chosenSpellUuids) {
      const s = spellIndex.byId.get(id);
      if (s) list.push(s);
    }
    return list;
  }, [chosenSpellUuids, spellIndex]);

  const assembled: AssembledCharacter = useMemo(
    () => ({ ...baseAssembled, spells: persistedSpells }),
    [baseAssembled, persistedSpells],
  );
  const visibleFeats = feats;
  const ruleState = useMemo(
    () => resolveCharacterRules({ draft, assembled }),
    [draft, assembled],
  );
  const formulaCtx = useMemo(
    () => formulaCtxFromCharacter(buildCharacterContext(ruleState, draft, [], assembled.klass)),
    [ruleState, draft, assembled.klass],
  );
  const spellChoices = assembled.pendingChoices.filter((pc) => (
    isSpellSelectionChoice(pc) && requiresInitialCharacterChoice(pc)
  ));
  // Максимальный доступный круг ячеек (для choice-фильтра only_available_slots): считаем max-пулы
  // персонажа и берём наибольший spell_slot_N/warlock_slot. Нативно даёт колдунам их пактовый круг.
  const maxSlotLevel = useMemo(
    () => {
      const runtimeLevel = maxAvailableSpellSlotLevel(
        syncRuntimeResources(buildCharacterContext(ruleState, draft, [], assembled.klass), assembled, undefined, ruleState.freeuseSpells).maxResources,
      );
      // During an unresolved level-up choice the rules projection is
      // intentionally incomplete, but the class resource table is already
      // authoritative. Read it directly as a fallback so Warlock's recurring
      // only_available_slots choice does not collapse to an empty catalog.
      const levels = draftClassLevels(draft);
      let declaredLevel = 0;
      for (const klass of assembled.classes ?? (assembled.klass ? [assembled.klass] : [])) {
        const classLevel = levels[klass.id] ?? 0;
        for (const [key, raw] of Object.entries(klass.resources ?? {})) {
          const match = /^(?:spell_slot|warlock_spell_slot|pact_slot)_(\d+)$/.exec(key);
          if (!match || !raw || typeof raw !== 'object') continue;
          const resource = raw as { by_level?: unknown; count?: number; max?: number };
          const available = resolveByLevel(resource.by_level, classLevel)
            ?? Number(resource.max ?? resource.count ?? 0);
          if (available > 0) declaredLevel = Math.max(declaredLevel, Number(match[1]));
        }
      }
      return Math.max(runtimeLevel, declaredLevel);
    },
    [ruleState, draft, assembled],
  );
  const resourceOptions = useResourceOptions();

  const [resolvedGrantedSpells, setResolvedGrantedSpells] = useState<Spell[]>([]);

  useEffect(() => {
    const slugs = ruleState.spells.known.filter((s) => !isEntityUuid(s));
    if (!slugs.length) {
      setResolvedGrantedSpells([]);
      return;
    }
    let stale = false;
    (async () => {
      const byId = new Map<string, Spell>();
      for (const slug of slugs) {
        const cached = spellIndex.bySlug.get(slug);
        if (cached) { byId.set(cached.id, cached); continue; }
        try {
          const s = await spellsApi.getSpell(slug);
          if (s?.id) byId.set(s.id, s);
        } catch { /* slug не найден */ }
      }
      if (!stale) setResolvedGrantedSpells([...byId.values()]);
    })();
    return () => { stale = true; };
  }, [ruleState.spells.known, spellIndex]);

  const grantedSpells = resolvedGrantedSpells;

  const selectedSpells = useMemo(() => {
    const byId = new Map<string, Spell>();
    for (const s of [...grantedSpells, ...persistedSpells]) byId.set(s.id, s);
    return [...byId.values()];
  }, [grantedSpells, persistedSpells]);
  const selectedSpellCount = useMemo(
    () => spellChoices.reduce((sum, pc) => sum + (draft.resolvedChoices[pc.id]?.length ?? 0), 0),
    [spellChoices, draft.resolvedChoices],
  );
  const requiredSpellCount = useMemo(
    () => spellChoices.reduce((sum, pc) => sum + pc.count, 0),
    [spellChoices],
  );
  const spellsDone = spellChoices.length === 0 || selectedSpellCount >= requiredSpellCount;

  // ── Выборы, сгруппированные по назначению вкладок ──
  const subfeatureChoice = useMemo(
    () => assembled.pendingChoices.find((pc) => pc.origin.kind === 'race' && pc.source === 'subfeature'),
    [assembled.pendingChoices],
  );
  const classSubfeatureChoice = useMemo(
    () => assembled.pendingChoices.find((pc) => pc.origin.kind === 'class' && pc.source === 'subfeature'),
    [assembled.pendingChoices],
  );

  // Синхронизация lineage_id из subfeature-выбора вида
  useEffect(() => {
    if (!subfeatureChoice) return;
    const sel = draft.resolvedChoices[subfeatureChoice.id]?.[0] ?? null;
    if (sel !== draft.lineageId) setDraft((d) => ({ ...d, lineageId: sel }));

  }, [subfeatureChoice, draft.resolvedChoices]);

  // Фоллбэк: если в драфте нет навыков класса (старые сохранения без builder:class_skills
  // и без choiceId в appliedGrants) — восстановить из skill_proficiencies ∩ список класса,
  // исключая фиксированные навыки предыстории (иначе конфликт вроде Артист/Воин вернётся).
  useEffect(() => {
    if (!editId || restoredClassSkillsRef.current || !bundleReady || !bundle?.klass) return;
    if (draft.classSkillChoices.length) {
      restoredClassSkillsRef.current = true;
      return;
    }
    const sc = classSkillChoice(assemble({ ...bundle, spells: [] }, draft));
    if (!sc?.options.length) {
      restoredClassSkillsRef.current = true;
      return;
    }
    const opts = new Set(sc.options.map(normalizeSkillId));
    const bgSkills = new Set(normalizeSkillList(bundle.background?.skill_proficiencies));
    const classSkills = normalizeSkillList(savedSkillsRef.current)
      .filter((s) => opts.has(s) && !bgSkills.has(s));
    if (classSkills.length) setDraft((d) => ({ ...d, classSkillChoices: classSkills }));
    restoredClassSkillsRef.current = true;
  }, [editId, bundleReady, bundle?.klass, draft.classId, draft.classSkillChoices.length]);

  // ─── Апдейтеры черновика ───────────────────────────────────────────────────
  const patch = (p: Partial<CharacterDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setResolved = useCallback((choiceId: string, vals: string[]) => {
    setDraft((d) => applyForgeResolvedChoices(d, { [choiceId]: vals }, assembled.pendingChoices));
  }, [assembled.pendingChoices]);
  const setResolvedBatch = useCallback((values: Record<string, string[]>) => {
    setDraft((d) => applyForgeResolvedChoices(d, values, assembled.pendingChoices));
  }, [assembled.pendingChoices]);
  const recommendedChoicePolicy = useMemo(() => {
    const featByReference = new Map(feats.flatMap((feat) => (
      [[feat.id, feat.id], [feat.card_number, feat.id]] as const
    )));
    const spellByReference = new Map(spells.flatMap((spell) => (
      [[spell.id, spell.id], [spell.card_number, spell.id]] as const
    )));
    const choiceOptions = (choice: PendingChoice) => (
      isSpellSelectionChoice(choice)
        ? spells
            .filter((spell) => spellMatchesChoice(spell, choice, maxSlotLevel))
            .map((spell) => ({
              id: spell.id,
              label: spell.name,
              aliases: [spell.card_number],
            }))
        : optionsForChoice(choice, feats)
    );
    return {
      optionIds: (choice: PendingChoice) => choiceOptions(choice).map((option) => option.id),
      canonicalOptionId: (choice: PendingChoice, reference: string) => (
        choiceOptionIdByReference(choiceOptions(choice), reference)
      ),
      unavailableOptions: ({
        choice,
        optionIds,
        selectedOptionIds,
        resolvedChoices,
      }: {
        choice: PendingChoice;
        optionIds: readonly string[];
        selectedOptionIds: readonly string[];
        resolvedChoices: Readonly<Record<string, string[]>>;
      }) => unavailableChoiceOptions(
        choice,
        resolveCharacterRules({
          draft: { ...draft, resolvedChoices: { ...resolvedChoices } },
          assembled,
        }),
        optionIds,
        selectedOptionIds,
        {
          activeFeatIds: new Set(assembled.feats.map((feat) => feat.id)),
          repeatableFeatIds: new Set(feats.filter((feat) => feat.repeatable).map((feat) => feat.id)),
          canonicalFeatId: (reference) => featByReference.get(reference) ?? reference,
          canonicalSpellId: (reference) => spellByReference.get(reference) ?? reference,
        },
      ),
    };
  }, [assembled, draft, feats, maxSlotLevel, spells]);
  // Рекомендованные варианты (recommended в choice-механике) — предвыбираем автоматически,
  // снижая число решений новичку. Покрывает ChoiceList, SpellsSection и выбор заклинаний,
  // т.к. все они читают из assembled.pendingChoices + setResolved.
  useAutoRecommendedChoices(
    bundleReady ? assembled.pendingChoices : [],
    draft.resolvedChoices,
    setResolved,
    setResolvedBatch,
    recommendedChoicePolicy,
  );
  const equipmentMasteryAutoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bundleReady || !assembled.klass) return;
    const masteryChoice = assembled.pendingChoices.find((choice) => (
      choice.grantKind === 'weapon_mastery' && requiresInitialCharacterChoice(choice)
    ));
    if (!masteryChoice) return;
    let stale = false;
    void getCardsIndex().then((cards) => {
      if (stale) return;
      const optionKey = draft.classEquipmentOption === 'b'
        ? 'option_b'
        : draft.classEquipmentOption === 'c' ? 'option_c' : 'option_a';
      const option = assembled.klass?.equipment_options?.[optionKey]
        ?? assembled.klass?.equipment_options?.option_a;
      const weaponTypes = weaponTypesFromEquipmentOption(option, cards);
      const seed = equipmentWeaponMasterySeed({
        choiceId: masteryChoice.id,
        count: masteryChoice.count,
        optionKey: `${assembled.klass?.id}:${draft.classEquipmentOption}`,
        weaponTypes,
        autoFillEnabled: draft.classEquipmentOption === 'a',
        resolved: draft.resolvedChoices,
        previousAutoKey: equipmentMasteryAutoRef.current,
      });
      equipmentMasteryAutoRef.current = seed.autoKey;
      if (seed.next) setResolvedBatch(seed.next);
      else if (seed.clearChoiceId) {
        setDraft((current) => {
          if (!Object.prototype.hasOwnProperty.call(current.resolvedChoices, seed.clearChoiceId!)) {
            return current;
          }
          const resolvedChoices = { ...current.resolvedChoices };
          delete resolvedChoices[seed.clearChoiceId!];
          return { ...current, resolvedChoices };
        });
      }
    });
    return () => { stale = true; };
  }, [
    bundleReady,
    assembled.klass,
    assembled.pendingChoices,
    draft.classEquipmentOption,
    draft.resolvedChoices,
    setResolvedBatch,
  ]);
  const recommendedClassSkillChoice = classSkillChoice(assembled);
  const recommendedClassSkillKey = recommendedClassSkillChoice
    ? `${recommendedClassSkillChoice.count}:${recommendedClassSkillChoice.recommended.join(',')}`
    : '';
  const recommendedMechanicsReady = assembled.pendingChoices
    .filter((choice) => requiresInitialCharacterChoice(choice) && (choice.recommended?.length ?? 0) > 0)
    .every((choice) => Object.prototype.hasOwnProperty.call(draft.resolvedChoices, choice.id));
  useEffect(() => {
    const classId = draft.classId;
    const choice = recommendedClassSkillChoice;
    if (
      !classId
      || !choice
      || !bundleReady
      || !recommendedMechanicsReady
      || assembled.klass?.id !== classId
      || classSkillAutoSeededForRef.current === classId
    ) return;
    // Existing/edit-mode choices are authoritative. Once observed, clearing
    // them is a player action and must not trigger another auto-fill.
    if (draft.classSkillChoices.length) {
      classSkillAutoSeededForRef.current = classId;
      return;
    }
    const seed = choice.recommended.length
      ? recommendedOptionSelection({
          count: choice.count,
          recommended: choice.recommended,
          optionIds: choice.options,
          unavailable: (skill) => Boolean(getSkillGrantSource(ruleState, skill)),
        })
      : [];
    classSkillAutoSeededForRef.current = classId;
    if (seed.length) {
      setDraft((current) => (
        current.classId === classId && current.classSkillChoices.length === 0
          ? { ...current, classSkillChoices: seed }
          : current
      ));
    }
  }, [
    draft.classId,
    draft.classSkillChoices.length,
    bundleReady,
    recommendedMechanicsReady,
    assembled.klass?.id,
    recommendedClassSkillKey,
    ruleState,
  ]);
  // Ручная правка (+/− point-buy, ручной ввод) — помечает характеристики
  // «тронутыми»: смена класса их больше не перезаписывает.
  const setAbility = useCallback((k: AbilityKey, v: number | undefined) => {
    setDraft((d) => {
      const abilities = { ...d.abilities };
      if (v === undefined) delete abilities[k]; else abilities[k] = v;
      return { ...d, abilities, abilitiesTouched: true };
    });
  }, []);
  // Массовые операции (рекомендация класса, сброс, пересчёт бонусов) — не «трогают».
  const setAbilities = useCallback((abilities: Partial<Record<AbilityKey, number>>) => {
    setDraft((d) => ({ ...d, abilities }));
  }, []);
  const toggleFeat = (fid: string) => {
    const removing = draft.featIds.includes(fid);
    patch({ featIds: removing ? draft.featIds.filter((x) => x !== fid) : [fid] });
  };
  const selectRace = (rid: string) => {
    patch({ raceId: rid, lineageId: null });
  };
  const beginRaceChange = () => {
    setDraft(d => ({...d, raceId:null, lineageId:null, resolvedChoices:{...d.resolvedChoices,
      ...Object.fromEntries(raceChoices.map(choice => [choice.id, []]))}}));
  };
  const beginLineageChange = () => setDraft(d=>({...d,lineageId:null,resolvedChoices:{...d.resolvedChoices,
    ...Object.fromEntries(raceChoices.filter(choice=>choice.origin.id===d.lineageId||choice.source==='subfeature').map(choice=>[choice.id,[]]))}}));
  const beginClassChange = () => {
    classSkillAutoSeededForRef.current=null;
    setDraft(d=>({...d,classId:null,classLevels:{},subclassId:null,subclassIds:{},classSkillChoices:[],resolvedChoices:{...d.resolvedChoices,
      ...Object.fromEntries(classChoices.map(choice=>[choice.id,[]]))}}));
  };
  const beginSubclassChange = () => setDraft(d=>{
    const subclassIds={...normalizedSubclassIds(d.subclassIds,d.classId,d.subclassId)};
    if(d.classId)delete subclassIds[d.classId];
    return {...d,subclassId:null,subclassIds,resolvedChoices:{...d.resolvedChoices,
      ...Object.fromEntries(classChoices.filter(choice=>choice.origin.id===d.subclassId||choice.source==='subfeature').map(choice=>[choice.id,[]]))}};
  });
  const selectLineage = (id: string) => {
    const removing = draft.lineageId === id;
    patch({ lineageId: removing ? null : id });
  };
  const selectSubclass = (id: string, ownerClassId: string | null = draft.classId) => {
    if (!ownerClassId) return;
    const current = normalizedSubclassIds(draft.subclassIds, draft.classId, draft.subclassId);
    const removing = current[ownerClassId] === id;
    const subclassIds = { ...current };
    if (removing) delete subclassIds[ownerClassId]; else subclassIds[ownerClassId] = id;
    patch({
      subclassIds,
      ...(ownerClassId === draft.classId ? { subclassId: removing ? null : id } : {}),
    });
  };
  const selectClass = (cid: string) => {
    classSkillAutoSeededForRef.current = null;
    setDraft((d) => {
      const next = { ...d, classId: cid, classLevels: { [cid]: Math.max(1, d.level) }, subclassIds: {}, subclassId: null, classSkillChoices: [] as string[] };
      // Оптимальный расклад класса применяется при каждой смене класса,
      // пока игрок не правил характеристики вручную (решение №2).
      const rec = classes.find((c) => c.id === cid)?.recommended_abilities;
      if (!d.abilitiesTouched && rec) {
        const abilities: Partial<Record<AbilityKey, number>> = {};
        for (const k of ABILITY_KEYS) {
          const base = rec[k];
          if (typeof base === 'number') abilities[k] = base + bonusOf(d.abilityBonuses, k);
        }
        next.abilities = abilities;
      }
      return next;
    });
  };

  const selectLevelUpClass = (cid: string) => {
    if (!levelUp) return;
    setLevelUp((state) => state ? { ...state, selectedClassId: cid } : state);
    setPrevRefs(null);
    setDraft((current) => ({
      ...current,
      level: levelUp.fromLevel + 1,
      classLevels: addClassLevel({ ...current, level: levelUp.fromLevel, classLevels: levelUp.fromClassLevels }, cid),
    }));
  };
  const selectBackground = (bid: string) => {
    setDraft((d) => {
      const next = { ...d, backgroundId: bid };
      // KB-112/113: согласуем бонусы с НОВОЙ предысторией — снимаем назначения на её чужие
      // характеристики (иначе оставались бы вне списка) и авто-дефолтим +2/+1, если пусто.
      const bg = backgrounds.find((b) => b.id === bid);
      const bgAbilities = (bg?.ability_scores || []) as AbilityKey[];
      const bonuses = reconcileBonusesForBackground(d.abilityBonuses, bgAbilities);
      next.abilityBonuses = bonuses;
      next.abilities = reapplyBonuses(d.abilities, d.abilityBonuses, bonuses);
      return next;
    });
  };
  const beginBackgroundChange = () => {
    setDraft(current => {
      const bonuses = { ...current.abilityBonuses, assignments: {} };
      const resolvedChoices = { ...current.resolvedChoices };
      for (const choice of assembled.pendingChoices) if (choice.origin.kind === 'background' && choice.origin.id === current.backgroundId) delete resolvedChoices[choice.id];
      return { ...current, backgroundId: null, swapFeat: false,
        featIds: current.swapFeat ? [] : current.featIds, equipmentOption: 'a',
        abilityBonuses: bonuses, abilities: reapplyBonuses(current.abilities, current.abilityBonuses, bonuses), resolvedChoices };
    });
  };
  const setBonuses = useCallback((bonuses: AbilityBonuses) => {
    setDraft((d) => ({ ...d, abilityBonuses: bonuses }));
  }, []);
  const toggleClassSkill = (skill: string) => {
    const sc = classSkillChoice(assembled);
    const has = draft.classSkillChoices.includes(skill);
    if (has) { patch({ classSkillChoices: draft.classSkillChoices.filter((x) => x !== skill) }); return; }
    if (getSkillGrantSource(ruleState, skill)) return;
    const max = sc?.count ?? 99;
    const next = draft.classSkillChoices.length >= max
      ? [...draft.classSkillChoices.slice(1), skill]
      : [...draft.classSkillChoices, skill];
    patch({ classSkillChoices: next });
  };

  // Диф уровня: какие эффекты/действия были ДО повышения (для показа только нового).
  useEffect(() => {
    if (!levelUp || !draft.classId) return;
    if (paperMode) setPrevRefs(null);
    let stale = false;
    (async () => {
      const oldDraft = paperMode && paperSession?.levelUpFrom
        ? paperSession.levelUpFrom
        : { ...draft, level: levelUp.fromLevel, classLevels: levelUp.fromClassLevels };
      const oldBundle = await loadBundle(oldDraft);
      if (stale) return;
      // Идентификаторы выборов, существовавших НА СТАРОМ уровне — чтобы на уровень-апе отличать
      // выборы этого уровня (их показываем даже заполненными, #3) от прежних.
      const oldAssembled = assemble({ ...oldBundle, spells: [] }, oldDraft);
      const prevChoiceIds = new Set(oldAssembled.pendingChoices.map((pc) => pc.id));
      const oldRules = resolveCharacterRules({draft: oldDraft, assembled: oldAssembled});
      const oldContext = buildCharacterContext(oldRules, oldDraft, [], oldAssembled.klass);
      const oldRuntime = syncRuntimeResources(oldContext, oldAssembled, undefined, oldRules.freeuseSpells);
      setPrevRefs({
        effects: new Set(oldBundle.effects.map((e) => e.effect.id)),
        actions: new Set(oldBundle.actions.map((a) => a.action.id)),
        choiceIds: prevChoiceIds,
        choiceCounts: new Map(oldAssembled.pendingChoices.map((pc) => [pc.id, pc.count])),
        choiceLevels: new Map(oldAssembled.pendingChoices.map((pc) => [pc.id, pc.origin.owningClassLevel ?? 0])),
        maxHP: oldRules.maxHP,
        maxResources: oldRuntime.maxResources,
        spellGrants: {assembled:oldAssembled, grants:oldRules.appliedGrants, context:oldContext},
      });
    })().catch((cause) => {
      if (stale) return;
      console.error('forge previous level', cause);
      setError(characterV3ErrorMessage(cause, 'Не удалось загрузить предыдущий уровень'));
      if (paperMode) setCatalogError(true);
    });
    return () => { stale = true; };

  }, [levelUp?.fromLevel, levelUp?.selectedClassId, draft.classId, draft.raceId, paperMode, paperSession?.levelUpFrom, catalogRetry]);

  const allSubclassIds = useMemo(
    () => normalizedSubclassIds(draft.subclassIds, draft.classId, draft.subclassId),
    [draft.subclassIds, draft.classId, draft.subclassId],
  );
  const subclassSelectionProblems = useMemo(
    () => subclassSelectionIssues(classes, draftClassLevels(draft), allSubclassIds),
    [classes, draft.classId, draft.classLevels, draft.level, allSubclassIds],
  );
  const issues = useMemo(
    () => [
      ...completionIssues(draft, assembled, ruleState),
      ...subclassSelectionProblems.map((issue) => `${issue.className}: выберите допустимый подкласс`),
    ],
    [draft, assembled, ruleState, subclassSelectionProblems],
  );
  const canCreate = bundleReady && (!paperMode || (catalogsReady && spellCatalogReady)) && issues.length === 0;

  const save = async () => {
    if (!bundleReady || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError(null);
    try {
      if (paperMode) {
        if (!paperSession) throw new Error('Не удалось открыть бумажный черновик. Обновите страницу.');
        const generation = ++paperSaveGeneration.current;
        const sourceDraft = draft;
        const checkedDraft = structuredClone({ ...draft, id: undefined });
        const loadComplete = async (snapshot: CharacterDraft) => {
          try { return await loadPaperIdentityAssembly(snapshot); }
          catch (cause) {
            if (generation === paperSaveGeneration.current) setCatalogError(true);
            throw cause;
          }
        };
        let checkedAssembly = await loadComplete(checkedDraft);
        let checkedRules = resolveCharacterRules({ draft: checkedDraft, assembled: checkedAssembly });
        // A newly selected spell can still live only in resolvedChoices. Ask the
        // same strict assembler to hydrate those references and automatic grants,
        // without turning granted spells into player-owned draft selections.
        const spellIds = [...new Set([...collectChosenSpellUuids(checkedDraft, checkedAssembly), ...(checkedDraft.manualSpellIds ?? []), ...checkedRules.spells.known.filter(isEntityUuid)])];
        const grantedSpellSlugs = [...new Set([...(checkedDraft.grantedSpellSlugs ?? []), ...checkedRules.spells.known.filter(reference => !isEntityUuid(reference))])];
        const loadedSpells = new Set(checkedAssembly.spells.flatMap(spell => [spell.id, spell.card_number]));
        if ([...spellIds, ...grantedSpellSlugs].some(reference => !loadedSpells.has(reference))) {
          checkedAssembly = await loadComplete({ ...checkedDraft, spellIds, grantedSpellSlugs });
          checkedRules = resolveCharacterRules({ draft: checkedDraft, assembled: checkedAssembly });
        }
        if (generation !== paperSaveGeneration.current) return false;
        if (latestDraft.current !== sourceDraft) throw new Error('Выборы изменились во время проверки. Сохраните текущий черновик ещё раз.');
        const checkedClasses = [...new Map([
          ...classes, ...(checkedAssembly.classes ?? []), ...(checkedAssembly.subclasses ?? []),
          ...(checkedAssembly.klass ? [checkedAssembly.klass] : []),
          ...(checkedAssembly.subclass ? [checkedAssembly.subclass] : []),
        ].map(entry => [entry.id, entry])).values()];
        const checkedIssues = [
          ...(levelUp ? requiredChoiceIssues(checkedDraft, checkedAssembly) : completionIssues(checkedDraft, checkedAssembly, checkedRules)),
          ...subclassSelectionIssues(checkedClasses, draftClassLevels(checkedDraft), normalizedSubclassIds(checkedDraft.subclassIds, checkedDraft.classId, checkedDraft.subclassId))
            .map(issue => `${issue.className}: выберите допустимый подкласс`),
        ];
        if (levelUp && !levelUp.fromClassLevels[levelUp.selectedClassId]) {
          const requiredIds = new Set([...Object.keys(levelUp.fromClassLevels), levelUp.selectedClassId]);
          checkedIssues.push(...checkedClasses.filter(entry => requiredIds.has(entry.id)).flatMap(entry => multiclassPrerequisiteIssues(entry, checkedDraft.abilities).map(issue => `${entry.name}: ${issue}`)));
        }
        if (checkedIssues.length) {
          // A previously omitted feature may introduce new choices. Refresh the
          // canonical UI bundle so the player can actually finish those choices.
          bundleCacheRef.current.clear(); setCatalogRetry(value => value + 1);
          throw new Error(`Завершите выборы персонажа: ${[...new Set(checkedIssues)].join('; ')}`);
        }
        const payload = buildSavePayload(checkedDraft, checkedAssembly, checkedRules, savedHpRef.current ?? undefined, savedMaxHpRef.current ?? undefined);
        const ctx = buildCharacterContext(checkedRules, checkedDraft, [], checkedAssembly.klass);
        let initialRuntime: PatchCharacterRuntimeRequest = buildResourceRuntimePatch(
          runtimeSeedFromSavePayload(payload), ctx, checkedAssembly, true, undefined, checkedRules.freeuseSpells,
        ) ?? {};
        if (!paperSession.documentId) {
          initialRuntime = projectCharacterStartingEquipmentPatch(initialRuntime, checkedDraft, checkedAssembly);
        }
        await paperSession.onSave({ draft: checkedDraft, assembled: checkedAssembly, ruleState: checkedRules, payload, initialRuntime });
        return true;
      }
      const isCreate = !draft.id;
      const localAvatar = draft.avatarUrl?.startsWith('data:') ? draft.avatarUrl : null;
      const payload = buildSavePayload(draft, assembled, ruleState, savedHpRef.current ?? undefined, savedMaxHpRef.current ?? undefined);
      const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
      // A data URL is only the local preview. The durable row receives the
      // object-storage URL after the owner-scoped upload below.
      if (localAvatar) payload.avatar_url = '';
      let res: ForgeCharacter;
      if (isCreate) {
        let runtimePatch = buildResourceRuntimePatch(
          runtimeSeedFromSavePayload(payload),
          ctx,
          assembled,
          true,
          undefined,
          ruleState.freeuseSpells,
        ) ?? {};
        // Стартовое снаряжение и деньги входят в тот же POST, что и персонаж.
        // Берём обе ветки из assembled bundle: он уже прошёл creation gate, в
        // отличие от параллельно загружаемого списка превью классов.
        runtimePatch = projectCharacterStartingEquipmentPatch(runtimePatch, draft, assembled);
        res = await saveCharacter(charactersV3Api, {
          mode: 'create',
          payload,
          initialRuntime: runtimePatch,
        });
      } else {
        res = await charactersV3Api.update(draft.id!, payload, searchParams.get('roguelike') || undefined);
        const runtimePatch = buildResourceRuntimePatch(
          res,
          ctx,
          assembled,
          true,
          undefined,
          ruleState.freeuseSpells,
        );
        // A class-level change alters the actor capability graph. A retained
        // solo encounter contains an immutable snapshot of that graph, so
        // continuing it would either hide new features or fail compatibility
        // validation. Start the next test combat from the updated character.
        if (levelUp && runtimePatch) {
          runtimePatch.turn_state = writeSoloCombatState(res.turn_state, null);
        }
        if (runtimePatch) res = await charactersV3Api.patchRuntime(res.id, runtimePatch,
          searchParams.get('roguelike') ? { runId: searchParams.get('roguelike')!, intent: 'level_up' } : undefined);
        if (searchParams.get('roguelike')) {
          const run = await roguelikeApi.get(searchParams.get('roguelike')!);
          await roguelikeApi.command(run.id, run.revision, 'confirm_level_up');
        }
      }
      if (localAvatar) {
        const avatarBlob = await fetch(localAvatar).then((response) => response.blob());
        const avatarFile = new File([avatarBlob], 'character-token.png', { type: avatarBlob.type || 'image/png' });
        const avatarUrl = await charactersV3Api.uploadAvatar(res.id, avatarFile);
        res = { ...res, avatar_url: avatarUrl };
      }
      setSavedId(res.id);
      setDraft((d) => ({ ...d, id: res.id, avatarUrl: res.avatar_url || d.avatarUrl }));
      savedHpRef.current = res.current_hp ?? null;
      savedMaxHpRef.current = res.max_hp ?? null;
      // Успешно сохранён — черновик-автосейв больше не нужен.
      setRestorable(null);
      try { localStorage.removeItem(FORGE_DRAFT_KEY); } catch { /* ignore */ }
      if (isCreate) navigate(`/characters-v3/${res.id}`, { replace: true });
      return true;
    } catch (e) {
      console.error(e);
      setError(paperMode && e instanceof Error ? e.message : characterV3ErrorMessage(e, 'Ошибка сохранения персонажа'));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Большинство in_play-выборов разрешается на листе. Weapon Mastery является
  // исключением: первая конфигурация обязательна при получении особенности,
  // а последующие замены уже происходят во время игры/отдыха.
  const buildChoices = assembled.pendingChoices.filter(requiresInitialCharacterChoice);
  const raceChoices = buildChoices.filter((pc) => pc.origin.kind === 'race' && !isSpellSelectionChoice(pc));
  const raceOtherChoices = raceChoices.filter((pc) => pc.source !== 'subfeature');
  const raceSubChoices = raceChoices.filter((pc) => pc.source === 'subfeature');
  const classChoices = buildChoices.filter((pc) => pc.origin.kind === 'class' && !isSpellSelectionChoice(pc));
  const classOtherChoices = classChoices.filter((pc) => pc.source !== 'subfeature');
  const classSubChoices = classChoices.filter((pc) => pc.source === 'subfeature');
  const featChoices = buildChoices.filter((pc) => pc.source === 'feat');
  // Собственные выборы черты (навык/характеристика/язык и т.п. — origin 'feat', но НЕ
  // выбор самой черты и НЕ заклинания). Раньше не попадали ни в одну вкладку → «Одарённый»
  // молча не предлагал 3 навыка, ASI не предлагал характеристику. Теперь живут во вкладке черт.
  const featOwnChoices = buildChoices.filter(
    (pc) => pc.origin.kind === 'feat' && pc.source !== 'feat' && !isSpellSelectionChoice(pc),
  );
  const classFeatOwnChoices = featOwnedChoicesForSelections(
    featOwnChoices,
    classOtherChoices,
    draft.resolvedChoices,
    feats,
  );
  const raceFeatOwnChoices = featOwnedChoicesForSelections(
    featOwnChoices,
    raceOtherChoices,
    draft.resolvedChoices,
    feats,
  );

  // Подвиды — отдельные виды-сущности с parent_race_id текущего вида
  const subraces = draft.raceId ? races.filter((r) => r.parent_race_id === draft.raceId) : [];
  const selectableSubraces = draft.raceId
    ? visibleRaces.filter((r) => r.parent_race_id === draft.raceId)
    : [];
  const selectedRace = draft.raceId ? races.find((r) => r.id === draft.raceId) : undefined;
  const subraceLevel = selectedRace?.subrace_level ?? 1;
  const subraceUnlocked = draft.level >= subraceLevel;

  // Подклассы — отдельные классы-сущности с parent_class_id текущего класса
  const selectableSubclasses = draft.classId
    ? visibleClasses.filter((c) => c.parent_class_id === draft.classId)
    : [];
  const selectedClassEntity = draft.classId ? classes.find((c) => c.id === draft.classId) : undefined;
  const subclassLevel = selectedClassEntity?.subclass_level ?? 3;
  const primaryClassLevel = draft.classId ? (draftClassLevels(draft)[draft.classId] ?? draft.level) : 0;
  const subclassUnlocked = primaryClassLevel >= subclassLevel;

  // Условия появления вкладок
  const hasSubclass = classSubChoices.length > 0;
  const hasSpells = spellChoices.length > 0 || grantedSpells.length > 0;
  const hasFeatTab = !!draft.swapFeat || featChoices.length > 0 || featOwnChoices.length > 0;

  // Статусы завершённости
  const abilitiesDone = ABILITY_KEYS.every((k) => typeof draft.abilities[k] === 'number');
  const abilitiesAssigned = ABILITY_KEYS.filter((k) => typeof draft.abilities[k] === 'number').length;
  const sc = classSkillChoice(assembled);
  const classDone = !!draft.classId && (!sc || draft.classSkillChoices.length >= sc.count)
    && classOtherChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);
  const raceDone = !!draft.raceId
    && raceOtherChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count)
    && raceSubChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);
  const subclassDone = classSubChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);
  const featDone = featChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count)
    && featOwnChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);

  const lineageName = resolveLineageName(draft.lineageId, {
    subraces,
    lineages: assembled.race?.lineages,
    subChoices: raceSubChoices,
  });
  const subclassSel = classSubfeatureChoice ? draft.resolvedChoices[classSubfeatureChoice.id]?.[0] : undefined;
  const subclassName = classSubfeatureChoice?.items?.find((it) => it.id === subclassSel)?.name || subclassSel;

  // Динамический список вкладок
  const sections: ForgeSectionDef[] = [];
  const navRace=draft.raceId===assembled.race?.id?assembled.race:null;
  const navClass=draft.classId===assembled.klass?.id?assembled.klass:null;
  sections.push({ id: 'race', label: 'Вид', icon: navRace?.image_url ? <ForgeEntityIcon imageUrl={navRace.image_url} alt={navRace.name} size={27}/> : <User size={19} />, sub: [navRace?.name,draft.lineageId?lineageName:null].filter(Boolean).join(' · '), status: raceDone ? 'ok' : 'todo' });
  sections.push({ id: 'class', label: 'Класс', icon: navClass?.image_url ? <ForgeEntityIcon imageUrl={navClass.image_url} alt={navClass.name} size={27}/> : <Swords size={19} />, sub: navClass?.name, status: classDone ? 'ok' : 'todo' });
  if (hasSubclass) sections.push({ id: 'subclass', label: 'Подкласс', icon: <Shield size={19} />, sub: subclassName, status: subclassDone ? 'ok' : 'todo' });
  if (hasSpells) sections.push({ id: 'spells', label: 'Заклинания', icon: <Sparkles size={19} />, sub: spellChoices.length ? `${selectedSpellCount}/${requiredSpellCount}` : `${grantedSpells.length} получено`, status: spellsDone ? 'ok' : 'todo' });
  const navBackground = draft.backgroundId === assembled.background?.id ? assembled.background : null;
  sections.push({ id: 'background', label: 'Предыстория', icon: navBackground?.image_url ? <ForgeEntityIcon imageUrl={navBackground.image_url} alt={navBackground.name} size={27}/> : <ScrollText size={19} />, sub: navBackground?.name, status: draft.backgroundId ? 'ok' : 'todo' });
  if (hasFeatTab) sections.push({ id: 'feat', label: 'Черта', icon: <Star size={19} />, sub: assembled.feats[0]?.name, status: featDone ? 'ok' : 'todo' });
  sections.push({ id: 'abilities', label: 'Характеристики', icon: <Zap size={19} />, sub: `${abilitiesAssigned}/6`, status: abilitiesDone ? 'ok' : 'todo' });

  // Мобильный сквозной таб-бар (E6): добавляем вкладку «Общее» = правый обзор.
  const navSections: ForgeSectionDef[] = isMobile
    ? [...sections, { id: FORGE_OVERVIEW_ID, label: 'Общее', icon: <ScrollText size={19} />, status: null }]
    : sections;
  const act = navSections.some((s) => s.id === active) ? active : 'race';
  const showOverviewInMain = isMobile && act === FORGE_OVERVIEW_ID;
  const sectionTitle = sections.find((s) => s.id === act)?.label ?? 'Вид';
  const rootCls = paperMode ? 'forge sheet-paper paper-forge' : paper ? 'forge sheet-paper' : 'forge';

  // Обзор — переиспользуем и в правой колонке (десктоп), и во вкладке «Общее» (моб.).
  const overviewPanel = (
    <OverviewPanel
      draft={draft} patch={patch} assembled={assembled} ruleState={ruleState} spells={selectedSpells}
      lineageName={lineageName} subChoices={raceSubChoices} subraces={subraces}
      issues={issues} canCreate={canCreate} saving={saving} onSave={save}
      savedId={savedId} error={error} onOpenSheet={() => savedId && navigate(paperMode ? `/paper-sheet/${savedId}` : `/characters-v3/${savedId}`)}
      paperMode={paperMode} paperEditing={!!paperSession?.documentId} paperAnonymous={!!paperSession?.anonymous}
    />
  );
  // ─── Режим повышения уровня: только новое, база заблокирована ───
  if (levelUp) {
    const rootClasses = visibleClasses.filter((entry) => !entry.parent_class_id && !entry.is_subclass);
    const selectedLevelClass = classes.find((entry) => entry.id === levelUp.selectedClassId);
    const selectedLevelSubclasses = selectedLevelClass
      ? classes.filter((entry) => entry.parent_class_id === selectedLevelClass.id)
      : [];
    const selectableLevelSubclasses = selectedLevelClass
      ? visibleClasses.filter((entry) => entry.parent_class_id === selectedLevelClass.id)
      : [];
    const selectedLevelClassLevel = selectedLevelClass ? (draftClassLevels(draft)[selectedLevelClass.id] ?? 0) : 0;
    const selectedFromClassLevel = levelUp.fromClassLevels[levelUp.selectedClassId] ?? 0;
    const selectedToClassLevel = selectedFromClassLevel + 1;
    const selectedLevelSubclassThreshold = selectedLevelClass?.subclass_level ?? 3;
    const selectedSubclassIds = normalizedSubclassIds(draft.subclassIds, draft.classId, draft.subclassId);
    const selectedLevelSubclassId = selectedLevelClass ? selectedSubclassIds[selectedLevelClass.id] : undefined;
    const selectedLevelSubclass = (assembled.subclasses ?? []).find(entry => entry.id === selectedLevelSubclassId)
      ?? selectedLevelSubclasses.find(entry => entry.id === selectedLevelSubclassId);
    const returnURL = paperMode ? paperSession?.returnURL ?? '/paper-sheet' : levelUpReturnURL(draft.id ?? '', searchParams.get('roguelike'));
    const selectedLevelSubclassUnlocked = selectedLevelClassLevel >= selectedLevelSubclassThreshold;
    const takingNewClass = selectedLevelClass && !levelUp.fromClassLevels[selectedLevelClass.id];
    const prerequisiteClasses = takingNewClass
      ? [...new Set([...Object.keys(levelUp.fromClassLevels), selectedLevelClass.id])]
          .map((id) => classes.find((entry) => entry.id === id))
          .filter((entry): entry is CharacterClass => !!entry)
      : [];
    const multiclassIssues = prerequisiteClasses.flatMap((entry) => (
      multiclassPrerequisiteIssues(entry, draft.abilities).map((issue) => `${entry.name}: ${issue}`)
    ));
    const newEffects = assembled.effects.filter((e) => !prevRefs || !prevRefs.effects.has(e.effect.id));
    const newActions = assembled.actions.filter((a) => !prevRefs || !prevRefs.actions.has(a.action.id));
    const unresolved = assembled.pendingChoices.filter(
      (pc) => requiresInitialCharacterChoice(pc) && (draft.resolvedChoices[pc.id] || []).length < pc.count,
    );
    const unresolvedSpells = unresolved.filter(isSpellSelectionChoice);
    const replacementLimits = levelUpReplacementLimits(buildChoices, prevRefs?.choiceLevels, !!levelUp.committed);
    const levelUpOtherChoices = buildChoices.filter((pc) => !isSpellSelectionChoice(pc)
      && (replacementLimits[pc.id] > 0 || levelUpChoicesToShow(
        [pc], prevRefs?.choiceIds, draft.resolvedChoices, prevRefs?.choiceCounts,
      ).length > 0));
    const setLevelResolved = (id: string, values: string[]) => {
      if (replacementLimits[id] == null || levelUpReplacementAllowed(
        originalLevelChoices.current[id] ?? [], values, replacementLimits[id],
      )) setResolved(id, values);
    };
    // A subclass selected at this level can introduce its own mandatory
    // choices (for example College of Lore's three bonus skills).  Keep those
    // controls next to the subclass picker instead of relying on the generic
    // block near the footer: on a long level-up page the footer can surface
    // the completion error while the actual resolver is effectively hidden.
    const selectedSubclassChoices = selectedLevelSubclassId
      ? levelUpOtherChoices.filter((choice) => (
          choice.origin.kind === 'class' && choice.origin.id === selectedLevelSubclassId
        ))
      : [];
    const otherLevelUpChoices = levelUpOtherChoices.filter((choice) => (
      !selectedSubclassChoices.some((subclassChoice) => subclassChoice.id === choice.id)
    ));
    // Expanded existing choices stay editable after their new slots are filled.
    const newSpellChoices = prevRefs
      ? spellChoices.filter((pc) => replacementLimits[pc.id] != null
          || levelUpChoicesToShow([pc], prevRefs.choiceIds, draft.resolvedChoices, prevRefs.choiceCounts).length > 0)
      : unresolvedSpells;
    const featLevelUpChoices = levelUpOtherChoices.filter(choice => choice.source === 'feat');
    const openLevelUpChoice = async (choice: PendingChoice) => {
      if (!catalogsReady || (isSpellSelectionChoice(choice) && !spellCatalogReady)) return;
      const request = levelUpDialogChoice(choice, visibleSpells, maxSlotLevel, draft.resolvedChoices[choice.id] ?? [], visibleFeats);
      const options = optionsForChoice(request, visibleFeats);
      const canonical = (reference: string) => {
        const spell = visibleSpells.find(spell => spell.id === reference || spell.card_number === reference);
        return isSpellSelectionChoice(choice) ? spell?.id ?? reference
          : choiceOptionIdByReference(options, reference) ?? reference;
      };
      const original = (originalLevelChoices.current[choice.id] ?? []).map(canonical);
      const canReplace = (values: string[]) => replacementLimits[choice.id] == null
        || levelUpReplacementAllowed(original, values.map(canonical), replacementLimits[choice.id]);
      const unavailable = (pending: PendingChoice, values: string[]) => {
        const temporaryDraft = applyForgeResolvedChoices(draft, {[choice.id]: values}, assembled.pendingChoices);
        const projected = resolveCharacterRules({draft: temporaryDraft, assembled});
        if (!isSpellSelectionChoice(choice)) {
          const ownedHere = new Set((draft.resolvedChoices[choice.id] ?? []).map(canonical));
          return forgeChoiceUnavailableOptions(pending, projected, values, visibleFeats,
            assembled.feats.filter(feat => !ownedHere.has(feat.id)));
        }
        const blocked = unavailableChoiceOptions(pending, projected, options.map(option => option.id), values, {canonicalSpellId: canonical});
        if (choice.source !== 'prepared_spell') {
          for (const other of spellChoices.filter(other => other.id !== choice.id && other.source !== 'prepared_spell')) {
            for (const reference of draft.resolvedChoices[other.id] ?? []) {
              if (!values.includes(canonical(reference))) blocked[canonical(reference)] = 'Уже выбрано в другом выборе';
            }
          }
        }
        return blocked;
      };
      const picked = await choiceDialog.request([request], choice.prompt, {
        presentation: 'levelup',
        feats: visibleFeats,
        summary: `Выберите всего ${choice.count}. ${replacementLimits[choice.id] != null ? `Можно заменить до ${replacementLimits[choice.id]} ранее выбранных вариантов. ` : ''}Выбор сохранится при подтверждении уровня.`,
        unavailableOptions: unavailable,
        canApply: values => {
          const selected = values[choice.id] ?? [];
          const blocked = unavailable(request, selected);
          return selected.length === choice.count && canReplace(selected) && selected.every(reference => !blocked[reference]);
        },
      });
      if (picked?.[choice.id] && canReplace(picked[choice.id])) setResolved(choice.id, picked[choice.id]);
    };
    const oldMaxHP = prevRefs?.maxHP ?? computeMulticlassMaxHP(
      (assembled.classes ?? []).map((klass) => ({
        id: klass.id,
        hit_die: klass.hit_die,
        level: levelUp.fromClassLevels[klass.id] ?? 0,
      })),
      draft.classId,
      draft.abilities.con,
    );
    // Compare canonical projections, including subclass pools, passive grants,
    // multiclass slots and action uses. This view never refills saved resources.
    const resourceContext = buildCharacterContext(ruleState, draft, [], assembled.klass);
    const projectedRuntime = syncRuntimeResources(resourceContext, assembled, undefined, ruleState.freeuseSpells);
    const resourceGains = prevRefs ? levelUpResourceGains(prevRefs.maxResources, projectedRuntime.maxResources) : [];
    // Блокируют подтверждение только незакрытые НОВЫЕ выборы; конфликты,
    // унаследованные от создания, показываем предупреждением (править их тут нечем).
    const pendingChoiceHints = requiredChoiceIssues(draft, assembled);
    const levelUpErrors = subclassSelectionProblems.map((issue) => (
      `${issue.className}: выберите допустимый подкласс`
    ));
    // Пересечение порога подкласса: выбор обязателен.
    const subclassDue = selectedLevelSubclasses.length > 0 && selectedLevelSubclassUnlocked && !selectedLevelSubclassId;
    if (subclassDue) {
      pendingChoiceHints.unshift('Выберите подкласс');
    }
    // Подкласс редактируем только когда его выбирают ПРЯМО СЕЙЧАС (порог пересечён на этом
    // уровне или ещё не выбран). Выбранный на прошлом уровне — закреплён, как класс/вид (#4).
    const subclassEditable = selectedLevelSubclasses.length > 0 && selectedLevelSubclassUnlocked
      && ((levelUp.fromClassLevels[selectedLevelClass?.id ?? ''] ?? 0) < selectedLevelSubclassThreshold || !selectedLevelSubclassId);
    const subclassLocked = selectedLevelSubclasses.length > 0 && selectedLevelSubclassUnlocked
      && !subclassEditable && !!selectedLevelSubclassId;
    const conflictWarnings = ruleState.conflicts
      .filter((c) => c.severity === 'error')
      .map((c) => c.message);
    levelUpErrors.unshift(...multiclassIssues.map((issue) => `Требование мультикласса: ${issue}`));
    const canConfirm = bundleReady && (!paperMode || (catalogsReady && spellCatalogReady && !!prevRefs))
      && pendingChoiceHints.length === 0 && levelUpErrors.length === 0 && !!levelUp.selectedClassId;
    const isReplacementOnly = (choice: PendingChoice) => (replacementLimits[choice.id] ?? 0) > 0
      && (prevRefs?.choiceCounts.get(choice.id) ?? 0) >= choice.count;
    const replacementChoices = [...featLevelUpChoices, ...newSpellChoices].filter(isReplacementOnly);
    const freshFeatChoices = featLevelUpChoices.filter(choice => !isReplacementOnly(choice));
    const freshSpellChoices = newSpellChoices.filter(choice => !isReplacementOnly(choice));
    // New choices granted by a previously selected subclass still belong on
    // the page even when its subclass picker is now locked.
    const generalLevelChoices = [...otherLevelUpChoices, ...(subclassEditable ? [] : selectedSubclassChoices)]
      .filter(choice => choice.source !== 'feat');
    const replacementOtherChoices = generalLevelChoices.filter(isReplacementOnly);
    const freshOtherChoices = generalLevelChoices.filter(choice => !isReplacementOnly(choice));
    const renderLevelChoice = (choice: PendingChoice) => {
      const references = draft.resolvedChoices[choice.id] ?? [];
      const options = optionsForChoice(choice, visibleFeats);
      const selectedFeats = choice.source === 'feat' ? references.flatMap(reference => {
        const optionId = choiceOptionIdByReference(options, reference);
        const feat = optionId && featForChoiceOption(choice, optionId, visibleFeats);
        return feat ? [feat] : [];
      }) : [];
      return <LevelUpChoiceButton key={choice.id} choice={choice}
        selectedLabels={levelUpChoiceSelectionLabels(choice, references, visibleFeats, visibleSpells)}
        selectedFeats={selectedFeats}
        selectedSpells={isSpellSelectionChoice(choice) ? visibleSpells.filter(spell => references.includes(spell.id) || references.includes(spell.card_number)) : []}
        replacementLimit={replacementLimits[choice.id] > 0 ? replacementLimits[choice.id] : undefined}
        loading={!catalogsReady || (isSpellSelectionChoice(choice) && !spellCatalogReady)}
        onActivate={() => { void openLevelUpChoice(choice); }}/>;
    };

    return (
      <CharacterFormulaProvider value={formulaCtx}>
      <div className={rootCls + ' levelup-screen'}>
        {paperMode && catalogError && <div className="paper-forge-notice" role="alert">Не удалось загрузить данные персонажа. <button onClick={() => { setError(null); setCatalogRetry(value => value + 1); void loadCatalogs(); }}>Повторить загрузку</button></div>}
        <div className="forge-header sheet-header-bar">
          <button type="button" className="sheet-back" aria-label="Отмена" disabled={saving}
            onClick={() => navigate(returnURL)}>
            <ArrowLeft size={18} />
          </button>
          <span>Повышение уровня — {draft.name || 'Без имени'}</span>
          <Link to="/" className="forge-brand-link" aria-description="На главную страницу">Bag of Holding</Link>
        </div>
        <div className="sheet-scroll levelup-scroll">
          <div className="levelup-wrap">
            <div className="levelup-head">
              <div className="levelup-seal" aria-hidden="true"><Sparkles size={18}/><b>{draft.level}</b><span>уровень</span></div>
              <div className="levelup-identity">
                <span className="levelup-eyebrow">Развитие персонажа</span>
                <h1>{draft.name || 'Без имени'}</h1>
                <span className="levelup-class">{[assembled.klass?.name, lineageName || assembled.race?.name].filter(Boolean).join(' · ')}</span>
                <span className="levelup-badge">Уровень {levelUp.fromLevel} → {draft.level}</span>
              </div>
              <div className="levelup-hp"><span>Максимум хитов</span><div>{oldMaxHP}<span aria-hidden="true">→</span><b>{ruleState.maxHP}</b></div>
                <small>{selectedLevelClass?.hit_die ? <>Кость хитов {selectedLevelClass.hit_die}</> : 'Развитие жизненных сил'}</small></div>
            </div>
            <section className="levelup-section" aria-labelledby="levelup-change-heading">
              <div className="levelup-section-heading"><span aria-hidden="true">I</span><div><h2 id="levelup-change-heading">Можно изменить</h2><p>Выберите направление развития и доступные замены.</p></div></div>
            <div className="forge-block levelup-class-block">
              <div className="levelup-class-summary">
                {selectedLevelClass && <EntitySquareCard name={selectedLevelClass.name} imageUrl={selectedLevelClass.image_url}
                  preview={<ClassPreview characterClass={selectedLevelClass} disableHover/>}/>}
                <div className="levelup-class-copy">
                  <span className="levelup-eyebrow">Следующий уровень класса</span>
                  <h3>{selectedLevelClass?.name ?? 'Выберите класс'}</h3>
                  <p>{selectedFromClassLevel ? <>Уровень класса {selectedFromClassLevel} → {selectedToClassLevel}</> : 'Первый уровень нового класса'}</p>
                  <span className="forge-note">{searchParams.get('roguelike') ? 'Продолжите развитие своего класса.' : 'Продолжите текущий класс или начните путь в другом.'}</span>
                </div>
              </div>
              {!searchParams.get('roguelike') && <details className="levelup-class-picker">
                <summary>Изменить класс <span aria-hidden="true">⌄</span></summary>
              <div className="forge-square-grid">
                {rootClasses.filter((entry) => !searchParams.get('roguelike') || entry.id === draft.classId).map((entry) => {
                  const requirements = entry.id === draft.classId ? [] : multiclassPrerequisiteIssues(entry, draft.abilities);
                  return (
                    <EntitySquareCard
                      key={entry.id}
                      name={`${entry.name} · ${(levelUp.fromClassLevels[entry.id] ?? 0) + 1}`}
                      imageUrl={entry.image_url}
                      selected={levelUp.selectedClassId === entry.id}
                      onClick={() => selectLevelUpClass(entry.id)}
                      preview={<ClassPreview characterClass={entry} disableHover />}
                      supportEntity={entry}
                      disabled={requirements.length > 0}
                    />
                  );
                })}
              </div>
              </details>}
            </div>


              {replacementChoices.length > 0 && <div className="levelup-choice-stack">{replacementChoices.map(renderLevelChoice)}</div>}
              {replacementOtherChoices.length > 0 && <ChoiceList choices={replacementOtherChoices}
                resolved={draft.resolvedChoices} setResolved={setLevelResolved} ruleState={ruleState}
                feats={visibleFeats} activeFeats={assembled.feats} title="Доступные замены"/>}
            </section>
            <section className="levelup-section" aria-labelledby="levelup-new-heading">
              <div className="levelup-section-heading"><span aria-hidden="true">II</span><div><h2 id="levelup-new-heading">Новые выборы</h2><p>Добавьте способности, которые открыл новый уровень.</p></div></div>
            {subclassSelectionProblems.filter((issue) => issue.classId !== selectedLevelClass?.id).map((issue) => {
              const options = visibleClasses.filter((entry) => entry.parent_class_id === issue.classId);
              return (
                <div className="forge-block forge-square-block" key={`repair-subclass:${issue.classId}`}>
                  <div className="forge-section-h">Подкласс: {issue.className}</div>
                  <p className="forge-note">Этот класс уже достиг уровня подкласса. Выбор обязателен.</p>
                  <div className="forge-square-grid">
                    {options.map((entry) => (
                      <EntitySquareCard key={entry.id} name={entry.name} imageUrl={entry.image_url}
                        selected={allSubclassIds[issue.classId] === entry.id}
                        onClick={() => selectSubclass(entry.id, issue.classId)}
                        preview={<ClassPreview characterClass={entry} disableHover />} supportEntity={entry} />
                    ))}
                  </div>
                </div>
              );
            })}

            {subclassEditable && (
              <div className="forge-block forge-square-block">
                <div className="levelup-subclass-heading"><div className="forge-section-h">Подкласс</div>
                  <button type="button" className="forge-btn ghost" onClick={()=>setSubclassComparisonOpen(true)}>Подробнее</button></div>
                <div className="forge-square-grid">
                  {(selectableLevelSubclasses as CharacterClass[]).map((c) => (
                    <EntitySquareCard
                      key={c.id}
                      name={c.name}
                      imageUrl={c.image_url}
                      selected={selectedLevelSubclassId === c.id}
                      onClick={() => selectSubclass(c.id, selectedLevelClass?.id ?? null)}
                      preview={<ClassPreview characterClass={c} disableHover />}
                      supportEntity={c}
                    />
                  ))}
                </div>
                {selectedLevelSubclass && <div className="levelup-subclass-description"><FormattedText text={selectedLevelSubclass.description}/></div>}
                {selectedLevelSubclassId && <LevelUpSubclassAbilities assembled={assembled} subclassId={selectedLevelSubclassId}
                  classLevel={selectedLevelClassLevel} loading={!bundleReady}/>}
                {selectedSubclassChoices.some(choice => choice.source !== 'feat') && (
                <ChoiceList
                    choices={selectedSubclassChoices.filter(choice => choice.source !== 'feat')}
                    resolved={draft.resolvedChoices}
                    setResolved={setLevelResolved}
                    ruleState={ruleState}
                    feats={visibleFeats}
                    activeFeats={assembled.feats}
                    title="Выборы подкласса"
                  />
                )}
              </div>
            )}
            {subclassLocked && (
              <div className="forge-block">
                <div className="levelup-subclass-heading"><div className="forge-section-h">Подкласс</div>
                  <button type="button" className="forge-btn ghost" onClick={()=>setSubclassComparisonOpen(true)}>Подробнее</button></div>
                {selectedLevelSubclass && <div className="levelup-subclass-summary"><EntitySquareCard name={selectedLevelSubclass.name}
                  imageUrl={selectedLevelSubclass.image_url} preview={<ClassPreview characterClass={selectedLevelSubclass} disableHover/>}/>
                  <div><h3>{selectedLevelSubclass.name}</h3><p className="forge-note">Закреплён для этого класса.</p></div></div>}
                {selectedLevelSubclassId && <LevelUpSubclassAbilities assembled={assembled} subclassId={selectedLevelSubclassId}
                  classLevel={selectedLevelClassLevel} loading={!bundleReady}/>}
              </div>
            )}

            {freshOtherChoices.length > 0 && (
              <ChoiceList
                choices={freshOtherChoices}
                resolved={draft.resolvedChoices}
                setResolved={setLevelResolved}
                ruleState={ruleState}
                feats={visibleFeats}
                activeFeats={assembled.feats}
                title="Другие выборы"
              />
            )}


              {freshFeatChoices.length > 0 && <div className="levelup-choice-stack">{freshFeatChoices.map(renderLevelChoice)}</div>}
              {freshSpellChoices.length > 0 && <div className="levelup-spell-choices"><div className="levelup-subsection-heading"><Sparkles size={16}/><h3>Заклинания</h3></div>
                <div className="levelup-choice-stack">{freshSpellChoices.map(renderLevelChoice)}</div></div>}
              {freshFeatChoices.length === 0 && freshSpellChoices.length === 0 && !subclassEditable
                && subclassSelectionProblems.length === 0 && freshOtherChoices.length === 0
                && <div className="levelup-no-choices"><CheckCircle2 size={24} aria-hidden="true"/><div><b>Все решения уже приняты</b><p>На этом уровне дополнительных выборов нет.</p></div></div>}
            </section>
            <section className="levelup-section levelup-gains" aria-labelledby="levelup-gains-heading">
              <div className="levelup-section-heading"><span aria-hidden="true">✦</span><div><h2 id="levelup-gains-heading">Что даёт уровень</h2><p>Способности и ресурсы, которые получит персонаж.</p></div></div>
            <div className="forge-block">
              <div className="forge-section-h">Новые способности</div>
              {newEffects.length === 0 && newActions.length === 0 && (
                <p className="forge-note">На этом уровне новых способностей нет.</p>
              )}
              <ForgeAbilityDisplay
                mode={entityDisplay.effects}
                entries={newEffects.map(({ effect, origin }) => ({
                  key: effect.id,
                  name: effect.name,
                  imageUrl: effect.image_url,
                  sourceLabel: `${origin.kind === 'race' ? 'Способность вида' : 'Способность класса'} · ${origin.name}`,
                  effect,
                }))}
              />
              <ForgeAbilityDisplay
                mode={entityDisplay.actions}
                entries={newActions.map(({ action, origin }) => ({
                  key: action.id,
                  name: action.name,
                  imageUrl: action.image_url,
                  sourceLabel: `Действие · ${origin.name}`,
                  action,
                }))}
              />
            </div>

            <LevelUpSpellGrants before={prevRefs?.spellGrants ?? null}
              after={{assembled, grants:ruleState.appliedGrants, context:resourceContext}} spells={spells}
              loading={!bundleReady || !spellCatalogReady}/>

            {resourceGains.length > 0 && (
              <div className="forge-block">
                <div className="forge-section-h">Новые ресурсы</div>
                <LevelUpResourceGains gains={resourceGains} options={levelUpResourceOptions(resourceOptions,assembled)} sources={projectedRuntime.sources}
                  maximumBreakdowns={Object.fromEntries(resourceGains.map(gain=>[gain.key,resourceMaximumBreakdown(gain.key,resourceContext,assembled,ruleState.freeuseSpells,gain.after)]))}/>
              </div>
            )}


            </section>
            <div className="levelup-footer">
              {pendingChoiceHints.length > 0 && <details className="levelup-pending-choices">
                <summary>Осталось завершить выборы: {pendingChoiceHints.length}<span aria-hidden="true">⌄</span></summary>
                <ul>{pendingChoiceHints.map((hint,index)=><li key={index}>{hint}</li>)}</ul>
              </details>}
              {levelUpErrors.length > 0 && (
                <ul className="issues forge-overview-issues">
                  {levelUpErrors.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              )}
              {conflictWarnings.length > 0 && (
                <p className="forge-note" aria-description={conflictWarnings.join('\n')}>
                  ⚠ Унаследованные замечания ({conflictWarnings.length}) — не блокируют повышение;
                  их можно поправить в полном редакторе.
                </p>
              )}
              {error && <p className="issues" style={{ color: 'var(--forge-danger)' }}>{error}</p>}
              <div className="levelup-actions">
                <button
                  type="button"
                  className="forge-btn forge-create-btn"
                  disabled={!canConfirm || saving}
                  onClick={async () => { if (await save() && !paperMode) navigate(returnURL); }}
                >
                  {saving ? 'Сохранение…' : `Подтвердить уровень ${draft.level}`}
                </button>
                <button type="button" className="forge-btn ghost" disabled={saving}
                  onClick={() => navigate(returnURL)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
        {subclassComparisonOpen && selectedLevelClass && <SubclassProgressionDialog subclasses={selectedLevelSubclasses}
          className={selectedLevelClass.name} unlockLevel={selectedLevelSubclassThreshold} selectedId={selectedLevelSubclassId}
          onClose={()=>setSubclassComparisonOpen(false)}/>}
      </div>
      </CharacterFormulaProvider>
    );
  }

  return (
    <CharacterFormulaProvider value={formulaCtx}>
    <div className={rootCls}>
      {catalogError && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
            background: '#3a1c1c', border: '1px solid #a05454', color: '#f0d0d0',
            padding: '10px 16px', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'center',
            boxShadow: '0 6px 24px rgba(0,0,0,.5)', maxWidth: '92vw',
          }}
        >
          <span>Не удалось загрузить справочники. Проверьте соединение.</span>
          <button
            type="button"
            onClick={() => { setError(null); setCatalogRetry(value => value + 1); void loadCatalogs(); }}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d8b978', background: 'transparent', color: '#d8b978', cursor: 'pointer', flex: '0 0 auto' }}
          >
            Повторить
          </button>
        </div>
      )}
      {restorable && !editId && (
        <div
          role="dialog"
          style={{
            position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 1001,
            background: '#241d16', border: '1px solid #6b5836', color: '#ece3d4',
            padding: '12px 18px', borderRadius: 10, display: 'flex', gap: 14, alignItems: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,.6)', maxWidth: '92vw', flexWrap: 'wrap', justifyContent: 'center',
          }}
        >
          <span>Продолжить создание незавершённого персонажа?</span>
          <button
            type="button"
            onClick={() => { setDraft(restorable); setRestorable(null); }}
            style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#d8b978', color: '#1a140a', fontWeight: 600, cursor: 'pointer' }}
          >
            Продолжить
          </button>
          <button
            type="button"
            onClick={() => { setRestorable(null); try { localStorage.removeItem(FORGE_DRAFT_KEY); } catch { /* ignore */ } }}
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #6b5836', background: 'transparent', color: '#a59886', cursor: 'pointer' }}
          >
            Начать заново
          </button>
        </div>
      )}
      <div className="forge-header sheet-header-bar forge-header-layout">
        <Link to={paperMode ? paperSession?.returnURL ?? '/paper-sheet' : '/'} className="forge-brand-link" aria-description={paperMode ? 'К бумажному листу' : 'На главную страницу'}>{paperMode ? '← Бумажный лист' : 'Bag of Holding'}</Link>
        <span className="forge-header-title">{paperMode ? paperSession?.documentId ? 'Редактирование персонажа' : 'Создание бумажного персонажа' : 'Создание персонажа'}</span>
        <div className="sheet-header-actions">
          <button
            type="button"
            className="sheet-header-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Настройки"
            aria-description="Настройки отображения"
          >
            <Settings size={16} />
            <span className="sheet-header-btn-label">Настройки</span>
          </button>
          {(savedId || draft.id || paperSession?.documentId) && (
            <Link to={paperMode ? paperSession?.returnURL ?? '/paper-sheet' : `/characters-v3/${savedId || draft.id}`} className="sheet-edit forge-header-sheet-link" aria-description="Открыть лист персонажа">
              <FileText size={16} />
              <span>Лист</span>
            </Link>
          )}
        </div>
      </div>

      {settingsOpen && <SheetSettingsDialog onClose={() => setSettingsOpen(false)} />}

      <div className="forge-body">
        <ForgeNav sections={navSections} active={act} onSelect={setActive} />
        <div className="forge-main">
          {showOverviewInMain ? (
            <div className="forge-editor forge-editor--overview">{overviewPanel}</div>
          ) : (
          <>
          <div className="forge-main-title">{sectionTitle}</div>
          <div className="forge-editor">
              {act === 'race' && (
                <RaceSection races={visibleRaces} draft={draft} onSelect={selectRace}
                  assembled={assembled}
                  subraces={selectableSubraces} subraceUnlocked={subraceUnlocked} subraceLevel={subraceLevel}
                  onPickSubrace={selectLineage} onBeginLineageChange={beginLineageChange}
                  choices={raceOtherChoices} subChoices={raceSubChoices} onBeginChange={beginRaceChange}
                  ownChoices={raceFeatOwnChoices}
                  resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} allFeats={visibleFeats} activeFeats={assembled.feats} />
              )}
              {act === 'class' && (
                <>
                <ClassSection classes={visibleClasses} draft={draft} onSelect={selectClass} onBeginChange={beginClassChange} onBeginSubclassChange={beginSubclassChange} assembled={assembled}
                  onToggleSkill={toggleClassSkill} choices={classOtherChoices} ownChoices={classFeatOwnChoices} resolved={draft.resolvedChoices}
                  setResolved={setResolved} ruleState={ruleState} allFeats={visibleFeats} activeFeats={assembled.feats}
                  subclasses={selectableSubclasses} subclassUnlocked={subclassUnlocked} subclassLevel={subclassLevel}
                  onPickSubclass={selectSubclass}
                  onEquipmentOption={(opt: 'a' | 'b' | 'c') => patch({ classEquipmentOption: opt })} />
                {subclassSelectionProblems.filter((issue) => issue.classId !== draft.classId).map((issue) => {
                  const options = visibleClasses.filter((entry) => entry.parent_class_id === issue.classId);
                  return (
                    <div className="forge-block forge-square-block" key={`repair-subclass:${issue.classId}`}>
                      <div className="forge-section-h">Подкласс: {issue.className}</div>
                      <p className="forge-note">Выбор для этого класса обязателен до сохранения.</p>
                      <div className="forge-square-grid">
                        {options.map((entry) => (
                          <EntitySquareCard key={entry.id} name={entry.name} imageUrl={entry.image_url}
                            selected={allSubclassIds[issue.classId] === entry.id}
                            onClick={() => selectSubclass(entry.id, issue.classId)}
                            preview={<ClassPreview characterClass={entry} disableHover />} supportEntity={entry} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                </>
              )}
              {act === 'subclass' && (
                <SubclassSection choices={classSubChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} klass={assembled.klass} allFeats={visibleFeats} />
              )}
              {act === 'spells' && (
                <SpellsSection spells={visibleSpells} granted={grantedSpells} choices={spellChoices} ownerChoices={spellChoices} maxSlotLevel={maxSlotLevel} ruleState={ruleState} resolved={draft.resolvedChoices} setResolved={setResolved} />
              )}
              {act === 'background' && (
                <BackgroundSection backgrounds={visibleBackgrounds} draft={draft} onSelect={selectBackground} onBeginChange={beginBackgroundChange}
                  background={assembled.background} feats={feats} onToggleSwapFeat={(v: boolean) => patch({ swapFeat: v })}
                  onEquipmentOption={(opt: 'a' | 'b') => patch({ equipmentOption: opt })} />
              )}
              {act === 'feat' && (
                <FeatSection feats={visibleFeats} draft={draft} onToggle={toggleFeat} swapFeat={!!draft.swapFeat}
                  choices={featChoices} ownChoices={featOwnChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} activeFeats={assembled.feats} />
              )}
              {act === 'abilities' && (
                <AbilityAssigner
                  abilities={draft.abilities}
                  method={draft.abilityMethod}
                  bonuses={draft.abilityBonuses}
                  backgroundName={assembled.background?.name}
                  backgroundAbilities={((assembled.background?.ability_scores || []) as AbilityKey[])}
                  recommended={(classes.find((c) => c.id === draft.classId)?.recommended_abilities || {}) as Partial<Record<AbilityKey, number>>}
                  onSet={setAbility}
                  onSetAll={setAbilities}
                  onMethodChange={(m) => patch({ abilityMethod: m })}
                  onBonusesChange={setBonuses}
                />
              )}
          </div>
          </>
          )}
        </div>

        {!isMobile && <div className="forge-summary">{overviewPanel}</div>}
      </div>
    </div>
    </CharacterFormulaProvider>
  );
};

// ─── Правая панель обзора (имя + résumé + создание) ──────────────────────────

function OverviewPanel({ draft, patch, assembled, ruleState, spells, lineageName, subChoices, subraces, issues, canCreate, saving, onSave, savedId, error, onOpenSheet, paperMode = false, paperEditing = false, paperAnonymous = false }: {
  draft: CharacterDraft; patch: (p: Partial<CharacterDraft>) => void; assembled: AssembledCharacter; ruleState: CharacterRuleState; spells: Spell[];
  lineageName?: string; subChoices?: PendingChoice[]; subraces?: Race[];
  issues: string[]; canCreate: boolean; saving: boolean; onSave: () => void; savedId: string | null;
  error: string | null; onOpenSheet: () => void;
  paperMode?: boolean; paperEditing?: boolean; paperAnonymous?: boolean;
}) {
  // The editor controls stay immediate while the potentially long abilities /
  // spells summary is allowed to trail a rapid sequence of selections.
  const summarySnapshot = useMemo(
    () => ({ draft, assembled, ruleState, spells, lineageName }),
    [draft, assembled, ruleState, spells, lineageName],
  );
  const deferredSummary = useDeferredValue(summarySnapshot);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const deferredLineageName = deferredSummary.lineageName ?? resolveLineageName(
    deferredSummary.draft.lineageId,
    {
      subraces,
      lineages: deferredSummary.assembled.race?.lineages,
      subChoices,
    },
  );

  return (
    <div className="forge-overview">
      <div className="forge-block">
        <div className="forge-section-h">Имя персонажа</div>
        <div className="forge-name-input">
          <input className="forge-input" aria-label="Имя персонажа" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Фарадей фон Грасс" />
          <button type="button" className="forge-token-button" aria-label={paperMode ? 'Изменить портрет персонажа' : 'Изменить изображение токена'} onClick={() => setTokenDialogOpen(true)}>
            {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <ImageIcon size={21} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {tokenDialogOpen && <ForgeTokenDialog imageUrl={draft.avatarUrl} paperMode={paperMode} onChange={avatarUrl => patch({avatarUrl})} onClose={() => setTokenDialogOpen(false)} />}
      <SummaryPanel
        draft={{...deferredSummary.draft,raceId:draft.raceId,lineageId:draft.lineageId,classId:draft.classId,classLevels:draft.classLevels,subclassId:draft.subclassId,subclassIds:draft.subclassIds,backgroundId:draft.backgroundId,featIds:draft.featIds,swapFeat:draft.swapFeat}}
        assembled={deferredSummary.assembled}
        ruleState={deferredSummary.ruleState}
        spells={deferredSummary.spells}
        lineageName={draft.lineageId?deferredLineageName:undefined}
      />

      <div className="forge-overview-footer">
        {savedId && (
          <div className="forge-success" style={{ marginBottom: 8 }}>
            <div className="sum-label" style={{ fontSize: 15 }}>Персонаж сохранён ✓</div>
            <button className="forge-btn" onClick={onOpenSheet}>Открыть лист</button>
          </div>
        )}
        {issues.length > 0 && (
          <ul className="issues forge-overview-issues">
            {issues.slice(0, 4).map((it, i) => <li key={i}>{it}</li>)}
            {issues.length > 4 && <li>…и ещё {issues.length - 4}</li>}
          </ul>
        )}
        {error && <p className="issues" style={{ color: 'var(--forge-danger)' }}>{error}</p>}
        <button className="forge-btn forge-create-btn" disabled={!canCreate || saving} onClick={onSave}>
          {saving ? 'Сохранение…' : paperMode ? paperEditing ? 'Сохранить в лист' : paperAnonymous ? 'Создать анонимный лист' : 'Создать бумажный лист' : draft.id ? 'Сохранить' : 'Создать персонажа'}
        </button>
      </div>
    </div>
  );
}

// ─── Общий список выборов ────────────────────────────────────────────────────

function ChoiceList({ choices, resolved, setResolved, ruleState, feats, activeFeats, title = 'Выборы' }: {
  choices: PendingChoice[];
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
  ruleState: CharacterRuleState; feats?: Feat[]; activeFeats?: Feat[]; title?: string;
}) {
  if (!choices.length) return null;
  return (
    <div className="forge-block">
      <div className="forge-section-h">{title}</div>
      {choices.map((pc) => {
        const value = resolved[pc.id] || [];
        const unavailableOptions = forgeChoiceUnavailableOptions(pc, ruleState, value, feats, activeFeats);
        return (
          <ChoiceResolver
            key={pc.id}
            choice={pc}
            value={value}
            unavailableOptions={unavailableOptions}
            feats={feats}
            onChange={(nextValue) => {
              setResolved(pc.id, nextValue);
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Секции ────────────────────────────────────────────────────────────────

function RaceSection({ races, draft, onSelect, onBeginChange, onBeginLineageChange, assembled, subraces, subraceUnlocked, subraceLevel, onPickSubrace, choices, ownChoices, subChoices, resolved, setResolved, ruleState, allFeats, activeFeats }: any) {
  const [expanded,setExpanded]=useState(!draft.raceId);
  const [subraceExpanded,setSubraceExpanded]=useState(!draft.lineageId);
  const topRaces = races.filter((r: Race) => !r.is_subrace);
  const race = races.find((r: Race) => r.id === draft.raceId) as Race | undefined;
  const subChoice = subChoices?.[0] as PendingChoice | undefined;
  const subChoiceItems = subChoice?.items ?? [];
  const hasEntitySubraces = race && (subraces as Race[]).length > 0;
  const hasSubfeatureSubraces = race && subChoiceItems.length > 0;

  return (
    <div>
      <div className="forge-block forge-square-block">
        <ForgeEntitySelection entities={topRaces as Race[]} selectedId={draft.raceId} onSelect={onSelect} onBeginChange={onBeginChange} onExpandedChange={setExpanded} entityKind="races"
          renderCard={(r, select) => <EntitySquareCard name={r.name} imageUrl={r.image_url} selected={draft.raceId === r.id}
            onClick={select} preview={<RacePreview race={r} disableHover/>} supportEntity={r}/>}
          >{r => r.traits?.length ? <ForgeTraitsBlock traits={r.traits}/> : null}</ForgeEntitySelection>
      </div>

      {/* Подвиды — сразу под основным видом */}
      {!expanded && hasEntitySubraces && subraceUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Подвид</div>
          <ForgeEntitySelection entities={subraces as Race[]} selectedId={draft.lineageId} onSelect={onPickSubrace} onBeginChange={onBeginLineageChange} onExpandedChange={setSubraceExpanded} entityKind="races"
            renderCard={(r, select) => <EntitySquareCard name={r.name} imageUrl={r.image_url} selected={draft.lineageId === r.id}
              onClick={select} preview={<RacePreview race={r} disableHover/>} supportEntity={r}/>}
            >{r => r.traits?.length ? <ForgeTraitsBlock traits={r.traits}/> : null}</ForgeEntitySelection>
        </div>
      )}
      {!expanded && hasEntitySubraces && !subraceUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Подвид</div>
          <p className="forge-note forge-note--center">Выбор подвида откроется на {subraceLevel}-м уровне.</p>
        </div>
      )}
      {!expanded && hasSubfeatureSubraces && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">{subChoice?.prompt || 'Подвид'}</div>
          <div className="forge-square-grid">
            {subChoiceItems.map((item) => (
              <EntitySquareCard
                key={item.id}
                name={item.name}
                selected={draft.lineageId === item.id}
                onClick={() => setResolved(subChoice!.id, draft.lineageId === item.id ? [] : [item.id])}
              />
            ))}
          </div>
        </div>
      )}

      {assembled && !expanded && (
        <ForgeOriginAbilities assembled={assembled} kind="race" fallbackImageUrl={race?.image_url} hiddenOriginIds={subraceExpanded && draft.lineageId ? [draft.lineageId] : []}/>
      )}

      {!expanded && <><ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} />
      <ChoiceList choices={ownChoices || []} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} title="Параметры выбранных черт" /></>}
    </div>
  );
}

function ClassSection({ classes, draft, onSelect, onBeginChange, onBeginSubclassChange, assembled, onToggleSkill, choices, ownChoices, resolved, setResolved, ruleState, allFeats, activeFeats, subclasses = [], subclassUnlocked = false, onPickSubclass, onEquipmentOption }: any) {
  const [expanded,setExpanded]=useState(!draft.classId);
  const [subclassExpanded,setSubclassExpanded]=useState(!draft.subclassId);
  const sc = classSkillChoice(assembled);
  const topClasses = (classes as CharacterClass[]).filter((c) => !c.is_subclass);
  const klass = classes.find((c: CharacterClass) => c.id === draft.classId) as CharacterClass | undefined;
  const subclass = (subclasses as CharacterClass[]).find((c) => c.id === draft.subclassId);
  // Варианты стартового снаряжения класса (А/Б/В) — по образцу предыстории.
  const equipOptions = klass?.equipment_options;
  const equipVariants = ([
    ['a', 'А', equipOptions?.option_a],
    ['b', 'Б', equipOptions?.option_b],
    ['c', 'В', equipOptions?.option_c],
  ] as const).filter(([, , opt]) => !!opt && ((opt.items?.length || 0) > 0 || (opt.gold || 0) > 0));
  return (
    <div>
      <div className="forge-block forge-square-block">
        <ForgeEntitySelection entities={topClasses} selectedId={draft.classId} onSelect={onSelect} onBeginChange={onBeginChange} onExpandedChange={setExpanded} entityKind="classes"
          renderCard={(c, select) => <EntitySquareCard name={c.name} imageUrl={c.image_url} selected={draft.classId === c.id}
            onClick={select} preview={<ClassPreview characterClass={c} disableHover/>} supportEntity={c}/>}
          >{c => c.hit_die ? <p className="forge-note">Кость хитов: {c.hit_die}</p> : null}</ForgeEntitySelection>
      </div>
      {klass && !expanded && equipVariants.length > 0 && <ForgeStartingEquipment options={equipOptions}
        selected={draft.classEquipmentOption} onSelect={(k) => onEquipmentOption?.(k)} />}
      {klass && !expanded && (subclasses as CharacterClass[]).length > 0 && subclassUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h">Подкласс</div>
          <ForgeEntitySelection entities={subclasses as CharacterClass[]} selectedId={draft.subclassId} onSelect={id=>onPickSubclass?.(id)} onBeginChange={onBeginSubclassChange} onExpandedChange={setSubclassExpanded} entityKind="classes"
            renderCard={(c,select)=><EntitySquareCard name={c.name} imageUrl={c.image_url} selected={draft.subclassId===c.id} onClick={select} preview={<ClassPreview characterClass={c} disableHover/>} supportEntity={c}/>}/>
        </div>
      )}
      {draft.classId && assembled && !expanded && (
        <ForgeOriginAbilities assembled={assembled} kind="class" fallbackImageUrl={klass?.image_url} hiddenOriginIds={subclassExpanded && subclass ? [subclass.id] : []}/>
      )}
      {!expanded && sc && (
        <div className="forge-block">
          <div className="forge-section-h">Навыки класса — выберите {sc.count}</div>
          <div className="chips">
            {sc.options.map((skill: string) => {
              const selected = draft.classSkillChoices.includes(skill);
              const existing = getSkillGrantSource(ruleState, skill);
              const disabled = !!existing && !selected;
              return (
                <button key={skill} type="button" className={`chip ${selected ? 'on' : ''} ${sc.recommended.includes(skill) ? 'rec' : ''}`} disabled={disabled}
                  aria-description={disabled ? grantReason(existing) : undefined} onClick={() => onToggleSkill(skill)}>
                  {labelOf(SKILLS, skill)}
                </button>
              );
            })}
          </div>
          <div className={`choice-count ${draft.classSkillChoices.length >= sc.count ? 'done' : ''}`}>
            Выбрано {draft.classSkillChoices.length} из {sc.count}
          </div>
        </div>
      )}
      {!expanded && <><ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} />
      <ChoiceList choices={ownChoices || []} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} title="Параметры выбранных черт" />
      </>}
    </div>
  );
}

function SubclassSection({ choices, resolved, setResolved, ruleState, klass, allFeats }: any) {
  if (!klass) return <p className="forge-note">Сначала выберите класс.</p>;
  return (
    <div>
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} title="Выберите подкласс" />
      {choices.length === 0 && <p className="forge-note">Для этого класса подкласс на 1 уровне не выбирается.</p>}
    </div>
  );
}

function ForgeStartingEquipment({options,selected,onSelect}: React.ComponentProps<typeof BackgroundEquipment>) {
  return <section className="forge-block forge-starting-equipment">
    <div className="forge-section-h">Стартовое снаряжение</div>
    <BackgroundEquipment options={options} hideHeading selectable selected={selected} onSelect={onSelect}/>
  </section>;
}

function BackgroundSection({ backgrounds, draft, onSelect, onBeginChange, feats, onToggleSwapFeat, onEquipmentOption }: any) {
  const [expanded,setExpanded]=useState(!draft.backgroundId);
  const background=(backgrounds as Background[]).find(bg=>bg.id===draft.backgroundId);
  return <div><div className="forge-block forge-square-block">
    <ForgeEntitySelection entities={backgrounds as Background[]} selectedId={draft.backgroundId}
      onSelect={onSelect} onBeginChange={onBeginChange} onExpandedChange={setExpanded} entityKind="backgrounds"
      emptyText="Нет предысторий в базе." renderCard={(bg, select) => (
        <EntitySquareCard name={bg.name} imageUrl={bg.image_url} selected={draft.backgroundId === bg.id}
          onClick={select} preview={<BackgroundPreview background={bg} disableHover />} supportEntity={bg} />
      )}>
      {(bg) => {
        const originFeat = (feats as Feat[]).find(f => f.id === bg.origin_feat || f.card_number === bg.origin_feat);
        return <>
          <p className="forge-note">
            Навыки: {(bg.skill_proficiencies || []).map(s => labelOf(SKILLS, normalizeSkillId(s))).join(', ') || '—'}<br />
            Инструмент: {bg.tool_proficiency || '—'}<br />
            Характеристики: {(bg.ability_scores || []).map(a => labelOf(ABILITIES, a)).join(', ') || '—'}
          </p>
          <div className="forge-note forge-origin-feat"><span>Черта происхождения:</span>
            {originFeat ? <ForgeFeatLine feat={originFeat} /> : <span>Черта недоступна</span>}
          </div>
          <label className="forge-check">
            <input type="checkbox" checked={!!draft.swapFeat} onChange={e => onToggleSwapFeat(e.target.checked)} />
            <span>Сменить черту происхождения</span>
          </label>
        </>;
      }}
    </ForgeEntitySelection>
  </div>
    {background&&!expanded&&background.equipment_options&&<ForgeStartingEquipment options={background.equipment_options}
      selected={draft.equipmentOption} onSelect={onEquipmentOption}/>}
  </div>;
}

function FeatSection({ feats, draft, onToggle, swapFeat, choices, ownChoices, resolved, setResolved, ruleState, activeFeats }: any) {
  // В сетке смены черты предыстории — только черты происхождения;
  // полный список нужен ChoiceResolver-у для choice(source:"feat").
  const originFeats = (feats as Feat[]).filter((f) => f.category === 'origin');
  return (
    <div>
      {swapFeat && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Черта происхождения</div>
          <div className="forge-square-grid">
            {originFeats.map((f: Feat) => (
              <EntitySquareCard key={f.id} name={f.name} imageUrl={f.image_url} selected={draft.featIds.includes(f.id)} onClick={() => onToggle(f.id)} preview={<FeatPreview feat={f} disableHover />} supportEntity={f} />
            ))}
            {originFeats.length === 0 && <p className="forge-note">Нет черт происхождения в базе.</p>}
          </div>
        </div>
      )}
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={feats} activeFeats={activeFeats} title="Выбор черты" />
      {/* Собственные выборы выбранных черт (навыки «Одарённого», характеристика ASI и т.п.). */}
      <ChoiceList choices={ownChoices || []} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={feats} activeFeats={activeFeats} title="Параметры черт" />
    </div>
  );
}

function SpellsSection({ spells, granted, choices, ownerChoices, maxSlotLevel = 0, ruleState, resolved, setResolved, replacementLimits = {}, originalSelections = {} }: {
  spells: Spell[]; granted: Spell[]; choices: PendingChoice[];
  replacementLimits?: Record<string, number>;
  originalSelections?: Record<string, string[]>;
  // Полный набор spell-выборов для дедупа (по умолчанию = отображаемые choices). На уровень-апе
  // сюда передаётся ВЕСЬ набор spell-выборов (включая решённые на прошлых уровнях), а choices —
  // лишь незавершённые; так уже известные заклинания исключаются из выбора, как в кузне.
  ownerChoices?: PendingChoice[];
  maxSlotLevel?: number; // для choice-фильтра only_available_slots
  ruleState: CharacterRuleState;
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
}) {
  const { entityDisplay } = useSiteSettings();
  const spellRows = entityDisplay.spells === 'row';
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<Spell | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const spellByReference = useMemo(() => new Map(spells.flatMap((spell) => (
    [[spell.id, spell.id], [spell.card_number, spell.id]] as const
  ))), [spells]);
  const canonicalSpellId = useCallback(
    (reference: string) => spellByReference.get(reference) ?? reference,
    [spellByReference],
  );

  const grantedFiltered = useMemo(
    () => granted.filter((spell) => !search || spell.name.toLowerCase().includes(search.toLowerCase())),
    [granted, search],
  );

  const selectedSpellOwners = useMemo(() => {
    const owners = new Map<string, { choiceId: string; label: string }>();
    // Автоматически выданные заклинания персонаж уже знает — исключаем из выбора (owner без choiceId
    // текущего выбора → всегда disabled). choiceId '__granted__' не совпадёт ни с одним реальным.
    for (const spell of granted) {
      const canonical = canonicalSpellId(spell.id);
      if (!owners.has(canonical)) owners.set(canonical, { choiceId: '__granted__', label: 'Уже получено' });
    }
    // Дедуп по ВСЕМ spell-выборам (ownerChoices), а не только отображаемым: на уровень-апе это ловит
    // заклинания, выбранные на прошлых уровнях (их choices уже решены и в choices не попадают).
    for (const choice of ownerChoices ?? choices) {
      // Preparing a spell does not grant it a second time. The source
      // spellbook remains the sole owner of the grant/provenance.
      if (choice.source === 'prepared_spell') continue;
      const origin = [choice.origin.name, choice.origin.featureName].filter(Boolean).join(' · ');
      const label = origin ? `${choice.prompt} (${origin})` : choice.prompt;
      for (const reference of resolved[choice.id] || []) {
        const canonical = canonicalSpellId(reference);
        if (!owners.has(canonical)) owners.set(canonical, { choiceId: choice.id, label });
      }
    }
    return owners;
  }, [choices, ownerChoices, granted, resolved, canonicalSpellId]);

  const replacementAllowed = (choice: PendingChoice, next: string[]) => (
    replacementLimits[choice.id] == null || levelUpReplacementAllowed(
      (originalSelections[choice.id] ?? []).map(canonicalSpellId),
      next.map(canonicalSpellId), replacementLimits[choice.id],
    )
  );

  const toggleChoiceSpell = (choice: PendingChoice, spellId: string) => {
    const value = resolved[choice.id] || [];
    const canonicalValue = value.map(canonicalSpellId);
    if (canonicalValue.includes(spellId)) {
      const next = value.filter((reference) => canonicalSpellId(reference) !== spellId);
      if (replacementAllowed(choice, next)) setResolved(choice.id, next);
      return;
    }
    const owner = selectedSpellOwners.get(spellId);
    const ownedByPreparedSource = preparedSpellChoiceAllowsOwnedOption(
      choice,
      spellId,
      canonicalSpellId,
    );
    if (owner && owner.choiceId !== choice.id && !ownedByPreparedSource) return;
    const optionIds = spells
      .filter((spell) => spellMatchesChoice(spell, choice, maxSlotLevel))
      .map((spell) => spell.id);
    const unavailable = unavailableChoiceOptions(
      choice,
      ruleState,
      optionIds,
      canonicalValue,
      { canonicalSpellId },
    );
    if (unavailable[spellId]) return;
    const next = canonicalValue.length >= choice.count
      ? [...canonicalValue.slice(1), spellId]
      : [...canonicalValue, spellId];
    if (replacementAllowed(choice, next)) setResolved(choice.id, next);
  };

  return (
    <div>
      <div className="spell-toolbar">
        <input className="forge-input" style={{ maxWidth: 260 }} placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {grantedFiltered.length > 0 && (
        <div className="forge-block">
          <div className="forge-section-h">Получено от вида, класса или черты</div>
          <p className="forge-note">Эти заклинания выдаются автоматически и не требуют выбора.</p>
          {spellRows ? (
            <div className="sheet-item-cols">
              {grantedFiltered.map((spell) => (
                <SheetEntityRow
                  key={spell.id}
                  imageUrl={spell.image_url}
                  name={spell.name}
                  detail={spellDetail(spell)}
                  title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                  onMouseEnter={(e) => { setHovered(spell); setMouse(previewAnchor(e.currentTarget)); }}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            </div>
          ) : (
            <div className="forge-spell-icon-grid">
              {grantedFiltered.map((spell) => (
                <div key={spell.id} className="forge-spell-icon ready" aria-description={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                  onMouseEnter={(e) => { setHovered(spell); setMouse(previewAnchor(e.currentTarget)); }}
                  onMouseLeave={() => setHovered(null)}>
                  <img src={spell.image_url?.trim() || '/default_image.png'} alt={spell.name}
                    onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                  {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {choices.length === 0 && granted.length === 0 && (
        <p className="forge-note">Этот персонаж пока не получил заклинаний из эффектов класса, вида или черт.</p>
      )}
      {choices.map((choice) => {
        const selected = (resolved[choice.id] || []).map(canonicalSpellId);
        const filtered = spells
          .filter((spell) => spellMatchesChoice(spell, choice, maxSlotLevel))
          .filter((spell) => !search || spell.name.toLowerCase().includes(search.toLowerCase()));
        const unavailable = unavailableChoiceOptions(
          choice,
          ruleState,
          spells.filter((spell) => spellMatchesChoice(spell, choice, maxSlotLevel)).map((spell) => spell.id),
          selected,
          { canonicalSpellId },
        );
        const done = selected.length >= choice.count;
        return (
          <div className="forge-block" key={choice.id}>
            <div className="forge-section-h">{choice.prompt}</div>
            {replacementLimits[choice.id] != null && (
              <p className="forge-note">{replacementLimits[choice.id] === 0
                ? "Выбор уже сохранён. Завершите подтверждение уровня."
                : `Можно заменить ранее выбранные заклинания: ${replacementLimits[choice.id]}. Сначала снимите выбор с заменяемого заклинания.`}</p>
            )}
            <div className={`choice-count ${done ? 'done' : ''}`}>Выбрано {selected.length} из {choice.count}</div>
            <div className="forge-spell-icon-grid">
              {filtered.map((spell) => {
                const isSelected = selected.includes(spell.id);
                const owner = selectedSpellOwners.get(spell.id);
                const disabledReason = unavailable[spell.id];
                const ownedByPreparedSource = preparedSpellChoiceAllowsOwnedOption(
                  choice,
                  spell.id,
                  canonicalSpellId,
                );
                const ownerBlocks = !!owner && owner.choiceId !== choice.id && !ownedByPreparedSource;
                const candidate = isSelected ? selected.filter((id) => id !== spell.id)
                  : selected.length >= choice.count ? [...selected.slice(1), spell.id] : [...selected, spell.id];
                const replacementBlocked = !replacementAllowed(choice, candidate);
                const disabled = ownerBlocks || (!!disabledReason && !isSelected) || replacementBlocked;
                const title = disabled
                  ? (ownerBlocks ? `Уже выбрано: ${owner?.label}` : replacementBlocked ? "Лимит замен на этом уровне исчерпан" : disabledReason)
                  : `${spell.name} · ${getSpellLevelLabel(spell.level)}`;
                const hoverHandlers = {
                  onMouseEnter: (e: React.MouseEvent) => { setHovered(spell); setMouse(previewAnchor(e.currentTarget)); },
                  onMouseLeave: () => setHovered(null),
                };
                return (
                  <button key={spell.id} type="button"
                    className={`forge-spell-icon ${isSelected ? 'selected' : disabled ? 'disabled' : 'ready'}`}
                    aria-disabled={disabled || undefined}
                    onClick={disabled ? undefined : () => toggleChoiceSpell(choice, spell.id)}
                    {...hoverHandlers} aria-description={title}>
                    <img src={spell.image_url?.trim() || '/default_image.png'} alt={spell.name}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                    {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
                    </button>
                );
              })}
              {filtered.length === 0 && <p className="forge-note">Нет доступных заклинаний по этому фильтру.</p>}
            </div>
          </div>
        );
      })}
      {hovered && (
        <div className="fixed z-50 pointer-events-none entity-preview-enter" style={{
          left: Math.min(mouse.x + 16, window.innerWidth - 360),
          top: Math.min(Math.max(mouse.y - 40, 10), window.innerHeight - 20),
          transform: mouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
        }}>
          <SpellPreview spell={hovered} disableHover={true} />
        </div>
      )}
    </div>
  );
}

export default CharacterForge;
