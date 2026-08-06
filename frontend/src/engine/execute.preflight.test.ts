import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import {
  executeAction,
  MechanicsExecutionError,
  readTargetSave,
  type MechanicsExecutionErrorCode,
} from './execute';

type Dict = Record<string, unknown>;

const character: CharacterContext = {
  abilityMods: { str: 2, dex: 1, con: 3, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function fresh(): RuntimeState {
  return {
    hp: { current: 8, max: 10, temp: 0 },
    resources: { action: 1 },
    maxResources: { action: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function paid(result: Dict[]): Dict {
  return {
    name: 'Декларативное действие',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{ resolution: 'auto', result }],
  };
}

function expectCode(run: () => unknown, code: MechanicsExecutionErrorCode): MechanicsExecutionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MechanicsExecutionError);
    expect((error as MechanicsExecutionError).code).toBe(code);
    return error as MechanicsExecutionError;
  }
  throw new Error(`Expected MechanicsExecutionError(${code})`);
}

describe('executeAction fail-closed preflight', () => {
  it('rejects an unresolved grant_effect before cost, RNG, or id allocation', () => {
    const state = fresh();
    const before = structuredClone(state);
    let rngCalls = 0;
    let idCalls = 0;
    const context: ExecuteContext = {
      character,
      rng: () => { rngCalls += 1; return 0.5; },
      nextId: () => { idCalls += 1; return `id-${idCalls}`; },
      grantedEffects: {},
    };

    const error = expectCode(
      () => executeAction(state, paid([{ kind: 'grant_effect', value: 'effect:missing' }]), context),
      'UNRESOLVED_GRANT_EFFECT',
    );

    expect(error.path).toBe('mechanics.effects[0].result[0]');
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(0);
  });

  it('resolves a deterministic formula cost once and pays each declared resource once', () => {
    const state = {
      ...fresh(),
      resources: { action: 1, material_incense_gp: 12 },
      maxResources: { action: 1, material_incense_gp: 12 },
    };
    const result = executeAction(state, {
      activation: {
        mode: 'active',
        cost: [
          { resource: 'action' },
          { resource: 'material_incense_gp', amount: 'prof_bonus + 3' },
        ],
      },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', text: 'summoned' }] }],
    }, { character, rng: () => 0.5 });

    expect(result.state.resources).toMatchObject({ action: 0, material_incense_gp: 7 });
    expect(result.events.filter((event) => event.type === 'resource_spent')).toEqual([
      expect.objectContaining({ resource: 'action', amount: 1 }),
      expect.objectContaining({ resource: 'material_incense_gp', amount: 5 }),
    ]);
    expect(state.resources).toMatchObject({ action: 1, material_incense_gp: 12 });
  });

  it.each([
    { cost: [{ resource: '' }], code: 'INVALID_PAYLOAD' as const },
    { cost: [{ resource: 'item', card_id: '' }], code: 'INVALID_PAYLOAD' as const },
    { cost: [{ resource: 'action', amount: 'missing_cost_variable' }], code: 'INVALID_FORMULA' as const },
    { cost: [{ resource: 'action', amount: '1d4' }], code: 'INVALID_FORMULA' as const },
    { cost: [{ resource: 'action', amount: '1 / 2' }], code: 'INVALID_FORMULA' as const },
    { cost: [{ resource: 'action', amount: 0 }], code: 'INVALID_FORMULA' as const },
    { cost: [{ resource: 'action', amount: -1 }], code: 'INVALID_FORMULA' as const },
  ])('rejects malformed activation costs before RNG, ids, or state changes', ({ cost, code }) => {
    const state = fresh();
    const before = structuredClone(state);
    let rngCalls = 0;
    let idCalls = 0;
    expectCode(() => executeAction(state, {
      activation: { mode: 'active', cost },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', text: 'must not run' }] }],
    }, {
      character,
      rng: () => { rngCalls += 1; return 0.5; },
      nextId: () => { idCalls += 1; return `id-${idCalls}`; },
    }), code);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(0);
  });

  it.each([
    {
      label: 'unknown interaction resolution',
      mechanics: {
        activation: { cost: [{ resource: 'action' }] },
        effects: [{ resolution: 'telepathy', result: [] }],
      },
      code: 'UNKNOWN_RESOLUTION' as const,
    },
    {
      label: 'unknown payload kind',
      mechanics: paid([{ kind: 'entity_specific_spell_bypass' }]),
      code: 'UNKNOWN_PAYLOAD' as const,
    },
    {
      label: 'build-only payload in an activated effect',
      mechanics: paid([{ kind: 'variable', id: 'x', op: 'set', value: '1' }]),
      code: 'UNKNOWN_PAYLOAD' as const,
    },
    {
      label: 'payload incorrectly placed at the action root',
      mechanics: { activation: { cost: [{ resource: 'action' }] }, kind: 'damage', dice: '1d6' },
      code: 'INVALID_MECHANICS' as const,
    },
  ])('rejects $label instead of returning a paid narrative-only success', ({ mechanics, code }) => {
    const state = fresh();
    expectCode(
      () => executeAction(state, mechanics, { character, rng: () => 0.5 }),
      code,
    );
    expect(state.resources.action).toBe(1);
  });

  const invalidPayloadCases: Array<{
    payloads: Dict[];
    code: Extract<MechanicsExecutionErrorCode, 'INVALID_PAYLOAD' | 'INVALID_FORMULA'>;
  }> = [
    { payloads: [{ kind: 'set_value', target: 'hp', formula: '1 +' }], code: 'INVALID_FORMULA' },
    { payloads: [{ kind: 'set_value', target: 'typo_hp', formula: '1' }], code: 'INVALID_PAYLOAD' },
    { payloads: [{ kind: 'damage', dice: 'missing_damage_die', type: 'force' }], code: 'INVALID_FORMULA' },
  ];

  it.each(invalidPayloadCases)('rejects invalid required formulas/targets without consuming the action', ({ payloads, code }) => {
    const state = fresh();
    let rngCalls = 0;
    expectCode(
      () => executeAction(state, paid(payloads), {
        character,
        rng: () => { rngCalls += 1; return 0.5; },
      }),
      code,
    );
    expect(state).toEqual(fresh());
    expect(rngCalls).toBe(0);
  });

  it.each([
    {
      label: 'damage type',
      payload: { kind: 'damage', dice: '1d6' },
      code: 'INVALID_PAYLOAD' as const,
      path: 'mechanics.effects[0].result[0].type',
    },
    {
      label: 'weapon behind type:weapon',
      payload: { kind: 'damage', dice: 'weapon', type: 'weapon' },
      code: 'INVALID_MECHANICS' as const,
      path: 'context.character.equipment',
    },
  ])('rejects missing explicit $label before cost, RNG, ids, or mutation', ({ payload, code, path }) => {
    const state = fresh();
    const before = structuredClone(state);
    let rngCalls = 0;
    let idCalls = 0;
    const error = expectCode(() => executeAction(state, paid([payload]), {
      character,
      rng: () => { rngCalls += 1; return 0.5; },
      nextId: () => { idCalls += 1; return `id-${idCalls}`; },
    }), code);
    expect(error.path).toBe(path);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(0);
  });

  it.each([
    {
      label: 'attack ability',
      effect: { resolution: 'attack_roll', on_hit: [] },
      context: { target: { ac: 12 } },
      path: 'mechanics.effects[0].ability',
    },
    {
      label: 'target Armor Class',
      effect: { resolution: 'attack_roll', ability: 'str', on_hit: [] },
      context: { target: {} },
      path: 'context.target.ac',
    },
    {
      label: 'actor attack modifier',
      effect: { resolution: 'attack_roll', ability: 'str', on_hit: [] },
      context: {
        target: { ac: 12 },
        character: {
          ...character,
          abilityMods: { ...character.abilityMods, str: undefined },
        } as unknown as CharacterContext,
      },
      path: 'context.character.abilityMods.str',
    },
    {
      label: 'actor proficiency bonus',
      effect: { resolution: 'attack_roll', ability: 'str', on_hit: [] },
      context: { target: { ac: 12 }, character: { ...character, profBonus: Number.NaN } },
      path: 'context.character.profBonus',
    },
    {
      label: 'spell attack modifier',
      effect: { resolution: 'attack_roll', ability: 'spellcasting', on_hit: [] },
      context: { target: { ac: 12 } },
      path: 'context.character.spellcastingMod',
    },
    {
      label: 'automatic attack weapon',
      effect: { resolution: 'attack_roll', ability: 'auto', on_hit: [] },
      context: { target: { ac: 12 } },
      path: 'context.character.equipment',
    },
    {
      label: 'save ability',
      effect: { resolution: 'save', dc: '12', on_fail: [] },
      context: { target: { saveMods: { dex: 0 } } },
      path: 'mechanics.effects[0].ability',
    },
    {
      label: 'save DC',
      effect: { resolution: 'save', ability: 'dex', on_fail: [] },
      context: { target: { saveMods: { dex: 0 } } },
      path: 'mechanics.effects[0].dc',
    },
    {
      label: 'target save modifier',
      effect: { resolution: 'save', ability: 'dex', dc: '12', on_fail: [] },
      context: { target: { saveMods: {} } },
      path: 'context.target.saveMods.dex',
    },
    {
      label: 'ability-check ability',
      effect: { resolution: 'ability_check', dc: '12', on_success: [] },
      context: {},
      path: 'mechanics.effects[0].ability',
    },
    {
      label: 'ability-check discriminator',
      effect: { resolution: 'ability_check', ability: 'str', on_success: [] },
      context: {},
      path: 'mechanics.effects[0]',
    },
    {
      label: 'contest defending skills',
      effect: { resolution: 'ability_check', ability: 'str', contest_vs: [], on_success: [] },
      context: { target: { checkMods: {} } },
      path: 'mechanics.effects[0].contest_vs',
    },
    {
      label: 'contest defending modifier',
      effect: {
        resolution: 'ability_check', ability: 'str',
        contest_vs: ['athletics', 'acrobatics'], on_success: [],
      },
      context: { target: { checkMods: { athletics: 2 } } },
      path: 'context.target.checkMods.acrobatics',
    },
  ])('rejects missing explicit $label before cost, RNG, ids, or mutation', ({ effect, context, path }) => {
    const state = fresh();
    const before = structuredClone(state);
    let rngCalls = 0;
    let idCalls = 0;
    const error = expectCode(() => executeAction(state, {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [effect],
    }, {
      character,
      rng: () => { rngCalls += 1; return 0.5; },
      nextId: () => { idCalls += 1; return `id-${idCalls}`; },
      ...(context as Partial<ExecuteContext>),
    }), path.startsWith('context.') ? 'INVALID_MECHANICS' : 'INVALID_PAYLOAD');
    expect(error.path).toBe(path);
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(0);
  });

  it('executes explicit attack, save, fixed-DC check, and contest declarations', () => {
    const cases: Array<{ effect: Dict; target: NonNullable<ExecuteContext['target']> }> = [
      {
        effect: { resolution: 'attack_roll', ability: 'str', on_hit: [] },
        target: { ac: 12 },
      },
      {
        effect: { resolution: 'save', ability: 'dex', dc: '12', on_fail: [], on_success: [] },
        target: { saveMods: { dex: 0 } },
      },
      {
        effect: { resolution: 'ability_check', ability: 'str', dc: '12', on_success: [] },
        target: {},
      },
      {
        effect: {
          resolution: 'ability_check', ability: 'str', skill: 'athletics',
          contest_vs: ['athletics', 'acrobatics'], on_success: [],
        },
        target: { checkMods: { athletics: 1, acrobatics: 2 } },
      },
    ];
    for (const { effect, target } of cases) {
      const state = fresh();
      const result = executeAction(state, {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [effect],
      }, { character, target, rng: () => 0.5 });
      expect(result.state.resources.action).toBe(0);
      expect(state.resources.action).toBe(1);
    }
  });

  it('readTargetSave rejects incomplete data and returns an explicit declaration unchanged', () => {
    expectCode(() => readTargetSave({
      effects: [{ resolution: 'save', who: 'target', ability: 'dex' }],
    }, { character, rng: () => 0.5 }), 'INVALID_PAYLOAD');
    expect(readTargetSave({
      effects: [{
        resolution: 'save', who: 'target', ability: 'wis', dc: '8+prof_bonus+str',
        on_fail: [{ kind: 'condition', value: 'prone' }],
      }],
    }, { character, rng: () => 0.5 })).toEqual({
      ability: 'wis', dc: 12, half: false, avoidsConditions: ['prone'],
    });
  });

  it('preflights the selected runtime-choice branch and requires an explicit selection', () => {
    const mechanics = paid([{
      kind: 'choice',
      id: 'damage-kind',
      context: 'in_play',
      options: {
        source: 'explicit',
        items: [{
          id: 'bad',
          grants: [{ kind: 'damage', dice: 'missing_choice_die', type: 'force' }],
        }],
      },
    }]);
    expectCode(
      () => executeAction(fresh(), mechanics, { character, rng: () => 0.5 }),
      'MISSING_CHOICE',
    );
    expectCode(
      () => executeAction(fresh(), mechanics, {
        character,
        rng: () => 0.5,
        choices: { 'damage-kind': 'bad' },
      }),
      'INVALID_FORMULA',
    );
  });

  it('keeps valid grant, dice damage, and narrative mechanics executable', () => {
    const state = fresh();
    let rngCalls = 0;
    let idCalls = 0;
    const result = executeAction(state, paid([
      { kind: 'grant_effect', value: 'effect:ward' },
      { kind: 'damage', dice: '1d6+str', type: 'force' },
      { kind: 'narrative', text: 'Явный текст остаётся допустимым исходом.' },
    ]), {
      character,
      rng: () => { rngCalls += 1; return 0.5; },
      nextId: () => { idCalls += 1; return `effect-${idCalls}`; },
      grantedEffects: {
        'effect:ward': {
          name: 'Защита',
          mechanics: {
            kind: 'modifier',
            applies_to: { roll: 'ac' },
            op: 'add',
            value: '+1',
          },
        },
      },
    });

    expect(result.state.resources.action).toBe(0);
    expect(result.state.activeEffects).toHaveLength(1);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage', amount: 6 }));
    expect(result.events).toContainEqual({
      type: 'narrative',
      text: 'Явный текст остаётся допустимым исходом.',
    });
    // Preflight uses its own deterministic parser RNG and never advances the
    // authoritative tape or allocates a persisted id.
    expect(rngCalls).toBe(1);
    expect(idCalls).toBe(1);
  });

  it('does not dispatch behavior by action id or localized name', () => {
    const mechanics = (id: string, name: string): Dict => ({
      id,
      name,
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'set_value', target: 'hp', formula: '1' }] }],
    });
    const context = { character, rng: () => 0.5 };
    const first = executeAction(fresh(), mechanics('uuid-a', 'Имя А'), context);
    const second = executeAction(fresh(), mechanics('uuid-b', 'Completely different'), context);
    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
  });

  it('requires an explicit canonical hand-off for world primitive metadata', () => {
    const mechanics = {
      primitive: { type: 'light_world_object' },
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', text: 'legacy projection' }] }],
    };
    const state = fresh();
    let rngCalls = 0;
    let idCalls = 0;
    expectCode(
      () => executeAction(state, mechanics, {
        character,
        rng: () => { rngCalls += 1; return 0.5; },
        nextId: () => { idCalls += 1; return `id-${idCalls}`; },
      }),
      'CANONICAL_PRIMITIVE_REQUIRED',
    );
    expect(state.resources.action).toBe(1);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(0);

    const result = executeAction(fresh(), mechanics, {
      character,
      rng: () => 0.5,
      externalPrimitiveHandled: true,
    });
    expect(result.state.resources.action).toBe(0);
    expect(result.events).toContainEqual({ type: 'narrative', text: 'legacy projection' });
  });
});
