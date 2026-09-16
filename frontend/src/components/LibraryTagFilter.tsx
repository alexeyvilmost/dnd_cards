import {useEffect,useState} from 'react';
import {entityTagsApi,type EntityTag} from '../api/entityTags';
import {NewTagForm} from './EntityTags';
import EntityDetailShell from './EntityDetailShell';
export default function LibraryTagFilter({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const [tags,setTags]=useState<EntityTag[]>([]),[manage,setManage]=useState(false),[open,setOpen]=useState(false),[search,setSearch]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;const load=()=>{void entityTagsApi.list().then(v=>{if(live){setTags(v.tags);setManage(v.can_manage);setError('')}}).catch(()=>{if(live)setError('Не удалось загрузить теги')})};load();window.addEventListener('entity-tags-changed',load);return()=>{live=false;window.removeEventListener('entity-tags-changed',load)}},[]);
 return <div className="tag-filter"><label>Тег <select aria-label="Фильтр по тегу" value={value} onChange={e=>onChange(e.target.value)}><option value="">Все теги</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <button type="button" onClick={()=>setOpen(true)}>Справочник тегов</button>
  {error&&<span role="alert">{error}</span>}
  {open&&<EntityDetailShell title="Справочник тегов" isOpen onClose={()=>setOpen(false)} maxWidth={600}><div className="entity-tag-form"><label>Поиск тегов<input value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="entity-tag-options">{tags.filter(t=>(t.name+' '+t.description).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(t=><div key={t.id}><button onClick={()=>{onChange(t.id);setOpen(false)}}>{t.name}</button><small>{t.description}</small></div>)}</div>{manage&&<NewTagForm onCreated={t=>setTags(p=>[...p.filter(x=>x.id!==t.id),t])}/>}</div></EntityDetailShell>}
 </div>;
}
