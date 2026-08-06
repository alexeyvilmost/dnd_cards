/**
 * Состояния PHB 2024 — доработки движка A/B/C/D/F:
 *  A — автопровал спасов СИЛ/ЛВК; B — автокрит атакой в пределах 5 футов; C — проекция
 *  по явной дистанции (Распластан: ≤5 футов преим., >5 футов помеха); D — запреты; F — композиция.
 */
import { describe, expect, it } from 'vitest';
import { collectModifiers, conditionCapabilityDenied, deniedCapabilities } from './modifiers';
import { conditionModifierPayloads, expandConditionSet, conditionLeaves } from './conditions';
import { projectedAgainst } from './execute';
import { attackRangeFromEffect } from './weapon';
import type { CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';

const state = (...conds: string[]): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [],
  activeEffects: conds.map((value, i) => ({ id: `c${i}`, name: value, mechanics: { kind: 'condition', value } } as never)),
});
const target = (...conds: string[]): TargetContext => ({ id: 'target', ac: 10, runtimeState: state(...conds) });
const projectionAt = (condition: string, distanceFt?: number) => projectedAgainst(
  target(condition),
  'attack',
  undefined,
  {
    rollerActorId: 'attacker',
    rollTargetActorId: 'target',
    ...(distanceFt == null ? {} : {
      distancesFt: { attacker: { target: distanceFt } },
    }),
  },
);

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
  it('Без сознания = Опрокинут + Недееспособен, но НЕ Парализован', () => {
    const set = expandConditionSet(['unconscious']);
    for (const c of ['prone', 'incapacitated']) expect(set.has(c)).toBe(true);
    expect(set.has('paralyzed')).toBe(false);
  });
  it('Без сознания объявляет собственные автопровал и скорость 0', () => {
    expect(collectModifiers(state('unconscious'), [], { roll: 'saving_throw', filter: { ability: 'str' } }).autoFail).toBe(true);
    expect(conditionModifierPayloads('unconscious').some((m) => m.applies_to.roll === 'speed' && m.op === 'set')).toBe(true);
  });
});

describe('Остаточные состояния при снятии (leaves)', () => {
  it('Без сознания оставляет Опрокинутого', () => {
    expect(conditionLeaves('unconscious')).toEqual(['prone']);
  });
  it('прочие состояния ничего не оставляют', () => {
    for (const c of ['paralyzed', 'stunned', 'prone', 'poisoned']) expect(conditionLeaves(c)).toEqual([]);
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
  it('Недееспособен запрещает речь отдельным общим capability-примитивом', () => {
    expect(conditionCapabilityDenied(state('incapacitated'), 'speech', {
      rollerActorId: 'subject',
    })).toBe(true);
  });
  it('Парализован запрещает их же по композиции', () => {
    expect(deniedCapabilities(state('paralyzed')).has('action')).toBe(true);
  });
  it('Отравлен не запрещает действия', () => {
    expect(deniedCapabilities(state('poisoned')).size).toBe(0);
  });
});

describe('B/C — проекция состояний с дистанционным гейтом', () => {
  it('Парализован: попадание в пределах 5 футов — автокрит, дальше — нет', () => {
    expect(projectionAt('paralyzed', 5).autoCrit).toBe(true);
    expect(projectionAt('paralyzed', 10).autoCrit).toBe(false);
    // Преимущество атак по нему не зависит от дистанции.
    expect(projectionAt('paralyzed', 10).advantage).toBe('advantage');
  });
  it('Распластан: атака в пределах 5 футов — преимущество, дальше — помеха', () => {
    expect(projectionAt('prone', 5).advantage).toBe('advantage');
    expect(projectionAt('prone', 10).advantage).toBe('disadvantage');
  });
  it('неизвестная дальность — гейт закрыт (ни автокрита, ни проекции Распластан)', () => {
    expect(projectionAt('paralyzed').autoCrit).toBe(false);
    expect(projectionAt('prone').advantage).toBe('none');
  });
  it('Без сознания: ≤5 футов — преим.+автокрит, дальше — обычный бросок (adv+dis)', () => {
    expect(projectionAt('unconscious', 5).advantage).toBe('advantage');
    expect(projectionAt('unconscious', 5).autoCrit).toBe(true);
    // Плоское преимущество + помеха от включённого Распластан дальше 5 футов → обычный бросок.
    expect(projectionAt('unconscious', 10).advantage).toBe('none');
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
  it('оружейная атака без объявленного оружия в руке не получает выдуманный тип дальности', () => {
    expect(attackRangeFromEffect({ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: 'weapon' }] }, 'main', char, {})).toBeUndefined();
  });
});
