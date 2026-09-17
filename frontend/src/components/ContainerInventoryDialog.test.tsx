// @vitest-environment jsdom
import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,it,expect,vi} from 'vitest';
import ContainerInventoryDialog from './ContainerInventoryDialog';
import type {Card} from '../types';
import type {RuntimeState} from '../mvp/contracts';
vi.mock('./EntityDetailShell',()=>({default:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock('./SheetActionLine',()=>({default:({name,variant,disabled,onActivate,itemRef}:{name:string;variant:string;disabled:boolean;onActivate:()=>void;itemRef:Card})=>
  <button aria-label={name} data-variant={variant} data-card={itemRef.id} disabled={disabled} onClick={onActivate}/>}));
let root:Root;
afterEach(async()=>{if(root)await act(async()=>root.unmount());document.body.replaceChildren();});
const container={id:'bag',name:'Сумка',type:'container'} as Card;
const a={id:'a',name:'Стрела',type:'weapon',weight:.1} as Card;
const b={id:'b',name:'Верёвка',type:'tool',weight:1} as Card;
const empty={id:'zero',name:'Пустая стопка',type:'tool'} as Card;
const runtime={inventory:[{cardId:'a',qty:20,containerId:'bag'},{cardId:'b',qty:1},{cardId:'zero',qty:0,containerId:'bag'}]} as RuntimeState;
async function render(busy=false,error?:string){
 const transfer=vi.fn(),node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async()=>root.render(<ContainerInventoryDialog container={container} runtime={runtime} cards={new Map([container,a,b,empty].map(c=>[c.id,c]))} busy={busy} error={error} onClose={()=>{}} onOpenContainer={()=>{}} onTransfer={transfer}/>));
 return {node,transfer};
}
describe('compact container inventory',()=>{
 it('shows only canonical item icons and nonzero quantity badges, clicking transfers either way',async()=>{
  const {node,transfer}=await render();
  expect(node.querySelectorAll('button')).toHaveLength(3);
  expect([...node.querySelectorAll('button')].every(b=>b.dataset.variant==='icon')).toBe(true);
  expect([...node.querySelectorAll('.container-item-quantity')].map(b=>b.textContent)).toEqual(['20','1']);
  expect(node.textContent).not.toContain('Выложить');expect(node.textContent).not.toContain('Верёвка');expect(node.textContent).not.toContain('Стрела');
  await act(async()=>node.querySelector<HTMLButtonElement>('[aria-label="Стрела"]')!.click());
  await act(async()=>node.querySelector<HTMLButtonElement>('[aria-label="Верёвка"]')!.click());
  expect(transfer.mock.calls).toEqual([[a,'out'],[b,'in']]);
  expect(node.querySelector<HTMLButtonElement>('[aria-label="Пустая стопка"]')!.disabled).toBe(true);
 });
 it('blocks transfer during saving/read-only and exposes save errors inside the container',async()=>{
  const {node,transfer}=await render(true,'Не удалось сохранить экипировку');
  for(const button of node.querySelectorAll<HTMLButtonElement>('button'))await act(async()=>button.click());
  expect(transfer).not.toHaveBeenCalled();expect(node.querySelector('[role="alert"]')?.textContent).toBe('Не удалось сохранить экипировку');
 });
});
