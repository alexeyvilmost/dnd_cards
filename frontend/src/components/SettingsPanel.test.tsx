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
  it('shows one scrolling panel with section links and preserves independent saved choices',async()=>{
    expect(container.querySelectorAll('.settings-panel__section')).toHaveLength(7);
    await click('Показ бросков в бою');
    expect(container.querySelectorAll('select')).toHaveLength(2);
    await act(async()=>{const select=container.querySelectorAll('select')[1];select.value='skip';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await click('Отображение сущностей');
    expect(container.querySelectorAll('#settings-section-entities fieldset')).toHaveLength(4);
    await act(async()=>container.querySelectorAll<HTMLInputElement>('input[name="display-spells"]')[1].click());
    expect(getSettings().entityDisplay.spells).toBe('row');
    expect(getSettings().enemyCombatRollMode).toBe('skip');
    await click('Лист и редактирование');
    expect(container.querySelector('#settings-section-editing input')).not.toBeNull();
  });
  it('persists sound enablement without losing independent channel levels',async()=>{
    const before=getSettings();
    await click('Звук и музыка');
    expect(container.textContent).toContain('Включить звук');
    const enabled=()=>container.querySelector<HTMLInputElement>('#settings-section-audio input[type="checkbox"]')!;
    await act(async()=>enabled().click());
    expect(getSettings()).toEqual({...before,audioEnabled:false});
    expect([...container.querySelectorAll<HTMLInputElement>('#settings-section-audio input[type="range"]')].every(input=>input.disabled)).toBe(true);
    await act(async()=>root.unmount());
    root=createRoot(container);
    await act(async()=>root.render(<SettingsPanel initialPage="audio"/>));
    expect(enabled().checked).toBe(false);
    await act(async()=>enabled().click());
    expect(getSettings()).toEqual(before);
  });
  it('saves the coin-board choice across settings panel remounts',async()=>{
    const before=getSettings();
    await click('Бой и поле');
    expect(container.textContent).toContain('Монетки на поле');
    expect(container.textContent).toContain('Камера смотрит строго сверху');
    const combat3d=()=>container.querySelector<HTMLInputElement>('#settings-section-combat input[type="checkbox"]')!;
    expect(combat3d().checked).toBe(false);
    await act(async()=>combat3d().click());
    expect(getSettings()).toEqual({...before,combat3d:true});
    await act(async()=>root.unmount());
    root=createRoot(container);
    await act(async()=>root.render(<SettingsPanel initialPage="combat"/>));
    expect(combat3d().checked).toBe(true);
  });
});
