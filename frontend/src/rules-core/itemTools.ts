import type {ActionWorldInput,RuleActionDefinition,UncommittedRuleEvent,WorldState} from './domain';
import type {WorldObjectMutationEvent,WorldObjectState} from './worldObjects';
type Dict=Record<string,unknown>;
type UncommittedDomainEvent=Omit<UncommittedRuleEvent,'ordinal'>;
const object=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);
export interface ItemToolPolicy {
  operation:'unlock'|'lock'|'map'|'forge_text'|'forge_seal'|'anchor'|'jam'|'attach_rope'|'dig'|'force_open'|'inspect'|'ignite'|'portable_open'|'portable_close'|'portable_enter'|'portable_exit'|'portable_store'|'portable_retrieve'|'key_bind'|'key_unlock';
  ignition?:'easy'|'slow';
  item_card_id?:string;
  diameter_ft?:number;
  depth_ft?:number;
  exit_distance_ft?:number;
  granted_action_refs?:string[];
  entry_action_ref?:string;
  exit_action_ref?:string;
  max_words?:number;
  cube_side_ft?:number;
  duration_seconds?:number;
  check_from_object?:boolean;
  lock_dc?:number;
  lock_disadvantage?:boolean;
  max_load_lb?:number;
  key_item_card_id?:string;
}
export interface ObjectToolState {
  locked?:boolean;
  lockDc?:number;
  checkDc?:number;
  observations?:{sourceActorId:string;text:string}[];
  lockDisadvantage?:boolean;
  anchor?:{sourceActorId:string;sourceActionId:string;maxLoadLb?:number};
  jammed?:boolean;
  ropeAttached?:boolean;
  document?:{kind:'map'|'forged_text'|'forged_seal';text:string;sourceActorId:string};
  excavation?:{cubeSideFt:number;workSeconds:number};
  keyBinding?:{itemCardId:string;ownerActorId:string;used:boolean};
}
const operations=['unlock','lock','map','forge_text','forge_seal','anchor','jam','attach_rope','dig','force_open','inspect','ignite','portable_open','portable_close','portable_enter','portable_exit','portable_store','portable_retrieve','key_bind','key_unlock'];
export function parseItemTool(mechanics:Dict):ItemToolPolicy {
  const primitive=mechanics.primitive;
  if(!object(primitive)||primitive.type!=='item_tool'||!object(primitive.policy))throw Error('Invalid item tool declaration');
  const raw=primitive.policy;
  if(Object.keys(raw).some(key=>!['operation','ignition','item_card_id','diameter_ft','depth_ft','exit_distance_ft','granted_action_refs','entry_action_ref','exit_action_ref','max_words','cube_side_ft','duration_seconds','check_from_object','lock_dc','lock_disadvantage','max_load_lb','key_item_card_id'].includes(key))
    ||!operations.includes(String(raw.operation)))throw Error('Invalid item tool operation');
  for(const key of ['max_words','cube_side_ft','duration_seconds','lock_dc','max_load_lb'])if(raw[key]!==undefined&&(!Number.isSafeInteger(raw[key])||Number(raw[key])<=0))throw Error(`Invalid item_tool.${key}`);
  for(const key of ['check_from_object','lock_disadvantage'])if(raw[key]!==undefined&&typeof raw[key]!=='boolean')throw Error(`Invalid item_tool.${key}`);
  if(raw.operation==='forge_text'&&raw.max_words===undefined)throw Error('A forgery requires its word limit');
  if(raw.operation==='dig'&&(raw.cube_side_ft===undefined||raw.duration_seconds===undefined))throw Error('Excavation requires dimensions and work time');
  if(raw.operation==='ignite'&&(!['easy','slow'].includes(String(raw.ignition))||(raw.ignition==='slow'?raw.duration_seconds!==60:raw.duration_seconds!==undefined)))throw Error('Ignition requires easy action or 60-second slow work');
  if(raw.max_load_lb!==undefined&&!['anchor','attach_rope'].includes(String(raw.operation)))throw Error('Load limit belongs to an anchor or rope attachment');
  if(String(raw.operation).startsWith('key_')&&(typeof raw.key_item_card_id!=='string'||!raw.key_item_card_id.trim()))throw Error('Key action requires its item identity');
  if(String(raw.operation).startsWith('portable_')){
    if(typeof raw.item_card_id!=='string'||!raw.item_card_id.trim())throw Error('Portable space needs a stable item source');
    if(raw.operation==='portable_open'&&(!Number.isFinite(raw.diameter_ft)||Number(raw.diameter_ft)<=0
      ||!Number.isFinite(raw.depth_ft)||Number(raw.depth_ft)<=0||!Number.isFinite(raw.exit_distance_ft)||Number(raw.exit_distance_ft)<=0
      ||!Array.isArray(raw.granted_action_refs)||!raw.granted_action_refs.length
      ||raw.granted_action_refs.some((ref:unknown)=>typeof ref!=='string'||!ref.trim())
      ||typeof raw.entry_action_ref!=='string'||!raw.granted_action_refs.includes(raw.entry_action_ref)
      ||typeof raw.exit_action_ref!=='string'||!raw.granted_action_refs.includes(raw.exit_action_ref)
      ||new Set(raw.granted_action_refs).size!==raw.granted_action_refs.length))throw Error('Portable-space dimensions and actions must be declared');
  }
  return raw as unknown as ItemToolPolicy;
}
export function objectToolStateIssue(value:unknown):string|null {
  if(value===undefined)return null;
  if(!object(value)||Object.keys(value).some(key=>!['locked','lockDc','checkDc','observations','lockDisadvantage','anchor','jammed','ropeAttached','document','excavation','keyBinding'].includes(key)))return 'Invalid object tool state';
  if(value.checkDc!==undefined&&(!Number.isSafeInteger(value.checkDc)||Number(value.checkDc)<=0))return 'Invalid object check difficulty';
  if(value.observations!==undefined&&(!Array.isArray(value.observations)||!value.observations.every(row=>object(row)&&typeof row.sourceActorId==='string'&&typeof row.text==='string')))return 'Invalid observations';
  if(value.lockDc!==undefined&&(!Number.isSafeInteger(value.lockDc)||Number(value.lockDc)<=0))return 'Invalid lock difficulty';
  if(value.lockDisadvantage!==undefined&&typeof value.lockDisadvantage!=='boolean')return 'Invalid lock disadvantage';
  for(const key of ['locked','jammed','ropeAttached'])if(value[key]!==undefined&&typeof value[key]!=='boolean')return `Invalid object ${key}`;
  if(value.anchor!==undefined&&(!object(value.anchor)||typeof value.anchor.sourceActorId!=='string'||typeof value.anchor.sourceActionId!=='string'||value.anchor.maxLoadLb!==undefined&&(!Number.isSafeInteger(value.anchor.maxLoadLb)||Number(value.anchor.maxLoadLb)<=0)))return 'Invalid object anchor';
  if(value.document!==undefined&&(!object(value.document)||!['map','forged_text','forged_seal'].includes(String(value.document.kind))||typeof value.document.text!=='string'||typeof value.document.sourceActorId!=='string'))return 'Invalid object document';
  if(value.excavation!==undefined&&(!object(value.excavation)||!Number.isFinite(value.excavation.cubeSideFt)||Number(value.excavation.cubeSideFt)<=0||!Number.isSafeInteger(value.excavation.workSeconds)||Number(value.excavation.workSeconds)<=0))return 'Invalid excavation';
  if(value.keyBinding!==undefined&&(!object(value.keyBinding)||typeof value.keyBinding.itemCardId!=='string'||!value.keyBinding.itemCardId
    ||typeof value.keyBinding.ownerActorId!=='string'||!value.keyBinding.ownerActorId||typeof value.keyBinding.used!=='boolean'))return 'Invalid key binding';
  return null;
}

