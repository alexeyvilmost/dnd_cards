import { useDeferredValue, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, User, Swords, Shield, ScrollText, Star, Zap, Sparkles, Sun, Moon, FileText, Settings } from 'lucide-react';
import { racesApi, classesApi, backgroundsApi, featsApi, spellsApi } from '../api/client';
import type { Race, CharacterClass, Background, Feat, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { characterV3ErrorMessage, charactersV3Api } from '../character/api';
import { buildCharacterContext } from '../character/runtime';
import { buildResourceRuntimePatch, syncRuntimeResources } from '../character/resourceInit';
import { projectCharacterStartingEquipmentPatch } from '../character/startingEquipment';
import { runtimeSeedFromSavePayload, saveCharacter } from '../character/saveCharacter';
import { maxAvailableSpellSlotLevel, resolveByLevel } from '../engine/resources';
import { useResourceOptions } from '../utils/resources';
import { resourceView } from '../utils/eventDisplay';
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
} from '../character/types';
import { bonusOf, reapplyBonuses, reconcileBonusesForBackground } from '../character/pointBuy';
import { computeMulticlassMaxHP } from '../character/derive';
import { addClassLevel, draftClassLevels, multiclassPrerequisiteIssues } from '../character/multiclass';
import { buildSavePayload, completionIssues, classSkillChoice, characterToDraft, requiredChoiceIssues, resolveLineageName } from '../character/forgeHelpers';
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
import SupportStatusBadge from '../components/forge/SupportStatusBadge';
import ImageUploader from '../components/ImageUploader';
import { BackgroundEquipment } from '../components/BackgroundEquipment';
import { collectChosenSpellUuids, indexSpells } from '../engine/spellRefs';
import { spellMatchesChoice } from '../character/spellChoices';
import { isEntityUuid } from '../engine/ids';
import { isSpellSelectionChoice, requiresInitialCharacterChoice, type PendingChoice } from '../mechanics/collectChoices';
import { labelOf, SKILLS, ABILITIES } from '../mechanics/registries';
import { FormattedText } from '../utils/formattedText';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { CharacterFormulaProvider, formulaCtxFromCharacter } from '../contexts/CharacterFormulaContext';
import {
  filterEntitiesBySupport,
} from '../content/supportStatus';
import './CharacterForge.css';

const EMPTY_BUNDLE: EntityBundle = { race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [] };

// Автосейв черновика создания в localStorage (F5/«назад» не теряет выборы).
const FORGE_DRAFT_KEY = 'forge-draft';
const isDraftMeaningful = (d: CharacterDraft) =>
  !!(d.name?.trim() || d.lineageId || d.raceId || d.classId || d.backgroundId || d.featIds?.length);

// Вкладка «Общее» мобильного таб-бара = правый обзор (E6, сквозной шелл).
const FORGE_OVERVIEW_ID = 'overview';

