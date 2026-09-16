import {useState} from 'react';
import type {Card} from '../types';
import EntityDetailShell from './EntityDetailShell';
import ItemPreview from './ItemPreview';
import CardPreview from './CardPreview';
import {useSiteSettings} from '../settings';
import './ContainerInventoryDialog.css';
export default function QuantityTransferDialog({card,max,from,to,busy,error,onConfirm,onClose}:{card:Card;max:number;from:string;to:string;busy:boolean;error?:string|null;onConfirm:(quantity:number)=>void;onClose:()=>void}){
 const [quantity,setQuantity]=useState(1);const {itemPreview}=useSiteSettings();
 const valid=Number.isInteger(quantity)&&quantity>=1&&quantity<=max;
 return <EntityDetailShell title="Переместить предметы" labelledById="transfer-quantity-title" isOpen onClose={()=>{if(!busy)onClose()}} preview={itemPreview==='interface'?<ItemPreview card={card} disableHover/>:<CardPreview card={card} disableHover/>}>
  <div className="quantity-transfer"><p>{from} → {to}</p><label>Количество<input aria-label="Количество для переноса" type="number" min={1} max={max} step={1} value={quantity||''} disabled={busy} onChange={e=>setQuantity(Number(e.target.value))}/></label>
   <input type="range" aria-label="Выбрать количество ползунком" min={1} max={Math.max(1,max)} step={1} value={Math.max(1,Math.min(max,quantity))} disabled={busy||max<1} onChange={e=>setQuantity(Number(e.target.value))}/>
   <p>Переместить: <strong>{quantity}</strong> · Оставить: <strong>{Math.max(0,max-quantity)}</strong></p>
   <div className="quantity-transfer-actions"><button className="forge-btn ghost" disabled={busy||max<1} onClick={()=>setQuantity(max)}>Все ({max})</button><button className="forge-btn" disabled={busy||!valid} onClick={()=>onConfirm(quantity)}>{busy?'Сохранение…':'Переместить'}</button><button className="forge-btn ghost" disabled={busy} onClick={onClose}>Отмена</button></div>
   {error&&<p role="alert">{error}</p>}
  </div>
 </EntityDetailShell>;
}