/** Binding is made from a catalog action plus validated scene facts. Callers
 * never submit the mutation, check DC, dimensions, or success themselves. */
export function bindItemTool(world:WorldState,action:RuleActionDefinition,input:ActionWorldInput|undefined,actorId?:string):RuleActionDefinition {
  const policy=parseItemTool(action.mechanics);
  if(input?.type!=='item_tool'||!world.objects[input.objectId])throw Error('Выберите объект для инструмента');
  const facts=input.facts,range=Number((action.mechanics.targeting as Dict|undefined)?.range_ft);
  if(!['scenario','board','gm_ruling'].includes(facts.factsSource)||!Number.isSafeInteger(facts.boardRevision)||facts.boardRevision<0
    ||!Number.isFinite(facts.distanceFt)||facts.distanceFt<0||!Number.isFinite(range)
    ||policy.operation!=='key_bind'&&(facts.distanceFt>range||facts.lineOfSight!==true))throw Error('Недостоверные положение или видимость объекта');
  if(typeof input.description!=='string')throw Error('Описание объекта должно быть текстом');
  if(['map','forge_text','forge_seal'].includes(policy.operation)&&!input.description.trim())throw Error('Опишите создаваемый документ');
  if(policy.max_words!==undefined&&input.description.trim().split(/\s+/u).filter(Boolean).length>policy.max_words)throw Error(`Допустимо не более ${policy.max_words} слов`);
  const target=world.objects[input.objectId];
  const declaredLimit=policy.max_load_lb??target.toolState?.anchor?.maxLoadLb;
  if(facts.loadLb!==undefined&&(!Number.isFinite(facts.loadLb)||facts.loadLb<0))throw Error('Недостоверная нагрузка на крепление');
  if(declaredLimit!==undefined&&facts.loadLb!==undefined&&facts.loadLb>declaredLimit)throw Error(`Нагрузка превышает предел ${declaredLimit} фунтов`);
  if(policy.operation==='unlock'&&target.toolState?.locked!==true)throw Error('Объект не заперт');
  if(policy.operation==='key_bind'){
    if(!actorId||target.toolState?.locked===undefined)throw Error('Выберите дверь, о которой думаете при первом взятии ключа');
    const existing=Object.values(world.objects).find(object=>object.toolState?.keyBinding?.itemCardId===policy.key_item_card_id);
    if(existing)throw Error('Ключ уже связан с выбранной дверью');
  }
  if(policy.operation==='key_unlock'){
    const binding=target.toolState?.keyBinding;
    if(!actorId||!binding||binding.itemCardId!==policy.key_item_card_id||binding.used
      ||target.toolState?.locked!==true)throw Error('Этим ключом можно открыть только связанную запертую дверь');
  }
  if(policy.operation==='lock'&&target.toolState?.locked===true)throw Error('Объект уже заперт');
  if(policy.operation==='ignite'&&(!target.flammable||target.ignited||policy.ignition==='easy'&&target.easyIgnition!==true))throw Error('Объект нельзя зажечь этим способом');
  if(policy.operation.startsWith('portable_')){
    if(target.itemCardId!==policy.item_card_id||!target.portableSpace)throw Error('Выберите физический экземпляр пространства');
    if(policy.operation==='portable_open'&&target.portableSpace.open)throw Error('Пространство уже открыто');
    if(policy.operation==='portable_close'&&!target.portableSpace.open)throw Error('Пространство уже закрыто');
    if(policy.operation==='portable_enter'&&(!target.portableSpace.open||!actorId||!world.actors[actorId]
      ||target.portableSpace.occupantActorIds.includes(actorId)
      ||(world.actors[actorId].planeId??'material')!==(target.planeId??'material')))throw Error('Войти можно только в открытую дыру на своей плоскости');
    if(policy.operation==='portable_exit'&&(!actorId||!target.portableSpace.occupantActorIds.includes(actorId)))throw Error('Существо не находится внутри');
    if(policy.operation==='portable_store'||policy.operation==='portable_retrieve'){
      const itemId=input.containedObjectId,item=itemId?world.objects[itemId]:undefined;
      if(!target.portableSpace.open||!item||item.kind!=='item'||item.id===target.id)throw Error('Выберите доступный физический предмет для открытой дыры');
      if(policy.operation==='portable_store'){
        if(item.containedByObjectId||item.portableSpace||item.carriedByActorId||item.heldByActorId
          ||(item.planeId??'material')!==(target.planeId??'material')
          ||!Number.isFinite(facts.containedObjectDistanceFt)||Number(facts.containedObjectDistanceFt)<0
          ||Number(facts.containedObjectDistanceFt)>range)throw Error('Объект должен быть свободен в пределах досягаемости дыры');
      }else if(item.containedByObjectId!==target.id||!target.portableSpace.containedObjectIds.includes(item.id)){
        throw Error('В выбранной дыре нет этого объекта');
      }
    }
  }
  const bind=(value:unknown):unknown=>Array.isArray(value)?value.map(bind):object(value)?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,
    value.kind==='world_interaction'&&value.operation==='item_tool'&&key==='parameters'
      ?{policy,objectId:input.objectId,containedObjectId:input.containedObjectId,description:input.description,actionId:action.id}:bind(child)])):value;
  const mechanics=bind(action.mechanics) as Dict;
  if(policy.check_from_object){
    const dc=policy.operation==='unlock'?target.toolState?.lockDc:target.toolState?.checkDc;
    if(!Number.isSafeInteger(dc)||Number(dc)<=0)throw Error('Для объекта не задана СЛ проверки');
    mechanics.effects=(mechanics.effects as Dict[]).map(effect=>effect.resolution==='ability_check'?{...effect,dc,
      ...(policy.operation==='unlock'&&target.toolState?.lockDisadvantage&&effect.skill==='sleight_of_hand'?{disadvantage:true}:{})}:effect);
  }
  return {...action,mechanics};
}

