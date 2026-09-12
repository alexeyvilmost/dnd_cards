import { useEffect, useState } from 'react';
import { RotateCcw, Trophy } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import { roguelikeApi, type RoguelikeRun } from '../roguelike/api';
import { runSheetURL } from '../roguelike/navigation';
import './RoguelikePage.css';

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'Операция не выполнена';
}

function RunList() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RoguelikeRun[]>([]);
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([roguelikeApi.list(), charactersV3Api.list()])
      .then(([loadedRuns, loadedCharacters]) => {
        if (!active) return;
        setRuns(loadedRuns);
        const candidates = loadedCharacters.filter((character) => (
          character.level === 1 && character.character_type !== 'dungeon_crawl'
        ));
        setCharacters(candidates);
        setSelected(candidates[0]?.id ?? '');
      })
      .catch((reason) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const run = await roguelikeApi.create(selected);
      navigate(`/roguelike/${run.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <main className="roguelike-shell">
      <section className="roguelike-hero">
        <p className="roguelike-kicker">РЕЖИМ ЗАБЕГА</p>
        <h1>Дорога до шестого уровня</h1>
        <p>Проведите воина через случайные столкновения, развивайте сборку и наберите 14 000 опыта.</p>
      </section>

      {error && <div className="roguelike-error" role="alert">{error}</div>}
      {loading ? <p>Загружаем забеги…</p> : (
        <div className="roguelike-grid">
          <section className="roguelike-card">
            <h2>Новый забег</h2>
            <p>Нужен готовый воин 1 уровня. Будет создан отдельный игровой лист.</p>
            {characters.length ? (
              <>
                <label className="roguelike-field">
                  <span>Персонаж</span>
                  <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>{character.name} · КЗ {character.armor_class ?? 10}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="roguelike-primary" disabled={busy} onClick={create}>
                  {busy ? 'Создаём…' : 'Начать забег'}
                </button>
              </>
            ) : (
              <p>Нет подходящего персонажа. <Link to="/character-forge">Создать воина</Link></p>
            )}
          </section>

          <section className="roguelike-card roguelike-runs">
            <h2>Ваши забеги</h2>
            {runs.length === 0 ? <p>Здесь появится история прохождений.</p> : runs.map((run) => (
              <Link className="roguelike-run-row" to={`/roguelike/${run.id}`} key={run.id}>
                <strong>{run.character?.name ?? 'Воин'}</strong>
                <span>{run.experience} XP · {run.encounters_won} побед · попытка {run.attempt}</span>
                <em>{run.status === 'victory' ? 'Победа' : run.status === 'defeat' ? 'Поражение' : 'В пути'}</em>
              </Link>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function RunCamp({ id }: { id: string }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<RoguelikeRun | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void roguelikeApi.get(id).then((next) => {
      if (!active) return;
      if (next.status === 'active') navigate(runSheetURL(next), { replace: true });
      else setRun(next);
    }).catch((e: unknown) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [id, navigate]);
  const retry = async () => {
    if (!run) return;
    try {
      const next = await roguelikeApi.command(run.id, run.revision, 'retry');
      navigate(runSheetURL(next), { replace: true });
    } catch (e) { setError(errorMessage(e)); }
  };
  const title = run?.status === 'victory'
    ? 'Победа!'
    : run?.status === 'defeat'
      ? 'Поражение'
      : run
        ? 'Забег завершён'
        : 'Открываем лист…';

  return <main className="roguelike-shell">
    <section className="roguelike-hero roguelike-ending">
      {run?.status === 'victory' && <Trophy size={54} aria-hidden="true" />}
      {run?.status === 'defeat' && <RotateCcw size={48} aria-hidden="true" />}
      <p className="roguelike-kicker">ЗАБЕГ ЗАВЕРШЁН</p>
      <h1>{title}</h1>
      {error && <p className="roguelike-error" role="alert">{error}</p>}
      {run && <>
        <p className="roguelike-ending-character">{run.character?.name ?? 'Воин'}</p>
        <div className="roguelike-ending-stats" aria-label="Результат забега">
          <span><strong>{run.experience.toLocaleString('ru-RU')}</strong><small>опыта</small></span>
          <span><strong>{run.encounters_won}</strong><small>побед</small></span>
          <span><strong>{run.attempt}</strong><small>попытка</small></span>
        </div>
      </>}
      <div className="roguelike-ending-actions">
        {run?.status === 'defeat' && <button type="button" className="roguelike-primary" onClick={() => void retry()}>
          <RotateCcw size={17} aria-hidden="true" /> Повторить с контрольной точки
        </button>}
        <Link className="roguelike-secondary" to="/roguelike">Все забеги</Link>
      </div>
    </section>
  </main>;
}

export default function RoguelikePage() {
  const { id } = useParams<{ id: string }>();
  return id ? <RunCamp id={id} /> : <RunList />;
}
