import { describe, expect, it } from 'vitest';
import contentPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import compiledFixture from '../pages/rulesLabFixture.generated.json';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { canonicalStringify } from '../rules-core/determinism';
import type { CharacterContext } from '../mvp/contracts';
import type { Action, Card, CharacterClass, Feat, PassiveEffect, Spell } from '../types';
import { collectChoices, type ChoiceOrigin } from '../mechanics/collectChoices';
import { collectSheetPrimitiveChoices } from './sheetActionOrchestrator';
import { collectSheetActions, type SheetAction } from './actionSheet';
import type { AssembledCharacter } from './assemble';
import {
  buildSheetCanonicalRuntime,
  projectSheetCanonicalPersistence,
  readSheetCanonicalWorld,
  SHEET_CANONICAL_WORLD_KEY,
  writeSheetCanonicalWorld,
} from './sheetCanonicalWorld';
import {
  FIND_FAMILIAR_MATERIAL_RESOURCE,
  materializeCanonicalFamiliarActor,
  pactChainProjection,
} from '../rules-core/familiarRuntime';
import { castFindFamiliar } from '../rules-core/findFamiliar';
import { SHEET_SPELL_CAST_CHOICE } from './sheetSpellCastingUi';
import { sourceKey } from '../mechanics/choiceKey';
import type { CharacterRuleState } from './rules/types';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import { emptyDraft } from './types';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { bindEquippedWeaponAmmoCost } from '../engine/weapon';
import { pay } from '../engine/cost';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import { writeSheetSpellPreparation } from './sheetSpellPreparation';

type PatchRow = {
  entityId: string;
  cardNumber: string;
  mechanics: Record<string, unknown>;
};

const effectPatches = contentPatch.mechanicsPatches.effects as PatchRow[];
const actionPatches = contentPatch.mechanicsPatches.actions as PatchRow[];
const spellPatches = contentPatch.mechanicsPatches.spells as PatchRow[];
const createdActions = contentPatch.createEntities
  .filter((candidate) => candidate.collection === 'actions')
  .map((candidate) => candidate.entity as unknown as Action);
