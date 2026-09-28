import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';
import { loadCatalogPages } from '../api/catalogPages';
import { useSiteSettings } from '../settings';
import { LibraryReviewStatusFilter, LibraryReviewStatusSummary, filterReviewStatuses, parseReviewStatuses } from '../components/library/LibraryReviewStatus';
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
  const { showReviewStatus } = useSiteSettings();
  const statuses = parseReviewStatuses(params.getAll('status').join(','));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      const change = (event as CustomEvent<ReviewStatusChange>).detail;
      if (change?.entity_type === 'monster') {
        const patch = (row: Monster) => row.id === change.entity_id ? { ...row, support: change.support } : row;
        setMonsters(rows => rows.map(patch));
        setSelected(row => row ? patch(row) : row);
      }
      setRevision(value => value + 1);
    };
    window.addEventListener(REVIEW_STATUS_CHANGED, refresh);
    return () => window.removeEventListener(REVIEW_STATUS_CHANGED, refresh);
  }, []);
  const search = params.get('q') ?? '';
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Monster | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadCatalogPages((page: number) => monstersApi.list({ search: search || undefined, limit: 100, tag: tag || undefined, ...(page > 1 ? { page } : {}) }), 'monsters', true, () => active)
      .then((response) => { if (active) setMonsters(response.monsters); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить бестиарий'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search,tag,revision]);
  const visibleMonsters = filterReviewStatuses(monsters, showReviewStatus ? statuses : []);

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
        {showReviewStatus && <LibraryReviewStatusFilter value={statuses} onChange={value => setParams(previous => { const next = new URLSearchParams(previous); if (value.length) next.set('status', value.join(',')); else next.delete('status'); return next; })} />}
      </div>
      {showReviewStatus && !error && <LibraryReviewStatusSummary entities={monsters} loading={loading} />}
      {loading && <p className="library-chrome-status" role="status">Загрузка бестиария…</p>}
      {error && <p className="monster-error" role="alert">{error}</p>}
      {!loading && !error && !visibleMonsters.length && <p className="library-chrome-status">Монстры не найдены.</p>}
      <div className="monster-library__grid">{visibleMonsters.map((monster) => <MonsterPreview key={monster.id} monster={monster} onOpen={canEdit(monster) ? () => setSelected(monster) : undefined} />)}</div>
      {selected && <LibraryQuickDetail entity={{ ...selected, type: 'monster' }} name={selected.name} pageTo={`/entity/monsters/${selected.id}`} editTo={`/monster-forge/${selected.id}`} onClose={() => setSelected(null)}><MonsterPreview monster={selected} staticCard /></LibraryQuickDetail>}
      </div>
    </section>
  );
}
