import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Home, User, Swords, ScrollText, Star, Zap, ListChecks, Sparkles, FileText } from 'lucide-react';
import { racesApi, classesApi, backgroundsApi, featsApi, spellsApi } from '../api/client';
import type { Race, CharacterClass, Background, Feat, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { charactersV3Api } from '../character/api';
import { assemble, loadBundle, type EntityBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, STANDARD_ARRAY, ABILITY_KEYS, ABILITY_LABEL_RU, type CharacterDraft, type AbilityKey } from '../character/types';
import { buildSavePayload, completionIssues, classSkillChoice, characterToDraft } from '../character/forgeHelpers';
import { normalizeSkillId, normalizeSkillList } from '../character/skillNormalize';
import { getSkillGrantSource, grantReason, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState } from '../character/rules/types';
import { ForgeNav, SummaryPanel, EntityChoiceCard, ChoiceResolver, AbilityAssigner, type ForgeSectionDef } from '../character/components';
import EntitySquareCard from '../components/forge/EntitySquareCard';
import SpellPreview from '../components/SpellPreview';
import { collectChosenSpellUuids, indexSpells } from '../engine/spellRefs';
import { isEntityUuid } from '../engine/ids';
import type { PendingChoice } from '../mechanics/collectChoices';
import { labelOf, SKILLS, ABILITIES } from '../mechanics/registries';
import { abilityMod } from '../character/derive';
import './CharacterForge.css';

const EMPTY_BUNDLE: EntityBundle = { race: null, klass: null, background: null, feats: [], effects: [], actions: [], spells: [] };

const CharacterForge = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();

  // Справочники сущностей
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [feats, setFeats] = useState<Feat[]>([]);
  const [spells, setSpells] = useState<Spell[]>([]);

  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft());
  const [bundle, setBundle] = useState<EntityBundle | null>(null);
  const [manualAbilities, setManualAbilities] = useState(false);
  const [active, setActive] = useState('main');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // Загрузка существующего черновика для редактирования
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c = await charactersV3Api.get(editId);
        savedSkillsRef.current = c.skill_proficiencies || [];
        restoredClassSkillsRef.current = false;
        setDraft(characterToDraft(c));
      } catch (e) {
        console.error(e);
        setError('Не удалось загрузить персонажа');
      }
    })();
  }, [editId]);

  // Перезагрузка bundle при смене ссылок (не характеристик/заклинаний)
  const refsKey = `${draft.raceId}|${draft.lineageId}|${draft.classId}|${draft.backgroundId}|${draft.level}|${draft.featIds.join(',')}`;
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
        if (cached) {
          byId.set(cached.id, cached);
          continue;
        }
        try {
          const s = await spellsApi.getSpell(slug);
          if (s?.id) byId.set(s.id, s);
        } catch {
          /* slug не найден */
        }
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

  // Синхронизация lineage_id из subfeature-выбора вида
  const subfeatureChoice = useMemo(
    () => assembled.pendingChoices.find((pc) => pc.origin.kind === 'race' && pc.source === 'subfeature'),
    [assembled.pendingChoices],
  );
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
    if (classSkills.length) {
      setDraft((d) => ({ ...d, classSkillChoices: classSkills }));
    }
    restoredClassSkillsRef.current = true;
  }, [editId, bundle?.klass, draft.classId]);

  // ─── Апдейтеры черновика ───────────────────────────────────────────────────
  const patch = (p: Partial<CharacterDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setResolved = useCallback((choiceId: string, vals: string[]) => {
    setDraft((d) => ({ ...d, resolvedChoices: { ...d.resolvedChoices, [choiceId]: vals } }));
  }, []);
  const setAbility = useCallback((k: AbilityKey, v: number | undefined) => {
    setDraft((d) => {
      const abilities = { ...d.abilities };
      if (v === undefined) delete abilities[k]; else abilities[k] = v;
      return { ...d, abilities };
    });
  }, []);
  const toggleFeat = (fid: string) =>
    patch({ featIds: draft.featIds.includes(fid) ? draft.featIds.filter((x) => x !== fid) : [...draft.featIds, fid] });
  const selectClass = (cid: string) => patch({ classId: cid, classSkillChoices: [] });
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
      const payload = buildSavePayload(draft, assembled, ruleState);
      const res = draft.id
        ? await charactersV3Api.update(draft.id, payload)
        : await charactersV3Api.create(payload);
      setSavedId(res.id);
      setDraft((d) => ({ ...d, id: res.id }));
    } catch (e) {
      console.error(e);
      setError('Ошибка сохранения персонажа');
    } finally {
      setSaving(false);
    }
  };

  // Разделы навигации со статусами
  const raceChoicesRace = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'race' && pc.source !== 'spell');
  const classChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'class' && pc.source !== 'spell');
  const featChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'feat' && pc.source !== 'spell');
  const abilitiesDone = ABILITY_KEYS.every((k) => typeof draft.abilities[k] === 'number');
  const sc = classSkillChoice(assembled);
  const classDone = !!draft.classId && (!sc || draft.classSkillChoices.length >= sc.count)
    && classChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);
  const raceDone = !!draft.raceId && raceChoicesRace.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count);

  const sections: ForgeSectionDef[] = [
    { id: 'main', label: 'Общее', icon: <Home size={20} /> },
    { id: 'race', label: 'Вид', icon: <User size={20} />, sub: assembled.race?.name, status: raceDone ? 'ok' : 'todo' },
    { id: 'class', label: 'Класс', icon: <Swords size={20} />, sub: assembled.klass?.name, status: classDone ? 'ok' : 'todo' },
    { id: 'background', label: 'Предыстория', icon: <ScrollText size={20} />, sub: assembled.background?.name, status: draft.backgroundId ? 'ok' : 'todo' },
    { id: 'feat', label: 'Черта', icon: <Star size={20} />, sub: assembled.feats[0]?.name, status: featChoices.every((pc) => (draft.resolvedChoices[pc.id]?.length ?? 0) >= pc.count) ? 'ok' : 'todo' },
    { id: 'abilities', label: 'Хар-тики', icon: <Zap size={20} />, status: abilitiesDone ? 'ok' : 'todo' },
    { id: 'proficiencies', label: 'Владения', icon: <ListChecks size={20} /> },
    { id: 'spells', label: 'Заклинания', icon: <Sparkles size={20} />, sub: spellChoices.length ? (selectedSpellCount ? `${selectedSpellCount}/${requiredSpellCount}` : undefined) : (grantedSpells.length ? `${grantedSpells.length} получено` : undefined), status: spellChoices.length ? (spellsDone ? 'ok' : 'todo') : (grantedSpells.length ? 'ok' : null) },
  ];

  const sectionTitle = sections.find((s) => s.id === active)?.label ?? 'Основное';

  return (
    <div className="forge">
      <div className="forge-header sheet-header-bar">
        <span>Создание персонажа</span>
        {(savedId || draft.id) && (
          <Link
            to={`/characters-v3/${savedId || draft.id}`}
            className="sheet-edit forge-header-sheet-link"
            title="Открыть лист персонажа"
          >
            <FileText size={16} />
            <span>Лист</span>
          </Link>
        )}
      </div>
      <div className="forge-body">
        <ForgeNav sections={sections} active={active} onSelect={setActive} />
        <div className="forge-main">
          <div className="forge-main-title">{active === 'main' ? 'Основное' : sectionTitle}</div>
          <div className="forge-cols">
            <div className="forge-summary">
              <SummaryPanel draft={draft} assembled={assembled} spells={selectedSpells} />
            </div>
            <div className="forge-editor">
              {active === 'main' && (
                <MainSection
                  draft={draft} patch={patch} issues={issues} canCreate={canCreate}
                  saving={saving} onSave={save} savedId={savedId} error={error}
                  onOpenSheet={() => savedId && navigate(`/characters-v3/${savedId}`)}
                />
              )}
              {active === 'race' && (
                <RaceSection
                  races={races} draft={draft} onSelect={(rid: string) => patch({ raceId: rid, lineageId: null })}
                  choices={raceChoicesRace} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState}
                  race={assembled.race} hasSubfeature={!!subfeatureChoice}
                  onPickLineage={(name: string) => patch({ lineageId: name })} lineageId={draft.lineageId}
                />
              )}
              {active === 'class' && (
                <ClassSection
                  classes={classes} draft={draft} onSelect={selectClass} assembled={assembled}
                  onToggleSkill={toggleClassSkill} choices={classChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState}
                />
              )}
              {active === 'background' && (
                <BackgroundSection backgrounds={backgrounds} draft={draft} onSelect={(bid: string) => patch({ backgroundId: bid })} background={assembled.background} />
              )}
              {active === 'feat' && (
                <FeatSection feats={feats} draft={draft} onToggle={toggleFeat} choices={featChoices} resolved={draft.resolvedChoices} setResolved={setResolved} ruleState={ruleState} />
              )}
              {active === 'abilities' && (
                <AbilityAssigner
                  abilities={draft.abilities} standardArray={STANDARD_ARRAY} manual={manualAbilities}
                  onSet={setAbility} onToggleManual={setManualAbilities}
                />
              )}
              {active === 'proficiencies' && <ProficienciesSection draft={draft} assembled={assembled} ruleState={ruleState} />}
              {active === 'spells' && (
                <SpellsSection
                  spells={spells}
                  granted={grantedSpells}
                  choices={spellChoices}
                  resolved={draft.resolvedChoices}
                  setResolved={setResolved}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Секции ────────────────────────────────────────────────────────────────

function MainSection({ draft, patch, issues, canCreate, saving, onSave, savedId, error, onOpenSheet }: {
  draft: CharacterDraft; patch: (p: Partial<CharacterDraft>) => void; issues: string[]; canCreate: boolean;
  saving: boolean; onSave: () => void; savedId: string | null; error: string | null; onOpenSheet: () => void;
}) {
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Имя персонажа</div>
        <input className="forge-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Фарадей фон Грасс" />
      </div>

      {savedId ? (
        <div className="forge-success">
          <div className="sum-label" style={{ fontSize: 16 }}>Персонаж сохранён ✓</div>
          <p className="forge-note">ID: {savedId}</p>
          <button className="forge-btn" onClick={onOpenSheet}>Открыть лист</button>
        </div>
      ) : (
        <div className="forge-block">
          <div className="forge-section-h">Готовность</div>
          {issues.length === 0 ? (
            <p className="choice-count done">Всё заполнено — можно создавать.</p>
          ) : (
            <ul className="issues">{issues.map((it, i) => <li key={i}>{it}</li>)}</ul>
          )}
          {error && <p className="issues" style={{ color: 'var(--forge-danger)' }}>{error}</p>}
          <button className="forge-btn" disabled={!canCreate || saving} onClick={onSave}>
            {saving ? 'Сохранение…' : draft.id ? 'Сохранить' : 'Создать персонажа'}
          </button>
        </div>
      )}
    </div>
  );
}

function ChoiceList({ choices, resolved, setResolved, ruleState }: {
  choices: PendingChoice[];
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
  ruleState: CharacterRuleState;
}) {
  if (!choices.length) return null;
  return (
    <div className="forge-block">
      <div className="forge-section-h">Выборы</div>
      {choices.map((pc) => {
        const value = resolved[pc.id] || [];
        const unavailableOptions = pc.source === 'skill'
          ? Object.fromEntries(SKILLS.map((skill) => {
            const existing = getSkillGrantSource(ruleState, skill.id);
            const unavailable = !!existing && !value.includes(skill.id);
            return [skill.id, unavailable ? grantReason(existing) : undefined];
          }).filter(([, reason]) => !!reason)) as Record<string, string>
          : undefined;
        return (
          <ChoiceResolver
            key={pc.id}
            choice={pc}
            value={value}
            unavailableOptions={unavailableOptions}
            onChange={(v) => setResolved(pc.id, v)}
          />
        );
      })}
    </div>
  );
}

function RaceSection({ races, draft, onSelect, choices, resolved, setResolved, ruleState, race, hasSubfeature, onPickLineage, lineageId }: any) {
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Вид</div>
        <div className="forge-square-grid">
          {races.map((r: Race) => (
            <EntitySquareCard
              key={r.id}
              name={r.name}
              imageUrl={r.image_url}
              selected={draft.raceId === r.id}
              onClick={() => onSelect(r.id)}
            />
          ))}
          {races.length === 0 && <p className="forge-note">Нет видов в базе.</p>}
        </div>
      </div>

      {race?.lineages?.length > 0 && !hasSubfeature && (
        <div className="forge-block">
          <div className="forge-section-h">Подвид</div>
          <div className="forge-grid">
            {race.lineages.map((l: { name: string; description?: string }) => (
              <EntityChoiceCard key={l.name} name={l.name} subtitle={l.description} selected={lineageId === l.name} onClick={() => onPickLineage(l.name)} />
            ))}
          </div>
        </div>
      )}

      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} />
    </div>
  );
}

