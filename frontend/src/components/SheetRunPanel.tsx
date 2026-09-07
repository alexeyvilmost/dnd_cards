import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Swords, Trophy, ChevronsUp } from 'lucide-react';
import { roguelikeApi, type RoguelikeRun } from '../roguelike/api';
import { RUN_UPDATED_EVENT, runCombatURL } from '../roguelike/navigation';

export default function SheetRunPanel({ runId, characterId }: { runId: string; characterId: string }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<RoguelikeRun | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const reload = () => { void roguelikeApi.get(runId).then((next) => {
      if (next.character_id !== characterId) throw new Error('Забег принадлежит другому персонажу');
      if (active) setRun(next);
    }).catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'Не удалось загрузить забег')); };
    reload();
    window.addEventListener(RUN_UPDATED_EVENT, reload);
    return () => { active = false; window.removeEventListener(RUN_UPDATED_EVENT, reload); };
  }, [runId, characterId]);
  const act = async (type: 'start_encounter' | 'victory') => {
    if (!run || busy) return;
    setBusy(true); setError('');
    try {
      const fresh = await roguelikeApi.get(runId);
      const next = await roguelikeApi.command(runId, fresh.revision, type);
      navigate(type === 'victory' ? `/roguelike/${runId}` : runCombatURL(next));
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { setBusy(false); }
  };
  const level = run?.character?.level ?? 1;
  const threshold = [0, 300, 900, 2700, 6500, 14000][level] ?? 14000;
  return <section className="sheet-panel" aria-label="Забег">
    <h2 className="sheet-h2">Забег {run ? `· попытка ${run.attempt}` : ''}</h2>
    {error && <p className="issues" role="alert">{error}</p>}
    {run && <>
      <p className="forge-note">{run.experience} / {threshold} XP · {run.encounters_won} побед · {run.gold} зм · {run.supplies} припасов · {run.game_clock_hours} ч.</p>
      <progress aria-label="Опыт забега" value={run.experience} max={threshold} style={{ width: '100%' }} />
      <div className="sheet-header-actions">
        {run.status !== 'active' ? <Link className="sheet-header-btn" to={`/roguelike/${run.id}`}>Результат забега</Link>
          : run.phase === 'combat' ? <Link className="sheet-header-btn" to={runCombatURL(run)}><Swords size={16} />Вернуться в бой</Link>
          : <>
            {level === 5 && run.experience >= 14000
              ? <button className="sheet-header-btn" disabled={busy} onClick={() => void act('victory')}><Trophy size={16} />Победа!</button>
              : run.pending_level || run.experience >= threshold
                ? <Link className="sheet-header-btn" to={`/character-forge/${characterId}?levelup=1&roguelike=${run.id}`}><ChevronsUp size={16} />{run.pending_level ? 'Продолжить повышение' : `Уровень ${level + 1}`}</Link>
                : <button className="sheet-header-btn" disabled={busy} onClick={() => void act('start_encounter')}><Swords size={16} />Следующее столкновение</button>}
            <Link className="sheet-header-btn" to={`/shop/roguelike?roguelike=${run.id}&character=${characterId}`}><ShoppingCart size={16} />Магазин</Link>
          </>}
        <Link className="sheet-header-btn" to="/roguelike">Все забеги</Link>
      </div>
    </>}
  </section>;
}
