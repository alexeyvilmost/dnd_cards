import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { User, Swords, Shield, ScrollText, Star, Zap, Sparkles, Sun, Moon, FileText } from 'lucide-react';
import { racesApi, classesApi, backgroundsApi, featsApi, spellsApi } from '../api/client';
import type { Race, CharacterClass, Background, Feat, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { charactersV3Api } from '../character/api';
import { buildCharacterContext } from '../character/runtime';
import { buildResourceRuntimePatch } from '../character/resourceInit';
import { assemble, loadBundle, type EntityBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, ABILITY_KEYS, type AbilityBonuses, type CharacterDraft, type AbilityKey } from '../character/types';
import { bonusOf, reapplyBonuses } from '../character/pointBuy';
import { buildSavePayload, completionIssues, classSkillChoice, characterToDraft, resolveLineageName } from '../character/forgeHelpers';
import { normalizeSkillId, normalizeSkillList } from '../character/skillNormalize';
import { getSkillGrantSource, grantReason, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState } from '../character/rules/types';
import { ForgeNav, SummaryPanel, ChoiceResolver, AbilityAssigner, type ForgeSectionDef } from '../character/components';
import EntitySquareCard from '../components/forge/EntitySquareCard';
import ForgeTraitsBlock from '../components/forge/ForgeTraitsBlock';
import ForgeOriginAbilities from '../components/forge/ForgeOriginAbilities';
import RacePreview from '../components/RacePreview';
import ClassPreview from '../components/ClassPreview';
import BackgroundPreview from '../components/BackgroundPreview';
import SpellPreview from '../components/SpellPreview';
import { collectChosenSpellUuids, indexSpells } from '../engine/spellRefs';
import { isEntityUuid } from '../engine/ids';
import type { PendingChoice } from '../mechanics/collectChoices';
import { labelOf, SKILLS, ABILITIES } from '../mechanics/registries';
import { FormattedText } from '../utils/formattedText';
import './CharacterForge.css';

const EMPTY_BUNDLE: EntityBundle = { race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [] };

const CharacterForge = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Справочники сущностей
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);

  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft());
  const [bundle, setBundle] = useState<EntityBundle | null>(null);
  const [active, setActive] = useState('race');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
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

  // Загрузка справочников
  useEffect(() => {
    (async () => {
      try {
        const [rr, cc, bb, ff, ss] = await Promise.all([
          racesApi.getRaces({ limit: 100 }).catch(() => ({ races: [] } as { races: Race[] })),
          classesApi.getClasses({ limit: 100 }).catch(() => ({ classes: [] } as { classes: CharacterClass[] })),
          backgroundsApi.getBackgrounds({ limit: 100 }).catch(() => ({ backgrounds: [] } as { backgrounds: Background[] })),
          featsApi.getFeats({ limit: 200 }).catch(() => ({ feats: [] } as { feats: Feat[] })),
          spellsApi.getSpells({ limit: 500 }).catch(() => ({ spells: [] } as { spells: Spell[] })),
        ]);
        setRaces(rr.races || []);
        setClasses(cc.classes || []);
        setBackgrounds(bb.backgrounds || []);
        setFeats((ff.feats || []).filter((f) => f.category === 'origin'));
        setSpells(ss.spells || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // Переход «редактирование → создание» без размонтирования (те же роуты
  // /character-forge/:id и /character-forge): сбросить черновик, иначе
  // сохранение перезапишет предыдущего персонажа.
  useEffect(() => {
    if (editId) return;
    setDraft(emptyDraft());
    setSavedId(null);
    savedSkillsRef.current = [];
    restoredClassSkillsRef.current = false;
  }, [editId]);

  // Загрузка существующего черновика для редактирования.
  // ?levelup=1 (кнопка «Поднять уровень» на листе) — сразу +1 уровень.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c = await charactersV3Api.get(editId);
        savedSkillsRef.current = c.skill_proficiencies || [];
        restoredClassSkillsRef.current = false;
        const d = characterToDraft(c);
        if (searchParams.get('levelup') === '1') {
          d.level = Math.min(20, (d.level || 1) + 1);
          setSearchParams({}, { replace: true });
        }
        setDraft(d);
      } catch (e) {
        console.error(e);
        setError('Не удалось загрузить персонажа');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Перезагрузка bundle при смене ссылок (не характеристик/заклинаний).
  // resolvedChoices включён, т.к. выбор в choice(source:effect) меняет набор
  // разворачиваемых эффектов-бусин; резолв эффектов кэшируется в реестре.
  const refsKey = `${draft.raceId}|${draft.lineageId}|${draft.classId}|${draft.backgroundId}|${draft.level}|${draft.featIds.join(',')}|${JSON.stringify(draft.resolvedChoices)}`;
  useEffect(() => {
    let stale = false;
    (async () => {
      const b = await loadBundle(draft);
      if (!stale) setBundle(b);
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    () => assemble({ ...(bundle ?? EMPTY_BUNDLE), spells: persistedSpells }, draft),
    [bundle, persistedSpells, draft],
  );
  const ruleState = useMemo(
    () => resolveCharacterRules({ draft, assembled }),
    [draft, assembled],
  );
  const spellChoices = assembled.pendingChoices.filter((pc) => pc.source === 'spell');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subfeatureChoice, draft.resolvedChoices]);

  // Восстановить навыки класса из сохранённого персонажа при редактировании
  useEffect(() => {
    if (!editId || restoredClassSkillsRef.current || !bundle?.klass) return;
    const sc = classSkillChoice(assemble({ ...bundle, spells: [] }, draft));
    if (!sc?.options.length) return;
    const opts = new Set(sc.options.map(normalizeSkillId));
    const classSkills = normalizeSkillList(savedSkillsRef.current).filter((s) => opts.has(s));
    if (classSkills.length) setDraft((d) => ({ ...d, classSkillChoices: classSkills }));
    restoredClassSkillsRef.current = true;
  }, [editId, bundle?.klass, draft.classId]);

  // ─── Апдейтеры черновика ───────────────────────────────────────────────────
  const patch = (p: Partial<CharacterDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setResolved = useCallback((choiceId: string, vals: string[]) => {
    setDraft((d) => ({ ...d, resolvedChoices: { ...d.resolvedChoices, [choiceId]: vals } }));
  }, []);
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
  const toggleFeat = (fid: string) =>
    patch({ featIds: draft.featIds.includes(fid) ? draft.featIds.filter((x) => x !== fid) : [fid] });
  const selectClass = (cid: string) => {
    setDraft((d) => {
      const next = { ...d, classId: cid, classSkillChoices: [] as string[] };
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
  const selectBackground = (bid: string) => {
    setDraft((d) => {
      const next = { ...d, backgroundId: bid };
      // Дефолтные бонусы: +2 первой и +1 второй характеристике предыстории.
      const bg = backgrounds.find((b) => b.id === bid);
      const bgAbilities = (bg?.ability_scores || []) as AbilityKey[];
      const untouched = !Object.values(d.abilityBonuses.assignments).some(Boolean);
      if (untouched && bgAbilities.length >= 2 && d.abilityBonuses.mode === 'two_one') {
        const bonuses: AbilityBonuses = {
          ...d.abilityBonuses,
          assignments: { [bgAbilities[0]]: 2, [bgAbilities[1]]: 1 },
        };
        next.abilityBonuses = bonuses;
        next.abilities = reapplyBonuses(d.abilities, d.abilityBonuses, bonuses);
      }
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

  const issues = completionIssues(draft, assembled);
  const canCreate = issues.length === 0;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const isCreate = !draft.id;
      const payload = buildSavePayload(draft, assembled, ruleState);
      const res = draft.id
        ? await charactersV3Api.update(draft.id, payload)
        : await charactersV3Api.create(payload);
      const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
      const runtimePatch = buildResourceRuntimePatch(res, ctx, assembled, true) ?? {};
      // Стартовое снаряжение и деньги предыстории — только при создании,
      // чтобы не перезаписать инвентарь существующего персонажа.
      if (isCreate) {
        const options = assembled.background?.equipment_options as
          | Record<'option_a' | 'option_b', { items?: Array<{ card_id: string; quantity?: number }>; gold?: number }>
          | null | undefined;
        const opt = options?.[draft.equipmentOption === 'b' ? 'option_b' : 'option_a'];
        if (opt) {
          const items = (opt.items || []).map((it) => ({ card_id: it.card_id, qty: it.quantity ?? 1 }));
          if (items.length) runtimePatch.inventory_items = items;
          if (opt.gold) runtimePatch.currency = { gold: opt.gold };
        }
      }
      if (Object.keys(runtimePatch).length) await charactersV3Api.patchRuntime(res.id, runtimePatch);
      setSavedId(res.id);
      setDraft((d) => ({ ...d, id: res.id }));
    } catch (e) {
      console.error(e);
      setError('Ошибка сохранения персонажа');
    } finally {
      setSaving(false);
    }
  };

  // Выборы по источникам / типам
  const raceChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'race' && pc.source !== 'spell');
  const raceOtherChoices = raceChoices.filter((pc) => pc.source !== 'subfeature');
  const raceSubChoices = raceChoices.filter((pc) => pc.source === 'subfeature');
  const classChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'class' && pc.source !== 'spell');
  const classOtherChoices = classChoices.filter((pc) => pc.source !== 'subfeature');
  const classSubChoices = classChoices.filter((pc) => pc.source === 'subfeature');
  const featChoices = assembled.pendingChoices.filter((pc) => pc.source === 'feat');

  // Подвиды — отдельные виды-сущности с parent_race_id текущего вида
  const subraces = draft.raceId ? races.filter((r) => r.parent_race_id === draft.raceId) : [];
  const selectedRace = draft.raceId ? races.find((r) => r.id === draft.raceId) : undefined;
  const subraceLevel = selectedRace?.subrace_level ?? 1;
  const subraceUnlocked = draft.level >= subraceLevel;

  // Условия появления вкладок
  const hasSubclass = classSubChoices.length > 0;
  const hasSpells = spellChoices.length > 0 || grantedSpells.length > 0;
  const hasFeatTab = !!draft.swapFeat || featChoices.length > 0;

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
  const featDone = featChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);

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

  const act = sections.some((s) => s.id === active) ? active : 'race';
  const sectionTitle = sections.find((s) => s.id === act)?.label ?? 'Вид';
  const rootCls = paper ? 'forge sheet-paper' : 'forge';

  return (
    <div className={rootCls}>
      <div className="forge-header sheet-header-bar forge-header-layout">
        <div className="forge-header-spacer" aria-hidden />
        <span className="forge-header-title">Создание персонажа</span>
        <div className="sheet-header-actions">
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

      <div className="forge-body">
        <ForgeNav sections={sections} active={act} onSelect={setActive} />
        <div className="forge-main">
          <div className="forge-main-title">{sectionTitle}</div>
          <div className="forge-editor">
              {act === 'race' && (
                <RaceSection races={races} draft={draft} onSelect={(rid: string) => patch({ raceId: rid, lineageId: null })}
                  subraces={subraces} subraceUnlocked={subraceUnlocked} subraceLevel={subraceLevel}
                  onPickSubrace={(id: string) => patch({ lineageId: draft.lineageId === id ? null : id })}
                  choices={raceOtherChoices} subChoices={raceSubChoices}
                  resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} />
              )}
              {act === 'class' && (
                <ClassSection classes={classes} draft={draft} onSelect={selectClass} assembled={assembled}
                  onToggleSkill={toggleClassSkill} choices={classOtherChoices} resolved={draft.resolvedChoices}
                  setResolved={setResolved} ruleState={ruleState} />
              )}
              {act === 'subclass' && (
                <SubclassSection choices={classSubChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} klass={assembled.klass} />
              )}
              {act === 'spells' && (
                <SpellsSection spells={spells} granted={grantedSpells} choices={spellChoices} resolved={draft.resolvedChoices} setResolved={setResolved} />
              )}
              {act === 'background' && (
                <BackgroundSection backgrounds={backgrounds} draft={draft} onSelect={selectBackground}
                  background={assembled.background} onToggleSwapFeat={(v: boolean) => patch({ swapFeat: v })}
                  onEquipmentOption={(opt: 'a' | 'b') => patch({ equipmentOption: opt })} />
              )}
              {act === 'feat' && (
                <FeatSection feats={feats} draft={draft} onToggle={toggleFeat} swapFeat={!!draft.swapFeat}
                  choices={featChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} />
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
        </div>

        <div className="forge-summary">
          <OverviewPanel
            draft={draft} patch={patch} assembled={assembled} spells={selectedSpells}
            lineageName={lineageName} subChoices={raceSubChoices} subraces={subraces}
            issues={issues} canCreate={canCreate} saving={saving} onSave={save}
            savedId={savedId} error={error} onOpenSheet={() => savedId && navigate(`/characters-v3/${savedId}`)}
          />
        </div>
      </div>
    </div>
  );
};

// ─── Правая панель обзора (имя + résumé + создание) ──────────────────────────

function OverviewPanel({ draft, patch, assembled, spells, lineageName, subChoices, subraces, issues, canCreate, saving, onSave, savedId, error, onOpenSheet }: {
  draft: CharacterDraft; patch: (p: Partial<CharacterDraft>) => void; assembled: AssembledCharacter; spells: Spell[];
  lineageName?: string; subChoices?: PendingChoice[]; subraces?: Race[];
  issues: string[]; canCreate: boolean; saving: boolean; onSave: () => void; savedId: string | null;
  error: string | null; onOpenSheet: () => void;
}) {
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
      </div>

      <SummaryPanel
        draft={draft}
        assembled={assembled}
        spells={spells}
        lineageName={lineageName ?? resolveLineageName(draft.lineageId, {
          subraces,
          lineages: assembled.race?.lineages,
          subChoices,
        })}
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

function ChoiceList({ choices, resolved, setResolved, ruleState, title = 'Выборы' }: {
  choices: PendingChoice[];
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
  ruleState: CharacterRuleState; title?: string;
}) {
  if (!choices.length) return null;
  return (
    <div className="forge-block">
      <div className="forge-section-h">{title}</div>
      {choices.map((pc) => {
        const value = resolved[pc.id] || [];
        // filter:"proficient" (экспертиза) — логика ОБРАТНАЯ: доступны только
        // навыки, которыми персонаж уже владеет; без владения экспертиза запрещена.
        const isExpertise = pc.filter === 'proficient';
        const unavailableOptions = pc.source === 'skill'
          ? Object.fromEntries(SKILLS.map((skill) => {
            const existing = getSkillGrantSource(ruleState, skill.id);
            const unavailable = isExpertise
              ? !existing && !value.includes(skill.id)
              : !!existing && !value.includes(skill.id);
            const reason = isExpertise
              ? 'Требуется владение навыком'
              : (existing ? grantReason(existing) : undefined);
            return [skill.id, unavailable ? reason : undefined];
          }).filter(([, reason]) => !!reason)) as Record<string, string>
          : undefined;
        return (
          <ChoiceResolver key={pc.id} choice={pc} value={value} unavailableOptions={unavailableOptions} onChange={(v) => setResolved(pc.id, v)} />
        );
      })}
    </div>
  );
}

// ─── Секции ────────────────────────────────────────────────────────────────

function RaceSection({ races, draft, onSelect, subraces, subraceUnlocked, subraceLevel, onPickSubrace, choices, subChoices, resolved, setResolved, ruleState }: any) {
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

      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} />
    </div>
  );
}

function ClassSection({ classes, draft, onSelect, assembled, onToggleSkill, choices, resolved, setResolved, ruleState }: any) {
  const sc = classSkillChoice(assembled);
  const klass = classes.find((c: CharacterClass) => c.id === draft.classId) as CharacterClass | undefined;
  return (
    <div>
      <div className="forge-block forge-square-block">
        <div className="forge-square-grid">
          {classes.map((c: CharacterClass) => (
            <EntitySquareCard
              key={c.id}
              name={c.name}
              imageUrl={c.image_url}
              selected={draft.classId === c.id}
              onClick={() => onSelect(c.id)}
              preview={<ClassPreview characterClass={c} disableHover />}
            />
          ))}
          {classes.length === 0 && <p className="forge-note">Нет классов в базе.</p>}
        </div>
      </div>
      {klass && (
        <div className="forge-block forge-desc-block">
          <div className="forge-entity-name">{klass.name}{klass.hit_die ? ` · кость хитов ${klass.hit_die}` : ''}</div>
          {klass.description && (
            <p className="forge-note"><FormattedText text={klass.description} emptyText="" /></p>
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
                <button key={skill} type="button" className={`chip ${selected ? 'on' : ''}`} disabled={disabled}
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
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} />
    </div>
  );
}

function SubclassSection({ choices, resolved, setResolved, ruleState, klass }: any) {
  if (!klass) return <p className="forge-note">Сначала выберите класс.</p>;
  return (
    <div>
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} title="Выберите подкласс" />
      {choices.length === 0 && <p className="forge-note">Для этого класса подкласс на 1 уровне не выбирается.</p>}
    </div>
  );
}

function BackgroundSection({ backgrounds, draft, onSelect, background, onToggleSwapFeat, onEquipmentOption }: any) {
  const bgFromList = backgrounds.find((b: Background) => b.id === draft.backgroundId) as Background | undefined;
  const bg = background ?? bgFromList;
  const options = bg?.equipment_options as
    | Record<'option_a' | 'option_b', { items?: Array<{ card_id: string; quantity?: number }>; gold?: number }>
    | null | undefined;
  const optLabel = (o?: { items?: unknown[]; gold?: number }) => {
    if (!o) return null;
    const parts: string[] = [];
    if (o.items?.length) parts.push(`${o.items.length} предм.`);
    if (o.gold) parts.push(`${o.gold} зм`);
    return parts.join(' + ') || '—';
  };
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
            Характеристики: {(bg.ability_scores || []).map((a: string) => labelOf(ABILITIES, a)).join(', ') || '—'}<br />
            Черта происхождения: {bg.origin_feat || '—'}
          </p>
          {options && (options.option_a || options.option_b) && (
            <div style={{ marginTop: 8 }}>
              <div className="forge-section-h">Стартовое снаряжение</div>
              <div className="chips">
                {options.option_a && (
                  <button type="button" className={`chip ${draft.equipmentOption === 'a' ? 'on' : ''}`}
                    onClick={() => onEquipmentOption('a')}>
                    Вариант А · {optLabel(options.option_a)}
                  </button>
                )}
                {options.option_b && (
                  <button type="button" className={`chip ${draft.equipmentOption === 'b' ? 'on' : ''}`}
                    onClick={() => onEquipmentOption('b')}>
                    Вариант Б · {optLabel(options.option_b)}
                  </button>
                )}
              </div>
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

function FeatSection({ feats, draft, onToggle, swapFeat, choices, resolved, setResolved, ruleState }: any) {
  return (
    <div>
      {swapFeat && (
        <div className="forge-block forge-square-block">
          <div className="forge-section-h forge-section-h--center">Черта происхождения</div>
          <div className="forge-square-grid">
            {feats.map((f: Feat) => (
              <EntitySquareCard key={f.id} name={f.name} imageUrl={f.image_url} selected={draft.featIds.includes(f.id)} onClick={() => onToggle(f.id)} />
            ))}
            {feats.length === 0 && <p className="forge-note">Нет черт происхождения в базе.</p>}
          </div>
        </div>
      )}
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} title="Выбор черты" />
    </div>
  );
}

function spellMatchesChoice(spell: Spell, choice: PendingChoice): boolean {
  const options = (choice.options || {}) as Record<string, unknown>;
  const filter = (options.filter || choice.filter || {}) as Record<string, unknown> | string | string[];
  if (Array.isArray(filter)) return filter.includes(spell.id);
  if (typeof filter === 'string') {
    if (filter === 'all') return true;
    if (filter === 'cantrip') return spell.level === 0;
    return spell.id === filter;
  }
  const levels = Array.isArray(filter.levels) ? filter.levels.map(Number) : typeof filter.level === 'number' ? [filter.level] : [];
  if (levels.length && !levels.includes(spell.level)) return false;
  const classes = Array.isArray(filter.classes) ? filter.classes.map(String) : typeof filter.class === 'string' ? [filter.class] : [];
  if (classes.length) {
    const spellClasses = spell.classes || [];
    if (!classes.some((klass) => spellClasses.includes(klass))) return false;
  }
  return true;
}

function SpellsSection({ spells, granted, choices, resolved, setResolved }: {
  spells: Spell[]; granted: Spell[]; choices: PendingChoice[];
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<Spell | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const grantedFiltered = useMemo(
    () => granted.filter((spell) => !search || spell.name.toLowerCase().includes(search.toLowerCase())),
    [granted, search],
  );

  const selectedSpellOwners = useMemo(() => {
    const owners = new Map<string, { choiceId: string; label: string }>();
    for (const choice of choices) {
      const origin = [choice.origin.name, choice.origin.featureName].filter(Boolean).join(' · ');
      const label = origin ? `${choice.prompt} (${origin})` : choice.prompt;
      for (const spellId of resolved[choice.id] || []) {
        if (!owners.has(spellId)) owners.set(spellId, { choiceId: choice.id, label });
      }
    }
    return owners;
  }, [choices, resolved]);

  const toggleChoiceSpell = (choice: PendingChoice, spellId: string) => {
    const value = resolved[choice.id] || [];
    if (value.includes(spellId)) { setResolved(choice.id, value.filter((id) => id !== spellId)); return; }
    const owner = selectedSpellOwners.get(spellId);
    if (owner && owner.choiceId !== choice.id) return;
    const next = value.length >= choice.count ? [...value.slice(1), spellId] : [...value, spellId];
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
          <div className="forge-spell-icon-grid">
            {grantedFiltered.map((spell) => (
              <div key={spell.id} className="forge-spell-icon ready" title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHovered(null)}>
                <img src={spell.image_url?.trim() || '/default_image.png'} alt={spell.name}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                {spell.level > 0 && <span className="forge-spell-badge">{spell.level}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {choices.length === 0 && granted.length === 0 && (
        <p className="forge-note">Этот персонаж пока не получил заклинаний из эффектов класса, вида или черт.</p>
      )}
      {choices.map((choice) => {
        const selected = resolved[choice.id] || [];
        const filtered = spells
          .filter((spell) => spellMatchesChoice(spell, choice))
          .filter((spell) => !search || spell.name.toLowerCase().includes(search.toLowerCase()));
        const done = selected.length >= choice.count;
        return (
          <div className="forge-block" key={choice.id}>
            <div className="forge-section-h">{choice.prompt}</div>
            <div className={`choice-count ${done ? 'done' : ''}`}>Выбрано {selected.length} из {choice.count}</div>
            <div className="forge-spell-icon-grid">
              {filtered.map((spell) => {
                const isSelected = selected.includes(spell.id);
                const owner = selectedSpellOwners.get(spell.id);
                const disabled = !!owner && owner.choiceId !== choice.id;
                return (
                  <button key={spell.id} type="button"
                    className={`forge-spell-icon ${isSelected ? 'selected' : disabled ? 'disabled' : 'ready'}`}
                    disabled={disabled} onClick={() => toggleChoiceSpell(choice, spell.id)}
                    onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHovered(null)}
                    title={disabled ? `Уже выбрано: ${owner.label}` : `${spell.name} · ${getSpellLevelLabel(spell.level)}`}>
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