function ClassSection({ classes, draft, onSelect, assembled, onToggleSkill, choices, resolved, setResolved, ruleState }: any) {
  const sc = classSkillChoice(assembled);
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Класс</div>
        <div className="forge-grid">
          {classes.map((c: CharacterClass) => (
            <EntityChoiceCard key={c.id} name={c.name} subtitle={c.hit_die ? `Кость хитов ${c.hit_die}` : undefined} selected={draft.classId === c.id} onClick={() => onSelect(c.id)} />
          ))}
          {classes.length === 0 && <p className="forge-note">Нет классов в базе (наполняется в Фазе E).</p>}
        </div>
      </div>

      {sc && (
        <div className="forge-block">
          <div className="forge-section-h">Навыки класса — выберите {sc.count}</div>
          <div className="chips">
            {sc.options.map((skill: string) => {
              const selected = draft.classSkillChoices.includes(skill);
              const existing = getSkillGrantSource(ruleState, skill);
              const disabled = !!existing && !selected;
              const reason = grantReason(existing);
              return (
                <button key={skill} type="button"
                  className={`chip ${selected ? 'on' : ''}`}
                  disabled={disabled}
                  title={disabled ? reason : undefined}
                  onClick={() => onToggleSkill(skill)}>
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

function BackgroundSection({ backgrounds, draft, onSelect, background }: any) {
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Предыстория</div>
        <div className="forge-grid">
          {backgrounds.map((b: Background) => (
            <EntityChoiceCard key={b.id} name={b.name} selected={draft.backgroundId === b.id} onClick={() => onSelect(b.id)} />
          ))}
          {backgrounds.length === 0 && <p className="forge-note">Нет предысторий в базе.</p>}
        </div>
      </div>
      {background && (
        <div className="forge-block">
          <div className="forge-section-h">Даёт</div>
          <p className="forge-note">
            Навыки: {(background.skill_proficiencies || []).map((s: string) => labelOf(SKILLS, s)).join(', ') || '—'}<br />
            Инструмент: {background.tool_proficiency || '—'}<br />
            Характеристики: {(background.ability_scores || []).map((a: string) => labelOf(ABILITIES, a)).join(', ') || '—'}
          </p>
        </div>
      )}
    </div>
  );
}

function FeatSection({ feats, draft, onToggle, choices, resolved, setResolved, ruleState }: any) {
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Черты происхождения</div>
        <div className="forge-grid">
          {feats.map((f: Feat) => (
            <EntityChoiceCard key={f.id} name={f.name}
              subtitle={(f.ability_increase || []).map((a) => labelOf(ABILITIES, a)).join(', ') || undefined}
              selected={draft.featIds.includes(f.id)} onClick={() => onToggle(f.id)} />
          ))}
          {feats.length === 0 && <p className="forge-note">Нет черт происхождения в базе.</p>}
        </div>
      </div>
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} ruleState={ruleState} />
    </div>
  );
}

function ProficienciesSection({ draft, assembled, ruleState }: { draft: CharacterDraft; assembled: AssembledCharacter; ruleState: CharacterRuleState }) {
  const skills = ruleState.proficiencies.skills;
  const saves = ruleState.proficiencies.savingThrows;
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Владения (итог)</div>
        <p className="forge-note">Навыки: {skills.map((s) => labelOf(SKILLS, s)).join(', ') || '—'}</p>
        <p className="forge-note">Спасброски: {saves.map((s) => labelOf(ABILITIES, s)).join(', ') || '—'}</p>
        <p className="forge-note">Инструменты: {ruleState.proficiencies.tools.join(', ') || '—'}</p>
        <p className="forge-note">Языки: {ruleState.proficiencies.languages.join(', ') || '—'}</p>
        {ruleState.conflicts.length > 0 && (
          <ul className="issues">{ruleState.conflicts.map((it, i) => <li key={i}>{it.message}</li>)}</ul>
        )}
      </div>
      <div className="forge-block">
        <div className="forge-section-h">Характеристики</div>
        <div className="sum-abilities">
          {ABILITY_KEYS.map((k) => {
            const v = draft.abilities[k];
            const m = typeof v === 'number' ? abilityMod(v) : null;
            return (
              <div key={k} className="sum-ab">
                <div className="k">{ABILITY_LABEL_RU[k]}</div>
                <div className="v">{typeof v === 'number' ? v : '—'}</div>
                <div className="m">{m === null ? '' : m >= 0 ? `+${m}` : m}</div>
              </div>
            );
          })}
        </div>
      </div>
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

  const levels = Array.isArray(filter.levels)
    ? filter.levels.map(Number)
    : typeof filter.level === 'number'
      ? [filter.level]
      : [];
  if (levels.length && !levels.includes(spell.level)) return false;

  const classes = Array.isArray(filter.classes)
    ? filter.classes.map(String)
    : typeof filter.class === 'string'
      ? [filter.class]
      : [];
  if (classes.length) {
    const spellClasses = spell.classes || [];
    if (!classes.some((klass) => spellClasses.includes(klass))) return false;
  }

  return true;
}

function SpellsSection({ spells, granted, choices, resolved, setResolved }: {
  spells: Spell[];
  granted: Spell[];
  choices: PendingChoice[];
  resolved: Record<string, string[]>;
  setResolved: (id: string, v: string[]) => void;
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
    if (value.includes(spellId)) {
      setResolved(choice.id, value.filter((id) => id !== spellId));
      return;
    }
    const owner = selectedSpellOwners.get(spellId);
    if (owner && owner.choiceId !== choice.id) return;
    const next = value.length >= choice.count ? [...value.slice(1), spellId] : [...value, spellId];
    setResolved(choice.id, next);
  };

  return (
    <div>
      <div className="forge-section-h">Заклинания и заговоры</div>
      <div className="spell-toolbar">
        <input className="forge-input" style={{ maxWidth: 260 }} placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {grantedFiltered.length > 0 && (
        <div className="forge-block">
          <div className="forge-section-h">Получено от вида, класса или черты</div>
          <p className="forge-note">Эти заклинания выдаются автоматически и не требуют выбора.</p>
          <div className="forge-spell-icon-grid">
            {grantedFiltered.map((spell) => (
              <div
                key={spell.id}
                className="forge-spell-icon ready"
                title={`${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHovered(null)}
              >
                <img
                  src={spell.image_url?.trim() || '/default_image.png'}
                  alt={spell.name}
                  onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                />
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
            <div className={`choice-count ${done ? 'done' : ''}`}>
              Выбрано {selected.length} из {choice.count}
            </div>
            <div className="forge-spell-icon-grid">
              {filtered.map((spell) => {
                const isSelected = selected.includes(spell.id);
                const owner = selectedSpellOwners.get(spell.id);
                const disabled = !!owner && owner.choiceId !== choice.id;
                return (
                  <button
                    key={spell.id}
                    type="button"
                    className={`forge-spell-icon ${isSelected ? 'selected' : disabled ? 'disabled' : 'ready'}`}
                    disabled={disabled}
                    onClick={() => toggleChoiceSpell(choice, spell.id)}
                    onMouseEnter={(e) => { setHovered(spell); setMouse({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHovered(null)}
                    title={disabled ? `Уже выбрано: ${owner.label}` : `${spell.name} · ${getSpellLevelLabel(spell.level)}`}
                  >
                    <img
                      src={spell.image_url?.trim() || '/default_image.png'}
                      alt={spell.name}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }}
                    />
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
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: Math.min(mouse.x + 16, window.innerWidth - 360),
            top: Math.min(Math.max(mouse.y - 40, 10), window.innerHeight - 20),
            transform: mouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
          }}
        >
          <SpellPreview spell={hovered} disableHover={true} />
        </div>
      )}
    </div>
  );
}

export default CharacterForge;
