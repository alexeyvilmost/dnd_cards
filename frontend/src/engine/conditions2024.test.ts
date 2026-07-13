/**
 * Состояния PHB 2024 — доработки движка A/B/C/D/F:
 *  A — автопровал спасов СИЛ/ЛВК; B — автокрит рукопашной атакой; C — проекция по дальности
 *  (Распластан: рукопашные преим., дальнобойные помеха); D — запрет экономики хода; F — композиция.
 */
import { describe, expect, it } from 'vitest';
import { collectModifiers, deniedCapabilities } from './modifiers';
import { conditionModifierPayloads, expandConditionSet } from './conditions';
import { projectedAgainst } from './execute';
import { attackRangeFromEffect } from './weapon';
import type { CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';

const state = (...conds: string[]): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [],
  activeEffects: conds.map((value, i) => ({ id: `c${i}`, name: value, mechanics: { kind: 'condition', value } } as never)),
});
const target = (...conds: string[]): TargetContext => ({ ac: 10, runtimeState: state(...conds) });

describe('F — композиция состояний (includes)', () => {
  it('Парализован наследует механику Недееспособного (deny)', () => {
    const ops = conditionModifierPayloads('paralyzed');
    expect(ops.some((m) => m.op === 'deny' && m.applies_to.roll === 'action')).toBe(true);
  });
  it('expandConditionSet раскрывает под-состояния для предикатов', () => {
    expect(expandConditionSet(['unconscious']).has('incapacitated')).toBe(true);
    expect(expandConditionSet(['stunned']).has('incapacitated')).toBe(true);
  });
  it('нет бесконечной рекурсии при цикле', () => {
    expect(() => conditionModifierPayloads('paralyzed', new Set())).not.toThrow();
  });
});

describe('A — автопровал спасбросков СИЛ/ЛВК', () => {
  const autoFail = (cond: string, ability: string) =>
    collectModifiers(state(cond), [], { roll: 'saving_throw', filter: { ability } }).autoFail;
  it('Парализован/Ошеломлён/Без сознания — автопровал СИЛ и ЛВК', () => {
    for (const c of ['paralyzed', 'stunned', 'unconscious']) {
      expect(autoFail(c, 'str')).toBe(true);
      expect(autoFail(c, 'dex')).toBe(true);
    }
  });
  it('спасы прочих характеристик (ТЕЛ) — без автопровала', () => {
    expect(autoFail('paralyzed', 'con')).toBe(false);
  });
  it('Отравлен/Опутан не дают автопровала', () => {
    expect(autoFail('poisoned', 'dex')).toBe(false);
    expect(autoFail('restrained', 'dex')).toBe(false);
  });
});

describe('D — запрет экономики хода (Недееспособность)', () => {
  it('Недееспособен запрещает действие/бонусное/реакцию/концентрацию', () => {
    const denied = deniedCapabilities(state('incapacitated'));
    for (const cap of ['action', 'bonus_action', 'reaction', 'concentration']) expect(denied.has(cap)).toBe(true);
  });
  it('Парализован запрещает их же по композиции', () => {
    expect(deniedCapabilities(state('paralyzed')).has('action')).toBe(true);
  });
  it('Отравлен не запрещает действия', () => {
    expect(deniedCapabilities(state('poisoned')).size).toBe(0);
  });
});

describe('B/C — проекция состояний с дистанционным гейтом', () => {
  it('Парализован: рукопашная атака по нему — автокрит, дальнобойная — нет', () => {
    expect(projectedAgainst(target('paralyzed'), 'attack', 'melee').autoCrit).toBe(true);
    expect(projectedAgainst(target('paralyzed'), 'attack', 'ranged').autoCrit).toBe(false);
    // Преимущество атак по нему — плоское (обе дальности).
    expect(projectedAgainst(target('paralyzed'), 'attack', 'ranged').advantage).toBe('advantage');
  });
  it('Распластан: рукопашные атаки по нему — преимущество, дальнобойные — помеха', () => {
    expect(projectedAgainst(target('prone'), 'attack', 'melee').advantage).toBe('advantage');
    expect(projectedAgainst(target('prone'), 'attack', 'ranged').advantage).toBe('disadvantage');
  });
  it('неизвестная дальность — гейт закрыт (ни автокрита, ни проекции Распластан)', () => {
    expect(projectedAgainst(target('paralyzed'), 'attack', undefined).autoCrit).toBe(false);
    expect(projectedAgainst(target('prone'), 'attack', undefined).advantage).toBe('none');
  });
});

describe('attackRangeFromEffect — тип атаки', () => {
  const char: CharacterContext = { abilityMods: { str: 3, dex: 2, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5, equippedCards: [], knownCards: [] };
  it('безоружный удар — рукопашная', () => {
    expect(attackRangeFromEffect({ resolution: 'attack_roll', attack_kind: 'unarmed' }, 'main', char)).toBe('melee');
  });
  it('атака заклинанием (нет dice:weapon) — дальность неизвестна', () => {
    expect(attackRangeFromEffect({ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: '1d10' }] }, 'main', char)).toBeUndefined();
  });
  it('оружейная атака без оружия в руке — трактуется как рукопашная', () => {
    expect(attackRangeFromEffect({ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: 'weapon' }] }, 'main', char, {})).toBe('melee');
  });
});
