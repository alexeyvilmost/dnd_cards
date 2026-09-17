import type {Card} from '../types';
import type {RuntimeState} from '../mvp/contracts';
import {containerWeight} from '../character/inventory';
import EntityDetailShell from './EntityDetailShell';
import SheetActionLine from './SheetActionLine';
import './ContainerInventoryDialog.css';

export default function ContainerInventoryDialog({container,runtime,cards,busy,error,onClose,onTransfer,onOpenContainer}:{container:Card;runtime:RuntimeState;cards:Map<string,Card>;busy:boolean;error?:string|null;onClose:()=>void;onTransfer:(card:Card,direction:'in'|'out')=>void;onOpenContainer:(card:Card)=>void}){
 const contents=runtime.inventory.filter(r=>r.containerId===container.id);
 const available=runtime.inventory.filter(r=>!r.containerId&&r.cardId!==container.id&&cards.get(r.cardId)?.type!=='container');
 const render=(rows:typeof contents,direction:'in'|'out')=><div className={`container-items is-${direction}`}>{rows.map(row=>{const card=cards.get(row.cardId);if(!card)return <span key={row.cardId}>Загрузка предмета…</span>;return <div className="container-item" key={row.cardId}>
  <SheetActionLine name={card.name} imageUrl={card.image_url} itemRef={card} variant="icon" disabled={busy||row.qty<=0} onActivate={()=>{if(!busy&&row.qty>0){if(card.type==='container')onOpenContainer(card);else onTransfer(card,direction);}}}/>
  {row.qty!==0&&<span className="container-item-quantity" aria-label={`Количество: ${row.qty}`}>{row.qty}</span>}
 </div>})}</div>;
 return <EntityDetailShell title={container.name} labelledById="container-inventory-title" isOpen onClose={onClose} maxWidth={880}>
  <section className="container-inventory"><p>Внутри: {contents.reduce((n,r)=>n+r.qty,0)} шт. · Вес содержимого: {containerWeight(runtime,container.id,id=>cards.get(id)?.weight??0).toFixed(1)} фн</p>
   {error&&<p className="issues" role="alert">{error}</p>}
   <h3>Содержимое</h3>{contents.length?render(contents,'out'):<p className="forge-note">Контейнер пуст</p>}
   <h3>Положить из инвентаря</h3>{available.length?render(available,'in'):<p className="forge-note">Нет доступных вещей на верхнем уровне инвентаря.</p>}
  </section>
 </EntityDetailShell>;
}
