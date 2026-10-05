// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from '../api/client';
import type { ActiveEffectDisplayGroup } from '../engine/effects';
import ActiveEffectCard from './ActiveEffectCard';
import {setEntityDisplay} from '../settings';
vi.mock('../utils/resources', async original => ({...await original<typeof import('../utils/resources')>(), useResourceOptions: () => []}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ActiveEffectCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    let stored: string | null = null;
    vi.stubGlobal('localStorage', {getItem: () => stored, setItem: (_key: string, value: string) => {stored = value;}});
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['Отравлен', 'Защита'])('uses the saved effect display setting for %s and updates in place', async name => {
    const group: ActiveEffectDisplayGroup = {key: name, name, source: 'Источник', duration: '1 раунд',
      instructions: ['Сохранённое описание'], effects: [{id: name, name, source: 'Источник', mechanics: {}}]};
    setEntityDisplay('effects', 'row');
    await act(async () => root.render(<ActiveEffectCard group={group}/>));
    expect(container.querySelector('.active-effect-card__summary')?.textContent).toContain(name);
    expect(container.querySelector('.active-effect-card--icon')).toBeNull();
    await act(async () => setEntityDisplay('effects', 'icon'));
    expect(container.querySelector('.active-effect-card__summary')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.getAttribute('aria-label')).toBe(name);
  });

  it('loads the exact library effect identity carried by runtime data', async () => {
    const request = vi.spyOn(effectsApi, 'getEffect').mockResolvedValue({
      id: 'effect:bardic', card_number: 'EFFECT-bardic-inspiration',
      name: 'Вдохновение барда', description: 'Данные библиотеки',
      rarity: 'common', effect_type: 'positive_effect', mechanics: { kind: 'boon' },
      image_url: '/bardic.png', created_at: '', updated_at: '',
    } as never);
    const group: ActiveEffectDisplayGroup = {
      key: 'bardic', name: 'Вдохновение барда', source: 'Бард', duration: '1 час',
      instructions: ['Используйте для броска.'],
      effects: [{
        id: 'runtime:1', name: 'Вдохновение барда', source: 'Бард', mechanics: { kind: 'boon' },
        entityRef: { kind: 'effect', id: 'effect:bardic', cardNumber: 'EFFECT-bardic-inspiration' },
      }],
    };
    await act(async () => {
      root.render(<ActiveEffectCard group={group} variant="row" />);
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith('effect:bardic');
    expect(container.querySelector<HTMLImageElement>('img')?.src).toContain('/bardic.png');
    expect(container.textContent).toContain('Источник: Бард');
  });

  it.each([
    {id: 'effect:burning', name: 'Горение', source: 'Огненная стрела', duration: '2 раунда'},
    {id: 'effect:ward', name: 'Защита', source: 'Союзник', duration: '1 минута'},
  ])('shows $name as a circular icon with canonical hover and runtime source/duration footer', async data => {
    const request = vi.spyOn(effectsApi, 'getEffect').mockResolvedValue({id: data.id, name: data.name,
      description: 'Каноничное описание из библиотеки', image_url: '/effect-token.png', mechanics: {},
      rarity: 'common', card_number: '', effect_type: 'positive_effect', created_at: '', updated_at: ''} as never);
    const group: ActiveEffectDisplayGroup = {key: data.id, name: data.name, source: data.source,
      duration: data.duration, instructions: [], effects: [{id: 'runtime:1', name: data.name, source: data.source,
        mechanics: {}, entityRef: {kind: 'effect', id: data.id, cardNumber: ''}}]};
    await act(async () => {root.render(<ActiveEffectCard group={group} variant="icon"/>); await Promise.resolve();});
    expect(request).toHaveBeenCalledWith(data.id);
    expect(container.querySelector('.active-effect-card--icon')).not.toBeNull();
    expect(container.querySelector('.active-effect-card__summary')).toBeNull();
    expect(container.textContent).not.toContain(data.source);
    const token = container.querySelector<HTMLElement>('[aria-label]')!;
    expect(token.getAttribute('aria-label')).toBe(data.name);
    await act(async () => token.focus());
    const preview = document.body.querySelector('.entity-preview-enter .sp-tip')!;
    expect(preview.textContent).toContain('Каноничное описание из библиотеки');
    expect(preview.querySelector('.active-effect-preview__footer')?.textContent).toContain(`Источник: ${data.source}`);
    expect(preview.querySelector('.active-effect-preview__footer')?.textContent).toContain(`Длительность: ${data.duration}`);
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('keeps effect controls available through the circular icon and uses its canonical preview', async () => {
    vi.spyOn(effectsApi, 'getEffect').mockResolvedValue({id: 'effect:boon', name: 'Дар',
      description: 'Полное описание', rarity: 'common', card_number: '', effect_type: 'positive_effect',
      created_at: '', updated_at: ''} as never);
    const use = vi.fn(), dismiss = vi.fn();
    const group: ActiveEffectDisplayGroup = {key: 'boon', name: 'Дар', source: 'Союзник', duration: '1 час',
      instructions: [], effects: [{id: 'runtime:boon', name: 'Дар', source: 'Союзник', mechanics: {},
        entityRef: {kind: 'effect', id: 'effect:boon', cardNumber: ''}}]};
    await act(async () => {root.render(<ActiveEffectCard group={group} actions={<>
      <button type="button" onClick={use}>Использовать</button>
      <button type="button" onClick={dismiss}>Снять</button>
    </>}/>); await Promise.resolve();});
    expect(container.querySelector('.active-effect-card__summary')).toBeNull();
    expect(container.textContent).not.toContain('Использовать');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Дар"]')!.click());
    const dialog = document.body.querySelector('[role="dialog"][aria-label="Дар"]')!;
    expect(dialog.textContent).toContain('Полное описание');
    expect(dialog.textContent).toContain('Длительность: 1 час');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => buttons.find(button => button.textContent === 'Использовать')!.click());
    await act(async () => buttons.find(button => button.textContent === 'Снять')!.click());
    expect(use).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
    await act(async () => buttons.find(button => button.textContent === 'Закрыть')!.click());
    expect(document.body.querySelector('[role="dialog"][aria-label="Дар"]')).toBeNull();
  });
});
