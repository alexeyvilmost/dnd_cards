import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { applyIncomingDamage, executeAction } from './execute';
import { endTurn, startTurn } from './turn';

type Dict = Record<string, unknown>;

const caster: CharacterContext = {
  abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
  spellcastingMod: 3,
};

const targetCharacter: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
  saveProficiencies: [],
};

function state(): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: { action: 1, spell_slot_1: 1 },
    maxResources: { action: 1, spell_slot_1: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

const sleepCondition: Dict = {
  kind: 'condition',
  value: 'incapacitated',
  op: 'apply',
  duration: { type: 'rounds', amount: 10, concentration: true },
  causeTags: ['spell', 'magical', 'sleep'],
  end_triggers: ['actor_takes_damage', 'wake_action_within_5_ft'],
  save_ends: {
    timing: 'end_of_turn',
    ability: 'wis',
    dc: '8 + prof + spellcasting',
    on_failure_condition: 'unconscious',
  },
};

const sleep: Dict = {
  name: 'Усыпление',
  activation: { cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }] },
  effects: [{
    resolution: 'save',
    who: 'target',
    ability: 'wis',
    dc: '8 + prof + spellcasting',
    automatic_success: {
      if_sleep_not_required: true,
      if_condition_immunity: 'exhaustion',
    },
    on_fail: [sleepCondition],
    on_success: [],
  }],
};

function castContext(overrides: Partial<ExecuteContext['target']> = {}): ExecuteContext {
  return {
    character: caster,
    selfId: 'caster',
    actionName: 'Усыпление',
    rng: () => 0,
    forceSaveOutcome: 'fail',
    target: {
      id: 'target',
      characterContext: targetCharacter,
      runtimeState: state(),
      ...overrides,
    },
  };
}

describe('Sleep 2024 lifecycle', () => {
  it('binds the caster DC, lasts through the target start, then transitions once on a failed repeat save', () => {
    const cast = executeAction(state(), sleep, castContext());
    const initial = cast.targetState!.activeEffects[0];
    expect(initial).toMatchObject({
      roundsLeft: 10,
      sourceId: 'caster',
      ownerId: 'target',
      mechanics: {
        value: 'incapacitated',
        save_ends: { ability: 'wis', dc: 13, on_failure_condition: 'unconscious' },
      },
    });

    const atTargetStart = startTurn(cast.targetState!, targetCharacter).state;
    expect(atTargetStart.activeEffects[0]).toMatchObject({
      roundsLeft: 9,
      mechanics: { value: 'incapacitated' },
    });

    const atTargetEnd = endTurn(
      atTargetStart,
      { ...targetCharacter, rng: () => 0 } as CharacterContext,
      { advanceRoundDurations: false },
    );
    expect(atTargetEnd.state.activeEffects[0]).toMatchObject({
      roundsLeft: 9,
      mechanics: {
        value: 'unconscious',
        end_triggers: ['actor_takes_damage', 'wake_action_within_5_ft'],
      },
    });
    expect((atTargetEnd.state.activeEffects[0].mechanics as Dict).save_ends).toBeUndefined();
    expect(atTargetEnd.events).toContainEqual({ type: 'condition_applied', condition: 'unconscious' });
  });

  it.each([
    {
      label: 'does not sleep',
      target: { sleepRequired: false, sleepTraitSourceEntityIds: ['RACE-0004'] },
      expected: 'существо не нуждается во сне',
    },
    {
      label: 'has Exhaustion immunity',
      target: {
        conditionImmunities: [{
          condition: 'exhaustion', sourceEntityIds: ['monster:skeleton'],
        }],
      },
      expected: 'иммунитет к состоянию «exhaustion»',
    },
  ])('automatically succeeds when the target $label', ({ target, expected }) => {
    let rngCalls = 0;
    const context = castContext(target);
    context.forceSaveOutcome = undefined;
    context.rng = () => { rngCalls += 1; return 0; };
    const result = executeAction(state(), sleep, context);
    expect(result.targetState).toBeUndefined();
    expect(rngCalls).toBe(0);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'narrative', text: expect.stringContaining(expected),
    }));
  });

  it('ends on positive damage but not on zero damage', () => {
    const sleeping = executeAction(state(), sleep, castContext()).targetState!;
    const targetContext: ExecuteContext = { character: targetCharacter, rng: () => 0.9 };
    const zero = applyIncomingDamage(sleeping, 0, targetContext, { damageType: 'fire' });
    expect(zero.state.activeEffects.some((effect) => (
      (effect.mechanics as Dict).value === 'incapacitated'
    ))).toBe(true);
    const damaged = applyIncomingDamage(zero.state, 1, targetContext, { damageType: 'fire' });
    expect(damaged.state.activeEffects.some((effect) => (
      (effect.mechanics as Dict).value === 'incapacitated'
    ))).toBe(false);
    expect(damaged.events).toContainEqual({ type: 'effect_expired', name: 'incapacitated' });
  });

  it('Help can choose the 5-foot wake branch without removing unrelated conditions', () => {
    const sleeping = executeAction(state(), sleep, castContext()).targetState!;
    sleeping.activeEffects.push({
      id: 'ordinary-incapacitated',
      name: 'incapacitated',
      source: 'different effect',
      mechanics: { kind: 'condition', value: 'incapacitated' },
    });
    const help: Dict = {
      name: 'Помощь',
      activation: { cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'choice',
          id: 'help_mode',
          context: 'in_play',
          options: { items: [{
            id: 'wake_sleeping_target',
            grants: [
              {
                kind: 'condition', value: 'incapacitated', op: 'remove',
                required_cause_tags: ['magical', 'sleep'],
                required_end_trigger: 'wake_action_within_5_ft',
              },
              {
                kind: 'condition', value: 'unconscious', op: 'remove',
                required_cause_tags: ['magical', 'sleep'],
                required_end_trigger: 'wake_action_within_5_ft',
              },
            ],
          }] },
        }],
      }],
    };
    const result = executeAction(state(), help, {
      character: caster,
      selfId: 'helper',
      rng: () => 0.5,
      choices: { help_mode: 'wake_sleeping_target' },
      target: {
        id: 'target',
        characterContext: targetCharacter,
        runtimeState: sleeping,
      },
    });
    const remaining = result.targetState!.activeEffects.filter((effect) => (
      (effect.mechanics as Dict).value === 'incapacitated'
    ));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('ordinary-incapacitated');
  });
});
