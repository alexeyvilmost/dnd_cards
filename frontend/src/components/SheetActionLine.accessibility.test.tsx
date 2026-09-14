// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import SheetActionLine from './SheetActionLine';
import type {Card,Action} from '../types';
vi.mock('../utils/resources',async importOriginal=>({...await importOriginal<typeof import('../utils/resources')>(),useResourceOptions:()=>[]}));
vi.mock('../utils/mastery',()=>({useMasteryEffects:()=>[],findMastery:()=>undefined}));
vi.mock('../hooks/usePinMode',()=>({usePinMode:()=>({pinModeActive:false})}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('character action readability',()=>{
 it('shows item previews and updates remaining ability uses even on disabled tiles',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const item={id:'potion',name:'Зелье лечения',type:'potion',description:'Восстанавливает здоровье'} as Card;
  const ability={id:'breath',card_number:'ACT-breath',name:'Дыхание дракона',description:'Огненный конус',mechanics:{activation:{cost:[{resource:'action'},{resource:'self_uses'}]}}} as unknown as Action;
  try {
   await act(async()=>root.render(<SheetActionLine name={item.name} itemRef={item} variant="icon" disabled onActivate={()=>{}}/>));
   await act(async()=>host.querySelector('button')!.focus());
   expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('Восстанавливает здоровье');
   await act(async()=>root.render(<SheetActionLine name={ability.name} actionRef={ability} variant="icon" runtime={{resources:{'uses_ACT-breath':1},maxResources:{'uses_ACT-breath':2}}} onActivate={()=>{}}/>));
   expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('осталось 1 из 2');
   const usage=document.querySelector('.sp-usage')!;
   expect(usage).not.toBeNull();
   expect(usage.nextElementSibling?.classList.contains('sp-costbar')).toBe(true);
   await act(async()=>root.render(<SheetActionLine name={ability.name} actionRef={ability} variant="icon" disabled runtime={{resources:{'uses_ACT-breath':0},maxResources:{'uses_ACT-breath':2}}} onActivate={()=>{}}/>));
   expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('Израсходовано: 2');
  } finally {await act(async()=>root.unmount());host.remove();}
 });
 it('explains disabled actions inline and supports keyboard inspection without activating',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const action=vi.fn();
  try {
   await act(async()=>root.render(<SheetActionLine name="Атака" description="Удар оружием" detail="Действие" disabled disabledTitle="Действие уже потрачено" onActivate={action}/>));
   expect(host.querySelector('.cs-action-inline-reason')?.textContent).toBe('Действие уже потрачено');
   await act(async()=>host.querySelector('button')!.focus());
   expect(document.querySelector('.forge-effect-popover')?.textContent).toContain('Удар оружием');
   await act(async()=>host.querySelector('button')!.click());
   expect(action).not.toHaveBeenCalled();
  }finally{await act(async()=>root.unmount());host.remove();}
 });
});
