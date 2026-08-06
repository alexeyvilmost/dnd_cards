import { describe, expect, it } from 'vitest';
import {
  getSystemActionDefinition,
  isSystemActionId,
  SYSTEM_ACTION_DEFINITIONS,
  SYSTEM_ACTION_IDS,
  type SystemActionIntent,
  type SystemActionResolutionIntent,
} from './systemActions';

function expectDeeplyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectDeeplyFrozen);
}

describe('D&D 2024 ruleset-owned system actions', () => {
  it('publishes the complete stable ID set exactly once in canonical order', () => {
    expect(SYSTEM_ACTION_IDS).toEqual({
      attack: 'core.action.attack',
      weaponAttack: 'core.attack.weapon',
      lightExtraAttack: 'core.bonus-action.light-extra-attack',
      unarmedDamage: 'core.attack.unarmed.damage',
      unarmedGrapple: 'core.attack.unarmed.grapple',
      unarmedShove: 'core.attack.unarmed.shove',
      escapeGrapple: 'core.action.escape-grapple',
      releaseGrapple: 'core.free.release-grapple',
    });
    expect(SYSTEM_ACTION_DEFINITIONS.map(({ id }) => id)).toEqual(
      Object.values(SYSTEM_ACTION_IDS),
    );
    expect(new Set(SYSTEM_ACTION_DEFINITIONS.map(({ id }) => id)).size).toBe(8);
  });

  it('keeps every definition and nested rule fact immutable and JSON serializable', () => {
    expectDeeplyFrozen(SYSTEM_ACTION_IDS);
    expectDeeplyFrozen(SYSTEM_ACTION_DEFINITIONS);
    SYSTEM_ACTION_DEFINITIONS.forEach(expectDeeplyFrozen);
    expect(JSON.parse(JSON.stringify(SYSTEM_ACTION_DEFINITIONS)))
      .toEqual(SYSTEM_ACTION_DEFINITIONS);
    expect(() => {
      (SYSTEM_ACTION_DEFINITIONS[0] as { name: string }).name = 'DB override';
    }).toThrow(TypeError);
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.attack)?.name).toBe('Attack');
  });

  it('makes the Attack budget actor-owned and one Action, with 2024 equip/movement hooks', () => {
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.attack)).toEqual(expect.objectContaining({
      kind: 'attack_action',
      timing: 'action',
      actionCost: 1,
      attackBudgetSource: 'compiled_actor_profile',
      weaponEquipAllowance: 'one_before_or_after_each_attack',
      movementBetweenAttacks: true,
      targeting: { shape: 'self', rangeFt: 0 },
    }));
  });

  it('defines a weapon entry without a second Action cost or content-owned mechanics', () => {
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.weaponAttack)).toEqual(expect.objectContaining({
      kind: 'attack_entry',
      timing: 'attack_entry',
      entryKind: 'weapon_attack',
      consumesAttacks: 1,
      resolution: 'attack_roll',
      weaponRequirement: 'owned_equipped_weapon',
      proficiencyRule: 'weapon_proficiency',
      targeting: { shape: 'single_creature', rangeFt: 'equipped_weapon' },
    }));
  });

  it('owns the Light-property extra attack and its one Bonus Action damage rule', () => {
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.lightExtraAttack)).toEqual(
      expect.objectContaining({
        kind: 'light_property_extra_attack',
        timing: 'bonus_action',
        bonusActionCost: 1,
        resolution: 'attack_roll',
        qualifyingSource: 'persisted_attack_action_light_weapon_entry',
        extraWeaponRequirement: 'different_owned_equipped_light_weapon',
        abilityModifierRule: 'omit_unless_two_weapon_fighting',
        maximumPerAttackAction: 1,
      }),
    );
  });

  it('defines exact Damage, Grapple and Shove branches of Unarmed Strike', () => {
    const damage = getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedDamage);
    expect(damage).toEqual(
      expect.objectContaining({
        entryKind: 'unarmed_strike',
        unarmedOption: 'damage',
        consumesAttacks: 1,
        resolution: 'attack_roll',
        attackAbility: 'str',
        proficiencyRule: 'always',
        damageFormula: 'max(0,1+str)',
        damageType: 'bludgeoning',
        requiresFreeHand: false,
        targeting: { shape: 'single_creature', rangeFt: 5 },
      }),
    );
    expect(damage).not.toHaveProperty('maxTargetSizeDifference');
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedGrapple)).toEqual(
      expect.objectContaining({
        entryKind: 'unarmed_strike',
        unarmedOption: 'grapple',
        resolution: 'saving_throw',
        saveAbilityOptions: ['str', 'dex'],
        saveDcFormula: '8+str+prof',
        targetMayVoluntarilyFailSave: true,
        maxTargetSizeDifference: 1,
        requiresFreeHand: true,
        grappleCapacityPerPart: 1,
        failedSaveEffect: 'grappled',
        escapeDcFormula: '8+str+prof',
        automaticEndTriggers: ['grappler_incapacitated', 'distance_exceeds_range'],
      }),
    );
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedShove)).toEqual(
      expect.objectContaining({
        entryKind: 'unarmed_strike',
        unarmedOption: 'shove',
        resolution: 'saving_throw',
        saveAbilityOptions: ['str', 'dex'],
        saveDcFormula: '8+str+prof',
        targetMayVoluntarilyFailSave: true,
        maxTargetSizeDifference: 1,
        requiresFreeHand: false,
        failedSaveChoices: ['push_5ft', 'prone'],
      }),
    );
  });

  it('defines the complete authoritative Grapple exit lifecycle', () => {
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.escapeGrapple)).toEqual(
      expect.objectContaining({
        kind: 'grapple_lifecycle',
        timing: 'action',
        actionCost: 1,
        resolution: 'ability_check',
        skillOptions: ['athletics', 'acrobatics'],
        dcSource: 'persisted_grapple_escape_dc',
      }),
    );
    expect(getSystemActionDefinition(SYSTEM_ACTION_IDS.releaseGrapple)).toEqual(
      expect.objectContaining({
        kind: 'grapple_lifecycle',
        timing: 'free',
        actionCost: 0,
        resolution: 'automatic',
        controller: 'grappler',
        allowedAtAnyTime: true,
        targeting: { shape: 'grapple_relation', rangeFt: 0 },
      }),
    );
  });

  it('resolves only canonical IDs and cannot be shadowed by an arbitrary catalog ID', () => {
    for (const id of Object.values(SYSTEM_ACTION_IDS)) {
      expect(isSystemActionId(id)).toBe(true);
      expect(getSystemActionDefinition(id)?.id).toBe(id);
      expect(getSystemActionDefinition(id)?.sourceEntityIds).toEqual([
        expect.stringMatching(/^system:dnd5e-2024:/),
      ]);
    }
    expect(isSystemActionId('db.action.attack')).toBe(false);
    expect(getSystemActionDefinition('db.action.attack')).toBeUndefined();
  });

  it('exposes reference-only future intents without accepting mechanics or attack budgets', () => {
    const intents: SystemActionIntent[] = [
      { type: 'begin_attack_action' },
      {
        type: 'weapon_attack_entry',
        attackActionId: 'attack:1',
        weaponCardId: 'card:longsword',
        targetActorId: 'target',
      },
      {
        type: 'light_property_extra_attack',
        attackActionId: 'attack:1',
        weaponCardId: 'card:scimitar',
        targetActorId: 'target',
      },
      {
        type: 'unarmed_strike_entry',
        attackActionId: 'attack:1',
        option: 'grapple',
        targetActorId: 'target',
      },
      { type: 'escape_grapple', grappleId: 'grapple:1', skill: 'acrobatics' },
      { type: 'release_grapple', grappleId: 'grapple:1' },
    ];
    expect(intents.map(({ type }) => type)).toEqual([
      'begin_attack_action',
      'weapon_attack_entry',
      'light_property_extra_attack',
      'unarmed_strike_entry',
      'escape_grapple',
      'release_grapple',
    ]);
    const resolutions: SystemActionResolutionIntent[] = [
      { type: 'resolve_str_dex_save', selectedAbility: 'dex', resolution: 'voluntary_failure' },
      {
        type: 'choose_shove_outcome',
        attackActionId: 'attack:1',
        entryOrdinal: 1,
        outcome: 'prone',
      },
    ];
    expect(resolutions.map(({ type }) => type)).toEqual([
      'resolve_str_dex_save',
      'choose_shove_outcome',
    ]);
  });
});
