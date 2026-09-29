import type {ActionCostPolicyDecisionRequest} from '../rules-core/domain';
import type {Card,PassiveEffect} from '../types';
import {useSiteSettings} from '../settings';
import {useEntityRef} from './EntityRefRegistry';
import SheetActionLine from './SheetActionLine';

type Option=ActionCostPolicyDecisionRequest['options'][number];
function SourceOption({option,disabled,onChoose}:{option:Option&{sourceEntity:NonNullable<Option['sourceEntity']>};disabled:boolean;onChoose:()=>void}){
  const {entity}=useEntityRef(option.sourceEntity.type,option.sourceEntity.id);
  const settings=useSiteSettings();
  return <SheetActionLine name={option.label} imageUrl={entity?.image_url} disabled={disabled}
    itemRef={option.sourceEntity.type==='card'?entity as Card??undefined:undefined}
    effectRef={option.sourceEntity.type==='effect'?entity as PassiveEffect??undefined:undefined}
    variant={option.sourceEntity.type==='card'?settings.entityDisplay.items:settings.entityDisplay.effects}
    onActivate={onChoose}/>;
}

export default function ActionCostPolicyChoices({request,disabled=false,onChoose}:{request:ActionCostPolicyDecisionRequest;disabled?:boolean;onChoose:(id:string|null)=>void}){
  return <section className="sheet-group" aria-label="Стоимость действия">
    <h3 className="sheet-h3">Выберите стоимость действия</h3>
    <p>Ресурсы будут потрачены при выполнении действия.</p>
    <div className="cs-action-tiles">{request.options.map(option=>option.sourceEntity
      ? <SourceOption key={option.policyId} option={{...option,sourceEntity:option.sourceEntity}} disabled={disabled} onChoose={()=>onChoose(option.policyId)}/>
      : <SheetActionLine key={option.policyId} name={option.label} disabled={disabled} onActivate={()=>onChoose(option.policyId)}/>)}</div>
    <button className="forge-btn ghost" type="button" disabled={disabled} onClick={()=>onChoose(null)}>Обычная стоимость</button>
  </section>;
}
