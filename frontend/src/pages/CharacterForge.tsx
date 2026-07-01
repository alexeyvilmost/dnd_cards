import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Home, User, Swords, ScrollText, Star, Zap, ListChecks, Sparkles } from 'lucide-react';
import { racesApi, classesApi, backgroundsApi, featsApi, spellsApi } from '../api/client';
import type { Race, CharacterClass, Background, Feat, Spell } from '../types';
import { getSpellLevelLabel } from '../types';
import { charactersV3Api } from '../character/api';
import { assemble, loadBundle, type EntityBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, STANDARD_ARRAY, ABILITY_KEYS, ABILITY_LABEL_RU, type CharacterDraft, type AbilityKey } from '../character/types';
import { buildSavePayload, completionIssues, classSkillChoice } from '../character/forgeHelpers';
import { normalizeSkillId, normalizeSkillList } from '../character/skillNormalize';
import { ForgeNav, SummaryPanel, EntityChoiceCard, ChoiceResolver, AbilityAssigner, type ForgeSectionDef } from '../character/components';
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
        setDraft({
          id: c.id,
          name: c.name,
          avatarUrl: c.avatar_url,
          raceId: c.race_id ?? null,
          lineageId: c.lineage_id ?? null,
          classId: c.class_id ?? null,
          backgroundId: c.background_id ?? null,
          level: c.level || 1,
          featIds: c.feat_ids || [],
          spellIds: c.spell_ids || [],
          abilities: (c.abilities as Partial<Record<AbilityKey, number>>) || {},
          classSkillChoices: [],
          resolvedChoices: c.resolved_choices || {},
        });
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

  const selectedSpells = useMemo(
    () => spells.filter((s) => draft.spellIds.includes(s.id)),
    [spells, draft.spellIds],
  );

  const assembled: AssembledCharacter = useMemo(
    () => assemble({ ...(bundle ?? EMPTY_BUNDLE), spells: selectedSpells }, draft),
    [bundle, selectedSpells, draft],
  );

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
  const toggleSpell = (sid: string) =>
    patch({ spellIds: draft.spellIds.includes(sid) ? draft.spellIds.filter((x) => x !== sid) : [...draft.spellIds, sid] });
  const selectClass = (cid: string) => patch({ classId: cid, classSkillChoices: [] });
  const toggleClassSkill = (skill: string) => {
    const sc = classSkillChoice(assembled);
    const has = draft.classSkillChoices.includes(skill);
    if (has) { patch({ classSkillChoices: draft.classSkillChoices.filter((x) => x !== skill) }); return; }
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
      const payload = buildSavePayload(draft, assembled);
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
  const raceChoicesRace = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'race');
  const classChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'class');
  const featChoices = assembled.pendingChoices.filter((pc) => pc.origin.kind === 'feat');
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
    { id: 'spells', label: 'Заклинания', icon: <Sparkles size={20} />, sub: draft.spellIds.length ? String(draft.spellIds.length) : undefined },
  ];

  const sectionTitle = sections.find((s) => s.id === active)?.label ?? 'Основное';

  return (
    <div className="forge">
      <div className="forge-header">Создание персонажа</div>
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
                  choices={raceChoicesRace} resolved={draft.resolvedChoices} setResolved={setResolved}
                  race={assembled.race} hasSubfeature={!!subfeatureChoice}
                  onPickLineage={(name: string) => patch({ lineageId: name })} lineageId={draft.lineageId}
                />
              )}
              {active === 'class' && (
                <ClassSection
                  classes={classes} draft={draft} onSelect={selectClass} assembled={assembled}
                  onToggleSkill={toggleClassSkill} choices={classChoices} resolved={draft.resolvedChoices} setResolved={setResolved}
                />
              )}
              {active === 'background' && (
                <BackgroundSection backgrounds={backgrounds} draft={draft} onSelect={(bid: string) => patch({ backgroundId: bid })} background={assembled.background} />
              )}
              {active === 'feat' && (
                <FeatSection feats={feats} draft={draft} onToggle={toggleFeat} choices={featChoices} resolved={draft.resolvedChoices} setResolved={setResolved} />
              )}
              {active === 'abilities' && (
                <AbilityAssigner
                  abilities={draft.abilities} standardArray={STANDARD_ARRAY} manual={manualAbilities}
                  onSet={setAbility} onToggleManual={setManualAbilities}
                />
              )}
              {active === 'proficiencies' && <ProficienciesSection draft={draft} assembled={assembled} />}
              {active === 'spells' && (
                <SpellsSection spells={spells} selected={draft.spellIds} onToggle={toggleSpell} />
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

function ChoiceList({ choices, resolved, setResolved }: {
  choices: PendingChoice[];
  resolved: Record<string, string[]>; setResolved: (id: string, v: string[]) => void;
}) {
  if (!choices.length) return null;
  return (
    <div className="forge-block">
      <div className="forge-section-h">Выборы</div>
      {choices.map((pc) => (
        <ChoiceResolver key={pc.id} choice={pc} value={resolved[pc.id] || []} onChange={(v) => setResolved(pc.id, v)} />
      ))}
    </div>
  );
}

function RaceSection({ races, draft, onSelect, choices, resolved, setResolved, race, hasSubfeature, onPickLineage, lineageId }: any) {
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Вид</div>
        <div className="forge-grid">
          {races.map((r: Race) => (
            <EntityChoiceCard key={r.id} name={r.name} subtitle={r.size || undefined} selected={draft.raceId === r.id} onClick={() => onSelect(r.id)} />
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

      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} />
    </div>
  );
}

function ClassSection({ classes, draft, onSelect, assembled, onToggleSkill, choices, resolved, setResolved }: any) {
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
            {sc.options.map((skill: string) => (
              <button key={skill} type="button"
                className={`chip ${draft.classSkillChoices.includes(skill) ? 'on' : ''}`}
                onClick={() => onToggleSkill(skill)}>
                {labelOf(SKILLS, skill)}
              </button>
            ))}
          </div>
          <div className={`choice-count ${draft.classSkillChoices.length >= sc.count ? 'done' : ''}`}>
            Выбрано {draft.classSkillChoices.length} из {sc.count}
          </div>
        </div>
      )}

      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} />
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

function FeatSection({ feats, draft, onToggle, choices, resolved, setResolved }: any) {
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
      <ChoiceList choices={choices} resolved={resolved} setResolved={setResolved} />
    </div>
  );
}

