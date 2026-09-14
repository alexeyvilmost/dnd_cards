// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceDialogProvider, useDiceDialog, type DiceDecision } from '../contexts/DiceDialogContext';
import type { RollLog } from '../mvp/contracts';
import { setSetting } from '../settings';

vi.mock('../dice/Dice3DOverlay', () => ({default: () => null}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const committed:RollLog={kind:'check',dice:[{sides:20,result:1},{sides:4,result:3}],advantage:'none',modifiers:[{source:'Ловкость',value:5}],total:9,text:'к20: 1 + 3 + 5 = 9'};
const roll=vi.fn(()=>committed), done=vi.fn<(decision:DiceDecision)=>void>();
function Harness() {
  const dice=useDiceDialog();
  return <button onClick={()=>void dice.request([{sides:20,label:'Проверка'}],'Акробатика',undefined,{compactCheck:{kind:'check',roll}}).then(done)}>Проверка</button>;
}
describe('sheet compact check',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(async()=>{
    vi.useFakeTimers();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
    let stored:string|null=null;vi.stubGlobal('localStorage',{getItem:()=>stored,setItem:(_k:string,v:string)=>{stored=v;}});
    setSetting('combatRollMode','skip');setSetting('diceDialog',false);setSetting('dice3d',false);
    roll.mockClear();done.mockClear();container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root.render(<DiceDialogProvider><Harness/></DiceDialogProvider>));
    await act(async()=>container.querySelector('button')!.click());
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('waits for Throw even with skip settings, rolls once and returns the exact log',async()=>{
    expect(roll).not.toHaveBeenCalled();expect(document.querySelector('canvas')).toBeNull();
    await act(async()=>document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.click());
    expect(roll).toHaveBeenCalledOnce();expect(done).not.toHaveBeenCalled();
    await act(async()=>vi.advanceTimersByTime(1450));
    expect(document.body.textContent).toContain('Результат проверки');
    expect(document.body.textContent).not.toContain('Промах');
    expect(document.querySelector('.combat-critical-banner')).toBeNull();
    expect(document.querySelector('[aria-label="к4: 3"]')).not.toBeNull();
    await act(async()=>document.querySelector<HTMLButtonElement>('.combat-presentation-continue')!.click());
    expect(done).toHaveBeenCalledWith({mode:'manual',values:[1,3],roll:committed});
    expect(roll).toHaveBeenCalledOnce();
  });
  it('cancels before throwing without consuming randomness',async()=>{
    await act(async()=>document.querySelector<HTMLButtonElement>('.combat-presentation-settings')!.click());
    expect(roll).not.toHaveBeenCalled();expect(done).toHaveBeenCalledWith({mode:'cancel'});
  });
});
