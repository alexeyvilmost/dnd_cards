import type {Card} from '../types';
import {useEffect,useRef,useState} from 'react';
import {ShoppingCart,X} from 'lucide-react';
import SheetActionLine from './SheetActionLine';
import {useSiteSettings} from '../settings';
import CoinAmount from './CoinAmount';
export interface CartRow {id:string;card?:Card;quantity:number;bundle:number;max:number;priceCopper:number}
export default function ShopCart({rows,busy,availableMoney,onQuantity,onRemove,onBuy,onInspect,canResume=false,message}:{rows:CartRow[];busy:boolean;availableMoney:number;onQuantity:(id:string,n:number)=>void;onRemove:(id:string)=>void;onBuy:()=>void;onInspect:(card:Card)=>void;canResume?:boolean;message?:string|null}){
 const settings=useSiteSettings();
 const [open,setOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);trigger.current?.focus()};
 useEffect(()=>{if(!open)return;closeButton.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus()}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[open]);
 const total=rows.reduce((sum,row)=>sum+row.priceCopper*row.quantity,0);
 const count=rows.reduce((sum,row)=>sum+row.quantity*row.bundle,0);
 const valid=rows.length>0&&rows.every(row=>row.card&&Number.isInteger(row.quantity)&&row.quantity>=1&&row.quantity<=row.max);
 const editingLocked=busy||canResume;
 return <div className="shop-cart-floating">
  <button ref={trigger} type="button" className="shop-cart-fab" aria-label={open?'Свернуть корзину':'Открыть корзину'} aria-description={`Предметов: ${count}`} aria-expanded={open} aria-controls="shop-cart-popup" aria-haspopup="dialog" onClick={()=>open?close():setOpen(true)}>
   <ShoppingCart size={26}/>{count>0&&<span className="shop-cart-badge" aria-hidden="true">{count>999?'999+':count}</span>}
  </button>
  {open&&<section id="shop-cart-popup" className="shop-cart" role="dialog" aria-label="Корзина">
  <header className="shop-cart-header"><h2>Корзина</h2><button ref={closeButton} type="button" onClick={close} aria-label="Закрыть корзину"><X size={20}/></button></header>
  <div className="shop-cart-items">
  {!rows.length?<p>Добавьте товары с полок и выберите количество.</p>:rows.map(row=><div className="shop-cart-row" key={row.id}>
   <div className="shop-cart-product">{row.card?<><SheetActionLine name={row.card.name} imageUrl={row.card.image_url} itemRef={row.card} variant={settings.entityDisplay.items} onActivate={()=>{setOpen(false);onInspect(row.card!)}}/>{settings.entityDisplay.items==='icon'&&<span>{row.card.name}</span>}</>:<span>Предложение больше недоступно</span>}{row.bundle>1&&<small>В пачке: {row.bundle} шт. · Всего: {row.bundle*row.quantity} шт.</small>}</div>
   <div className="shop-cart-quantity"><button disabled={editingLocked||row.quantity<=1} aria-label={`Уменьшить: ${row.card?.name??row.id}`} onClick={()=>onQuantity(row.id,row.quantity-1)}>−</button>
    <input type="number" min={1} max={row.max} step={1} disabled={editingLocked} aria-label={`Количество: ${row.card?.name??row.id}`} value={row.quantity||''} onChange={e=>onQuantity(row.id,Number(e.target.value))}/>
    <button disabled={editingLocked||row.quantity>=row.max} aria-label={`Увеличить: ${row.card?.name??row.id}`} onClick={()=>onQuantity(row.id,row.quantity+1)}>+</button>
   </div><CoinAmount copper={row.priceCopper*row.quantity}/><button disabled={editingLocked} onClick={()=>onRemove(row.id)} aria-label={`Убрать из корзины: ${row.card?.name??row.id}`}>Убрать</button>
   {row.quantity>row.max&&<small role="alert">Доступно: {row.max}</small>}
  </div>)}
  </div>
  <footer className="shop-cart-footer"><strong>Итого: <CoinAmount copper={total}/></strong><span>{canResume?'Результат прошлой покупки не подтверждён. Проверка не спишет монеты повторно.':availableMoney>=total?<>Останется: <CoinAmount copper={availableMoney-total}/></>:'Недостаточно монет'}</span><button className="shop-buy" disabled={busy||(!canResume&&(!valid||availableMoney<total))} onClick={onBuy}>{busy?'Покупка…':canResume?'Проверить покупку':'Купить'}</button>
   <small>Автоматический размен без комиссии.</small>
   {message&&<p role="status" className="shop-cart-message">{message}</p>}
  </footer>
 </section>}
 </div>;
}
