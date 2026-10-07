// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import ForgeEntitySelection from './ForgeEntitySelection';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('collapses to the chosen entity, restores the grid, and does not clear the same selection',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const onSelect=vi.fn();
 const entities=[{id:'one',name:'Первый',description:'Художественное описание'},{id:'two',name:'Второй'}];
 const render=(selectedId?:string)=>root.render(<ForgeEntitySelection entities={entities} selectedId={selectedId} onSelect={onSelect} renderCard={(e,select)=><button type="button" className="forge-square-card" onClick={select}>{e.name}</button>}/>);
 await act(async()=>render());expect(host.querySelectorAll('button')).toHaveLength(2);
 await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(onSelect).toHaveBeenCalledExactlyOnceWith('one');
 await act(async()=>render('one'));expect(host.querySelector('.forge-selected-entity__story')?.textContent).toContain('Художественное описание');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Изменить: Первый"]')!.click());expect(host.querySelectorAll('.forge-square-card')).toHaveLength(2);
 await act(async()=>host.querySelector<HTMLButtonElement>('.forge-square-card')!.click());expect(onSelect).toHaveBeenCalledTimes(1);
 await act(async()=>root.unmount());host.remove();
});