const generated = compiledFixture as unknown as {
  roots: Record<string, {
    actor: ActorState;
    actions: RuleActionDefinition[];
    initialWorldObjects: unknown[];
  }>;
  execution: {
    scenarios: {
      chain: { findFamiliarActionId: string };
    };
  };
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function legacySheetContentHash(
  systemId: string,
  rulesetVersion: string,
  contentIdentity: unknown,
): string {
  const value = canonicalStringify(contentIdentity);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `sheet:${systemId}:${rulesetVersion}:fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function patchEffect(cardNumber: string): PassiveEffect {
  const row = effectPatches.find((candidate) => candidate.cardNumber === cardNumber);
  if (!row) throw new Error(`Missing content patch ${cardNumber}`);
  return {
    id: row.entityId,
    card_number: row.cardNumber,
    name: row.cardNumber,
    description: row.cardNumber,
    rarity: 'common',
    effect_type: 'class_ability',
    mechanics: clone(row.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function patchAction(cardNumber: string): Action {
  const created = createdActions.find((candidate) => candidate.card_number === cardNumber);
  if (created) return clone(created);
  const row = actionPatches.find((candidate) => candidate.cardNumber === cardNumber);
  if (!row) throw new Error(`Missing content patch ${cardNumber}`);
  return {
    id: row.entityId,
    card_number: row.cardNumber,
    name: cardNumber,
    description: cardNumber,
    rarity: 'common',
    resource: 'action',
    action_type: 'base_action',
    type: 'basic',
    mechanics: clone(row.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function spellFromAction(action: RuleActionDefinition): Spell {
  if (action.kind !== 'spell') throw new Error(`${action.id} is not a spell`);
  const entityId = action.sourceEntityIds[0];
  const patch = spellPatches.find((candidate) => candidate.entityId === entityId);
  return {
    id: entityId,
    card_number: patch?.cardNumber ?? entityId,
    name: action.name,
    description: action.name,
    rarity: 'common',
    level: action.spell.level,
    component_verbal: action.spell.components?.verbal ?? false,
    component_somatic: action.spell.components?.somatic ?? false,
    component_material: action.spell.components?.material ?? false,
    classes: [...(action.spell.classListIds ?? [])],
    concentration: action.concentration === true,
    ritual: action.spell.ritual === true,
    is_healing: false,
    // The generated fixture is intentionally regenerated only once after all
    // parallel changes have frozen.  Until then, materialize this local sheet
    // fixture from the current production-data patch so strict targeting does
    // not inherit legacy/defaulted fields from the previous generated release.
    mechanics: clone(patch?.mechanics ?? action.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function sheetSpell(action: RuleActionDefinition): SheetAction {
  const spell = spellFromAction(action);
  return {
    id: action.id,
    name: action.name,
    mechanics: clone(spell.mechanics ?? action.mechanics),
    group: 'spell',
    spellRef: spell,
    sourceEntityIds: [...action.sourceEntityIds] as [string, ...string[]],
  };
}

function warlockClass(): CharacterClass {
  return {
    id: 'class-entity:warlock',
    card_number: 'CLASS-warlock',
    name: 'Warlock',
    description: '',
    rarity: 'common',
    created_at: '',
    updated_at: '',
  };
}

function wizardClass(): CharacterClass {
  return {
    id: 'd3b22b24-a4f1-4dab-8038-c89bfee62843',
    card_number: 'CLASS-wizard',
    name: 'Переименованный волшебник',
    description: '',
    rarity: 'common',
    created_at: '',
    updated_at: '',
  };
}

function assembled(input: {
  effect: PassiveEffect;
  spells?: Spell[];
  pendingChoices?: ReturnType<typeof collectChoices>;
}): AssembledCharacter {
  return {
    klass: warlockClass(),
    effects: [{
      effect: input.effect,
      origin: { kind: 'class', id: 'class-entity:warlock', name: 'Warlock' },
    }],
    spells: input.spells ?? [],
    pendingChoices: input.pendingChoices ?? [],
    race: null,
    background: null,
    feats: [],
    actions: [],
    resources: [],
    featAbilityIncreases: [],
    variables: {},
    derived: {
      proficiencyBonus: 2,
      maxHP: 10,
      initiative: 0,
      ac: 10,
      speed: 30,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 },
      spellcasting: null,
    },
  } as unknown as AssembledCharacter;
}

function character(
  actorId: string,
  resolvedChoices: Record<string, string[]> = {},
  currency?: Record<string, number>,
) {
  return {
    id: actorId,
    name: actorId,
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    turn_state: null,
    resolved_choices: resolvedChoices,
    ...(currency ? { currency } : {}),
  };
}

function spellRuleState(
  effect: PassiveEffect,
  spells: readonly Spell[],
  labels: Readonly<Record<string, string | undefined>> = {},
): Pick<CharacterRuleState, 'appliedGrants'> {
  const sourceId = sourceKey('class', 'class-entity:warlock', effect.id);
  return {
    appliedGrants: spells.map((spell, index) => ({
      id: `grant:${index}:${spell.id}`,
      source: {
        type: 'class',
        id: sourceId,
        name: `Warlock: ${effect.name}`,
        originEntityId: 'class-entity:warlock',
        featureEntityId: effect.id,
      },
      kind: 'spell',
      value: spell.id,
      mode: 'proficiency',
      spellcastingAbility: 'cha',
      ...(labels[spell.id] ? { label: labels[spell.id] } : {}),
    })),
  };
}

function wizardRuleState(
  effect: PassiveEffect,
  spells: readonly Spell[],
): Pick<CharacterRuleState, 'appliedGrants'> {
  const klass = wizardClass();
  const sourceId = sourceKey('class', klass.id, effect.id);
  return {
    appliedGrants: spells.map((spell, index) => ({
      id: `wizard-grant:${index}:${spell.id}`,
      source: {
        type: 'class',
        id: sourceId,
        name: `Display text is not identity: ${effect.name}`,
        originEntityId: klass.id,
        featureEntityId: effect.id,
      },
      kind: 'spell',
      value: spell.id,
      mode: 'proficiency',
      spellcastingAbility: 'int',
      label: spell.level === 0 ? 'cantrip' : 'spellbook',
    })),
  };
}

describe('real sheet canonical world materialization', () => {
  it('projects feat and Fighting Style capability provenance into the real sheet actor', () => {
    const cases = [
      {
        feat: {
          id: 'feat:alert', card_number: 'FEAT-0001', name: 'Alert', category: 'origin',
          related_effects: ['effect:alert'],
        },
        effect: {
          id: 'effect:alert', card_number: 'EFF-alert', name: 'Alert',
          mechanics: { capabilities: [{ id: 'alert.initiative_swap' }] },
        },
        capabilityId: 'alert.initiative_swap',
      },
      {
        feat: {
          id: 'feat:protection', card_number: 'FEAT-0055', name: 'Protection',
          category: 'fighting_style', related_effects: ['effect:protection'],
        },
        effect: {
          id: 'effect:protection', card_number: 'fs_protection', name: 'Protection',
          mechanics: { capabilities: [{ id: 'fighting_style.protection.reaction' }] },
        },
        capabilityId: 'fighting_style.protection.reaction',
      },
      {
        feat: {
          id: 'feat:interception', card_number: 'FEAT-0057', name: 'Interception',
          category: 'fighting_style', related_effects: ['effect:interception'],
        },
        effect: {
          id: 'effect:interception', card_number: 'fs_interception', name: 'Interception',
          mechanics: { capabilities: [{ id: 'fighting_style.interception.reaction' }] },
        },
        capabilityId: 'fighting_style.interception.reaction',
      },
    ] as const;

    for (const testCase of cases) {
      const feat = {
        ...testCase.feat,
        description: '', rarity: 'common', repeatable: false, created_at: '', updated_at: '',
      } as unknown as Feat;
      const effect = {
        ...testCase.effect,
        description: '', rarity: 'common', effect_type: 'class_ability', created_at: '', updated_at: '',
      } as unknown as PassiveEffect;
      const baseAssembly = assembled({ effect });
      const built = buildSheetCanonicalRuntime({
        character: character(`sheet-${testCase.capabilityId}`),
        assembled: {
          ...baseAssembly,
          klass: null,
          feats: [feat],
          effects: [{
            effect,
            origin: { kind: 'feat', id: feat.id, name: feat.name },
          }],
        },
        ruleState: { appliedGrants: [] },
        sheetActions: [],
        runtime: {
          hp: { current: 10, max: 10, temp: 0 },
          resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [],
        },
        characterContext: {
          abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
          profBonus: 2,
          level: 1,
        } as CharacterContext,
      });

      expect(built.world.actors[built.actorId].capabilities.featureSources?.[testCase.capabilityId])
        .toEqual([feat.id, feat.card_number, effect.id, effect.card_number]);
    }
  });

  it('keeps bound ammunition in canonical activation.cost and pays it as an item', () => {
    const entity = patchAction('action_basic_weapon_ranged');
    const bow = withDeclaredTestWeaponProfile({
      id: 'card:bow', card_number: 'CARD-bow', name: 'Bow', type: 'weapon',
    } as unknown as Card, {
      weaponType: 'shortbow', proficiencyCategory: 'simple', attackAbility: 'dex',
      damageLines: [{ dice: '1d6', type: 'piercing' }],
      defaultAttackMode: 'ranged',
      attackModes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
      properties: ['ammunition', 'two_handed'], masteryEffectId: 'effect:test:vex',
      ammo: { card_id: 'card:arrow', name: 'Arrows' },
    });
    const arrow = {
      id: 'card:arrow', card_number: 'CARD-arrow', name: 'Arrows', type: 'item',
    } as unknown as Card;
    const unrelatedCards = Array.from({ length: 790 }, (_, index) => ({
      id: `card:unrelated:${index}`,
      card_number: `CARD-unrelated-${index}`,
      name: `Unrelated ${index}`,
      description: 'x'.repeat(2_000),
      type: 'item',
    } as unknown as Card));
    const mechanics = bindEquippedWeaponAmmoCost(
      entity.mechanics as Record<string, unknown>,
      { main_hand: bow.id },
      new Map([[bow.id, bow], [arrow.id, arrow]]),
    );
    const sheetAction: SheetAction = {
      id: entity.id,
      name: entity.name,
      mechanics,
      group: 'basic',
      actionRef: entity,
      sourceEntityIds: [entity.id, entity.card_number],
    };
    const baseAssembly = assembled({ effect: patchEffect('EFF-pact-blade') });
    const runtime = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: { main_hand: bow.id },
      inventory: [{ cardId: arrow.id, qty: 2 }],
      activeEffects: [],
    };
    const passives = [{ activation: { mode: 'passive' }, source: 'archer-test' }];
    const characterContext = {
      abilityMods: { str: 0, dex: 3, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      passives,
    } as CharacterContext;
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-archer'),
      assembled: { ...baseAssembly, klass: null, effects: [] },
      ruleState: { appliedGrants: [] },
      sheetActions: [sheetAction],
      runtime,
      characterContext,
      passives,
      cards: [bow, arrow, ...unrelatedCards],
      ac: 13,
    });
    const canonical = built.actionFor(sheetAction);
    const cost = (canonical.mechanics.activation as { cost: Record<string, unknown>[] }).cost;
    expect(cost).toEqual([
      { resource: 'action' },
      { resource: 'item', card_id: arrow.id, amount: 1, name: 'Arrows' },
    ]);
    const paid = pay(built.world.actors[built.actorId].runtime, cost);
    expect(paid.state.resources.action).toBe(0);
    expect(paid.state.inventory).toEqual([{ cardId: arrow.id, qty: 1 }]);
    expect(built.world.actors[built.actorId].character.knownCards?.map((card) => card.id).sort())
      .toEqual([arrow.id, bow.id].sort());
    expect((built.world.actors[built.actorId].character as CharacterContext & { passives?: unknown }).passives)
      .toBeUndefined();
    expect(built.world.actors[built.actorId].passives).toEqual(passives);
    expect(JSON.stringify(built.world).length).toBeLessThan(768 << 10);
    expect(built.world.ruleset.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const persisted = writeSheetCanonicalWorld({}, built.actorId, built.world);
    const stale = clone(persisted);
    (stale.canonical_rules_world_v1 as Record<string, unknown>).rulesetContentHash =
      'sheet:previous-deployment';
    expect(readSheetCanonicalWorld(
      stale,
      built.actorId,
      built.world.ruleset.contentHash,
    )).toBeNull();

    const legacyContentHash = legacySheetContentHash(
      'dnd5e-2024',
      '2024',
      {
        systemId: 'dnd5e-2024',
        rulesetVersion: '2024',
        actions: built.actions,
        pacts: [],
        cards: built.cards.map((card) => ({
          id: card.id,
          cardNumber: card.card_number,
          name: card.name,
          type: card.type,
          weaponType: card.weapon_type,
          damageType: card.damage_type,
          properties: card.properties,
          tags: card.tags,
          enchantBonus: card.enchant_bonus,
          attunement: card.attunement,
          requiresAttunement: card.requires_attunement,
          slot: card.slot,
          mechanics: card.mechanics,
          battleProfile: card.battle_profile,
        })),
        grantedEffects: undefined,
        masteryEffects: undefined,
        familiarCatalog: undefined,
      },
    );
    const legacyWorld = clone(built.world);
    legacyWorld.ruleset.contentHash = legacyContentHash;
    legacyWorld.logicalClock = 99;
    legacyWorld.processedCommandIds.push('legacy-command');
    legacyWorld.scene = {
      mode: 'encounter',
      initiative: [built.actorId],
      activeIndex: 0,
      round: 3,
      turnStarted: true,
    };
    legacyWorld.objects['object:legacy-illusion'] = {
      id: 'object:legacy-illusion',
      name: 'Persisted illusion',
      kind: 'spell_effect',
      size: 'medium',
      sourceActorId: built.actorId,
      sourceActionId: sheetAction.id,
      roundsLeft: 8,
    };
    legacyWorld.concentrations[built.actorId] = {
      id: 'concentration:legacy',
      sourceActorId: built.actorId,
      actionId: sheetAction.id,
      startedAtRevision: legacyWorld.revision,
      effectLinks: [],
    };
    const legacyTurnState = writeSheetCanonicalWorld({}, built.actorId, legacyWorld);
    const rebuilt = buildSheetCanonicalRuntime({
      character: { ...character('sheet-archer'), turn_state: legacyTurnState },
      assembled: { ...baseAssembly, klass: null, effects: [] },
      ruleState: { appliedGrants: [] },
      sheetActions: [sheetAction],
      runtime,
      characterContext,
      passives,
      cards: [bow, arrow, ...unrelatedCards],
      ac: 13,
    });
    expect(rebuilt.world.ruleset.contentHash).toBe(built.world.ruleset.contentHash);
    expect(rebuilt.world.logicalClock).toBe(99);
    expect(rebuilt.world.processedCommandIds).toContain('legacy-command');
    expect(rebuilt.world.scene).toEqual(legacyWorld.scene);
    expect(rebuilt.world.objects['object:legacy-illusion'])
      .toEqual(legacyWorld.objects['object:legacy-illusion']);
    expect(rebuilt.world.concentrations[built.actorId])
      .toEqual(legacyWorld.concentrations[built.actorId]);

    const rewritten = writeSheetCanonicalWorld({}, rebuilt.actorId, rebuilt.world);
    expect(rewritten[SHEET_CANONICAL_WORLD_KEY]).toMatchObject({
      rulesetContentHash: built.world.ruleset.contentHash,
      world: { ruleset: { contentHash: built.world.ruleset.contentHash } },
    });

    const inconsistent = clone(legacyTurnState);
    const inconsistentEnvelope = inconsistent[SHEET_CANONICAL_WORLD_KEY] as {
      world: { ruleset: { contentHash: string } };
    };
    inconsistentEnvelope.world.ruleset.contentHash = `${legacyContentHash}-tampered`;
    expect(() => readSheetCanonicalWorld(
      inconsistent,
      built.actorId,
      built.world.ruleset.contentHash,
      {
        contentHash: legacyContentHash,
        replacementRuleset: built.world.ruleset,
      },
    )).toThrow(/different ruleset identities/);

    expect(() => readSheetCanonicalWorld(
      legacyTurnState,
      built.actorId,
      built.world.ruleset.contentHash,
      {
        contentHash: legacyContentHash,
        replacementRuleset: {
          ...built.world.ruleset,
          releaseId: `${built.world.ruleset.releaseId}:tampered`,
        },
      },
    )).toThrow(/metadata does not match/);

    const unrelatedLegacy = clone(legacyTurnState);
    const unrelatedEnvelope = unrelatedLegacy[SHEET_CANONICAL_WORLD_KEY] as {
      rulesetContentHash: string;
      world: { ruleset: { contentHash: string } };
    };
    unrelatedEnvelope.rulesetContentHash = 'sheet:dnd5e-2024:2024:fnv1a32:00000000';
    unrelatedEnvelope.world.ruleset.contentHash = unrelatedEnvelope.rulesetContentHash;
    expect(readSheetCanonicalWorld(
      unrelatedLegacy,
      built.actorId,
      built.world.ruleset.contentHash,
      {
        contentHash: legacyContentHash,
        replacementRuleset: built.world.ruleset,
      },
    )).toBeNull();
  });

  it('promotes an active class effect into a real sheet action with provenance', () => {
    const blade = patchEffect('EFF-pact-blade');
    const actions = collectSheetActions(assembled({ effect: blade }));
    expect(actions).toContainEqual(expect.objectContaining({
      id: blade.id,
      group: 'class',
      effectRef: blade,
      sourceEntityIds: expect.arrayContaining([
        blade.id,
        blade.card_number,
        'class-entity:warlock',
      ]),
    }));
  });

  it('materializes Pact Chain and its source-scoped at-will Find Familiar path from mechanics', () => {
    const chain = patchEffect('EFF-pact-chain');
    const root = clone(generated.roots.chain);
    const canonicalAction = root.actions.find((candidate) => (
      candidate.id === generated.execution.scenarios.chain.findFamiliarActionId
    ))!;
    const action = sheetSpell(canonicalAction);
    const actor = clone(root.actor);
    const sheetAssembly = assembled({ effect: chain, spells: [action.spellRef!] });
    const runtime = buildSheetCanonicalRuntime({
      character: character('sheet-chain', {}, { gold: 20 }),
      assembled: sheetAssembly,
      ruleState: spellRuleState(chain, [action.spellRef!]),
      sheetActions: [action],
      runtime: actor.runtime,
      characterContext: actor.character,
      cards: [],
      ac: actor.ac,
    });
    expect(runtime.resourceBindings).toEqual({
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: { kind: 'currency', currency: 'gold' },
    });
    expect(runtime.world.actors[runtime.actorId].runtime.resources)
      .toMatchObject({ [FIND_FAMILIAR_MATERIAL_RESOURCE]: 20 });
    expect(runtime.world.actors[runtime.actorId].warlockPacts?.chain).toMatchObject({
      sourceEntityId: chain.id,
      template: { findFamiliarActionId: action.id },
      activeFamiliar: null,
    });
    expect(runtime.world.actors[runtime.actorId].spellcastingAccess?.grants).toContainEqual(
      expect.objectContaining({
        actionId: action.id,
        sourceId: chain.card_number,
        access: 'innate',
      }),
    );
    const choices = collectSheetPrimitiveChoices({ runtime, action: runtime.actionFor(action) });
    expect(choices.find((candidate) => candidate.id === 'find_familiar_form')?.items)
      .toContainEqual(expect.objectContaining({ id: 'imp' }));
    expect(choices.find((candidate) => candidate.id === SHEET_SPELL_CAST_CHOICE)?.items)
      .toContainEqual(expect.objectContaining({ id: expect.stringContaining('spell-grant:') }));
    expect(choices.some((candidate) => candidate.id === 'find_familiar_cast_path')).toBe(false);

    const spentWorld = clone(runtime.world);
    spentWorld.actors[runtime.actorId].runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE] = 10;
    const projection = projectSheetCanonicalPersistence({
      runtime: spentWorld.actors[runtime.actorId].runtime,
      currency: { gold: 20.5 },
      resourceBindings: runtime.resourceBindings,
    });
    expect(projection.currency).toEqual({ gold: 10.5 });
    expect(projection.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBeUndefined();
    expect(projection.runtime.maxResources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBeUndefined();

    const persisted = writeSheetCanonicalWorld(
      {},
      runtime.actorId,
      spentWorld,
      runtime.resourceBindings,
    );
    const reloaded = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-chain', {}, projection.currency),
        turn_state: persisted,
        resources: projection.runtime.resources,
        max_resources: projection.runtime.maxResources,
      },
      assembled: sheetAssembly,
      ruleState: spellRuleState(chain, [action.spellRef!]),
      sheetActions: [action],
      runtime: projection.runtime,
      characterContext: actor.character,
      cards: [],
      ac: actor.ac,
    });
    expect(reloaded.resourceBindings).toEqual(runtime.resourceBindings);
    expect(reloaded.world.actors[reloaded.actorId].runtime.resources)
      .toMatchObject({ [FIND_FAMILIAR_MATERIAL_RESOURCE]: 10 });

    const legacyWorld = clone(reloaded.world);
    const owner = legacyWorld.actors[reloaded.actorId];
    const chainState = owner.warlockPacts?.chain;
    if (!chainState) throw new Error('Reloaded Chain root has no invocation state');
    const familiarState = castFindFamiliar({
      familiarActorId: `${reloaded.actorId}:legacy-familiar`,
      ownerActorId: reloaded.actorId,
      policy: { kind: 'pact_chain', sourceEntityId: chainState.sourceEntityId },
      method: 'pact_chain_magic_action',
      formId: 'imp',
      spiritType: 'fiend',
      resources: { level1SpellSlots: 0, incenseGp: 10 },
      incenseOfferingGp: 10,
      materialCostGp: 10,
      baseCastingTimeSeconds: 3_600,
      mechanicsPolicy: {
        connectionRangeFt: 100,
        reappearRangeFt: 30,
        ritualCastingAddedSeconds: 600,
      },
      existingFamiliar: null,
    }).familiar;
    const familiarActor = materializeCanonicalFamiliarActor({
      familiar: familiarState,
      owner,
      summoningActionId: action.id,
    });
    familiarActor.lifecycle = { status: 'alive' };
    chainState.activeFamiliar = pactChainProjection(familiarState);
    legacyWorld.actors[familiarActor.id] = familiarActor;
    const legacyAlias = 'sheet:dnd5e-2024:2024:fnv1a32:89abcdef';
    legacyWorld.ruleset.contentHash = legacyAlias;
    const migrated = readSheetCanonicalWorld(
      writeSheetCanonicalWorld(
        {},
        reloaded.actorId,
        legacyWorld,
        reloaded.resourceBindings,
      ),
      reloaded.actorId,
      reloaded.world.ruleset.contentHash,
      {
        contentHash: legacyAlias,
        replacementRuleset: reloaded.world.ruleset,
      },
    );
    expect(migrated?.actors[familiarActor.id]).toEqual(familiarActor);
    expect(migrated?.actors[reloaded.actorId].warlockPacts?.chain?.activeFamiliar)
      .toEqual(pactChainProjection(familiarState));
  });

  it('materializes Pact Tome from the five resolved Forge choices and round-trips its book/grants', () => {
    const tome = patchEffect('EFF-pact-tome');
    const root = clone(generated.roots.tome);
    const compiledTome = root.actor.warlockPacts?.tome?.tome;
    if (!compiledTome) throw new Error('Generated Tome root has no compiled pact state');
    const selectedIds = [...compiledTome.cantripActionIds, ...compiledTome.ritualActionIds];
    const selectedActions = selectedIds.map((id) => {
      const action = root.actions.find((candidate) => candidate.id === id);
      if (!action) throw new Error(`Generated Tome action ${id} is missing`);
      return sheetSpell(action);
    });
    const origin: ChoiceOrigin = {
      kind: 'class',
      id: 'class-entity:warlock',
      name: 'Warlock',
      featureId: tome.id,
      featureName: tome.name,
    };
    const pending = collectChoices(tome.mechanics, origin);
    const cantripChoice = pending.find((candidate) => candidate.id.endsWith(':pact_tome_cantrips'))!;
    const ritualChoice = pending.find((candidate) => candidate.id.endsWith(':pact_tome_rituals'))!;
    const resolvedChoices = {
      [cantripChoice.id]: selectedActions.slice(0, 3).map((action) => action.spellRef!.id),
      [ritualChoice.id]: selectedActions.slice(3).map((action) => action.spellRef!.id),
    };
    const actor = root.actor;
    const runtime = buildSheetCanonicalRuntime({
      character: character('sheet-tome', resolvedChoices),
      assembled: assembled({
        effect: tome,
        spells: selectedActions.map((action) => action.spellRef!),
        pendingChoices: pending,
      }),
      ruleState: spellRuleState(tome, selectedActions.map((action) => action.spellRef!), Object.fromEntries(
        selectedActions.map((action) => [
          action.spellRef!.id,
          action.spellRef!.level === 0 ? 'cantrip' : 'prepared',
        ]),
      )),
      sheetActions: selectedActions,
      runtime: actor.runtime,
      characterContext: actor.character,
      cards: [] as Card[],
      ac: actor.ac,
    });
    const state = runtime.world.actors[runtime.actorId].warlockPacts?.tome?.tome;
    expect(state?.cantripActionIds).toEqual([...compiledTome.cantripActionIds].sort());
    expect(state?.ritualActionIds).toEqual([...compiledTome.ritualActionIds].sort());
    expect(runtime.world.objects[state!.bookObjectId]).toMatchObject({
      ownerActorId: runtime.actorId,
      tags: expect.arrayContaining(['book_of_shadows', 'spellcasting_focus']),
    });
    expect(runtime.world.actors[runtime.actorId].spellcastingAccess?.grants)
      .toHaveLength(5);

    const persisted = writeSheetCanonicalWorld({}, runtime.actorId, runtime.world);
    expect(readSheetCanonicalWorld(
      JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>,
      runtime.actorId,
      runtime.world.ruleset.contentHash,
    )).toEqual(runtime.world);

    const legacyAlias = 'sheet:dnd5e-2024:2024:fnv1a32:1234abcd';
    const legacyWorld = clone(runtime.world);
    legacyWorld.ruleset.contentHash = legacyAlias;
    legacyWorld.logicalClock = 17;
    const migrated = readSheetCanonicalWorld(
      writeSheetCanonicalWorld({}, runtime.actorId, legacyWorld),
      runtime.actorId,
      runtime.world.ruleset.contentHash,
      {
        contentHash: legacyAlias,
        replacementRuleset: runtime.world.ruleset,
      },
    );
    expect(migrated).not.toBeNull();
    expect(migrated?.ruleset).toEqual(runtime.world.ruleset);
    expect(migrated?.logicalClock).toBe(17);
    expect(migrated?.objects[state!.bookObjectId]).toEqual(
      legacyWorld.objects[state!.bookObjectId],
    );
    expect(migrated?.actors[runtime.actorId].warlockPacts).toEqual(
      legacyWorld.actors[runtime.actorId].warlockPacts,
    );
  });

  it('materializes and reloads the explicit Wizard spellbook/prepared subset without first-N defaults', () => {
    const spellcasting = patchEffect('EFF-wizard-spellcasting');
    const root = clone(generated.roots.wizard);
    const spellActions = root.actions.filter((candidate): candidate is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => candidate.kind === 'spell');
    const sheetActions = spellActions.map(sheetSpell);
    // Production still contains legacy spell cards without the newer stable
    // class-list field. Runtime must derive that metadata from the immutable
    // class grant, not from localized spell.classes display text.
    const legacyClassListSpell = sheetActions.find((action) => action.spellRef?.level === 1)!;
    delete legacyClassListSpell.spellRef!.mechanics!.spell_class_list_ids;
    const spells = sheetActions.map((action) => action.spellRef!);
    const origin: ChoiceOrigin = {
      kind: 'class',
      id: wizardClass().id,
      name: 'Любое локализованное имя',
      featureId: spellcasting.id,
      featureName: spellcasting.name,
    };
    const initialChoices = collectChoices(spellcasting.mechanics, origin);
    const cantripChoice = initialChoices.find((choice) => choice.id.endsWith(':wizard_cantrips'))!;
    const bookChoice = initialChoices.find((choice) => choice.id.endsWith(':wizard_spellbook_level_1'))!;
    const cantrips = spells.filter((spell) => spell.level === 0).map((spell) => spell.id);
    const book = spells.filter((spell) => spell.level === 1).map((spell) => spell.id);
    const named = (fragment: string) => spells.find((spell) => (
      spell.name.toLowerCase().includes(fragment)
    ))!.id;
    const prepared = [
      named('огненные ладони'),
      named('волшебная стрела'),
      named('щит'),
      named('волна грома'),
    ];
    const resolvedChoices = {
      [cantripChoice.id]: cantrips,
      [bookChoice.id]: book,
    };
    const pendingChoices = collectChoices(spellcasting.mechanics, origin, resolvedChoices);
    const preparedChoice = pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
    const persistedChoices = {
      ...resolvedChoices,
      [preparedChoice.id]: prepared,
    };
    const assembly = {
      ...assembled({ effect: spellcasting, spells, pendingChoices }),
      klass: wizardClass(),
      effects: [{ effect: spellcasting, origin: {
        kind: 'class' as const,
        id: wizardClass().id,
        name: 'Имя не участвует в identity',
      } }],
    };
    const draft = {
      ...emptyDraft(),
      classId: wizardClass().id,
      level: 1,
      abilities: { str: 10, dex: 14, con: 14, int: 15, wis: 12, cha: 10 },
      resolvedChoices: persistedChoices,
    };
    const resolvedRuleState = resolveCharacterRules({ draft, assembled: assembly });
    expect(resolvedRuleState.appliedGrants.filter((grant) => grant.kind === 'spell'))
      .toHaveLength(9);
    expect(resolvedRuleState.appliedGrants
      .filter((grant) => grant.kind === 'spell')
      .every((grant) => grant.spellcastingAbility === 'int')).toBe(true);
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-wizard', persistedChoices),
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    const actorAccess = built.world.actors[built.actorId].spellcastingAccess!;
    expect(built.world.ruleset.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const source = actorAccess.preparedSources['CLASS-wizard']!;
    expect(source.capacity).toBe(4);
    expect(source.availableActionIds).toHaveLength(6);
    expect(source.preparedActionIds).toEqual(prepared.map((id) => `${id}@CLASS-wizard`).sort());
    for (const spellId of prepared) {
      expect(resolveSpellAccess({
        state: actorAccess,
        actionId: `${spellId}@CLASS-wizard`,
        resources: { spell_slot_1: 2 },
      })).toMatchObject({ status: 'allowed', payment: { kind: 'slot', resource: 'spell_slot_1' } });
    }

    const newlyPrepared = book.find((spellId) => !prepared.includes(spellId))!;
    const preparedSheetAction = sheetActions.find((candidate) => (
      candidate.spellRef?.id === prepared[0]
    ))!;
    const unpreparedSheetAction = sheetActions.find((candidate) => (
      candidate.spellRef?.id === newlyPrepared
    ))!;
    expect(built.actionFor(preparedSheetAction).id).toBe(`${prepared[0]}@CLASS-wizard`);
    expect(() => built.actionFor(unpreparedSheetAction)).toThrow(/not prepared/i);
    const restSelection = [...prepared.slice(1), newlyPrepared];
    const afterLongRest = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-wizard', persistedChoices),
        turn_state: writeSheetSpellPreparation({}, {
          [preparedChoice.id]: restSelection,
        }),
      },
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(afterLongRest.world.actors[afterLongRest.actorId].spellcastingAccess
      ?.preparedSources['CLASS-wizard']?.preparedActionIds)
      .toEqual(restSelection.map((id) => `${id}@CLASS-wizard`).sort());
    expect(afterLongRest.world.actors[afterLongRest.actorId].spellcastingAccess
      ?.preparedSources['CLASS-wizard']?.availableActionIds)
      .toEqual(source.availableActionIds);

    const afterStalePreparationOverlay = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-wizard', persistedChoices),
        turn_state: writeSheetSpellPreparation({}, {
          [preparedChoice.id]: prepared.slice(0, 3),
        }),
      },
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(afterStalePreparationOverlay.world.actors[afterStalePreparationOverlay.actorId]
      .spellcastingAccess?.preparedSources['CLASS-wizard']?.preparedActionIds)
      .toEqual(prepared.map((id) => `${id}@CLASS-wizard`).sort());

    const persisted = writeSheetCanonicalWorld({}, built.actorId, built.world);
    const reloaded = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-wizard', persistedChoices),
        turn_state: persisted,
      },
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(reloaded.world.actors[reloaded.actorId].spellcastingAccess?.preparedSources)
      .toEqual(actorAccess.preparedSources);
  });

  it('treats a spell added manually through Forge as prepared for any class', () => {
    const spellcasting = patchEffect('EFF-wizard-spellcasting');
    const root = clone(generated.roots.wizard);
    const sheetAction = root.actions
      .filter((candidate): candidate is Extract<RuleActionDefinition, { kind: 'spell' }> => (
        candidate.kind === 'spell' && candidate.spell.level === 1
      ))
      .map(sheetSpell)[0];
    const spell = sheetAction.spellRef!;
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-manual-spell', {
        'builder:manual_spells': [spell.id],
      }),
      assembled: assembled({ effect: spellcasting, spells: [spell] }),
      ruleState: { appliedGrants: [] },
      sheetActions: [sheetAction],
      runtime: root.actor.runtime,
      characterContext: {
        ...root.actor.character,
        spellcastingAbility: undefined,
        abilityMods: { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 2 },
      },
      cards: [],
      ac: root.actor.ac,
    });
    const action = built.actionFor(sheetAction);
    expect(action.id).toBe(`${spell.id}@manual-spell:${spell.id}`);
    expect(resolveSpellAccess({
      state: built.world.actors[built.actorId].spellcastingAccess!,
      actionId: action.id,
      resources: { spell_slot_1: 2 },
    })).toMatchObject({
      status: 'allowed',
      grant: { access: 'always_prepared', spellcastingAbility: 'wis' },
      payment: { kind: 'slot', resource: 'spell_slot_1' },
    });
  });

  it('pays a Warlock class spell from its separate short-rest Pact Magic pool', () => {
    const spellcasting = patchEffect('EFF-warlock-spellcasting');
    // The compiled corpus has a Wizard spell root but no separate Warlock
    // root. Granting that real level-1 spell through the Warlock class source
    // is sufficient here: the regression is about the payment-pool binding.
    const root = clone(generated.roots.wizard);
    const sheetAction = root.actions
      .filter((candidate): candidate is Extract<RuleActionDefinition, { kind: 'spell' }> => (
        candidate.kind === 'spell' && candidate.spell.level === 1
      ))
      .map(sheetSpell)[0];
    const spell = sheetAction.spellRef!;
    const warlock = {
      ...warlockClass(),
      resources: {
        spell_slot_1: { by_level: { 1: 1, 2: 2 }, per: 'short_rest' },
      },
    };
    const assembly = {
      ...assembled({ effect: spellcasting, spells: [spell] }),
      klass: { ...warlock, resources: { pact_slot_1: { count: 2, per: 'short_rest' } } },
      classes: [warlock],
    };
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-warlock'),
      assembled: assembly,
      ruleState: spellRuleState(spellcasting, [spell], { [spell.id]: 'known' }),
      sheetActions: [sheetAction],
      runtime: {
        ...root.actor.runtime,
        resources: { ...root.actor.runtime.resources, pact_slot_1: 2 },
        maxResources: { ...root.actor.runtime.maxResources, pact_slot_1: 2 },
      },
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    const action = built.actionFor(sheetAction);
    expect(resolveSpellAccess({
      state: built.world.actors[built.actorId].spellcastingAccess!,
      actionId: action.id,
      resources: { pact_slot_1: 2 },
    })).toMatchObject({
      status: 'allowed',
      payment: { kind: 'slot', resource: 'pact_slot_1' },
    });
  });

  it('fails closed on missing, duplicate, and outside-book Wizard preparation', () => {
    const spellcasting = patchEffect('EFF-wizard-spellcasting');
    const root = clone(generated.roots.wizard);
    const sheetActions = root.actions
      .filter((candidate) => candidate.kind === 'spell')
      .map(sheetSpell);
    const spells = sheetActions.map((action) => action.spellRef!);
    const origin: ChoiceOrigin = {
      kind: 'class', id: wizardClass().id, name: 'Wizard', featureId: spellcasting.id,
    };
    const initial = collectChoices(spellcasting.mechanics, origin);
    const cantripChoice = initial.find((choice) => choice.id.endsWith(':wizard_cantrips'))!;
    const bookChoice = initial.find((choice) => choice.id.endsWith(':wizard_spellbook_level_1'))!;
    const cantrips = spells.filter((spell) => spell.level === 0).map((spell) => spell.id);
    const book = spells.filter((spell) => spell.level === 1).map((spell) => spell.id);
    const baseChoices = { [cantripChoice.id]: cantrips, [bookChoice.id]: book };
    const pendingChoices = collectChoices(spellcasting.mechanics, origin, baseChoices);
    const preparedChoice = pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
    const assembly = {
      ...assembled({ effect: spellcasting, spells, pendingChoices }),
      klass: wizardClass(),
      effects: [{ effect: spellcasting, origin: {
        kind: 'class' as const, id: wizardClass().id, name: 'Wizard',
      } }],
    };
    const attempt = (selection: string[] | undefined) => buildSheetCanonicalRuntime({
      character: character('invalid-wizard', {
        ...baseChoices,
        ...(selection ? { [preparedChoice.id]: selection } : {}),
      }),
      assembled: assembly,
      ruleState: wizardRuleState(spellcasting, spells),
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(() => attempt(undefined)).toThrow(/Откройте редактирование персонажа/);
    expect(() => attempt([book[0], book[0], book[1], book[2]])).toThrow(/различны/);
    expect(() => attempt([book[0], book[1], book[2], cantrips[0]])).toThrow(/вне выбранной книги/);
    expect(() => attempt(book.slice(0, 3))).toThrow(/ровно 4/);
  });

  it('does not let a stale grantless SPELL-0173 row poison combat startup', () => {
    const root = clone(generated.roots.wizard);
    const spellAction = sheetSpell(root.actions.find((candidate) => candidate.kind === 'spell')!);
    spellAction.spellRef = { ...spellAction.spellRef!, card_number: 'SPELL-0173' };
    const base = assembled({
      effect: patchEffect('EFF-wizard-spellcasting'),
      spells: [spellAction.spellRef!],
    });
    const runtime = buildSheetCanonicalRuntime({
      character: character('sheet-with-stale-spell'),
      assembled: { ...base, klass: null, effects: [], pendingChoices: [] },
      ruleState: { appliedGrants: [] },
      sheetActions: [spellAction],
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(runtime.actionsFor?.(spellAction)).toEqual([]);
    expect(runtime.world.actors[runtime.actorId].capabilities.actionIds).toEqual([]);
    expect(runtime.world.actors[runtime.actorId].spellcastingAccess).toBeUndefined();
  });
});
