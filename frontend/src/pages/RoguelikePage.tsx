import { useEffect, useState } from 'react';
import { RotateCcw, Trophy } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import {classesApi} from '../api/client';
import {isRunEligible,isRunClass} from '../roguelike/eligibility';
import CharacterTemplateLibrary from '../components/CharacterTemplateLibrary';
import RunPartyCamp from '../components/RunPartyCamp';
import type { ForgeCharacter } from '../character/types';
import { roguelikeApi, type RoguelikeRun } from '../roguelike/api';
import './RoguelikePage.css';
import MerchantSettingsDialog from '../components/MerchantSettingsDialog';
import {merchantSettingsApi} from '../api/entityTags';

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'Операция не выполнена';
}

function RunList() {
  const [manageShop,setManageShop]=useState(false),[shopSettingsOpen,setShopSettingsOpen]=useState(false);
  useEffect(()=>{void merchantSettingsApi.get().then(s=>setManageShop(s.can_manage)).catch(()=>{})},[]);
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RoguelikeRun[]>([]);
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([roguelikeApi.list(), charactersV3Api.list(), classesApi.getClasses({limit: 100, fields: 'list'})])
      .then(([loadedRuns, loadedCharacters, classCatalog]) => {
        if (!active) return;
        setRuns(loadedRuns);
        const classIds = classCatalog.classes.filter(c => isRunClass(c.card_number)).map(c=>c.id);
        const candidates = loadedCharacters.filter(character => isRunEligible(character, classIds));
        setCharacters(candidates);
        setSelected(candidates[0]?[candidates[0].id]:[]);
      })
      .catch((reason) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const create = async () => {
    if (!selected.length) return;
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
        <p>Проведите героев через случайные столкновения, развивайте сборки и наберите 14 000 опыта.</p>
      </section>

      <CharacterTemplateLibrary forRun />
      {manageShop&&<button className="roguelike-secondary" onClick={()=>setShopSettingsOpen(true)}>Настройки магазина забега</button>}
      {shopSettingsOpen&&<MerchantSettingsDialog onClose={()=>setShopSettingsOpen(false)}/>}
      {error && <div className="roguelike-error" role="alert">{error}</div>}
      {loading ? <p>Загружаем забеги…</p> : (
        <div className="roguelike-grid">
          <section className="roguelike-card">
            <h2>Новый забег</h2>
            <p>Выберите от 1 до 6 персонажей 1 уровня: Воин, Варвар или Монах. Для каждого будет создан отдельный игровой лист; исходные персонажи останутся без изменений.</p>
            {characters.length ? (
              <>
                <div className="run-party-selection" role="group" aria-label="Состав группы">
                  {characters.map(character=><label key={character.id}><input type="checkbox" checked={selected.includes(character.id)} disabled={!selected.includes(character.id)&&selected.length>=6}
                    onChange={e=>setSelected(ids=>e.target.checked?[...ids,character.id]:ids.filter(id=>id!==character.id))}/>
                    {character.avatar_url&&<img src={character.avatar_url} alt=""/>}<span>{character.name} · КД {character.armor_class??10}</span></label>)}
                </div>
                <p>Выбрано {selected.length} / 6</p>
                <button type="button" className="roguelike-primary" disabled={busy||!selected.length} onClick={create}>
                  {busy ? 'Создаём…' : `Начать забег · ${selected.length}`}
                </button>
              </>
            ) : (
              <p>Нет подходящего персонажа. <Link to="/character-forge">Создать персонажа</Link></p>
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
      setRun(next);
    }).catch((e: unknown) => active && setError(errorMessage(e)));
    return () => { active = false; };
  }, [id, navigate]);
  const retry = async () => {
    if (!run) return;
    try {
      const next = await roguelikeApi.command(run.id, run.revision, 'retry');
      setRun(next);
    } catch (e) { setError(errorMessage(e)); }
  };
  if(run?.status==='active')return <RunPartyCamp run={run} onUpdated={setRun}/>;
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
