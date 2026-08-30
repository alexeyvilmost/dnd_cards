import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActiveEffectEntry } from '../mvp/contracts';
import { CombatActiveEffects } from './CombatCharacterSidebar';

describe('CombatActiveEffects', () => {
  it('shows an ally how to use Bardic Inspiration at the combat point of inspection', () => {
    const effects: ActiveEffectEntry[] = [{
      id: 'bardic-token',
      name: 'Талон 1к6 (Вдохновение барда)',
      source: 'Вдохновение барда',
      expiry: 'manual',
      mechanics: {
        kind: 'boon', die: '1d6',
        applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
      },
    }];

    const html = renderToStaticMarkup(createElement(CombatActiveEffects, { effects }));
    expect(html).toContain('Талон 1к6 (Вдохновение барда)');
    expect(html).toContain('Добавьте 1к6 к проверке характеристики, броску атаки или спасброску, затем снимите эффект.');
  });
});
