import { describe, it, expect } from 'vitest';
import { selectedChoicePayloads } from './expandChoices';

// #12 «Цветной шарик»: выбор стихии кладётся в нужное поле шаблона через value_into.

describe('value_into в apply-шаблоне выбора', () => {
  it('damage + value_into:type → выбранная стихия в поле type (директива не протекает)', () => {
    const choice = { apply: { kind: 'damage', dice: '1d6', value_into: 'type' }, options: { source: 'damage_type' } };
    expect(selectedChoicePayloads(choice, ['fire'])).toEqual([{ kind: 'damage', dice: '1d6', type: 'fire' }]);
  });

  it('без value_into значение по-прежнему идёт в value (обратная совместимость resistance)', () => {
    const choice = { grant: { kind: 'resistance' }, options: { source: 'damage_type' } };
    expect(selectedChoicePayloads(choice, ['cold'])).toEqual([{ kind: 'resistance', value: 'cold' }]);
  });

  it('несколько выборов — каждый в своё поле', () => {
    const choice = { apply: { kind: 'damage', dice: '2d8', value_into: 'type' }, options: { source: 'damage_type' } };
    expect(selectedChoicePayloads(choice, ['fire', 'cold'])).toEqual([
      { kind: 'damage', dice: '2d8', type: 'fire' },
      { kind: 'damage', dice: '2d8', type: 'cold' },
    ]);
  });

  it('явные items с grants (второй рецепт «шарика») работают как раньше', () => {
    const choice = { options: { source: 'explicit', items: [
      { id: 'fire', name: 'Огонь', grants: [{ kind: 'damage', dice: '1d6', type: 'fire' }] },
    ] } };
    expect(selectedChoicePayloads(choice, ['fire'])).toEqual([{ kind: 'damage', dice: '1d6', type: 'fire' }]);
  });
});
