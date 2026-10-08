import { useEffect, useMemo, useState } from 'react';
import { withoutLegacyRunSuffix } from '../character/familiarLabels';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, User, Users } from 'lucide-react';
import { characterV3ErrorMessage, charactersV3Api } from '../character/api';
import { racesApi, classesApi } from '../api/client';
import {
  characterMetadataLabel,
  isCharacterReadOnly,
  type ForgeCharacterPreview,
} from '../character/types';
import type { Race, CharacterClass } from '../types';
import CharacterAccessBadge from '../components/CharacterAccessBadge';
import CharacterTemplateLibrary from '../components/CharacterTemplateLibrary';
import PaperSheetEntry from './PaperSheetEntry';
import {useAuth} from '../contexts/AuthContext';
import './CharactersRoster.css';
import './CharacterForge.css';

const CharactersForgeList = () => {
  const {isAuthenticated} = useAuth();
  const [chars, setChars] = useState<ForgeCharacterPreview[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const tabs = [['standard', 'Стандартные'], ['runs', 'Забеги'], ['paper', 'Бумажные'], ['all', 'Все'], ['templates', 'Шаблоны']] as const;
  const tab = tabs.some(([key]) => key === params.get('tab')) ? params.get('tab')! : 'standard';
  const selectTab = (key: string) => {setConfirmId(null); setError(null); setParams(key === 'standard' ? {} : {tab: key});};
  const visible = chars.filter(c => tab === 'all' || (tab === 'runs' ? c.character_type === 'dungeon_crawl' : c.character_type !== 'dungeon_crawl'));
  const showCharacters = tab !== 'paper' && tab !== 'templates';

  useEffect(() => {
    if (!isAuthenticated) {setLoading(false); return;}
    (async () => {
      try {
        const [list, rr, cc] = await Promise.all([
          charactersV3Api.listPreviews(),
          racesApi.getRaces({ limit: 100, fields: 'list' }).catch(() => ({ races: [] as Race[] })),
          classesApi.getClasses({ limit: 100, fields: 'list' }).catch(() => ({ classes: [] as CharacterClass[] })),
        ]);
        setChars(list);
        setRaces(rr.races || []);
        setClasses(cc.classes || []);
      } catch (e) {
        console.error(e);
        setError(characterV3ErrorMessage(e, 'Не удалось загрузить список персонажей'));
      } finally {
        setLoading(false);
      }
    })();
  }, [isAuthenticated]);

  const raceName = useMemo(() => new Map(races.map((r) => [r.id, r.name])), [races]);
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const subtitle = (c: ForgeCharacterPreview) => {
    const parts = [
      c.race_id ? raceName.get(c.race_id) : null,
      c.class_id ? className.get(c.class_id) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await charactersV3Api.remove(id);
      setChars(await charactersV3Api.listPreviews());
      setConfirmId(null);
    } catch (e) {
      console.error(e);
      setError(characterV3ErrorMessage(e, 'Не удалось удалить персонажа'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="forge characters-roster-page">
      <div className="sheet-scroll">
        <section className="characters-roster-intro" aria-labelledby="characters-roster-heading">
          <Users size={30} strokeWidth={1.3} aria-hidden="true" />
          <span>ВАША КОЛЛЕКЦИЯ ГЕРОЕВ</span>
          <h1 id="characters-roster-heading">Персонажи</h1>
          <p>Создайте нового героя или продолжите приключение с теми, кто уже в пути.</p>
          <div className="characters-roster-actions"><Link to="/character-forge" className="forge-btn"><Plus size={17} />Создать персонажа</Link><button type="button" className="forge-btn ghost" onClick={() => selectTab('templates')}>Создать из шаблона</button><Link to="/combat-lab" className="forge-btn ghost">Тестовый бой</Link></div>
        </section>
        <div className="characters-roster-tabs" role="tablist" aria-label="Категории персонажей">
          {tabs.map(([key, label], index) => <button key={key} id={`roster-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls="roster-panel"
            tabIndex={tab === key ? 0 : -1} className={key === 'templates' ? 'roster-template-tab' : undefined} onClick={() => selectTab(key)}
            onKeyDown={event => {const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null; if(next === null)return; event.preventDefault(); selectTab(tabs[next][0]); document.getElementById(`roster-tab-${tabs[next][0]}`)?.focus();}}>{label}</button>)}
        </div>
        <section id="roster-panel" role="tabpanel" aria-labelledby={`roster-tab-${tab}`}>
        {tab === 'templates' && <CharacterTemplateLibrary />}
        {showCharacters && loading && <p className="forge-note" role="status">Загрузка…</p>}
        {showCharacters && error && <p className="issues" role="alert">{error}</p>}
        {showCharacters && !loading && !error && visible.length === 0 && (
          <div className="forge-success">
            <p className="forge-note">{tab === 'runs' ? 'Персонажей забегов пока нет.' : 'Пока нет персонажей.'}</p>
            <Link to={tab === 'runs' ? '/roguelike' : '/character-forge'} className="forge-btn">{tab === 'runs' ? 'Начать забег' : 'Создать первого'}</Link>
          </div>
        )}
        {showCharacters && <div className="forge-grid characters-roster-grid">
          {visible.map((c) => (
            <div key={c.id} className="entity-card forge-char-card">
              <Link to={`/characters-v3/${c.id}${c.roguelike_run_id ? `?roguelike=${c.roguelike_run_id}` : ''}`} className="forge-char-card-link">
                <span className="forge-char-token" aria-hidden>
                  {c.avatar_url ? <img src={c.avatar_url} alt="" loading="lazy" decoding="async" /> : (c.name || '?').slice(0, 1)}
                </span>
                <span className="ec-name">{(c.character_type === 'dungeon_crawl' ? withoutLegacyRunSuffix(c.name) : c.name) || 'Без имени'}</span>
                <span className="ec-sub">{subtitle(c)}</span>
                <span className="ec-sub">{characterMetadataLabel(c)}</span>
                <CharacterAccessBadge character={c} />
                <span className="ec-sub">Уровень {c.level} · HP {c.current_hp}/{c.max_hp}</span>
                <span className="ec-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> Открыть лист
                </span>
              </Link>
              {!isCharacterReadOnly(c) && (confirmId === c.id ? (
                <span className="forge-char-card-actions">
                  {c.roguelike_run_id && <p className="forge-note">Забег и все его игровые листы будут удалены. Исходные персонажи сохранятся.</p>}
                  <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => remove(c.id)}>
                    {c.roguelike_run_id ? 'Удалить персонажа и забег' : 'Удалить?'}
                  </button>
                  <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => setConfirmId(null)}>
                    Отмена
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="forge-char-card-delete"
                  aria-label="Удалить персонажа"
                  onClick={() => setConfirmId(c.id)}
                >
                  <Trash2 size={14} />
                </button>
              ))}
            </div>
          ))}
        </div>}
        {(tab === 'paper' || tab === 'all') && <PaperSheetEntry embedded />}
        {showCharacters && visible.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to="/character-forge" className="forge-btn ghost">Новый персонаж</Link>
          </div>
        )}
        </section>
      </div>
    </div>
  );
};

export default CharactersForgeList;
