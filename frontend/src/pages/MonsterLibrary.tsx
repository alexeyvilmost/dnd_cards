import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LibraryTagControl from '../components/library/LibraryTagControl';
import { Plus } from 'lucide-react';
import LibrarySidebar from '../components/library/LibrarySidebar';
import LibrarySearch from '../components/library/LibrarySearch';
import LibrarySectionHero from '../components/library/LibrarySectionHero';
import MonsterPreview from '../components/MonsterPreview';
import LibraryQuickDetail from '../components/library/LibraryQuickDetail';
import { monstersApi } from '../monsters/api';
import type { Monster } from '../monsters/types';
import './MonsterLibrary.css';
import { useContentPermissions } from '../hooks/useContentPermissions';

export default function MonsterLibrary() {
  const { admin, canEdit } = useContentPermissions();
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') ?? '';
  const search = params.get('q') ?? '';
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Monster | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    monstersApi.list({ search: search || undefined, limit: 100,tag:tag||undefined })
      .then((response) => { if (active) setMonsters(response.monsters); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить бестиарий'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search,tag]);

  return (
    <section className="monster-library library-shell">
      <LibrarySidebar active="monsters" />
      <div className="library-shell__content">
      <LibrarySectionHero type="monsters" subtitle="Бестиарий" action={admin &&
        <Link className="library-chrome-button library-chrome-button--primary" to="/monster-forge"><Plus size={17} /> Создать монстра</Link>
      } />
      <div className="library-chrome-panel monster-library__controls">
        <LibrarySearch value={search} onSearch={value => setParams(previous => {
          const next = new URLSearchParams(previous);
          if (value) next.set('q', value); else next.delete('q');
          return next;
        })} />
        <LibraryTagControl value={tag} onChange={value=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('tag',value);else next.delete('tag');return next})}/>
      </div>
      {loading && <p className="library-chrome-status" role="status">Загрузка бестиария…</p>}
      {error && <p className="monster-error" role="alert">{error}</p>}
      {!loading && !error && !monsters.length && <p className="library-chrome-status">Монстры не найдены.</p>}
      <div className="monster-library__grid">{monsters.map((monster) => <MonsterPreview key={monster.id} monster={monster} onOpen={canEdit(monster) ? () => setSelected(monster) : undefined} />)}</div>
      {selected && <LibraryQuickDetail name={selected.name} pageTo={`/entity/monsters/${selected.id}`} editTo={`/monster-forge/${selected.id}`} onClose={() => setSelected(null)}><MonsterPreview monster={selected} staticCard /></LibraryQuickDetail>}
      </div>
    </section>
  );
}
