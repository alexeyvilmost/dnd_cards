import {useEffect,useMemo,useState} from 'react';
import {cardsApi} from '../api/client';
import type {Card} from '../types';
import type {ForgeCharacter} from '../character/types';
import {charactersV3Api} from '../character/api';
import type {RoguelikeRun} from '../roguelike/api';
import {roguelikeApi} from '../roguelike/api';
import {notifyRunUpdated,runCharacters} from '../roguelike/navigation';
import {itemSaleCopper} from '../roguelike/shopPresentation';
import {formatCopper} from '../utils/money';
import {useSiteSettings} from '../settings';
import {withoutLegacyRunSuffix} from '../character/familiarLabels';
import SheetActionLine from './SheetActionLine';
import ItemPreview from './ItemPreview';
import CardPreview from './CardPreview';
import {EntityDetailShell} from './EntityDetailShell';
import './RunShopInventory.css';

type PendingSale={commandId:string;revision:number;actorId:string;cardId:string;quantity:number};
export default function RunShopInventory({run,character,onUpdated,onCharacterUpdated,busy=false,onBusyChange}:{run?:RoguelikeRun;character?:ForgeCharacter;onUpdated?:(run:RoguelikeRun)=>void|Promise<void>;onCharacterUpdated?:(character:ForgeCharacter)=>void|Promise<void>;busy?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const settings=useSiteSettings(),members=run?runCharacters(run):character?[character]:[],storageKey=`boh:shop-sale:${run?.id??character?.id}`;
 const [actorId,setActorId]=useState(run?.character_id??character?.id),[cards,setCards]=useState<Card[]>([]),[selected,setSelected]=useState<Card|null>(null),[quantity,setQuantity]=useState(1);
 const [saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const [pending,setPending]=useState<PendingSale|null>(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');return value&&typeof value.commandId==='string'&&typeof value.actorId==='string'&&typeof value.cardId==='string'&&Number.isSafeInteger(value.revision)&&Number.isSafeInteger(value.quantity)&&value.quantity>0?value:null;}catch{return null;}});
 const actor=members.find(member=>member.id===actorId)??members[0];
 const owned=useMemo(()=>{
  const rows=new Map<string,number>();
  for(const row of actor?.inventory_items??[])rows.set(row.card_id,(rows.get(row.card_id)??0)+row.qty);
  for(const [slot,id]of Object.entries(actor?.equipment??{})){
   if(!id||slot==='off_hand'&&id===actor?.equipment?.main_hand)continue;
   rows.set(id,(rows.get(id)??0)+1);
  }
  return rows;
 },[actor]);
 const ids=[...owned.keys()].sort().join(',');
 useEffect(()=>{let active=true;setCards([]);setSelected(null);
  void Promise.all(ids?ids.split(',').map(id=>cardsApi.getCard(id)):[]).then(value=>{if(active)setCards(value);}).catch(()=>{if(active)setMessage('Не удалось загрузить предметы персонажа');});
  return()=>{active=false;};
 },[ids,actorId]);
 const disabled=busy||saving||!actor||Boolean(run&&(run.status!=='active'||run.phase!=='camp'));
 const blocked=(card:Card)=>actor?.inventory_items?.some(row=>row.container_id===card.id)?'Сначала освободите контейнер':itemSaleCopper(card)==null?'У предмета не указана допустимая стоимость':'';
 const sell=async()=>{
  if(disabled||!pending&&!selected)return;
  setSaving(true);onBusyChange?.(true);setMessage('');
  try{
   let operation=pending;
   if(!operation){const revision=run?(await roguelikeApi.get(run.id)).revision:(await charactersV3Api.get(actor.id)).runtime_revision??0;operation={commandId:crypto.randomUUID(),revision,actorId:actor.id,cardId:selected!.id,quantity};setPending(operation);try{localStorage.setItem(storageKey,JSON.stringify(operation));}catch{/* storage unavailable */}}
   if(run){await roguelikeApi.command(run.id,operation.revision,'sell',{actor_id:operation.actorId,card_id:operation.cardId,quantity:operation.quantity},operation.commandId);await onUpdated?.(await roguelikeApi.get(run.id));notifyRunUpdated();}
   else{const next=await charactersV3Api.sellItem(operation.actorId,{command_id:operation.commandId,expected_runtime_revision:operation.revision,card_id:operation.cardId,quantity:operation.quantity});await onCharacterUpdated?.(next);}
   setPending(null);try{localStorage.removeItem(storageKey);}catch{/* storage unavailable */}setSelected(null);setMessage(run?'Предметы проданы. Монеты добавлены в общий кошелёк.':'Предметы проданы. Монеты добавлены в кошелёк.');
  }catch(error){
   const status=(error as {status?:number;response?:{status?:number}})?.status??(error as {response?:{status?:number}})?.response?.status;
   if(status&&status>=400&&status<500&&![408,425,429].includes(status)){setPending(null);try{localStorage.removeItem(storageKey);}catch{/* storage unavailable */}}
   setMessage(error instanceof Error?error.message:'Не удалось продать предметы');
  }
  finally{setSaving(false);onBusyChange?.(false);}
 };
 const stock=selected?owned.get(selected.id)??0:0,amount=selected?itemSaleCopper(selected,quantity):null;
 return <section className="run-shop-inventory" aria-label="Продажа предметов персонажа">
  <header><div><h2>Продать предметы</h2><p>За половину стоимости, указанной на карточке предмета. Контейнер перед продажей нужно освободить.</p></div>
   {members.length>1&&<label>Персонаж<select aria-label="Продавец" value={actor.id} disabled={disabled||!!pending} onChange={event=>setActorId(event.target.value)}>{members.map(member=><option key={member.id} value={member.id}>{withoutLegacyRunSuffix(member.name)}</option>)}</select></label>}
  </header>
  {message&&<p role="status">{message}</p>}
  {pending&&<div className="run-shop-sale-pending"><p>Продажа ожидает подтверждения. Повторное сохранение не продаёт предметы второй раз.</p><button type="button" disabled={disabled} onClick={()=>void sell()}>Повторить продажу</button></div>}
  <div className="cs-action-tiles run-shop-owned-items">{cards.map(card=>{
   const reason=blocked(card),equipped=Object.values(actor.equipment??{}).includes(card.id),attuned=(actor.turn_state?.attuned_ids as string[]|undefined)?.includes(card.id);
   return <SheetActionLine key={card.id} itemRef={card} name={card.name} imageUrl={card.image_url} variant={settings.entityDisplay.items}
    disabled={disabled||!!pending||!!reason} detail={`${owned.get(card.id)} шт.${equipped?' · экипировано':''}${attuned?' · настроено':''} · ${reason||formatCopper(itemSaleCopper(card)??0)}`}
    onActivate={()=>{setSelected(card);setQuantity(1);setMessage('');}}/>;
  })}{!cards.length&&<p>Нет предметов для продажи.</p>}</div>
  {selected&&<EntityDetailShell isOpen title={`Продать: ${selected.name}`} preview={settings.itemPreview==='interface'?<ItemPreview card={selected} disableHover/>:<CardPreview card={selected} disableHover/>} onClose={()=>{if(!saving)setSelected(null);}}>
   <div className="run-shop-sale-confirm"><label>Количество<input aria-label="Количество для продажи" type="number" min={1} max={Math.min(stock,10000)} value={quantity} disabled={disabled||!!pending} onChange={event=>setQuantity(Number(event.target.value))}/></label>
    <strong>Получите: {amount==null?'—':formatCopper(amount)}</strong><p>Проданный надетый предмет снимается. После продажи последнего экземпляра его настройка прекращается.</p>
    <button type="button" disabled={disabled||!!pending||amount==null||!Number.isSafeInteger(quantity)||quantity<1||quantity>stock} onClick={()=>void sell()}>Продать</button></div>
  </EntityDetailShell>}
 </section>;
}
