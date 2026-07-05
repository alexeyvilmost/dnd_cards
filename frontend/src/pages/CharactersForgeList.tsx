import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, User } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { racesApi, classesApi } from '../api/client';
import type { ForgeCharacter } from '../character/types';
import type { Race, CharacterClass } from '../types';
import './CharacterForge.css';

const CharactersForgeList = () => {
  const [chars, setChars] = useState<ForgeCharacter[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [classes, setClasses] = useState<CharacterClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [list, rr, cc] = await Promise.all([
          charactersV3Api.list(),
          racesApi.getRaces({ limit: 100 }).catch(() => ({ races: [] as Race[] })),
          classesApi.getClasses({ limit: 100 }).catch(() => ({ classes: [] as CharacterClass[] })),
        ]);
        setChars(list);
        setRaces(rr.races || []);
        setClasses(cc.classes || []);
      } catch (e) {
        console.error(e);
        setError('Не удалось загрузить список персонажей');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const raceName = useMemo(() => new Map(races.map((r) => [r.id, r.name])), [races]);
  const className = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const subtitle = (c: ForgeCharacter) => {
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
      setChars((prev) => prev.filter((c) => c.id !== id));
      setConfirmId(null);
    } catch (e) {
      console.error(e);
      setError('Не удалось удалить персонажа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="forge">
      <div className="forge-header sheet-header-bar">
        <Link to="/" className="sheet-back" title="На главную">
          <ArrowLeft size={18} />
        </Link>
        <span>Персонажи</span>
        <Link to="/character-forge" className="sheet-edit" title="Создать">
          <Plus size={18} />
        </Link>
      </div>
      <div className="sheet-scroll">
        {loading && <p className="forge-note">Загрузка…</p>}
        {error && <p className="issues">{error}</p>}
        {!loading && !error && chars.length === 0 && (
          <div className="forge-success">
            <p className="forge-note">Пока нет персонажей.</p>
            <Link to="/character-forge" className="forge-btn">Создать первого</Link>
          </div>
        )}
        <div className="forge-grid" style={{ maxWidth: 900, margin: '0 auto' }}>
          {chars.map((c) => (
            <div key={c.id} className="entity-card forge-char-card">
              <Link to={`/characters-v3/${c.id}`} className="forge-char-card-link">
                <span className="ec-name">{c.name || 'Без имени'}</span>
                <span className="ec-sub">{subtitle(c)}</span>
                <span className="ec-sub">Уровень {c.level} · HP {c.current_hp}/{c.max_hp}</span>
                <span className="ec-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={12} /> Открыть лист
                </span>
              </Link>
              {confirmId === c.id ? (
                <span className="forge-char-card-actions">
                  <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => remove(c.id)}>
                    Удалить?
                  </button>
                  <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={() => setConfirmId(null)}>
                    Отмена
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="forge-char-card-delete"
                  title="Удалить персонажа"
                  onClick={() => setConfirmId(c.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {chars.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to="/character-forge" className="forge-btn ghost">Новый персонаж</Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default CharactersForgeList;
