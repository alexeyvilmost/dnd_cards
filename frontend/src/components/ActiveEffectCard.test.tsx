// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from '../api/client';
import type { ActiveEffectDisplayGroup } from '../engine/effects';
import ActiveEffectCard from './ActiveEffectCard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ActiveEffectCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
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
      root.render(<ActiveEffectCard group={group} />);
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith('effect:bardic');
    expect(container.querySelector<HTMLImageElement>('img')?.src).toContain('/bardic.png');
    expect(container.textContent).toContain('Источник: Бард');
  });
});
