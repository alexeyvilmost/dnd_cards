import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, User } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import './CharacterForge.css';

const CharactersForgeList = () => {
  const [chars, setChars] = useState<ForgeCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setChars(await charactersV3Api.list());
      } catch (e) {
        console.error(e);
        setError('Не удалось загрузить список персонажей');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="forge">
      <div className="forge-header sheet-header-bar">
        <span>Персонажи (Forge)</span>
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
            <Link key={c.id} to={`/characters-v3/${c.id}`} className="entity-card" style={{ textDecoration: 'none' }}>
              <span className="ec-name">{c.name || 'Без имени'}</span>
              <span className="ec-sub">Уровень {c.level} · HP {c.current_hp}/{c.max_hp}</span>
              <span className="ec-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <User size={12} /> Открыть лист
              </span>
            </Link>
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
