// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,it,expect,vi} from 'vitest';
import ShopCart from './ShopCart';
import type {Card} from '../types';
vi.mock('../settings',()=>({useSiteSettings:()=>({entityDisplay:{items:'icon'}})}));
vi.mock('./SheetActionLine',()=>({default:({name,onActivate}:{name:string;onActivate:()=>void})=><button onClick={onActivate}>{name}</button>}));
let root:Root;afterEach(async()=>{if(root)await act(async()=>root.unmount());document.body.replaceChildren()});
describe('floating cart',()=>{
 it('opens on click, shows canonical coin icons, buys, and restores focus on Escape',async()=>{
  const node=document.createElement('div');document.body.append(node);root=createRoot(node);const buy=vi.fn();
  await act(async()=>root.render(<ShopCart rows={[{id:'offer',card:{id:'arrow',name:'Стрела'} as Card,quantity:1,bundle:1,max:1000,priceCopper:5}]} busy={false} availableMoney={500} onQuantity={()=>{}} onRemove={()=>{}} onBuy={buy} onInspect={()=>{}}/>));
  expect(node.querySelector('[role="dialog"]')).toBeNull();
  const trigger=node.querySelector<HTMLButtonElement>('[aria-label="Открыть корзину"]')!;
  expect(node.querySelector('.shop-cart-badge')?.textContent).toBe('1');
  await act(async()=>trigger.click());
  expect(node.querySelector('[role="dialog"]')).not.toBeNull();
  expect(node.querySelector('[aria-label="4 зм 9 см 5 мм"]')).not.toBeNull();
  expect(node.textContent).not.toMatch(/\d\s*(?:зм|см|мм)/iu);
  expect([...node.querySelectorAll('img')].map(i=>i.getAttribute('src'))).toContain('/icons/currency/gold.png');
  await act(async()=>(node.querySelector('.shop-buy') as HTMLButtonElement).click());expect(buy).toHaveBeenCalledTimes(1);
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(node.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger);
 });
});
