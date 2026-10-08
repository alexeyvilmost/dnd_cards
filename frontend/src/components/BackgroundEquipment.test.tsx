// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {PinModeProvider} from '../hooks/usePinMode';
import BackgroundEquipment from './BackgroundEquipment';
vi.mock('../utils/cardsIndex',()=>({getCardsIndex:async()=>new Map([['rope',{id:'rope',name:'Верёвка'}]])}));
vi.mock('../settings',()=>({useSiteSettings:()=>({itemPreview:'interface'})}));
vi.mock('./EntityRefPreview',()=>({default:()=> <div>Подробности верёвки</div>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('pins equipment previews through the shared portal and omits the duplicate heading',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<PinModeProvider><BackgroundEquipment hideHeading selectable options={{option_a:{items:[{card_id:'rope',quantity:1}],gold:0},option_b:{items:[],gold:50}}}/></PinModeProvider>));
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyT',key:'t'})));
 await act(async()=>host.querySelector<HTMLElement>('.bgeq-item')!.focus());
 expect(document.querySelector('.entity-preview-enter')?.parentElement).toBe(document.body);
 await act(async()=>host.querySelector<HTMLButtonElement>('.bgeq-variant')!.focus());
 expect(document.querySelector('.entity-preview-enter')?.textContent).toContain('Подробности верёвки');
 expect(host.querySelector('.bgeq-title')).toBeNull();
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
 expect(document.querySelector('.entity-preview-enter')).toBeNull();
 await act(async()=>root.unmount());host.remove();
});
