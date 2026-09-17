// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import HealingPulse from './HealingPulse';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('animates only a new HP gain, clears after damage and respects identity changes',async()=>{
 vi.useFakeTimers();const el=document.createElement('div'),root=createRoot(el);const render=(id:string,hp:number)=>act(()=>root.render(<HealingPulse id={id} hp={hp}/>));
 try{await render('a',5);expect(el.textContent).toBe('');await render('a',9);expect(el.textContent).toBe('+4');await render('a',7);expect(el.textContent).toBe('');await render('b',20);expect(el.textContent).toBe('');await render('b',22);expect(el.textContent).toBe('+2');await act(()=>vi.advanceTimersByTime(1700));expect(el.textContent).toBe('');}finally{await act(()=>root.unmount());vi.useRealTimers();}
});