export function itemToolMutationEvents(world:WorldState,events:readonly UncommittedDomainEvent[]):UncommittedDomainEvent[] {
  const result:UncommittedDomainEvent[]=[];
  const changed=new Map<string,WorldObjectState>();
  for(const envelope of events){
    if(envelope.payload.type!=='EngineEventRecorded')continue;
    const event=envelope.payload.event;
    if(event.type!=='world_interaction'||event.operation!=='item_tool')continue;
    const p=event.parameters,objectId=String(p.objectId??''),target=changed.get(objectId)??world.objects[objectId];
    if(!target||typeof p.actionId!=='string'||typeof p.description!=='string')throw Error('Unbound item tool consequence');
    const policy=parseItemTool({primitive:{type:'item_tool',policy:p.policy}}),owner=envelope.sourceActorId;
    if(!owner||!world.actors[owner])throw Error('Unknown item tool owner');
    const state:ObjectToolState={...target.toolState};
    let portableSpace=target.portableSpace;
    let contentMutation:Extract<WorldObjectMutationEvent,{type:'WorldObjectsPatched'}>['patches'][number]|undefined;
    if(policy.operation.startsWith('portable_')){
      if(target.itemCardId!==policy.item_card_id||!portableSpace)throw Error('Unbound portable space');
      if(policy.operation==='portable_open')portableSpace={...portableSpace,open:true,diameterFt:policy.diameter_ft!,depthFt:policy.depth_ft!,exitDistanceFt:policy.exit_distance_ft!,entryActionRef:policy.entry_action_ref,exitActionRef:policy.exit_action_ref};
      if(policy.operation==='portable_close')portableSpace={...portableSpace,open:false};
      if(policy.operation==='portable_enter')portableSpace={...portableSpace,occupantActorIds:[...portableSpace.occupantActorIds,owner]};
      if(policy.operation==='portable_exit')portableSpace={...portableSpace,occupantActorIds:portableSpace.occupantActorIds.filter(id=>id!==owner)};
      if(policy.operation==='portable_store'||policy.operation==='portable_retrieve'){
        const containedId=String(p.containedObjectId??''),item=changed.get(containedId)??world.objects[containedId];
        if(!item||item.kind!=='item'||item.id===objectId||!portableSpace.open)throw Error('Unbound portable-space object');
        if(policy.operation==='portable_store'){
          if(item.containedByObjectId||item.carriedByActorId||item.heldByActorId
            ||(item.planeId??'material')!==(target.planeId??'material'))throw Error('Portable-space object is no longer available');
          portableSpace={...portableSpace,containedObjectIds:[...portableSpace.containedObjectIds,item.id]};
          contentMutation={objectId:item.id,patch:{containedByObjectId:objectId,planeId:`portable-space:${objectId}`,unattended:true}};
        }else{
          if(item.containedByObjectId!==objectId||!portableSpace.containedObjectIds.includes(item.id))throw Error('Portable-space object is no longer inside');
          portableSpace={...portableSpace,containedObjectIds:portableSpace.containedObjectIds.filter(id=>id!==item.id)};
          contentMutation={objectId:item.id,patch:{planeId:target.planeId??'material',unattended:true},unset:['containedByObjectId']};
        }
      }
    }
    switch(policy.operation){
      case 'unlock':state.locked=false;break;
      case 'key_bind':state.keyBinding={itemCardId:policy.key_item_card_id!,ownerActorId:owner,used:false};break;
      case 'key_unlock':state.locked=false;state.keyBinding={...state.keyBinding!,used:true};break;
      case 'lock':state.locked=true;if(policy.lock_dc!==undefined)state.lockDc=policy.lock_dc;if(policy.lock_disadvantage!==undefined)state.lockDisadvantage=policy.lock_disadvantage;break;
      case 'anchor':state.anchor={sourceActorId:owner,sourceActionId:p.actionId,...(policy.max_load_lb!==undefined?{maxLoadLb:policy.max_load_lb}:{})};break;
      case 'jam':state.jammed=true;break;
      case 'attach_rope':state.ropeAttached=true;break;
      case 'map':case 'forge_text':case 'forge_seal':state.document={kind:policy.operation==='map'?'map':policy.operation==='forge_text'?'forged_text':'forged_seal',text:p.description,sourceActorId:owner};break;
      case 'dig':state.excavation={cubeSideFt:policy.cube_side_ft!,workSeconds:policy.duration_seconds!};break;
      case 'force_open':state.locked=false;state.jammed=false;break;
      case 'inspect':state.observations=[...(state.observations??[]),{sourceActorId:owner,text:p.description}];break;
      case 'ignite':break;
    }
    const patch:Partial<WorldObjectState>={toolState:state,...(portableSpace?{portableSpace}:{}),...(policy.operation==='portable_open'?{grantedActionRefs:policy.granted_action_refs,grantsToOwner:true,ownerActorId:owner,unattended:true}:{}),...(policy.operation==='force_open'?{secured:false}:{}),...(policy.operation==='ignite'?{ignited:true}:{})};
    const mutation:WorldObjectMutationEvent=contentMutation
      ?{type:'WorldObjectsPatched',patches:[{objectId,patch},contentMutation],reason:`item_tool_${policy.operation}`}
      :{type:'WorldObjectPatched',objectId,patch,reason:`item_tool_${policy.operation}`};
    changed.set(objectId,{...target,...patch});
    if(contentMutation){
      const current=changed.get(contentMutation.objectId)??world.objects[contentMutation.objectId];
      const updated={...current,...contentMutation.patch};
      for(const key of contentMutation.unset??[])delete updated[key];
      changed.set(contentMutation.objectId,updated);
    }
    result.push({sourceActorId:owner,obligationIds:[...envelope.obligationIds,'system:item-tool'],payload:{type:'WorldObjectMutationRecorded',event:mutation}});
    if(policy.operation==='portable_enter'||policy.operation==='portable_exit')result.push({sourceActorId:owner,obligationIds:[...envelope.obligationIds,'system:item-tool'],payload:{type:'ActorPlaneChanged',actorId:owner,sourceObjectId:objectId,
      planeId:policy.operation==='portable_enter'?`portable-space:${objectId}`:(target.planeId??'material'),
      ...(policy.operation==='portable_exit'?{exitDistanceFt:portableSpace!.exitDistanceFt}:{})}});
  }
  return result;
}
export function itemToolWorkSeconds(events:readonly UncommittedDomainEvent[]):number {
  return events.reduce((sum,envelope)=>{
    if(envelope.payload.type!=='EngineEventRecorded')return sum;
    const event=envelope.payload.event;
    if(event.type!=='world_interaction'||event.operation!=='item_tool')return sum;
    return sum+(parseItemTool({primitive:{type:'item_tool',policy:event.parameters.policy}}).duration_seconds??0);
  },0);
}
