/**
 * Фикс двойного учёта скорости (находка HIGH ревью слайса 1). breakdown('speed') раньше брал базой
 * characterSpeed = ruleState.speed (уже свернувший modifier-speed) и добавлял тот же modifier из
 * passives → значение считалось дважды (30+10 → показывалось 50 вместо 40). max_hp/initiative этим не
 * страдают: их база берётся из примитивов. Фикс: ruleState.baseSpeed = раса + grant_speed(walk), БЕЗ
 * modifier-speed; breakdown('speed') берёт baseSpeed за базу и добавляет modifier-speed один раз.
 */
import { describe, expect, it } from 'vitest';
import { resolveCharacterRules } from './resolveCharacterRules';
import { buildCharacterContext } from '../runtime';
import { breakdownValue } from '../../engine/breakdown';
import { emptyDraft, type CharacterDraft } from '../types';
import type { AssembledCharacter, OriginEffect } from '../assemble';
import type { RuntimeState } from '../../mvp/contracts';

const STATE = { equipment: {}, activeEffects: [] } as unknown as RuntimeState;

function build(mechanics: unknown) {
  const effect = { id: 'fast', name: 'Быстрое передвижение', mechanics } as unknown as OriginEffect['effect'];
  const assembled = {
    race: { id: 'x', name: 'x', speed: 30 }, klass: null, subclass: null, background: null,
    feats: [], effects: [{ effect, origin: { kind: 'feat', id: 'fast', name: 'Быстрое передвижение' } }],
    actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
  const draft: CharacterDraft = { ...emptyDraft(), abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, level: 5 };
  const ruleState = resolveCharacterRules({ draft, assembled });
  const ctx = buildCharacterContext(ruleState, draft, [], null);
  return { ruleState, ctx, mechanics };
}

// Реальная форма контента (eff_bonus / грант): effects[{resolution:auto, result:[...]}].
const modSpeed = (v: string): unknown => ({ effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: v }] }] });
const grantWalk = (v: number): unknown => ({ effects: [{ resolution: 'auto', result: [{ kind: 'grant_speed', mode: 'walk', value: v }] }] });

describe('Фикс: скорость не двоится (не-предметный modifier roll=speed)', () => {
  it('modifier(speed) входит в ruleState.speed один раз; baseSpeed его НЕ содержит', () => {
    const { ruleState } = build(modSpeed('+10'));
    expect(ruleState.speed).toBe(40);     // раса 30 + modifier 10 (итог)
    expect(ruleState.baseSpeed).toBe(30); // база БЕЗ modifier
  });

  it('ДИСКРИМИНАТОР: breakdown(speed) = 40, а не 50 (modifier не задваивается)', () => {
    const { ctx, mechanics } = build(modSpeed('+10'));
    const bd = breakdownValue('speed', ctx, STATE, [mechanics as Record<string, unknown>]);
    expect(bd.value).toBe(40);
  });

  it('grant_speed(walk) входит в базовую скорость и не двоится в breakdown', () => {
    const { ruleState, ctx, mechanics } = build(grantWalk(5));
    expect(ruleState.speed).toBe(35);
    expect(ruleState.baseSpeed).toBe(35); // grant_speed walk — часть базы
    const bd = breakdownValue('speed', ctx, STATE, [mechanics as Record<string, unknown>]);
    expect(bd.value).toBe(35); // breakdown добавляет только modifier, grant_speed уже в базе → 35, не 40
  });

  it('без модификаторов — базовая скорость расы', () => {
    const { ruleState } = build({ effects: [] });
    expect(ruleState.speed).toBe(30);
    expect(ruleState.baseSpeed).toBe(30);
  });
});
