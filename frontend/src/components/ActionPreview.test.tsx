import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CharacterFormulaProvider } from '../contexts/CharacterFormulaContext';
import type { Action } from '../types';
import ActionPreview from './ActionPreview';

const secondWind = {
  id: 'second-wind-preview',
  name: 'Второе дыхание',
  description: 'Восстановите хиты.',
  rarity: 'common',
  card_number: 'ACT-second-wind',
  action_type: 'bonus_action',
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'bonus_action' }, { resource: 'uses_ACT-second-wind' }],
    },
    uses: { count: 2, per: 'short_rest' },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'healing', amount: '1d10 + self_level' }],
    }],
  },
} as unknown as Action;

describe('ActionPreview contextual formulas and costs', () => {
  it('renders Second Wind with character values and human resource labels', () => {
    const html = renderToStaticMarkup(
      createElement(
        CharacterFormulaProvider,
        {
          value: { selfLevel: 1 },
          children: createElement(ActionPreview, { action: secondWind, resources: [] }),
        },
      ),
    );

    expect(html).toContain('1к10 + 1');
    expect(html).toContain('Заряд способности');
    expect(html).not.toMatch(/self_level|uses_ACT-second-wind/);
  });

  it('shows the equipped weapon identity, mode, properties, and resolved numbers', () => {
    const html = renderToStaticMarkup(createElement(ActionPreview, {
      action: secondWind,
      resources: [],
      weaponAttackPreview: {
        attack: 5,
        damages: [{ dice: '1d8', bonus: 3, type: 'slashing' }],
        weaponName: 'Длинный меч',
        mode: 'melee',
        reachFt: 5,
        properties: ['versatile'],
      },
    }));

    expect(html).toContain('Длинный меч');
    expect(html).toContain('досягаемость 5 фт');
    expect(html).toContain('versatile');
    expect(html).toContain('+5');
    expect(html).toContain('1к8 + 3');
  });
});
