import { describe, it, expect } from 'vitest';
import { deserializeMechanics, reqRowsToRequirements, type ReqRow } from './blocks';

// S4: полный редактор requirements[] (все типы кроме level) — round-trip без потерь.

describe('reqRowsToRequirements', () => {
  it('ability_score пишет ability+min', () => {
    expect(reqRowsToRequirements([{ type: 'ability_score', ability: 'str', min: '13' }]))
      .toEqual([{ type: 'ability_score', ability: 'str', min: 13 }]);
  });

  it('прочие типы пишут value', () => {
    expect(reqRowsToRequirements([{ type: 'class', value: 'barbarian' }]))
      .toEqual([{ type: 'class', value: 'barbarian' }]);
  });

  it('пустой value не пишется', () => {
    expect(reqRowsToRequirements([{ type: 'feat' }])).toEqual([{ type: 'feat' }]);
  });

  it('строка без типа отбрасывается', () => {
    expect(reqRowsToRequirements([{ type: '' } as ReqRow])).toEqual([]);
  });
});

describe('deserialize requirements (не level)', () => {
  it('извлекает не-level требования в редактор, level — в minLevel', () => {
    const d = deserializeMechanics({
      activation: { mode: 'passive', requirements: [
        { type: 'level', min_level: 5 },
        { type: 'class', value: 'barbarian' },
        { type: 'ability_score', ability: 'str', min: 13 },
      ] },
      effects: [],
    });
    expect(d?.minLevel).toBe(5);
    expect(d?.requirements).toEqual([
      { type: 'class', value: 'barbarian' },
      { type: 'ability_score', ability: 'str', min: '13' },
    ]);
  });

  it('round-trip: reqRowsToRequirements восстанавливает то, что разобрали', () => {
    const original = [{ type: 'subclass', value: 'berserker' }, { type: 'ability_score', ability: 'con', min: 15 }];
    const d = deserializeMechanics({ activation: { mode: 'passive', requirements: original }, effects: [] });
    expect(reqRowsToRequirements(d!.requirements)).toEqual(original);
  });

  it('без requirements → пустой массив', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, effects: [] });
    expect(d?.requirements).toEqual([]);
  });
});