function ProficienciesSection({ draft, assembled }: { draft: CharacterDraft; assembled: AssembledCharacter }) {
  const skills = [...new Set([...draft.classSkillChoices, ...(assembled.background?.skill_proficiencies || [])])];
  const saves = assembled.klass?.saving_throws || [];
  return (
    <div>
      <div className="forge-block">
        <div className="forge-section-h">Владения (итог)</div>
        <p className="forge-note">Навыки: {skills.map((s) => labelOf(SKILLS, s)).join(', ') || '—'}</p>
        <p className="forge-note">Спасброски: {saves.map((s) => labelOf(ABILITIES, s)).join(', ') || '—'}</p>
        <p className="forge-note">Инструмент: {assembled.background?.tool_proficiency || '—'}</p>
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

function SpellsSection({ spells, selected, onToggle }: { spells: Spell[]; selected: string[]; onToggle: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<number | 'all'>('all');
  const filtered = spells.filter((s) => {
    if (level !== 'all' && s.level !== level) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const levels = [...new Set(spells.map((s) => s.level))].sort((a, b) => a - b);
  return (
    <div>
      <div className="forge-section-h">Заклинания и заговоры {selected.length ? `(выбрано ${selected.length})` : ''}</div>
      <div className="spell-toolbar">
        <input className="forge-input" style={{ maxWidth: 220 }} placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="forge-select" value={String(level)} onChange={(e) => setLevel(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Все уровни</option>
          {levels.map((l) => <option key={l} value={l}>{getSpellLevelLabel(l)}</option>)}
        </select>
      </div>
      <div className="spell-list">
        {filtered.map((s) => (
          <button key={s.id} type="button" className={`spell-item ${selected.includes(s.id) ? 'on' : ''}`} onClick={() => onToggle(s.id)}>
            <span>{s.name}</span>
            <span className="lvl">{getSpellLevelLabel(s.level)}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="forge-note">Ничего не найдено.</p>}
      </div>
    </div>
  );
}

export default CharacterForge;
