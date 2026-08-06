import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import {
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from '../canon/prodSnapshotL1Fixtures';
import { armorClassValue } from '../engine/ac';
import { payloadsOf } from '../engine/mechanicsView';
import { collectModifiers } from '../engine/modifiers';
import type { Card, Feat, PassiveEffect } from '../types';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  archeryAttackRollBonus,
  bindMicroMvpFightingStyleProjection,
  createMicroMvpFightingStylePassiveMechanics,
  createMicroMvpProtectionCapabilityMechanics,
  defenseArmorClassBonus,
  protectionEffectAtTurnStart,
  protectionImposesDisadvantage,
  PROTECTION_REACTION_CAPABILITY,
  type FightingStyleProjectionBinding,
  type MicroMvpFightingStyleProjectionKind,
  resolveProtectionReaction,
  twoWeaponFightingDamageBonus,
} from './testing/fightingStyleFixtures';

interface PinnedStyleContext {
  feat: Feat;
  effect: PassiveEffect;
  root: CompiledMicroMvpL1Root;
  binding: FightingStyleProjectionBinding;
}

const STYLE_KINDS = [
  'archery',
  'defense',
  'twoWeaponFighting',
  'protection',
] as const satisfies readonly MicroMvpFightingStyleProjectionKind[];

function required<T>(value: T | undefined | null, label: string): T {
  if (value == null) throw new Error(`Missing pinned Fighting Style fixture: ${label}`);
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actorPassives(context: PinnedStyleContext): Record<string, unknown>[] {
  return context.root.actor.passives ?? [];
}

describe('pinned micro-MVP Fighting Style projection semantics', () => {
  let catalogs: SnapshotCatalogs;
  let contexts: Record<MicroMvpFightingStyleProjectionKind, PinnedStyleContext>;

  beforeAll(async () => {
    const provider = await compileMicroMvpL1Overlay();
    expect(provider.roots).toHaveLength(448);
    catalogs = readProdSnapshotCatalogs();
    const fighterRoot = required(
      provider.roots.find((root) => root.matrixCase.klass.card_number === 'CLASS-warrior'),
      'compiled Fighter root',
    );

    const pinned = STYLE_KINDS.map((kind) => {
      const identity = MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind];
      const feat = required(catalogs.feats.find((candidate) => (
        candidate.id === identity.featEntityId
          && candidate.card_number === identity.featCardNumber
      )), `${kind} feat ${identity.featCardNumber}/${identity.featEntityId}`);
      const effect = required(catalogs.effects.find((candidate) => (
        candidate.id === identity.effectEntityId
          && candidate.card_number === identity.effectCardNumber
      )), `${kind} effect ${identity.effectCardNumber}/${identity.effectEntityId}`);
      expect(feat.related_effects).toContain(effect.id);
      return { kind, feat, effect };
    });

    const variants = await compileMicroMvpL1ChoiceVariants(pinned.map(({ feat }) => ({
      stableKey: fighterRoot.stableKey,
      overrides: { fighter_fighting_style: [feat.id] },
    })));

    contexts = Object.fromEntries(pinned.map(({ kind, feat, effect }, index) => {
      const root = variants[index];
      const compiledFeat = required(root.assembled.feats.find((candidate) => (
        candidate.id === feat.id && candidate.card_number === feat.card_number
      )), `${kind} compiled feat`);
      const compiledEffect = required(root.assembled.effects.find((candidate) => (
        candidate.effect.id === effect.id
          && candidate.effect.card_number === effect.card_number
          && candidate.origin.kind === 'feat'
          && candidate.origin.id === compiledFeat.id
      )), `${kind} compiled effect with feat provenance`);
      expect(root.decisions).toContainEqual(expect.objectContaining({
        choiceId: expect.stringMatching(/:fighter_fighting_style$/),
        optionIds: [feat.id],
        provenance: 'overlay-policy',
      }));

      const binding = required(bindMicroMvpFightingStyleProjection({
        featEntityId: compiledFeat.id,
        featCardNumber: compiledFeat.card_number,
        relatedEffectEntityIds: compiledFeat.related_effects ?? [],
        effectEntityId: compiledEffect.effect.id,
        effectCardNumber: compiledEffect.effect.card_number,
      }), `${kind} structured projection binding`);
      expect(binding.kind).toBe(kind);
      expect(binding.sourceEntityIds).toEqual(
        MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind].sourceEntityIds,
      );
      return [kind, { feat, effect: compiledEffect.effect, root, binding }];
    })) as unknown as Record<MicroMvpFightingStyleProjectionKind, PinnedStyleContext>;
  }, 60_000);

  it('binds pinned Archery FEAT-0063/fs_archery to the ranged-weapon attack-roll projection', () => {
    const context = contexts.archery;
    const { feat, effect, binding } = context;
    expect([feat.id, feat.card_number, effect.id, effect.card_number]).toEqual([
      'bca8edf6-27ce-4399-8e34-bdadd59674b3', 'FEAT-0063',
      '76acce68-ebbe-4cef-ba2c-3ca4042c3656', 'fs_archery',
    ]);
    expect(binding.kind).toBe('archery');
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'weapon', weaponCategory: 'ranged',
    })).toBe(2);
    expect(archeryAttackRollBonus({
      roll: 'damage', attackKind: 'weapon', weaponCategory: 'ranged',
    })).toBe(0);
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'spell', weaponCategory: 'ranged',
    })).toBe(0);
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'weapon', weaponCategory: 'melee',
    })).toBe(0);
    const query = (roll: 'attack' | 'damage', attackKind: 'weapon' | 'spell',
      weaponCategory: 'ranged' | 'melee') => collectModifiers(
      context.root.actor.runtime,
      actorPassives(context),
      { roll, filter: { attackKind, weaponCategory } },
    ).modifiers;
    expect(query('attack', 'weapon', 'ranged')).toEqual([{
      value: 2, source: 'Fighting Style: Archery',
    }]);
    expect(query('damage', 'weapon', 'ranged')).toEqual([]);
    expect(query('attack', 'weapon', 'melee')).toEqual([]);
    expect(query('attack', 'spell', 'ranged')).toEqual([]);
  });

  it('binds pinned Defense FEAT-0056/fs_defense to the worn-armor AC projection', () => {
    const context = contexts.defense;
    const { feat, effect, binding } = context;
    expect([feat.id, feat.card_number, effect.id, effect.card_number]).toEqual([
      '25896e04-0c1d-4917-97fc-7feef7f836e1', 'FEAT-0056',
      '284c2459-dbe5-4ad5-9e06-c2417ab046a7', 'fs_defense',
    ]);
    expect(binding.kind).toBe('defense');
    expect(defenseArmorClassBonus('light')).toBe(1);
    expect(defenseArmorClassBonus('medium')).toBe(1);
    expect(defenseArmorClassBonus('heavy')).toBe(1);
    expect(defenseArmorClassBonus('none')).toBe(0);
    expect(defenseArmorClassBonus('shield')).toBe(0);
    expect(defenseArmorClassBonus('natural')).toBe(0);
    expect(context.root.ruleState.armorClass).toBe(contexts.archery.root.ruleState.armorClass);
    expect(context.root.actor.ac).toBe(contexts.archery.root.actor.ac);

    const unarmoredWithStyle = armorClassValue(
      context.root.actor.character,
      context.root.actor.runtime,
      actorPassives(context),
    ).value;
    const unarmoredWithoutStyle = armorClassValue(
      context.root.actor.character,
      context.root.actor.runtime,
      [],
    ).value;
    expect(unarmoredWithStyle - unarmoredWithoutStyle).toBe(0);

    const leather = required(
      catalogs.cards.find((card) => card.card_number === 'CARD-0249'),
      'pinned Light armor CARD-0249',
    ) as Card;
    const armoredRuntime = clone(context.root.actor.runtime);
    armoredRuntime.equipment.body = leather.id;
    const armoredCharacter = {
      ...context.root.actor.character,
      equippedCards: [leather],
      knownCards: [leather],
    };
    expect(armorClassValue(armoredCharacter, armoredRuntime, actorPassives(context)).value
      - armorClassValue(armoredCharacter, armoredRuntime, []).value).toBe(1);
  });

  it('binds pinned Two-Weapon Fighting FEAT-0061/fs_two_weapon to the Light extra-attack damage projection', () => {
    const context = contexts.twoWeaponFighting;
    const { feat, effect, binding } = context;
    expect([feat.id, feat.card_number, effect.id, effect.card_number]).toEqual([
      '440e7209-1602-415e-a5bb-e8bf42b3f720', 'FEAT-0061',
      '1ea32433-e3d0-4ab9-a8c0-cd159af6534d', 'fs_two_weapon',
    ]);
    expect(binding.kind).toBe('twoWeaponFighting');
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: true, bonus: 3 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'other',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: false, bonus: 0 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 3, abilityModifierAlreadyIncluded: true,
    })).toEqual({ applies: false, bonus: 0 });
    const damageModifiers = (extraAttackSource: 'light_property' | 'other',
      abilityModifierAlreadyIncluded: boolean) => collectModifiers(
      context.root.actor.runtime,
      actorPassives(context),
      {
        roll: 'damage',
        filter: { attackKind: 'weapon', extraAttackSource, abilityModifierAlreadyIncluded },
        formulaCtx: { weaponMod: 3 },
      },
    ).modifiers;
    expect(damageModifiers('light_property', false)).toEqual([{
      value: 3, source: 'Fighting Style: Two-Weapon Fighting',
    }]);
    expect(damageModifiers('other', false)).toEqual([]);
    expect(damageModifiers('light_property', true)).toEqual([]);
  });

  it('binds pinned Protection to a shield-gated Reaction for any other target', () => {
    const context = contexts.protection;
    const { feat, effect, binding } = context;
    expect([feat.id, feat.card_number, effect.id, effect.card_number]).toEqual([
      'c061b389-be25-439b-b9fc-71cfa43e195b', 'FEAT-0055',
      '48feb5da-5003-46b0-94b4-afa064182519', 'fs_protection',
    ]);
    expect(binding.kind).toBe('protection');
    expect(actorPassives(context).some((passive) => passive.id === 'fs_protection')).toBe(false);
    expect(context.root.rulesActions.some((action) => (
      action.sourceEntityIds.includes(effect.id)
    ))).toBe(false);
    expect(context.root.actor.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
      .toEqual(binding.sourceEntityIds);

    for (const targetRelationToDefender of ['ally', 'enemy', 'neutral'] as const) {
      const reaction = resolveProtectionReaction({
        triggeringAttackId: `goblin:attack:${targetRelationToDefender}`,
        sourceEntityIds: binding.sourceEntityIds,
        facts: {
        factsSource: 'scenario', boardRevision: 9,
        defenderActorId: 'fighter', attackerActorId: 'goblin', targetActorId: 'wizard',
          targetRelationToDefender, defenderDistanceToTargetFt: 5,
        defenderCanSeeAttacker: true, defenderHasEquippedShield: true,
        defenderReactionAvailable: true,
        },
      });
      expect(reaction.status, targetRelationToDefender).toBe('accepted');
      if (reaction.status !== 'accepted') continue;
      expect(reaction.effect.sourceEntityIds).toEqual(binding.sourceEntityIds);
      expect(protectionImposesDisadvantage(reaction.effect, {
        factsSource: 'scenario', boardRevision: 10, attackId: 'goblin:attack:2',
        targetActorId: 'wizard', defenderDistanceToProtectedTargetFt: 5,
      })).toBe(true);
      expect(protectionImposesDisadvantage(reaction.effect, {
        factsSource: 'scenario', boardRevision: 11, attackId: 'goblin:attack:3',
        targetActorId: 'wizard', defenderDistanceToProtectedTargetFt: 10,
      })).toBe(false);
      expect(protectionEffectAtTurnStart(reaction.effect, 'goblin')).toBe(reaction.effect);
      expect(protectionEffectAtTurnStart(reaction.effect, 'fighter')).toBeNull();
    }
  });

  it('replaces every legacy payload with its exact pinned structured projection', () => {
    for (const kind of ['archery', 'defense', 'twoWeaponFighting'] as const) {
      const context = contexts[kind];
      expect(context.effect.mechanics).toEqual(
        createMicroMvpFightingStylePassiveMechanics(context.binding),
      );
      expect(payloadsOf(context.effect.mechanics).some((payload) => (
        payload.kind === 'narrative'
      ))).toBe(false);
      expect(actorPassives(context)).toContainEqual(expect.objectContaining({
        id: MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind].effectCardNumber,
        sourceEntityIds: context.binding.sourceEntityIds,
      }));
    }
    const protection = contexts.protection;
    expect(protection.effect.mechanics).toEqual(
      createMicroMvpProtectionCapabilityMechanics(protection.binding),
    );
    expect(payloadsOf(protection.effect.mechanics)).toEqual([]);
    expect(protection.root.actor.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
      .toEqual(protection.binding.sourceEntityIds);
  });
});
