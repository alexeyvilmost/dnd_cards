import { describe, expect, it } from 'vitest';
import { normalizeMechanicId, validateMechanics } from './validateMechanics';
import schema from '../schemas/mechanics.schema.json';

describe('validateMechanics', () => {
  it('нормализует русское название предмета в безопасный id', () => {
    expect(normalizeMechanicId('Зелье лечения')).toBe('draft');
    expect(normalizeMechanicId('  item__42  ')).toBe('item-42');
  });

  it('пустая механика — валидна', () => {
    expect(validateMechanics(null, { id: 'x', name: 'X', kind: 'passive_effect' }).valid).toBe(true);
  });

  it('валидная пассивка с auto', () => {
    const result = validateMechanics(
      {
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }] }],
      },
      { id: 'darkvision', name: 'Тёмное зрение', kind: 'passive_effect' },
    );
    expect(result.valid).toBe(true);
  });

  it('fail-closed требует явный тип и формулу урона', () => {
    const meta = { id: 'damage-contract', name: 'Damage contract', kind: 'action' as const };
    const mechanics = (payload: Record<string, unknown>) => ({
      activation: { mode: 'active' },
      effects: [{ resolution: 'auto', result: [payload] }],
    });

    expect(validateMechanics(
      mechanics({ kind: 'damage', dice: '1d6', type: 'force' }),
      meta,
    ).valid).toBe(true);
    expect(validateMechanics(
      mechanics({ kind: 'damage', amount: 'spellcasting+1', type: 'force' }),
      meta,
    ).valid).toBe(true);
    expect(validateMechanics(
      mechanics({ kind: 'damage', dice: '1d6' }),
      meta,
    ).valid).toBe(false);
    expect(validateMechanics(
      mechanics({ kind: 'damage', type: 'force' }),
      meta,
    ).valid).toBe(false);
  });

  it('fail-closed требует явные ability и DC для save_ends', () => {
    const meta = { id: 'save-ends-contract', name: 'Save ends contract', kind: 'action' as const };
    const mechanics = (saveEnds: Record<string, unknown>) => ({
      activation: { mode: 'active' },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'condition', value: 'poisoned', save_ends: saveEnds }],
      }],
    });

    expect(validateMechanics(
      mechanics({ ability: 'con', dc: '8+prof_bonus', timing: 'end_of_turn' }),
      meta,
    ).valid).toBe(true);
    expect(validateMechanics(mechanics({ dc: '10' }), meta).valid).toBe(false);
    expect(validateMechanics(mechanics({ ability: 'con' }), meta).valid).toBe(false);
    expect(validateMechanics(mechanics({ ability: 'auto', dc: '10' }), meta).valid).toBe(false);
  });

  it('блокирует невалидный activation.mode', () => {
    const result = validateMechanics(
      { activation: { mode: 'not_a_mode' }, effects: [] },
      { id: 'bad', name: 'Bad', kind: 'action' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('принимает типизированный Weapon Mastery primitive', () => {
    expect(validateMechanics(
      {
        activation: { mode: 'triggered', trigger: { event: 'hit' } },
        effects: [],
        weapon_mastery: {
          type: 'topple', saveAbility: 'con', dc: '8+prof_bonus+weapon_mod',
          condition: 'prone', choiceId: 'weapon_mastery.topple.use',
        },
      },
      { id: 'EFFECT-0248', name: 'Topple', kind: 'passive_effect' },
    ).valid).toBe(true);
  });

  it('требует полный дискриминированный контракт для каждого Weapon Mastery', () => {
    const declarations: Record<string, Record<string, unknown>> = {
      topple: {
        type: 'topple', saveAbility: 'con', dc: '8+prof_bonus+weapon_mod',
        condition: 'prone', choiceId: 'weapon_mastery.topple.use',
      },
      sap: { type: 'sap', consume: 'next', expires: 'start_of_source_next_turn' },
      slow: {
        type: 'slow', penaltyFt: 10, requiresDamage: true,
        expires: 'start_of_source_next_turn', choiceId: 'weapon_mastery.slow.use',
      },
      vex: {
        type: 'vex', consume: 'next', targetLocked: true, requiresDamage: true,
        expires: 'end_of_source_next_turn',
      },
      push: {
        type: 'push', maxDistanceFt: 10, maxTargetSize: 'large',
        choiceId: 'weapon_mastery.push.distance_ft',
      },
      graze: {
        type: 'graze', damage: 'max(weapon_mod,0)', choiceId: 'weapon_mastery.graze.use',
      },
      nick: { type: 'nick', timing: 'attack_action', maximumPerTurn: 1 },
      cleave: {
        type: 'cleave', maximumPerTurn: 1, secondaryWithinPrimaryFt: 5,
        sameWeapon: true, positiveAbilityModifier: false, expires: 'end_of_turn',
      },
    };
    for (const [type, declaration] of Object.entries(declarations)) {
      expect(validateMechanics(
        { activation: { mode: 'passive' }, effects: [], weapon_mastery: declaration },
        { id: type, name: type, kind: 'passive_effect' },
      ).valid, `${type} complete declaration`).toBe(true);
      for (const field of Object.keys(declaration)) {
        if (field === 'type') continue;
        const incomplete = { ...declaration };
        delete incomplete[field];
        expect(validateMechanics(
          { activation: { mode: 'passive' }, effects: [], weapon_mastery: incomplete },
          { id: `${type}-${field}`, name: type, kind: 'passive_effect' },
        ).valid, `${type} omitted ${field}`).toBe(false);
      }
    }
  });

  it('fail-closed отклоняет неизвестный primitive и несовместимые поля mastery', () => {
    expect(validateMechanics(
      { activation: { mode: 'active' }, effects: [], primitive: { type: 'unknown_rule' } },
      { id: 'bad-primitive', name: 'Bad', kind: 'action' },
    ).valid).toBe(false);
    expect(validateMechanics(
      {
        activation: { mode: 'active' }, effects: [],
        primitive: { type: 'find_familiar', entitySpecificBypass: true },
      },
      { id: 'bad-known-primitive-shape', name: 'Bad', kind: 'spell' },
    ).valid).toBe(false);
    expect(validateMechanics(
      {
        activation: { mode: 'passive' }, effects: [],
        weapon_mastery: { type: 'nick', saveAbility: 'con' },
      },
      { id: 'bad-mastery', name: 'Bad', kind: 'passive_effect' },
    ).valid).toBe(false);
    expect(validateMechanics(
      {
        activation: { mode: 'passive' }, effects: [],
        weapon_mastery: {
          type: 'slow', penaltyFt: 0, requiresDamage: true,
          expires: 'start_of_source_next_turn', choiceId: 'weapon_mastery.slow.use',
        },
      },
      { id: 'bad-mastery-distance', name: 'Bad', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('типизирует декларативную материальную цену Find Familiar и требует recharge never', () => {
    const valid = {
      activation: {
        mode: 'active',
        cost: [
          { resource: 'action' },
          {
            resource: 'material_incense_gp',
            amount: 10,
            binding: { kind: 'currency', currency: 'gold' },
            recharge: 'never',
          },
        ],
      },
      primitive: {
        type: 'find_familiar',
        materialCostResource: 'material_incense_gp',
        policy: {
          connection_range_ft: 100,
          reappear_range_ft: 30,
          ritual_casting_added_seconds: 600,
        },
      },
      effects: [],
    };
    expect(validateMechanics(
      valid,
      { id: 'find-familiar', name: 'Find Familiar', kind: 'spell' },
    ).valid).toBe(true);
    expect(validateMechanics(
      {
        ...valid,
        primitive: { type: 'find_familiar' },
      },
      { id: 'find-familiar-no-reference', name: 'Find Familiar', kind: 'spell' },
    ).valid).toBe(false);
    expect(validateMechanics(
      {
        ...valid,
        activation: {
          mode: 'active',
          cost: [{
            resource: 'material_incense_gp',
            amount: 10,
            binding: { kind: 'currency', currency: 'gold' },
          }],
        },
      },
      { id: 'find-familiar-regenerating-money', name: 'Find Familiar', kind: 'spell' },
    ).valid).toBe(false);
  });

  it('типизирует level-based condition lifecycle и отклоняет скрытые поля', () => {
    expect(validateMechanics(
      {
        activation: { mode: 'passive' },
        effects: [],
        stacking: { mode: 'levels', max: 6 },
        long_rest: { remove_levels: 1 },
        thresholds: [{ at_level: 6, outcome: 'death' }],
      },
      { id: 'COND-exhaustion', name: 'Exhaustion', kind: 'passive_effect' },
    ).valid).toBe(true);

    expect(validateMechanics(
      {
        activation: { mode: 'passive' },
        effects: [],
        stacking: { mode: 'levels', max: 6, entitySpecificRule: true },
      },
      { id: 'bad-condition-extension', name: 'Bad', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('fail-closed типизирует явный harmful interaction intent', () => {
    expect(validateMechanics(
      { activation: { mode: 'active' }, interaction: { intent: 'harmful' }, effects: [] },
      { id: 'harmful-action', name: 'Harmful', kind: 'action' },
    ).valid).toBe(true);
    expect(validateMechanics(
      { activation: { mode: 'active' }, interaction: { intent: 'friendly' }, effects: [] },
      { id: 'invalid-intent', name: 'Invalid', kind: 'action' },
    ).valid).toBe(false);
    expect(validateMechanics(
      {
        activation: { mode: 'active' },
        interaction: { intent: 'harmful', hiddenEntityRule: true },
        effects: [],
      },
      { id: 'invalid-intent-shape', name: 'Invalid', kind: 'action' },
    ).valid).toBe(false);
  });

  it('типизирует bounded uses recovery и отклоняет скрытые или небезопасные значения', () => {
    const meta = { id: 'bounded-action', name: 'Bounded action', kind: 'action' as const };
    expect(validateMechanics({
      activation: { mode: 'active' },
      effects: [],
      uses: {
        count: 2,
        per: 'short_rest',
        recovery: {
          short_rest: { mode: 'fixed', amount: 1 },
          long_rest: { mode: 'full' },
        },
      },
    }, meta).valid).toBe(true);

    for (const recovery of [
      { short_rest: { mode: 'fixed', amount: 0 }, long_rest: { mode: 'full' } },
      { short_rest: { mode: 'full', amount: 1 }, long_rest: { mode: 'full' } },
      { short_rest: { mode: 'fixed', amount: 1 } },
      { short_rest: { mode: 'fixed', amount: 1 }, long_rest: { mode: 'full' }, hidden: true },
    ]) {
      expect(validateMechanics({
        activation: { mode: 'active' }, effects: [], uses: { count: 2, recovery },
      }, meta).valid).toBe(false);
    }
  });

  it('типизирует data-owned attack replacement, rest decision, sight и condition identity', () => {
    expect(validateMechanics({
      activation: { mode: 'active' },
      effects: [],
      targeting: { shape: 'single', requires_sight: true },
      attack_replacement: {
        replacement_key: 'lineage:breath',
        replaces_attacks: 1,
        total_attacks: 1,
        once_per_attack_action: true,
      },
    }, { id: 'replacement', name: 'Replacement', kind: 'action' }).valid).toBe(true);

    const rest = {
      activation: { mode: 'rest_decision', cost: [{ resource: 'recovery_charge' }] },
      effects: [],
      rest_decision: {
        kind: 'slot_recovery',
        decision_type: 'study_recovery',
        rest: 'short_rest',
        capability_id: 'rest:study-recovery',
        level_source: { kind: 'class_level', class_id: 'scholar', minimum: 1, maximum: 20 },
        budget: { mode: 'ceil_divide_level', divisor: 2 },
        slot_resource: {
          prefix: 'study_rank_', minimum_level: 1, maximum_level: 5, restore_amount: 1,
        },
        maximum_per_rest: 1,
      },
    };
    expect(validateMechanics(rest, { id: 'rest', name: 'Rest', kind: 'action' }).valid)
      .toBe(true);
    expect(validateMechanics({
      activation: { mode: 'passive' },
      effects: [],
      condition: { id: 'blinded' },
      world_facts: { cannot_see: true },
    }, { id: 'condition', name: 'Condition', kind: 'passive_effect' }).valid).toBe(true);

    for (const mechanics of [
      { ...rest, rest_decision: { ...rest.rest_decision, hidden_rule: true } },
      { activation: { mode: 'active' }, effects: [], attack_replacement: {
        replacement_key: 'bad', replaces_attacks: 2, total_attacks: 1,
        once_per_attack_action: true,
      } },
      { activation: { mode: 'passive' }, effects: [], condition: { id: 'Blinded' } },
    ]) {
      expect(validateMechanics(
        mechanics,
        { id: 'invalid-extension', name: 'Invalid', kind: 'action' },
      ).valid).toBe(false);
    }
  });
});

// C13: контракт полноты payload.kind в обе стороны (валидатор ↔ рантайм).
// Ловит регрессию, когда рантайм начинает исполнять kind, забытый в схеме
// (валидатор молча бракует рабочий контент), и наоборот — kind в схеме без
// исполнителя и без явной пометки.
//
// Три категории — «карта поддержки» для классификатора покрытия правил
// (docs/rules-coverage-plan-2026-07-11.md §2). Держать в синхроне с матрицей
// движка (frontend/src/engine/execute.ts applyPayloads + resolveCharacterRules).
describe('C13: контракт схема ↔ рантайм (payload.kind)', () => {
  const schemaKinds = (schema as unknown as {
    $defs: { payload: { properties: { kind: { enum: string[] } } } };
  }).$defs.payload.properties.kind.enum;

  // ПОЛНОСТЬЮ исполняемые: рантайм-роутер меняет состояние либо сборка применяет грант.
  const HANDLED = [
    'damage', 'damage_rider', 'triggered_effect', 'fall_protection', 'movement_option',
    'targeting_ward', 'turn_command', 'healing', 'reduce_damage', 'temp_hp', 'condition', 'resource', 'modifier',
    'stabilize', 'weapon_enchantment', 'remote_manipulator', 'communication_link', 'world_interaction',
    'illusion', 'temporary_consumable', 'world_entity', 'information_access',
    'information_reveal', 'world_zone',
    'condition_immunity', 'resistance', 'set_value',    // condition-owned defense + урон/AC runtime
    'value_method',                                     // сборка: методы характеристик (C8, Пояс силы огра)
    'narrative', 'add_item',                            // add_item: S1 контейнеры
    'grant_effect', 'remove_effect', 'grant_language', 'grant_expertise',
    'grant_proficiency', 'grant_feat', 'grant_spell',   // сборка персонажа
    'grant_ability_score', 'grant_sense', 'grant_speed',// D3: применяются резолвером (resolveCharacterRules.ts:253-364)
    'spellcasting_ability',                            // primary build projection + source-scoped persisted choices
    'weapon_mastery',                                   // искусность 2024: резолвер → ruleState.weaponMasteries,
                                                         // движок гейтит свойство оружия (engine/mastery.ts)
    'unarmed_damage_profile', 'turn_start_grapple_damage', // каноническая Attack/StartTurn RulesSession
    'd20_interrupt',                                  // persisted cross-actor solo-combat d20 continuation
    'choice',                                           // мета-kind (ChoiceResolver / expandChoices)
  ];
  // ЧАСТИЧНО: kind исполняется, но не полностью (чип+нарратив, один путь, лог-only).
  // Для классификатора покрытия такие фичи — категория «partial» / «needs_engine».
  const PARTIAL = [
    'boon',        // execute.ts: чип+нарратив, кость вводится диалогом кубов вручную
    'reroll',      // execute.ts: только нарратив (переброс — в диалоге кубов)
    'transform',   // execute.ts: чип+нарратив, стат-блок зверя не подменяется
    'movement',    // execute.ts: лог-only (нет модели позиций → ярус 4 EncounterState)
    'grant_action',// работает на ЛИСТЕ (доступ к действию по slug), НЕ в рантайм-роутере (#28)
  ];
  // НЕ реализованы: no-op/заглушка. Category needs_engine (ENG-01/ENG-02).
  const PLANNED = [
    'variable',    // no-op с нарративом «не реализована» (нет RuntimeState.variables) — ENG-01
    'set_die',     // it.todo (engine.coverage.mvp.test.ts) — ENG-02
  ];

  it('категории не пересекаются', () => {
    const all = [...HANDLED, ...PARTIAL, ...PLANNED];
    expect(all.length).toBe(new Set(all).size);
  });

  it('каждый исполняемый/частичный kind есть в схеме (иначе валидатор бракует рабочий контент)', () => {
    expect([...HANDLED, ...PARTIAL].filter((k) => !schemaKinds.includes(k))).toEqual([]);
  });

  it('каждый kind схемы категоризирован (handled | partial | planned)', () => {
    expect(schemaKinds.filter((k) =>
      !HANDLED.includes(k) && !PARTIAL.includes(k) && !PLANNED.includes(k),
    )).toEqual([]);
  });
});

describe('spellcasting_ability payload contract', () => {
  const meta = { id: 'spellcasting', name: 'Spellcasting', kind: 'passive_effect' as const };
  const mechanics = (payload: Record<string, unknown>) => ({
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result: [payload] }],
  });

  it('accepts a declared primary ability and the legacy source-choice template', () => {
    expect(validateMechanics(
      mechanics({ kind: 'spellcasting_ability', role: 'primary', ability: 'wis' }),
      meta,
    ).valid).toBe(true);
    expect(validateMechanics({
      activation: { mode: 'passive' },
      effects: [{
        kind: 'choice',
        id: 'source_spellcasting_ability',
        options: { source: 'ability' },
        grant: { kind: 'spellcasting_ability' },
      }],
    }, meta).valid).toBe(true);
  });

  it('rejects an invalid or missing ability for a primary declaration', () => {
    expect(validateMechanics(
      mechanics({ kind: 'spellcasting_ability', role: 'primary', ability: 'luck' }),
      meta,
    ).valid).toBe(false);
    expect(validateMechanics(
      mechanics({ kind: 'spellcasting_ability', role: 'primary' }),
      meta,
    ).valid).toBe(false);
  });
});
