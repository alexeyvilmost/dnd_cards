import { useEffect, useState } from 'react';
import {withoutLegacyRunSuffix} from '../character/familiarLabels';
import { RotateCcw, Trophy, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import {isRunEligible} from '../roguelike/eligibility';
import CharacterTemplateLibrary from '../components/CharacterTemplateLibrary';
import RunPartyCamp from '../components/RunPartyCamp';
import {UrvinStash} from '../components/UrvinJourney';
import type { ForgeCharacter } from '../character/types';
import { roguelikeApi, type RoguelikeRun, type UrvinDefinition } from '../roguelike/api';
import SheetActionLine from '../components/SheetActionLine';
import {useSiteSettings} from '../settings';
import '../components/UrvinJourney.css';
import './RoguelikePage.css';
import MerchantSettingsDialog from '../components/MerchantSettingsDialog';
import {merchantSettingsApi} from '../api/entityTags';
import RunCharacterIdentity from '../components/RunCharacterIdentity';
import {runCharacters,notifyRunUpdated} from '../roguelike/navigation';
import {type CharacterTemplate} from '../character/templatesApi';
import HoverCard from '../components/HoverCard';
import {useCombatDialogFocus} from '../components/useCombatDialogFocus';

const RUN_SELECTION_HELP = 'Выберите от 1 до 6 персонажей 1-го уровня любого класса. Можно сочетать пресеты и своих персонажей. Для каждого будет создан отдельный игровой лист; исходные персонажи останутся без изменений.';

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'Операция не выполнена';
}

