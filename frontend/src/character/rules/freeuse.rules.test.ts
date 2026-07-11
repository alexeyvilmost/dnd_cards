/**
 * freeuse в резолвере правил: grant_spell.freeuse → ruleState.freeuseSpells (нативно и через
 * choice — общая точка grantFromPayload), уровневый гейт, сид пула freeuse-<spell> в ресурсы.
 */
import { describe, expect, it } from 'vitest';
import { resolveCharacterRules } from './resolveCharacterRules';
import { syncRuntimeResources } from '../resourceInit';
import { buildCharacterContext } from '../runtime';
import { emptyDraft, type AbilityScores, type CharacterDraft } from '../types';
import type { AssembledCharacter, OriginEffect } from '../assemble';
import type { ChoiceOrigin } from '../../mechanics/collectChoices';

type Mech = Record<string, unknown>;
const RACE_ORIGIN: ChoiceOrigin = { kind: 'race', id: 'high_elf', name: 'Высший эльф' };
const FEAT_ORIGIN: ChoiceOrigin = { kind: 'feat', id: 'magic_initiate', name: 'Посвящённый в магию' };
const STD: AbilityScores = { str: 10, dex: 14, con: 12, int: 15, wis: 10, cha: 8 };

function fx(id: string, mechanics: Mech, origin: ChoiceOrigin = RACE_ORIGIN): OriginEffect {
  return { effect: { id, name: id, mechanics } as unknown as OriginEffect['effect'], origin };
}

function build(effects: OriginEffect[], draft: Partial<CharacterDraft> = {}) {
  const d: CharacterDraft = { ...emptyDraft(), abilities: { ...STD }, level: 20, ...draft };
  const assembled = {
    race: { id: 'high_elf', name: 'Высший эльф', speed: 30 },
    klass: null, subclass: null, background: null, feats: [],
    effects, actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
  const ruleState = resolveCharacterRules({ draft: d, assembled });
  return { ruleState, assembled, draft: d };
}

const auto = (...result: Mech[]): Mech => ({ effects: [{ resolution: 'auto', result }] });

describe('freeuse в резолвере — нативный grant_spell', () => {
  it('freeuse-объект → freeuseSpells с count/recharge/level', () => {
    const { ruleState } = build([fx('high-elf', auto(
      { kind: 'grant_spell', value: 'misty_step', freeuse: { count: 1, recharge: 'long_rest' } },
    ))]);
    expect(ruleState.freeuseSpells).toEqual([{ spell: 'misty_step', count: 1, recharge: 'long_rest' }]);
    expect(ruleState.spells.known).toContain('misty_step'); // и остаётся известным
  });

  it('freeuse:true → 1×/долгий отдых', () => {
    const { ruleState } = build([fx('he', auto(
      { kind: 'grant_spell', value: 'detect_magic', freeuse: true },
    ))]);
    expect(ruleState.freeuseSpells).toEqual([{ spell: 'detect_magic', count: 1, recharge: 'long_rest' }]);
  });

  it('freeuse.level фиксирует круг бесплатного каста (ожерелье: 2× на 2 круге)', () => {
    const { ruleState } = build([fx('necklace', auto(
      { kind: 'grant_spell', value: 'magic_missile', freeuse: { count: 2, level: 2 } },
    ))]);
    expect(ruleState.freeuseSpells[0]).toMatchObject({ spell: 'magic_missile', count: 2, level: 2 });
  });

  it('grant_spell без freeuse → freeuseSpells пуст', () => {
    const { ruleState } = build([fx('he', auto({ kind: 'grant_spell', value: 'misty_step' }))]);
    expect(ruleState.freeuseSpells).toEqual([]);
  });

  it('уровневый гейт: ниже порога — заклинание не выдано, пула нет', () => {
    const { ruleState } = build(
      [fx('he', auto({ kind: 'grant_spell', value: 'misty_step', level_gate: 5, freeuse: true }))],
      { level: 3 },
    );
    expect(ruleState.spells.known).not.toContain('misty_step');
    expect(ruleState.freeuseSpells).toEqual([]);
  });
});

describe('freeuse в резолвере — через choice (кейс «Посвящённый в магию»)', () => {
  it('choice(source:spell).grant.freeuse → freeuseSpells для ВЫБРАННОГО заклинания', () => {
    const choice: Mech = {
      kind: 'choice', id: 'magic_initiate_l1', count: 1,
      grant: { kind: 'grant_spell', label: 'spellbook', freeuse: { count: 1, recharge: 'long_rest' } },
      options: { source: 'spell' },
    };
    const { ruleState } = build(
      [fx('magic-initiate', { effects: [choice] }, FEAT_ORIGIN)],
      { resolvedChoices: { magic_initiate_l1: ['SPELL-0174'] } },
    );
    expect(ruleState.spells.known).toContain('SPELL-0174');
    expect(ruleState.freeuseSpells).toEqual([{ spell: 'SPELL-0174', count: 1, recharge: 'long_rest' }]);
  });
});

describe('freeuse — сид пула ресурсов', () => {
  it('syncRuntimeResources заводит freeuse-<spell> с count', () => {
    const { ruleState, assembled, draft } = build([fx('he', auto(
      { kind: 'grant_spell', value: 'misty_step', freeuse: { count: 2, recharge: 'long_rest' } },
    ))]);
    const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
    const { resources, maxResources } = syncRuntimeResources(ctx, assembled, undefined, ruleState.freeuseSpells);
    expect(maxResources['freeuse-misty_step']).toBe(2);
    expect(resources['freeuse-misty_step']).toBe(2);
  });

  it('без freeuseSpells пул не заводится (обратная совместимость)', () => {
    const { ruleState, assembled, draft } = build([fx('he', auto({ kind: 'grant_spell', value: 'misty_step' }))]);
    const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
    const { maxResources } = syncRuntimeResources(ctx, assembled, undefined, ruleState.freeuseSpells);
    expect(Object.keys(maxResources).some((k) => k.startsWith('freeuse-'))).toBe(false);
  });
});
