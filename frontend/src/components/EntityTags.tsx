import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {entityTagsApi,merchantSettingsApi,tagError,type EntityTag,type TaggedEntityType,type MerchantItemRule} from '../api/entityTags';
import {useSiteSettings} from '../settings';
import './EntityTags.css';
import EntitySoundEditor from '../audio/EntitySoundEditor';
import {useEntityDetail} from '../contexts/entityDetail';

export function NewTagForm({onCreated}:{onCreated:(tag:EntityTag)=>void}) {
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div className="entity-tag-form">
  <label>Название нового тега<input maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label>Описание тега<textarea maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
  <button type="button" disabled={busy||!name.trim()} onClick={async()=>{setBusy(true);setError('');try{const tag=await entityTagsApi.create(name,description);onCreated(tag);setName('');setDescription('');}catch(e){setError(tagError(e));}finally{setBusy(false);}}}>Создать тег</button>
  {error&&<p role="alert">{error}</p>}
 </div>;
}

function ItemRuleEditor({id}:{id:string}) {
 const [rule,setRule]=useState<MerchantItemRule|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;merchantSettingsApi.item(id).then(r=>{if(live)setRule(r)}).catch(e=>{if(live)setMessage(tagError(e))});return()=>{live=false}},[id]);
 if(!rule)return <p>{message||'Загрузка параметров товара…'}</p>;
 return <details className="entity-tag-editor"><summary>Параметры товара забега</summary><div className="entity-tag-form">
  <p>Применяются только к предметам с тегом соответствующего пула. Пустая цена — цена карточки за всю пачку, с округлением вверх до золотого.</p>
  {([['min_level','Минимальный уровень',1,5],['weight','Вес при случайном выборе',1,1000],['quantity','Предметов в пачке',1,1000]] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} value={rule[key]} onChange={e=>setRule({...rule,[key]:Number(e.target.value)})}/></label>)}
  <label>Цена пачки, зм (необязательно)<input type="number" min={0} max={1000000} value={rule.price??''} onChange={e=>setRule({...rule,price:e.target.value===''?null:Number(e.target.value)})}/></label>
  <label>Категория добычи<select value={rule.kind} onChange={e=>setRule({...rule,kind:e.target.value})}><option value="equipment">Снаряжение</option><option value="consumable">Расходник</option><option value="magic">Магический предмет</option></select></label>
  <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{setRule(await merchantSettingsApi.saveItem(rule));setMessage('Сохранено. Новые предложения используют эти параметры.')}catch(e){setMessage(tagError(e))}finally{setBusy(false)}}}>Сохранить параметры товара</button>
  {message&&<p role="status">{message}</p>}
 </div></details>;
}

export default function EntityTags({type,id}:{type:TaggedEntityType;id:string}) {
 const {playerMode}=useSiteSettings();
 const {readOnly=false}=useEntityDetail();
 const [selected,setSelected]=useState<EntityTag[]>([]),[catalog,setCatalog]=useState<EntityTag[]>([]),[canManage,setCanManage]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
 useEffect(()=>{if(playerMode)return;let live=true;setError('');setSelected([]);setCanManage(false);Promise.all([entityTagsApi.get(type,id),readOnly?Promise.resolve({tags:[],can_manage:false}):entityTagsApi.list()]).then(([tags,all])=>{if(live){setSelected(tags);setCatalog(all.tags);setCanManage(all.can_manage)}}).catch(e=>{if(live)setError(tagError(e))});return()=>{live=false}},[type,id,playerMode,readOnly]);
 if(playerMode)return null;
 const save=async(tags:EntityTag[])=>{if(readOnly)return;const previous=selected;setSelected(tags);setBusy(true);setError('');try{await entityTagsApi.set(type,id,tags.map(t=>t.id))}catch(e){setSelected(previous);setError(tagError(e))}finally{setBusy(false)}};
 const contentType=({card:'cards',action:'actions',effect:'effects',spell:'spells',feat:'feats',background:'backgrounds',race:'races',class:'classes',resource:'resources',variable:'variables',concept:'concepts',passive:'passives',monster:'monsters'} as const)[type];
 return <section className="entity-tags" aria-label="Теги сущности">
  <h3>Теги</h3><div className="entity-tag-chips">{selected.map(t=><Link key={t.id} to={type==='monster'?`/monsters?tag=${t.id}`:`/?type=${contentType}&tag=${t.id}`} aria-description={t.description}>{t.name}</Link>)}{!selected.length&&<span>Не назначены</span>}</div>
  {!readOnly&&canManage&&<details className="entity-tag-editor"><summary>Изменить теги</summary>
   <label>Найти тег<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <div className="entity-tag-options">{catalog.filter(t=>(t.name+' '+t.description).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(t=><label key={t.id}><input type="checkbox" disabled={busy} checked={selected.some(s=>s.id===t.id)} onChange={e=>void save(e.target.checked?[...selected,t]:selected.filter(s=>s.id!==t.id))}/><span>{t.name}{t.description&&<small>{t.description}</small>}</span></label>)}</div>
   <NewTagForm onCreated={tag=>{setCatalog(prev=>[...prev.filter(t=>t.id!==tag.id),tag]);void save([...selected.filter(t=>t.id!==tag.id),tag]);}}/>
  </details>}
  {!readOnly&&canManage&&type==='card'&&<ItemRuleEditor id={id}/>}
  {!readOnly&&canManage&&(type==='action'||type==='spell')&&<EntitySoundEditor type={type} id={id}/>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
