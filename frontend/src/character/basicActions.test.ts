import { describe, expect, it } from 'vitest';
import { collectSheetActions } from './actionSheet';
import type { AssembledCharacter } from './assemble';
import type { Action } from '../types';

// Базовые действия — сущности Action (type='basic'), а не хардкод. Проверяем, что
// collectSheetActions строит группу basic ИЗ переданных сущностей (с actionRef для
// превью и текстом из данных), и что без сущностей группа пуста (хардкода не осталось).

const basicUnarmed = {
  id: 'act-unarmed',
  name: 'Безоружный удар',
  card_number: 'action_basic_unarmed',
  description: 'Атака кулаком, ногой, головой и т.п.',
  image_url: '/icons/actions/unarmed_strike.png',
  action_type: 'base_action',
  type: 'basic',
  mechanics: {
    name: 'Безоружный удар',
    activation: { cost: [{ resource: 'action' }], mode: 'active' },
    effects: [
      {
        ability: 'str',
        attack_kind: 'unarmed',
        resolution: 'attack_roll',
        vs: 'ac',
        on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
      },
    ],
    targeting: { filter: 'enemy', range: '5 feet', shape: 'single' },
  },
} as unknown as Action;

const emptyAssembled = { actions: [], effects: [], spells: [] } as unknown as AssembledCharacter;

describe('базовые действия как сущности (не хардкод)', () => {
  it('строит группу basic из переданных Action: actionRef + текст из данных сущности', () => {
    const out = collectSheetActions(emptyAssembled, [], [basicUnarmed]);
    const basic = out.filter((a) => a.group === 'basic');
    expect(basic).toHaveLength(1);
    expect(basic[0].name).toBe('Безоружный удар');
    // Превью берётся из данных сущности (actionRef), а не из зашитого текста.
    expect(basic[0].actionRef).toBe(basicUnarmed);
    expect(basic[0].description).toContain('кулак');
    expect(basic[0].imageUrl).toBe('/icons/actions/unarmed_strike.png');
    // Механика доехала до листа активной (иначе actionMechanics вернул бы null).
    expect((basic[0].mechanics.activation as { mode?: string }).mode).toBe('active');
  });

  it('без переданных сущностей группа basic пуста — хардкода STANDARD_ACTIONS больше нет', () => {
    const out = collectSheetActions(emptyAssembled, [], []);
    expect(out.filter((a) => a.group === 'basic')).toHaveLength(0);
  });
});
