import {Link, useNavigate} from 'react-router-dom';
import {useEffect,useState} from 'react';
import {apiClient} from '../api/client';
import {loadPassiveCatalog, passivePresentationEffect, usePassiveCatalog} from '../character/passiveCatalog';
import SheetActionLine from './SheetActionLine';
import {useSiteSettings} from '../settings';
import './SheetPassiveToggle.css';

export default function PassiveLibrary({search='',mode,tag=''}:{search?:string;mode?:'icon'|'row';tag?:string}) {
  const [tagged,setTagged]=useState<string[]>([]);
  useEffect(()=>{let live=true;setTagged([]);if(tag)void apiClient.get(`/api/entity-tag-members/${encodeURIComponent(tag)}`,{params:{type:'passive'}}).then(r=>{if(live)setTagged(r.data.ids)});return()=>{live=false}},[tag]);
  const catalog=usePassiveCatalog();
  const navigate=useNavigate();
  const {entityDisplay}=useSiteSettings();
  const displayMode=mode??entityDisplay.effects;
  const rows=catalog.passives.filter(row=>(!tag||tagged.includes(row.key))&&row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="passive-library">
    <h2>Переключаемые пассивы</h2>
    <p>Оформление настроек боя. Изменение карточки не меняет правила её срабатывания.</p>
    {catalog.error && <p role="alert">{catalog.error} <button onClick={()=>void loadPassiveCatalog(true)}>Повторить</button></p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">{rows.map(row=><article key={row.key} className="rounded-lg border p-4 flex items-center gap-3">
      <SheetActionLine name={row.name} effectRef={passivePresentationEffect(row)} imageUrl={row.image_url || '/icons/resources/action.png'}
        variant={displayMode} iconShape="round" onActivate={()=>navigate(`/passive-creator?edit=${encodeURIComponent(row.key)}`)}/>
      {displayMode === 'icon' && <div><Link to={`/passive-creator?edit=${encodeURIComponent(row.key)}`}>{row.name}</Link><small className="block">{catalog.can_manage?'Открыть в конструкторе':'Посмотреть оформление'}</small></div>}
    </article>)}</div>
    {!rows.length && <p>{catalog.loading ? 'Загрузка оформления…' : 'Пассивы не найдены.'}</p>}
  </section>;
}
