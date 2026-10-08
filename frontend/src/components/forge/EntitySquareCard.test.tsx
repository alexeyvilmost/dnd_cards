// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import EntitySquareCard from './EntitySquareCard';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('opens a canonical preview outside the transformed card grid, including unavailable cards',async()=>{
  const host=document.createElement('div');host.style.transform='translateY(8px)';document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<EntitySquareCard name="Вид" disabled disabledReason="Недоступен" preview={<div>Подробности вида</div>}/>));
  await act(async()=>host.querySelector('button')!.focus());
  const preview=document.querySelector<HTMLElement>('.entity-preview-enter')!;
  expect(preview.parentElement).toBe(document.body);expect(preview.style.position).toBe('fixed');expect(preview.style.zIndex).toBe('9999');expect(preview.textContent).toContain('Подробности вида');
  expect(host.querySelector('.entity-preview-enter')).toBeNull();
  await act(async()=>root.unmount());host.remove();
});
