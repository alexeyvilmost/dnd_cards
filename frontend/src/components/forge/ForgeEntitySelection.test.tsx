// @vitest-environment jsdom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import ForgeEntitySelection from './ForgeEntitySelection';
import EntitySquareCard from './EntitySquareCard';
import {PinModeProvider} from '../../hooks/usePinMode';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('collapses to the chosen entity, restores the grid, and does not clear the same selection',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const onSelect=vi.fn();const onBeginChange=vi.fn();const onExpandedChange=vi.fn();
 const entities=[{id:'one',name:'Первый',description:'Художественное описание'},{id:'two',name:'Второй'}];
 const render=(selectedId?:string)=>root.render(<ForgeEntitySelection entities={entities} selectedId={selectedId} onSelect={onSelect} onBeginChange={onBeginChange} onExpandedChange={onExpandedChange} entityKind="races" renderCard={(e,select)=><button type="button" className="forge-square-card" onClick={select}>{e.name}</button>}/>);
 await act(async()=>render());expect(host.querySelectorAll('button')).toHaveLength(2);
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(onSelect).toHaveBeenCalledExactlyOnceWith('one');
 await act(async()=>render('one'));expect(host.querySelector('.forge-selected-entity__story')?.textContent).toContain('Художественное описание');
 expect(onExpandedChange).toHaveBeenLastCalledWith(false);
 expect(host.querySelector('a')?.getAttribute('href')).toBe('/entity/races/one');expect(host.querySelector('a')?.getAttribute('target')).toBe('_blank');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Изменить: Первый"]')!.click());expect(host.querySelectorAll('.forge-square-card')).toHaveLength(2);expect(onBeginChange).toHaveBeenCalledOnce();
 expect(onExpandedChange).toHaveBeenLastCalledWith(true);
 await act(async()=>host.querySelector<HTMLButtonElement>('.forge-square-card')!.click());expect(onSelect).toHaveBeenCalledTimes(1);
 expect(onExpandedChange).toHaveBeenLastCalledWith(false);
 await act(async()=>root.unmount());host.remove();
});
it('dismisses the old pinned preview when returning to the grid',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const entities=[{id:'one',name:'Первый'},{id:'two',name:'Второй'}];
 function Controlled(){const [id,setId]=useState<string|null>('one');return <PinModeProvider><ForgeEntitySelection entities={entities} selectedId={id} onSelect={setId} onBeginChange={()=>setId(null)} entityKind="backgrounds" renderCard={(entity,select)=><EntitySquareCard name={entity.name} onClick={select} preview={<div>Превью {entity.name}</div>}/>}/></PinModeProvider>}
 await act(async()=>root.render(<Controlled/>));
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyT',key:'t'})));
 await act(async()=>host.querySelector<HTMLButtonElement>('.forge-square-card')!.focus());
 expect(document.querySelector('.entity-preview-enter')?.textContent).toContain('Превью Первый');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Изменить: Первый"]')!.click());
 expect(document.querySelector('.entity-preview-enter')).toBeNull();expect(host.querySelectorAll('.forge-square-card')).toHaveLength(2);
 expect(document.activeElement).toBe(host.querySelector('.forge-selection-grid'));
 const trigger=host.querySelector('.forge-square-card')!.parentElement!;
 await act(async()=>trigger.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 expect(document.querySelector('.entity-preview-enter')).toBeNull();
 await act(async()=>window.dispatchEvent(new Event('pointermove')));
 await act(async()=>trigger.dispatchEvent(new MouseEvent('mousemove',{bubbles:true})));
 expect(document.querySelector('.entity-preview-enter')?.textContent).toContain('Превью Первый');
 await act(async()=>root.unmount());host.remove();
});
it('can clear the parent draft when changing and select the former entity again',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const onSelect=vi.fn();
 const entities=[{id:'one',name:'Первый'},{id:'two',name:'Второй'}];
 function Controlled(){const [id,setId]=useState<string|null>('one');return <><span data-current>{id??'Не выбран'}</span><ForgeEntitySelection entities={entities} selectedId={id} onSelect={value=>{onSelect(value);setId(value)}} onBeginChange={()=>setId(null)} renderCard={(entity,select)=><button className="forge-square-card" onClick={select}>{entity.name}</button>}/></>}
 await act(async()=>root.render(<Controlled/>));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Изменить: Первый"]')!.click());
 expect(host.querySelector('[data-current]')?.textContent).toBe('Не выбран');expect(host.querySelectorAll('.forge-square-card')).toHaveLength(2);
 await act(async()=>host.querySelector<HTMLButtonElement>('.forge-square-card')!.click());expect(onSelect).toHaveBeenCalledExactlyOnceWith('one');expect(host.querySelector('[data-current]')?.textContent).toBe('one');
 await act(async()=>root.unmount());host.remove();
});
