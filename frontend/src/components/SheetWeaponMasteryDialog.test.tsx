// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {ChoiceResolver} from '../character/components';
import type {PendingChoice} from '../mechanics/collectChoices';
vi.mock('../utils/weaponTypeCatalog',()=>({useWeaponTemplatesByType:()=>new Map(),weaponTypeGroups:()=>[{id:'simple',label:'Простое оружие',weapons:[{id:'dagger',label:'Кинжал',groupId:'simple',groupLabel:'Простое'},{id:'club',label:'Дубинка',groupId:'simple',groupLabel:'Простое'}]}]}));
vi.mock('../utils/mastery',()=>({useMasteryEffects:()=>[],findMastery:()=>undefined}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('opens the shared mastery dialog from one button and preserves unavailable-option rules',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const change=vi.fn();
 const choice:PendingChoice={id:'mastery',prompt:'Искусность',source:'weapon',count:1,grantKind:'weapon_mastery',origin:{kind:'class',id:'fighter',name:'Воин'}};
 try {
  await act(async()=>root.render(<ChoiceResolver choice={choice} value={[]} onChange={change} unavailableOptions={{club:'Нет владения'}}/>));
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('button')?.textContent).toBe('Выбрать');
  await act(async()=>host.querySelector('button')!.click());
  const dialog=document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-label')).toBe('Искусность оружия');
  const rows=Array.from(dialog.querySelectorAll<HTMLButtonElement>('button.sheet-item-row'));
  expect(rows).toHaveLength(2);expect(rows[1].getAttribute('aria-disabled')).toBe('true');
  await act(async()=>rows[1].click());expect(change).not.toHaveBeenCalled();
  await act(async()=>rows[0].click());expect(change).toHaveBeenCalledWith(['dagger']);
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
 } finally {await act(async()=>root.unmount());host.remove();}
});
