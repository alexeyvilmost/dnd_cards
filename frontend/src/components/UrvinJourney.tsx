import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {Swords,Skull,Store,PackageOpen,Mountain,Tent,Sparkles,Crown,Check,MapPin,ChevronsUp} from 'lucide-react';
import type {RoguelikeRun,RoguelikeCommandType} from '../roguelike/api';
import {runCharacters,runCombatURL,runSheetURL} from '../roguelike/navigation';
import {shopURLFromPage} from '../utils/shopNavigation';
import {useSiteSettings} from '../settings';
import SheetActionLine from './SheetActionLine';
import CombatPresentationDialog from './CombatPresentationDialog';
import HoverCard from './HoverCard';
import {cardsApi} from '../api/client';
import type {Card} from '../types';
import './UrvinJourney.css';

const roomIcons:Record<string,typeof Swords>={normal:Swords,elite:Skull,shop:Store,treasure:PackageOpen,pass:Mountain,camp:Tent,event:Sparkles,boss:Crown};
const skills:Record<string,string>={stealth:'Скрытность',sleight_of_hand:'Ловкость рук',athletics:'Атлетика',intimidation:'Запугивание',investigation:'Анализ',medicine:'Медицина',arcana:'Магия',religion:'Религия',acrobatics:'Акробатика',survival:'Выживание'};
function JourneyLoot({items,onClaim,busy}:{items:Array<{card_id:string;name:string}>;onClaim?:(id:string)=>void;busy?:boolean}){
  const settings=useSiteSettings(),[cards,setCards]=useState<Record<string,Card>>({});
  const ids=items.map(i=>i.card_id).join(',');
  useEffect(()=>{let active=true;void Promise.all(ids.split(',').filter(Boolean).map(id=>cardsApi.getCard(id))).then(values=>{if(active)setCards(Object.fromEntries(values.map(c=>[c.id,c])))}).catch(()=>{});return()=>{active=false}},[ids]);
  return <div className="cs-action-tiles urvin-loot">{items.map((item,i)=><div key={`${item.card_id}:${i}`}>
    <SheetActionLine name={item.name} imageUrl={cards[item.card_id]?.image_url} itemRef={cards[item.card_id]} variant={settings.entityDisplay.items} onActivate={()=>{}}/>
    {onClaim&&<button className="roguelike-secondary" disabled={busy} onClick={()=>onClaim(item.card_id)}>Забрать</button>}
  </div>)}</div>;
}
export default function UrvinJourney({run,busy,command}:{run:RoguelikeRun;busy:boolean;command:(type:RoguelikeCommandType,payload?:Record<string,unknown>)=>Promise<void>}){
  const j=run.journey!,settings=useSiteSettings(),location=useLocation(),members=runCharacters(run);
  const [actor,setActor]=useState(run.character_id);
  const current=j.nodes.find(n=>n.id===j.current_node),event=j.event;
  const available=new Set(current?(current.completed?current.next:[]):j.nodes.filter(n=>n.row===0).map(n=>n.id));
  const earned=[0,300,900,2700,6500].filter(x=>run.experience>=x).length;
  const levelsReady=!run.pending_level&&members.every(c=>c.level===earned);
  const rows=Math.max(...j.nodes.map(n=>n.row))+1,height=rows*82+34;
  const routeScroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{const viewport=routeScroll.current;if(viewport)viewport.scrollTop=height-48-(current?.row??0)*82-viewport.clientHeight*.65;},[current?.id,height]);
  const point=(node:typeof j.nodes[number])=>({x:node.kind==='boss'?240:90+node.lane*150,y:height-48-node.row*82});
  const room=j.rooms.find(r=>r.id===current?.kind);
  const choice=event?.definition.options.find(o=>o.id===event.choice_id);
  const pending=event?.pending;
  const participant=members.find(c=>c.id===(event?.actor_id??actor));
  return <section className="urvin-layout" aria-label="Урвинский маршрут">
    <div className="urvin-route-panel">
      <header><div><p className="roguelike-kicker">ПУТЬ К ЧЁРНЫМ ВРАТАМ</p><h2>Выберите дорогу</h2></div><MapPin size={26}/></header>
      <div className="urvin-route-scroll" ref={routeScroll}><div className="urvin-route" style={{height}}>
        <svg viewBox={`0 0 480 ${height}`} preserveAspectRatio="none" aria-hidden="true">{j.nodes.flatMap(n=>n.next.map(id=>{
          const next=j.nodes.find(v=>v.id===id)!;const a=point(n),b=point(next);
          return <path key={`${n.id}-${id}`} d={`M${a.x},${a.y} C${a.x},${a.y-38} ${b.x},${b.y+38} ${b.x},${b.y}`} className={n.completed&&next.completed?'is-travelled':n.id===current?.id?'is-open':''}/>;
        }))}</svg>
        {j.nodes.map(n=>{const p=point(n),Icon=roomIcons[n.kind]??Sparkles,definition=j.rooms.find(r=>r.id===n.kind);return <div className="urvin-node-anchor" key={n.id} style={{left:`${p.x/480*100}%`,top:p.y}}>
          <HoverCard content={<div className="urvin-room-preview"><strong>{definition?.name}</strong><p>{definition?.description}</p><small>Этап {n.row+1}{n.completed?' · пройден':n.id===current?.id?' · текущая комната':''}</small></div>}>
            <button className={`urvin-node ${n.kind}${n.completed?' is-complete':''}${n.id===current?.id?' is-current':''}${available.has(n.id)?' is-available':''}`}
              aria-label={`${definition?.name??n.kind}, этап ${n.row+1}${n.completed?', пройден':''}`} aria-current={n.id===current?.id?'step':undefined}
              disabled={busy||run.phase!=='camp'||!levelsReady||!available.has(n.id)} onClick={()=>void command('enter_room',{node_id:n.id})}>
              <Icon size={23}/>{n.completed&&<Check className="urvin-node-check" size={14}/>}</button>
          </HoverCard>
        </div>})}
      </div></div>
      <div className="urvin-legend">{j.rooms.map(r=>{const Icon=roomIcons[r.id]??Sparkles;return <span key={r.id}><Icon size={14}/>{r.name}</span>})}</div>
    </div>
    <div className="urvin-room-panel">
      <section className="urvin-aura-status"><SheetActionLine name={j.aura.name} imageUrl={j.aura.image_url} effectRef={j.aura}
        description={j.aura.description} variant={settings.entityDisplay.effects} iconShape="round" selected={j.aura_active} onActivate={()=>{}}/>
        <div><strong>{j.aura.name}</strong><p>{j.aura_active?j.aura.description:'Аура израсходована'}</p></div></section>
      {!current?<article><h2>Каждый путь — новая история</h2><p>Начните с одной из трёх нижних комнат. Следующие комнаты доступны только по соединяющим их дорогам. В конце пути вас ждёт хранитель.</p></article>
        :<article><p className="roguelike-kicker">ЭТАП {current.row+1} · {current.completed?'ЗАВЕРШЁН':'ТЕКУЩАЯ КОМНАТА'}</p><h2>{room?.name}</h2><p>{room?.description}</p>
          {!levelsReady&&<section className="urvin-level-gate" aria-label="Повышение уровня перед прохождением">
            <p className="urvin-notice">Перед дальнейшим прохождением необходимо повысить уровень персонажей до {earned}.</p>
            <ul className="urvin-level-roster">
              {members.map(c=>{
                const needsLevel=c.level<earned;
                const pendingHere=!!run.pending_level&&c.level===earned;
                return <li key={c.id} className={needsLevel?'is-pending':pendingHere?'is-waiting':''}>
                  <div>
                    <strong>{c.name}</strong>
                    <span>уровень {c.level}{needsLevel?` → ${c.level+1}`:pendingHere?' · ждёт союзников':earned===c.level?' · готов':''}</span>
                  </div>
                  {needsLevel
                    ? <Link className="roguelike-primary" to={`/character-forge/${c.id}?levelup=1&roguelike=${run.id}`}><ChevronsUp size={16}/> Повысить уровень</Link>
                    : pendingHere
                      ? <Link className="roguelike-secondary" to={runSheetURL(run,c.id)}>Дождаться союзников</Link>
                      : <span className="urvin-level-ready">Готов</span>}
                </li>;
              })}
            </ul>
          </section>}
          {run.phase==='combat'?<Link className="roguelike-primary" to={runCombatURL(run)}>Продолжить бой</Link>:<>
            {!current.completed&&['normal','elite','boss'].includes(current.resolved_kind??current.kind)&&<button className="roguelike-primary" disabled={busy} onClick={()=>void command('resume_room')}>Вернуться в сражение</button>}
            {!current.completed&&current.kind==='shop'&&<div className="urvin-room-actions"><Link className="roguelike-primary" to={shopURLFromPage(`/shop/roguelike?roguelike=${run.id}&character=${run.character_id}`,location)}>К торговцу</Link><button className="roguelike-secondary" disabled={busy} onClick={()=>void command('leave_room')}>Продолжить путь</button></div>}
            {!current.completed&&['pass','camp'].includes(current.kind)&&<><p>Отдых общий для всей группы. Для выбора костей хитов или подготовки заклинаний откройте лист участника.</p><button className="roguelike-primary" disabled={busy||members.some(c=>c.current_hp<1)} onClick={()=>void command(current.kind==='camp'?'long_rest':'short_rest',{preserve_preparation:true})}>{current.kind==='camp'?'Разбить лагерь · долгий отдых':'Передохнуть · короткий отдых'}</button></>}
            {!current.completed&&event&&!event.finished&&<section className="urvin-event"><h3>{event.definition.name}</h3><p>{event.definition.description}</p>
              {!event.choice_id?<><label>Кто действует?<select value={actor} onChange={e=>setActor(e.target.value)}>{members.map(c=><option key={c.id} value={c.id} disabled={c.current_hp<1}>{c.name}</option>)}</select></label>
                {event.definition.options.map(o=><button className="urvin-option" key={o.id} disabled={busy||run.gold<(o.cost_gold??0)} onClick={()=>void command('event_choice',{option_id:o.id,character_id:actor})}><strong>{o.name}{o.cost_gold?` · ${o.cost_gold} золотых`:''}</strong><span>{o.description}</span>{!!o.checks?.length&&<small>{o.checks.map(c=>`${skills[c.skill]??c.skill} · СЛ ${c.dc}`).join(' → ')}</small>}</button>)}
              </>:<><strong>{choice?.name} · {participant?.name}</strong>{event.rolls.map((r,i)=><p key={i}>{skills[choice?.checks?.[i]?.skill??'']}: {r.roll.total} — {r.roll.outcome==='success'?'успех':'провал'}</p>)}
                {!pending&&choice?.checks?.[event.check_index]&&<button className="roguelike-primary" disabled={busy} onClick={()=>void command('event_roll')}>Бросить · {skills[choice.checks[event.check_index].skill]} · СЛ {choice.checks[event.check_index].dc}</button>}</>}
            </section>}
            {current.completed&&<p className="urvin-notice">Комната пройдена. Выберите следующую на карте.</p>}
          </>}
          {current.completed&&run.last_reward&&<div className="urvin-reward">{Boolean(run.last_reward.experience)&&<span>+{run.last_reward.experience} опыта каждому</span>}{Boolean(run.last_reward.gold)&&<span>+{run.last_reward.gold} золотых</span>}{!!run.last_reward.items?.length&&<JourneyLoot items={run.last_reward.items}/>}</div>}
        </article>}
      {!!j.stash?.length&&<article><h3>Невместившаяся добыча</h3><p>Освободите место в рюкзаке и заберите награду.</p><select aria-label="Получатель добычи" value={actor} onChange={e=>setActor(e.target.value)}>{members.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><JourneyLoot items={j.stash} busy={busy} onClaim={id=>void command('claim_stash',{card_id:id,character_id:actor})}/></article>}
    </div>
    {pending&&event&&<CombatPresentationDialog modeOverride="standard" busy={busy} provisional={pending.phase!=='resolved'}
      beat={{id:`${current?.id}:${event.check_index}`,sourceId:event.actor_id!,sourceName:participant?.name??'Персонаж',actionName:skills[choice?.checks?.[event.check_index]?.skill??'']??event.definition.name,
        rollerName:participant?.name,rollKind:'check',audience:'own',roll:pending.roll,cues:[]}}
      influences={pending.influences} onInfluence={pending.phase==='resolved'?undefined:id=>void command('event_resolve',{effect_id:id})}
      onClose={()=>void command(pending.phase==='resolved'?'event_continue':'event_resolve')}/>}
  </section>;
}