function RunList() {
  const settings=useSiteSettings();
  const [mode,setMode]=useState<'classic'|'urvin'>('classic'),[definition,setDefinition]=useState<UrvinDefinition>(),[aura,setAura]=useState('');
  const [modeError,setModeError]=useState('');
  const loadModes=()=>{setModeError('');void roguelikeApi.modes().then(setDefinition).catch(()=>setModeError('Не удалось загрузить ауры.'));};
  useEffect(loadModes,[]);
  const [manageShop,setManageShop]=useState(false),[shopSettingsOpen,setShopSettingsOpen]=useState(false);
  useEffect(()=>{void merchantSettingsApi.get().then(s=>setManageShop(s.can_manage)).catch(()=>{})},[]);
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RoguelikeRun[]>([]);
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [presets, setPresets] = useState<CharacterTemplate[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState(false);
  const dialogRef = useCombatDialogFocus(naming);
  const count = selected.length + presets.length;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingRun, setDeletingRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([roguelikeApi.listSelection(), charactersV3Api.list()])
      .then(([selection, loadedCharacters]) => {
        if (!active) return;
        setRuns(selection.runs);
        const candidates = loadedCharacters.filter(isRunEligible);
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
      if(mode==='urvin'&&!aura)throw Error('Выберите стартовую ауру');
      const options = {...(mode === 'urvin' ? {mode, aura_id: aura} : {}),
        ...(presets.length ? {templates: presets.map(preset => ({template_id: preset.id, name: names[preset.id].trim()}))} : {})};
      const run = Object.keys(options).length ? await roguelikeApi.create(selected, options) : await roguelikeApi.create(selected);
      navigate(`/roguelike/${run.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };
  const removeRun = async (id: string) => {
    if(busy) return;
    setBusy(true); setError(null);
    try {await roguelikeApi.remove(id); setRuns(rows => rows.filter(run => run.id !== id)); setDeletingRun(null);}
    catch(reason) {setError(errorMessage(reason));}
    finally {setBusy(false);}
  };

  return (
    <main className="roguelike-shell roguelike-start">
      <section className="roguelike-hero">
        <p className="roguelike-kicker">РЕЖИМ ЗАБЕГА</p>
        <h1>{mode==='urvin'?'Урвинский забег':'Дорога до шестого уровня'}</h1>
        <p>{mode==='urvin'?'Выберите ауру и проложите собственный путь через битвы, события и привалы к финальному хранителю.':'Проведите героев через случайные столкновения, развивайте сборки и наберите 14 000 опыта.'}</p>
        <div className="urvin-mode-switch" role="group" aria-label="Вариант забега">
          <button aria-pressed={mode==='classic'} onClick={()=>setMode('classic')}>Классический</button>
          <button aria-pressed={mode==='urvin'} onClick={()=>setMode('urvin')}>Урвинский забег</button>
        </div>
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
            {mode==='urvin'&&<section className="urvin-aura-picker"><h3>Стартовая аура</h3>
              {!definition?<p>{modeError||'Загружаем ауры…'}{modeError&&<button onClick={loadModes}>Повторить</button>}</p>:<div className="cs-action-tiles">{definition.auras.map(effect=>{
                const limit=(effect.mechanics.journey as {max_party_size?:number}|undefined)?.max_party_size;
                return <SheetActionLine key={effect.id} effectRef={effect} name={effect.name} imageUrl={effect.image_url}
                  description={effect.description} variant={settings.entityDisplay.effects} iconShape="round" selected={aura===effect.id}
                  disabled={busy||!!limit&&count>limit} disabledTitle="Эта аура доступна только одиночному герою" onActivate={()=>setAura(effect.id)}/>;
              })}</div>}
              <p>{definition?.auras.find(a=>a.id===aura)?.description??'Выберите одну ауру. Она действует на всю группу.'}</p>
            </section>}
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
              <button type="button" className="roguelike-primary" disabled={busy || !count || mode==='urvin'&&(!aura||!definition||Number((definition.auras.find(a=>a.id===aura)?.mechanics.journey as {max_party_size?:number})?.max_party_size??6)<count)} onClick={() => presets.length ? setNaming(true) : void create()}>
                {busy ? 'Создаём…' : `Начать забег · ${count}`}
              </button>
            </div>
          </section>

          <section className="roguelike-card roguelike-runs">
            <h2>Продолжить забег</h2>
            {runs.length === 0 ? <p>Здесь появятся ваши забеги.</p> : runs.map((run) => {
              const members = runCharacters(run);
              return (
              <div className="roguelike-run-entry" key={run.id}><Link className="roguelike-run-row" to={`/roguelike/${run.id}`}>
                <div className="run-row-heading"><strong>{run.mode==='urvin'?'Урвинский · ':''}{members.length > 1 ? `Группа · участников: ${members.length}` : 'Одиночный забег'}</strong>
                  <em data-status={run.status}>{run.status === 'victory' ? 'Победа' : run.status === 'defeat' ? 'Поражение' : run.status === 'abandoned' ? 'Завершён' : run.phase === 'combat' ? 'В бою' : 'В лагере'}</em></div>
                <span className="run-row-members">{members.map(member => <RunCharacterIdentity key={member.id} character={member} />)}</span>
                <span className="run-row-progress">{run.experience.toLocaleString('ru-RU')} XP · {run.encounters_won} побед · попытка {run.attempt}</span>
              </Link>
              {deletingRun === run.id ? <div className="roguelike-run-delete-confirm">
                <p>Удалить забег и все его игровые листы? Исходные персонажи сохранятся.</p>
                <button className="roguelike-secondary" disabled={busy} onClick={() => setDeletingRun(null)}>Отмена</button>
                <button className="roguelike-secondary" disabled={busy} onClick={() => void removeRun(run.id)}>Удалить забег</button>
              </div> : <button className="roguelike-secondary roguelike-run-delete" aria-label={`Удалить забег: ${members.map(member => member.name).join(', ')}`} disabled={busy} onClick={() => setDeletingRun(run.id)}><Trash2 size={16} />Удалить</button>}
              </div>
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
  const [claimBusy,setClaimBusy] = useState(false);
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
  const claimStash = async (cardId:string,characterId:string) => {
    if(!run||run.status!=='victory'||claimBusy)return;
    setClaimBusy(true);setError('');
    try{
      setRun(await roguelikeApi.command(run.id,run.revision,'claim_stash',{card_id:cardId,character_id:characterId}));
      notifyRunUpdated();
    }catch(reason){
      setError(errorMessage(reason));
      try{setRun(await roguelikeApi.get(run.id));}catch{/* Preserve the last confirmed run. */}
    }finally{setClaimBusy(false);}
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
        <p className="roguelike-ending-character">{withoutLegacyRunSuffix(run.character?.name ?? 'Персонаж')}</p>
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
    {run?.status==='victory'&&run.mode==='urvin'&&!!run.journey?.stash?.length&&<section className="roguelike-card urvin-room-panel">
      <UrvinStash run={run} busy={claimBusy} onClaim={(cardId,characterId)=>void claimStash(cardId,characterId)}/>
    </section>}
  </main>;
}

export default function RoguelikePage() {
  const { id } = useParams<{ id: string }>();
  return id ? <RunCamp id={id} /> : <RunList />;
}
