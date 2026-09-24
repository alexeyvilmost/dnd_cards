import { useEffect, useRef, useState } from 'react';
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
import RunCharacterIdentity from '../components/RunCharacterIdentity';
import {runCharacters} from '../roguelike/navigation';
import {characterTemplatesApi, type CharacterTemplate} from '../character/templatesApi';
import HoverCard from '../components/HoverCard';
import {useCombatDialogFocus} from '../components/useCombatDialogFocus';

const RUN_SELECTION_HELP = 'Выберите от 1 до 6 персонажей 1 уровня: Воин, Варвар или Монах. Можно сочетать пресеты и своих персонажей. Для каждого будет создан отдельный игровой лист; исходные персонажи останутся без изменений.';

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
  const [presets, setPresets] = useState<CharacterTemplate[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState(false);
  const copies = useRef(new Map<string, string>());
  const dialogRef = useCombatDialogFocus(naming);
  const count = selected.length + presets.length;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([roguelikeApi.listSelection(), charactersV3Api.list(), classesApi.getClasses({limit: 100, fields: 'list'})])
      .then(([selection, loadedCharacters, classCatalog]) => {
        if (!active) return;
        setRuns(selection.runs);
        const occupied = new Set(selection.unavailable_source_character_ids);
        for (const run of selection.runs.filter(run => run.status === 'active')) {
          occupied.add(run.source_character_id);
          for (const member of run.party?.members ?? []) occupied.add(member.source_character_id);
        }
        const classIds = classCatalog.classes.filter(c => isRunClass(c.card_number)).map(c=>c.id);
        const candidates = loadedCharacters.filter(character => isRunEligible(character, classIds) && !occupied.has(character.id));
        setCharacters(candidates);
      })
      .catch((reason) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const create = async () => {
    if (!count || count > 6 || busy || presets.some(preset => !names[preset.id]?.trim())) return;
    setBusy(true);
    setError(null);
    try {
      const sources = [...selected];
      for (const preset of presets) {
        const name = names[preset.id].trim();
        const key = `${preset.id}:${name}`;
        let sourceId = copies.current.get(key);
        if (!sourceId) {
          sourceId = (await characterTemplatesApi.copy(preset.id, name)).id;
          copies.current.set(key, sourceId);
        }
        sources.push(sourceId);
      }
      const run = await roguelikeApi.create(sources);
      navigate(`/roguelike/${run.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <main className="roguelike-shell roguelike-start">
      <section className="roguelike-hero">
        <p className="roguelike-kicker">РЕЖИМ ЗАБЕГА</p>
        <h1>Дорога до шестого уровня</h1>
        <p>Проведите героев через случайные столкновения, развивайте сборки и наберите 14 000 опыта.</p>
      </section>

      {shopSettingsOpen&&<MerchantSettingsDialog onClose={()=>setShopSettingsOpen(false)}/>}
      {error && <div className="roguelike-error" role="alert">{error}</div>}
      {loading ? <p>Загружаем забеги…</p> : (
        <div className="roguelike-grid roguelike-start-columns">
          <section className="roguelike-card">
            <div className="run-start-heading"><h2>Начать новый забег</h2>
              <HoverCard content={<div className="run-selection-help" role="tooltip">{RUN_SELECTION_HELP}</div>}>
                <button type="button" className="run-help-button" aria-label="Как собрать группу" aria-description={RUN_SELECTION_HELP}>?</button>
              </HoverCard>
            </div>
            <CharacterTemplateLibrary forRun runSelection={{selectedIds: presets.map(preset => preset.id), full: count >= 6, busy,
              onToggle: preset => {setPresets(rows => rows.some(row => row.id === preset.id) ? rows.filter(row => row.id !== preset.id) : [...rows, preset]);
                setNames(current => ({...current, [preset.id]: current[preset.id] ?? preset.name}));}}} />
            <div className="run-selection-divider"><h3>Ваши персонажи</h3></div>
            {characters.length ? (
              <>
                <div className="run-party-selection" role="group" aria-label="Состав группы">
                  {characters.map(character=><label key={character.id}><input type="checkbox" checked={selected.includes(character.id)} disabled={busy || (!selected.includes(character.id)&&count>=6)}
                    onChange={e=>setSelected(ids=>e.target.checked?[...ids,character.id]:ids.filter(id=>id!==character.id))}/>
                    <RunCharacterIdentity character={character} /></label>)}
                </div>
              </>
            ) : (
              <p>Нет свободных подходящих персонажей. Выберите пресеты выше или <Link to="/character-forge">создайте персонажа</Link>.</p>
            )}
            <div className="run-start-footer"><span>Выбрано {count} / 6</span>
              <button type="button" className="roguelike-primary" disabled={busy || !count} onClick={() => presets.length ? setNaming(true) : void create()}>
                {busy ? 'Создаём…' : `Начать забег · ${count}`}
              </button>
            </div>
          </section>

          <section className="roguelike-card roguelike-runs">
            <h2>Продолжить забег</h2>
            {runs.length === 0 ? <p>Здесь появятся ваши забеги.</p> : runs.map((run) => {
              const members = runCharacters(run);
              return (
              <Link className="roguelike-run-row" to={`/roguelike/${run.id}`} key={run.id}>
                <div className="run-row-heading"><strong>{members.length > 1 ? `Группа · участников: ${members.length}` : 'Одиночный забег'}</strong>
                  <em data-status={run.status}>{run.status === 'victory' ? 'Победа' : run.status === 'defeat' ? 'Поражение' : run.status === 'abandoned' ? 'Завершён' : run.phase === 'combat' ? 'В бою' : 'В лагере'}</em></div>
                <span className="run-row-members">{members.map(member => <RunCharacterIdentity key={member.id} character={member} />)}</span>
                <span className="run-row-progress">{run.experience.toLocaleString('ru-RU')} XP · {run.encounters_won} побед · попытка {run.attempt}</span>
              </Link>
            );})}
          </section>
        </div>
      )}
      {manageShop&&<button className="roguelike-secondary run-shop-settings" onClick={()=>setShopSettingsOpen(true)}>Настройки магазина забега</button>}
      {naming && <div className="character-template-backdrop"><section className="character-template-dialog" role="dialog" aria-modal="true" aria-label="Имена участников группы" ref={dialogRef} tabIndex={-1}
        onKeyDown={event => {if (event.key === 'Escape' && !busy) setNaming(false);}}>
        <h2>Имена участников группы</h2>
        {presets.map(preset => <label key={preset.id}>{preset.name}<input maxLength={100} value={names[preset.id] ?? preset.name} disabled={busy}
          onChange={event => setNames(current => ({...current, [preset.id]: event.target.value}))} /></label>)}
        {selected.length > 0 && <p>Также в группе: {characters.filter(c => selected.includes(c.id)).map(c => c.name).join(', ')}.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="character-template-dialog-actions"><button type="button" className="roguelike-primary" disabled={busy || presets.some(p => !names[p.id]?.trim())} onClick={() => void create()}>
          {busy ? 'Создаём…' : 'Создать и начать забег'}</button>
          <button type="button" className="roguelike-secondary" disabled={busy} onClick={() => setNaming(false)}>Отмена</button></div>
      </section></div>}
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
