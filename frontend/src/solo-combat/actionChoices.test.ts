import { describe, expect, it } from 'vitest';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import type { Card } from '../types';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import { weaponContext } from '../engine/weapon';
import { compileWeaponMasteryEffects, weaponMasteryPrimitive } from '../engine/weaponMastery2024';
import { parseDeclaredWeaponActionPolicy } from '../rules-core/weaponActionPolicies';
import { parseWeaponProfile } from '../engine/weaponProfile';
import {
  UNARMED_STRIKE_CHOICE_ID,
  collectSoloCombatActionChoices,
  immediateSoloCombatTargetIds,
  projectSoloCombatActionChoices,
} from './actionChoices';
import { STONEWORK_CONTACT_CHOICE_ID } from '../mechanics/collectChoices';
import type { SoloCombatState } from './types';

describe('solo combat data-owned action choices', () => {
  it('offers every canonical Unarmed Strike option only for the exact basic-action entity', () => {
    const action = {
      id: 'action:unarmed', name: 'Безоружный удар', kind: 'nonSpell',
      sourceEntityIds: ['action:unarmed'], mechanics: {},
    } as RuleActionDefinition;
    expect(collectSoloCombatActionChoices(
      {} as ActorState,
      action,
      'action_basic_unarmed',
    )).toEqual([expect.objectContaining({
      id: UNARMED_STRIKE_CHOICE_ID,
      recommended: ['damage'],
      items: [
        { id: 'damage', name: 'Нанести урон' },
        { id: 'grapple', name: 'Схватить' },
        { id: 'shove', name: 'Толкнуть' },
      ],
    })]);
    expect(collectSoloCombatActionChoices(
      {} as ActorState,
      action,
      'another_action',
    )).toEqual([]);
  });

  it('projects the equipped weapon mastery declaration into a one-shot choice', () => {
    const masteryId = 'effect:slow';
    const weapon = withDeclaredTestWeaponProfile({
      id: 'card:bow', card_number: 'CARD-bow', name: 'Bow', type: 'weapon',
    } as unknown as Card, {
      weaponType: 'longbow', proficiencyCategory: 'martial', attackAbility: 'dex',
      damageLines: [{ dice: '1d8', type: 'piercing' }],
      defaultAttackMode: 'ranged',
      attackModes: [{ kind: 'ranged', normal_ft: 150, long_ft: 600 }],
      properties: ['ammunition', 'two_handed'], masteryEffectId: masteryId,
      ammo: { card_id: 'card:arrows', name: 'Arrows' },
    });
    const actor = {
      id: 'actor', character: {
        abilityMods: { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 },
        profBonus: 2, level: 1, knownCards: [weapon], equippedCards: [weapon],
        weaponMasteries: ['longbow'],
      },
      runtime: {
        hp: { current: 10, max: 10, temp: 0 }, resources: { action: 1 },
        maxResources: { action: 1 }, equipment: { main_hand: weapon.id },
        inventory: [], activeEffects: [],
      },
      masteryEffects: {
        [masteryId]: {
          id: masteryId,
          card_number: 'EFFECT-SLOW',
          name: 'Slowing mastery',
          mechanics: { weapon_mastery: {
            type: 'slow', penaltyFt: 10, requiresDamage: true,
            expires: 'start_of_source_next_turn', choiceId: 'apply-slow',
          } },
        },
      },
    } as unknown as ActorState;
    const action = {
      id: 'action:weapon', name: 'Weapon attack', kind: 'nonSpell', sourceEntityIds: ['action:weapon'],
      mechanics: {
        primitive: { type: 'weapon_attack' },
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 600, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', ability: 'auto', attack_kind: 'weapon_ranged', vs: 'ac',
          on_hit: [{ kind: 'damage', dice: 'weapon', ability: 'auto', type: 'weapon' }],
        }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 600,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
    } as RuleActionDefinition;

    expect(parseDeclaredWeaponActionPolicy(action, 'bound')).toMatchObject({ status: 'valid' });
    expect(parseWeaponProfile(weapon)).toMatchObject({ valid: true });
    const equipped = weaponContext(actor.character, 'main', actor.runtime.equipment, actor.runtime)!;
    expect(equipped).toMatchObject({ weaponType: 'longbow', mastery: masteryId });
    const slow = weaponMasteryPrimitive(
      actor.masteryEffects?.[masteryId]?.mechanics as Record<string, unknown>,
    )!;
    expect(slow).toMatchObject({ type: 'slow', choiceId: 'apply-slow' });
    expect(collectSoloCombatActionChoices(actor, action)).toEqual([
      expect.objectContaining({
        id: 'apply-slow', recommended: ['use'],
        items: [{ id: 'use', name: 'Применить' }, { id: 'skip', name: 'Не применять' }],
      }),
    ]);
    expect(compileWeaponMasteryEffects(slow, {
      weapon: equipped, weaponMod: 3, dealtDamage: true,
      sourceEntityId: masteryId, sourceEntityCardNumber: 'EFFECT-SLOW',
      choices: { 'apply-slow': ['skip'] },
    })).toEqual([]);
    expect(compileWeaponMasteryEffects(slow, {
      weapon: equipped, weaponMod: 3, dealtDamage: true,
      sourceEntityId: masteryId, sourceEntityCardNumber: 'EFFECT-SLOW',
      choices: { 'apply-slow': ['use'] },
    })).toHaveLength(1);

    actor.masteryEffects![masteryId]!.mechanics = { weapon_mastery: {
      type: 'push', maxDistanceFt: 10, maxTargetSize: 'large', choiceId: 'push-distance',
    } };
    expect(collectSoloCombatActionChoices(actor, action)).toEqual([
      expect.objectContaining({
        id: 'push-distance', recommended: ['10'],
        items: [
          { id: 'skip', name: 'Не применять' },
          { id: '5', name: '5 фт.' },
          { id: '10', name: '10 фт.' },
        ],
      }),
    ]);
    const push = weaponMasteryPrimitive(
      actor.masteryEffects![masteryId]!.mechanics as Record<string, unknown>,
    )!;
    expect(compileWeaponMasteryEffects(push, {
      weapon: equipped, weaponMod: 3, targetSize: 2,
      choices: { 'push-distance': ['skip'] },
    })).toEqual([]);
    expect(compileWeaponMasteryEffects(push, {
      weapon: equipped, weaponMod: 3, targetSize: 2,
      choices: { 'push-distance': ['5'] },
    })).toEqual([expect.objectContaining({
      result: [{ kind: 'movement', value: 'push', distance: 5 }],
    })]);

    for (const declaration of [{
      type: 'topple', saveAbility: 'con', dc: '8+prof_bonus+weapon_mod',
      condition: 'prone', choiceId: 'apply-topple',
    }, {
      type: 'graze', damage: 'max(weapon_mod,0)', choiceId: 'apply-graze',
    }]) {
      actor.masteryEffects![masteryId]!.mechanics = { weapon_mastery: declaration };
      expect(collectSoloCombatActionChoices(actor, action)).toEqual([
        expect.objectContaining({
          id: declaration.choiceId,
          items: [
            { id: 'use', name: 'Применить' },
            { id: 'skip', name: 'Не применять' },
          ],
        }),
      ]);
    }
  });

  it('keeps ordinary mechanics-owned in-play choices in the same flow', () => {
    const action = {
      id: 'action:item', name: 'Open container', kind: 'nonSpell', sourceEntityIds: ['item'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [{ resolution: 'auto', result: [{
          kind: 'choice', id: 'container', context: 'in_play', count: 1,
          prompt: 'Choose', options: { source: 'explicit', items: [{ id: 'one', name: 'One' }] },
        }] }],
      },
    } as RuleActionDefinition;
    expect(collectSoloCombatActionChoices({} as ActorState, action))
      .toEqual([expect.objectContaining({ id: 'container', context: 'in_play' })]);
  });

  it('asks which temporary HP to keep before Armor of Agathys executes', () => {
    const action = {
      id: 'spell:armor-of-agathys', name: 'Доспех Агатиса', kind: 'spell',
      sourceEntityIds: ['spell:armor-of-agathys'],
      spell: { level: 1, classListIds: ['class:warlock'] },
      mechanics: { primitive: { type: 'temporary_hp_melee_retaliation' } },
    } as RuleActionDefinition;

    expect(collectSoloCombatActionChoices({} as ActorState, action)).toEqual([
      expect.objectContaining({
        id: 'temporary_hp',
        recommended: ['take_spell'],
        items: [
          { id: 'take_spell', name: 'Принять временные хиты заклинания' },
          { id: 'keep_current', name: 'Сохранить текущие временные хиты' },
        ],
      }),
    ]);
    expect(projectSoloCombatActionChoices(action, {
      temporary_hp: ['take_spell'],
    })).toEqual({ temporary_hp: 'take_spell' });
  });

  it('asks for a pinned Wild Companion form and executes without a map target', () => {
    const action = {
      id: 'action:wild-companion', name: 'Дикий спутник', kind: 'nonSpell',
      sourceEntityIds: ['EFF-wild-companion'],
      mechanics: {
        primitive: {
          type: 'wild_companion',
          policy: {
            connection_range_ft: 100,
            reappear_range_ft: 30,
            ritual_casting_added_seconds: 600,
          },
        },
      },
      targeting: {
        minTargets: 0, maxTargets: 0, rangeFt: 10,
        requiresLineOfSight: false, allowedRelations: [],
      },
    } as RuleActionDefinition;

    const choices = collectSoloCombatActionChoices({} as ActorState, action);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      id: 'find_familiar_form', prompt: 'Форма дикого спутника', count: 1,
    });
    expect(choices[0].items).toHaveLength(11);
    expect(projectSoloCombatActionChoices(action, {
      find_familiar_form: ['owl'],
    })).toEqual({ find_familiar_form: 'owl' });
    expect(immediateSoloCombatTargetIds(action, 'druid')).toEqual([]);
  });

  it('asks for explicit Stonecunning terrain facts before immediate self execution', () => {
    const action = {
      id: 'action:stonecunning', name: 'Камнечувствие', kind: 'nonSpell',
      sourceEntityIds: ['RE-dwarf-4'],
      mechanics: {
        targeting: {
          domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0,
          max_targets: 1, range_ft: 0, requires_line_of_sight: false,
          allowed_relations: ['self'], requires_stonework_contact: true,
        },
        effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }],
      },
      targeting: {
        minTargets: 0, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
        requiresStoneworkContact: true,
      },
    } as RuleActionDefinition;
    expect(collectSoloCombatActionChoices({} as ActorState, action)).toEqual([
      expect.objectContaining({ id: STONEWORK_CONTACT_CHOICE_ID }),
    ]);
    expect(collectSoloCombatActionChoices({} as ActorState, action)[0])
      .not.toHaveProperty('recommended');
    expect(immediateSoloCombatTargetIds(action, 'dwarf')).toEqual(['dwarf']);
  });

  it('distinguishes zero-target, self, and map-targeted action contracts', () => {
    const action = (targeting: RuleActionDefinition['targeting'], shape: string) => ({
      id: shape, name: shape, kind: 'nonSpell', sourceEntityIds: [shape],
      mechanics: { targeting: { shape } }, targeting,
    }) as RuleActionDefinition;
    expect(immediateSoloCombatTargetIds(action({
      minTargets: 0, maxTargets: 0, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: [],
    }, 'single'), 'hero')).toEqual([]);
    expect(immediateSoloCombatTargetIds(action({
      minTargets: 0, maxTargets: 1, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: ['self'],
    }, 'self'), 'hero')).toEqual(['hero']);
    expect(immediateSoloCombatTargetIds(action({
      minTargets: 1, maxTargets: 1, rangeFt: 30,
      requiresLineOfSight: true, allowedRelations: ['enemy'],
    }, 'single'), 'hero')).toBeNull();

    const worldArea = action({
      minTargets: 0, maxTargets: 0, rangeFt: 60,
      requiresLineOfSight: true, allowedRelations: [],
    }, 'area');
    worldArea.mechanics.effects = [{
      resolution: 'auto',
      result: [{ kind: 'world_zone', zone_type: 'grease' }],
    }];
    expect(immediateSoloCombatTargetIds(worldArea, 'hero')).toBeNull();
  });

  it('resolves self-centered emanations immediately from the actor position', () => {
    const emanation = {
      id: 'turn-undead', name: 'Turn Undead', kind: 'nonSpell', sourceEntityIds: ['turn-undead'],
      mechanics: {
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'area', range_ft: 0,
          allowed_relations: ['enemy'], area: { kind: 'emanation', radius_ft: 30 },
        },
      },
      targeting: {
        minTargets: 1, maxTargets: 20, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['enemy'],
      },
    } as RuleActionDefinition;
    const state = {
      characterId: 'cleric',
      sideByActorId: { cleric: 'player', skeleton: 'enemy', distant: 'enemy' },
      world: { actors: {
        cleric: { id: 'cleric', runtime: { hp: { current: 10 } } },
        skeleton: { id: 'skeleton', runtime: { hp: { current: 10 } } },
        distant: { id: 'distant', runtime: { hp: { current: 10 } } },
      } },
      tokens: {
        cleric: { actorId: 'cleric', side: 'player', position: { x: 4, y: 4 } },
        skeleton: { actorId: 'skeleton', side: 'enemy', position: { x: 5, y: 4 } },
        distant: { actorId: 'distant', side: 'enemy', position: { x: 11, y: 9 } },
      },
    } as unknown as SoloCombatState;
    expect(immediateSoloCombatTargetIds(emanation, 'cleric', state)).toEqual(['skeleton']);
  });

  it('does not request a map click for a source-anchored world-zone emanation', () => {
    const radiance = {
      id: 'radiance', name: 'Radiance', kind: 'nonSpell', sourceEntityIds: ['radiance'],
      mechanics: {
        targeting: { shape: 'self' },
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'radiance',
          tactical: { anchor: 'source', triggers: ['end_turn'] },
        }] }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
      },
    } as RuleActionDefinition;
    expect(immediateSoloCombatTargetIds(radiance, 'hero')).toEqual(['hero']);
  });

  it('keeps a self-shaped teleport in map-targeting mode so the player chooses a destination', () => {
    const teleport = {
      id: 'teleport', name: 'Телепортация', kind: 'spell', spell: { level: 0 },
      sourceEntityIds: ['teleport'],
      mechanics: {
        targeting: { shape: 'self' },
        effects: [{
          resolution: 'auto',
          result: [{ kind: 'movement', value: 'teleport', distance: '15' }],
        }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
      },
    } as RuleActionDefinition;
    expect(immediateSoloCombatTargetIds(teleport, 'hero')).toBeNull();
  });
});
