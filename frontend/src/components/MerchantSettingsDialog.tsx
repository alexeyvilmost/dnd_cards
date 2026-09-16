import {useEffect,useState} from 'react';
import {entityTagsApi,merchantSettingsApi,tagError,type MerchantSettings,type EntityTag} from '../api/entityTags';
import {EntityDetailShell} from './EntityDetailShell';
import './EntityTags.css';
export default function MerchantSettingsDialog({onClose}:{onClose:()=>void}){
 const [value,setValue]=useState<MerchantSettings|null>(null),[tags,setTags]=useState<EntityTag[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{Promise.all([merchantSettingsApi.get(),entityTagsApi.list()]).then(([v,t])=>{setValue(v);setTags(t.tags)}).catch(e=>setError(tagError(e)))},[]);
 return <EntityDetailShell title="Настройки магазина забега" isOpen onClose={onClose} maxWidth={900}>
  {error&&<p role="alert">{error}</p>}
  {value&&<div className="entity-tag-form"><p>Каждый свободный слот получает независимый бросок редкости. После достижения лимита магических предметов выбираются обычные. Если нужная редкость закончилась — обычный товар; если и его нет, полка остаётся пустой. Резерв сохраняется.</p>
   {([['pool_tag','Тег случайного ассортимента и добычи'],['starting_tag','Тег стартовой экипировки'],['staple_tag','Тег постоянного ассортимента']] as const).map(([key,label])=><label key={key}>{label}<select disabled={!value.can_manage} value={value.config[key]} onChange={e=>setValue({...value,config:{...value.config,[key]:e.target.value}})}>{tags.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>)}
   <div className="merchant-config-levels"><table><thead><tr><th>Уровень</th><th>Товаров</th><th>Макс. магич.</th><th>Необычн. %</th><th>Редкие %</th><th>Эпич. %</th></tr></thead><tbody>{value.config.levels.map((row,i)=><tr key={row.level}><th>{row.level}</th>{(['slots','magic_limit','uncommon_bp','rare_bp','epic_bp'] as const).map(key=>{const percent=key.endsWith('_bp');return <td key={key}><input aria-label={`Уровень ${row.level}: ${key}`} disabled={!value.can_manage} type="number" min={0} max={percent?100:40} step={percent?.01:1} value={row[key]/(percent?100:1)} onChange={e=>setValue({...value,config:{...value.config,levels:value.config.levels.map((r,j)=>j===i?{...r,[key]:Math.round(Number(e.target.value)*(percent?100:1))}:r)}})}/></td>})}</tr>)}</tbody></table></div>
   {([['supplies_price','Комплект припасов, зм'],['refresh_price','Базовая цена обновления, зм']] as const).map(([key,label])=><label key={key}>{label}<input disabled={!value.can_manage} type="number" min={0} value={value.config[key]} onChange={e=>setValue({...value,config:{...value.config,[key]:Number(e.target.value)}})}/></label>)}
   <p>Цены и количество в пачке настраиваются в детальном окне товара. Изменения применяются к новому ассортименту; текущие цены и покупки не переписываются. Стартовая экипировка доступна до первой победы.</p>
   {value.can_manage&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setValue(await merchantSettingsApi.save(value));setMessage('Настройки сохранены')}catch(e){setError(tagError(e))}finally{setBusy(false)}}}>Сохранить настройки магазина</button>}
   {message&&<p role="status">{message}</p>}
  </div>}
 </EntityDetailShell>;
}
