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

  it('shows Stonecunning scope and limitations in the mounted combat drawer', () => {
    const effects: ActiveEffectEntry[] = [{
      id: 'stonecunning', name: 'Камнечувствие', source: 'Камнечувствие', roundsLeft: 100,
      mechanics: {
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        senseScope: {
          kind: 'stonework', sameSurfaceOnly: true,
          detectsAirborne: false, grantsSight: false,
        },
      },
    }];

    const html = renderToStaticMarkup(createElement(CombatActiveEffects, { effects }));
    expect(html).toContain('Камнечувствие');
    expect(html).toContain('Чувство вибрации: 60 фт. (100 ходов)');
    expect(html).toContain('только по той же каменной поверхности');
    expect(html).toContain('не обнаруживает существ в воздухе');
    expect(html).toContain('не даёт видеть');
  });
});
