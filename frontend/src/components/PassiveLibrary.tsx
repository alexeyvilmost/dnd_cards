import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';
import ReviewStatusCorner from './ReviewStatusCorner';
import { LibraryReviewStatusSummary, filterReviewStatuses } from './library/LibraryReviewStatus';
import type { EntityReviewStatus } from '../content/supportStatus';
import {Link, useNavigate} from 'react-router-dom';
import {useEffect,useState} from 'react';
import {apiClient} from '../api/client';
import {loadPassiveCatalog, passivePresentationEffect, usePassiveCatalog} from '../character/passiveCatalog';
import SheetActionLine from './SheetActionLine';
import EffectPreview from './EffectPreview';
import LibraryQuickDetail from './library/LibraryQuickDetail';
import {useContentPermissions} from '../hooks/useContentPermissions';
import {useSiteSettings} from '../settings';
import './SheetPassiveToggle.css';

export default function PassiveLibrary({search='',mode,tag='',reviewStatuses=[]}:{search?:string;mode?:'icon'|'row';tag?:string;reviewStatuses?:EntityReviewStatus[]}) {
  const {admin}=useContentPermissions();
  const [selected,setSelected]=useState<import('../character/passiveCatalog').PassivePresentation|null>(null);
  const [tagged,setTagged]=useState<string[]>([]);
  useEffect(()=>{let live=true;setTagged([]);if(tag)void apiClient.get(`/api/entity-tag-members/${encodeURIComponent(tag)}`,{params:{type:'passive'}}).then(r=>{if(live)setTagged(r.data.ids)});return()=>{live=false}},[tag]);
  const catalog=usePassiveCatalog();
  const navigate=useNavigate();
  const {entityDisplay,showReviewStatus}=useSiteSettings();
  const displayMode=mode??entityDisplay.effects;
  const allRows=catalog.passives.filter(row=>(!tag||tagged.includes(row.key))&&row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const rows=filterReviewStatuses(allRows,showReviewStatus?reviewStatuses:[]);
  useEffect(()=>{
    const refresh=(event:Event)=>{
      const change=(event as CustomEvent<ReviewStatusChange>).detail;
      if(change?.entity_type==='passive') setSelected(row=>row?.key===change.entity_id?{...row,support:change.support}:row);
    };
    window.addEventListener(REVIEW_STATUS_CHANGED,refresh);
    return()=>window.removeEventListener(REVIEW_STATUS_CHANGED,refresh);
  },[]);
  return <section className="passive-library">
    {showReviewStatus && !catalog.error && <LibraryReviewStatusSummary entities={allRows} loading={catalog.loading} />}
    <h2>Переключаемые пассивы</h2>
    <p>Оформление настроек боя. Изменение карточки не меняет правила её срабатывания.</p>
    {catalog.error && <p role="alert">{catalog.error} <button onClick={()=>void loadPassiveCatalog(true)}>Повторить</button></p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">{rows.map(row=><article key={row.key} className={displayMode === 'row' ? 'library-review-row library-entity-row rounded-lg p-3 flex items-center gap-3' : 'rounded-lg border p-4 flex items-center gap-3'}>
      {displayMode === 'row' && <ReviewStatusCorner entity={row} entityType="passive" />}
      <SheetActionLine name={row.name} effectRef={passivePresentationEffect(row)} imageUrl={row.image_url || '/icons/resources/action.png'}
        variant={displayMode} iconShape="round" onActivate={()=>admin ? setSelected(row) : navigate(`/entity/passives/${encodeURIComponent(row.key)}`)}/>
      {displayMode === 'icon' && <div>{admin
        ? <button type="button" onClick={()=>setSelected(row)}>{row.name}</button>
        : <Link to={`/entity/passives/${encodeURIComponent(row.key)}`}>{row.name}</Link>}</div>}
    </article>)}</div>
    {!rows.length && <p>{catalog.loading ? 'Загрузка оформления…' : 'Пассивы не найдены.'}</p>}
    {selected && <LibraryQuickDetail entity={{...selected,type:'passive',id:selected.key}} name={selected.name} pageTo={`/entity/passives/${encodeURIComponent(selected.key)}`} editTo={`/passive-creator?edit=${encodeURIComponent(selected.key)}`} onClose={()=>setSelected(null)}><EffectPreview effect={passivePresentationEffect(selected)} reviewEntityType="passive" disableHover /></LibraryQuickDetail>}
  </section>;
}
