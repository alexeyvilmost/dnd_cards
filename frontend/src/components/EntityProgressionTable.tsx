import {useEffect,useState} from 'react';
import type {Race,CharacterClass} from '../types';
import {useSiteSettings} from '../settings';
import {loadEntityProgression,visibleEntityProgression,type ProgressionRow} from '../character/entityProgression';
import {loadReferenceEntity,ReferenceItem} from './EntityReferences';
import {findResource,useResourceOptions} from '../utils/resources';
import HoverCard from './HoverCard';
import ResourcePreview from './ResourcePreview';
import type {ResourceDefinition} from '../types';
import {proficiencyBonusForLevel} from '../character/derive';
import {FormattedText} from '../utils/formattedText';
import {Link} from 'react-router-dom';

export default function EntityProgressionTable({kind,entity}:{kind:'races'|'classes';entity:Race|CharacterClass}) {
  const [rows,setRows]=useState<ProgressionRow[]|null>(null);
  const [error,setError]=useState('');const [revision,setRevision]=useState(0);
  const {hideTechnicalAbilities}=useSiteSettings();
  const [showTechnical,setShowTechnical]=useState(!hideTechnicalAbilities);
  const options=useResourceOptions();
  const visible=visibleEntityProgression(rows??[],showTechnical);
  useEffect(()=>{
    let live=true;setRows(null);setError('');
    loadEntityProgression(kind,entity,loadReferenceEntity).then(result=>{if(live)setRows(result);})
      .catch(reason=>{if(live)setError(reason instanceof Error?reason.message:'Не удалось загрузить развитие.');});
    return ()=>{live=false;};
  },[kind,entity,revision]);
  return <section className="entity-page__panel entity-progression" aria-label="Развитие по уровням">
    <h2>Развитие по уровням</h2>
    <p className="entity-progression__intro">Новые способности показаны на уровне получения. Ресурсы — общее число зарядов от этой сущности на указанном уровне. Выборы раскрываются в превью способности.</p>
    <label className="entity-progression__technical"><input type="checkbox" checked={showTechnical} onChange={event=>setShowTechnical(event.target.checked)}/> Показывать технические выдачи</label>
    {error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setRevision(n=>n+1)}>Повторить</button></div>:!rows?<p role="status">Загрузка способностей…</p>:
    !visible.rows.length?<p>Нет выдаваемых способностей или ресурсов для отображения.</p>:<div className="entity-progression__scroll" tabIndex={0} aria-label="Таблица уровней"><table>
      <thead><tr><th scope="col">Уровень</th>{kind==='classes'&&<th scope="col">Бонус мастерства</th>}{visible.abilities&&<th scope="col">Способности и эффекты</th>}{visible.actions&&<th scope="col">Действия и заклинания</th>}{visible.resources&&<th scope="col">Ресурсы и заряды</th>}</tr></thead>
      <tbody>{visible.rows.map(row=><tr key={row.level}><th scope="row">{row.level}</th>
        {kind==='classes'&&<td className="entity-progression__bonus">+{proficiencyBonusForLevel(row.level)}</td>}
        {(['abilities','actions'] as const).filter(group=>visible[group]).map(group=>{
          const features=row.features.filter(feature=>(group==='abilities'?['effect','feat']:['action','spell']).includes(feature.reference.entity_type)
            &&(showTechnical||!feature.entity?.is_technical));
          return <td key={group}>{features.length?<div className="entity-progression__entities">{features.map((feature,index)=><div key={`${feature.reference.entity_type}:${feature.reference.entity_id}:${index}`}>
            <ReferenceItem reference={feature.reference} compact/>{feature.note&&<small>{feature.note}</small>}
          </div>)}</div>:<span className="entity-progression__empty" aria-label="Нет новых способностей">—</span>}</td>;
        })}
        {visible.resources&&<td>{row.resources.length?<div className="entity-progression__resources">{row.resources.map((pool,index)=>{
          const resource=findResource(options,pool.id);
          const definition={id:resource?.entityId??pool.id,resource_id:pool.id,name:resource?.label??pool.source,image_url:resource?.imageUrl,description:resource?.description,recharge:resource?.recharge} as ResourceDefinition;
          return <HoverCard key={pool.id+':'+index} content={<ResourcePreview resource={definition} disableHover/>}><span className="entity-progression__resource">
            {resource?.imageUrl&&<img src={resource.imageUrl} alt=""/>}<span>{resource?.label??pool.source}<strong>{pool.amount}</strong></span>
          </span></HoverCard>;
        })}</div>:<span className="entity-progression__empty" aria-label="Нет ресурсов">—</span>}</td>}
      </tr>)}</tbody>
    </table></div>}
    {rows&&<div className="entity-progression__descriptions"><h3>Способности по уровням</h3>{rows.filter(row=>row.features.length>0).map(row=>{
      const features=row.features.filter(feature=>feature.entity&&(showTechnical||!feature.entity.is_technical));
      if(!features.length)return null;
      return <section key={row.level} className="entity-progression__level"><h4>{row.level}-й уровень</h4>
        {features.map((feature,index)=><article key={feature.reference.entity_id+':'+index}>
          <header><h5>{String(feature.entity?.name)}</h5><Link to={`/entity/${({effect:'effects',action:'actions',spell:'spells',feat:'feats'} as Record<string,string>)[feature.reference.entity_type]}/${feature.reference.entity_id}`}>Полная страница</Link></header>
          <div className="entity-page__prose"><FormattedText text={String(feature.entity?.description??'')} emptyText="Описание ещё не добавлено"/>
            {feature.entity?.detailed_description?<FormattedText text={String(feature.entity.detailed_description)}/>:null}</div>
        </article>)}
      </section>;
    })}</div>}
  </section>;
}
