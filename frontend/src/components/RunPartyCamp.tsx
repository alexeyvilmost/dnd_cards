import {useEffect,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {shopURLFromPage} from '../utils/shopNavigation';
import {Backpack,Flame,Swords,Users} from 'lucide-react';
import {cardsApi,classesApi} from '../api/client';
import type {Card} from '../types';
import type {RoguelikeRun,RoguelikeCommandType} from '../roguelike/api';
import {roguelikeApi} from '../roguelike/api';
import {runCharacters,runCombatURL,runSheetURL,notifyRunUpdated} from '../roguelike/navigation';
import {useSiteSettings} from '../settings';
import SheetActionLine from './SheetActionLine';
import './RunPartyCamp.css';
import HealingPulse from '../audio/HealingPulse';
import {formatCopper} from '../utils/money';
import {runMoneyCopper} from '../roguelike/money';

export default function RunPartyCamp({run,onUpdated}:{run:RoguelikeRun;onUpdated:(run:RoguelikeRun)=>void}){
  const navigate=useNavigate(),settings=useSiteSettings();
  const location=useLocation();
  const members=runCharacters(run),camp=run.phase==='camp'&&run.status==='active';
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [from,setFrom]=useState(run.character_id),[to,setTo]=useState(members[1]?.id??'');
  const [cards,setCards]=useState<Card[]>([]),[item,setItem]=useState(''),[qty,setQty]=useState(1);
  const [transferOpen,setTransferOpen]=useState(false);
  const [classNames,setClassNames]=useState<Record<string,string>>({});
  useEffect(()=>{
    let active=true;
    void classesApi.getClasses({limit:100,fields:'list'}).then(result=>{
      if(active)setClassNames(Object.fromEntries(result.classes.map(c=>[c.id,c.name])));
    }).catch(()=>{});
    return()=>{active=false};
  },[]);
  const source=members.find(c=>c.id===from),rows=source?.inventory_items?.filter(r=>!r.container_id)??[];
  const stock=rows.find(r=>r.card_id===item)?.qty??0;
  useEffect(()=>{
    if(!transferOpen)return;
    let active=true;setItem('');setQty(1);
    void Promise.all([...new Set(rows.map(r=>r.card_id))].map(id=>cardsApi.getCard(id))).then(next=>{if(active)setCards(next);})
      .catch(()=>{if(active)setError('Не удалось загрузить предметы');});
    return()=>{active=false};
  },[from,run.revision,transferOpen]);
  const command=async(type:RoguelikeCommandType,payload:Record<string,unknown>={})=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const next=await roguelikeApi.command(run.id,run.revision,type,payload);onUpdated(next);notifyRunUpdated();
      if(type==='start_encounter')navigate(runCombatURL(next));
    }catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие');
      try{onUpdated(await roguelikeApi.get(run.id));}catch{/* keep last confirmed state */}
    }finally{setBusy(false)}
  };
  const earned=[0,300,900,2700,6500].filter(x=>run.experience>=x).length;
  const downed=members.some(c=>c.current_hp<1);
  return <main className="roguelike-shell run-party-camp">
    <Link className="roguelike-back" to="/roguelike">← Все забеги</Link>
    <header className="roguelike-camp-header">
      <div><p className="roguelike-kicker">{camp?'ОБЩИЙ ЛАГЕРЬ':'ГРУППА В БОЮ'}</p><h1><Users size={30}/> {members.length===1?'Одинокий путник':`Группа · ${members.length} героев`}</h1>
        <p>Попытка {run.attempt} · {run.encounters_won} побед · {run.experience} опыта каждому · {run.game_clock_hours} ч.</p></div>
      <div className="roguelike-wallet"><strong>{formatCopper(runMoneyCopper(run))}</strong><span>в общем кошельке</span><strong>{run.supplies}</strong><span>комплектов припасов</span></div>
    </header>
    {error&&<p role="alert" className="roguelike-error">{error}</p>}
    <div className="run-party-controls">
      {camp?<>
        {run.experience>=14000?<button className="roguelike-primary" disabled={busy} onClick={()=>void command('victory')}>Завершить забег</button>
          :<button className="roguelike-primary" disabled={busy||!!run.pending_level||members.some(c=>c.level!==earned)} onClick={()=>void command('start_encounter')}><Swords size={17}/> Следующее столкновение</button>}
        <Link className="roguelike-secondary" to={shopURLFromPage(`/shop/roguelike?roguelike=${run.id}&character=${run.character_id}`,location)}>Магазин</Link>
        {members.length>1&&<button className="roguelike-secondary" onClick={()=>setTransferOpen(v=>!v)}><Backpack size={17}/> Передать предметы</button>}
        <button className="roguelike-secondary" disabled={busy||downed} onClick={()=>void command('short_rest')}>Короткий отдых · 1 ч.</button>
        <button className="roguelike-secondary" disabled={busy||downed||run.supplies<members.length} onClick={()=>void command('long_rest',{preserve_preparation:true})}><Flame size={17}/> Долгий отдых · {members.length} припасов</button>
      </>:<Link className="roguelike-primary" to={runCombatURL(run)}><Swords size={17}/> Продолжить бой</Link>}
    </div>
    <p className="run-party-help">Отдых общий и синхронный. В листе участника можно потратить его кости хитов, выбрать подготовку или применить способность к союзнику. Кнопки отдыха здесь сохраняют текущую подготовку; короткий отдых не тратит кости хитов.</p>
    {downed&&camp&&<p className="run-party-help">Есть участник с 0 хитов: сначала помогите ему действием союзника. Все изменения сохраняются в его листе.</p>}
    <section className="run-party-roster" aria-label="Участники группы">
      {members.map(c=><article key={c.id} className={`run-party-member${c.current_hp<1?' is-downed':''}`}>
        <HealingPulse id={c.id} hp={c.current_hp}/>
        <Link to={runSheetURL(run,c.id)} className="run-party-portrait">{c.avatar_url?<img src={c.avatar_url} alt={c.name}/>:<Users size={48}/>}</Link>
        <div className="run-party-member-info"><h2>{c.name}</h2><p>{classNames[c.class_id??'']??'Персонаж'} · уровень {c.level} · КД {c.armor_class??10}</p>
          <div className="run-party-hp" role="progressbar" aria-label={`Хиты: ${c.name}`} aria-valuemin={0} aria-valuemax={c.max_hp} aria-valuenow={c.current_hp}><i style={{width:`${Math.min(100,100*c.current_hp/Math.max(1,c.max_hp))}%`}}/></div>
          <strong>{c.current_hp} / {c.max_hp} хитов</strong>
          <div className="run-party-member-links"><Link to={runSheetURL(run,c.id)}>Лист · действия и лечение</Link>
            {camp&&c.level<earned&&<Link to={`/character-forge/${c.id}?levelup=1&roguelike=${run.id}`}>Повысить до {c.level+1} уровня</Link>}
          </div>
        </div>
      </article>)}
    </section>
    {camp&&transferOpen&&<section className="run-party-transfer" aria-label="Передача предметов">
      <h2>Из рюкзака в рюкзак</h2><p>Экипированные, настроенные и связанные предметы сначала нужно освободить. Содержимое контейнера не передаётся вместе с ним.</p>
      <div className="run-party-transfer-fields"><label>Отправитель<select value={from} onChange={e=>setFrom(e.target.value)}>{members.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Получатель<select value={to} onChange={e=>setTo(e.target.value)}><option value="">Выберите участника</option>{members.filter(c=>c.id!==from).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <div className="cs-action-tiles run-party-transfer-items">{cards.map(card=><SheetActionLine key={card.id} itemRef={card} name={card.name} imageUrl={card.image_url} variant={settings.entityDisplay.items} selected={item===card.id}
        detail={`В рюкзаке: ${rows.find(r=>r.card_id===card.id)?.qty??0}`} onActivate={()=>{setItem(card.id);setQty(1)}}/>)}{!cards.length&&<p>Рюкзак пуст</p>}</div>
      <label>Количество <input aria-label="Количество для передачи" type="number" min={1} max={stock} value={qty} onChange={e=>setQty(Number(e.target.value))}/></label>
      <button className="roguelike-primary" disabled={busy||!item||!to||from===to||!Number.isInteger(qty)||qty<1||qty>stock} onClick={()=>void command('transfer_item',{from_character_id:from,to_character_id:to,card_id:item,quantity:qty})}>Передать</button>
    </section>}
  </main>;
}
