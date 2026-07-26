import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CharacterFormulaProvider } from '../contexts/CharacterFormulaContext';
import type { Action } from '../types';
import { MobileEntityPreview } from './MobileEntityCard';

const actionWithCharacterFormula = {
  id: 'mobile-formula-action',
  name: 'Удар с переменной',
  description: 'Проверка мобильного превью.',
  rarity: 'common',
  card_number: 'TEST-MOBILE-FORMULA',
  resource: 'action',
  action_type: 'action',
  mechanics: {
    activation: { mode: 'active' },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'damage',
        formula: '1d8 + martial_arts_die + str',
        type: 'bludgeoning',
      }],
    }],
  },
} as unknown as Action;

describe('MobileEntityPreview formulas', () => {
  it('expands character variables and ability modifiers in the mobile sheet preview', () => {
    const html = renderToStaticMarkup(
      createElement(
        CharacterFormulaProvider,
        {
          value: {
            abilityMods: { str: 3 },
            variables: { martial_arts_die: { count: 1, sides: 6 } },
          },
          children: createElement(MobileEntityPreview, {
            view: { kind: 'action', entity: actionWithCharacterFormula },
          }),
        },
      ),
    );

    expect(html).toContain('1к8 + 1к6 + 3 [СИЛ]');
    expect(html).not.toContain('martial_arts_die');
  });
});
