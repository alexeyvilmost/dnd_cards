import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import MonsterPreview from '../components/MonsterPreview';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import './MonsterLibrary.css';

export default function MonsterLibrary() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    monstersApi.list({ search: search || undefined, limit: 100 })
      .then((response) => { if (active) setMonsters(response.monsters); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить бестиарий'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  return (
    <section className="monster-library">
      <header className="monster-library__header">
        <div><p className="monster-eyebrow">DATA-DRIVEN БЕСТИАРИЙ</p><h1>Монстры</h1></div>
        <Link className="monster-primary" to="/monster-forge"><Plus size={17} /> Создать монстра</Link>
      </header>
      <label className="monster-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию или slug" /></label>
      {loading && <p>Загрузка бестиария…</p>}
      {error && <p className="monster-error" role="alert">{error}</p>}
      {!loading && !error && !monsters.length && <p>Монстры не найдены.</p>}
      <div className="monster-library__grid">{monsters.map((monster) => <MonsterPreview key={monster.id} monster={monster} />)}</div>
    </section>
  );
}
