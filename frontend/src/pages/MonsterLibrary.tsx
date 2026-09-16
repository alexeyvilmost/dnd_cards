import { useEffect, useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import LibraryTagFilter from '../components/LibraryTagFilter';
import { Plus, Search } from 'lucide-react';
import MonsterPreview from '../components/MonsterPreview';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import './MonsterLibrary.css';

export default function MonsterLibrary() {
  const [params,setParams]=useSearchParams();const tag=params.get('tag')??'';
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    monstersApi.list({ search: search || undefined, limit: 100,tag:tag||undefined })
      .then((response) => { if (active) setMonsters(response.monsters); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить бестиарий'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search,tag]);

  return (
    <section className="monster-library">
      <header className="monster-library__header">
        <div><p className="monster-eyebrow">DATA-DRIVEN БЕСТИАРИЙ</p><h1>Монстры</h1></div>
        <Link className="monster-primary" to="/monster-forge"><Plus size={17} /> Создать монстра</Link>
      </header>
      <label className="monster-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию или slug" /></label>
      {loading && <p>Загрузка бестиария…</p>}
      <LibraryTagFilter value={tag} onChange={value=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('tag',value);else next.delete('tag');return next})}/>
      {error && <p className="monster-error" role="alert">{error}</p>}
      {!loading && !error && !monsters.length && <p>Монстры не найдены.</p>}
      <div className="monster-library__grid">{monsters.map((monster) => <MonsterPreview key={monster.id} monster={monster} />)}</div>
    </section>
  );
}
