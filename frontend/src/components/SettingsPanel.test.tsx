// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import SettingsPanel from './SettingsPanel';
import {getSettings} from '../settings';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('shared settings categories',()=>{
  let root:Root,container:HTMLDivElement;
  const click=async(text:string)=>act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!.click());
  beforeEach(async()=>{let stored:string|null=null;vi.stubGlobal('localStorage',{getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;}});container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<SettingsPanel/>));});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
  it('navigates subpages and preserves independent saved choices',async()=>{
    expect(container.querySelector('select')).toBeNull();
    await click('Бой и броски');await click('Показ бросков в бою');
    expect(container.querySelectorAll('select')).toHaveLength(2);
    await act(async()=>{const select=container.querySelectorAll('select')[1];select.value='skip';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await click('Все настройки');await click('Отображение');await click('Отображение сущностей');
    expect(container.querySelectorAll('fieldset')).toHaveLength(4);
    await act(async()=>container.querySelectorAll<HTMLInputElement>('input')[1].click());
    expect(getSettings().entityDisplay.spells).toBe('row');
    expect(getSettings().enemyCombatRollMode).toBe('skip');
    await click('Все настройки');await click('Лист персонажа');await click('Режим и редактирование');
    expect(container.querySelectorAll('input')).toHaveLength(2);
  });
});