const CharacterForge = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { entityDisplay } = useSiteSettings();

  // Справочники сущностей
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [showAllContent, setShowAllContent] = useState(false);

  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft());
  const [restorable, setRestorable] = useState<CharacterDraft | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<{
    refsKey: string;
    value: EntityBundle;
  } | null>(null);
  const bundleCacheRef = useRef(new Map<string, Promise<EntityBundle>>());
  const [active, setActive] = useState('race');
  const isMobile = useIsMobile();
  /** Режим повышения уровня: показываем только новое, база заблокирована. */
  const [levelUp, setLevelUp] = useState<{ fromLevel: number; fromClassLevels: Record<string, number>; selectedClassId: string } | null>(null);
  const [prevRefs, setPrevRefs] = useState<{
    effects: Set<string>;
    actions: Set<string>;
    choiceIds: Set<string>;
    maxHP: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<boolean>(() => {
    try { return localStorage.getItem('forge-theme') === 'paper'; } catch { return false; }
  });
  const toggleTheme = useCallback(() => {
    setPaper((prev) => {
      const next = !prev;
      try { localStorage.setItem('forge-theme', next ? 'paper' : 'dark'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const savedSkillsRef = useRef<string[]>([]);
  const restoredClassSkillsRef = useRef(false);
  const classSkillAutoSeededForRef = useRef<string | null>(null);
  // HP существующего персонажа при редактировании — чтобы правка посреди сессии
  // не восстанавливала хиты (E3). null = создание нового (полный HP).
  const savedHpRef = useRef<number | null>(null);

  // Загрузка справочников. При сбое сети — честный баннер + повтор (иначе
  // игрок видит враньё «Нет видов в базе» вместо ошибки).
  const loadCatalogs = useCallback(async () => {
    setCatalogError(false);
    try {
      const [rr, cc, bb, ff] = await Promise.all([
        racesApi.getRaces({ limit: 100, fields: 'list' }),
        classesApi.getClasses({ limit: 100, fields: 'list' }),
        backgroundsApi.getBackgrounds({ limit: 100, fields: 'list' }),
        featsApi.getFeats({ limit: 200, fields: 'list' }),
      ]);
      setRaces(rr.races || []);
      setClasses(cc.classes || []);
      setBackgrounds(bb.backgrounds || []);
      // Все черты: origin — для смены черты происхождения, fighting_style
      // и другие категории — как варианты choice(source:"feat").
      setFeats(ff.feats || []);
    } catch (e) {
      console.error(e);
      setCatalogError(true);
    }
  }, []);
  useEffect(() => { void loadCatalogs(); }, [loadCatalogs]);

  // A fresh level-1 Forge used to download every spell in the database.
  // Load only cantrips and levels the current character can reach; the cap
  // grows automatically during level-up and official 2024 player spells end
  // at level 9.
  const forgeSpellLevelCap = Math.min(9, Math.max(1, Math.ceil((draft.level || 1) / 2)));
  useEffect(() => {
    let stale = false;
    spellsApi.getSpells({ limit: 500, max_level: forgeSpellLevelCap, fields: 'list' })
      .then((response) => { if (!stale) setSpells(response.spells || []); })
      .catch((reason) => {
        console.error(reason);
        if (!stale) setCatalogError(true);
      });
    return () => { stale = true; };
  }, [forgeSpellLevelCap]);

  const visibleRaces = useMemo(
    () => filterEntitiesBySupport(races, showAllContent, [draft.raceId, draft.lineageId].filter(Boolean) as string[]),
    [races, showAllContent, draft.raceId, draft.lineageId],
  );
  const visibleClasses = useMemo(
    () => filterEntitiesBySupport(classes, showAllContent, [draft.classId, draft.subclassId].filter(Boolean) as string[]),
    [classes, showAllContent, draft.classId, draft.subclassId],
  );
  const visibleBackgrounds = useMemo(
    () => filterEntitiesBySupport(backgrounds, showAllContent, draft.backgroundId ? [draft.backgroundId] : []),
    [backgrounds, showAllContent, draft.backgroundId],
  );
  const resolvedEntityIds = useMemo(
    () => Object.values(draft.resolvedChoices).flat(),
    [draft.resolvedChoices],
  );
  const visibleFeats = useMemo(
    () => filterEntitiesBySupport(feats, showAllContent, [...draft.featIds, ...resolvedEntityIds]),
    [feats, showAllContent, draft.featIds, resolvedEntityIds],
  );
  const visibleSpells = useMemo(
    () => filterEntitiesBySupport(spells, showAllContent, resolvedEntityIds),
    [spells, showAllContent, resolvedEntityIds],
  );
  // При входе в режим создания — предложить восстановить сохранённый черновик.
  useEffect(() => {
    if (editId) { setRestorable(null); return; }
    try {
      const raw = localStorage.getItem(FORGE_DRAFT_KEY);
      if (!raw) return;
      const parsed = { ...emptyDraft(), ...(JSON.parse(raw) as Partial<CharacterDraft>) };
      if (isDraftMeaningful(parsed)) setRestorable(parsed);
    } catch { /* ignore */ }
  }, [editId]);

  // Автосейв черновика (только создание): пустой не сохраняем, чтобы не затереть.
  useEffect(() => {
    if (editId) return;
    if (!isDraftMeaningful(draft)) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(FORGE_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [draft, editId]);

  // Переход «редактирование → создание» без размонтирования (те же роуты
  // /character-forge/:id и /character-forge): сбросить черновик, иначе
  // сохранение перезапишет предыдущего персонажа.
  useEffect(() => {
    if (editId) return;
    setDraft(emptyDraft());
    setSavedId(null);
    savedSkillsRef.current = [];
    restoredClassSkillsRef.current = false;
    savedHpRef.current = null;
  }, [editId]);

  // Загрузка существующего черновика для редактирования.
  // ?levelup=1 (кнопка «Поднять уровень» на листе) — особый режим: +1 уровень,
  // показываются только новые умения и выборы (раса/класс/предыстория заблокированы).
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c = await charactersV3Api.get(editId);
        if (isCharacterReadOnly(c)) {
          navigate(`/characters-v3/${c.id}`, {
            replace: true,
            state: { notice: 'Архивный публичный лист доступен только для чтения.' },
          });
          return;
        }
        savedSkillsRef.current = c.skill_proficiencies || [];
        savedHpRef.current = c.current_hp ?? null;
        restoredClassSkillsRef.current = false;
        const d = characterToDraft(c);
        if (searchParams.get('levelup') === '1') {
          const fromLevel = d.level || 1;
          const fromClassLevels = draftClassLevels(d);
          d.level = Math.min(20, fromLevel + 1);
          if (d.classId && fromLevel < 20) d.classLevels = addClassLevel({ ...d, level: fromLevel, classLevels: fromClassLevels }, d.classId);
          setLevelUp({ fromLevel, fromClassLevels, selectedClassId: d.classId ?? '' });
          setSearchParams({}, { replace: true });
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
      }
    });
    return () => { stale = true; };

  }, [refsKey]);

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
    () => maxAvailableSpellSlotLevel(
      syncRuntimeResources(buildCharacterContext(ruleState, draft, [], assembled.klass), assembled, undefined, ruleState.freeuseSpells).maxResources,
    ),
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
    setDraft((d) => ({ ...d, resolvedChoices: { ...d.resolvedChoices, [choiceId]: vals } }));
  }, []);
  const setResolvedBatch = useCallback((values: Record<string, string[]>) => {
    setDraft((d) => ({ ...d, resolvedChoices: { ...d.resolvedChoices, ...values } }));
  }, []);
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
  const selectLineage = (id: string) => {
    const removing = draft.lineageId === id;
    patch({ lineageId: removing ? null : id });
  };
  const selectSubclass = (id: string) => {
    const removing = draft.subclassId === id;
    patch({ subclassId: removing ? null : id });
  };
  const selectClass = (cid: string) => {
    classSkillAutoSeededForRef.current = null;
    setDraft((d) => {
      const next = { ...d, classId: cid, classLevels: { [cid]: Math.max(1, d.level) }, subclassId: null, classSkillChoices: [] as string[] };
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
    let stale = false;
    (async () => {
      const oldDraft = { ...draft, level: levelUp.fromLevel, classLevels: levelUp.fromClassLevels };
      const oldBundle = await loadBundle(oldDraft);
      if (stale) return;
      // Идентификаторы выборов, существовавших НА СТАРОМ уровне — чтобы на уровень-апе отличать
      // выборы этого уровня (их показываем даже заполненными, #3) от прежних.
      const oldAssembled = assemble({ ...oldBundle, spells: [] }, oldDraft);
      const prevChoiceIds = new Set(oldAssembled.pendingChoices.map((pc) => pc.id));
      setPrevRefs({
        effects: new Set(oldBundle.effects.map((e) => e.effect.id)),
        actions: new Set(oldBundle.actions.map((a) => a.action.id)),
        choiceIds: prevChoiceIds,
        maxHP: resolveCharacterRules({ draft: oldDraft, assembled: oldAssembled }).maxHP,
      });
    })();
    return () => { stale = true; };

  }, [levelUp?.fromLevel, levelUp?.selectedClassId, draft.classId, draft.raceId]);

  const issues = useMemo(
    () => completionIssues(draft, assembled, ruleState),
    [draft, assembled, ruleState],
  );
  const canCreate = bundleReady && issues.length === 0;

  const save = async () => {
    if (!bundleReady) return;
    setSaving(true); setError(null);
    try {
      const isCreate = !draft.id;
      const localAvatar = draft.avatarUrl?.startsWith('data:') ? draft.avatarUrl : null;
      const payload = buildSavePayload(draft, assembled, ruleState, savedHpRef.current ?? undefined);
      // A data URL is only the local preview. The durable row receives the
      // object-storage URL after the owner-scoped upload below.
      if (localAvatar) payload.avatar_url = '';
      const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
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
        res = await charactersV3Api.update(draft.id!, payload);
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
        if (runtimePatch) res = await charactersV3Api.patchRuntime(res.id, runtimePatch);
      }
      if (localAvatar) {
        const avatarBlob = await fetch(localAvatar).then((response) => response.blob());
        const avatarFile = new File([avatarBlob], 'character-token.png', { type: avatarBlob.type || 'image/png' });
        const avatarUrl = await charactersV3Api.uploadAvatar(res.id, avatarFile);
        res = { ...res, avatar_url: avatarUrl };
      }
      setSavedId(res.id);
      setDraft((d) => ({ ...d, id: res.id, avatarUrl: res.avatar_url || d.avatarUrl }));
      // Последующие сохранения в этой же сессии тоже не должны лечить (E3).
      savedHpRef.current = payload.current_hp ?? null;
      // Успешно сохранён — черновик-автосейв больше не нужен.
      setRestorable(null);
      try { localStorage.removeItem(FORGE_DRAFT_KEY); } catch { /* ignore */ }
      if (isCreate) navigate(`/characters-v3/${res.id}`, { replace: true });
    } catch (e) {
      console.error(e);
      setError(characterV3ErrorMessage(e, 'Ошибка сохранения персонажа'));
    } finally {
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

  // Подвиды — отдельные виды-сущности с parent_race_id текущего вида
  const subraces = draft.raceId ? races.filter((r) => r.parent_race_id === draft.raceId) : [];
  const selectableSubraces = draft.raceId
    ? visibleRaces.filter((r) => r.parent_race_id === draft.raceId)
    : [];
  const selectedRace = draft.raceId ? races.find((r) => r.id === draft.raceId) : undefined;
  const subraceLevel = selectedRace?.subrace_level ?? 1;
  const subraceUnlocked = draft.level >= subraceLevel;

  // Подклассы — отдельные классы-сущности с parent_class_id текущего класса
  const subclasses = draft.classId ? classes.filter((c) => c.parent_class_id === draft.classId) : [];
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
  sections.push({ id: 'race', label: 'Вид', icon: <User size={19} />, sub: [assembled.race?.name, lineageName].filter(Boolean).join(' · '), status: raceDone ? 'ok' : 'todo' });
  sections.push({ id: 'class', label: 'Класс', icon: <Swords size={19} />, sub: assembled.klass?.name, status: classDone ? 'ok' : 'todo' });
  if (hasSubclass) sections.push({ id: 'subclass', label: 'Подкласс', icon: <Shield size={19} />, sub: subclassName, status: subclassDone ? 'ok' : 'todo' });
  if (hasSpells) sections.push({ id: 'spells', label: 'Заклинания', icon: <Sparkles size={19} />, sub: spellChoices.length ? `${selectedSpellCount}/${requiredSpellCount}` : `${grantedSpells.length} получено`, status: spellsDone ? 'ok' : 'todo' });
  sections.push({ id: 'background', label: 'Предыстория', icon: <ScrollText size={19} />, sub: assembled.background?.name, status: draft.backgroundId ? 'ok' : 'todo' });
  if (hasFeatTab) sections.push({ id: 'feat', label: 'Черта', icon: <Star size={19} />, sub: assembled.feats[0]?.name, status: featDone ? 'ok' : 'todo' });
  sections.push({ id: 'abilities', label: 'Характеристики', icon: <Zap size={19} />, sub: `${abilitiesAssigned}/6`, status: abilitiesDone ? 'ok' : 'todo' });

  // Мобильный сквозной таб-бар (E6): добавляем вкладку «Общее» = правый обзор.
  const navSections: ForgeSectionDef[] = isMobile
    ? [...sections, { id: FORGE_OVERVIEW_ID, label: 'Общее', icon: <ScrollText size={19} />, status: null }]
    : sections;
  const act = navSections.some((s) => s.id === active) ? active : 'race';
  const showOverviewInMain = isMobile && act === FORGE_OVERVIEW_ID;
  const sectionTitle = sections.find((s) => s.id === act)?.label ?? 'Вид';
  const rootCls = paper ? 'forge sheet-paper' : 'forge';

  // Обзор — переиспользуем и в правой колонке (десктоп), и во вкладке «Общее» (моб.).
  const overviewPanel = (
    <OverviewPanel
      draft={draft} patch={patch} assembled={assembled} ruleState={ruleState} spells={selectedSpells}
      lineageName={lineageName} subChoices={raceSubChoices} subraces={subraces}
      issues={issues} canCreate={canCreate} saving={saving} onSave={save}
      savedId={savedId} error={error} onOpenSheet={() => savedId && navigate(`/characters-v3/${savedId}`)}
    />
  );
  const supportFilterControl = (
    <label className="forge-support-filter">
      <input
        type="checkbox"
        checked={showAllContent}
        onChange={(event) => setShowAllContent(event.target.checked)}
      />
      <span>
        Показать все сущности
        <small>
          {showAllContent
            ? ' Непроверенные варианты доступны без дополнительных окон.'
            : ' Сейчас показан только проверенный каталог.'}
        </small>
      </span>
    </label>
  );

  // ─── Режим повышения уровня: только новое, база заблокирована ───
  if (levelUp) {
    const rootClasses = visibleClasses.filter((entry) => !entry.parent_class_id && !entry.is_subclass);
    const selectedLevelClass = classes.find((entry) => entry.id === levelUp.selectedClassId);
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
    const unresolvedOther = unresolved.filter((pc) => !isSpellSelectionChoice(pc));
    // #3: spell-выборы, появившиеся на ЭТОМ уровне (нет в prevRefs), показываем ЦЕЛИКОМ — в т.ч.
    // уже заполненные, чтобы игрок мог переиграть выбор, не уходя «назад». До загрузки prevRefs —
    // fallback на незавершённые (как раньше).
    const newSpellChoices = prevRefs
      ? spellChoices.filter((pc) => (
          !prevRefs.choiceIds.has(pc.id)
          || unresolvedSpells.some((unresolvedChoice) => unresolvedChoice.id === pc.id)
        ))
      : unresolvedSpells;
    const oldMaxHP = prevRefs?.maxHP ?? computeMulticlassMaxHP(
      (assembled.classes ?? []).map((klass) => ({
        id: klass.id,
        hit_die: klass.hit_die,
        level: levelUp.fromClassLevels[klass.id] ?? 0,
      })),
      draft.classId,
      draft.abilities.con,
    );
    // #2: ресурсы, выданные/увеличенные классом на этом уровне (ячейки, заряды и т.п.) — по дельте
    // by_level-сеток между старым и новым уровнем. Не-by_level ресурсы (count/max) → 0, отсекаются.
    const klassResources = (selectedLevelClass?.resources ?? {}) as Record<string, { by_level?: unknown }>;
    const selectedFromClassLevel = levelUp.fromClassLevels[levelUp.selectedClassId] ?? 0;
    const selectedToClassLevel = selectedFromClassLevel + 1;
    const resourceGains = Object.entries(klassResources)
      .map(([key, def]) => {
        const before = resolveByLevel(def?.by_level, selectedFromClassLevel) ?? 0;
        const after = resolveByLevel(def?.by_level, selectedToClassLevel) ?? 0;
        return { key, before, after, delta: after - before };
      })
      .filter((r) => r.delta > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
    // Блокируют подтверждение только незакрытые НОВЫЕ выборы; конфликты,
    // унаследованные от создания, показываем предупреждением (править их тут нечем).
    const blockingIssues = requiredChoiceIssues(draft, assembled);
    // Пересечение порога подкласса: выбор обязателен.
    const subclassDue = subclasses.length > 0 && subclassUnlocked && !draft.subclassId;
    if (subclassDue) {
      blockingIssues.unshift('Выберите подкласс');
    }
    // Подкласс редактируем только когда его выбирают ПРЯМО СЕЙЧАС (порог пересечён на этом
    // уровне или ещё не выбран). Выбранный на прошлом уровне — закреплён, как класс/вид (#4).
    const subclassEditable = subclasses.length > 0 && subclassUnlocked
      && ((levelUp.fromClassLevels[draft.classId ?? ''] ?? levelUp.fromLevel) < subclassLevel || !draft.subclassId);
    const subclassLocked = subclasses.length > 0 && subclassUnlocked && !subclassEditable && !!draft.subclassId;
    const conflictWarnings = ruleState.conflicts
      .filter((c) => c.severity === 'error')
      .map((c) => c.message);
    blockingIssues.unshift(...multiclassIssues.map((issue) => `Требование мультикласса: ${issue}`));
    const canConfirm = blockingIssues.length === 0 && !!levelUp.selectedClassId;

    return (
      <CharacterFormulaProvider value={formulaCtx}>
      <div className={rootCls}>
        <div className="forge-header sheet-header-bar">
          <button type="button" className="sheet-back" title="Отмена"
            onClick={() => navigate(`/characters-v3/${draft.id}`)}>
            <ArrowLeft size={18} />
          </button>
          <span>Повышение уровня — {draft.name || 'Без имени'}</span>
          <span />
        </div>
        <div className="sheet-scroll">
          <div className="levelup-wrap">
            <div className="levelup-head">
              <span className="levelup-badge">Уровень {levelUp.fromLevel} → {draft.level}</span>
              <span className="levelup-hp">
                Хиты: {oldMaxHP} → <b>{ruleState.maxHP}</b>
                {assembled.klass?.hit_die ? ` (кость хитов ${assembled.klass.hit_die})` : ''}
              </span>
              <span className="levelup-class">
                {assembled.klass?.name}{lineageName ? ` · ${lineageName}` : assembled.race ? ` · ${assembled.race.name}` : ''}
              </span>
            </div>
            <div className="forge-block">
              <div className="forge-section-h">Уровень класса</div>
              <p className="forge-note">Продолжите текущий класс или возьмите первый уровень другого класса.</p>
              <div className="forge-square-grid">
                {rootClasses.map((entry) => {
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
            </div>
            {supportFilterControl}

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

            {resourceGains.length > 0 && (
              <div className="forge-block">
                <div className="forge-section-h">Новые ресурсы</div>
                <div className="levelup-resources">
                  {resourceGains.map((r) => {
                    const { label, icon } = resourceView(resourceOptions, r.key);
                    return (
                      <div key={r.key} className="levelup-resource">
                        <img src={icon} alt="" className="levelup-resource-icon"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        <span className="levelup-resource-name">{label}</span>
                        <span className="levelup-resource-delta">
                          {r.before > 0 ? `${r.before} → ${r.after}` : `+${r.delta}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {subclassEditable && (
              <div className="forge-block forge-square-block">
                <div className="forge-section-h">Подкласс</div>
                <div className="forge-square-grid">
                  {(selectableSubclasses as CharacterClass[]).map((c) => (
                    <EntitySquareCard
                      key={c.id}
                      name={c.name}
                      imageUrl={c.image_url}
                      selected={draft.subclassId === c.id}
                      onClick={() => selectSubclass(c.id)}
                      preview={<ClassPreview characterClass={c} disableHover />}
                      supportEntity={c}
                    />
                  ))}
                </div>
                {draft.subclassId && (
                  <p className="forge-note">
                    {(subclasses as CharacterClass[]).find((c) => c.id === draft.subclassId)?.description}
                  </p>
                )}
              </div>
            )}
            {subclassLocked && (
              <div className="forge-block">
                <div className="forge-section-h">Подкласс</div>
                <p className="forge-note">
                  {(subclasses as CharacterClass[]).find((c) => c.id === draft.subclassId)?.name} — закреплён (как класс и вид).
                </p>
              </div>
            )}

            {unresolvedOther.length > 0 && (
              <ChoiceList
                choices={unresolvedOther}
                resolved={draft.resolvedChoices}
                setResolved={setResolved}
                ruleState={ruleState}
                feats={visibleFeats}
                title="Новые выборы"
              />
            )}

            {(newSpellChoices.length > 0) && (
              <div className="forge-block">
                <div className="forge-section-h">Новые заклинания</div>
                <SpellsSection
                  spells={visibleSpells}
                  granted={grantedSpells}
                  choices={newSpellChoices}
                  ownerChoices={spellChoices}
                  maxSlotLevel={maxSlotLevel}
                  ruleState={ruleState}
                  resolved={draft.resolvedChoices}
                  setResolved={setResolved}
                />
              </div>
            )}

            <div className="levelup-footer">
              {blockingIssues.length > 0 && (
                <ul className="issues forge-overview-issues">
                  {blockingIssues.slice(0, 4).map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              )}
              {conflictWarnings.length > 0 && (
                <p className="forge-note" title={conflictWarnings.join('\n')}>
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
                  onClick={async () => { await save(); navigate(`/characters-v3/${draft.id}`); }}
                >
                  {saving ? 'Сохранение…' : `Подтвердить уровень ${draft.level}`}
                </button>
                <button type="button" className="forge-btn ghost"
                  onClick={() => navigate(`/characters-v3/${draft.id}`)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
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
            onClick={() => void loadCatalogs()}
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
        <div className="forge-header-spacer" aria-hidden />
        <span className="forge-header-title">Создание персонажа</span>
        <div className="sheet-header-actions">
          <button
            type="button"
            className="sheet-header-btn"
            onClick={() => setSettingsOpen(true)}
            title="Настройки отображения"
          >
            <Settings size={16} />
            <span className="sheet-header-btn-label">Настройки</span>
          </button>
          <button
            type="button"
            className="sheet-header-btn"
            onClick={toggleTheme}
            title={paper ? 'Тёмная тема' : 'Светлая тема'}
          >
            {paper ? <Moon size={16} /> : <Sun size={16} />}
            <span className="sheet-header-btn-label">{paper ? 'Тёмная' : 'Светлая'}</span>
          </button>
          {(savedId || draft.id) && (
            <Link to={`/characters-v3/${savedId || draft.id}`} className="sheet-edit forge-header-sheet-link" title="Открыть лист персонажа">
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
          {supportFilterControl}
          {showOverviewInMain ? (
            <div className="forge-editor forge-editor--overview">{overviewPanel}</div>
          ) : (
          <>
          <div className="forge-main-title">{sectionTitle}</div>
          <div className="forge-editor">
              {act === 'race' && (
                <RaceSection races={visibleRaces} draft={draft} onSelect={selectRace}
                  subraces={selectableSubraces} subraceUnlocked={subraceUnlocked} subraceLevel={subraceLevel}
                  onPickSubrace={selectLineage}
                  choices={raceOtherChoices} subChoices={raceSubChoices}
                  resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} allFeats={visibleFeats} activeFeats={assembled.feats} />
              )}
              {act === 'class' && (
                <ClassSection classes={visibleClasses} draft={draft} onSelect={selectClass} assembled={assembled}
                  onToggleSkill={toggleClassSkill} choices={classOtherChoices} resolved={draft.resolvedChoices}
                  setResolved={setResolved} ruleState={ruleState} allFeats={visibleFeats} activeFeats={assembled.feats}
                  subclasses={selectableSubclasses} subclassUnlocked={subclassUnlocked} subclassLevel={subclassLevel}
                  onPickSubclass={selectSubclass}
                  onEquipmentOption={(opt: 'a' | 'b' | 'c') => patch({ classEquipmentOption: opt })} />
              )}
              {act === 'subclass' && (
                <SubclassSection choices={classSubChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} klass={assembled.klass} allFeats={visibleFeats} />
              )}
              {act === 'spells' && (
                <SpellsSection spells={visibleSpells} granted={grantedSpells} choices={spellChoices} ownerChoices={spellChoices} maxSlotLevel={maxSlotLevel} ruleState={ruleState} resolved={draft.resolvedChoices} setResolved={setResolved} />
              )}
              {act === 'background' && (
                <BackgroundSection backgrounds={visibleBackgrounds} draft={draft} onSelect={selectBackground}
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

function OverviewPanel({ draft, patch, assembled, ruleState, spells, lineageName, subChoices, subraces, issues, canCreate, saving, onSave, savedId, error, onOpenSheet }: {
  draft: CharacterDraft; patch: (p: Partial<CharacterDraft>) => void; assembled: AssembledCharacter; ruleState: CharacterRuleState; spells: Spell[];
  lineageName?: string; subChoices?: PendingChoice[]; subraces?: Race[];
  issues: string[]; canCreate: boolean; saving: boolean; onSave: () => void; savedId: string | null;
  error: string | null; onOpenSheet: () => void;
}) {
  // The editor controls stay immediate while the potentially long abilities /
  // spells summary is allowed to trail a rapid sequence of selections.
  const summarySnapshot = useMemo(
    () => ({ draft, assembled, ruleState, spells, lineageName }),
    [draft, assembled, ruleState, spells, lineageName],
  );
  const deferredSummary = useDeferredValue(summarySnapshot);
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
        <input className="forge-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Фарадей фон Грасс" />
        <div className="forge-section-h" style={{ marginTop: 10 }}>Уровень</div>
        <div className="forge-level-row">
          <button type="button" className="pb-btn" disabled={draft.level <= 1}
            onClick={() => patch({ level: Math.max(1, draft.level - 1) })}>−</button>
          <span className="pb-base">{draft.level}</span>
          <button type="button" className="pb-btn" disabled={draft.level >= 20}
            onClick={() => patch({ level: Math.min(20, draft.level + 1) })}>+</button>
        </div>
        <div className="forge-section-h" style={{ marginTop: 14 }}>Токен на поле боя</div>
        <ImageUploader
          currentImageUrl={draft.avatarUrl}
          onImageUpload={(avatarUrl) => patch({ avatarUrl })}
          className="forge-token-uploader"
        />
        <p className="forge-token-hint">Квадратное изображение лучше всего читается на сетке.</p>
      </div>

      <SummaryPanel
        draft={deferredSummary.draft}
        assembled={deferredSummary.assembled}
        ruleState={deferredSummary.ruleState}
        spells={deferredSummary.spells}
        lineageName={deferredLineageName}
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
          {saving ? 'Сохранение…' : draft.id ? 'Сохранить' : 'Создать персонажа'}
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
        const optionIds = optionsForChoice(pc, feats).map((option) => option.id);
        const featByReference = new Map((feats ?? []).flatMap((feat) => (
          [[feat.id, feat.id], [feat.card_number, feat.id]] as const
        )));
        const declarativeUnavailable = unavailableChoiceOptions(
          pc,
          ruleState,
          optionIds,
          value,
          {
            activeFeatIds: new Set((activeFeats ?? []).map((feat) => feat.id)),
            repeatableFeatIds: new Set((feats ?? []).filter((feat) => feat.repeatable).map((feat) => feat.id)),
            canonicalFeatId: (reference) => featByReference.get(reference) ?? reference,
          },
        );
        // Предел характеристики 2024 не является AppliedGrant: это отдельное
        // числовое ограничение поверх общей grant-semantics.
        const sourceUnavailable = pc.source === 'ability'
          ? Object.fromEntries(ABILITIES.map((ab) => {
            const score = ruleState.abilities?.[ab.id as AbilityKey] ?? 0;
            const capped = score >= 20 && !value.includes(ab.id);
            return [ab.id, capped ? 'Максимум 20' : undefined];
          }).filter(([, reason]) => !!reason)) as Record<string, string>
          : undefined;
        const unavailableOptions = {
          ...declarativeUnavailable,
          ...(sourceUnavailable ?? {}),
        };
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

function RaceSection({ races, draft, onSelect, subraces, subraceUnlocked, subraceLevel, onPickSubrace, choices, subChoices, resolved, setResolved, ruleState, allFeats, activeFeats }: any) {
  const topRaces = races.filter((r: Race) => !r.is_subrace);
  const race = races.find((r: Race) => r.id === draft.raceId) as Race | undefined;
  const subrace = (subraces as Race[]).find((r) => r.id === draft.lineageId);
  const subChoice = subChoices?.[0] as PendingChoice | undefined;
  const subChoiceItems = subChoice?.items ?? [];
  const hasEntitySubraces = race && (subraces as Race[]).length > 0;
  const hasSubfeatureSubraces = race && subChoiceItems.length > 0;

  return (
    <div>
      <div className="forge-block forge-square-block">
        <div className="forge-square-grid">
          {topRaces.map((r: Race) => (
            <EntitySquareCard
              key={r.id}
              name={r.name}
              imageUrl={r.image_url}
              selected={draft.raceId === r.id}
              onClick={() => onSelect(r.id)}
              preview={<RacePreview race={r} disableHover />}
              supportEntity={r}
            />
          ))}
          {topRaces.length === 0 && <p className="forge-note">Нет видов в базе.</p>}
        </div>
      </div>

      {/* Подвиды — сразу под основным видом */}
      {hasEntitySubraces && subraceUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Подвид</div>
          <div className="forge-square-grid">
            {(subraces as Race[]).map((r) => (
              <EntitySquareCard
                key={r.id}
                name={r.name}
                imageUrl={r.image_url}
                selected={draft.lineageId === r.id}
                onClick={() => onPickSubrace(r.id)}
                preview={<RacePreview race={r} disableHover />}
                supportEntity={r}
              />
            ))}
          </div>
        </div>
      )}
      {hasEntitySubraces && !subraceUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Подвид</div>
          <p className="forge-note forge-note--center">Выбор подвида откроется на {subraceLevel}-м уровне.</p>
        </div>
      )}
      {hasSubfeatureSubraces && (
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

      {race && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{race.name}</div>
          {race.description && (
            <p className="forge-note"><FormattedText text={race.description} emptyText="" /></p>
          )}
          {race.traits && race.traits.length > 0 && (
            <ForgeTraitsBlock traits={race.traits} />
          )}
        </div>
      )}

      {subrace && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{subrace.name}</div>
          {subrace.description && (
            <p className="forge-note"><FormattedText text={subrace.description} emptyText="" /></p>
          )}
          {subrace.traits && subrace.traits.length > 0 && (
            <ForgeTraitsBlock traits={subrace.traits} />
          )}
        </div>
      )}

      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} />
    </div>
  );
}

function ClassSection({ classes, draft, onSelect, assembled, onToggleSkill, choices, resolved, setResolved, ruleState, allFeats, activeFeats, subclasses = [], subclassUnlocked = false, subclassLevel = 3, onPickSubclass, onEquipmentOption }: any) {
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
        <div className="forge-square-grid">
          {topClasses.map((c: CharacterClass) => (
            <EntitySquareCard
              key={c.id}
              name={c.name}
              imageUrl={c.image_url}
              selected={draft.classId === c.id}
              onClick={() => onSelect(c.id)}
              preview={<ClassPreview characterClass={c} disableHover />}
              supportEntity={c}
            />
          ))}
          {topClasses.length === 0 && <p className="forge-note">Нет классов в базе.</p>}
        </div>
      </div>
      {klass && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{klass.name}{klass.hit_die ? ` · кость хитов ${klass.hit_die}` : ''}</div>
          {klass.description && (
            <p className="forge-note"><FormattedText text={klass.description} emptyText="" /></p>
          )}
          {equipVariants.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="forge-section-h">Стартовое снаряжение</div>
              <BackgroundEquipment options={equipOptions} selectable
                selected={draft.classEquipmentOption} onSelect={(k) => onEquipmentOption?.(k)} />
            </div>
          )}
        </div>
      )}
      {klass && (subclasses as CharacterClass[]).length > 0 && subclassUnlocked && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h">Подкласс</div>
          <div className="forge-square-grid">
            {(subclasses as CharacterClass[]).map((c) => (
              <EntitySquareCard
                key={c.id}
                name={c.name}
                imageUrl={c.image_url}
                selected={draft.subclassId === c.id}
                onClick={() => onPickSubclass?.(c.id)}
                preview={<ClassPreview characterClass={c} disableHover />}
                supportEntity={c}
              />
            ))}
          </div>
        </div>
      )}
      {klass && (subclasses as CharacterClass[]).length > 0 && !subclassUnlocked && (
        <div className="forge-block">
          <p className="forge-note forge-note--center">Выбор подкласса откроется на {subclassLevel}-м уровне.</p>
        </div>
      )}
      {subclass && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{subclass.name}</div>
          {subclass.description && (
            <p className="forge-note"><FormattedText text={subclass.description} emptyText="" /></p>
          )}
        </div>
      )}
      {draft.classId && assembled && (
        <ForgeOriginAbilities assembled={assembled} kind="class" fallbackImageUrl={klass?.image_url} />
      )}
      {sc && (
        <div className="forge-block">
          <div className="forge-section-h">Навыки класса — выберите {sc.count}</div>
          <div className="chips">
            {sc.options.map((skill: string) => {
              const selected = draft.classSkillChoices.includes(skill);
              const existing = getSkillGrantSource(ruleState, skill);
              const disabled = !!existing && !selected;
              return (
                <button key={skill} type="button" className={`chip ${selected ? 'on' : ''} ${sc.recommended.includes(skill) ? 'rec' : ''}`} disabled={disabled}
                  title={disabled ? grantReason(existing) : undefined} onClick={() => onToggleSkill(skill)}>
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
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} feats={allFeats} activeFeats={activeFeats} />
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

function BackgroundSection({ backgrounds, draft, onSelect, background, feats, onToggleSwapFeat, onEquipmentOption }: any) {
  const bgFromList = backgrounds.find((b: Background) => b.id === draft.backgroundId) as Background | undefined;
  const bg = background ?? bgFromList;
  const options = bg?.equipment_options;
  // Origin-черта предыстории → сущность (по card_number/uuid), для превью.
  const originFeat = bg?.origin_feat
    ? (feats as Feat[])?.find((f) => f.card_number === bg.origin_feat || f.id === bg.origin_feat)
    : undefined;
  return (
    <div>
      <div className="forge-block forge-square-block">
        <div className="forge-square-grid">
          {backgrounds.map((b: Background) => (
            <EntitySquareCard
              key={b.id}
              name={b.name}
              imageUrl={b.image_url}
              selected={draft.backgroundId === b.id}
              onClick={() => onSelect(b.id)}
              preview={<BackgroundPreview background={b} disableHover />}
              supportEntity={b}
            />
          ))}
          {backgrounds.length === 0 && <p className="forge-note">Нет предысторий в базе.</p>}
        </div>
      </div>
      {bg && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{bg.name}</div>
          {bg.description && (
            <p className="forge-note forge-desc-text"><FormattedText text={bg.description} emptyText="" /></p>
          )}
          <p className="forge-note">
            Навыки: {(bg.skill_proficiencies || []).map((s: string) => labelOf(SKILLS, s)).join(', ') || '—'}<br />
            Инструмент: {bg.tool_proficiency || '—'}<br />
            Характеристики: {(bg.ability_scores || []).map((a: string) => labelOf(ABILITIES, a)).join(', ') || '—'}
          </p>
          <div className="forge-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Черта происхождения:</span>
            {originFeat ? (
              <ForgeFeatLine feat={originFeat} />
            ) : (
              <span>{bg.origin_feat || '—'}</span>
            )}
          </div>
          {options && (options.option_a || options.option_b) && (
            <div style={{ marginTop: 8 }}>
              <div className="forge-section-h">Стартовое снаряжение</div>
              <BackgroundEquipment options={options} selectable
                selected={draft.equipmentOption} onSelect={(k) => onEquipmentOption(k)} />
            </div>
          )}
          <label className="forge-check">
            <input type="checkbox" checked={!!draft.swapFeat} onChange={(e) => onToggleSwapFeat(e.target.checked)} />
            <span>Сменить черту происхождения</span>
          </label>
        </div>
      )}
    </div>
  );
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

function SpellsSection({ spells, granted, choices, ownerChoices, maxSlotLevel = 0, ruleState, resolved, setResolved }: {
  spells: Spell[]; granted: Spell[]; choices: PendingChoice[];
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

  const toggleChoiceSpell = (choice: PendingChoice, spellId: string) => {
    const value = resolved[choice.id] || [];
    const canonicalValue = value.map(canonicalSpellId);
    if (canonicalValue.includes(spellId)) {
      setResolved(choice.id, value.filter((reference) => canonicalSpellId(reference) !== spellId));
      return;
    }
    const owner = selectedSpellOwners.get(spellId);
    const ownedByPreparedSource = choice.source === 'prepared_spell'
      && owner?.choiceId === choice.preparedSpellSourceChoiceId;
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
    setResolved(choice.id, next);
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
                  nameSuffix={<SupportStatusBadge entity={spell} compact />}
                  detail={spellDetail(spell)}
                  title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                  onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            </div>
          ) : (
            <div className="forge-spell-icon-grid">
              {grantedFiltered.map((spell) => (
                <div key={spell.id} className="forge-spell-icon ready" title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                  onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHovered(null)}>
                  <img src={spell.image_url?.trim() || '/default_image.png'} alt={spell.name}
                    onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                  {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
                  <SupportStatusBadge entity={spell} compact />
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
            <div className={`choice-count ${done ? 'done' : ''}`}>Выбрано {selected.length} из {choice.count}</div>
            <div className="forge-spell-icon-grid">
              {filtered.map((spell) => {
                const isSelected = selected.includes(spell.id);
                const owner = selectedSpellOwners.get(spell.id);
                const disabledReason = unavailable[spell.id];
                const ownedByPreparedSource = choice.source === 'prepared_spell'
                  && owner?.choiceId === choice.preparedSpellSourceChoiceId;
                const ownerBlocks = !!owner && owner.choiceId !== choice.id && !ownedByPreparedSource;
                const disabled = ownerBlocks || (!!disabledReason && !isSelected);
                const title = disabled
                  ? (ownerBlocks ? `Уже выбрано: ${owner?.label}` : disabledReason)
                  : `${spell.name} · ${getSpellLevelLabel(spell.level)}`;
                const hoverHandlers = {
                  onMouseEnter: (e: React.MouseEvent) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); },
                  onMouseMove: (e: React.MouseEvent) => setMouse({ x: e.clientX, y: e.clientY }),
                  onMouseLeave: () => setHovered(null),
                };
                return (
                  <button key={spell.id} type="button"
                    className={`forge-spell-icon ${isSelected ? 'selected' : disabled ? 'disabled' : 'ready'}`}
                    aria-disabled={disabled || undefined}
                    onClick={disabled ? undefined : () => toggleChoiceSpell(choice, spell.id)}
                    {...hoverHandlers} title={title}>
                    <img src={spell.image_url?.trim() || '/default_image.png'} alt={spell.name}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                    {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
                    <SupportStatusBadge entity={spell} compact />
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="forge-note">Нет доступных заклинаний по этому фильтру.</p>}
            </div>
          </div>
        );
      })}
      {hovered && (
        <div className="fixed z-50 pointer-events-none" style={{
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
