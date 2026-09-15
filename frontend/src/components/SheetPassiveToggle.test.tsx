// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import SheetPassiveToggle from './SheetPassiveToggle';
import SheetActionLine from './SheetActionLine';
import DecisionPolicyToggles from './DecisionPolicyToggles';
import {decisionPolicyToggles} from '../solo-combat/decisionPolicies';
import type {PassiveEffect} from '../types';
vi.mock('./EffectPreview', () => ({default: ({effect,sourceLabel}: {effect: PassiveEffect; sourceLabel: string}) =>
  <article data-testid="effect-preview">{effect.name}|{sourceLabel}|{effect.description}|{effect.type}|{effect.detailed_description}</article>}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe('shared round passive toggles', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {host=document.createElement('div');document.body.append(host);root=createRoot(host);});
  afterEach(async () => {await act(async () => root.unmount());host.remove();});
  it('keeps the canonical effect preview, keyboard toggle semantics and state', async () => {
    const change=vi.fn();
    const toggle={id:'any-rule',name:'Пассив',description:'Подробная механика',imageUrl:'/parent.png',
      enabledDescription:'Без диалога',disabledDescription:'Показывать выбор'};
    await act(async () => root.render(<SheetPassiveToggle toggle={toggle} enabled onChange={change}/>));
    const button=host.querySelector('button')!;
    expect(button.classList.contains('cs-action-tile--round')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBeNull();
    expect(button.querySelector('.passive-orbit')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('img')?.getAttribute('src')).toBe('/parent.png');
    await act(async () => button.focus());
    expect(document.querySelector('[data-testid="effect-preview"]')?.textContent).toContain('Подробная механика|Включено|');
    expect(document.querySelector('[data-testid="effect-preview"]')?.textContent).toContain('Выключено: Показывать выбор');
    await act(async () => button.click());expect(change).toHaveBeenCalledWith('any-rule',false);
    await act(async () => root.render(<SheetPassiveToggle toggle={toggle} enabled={false} onChange={change}/>));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.classList.contains('is-selected')).toBe(false);
  });
  it('uses the parent image for a policy but leaves ordinary action tiles square', async () => {
    const toggles=decisionPolicyToggles('roll_influence');
    await act(async () => root.render(<><DecisionPolicyToggles toggles={toggles} preferences={{}} parent={{name:'Родитель',imageUrl:'/parent-source.png'}} onChange={()=>{}}/>
      <SheetActionLine name="Обычное действие" variant="icon" onActivate={()=>{}}/></>));
    const buttons=host.querySelectorAll('button');
    expect(buttons[0].querySelector('img')?.getAttribute('src')).toBe('/parent-source.png');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].classList.contains('cs-action-tile--round')).toBe(false);
    expect(buttons[1].querySelector('.passive-orbit')).toBeNull();
  });
});
