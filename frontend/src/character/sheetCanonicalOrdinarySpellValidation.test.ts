import { describe, expect, it } from 'vitest';
import utilityLevelOneSpells from '../../../scripts/content/data/mini-mvp-utility-level1-spells.v1.json';
import type { RuntimeState } from '../mvp/contracts';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
} from '../rules-core/domain';
import type { Card } from '../types';
import { buildSheetCombatDeclaration } from './sheetCombatDeclaration';
import {
  executeSheetCanonicalAction,
  validateSheetCanonicalAction,
  type SheetCanonicalActionContext,
} from './sheetActionOrchestrator';
import { sheetActionRequiresActorTargets } from './sheetPrimitiveUi';

const ARMOR = {
  id: 'card:leather',
  name: 'Leather armor',
  card_number: 'CARD-leather',
  type: 'chest',
  slot: 'body',
  defense_type: 'light',
  mechanics: {},
} as unknown as Card;

const MAGE_ARMOR: RuleActionDefinition = {
  id: 'spell:mage-armor',
  name: 'Mage Armor',
  kind: 'spell',
  sourceEntityIds: ['SPELL-0190'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['ally'],
    requiresWilling: true,
    requiresUnarmored: true,
  },
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    targeting: {
      domain: 'actor',
      actor_targets: true,
      shape: 'single',
      min_targets: 1,
      max_targets: 1,
      range_ft: 5,
      requires_line_of_sight: true,
      allowed_relations: ['ally'],
      requires_willing: true,
      requires_unarmored: true,
    },
    effects: [{
      resolution: 'auto',
      who: 'self',
      result: [{ kind: 'narrative', description: 'validated' }],
    }],
  },
};

const BLESS: RuleActionDefinition = {
  id: 'spell:bless',
  name: 'Bless',
  kind: 'spell',
  sourceEntityIds: ['SPELL-0163'],
  concentration: true,
  spell: {
    level: 1,
    sourceClass: 'cleric',
    components: { verbal: true, somatic: true, material: true },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 3,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
  },
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{
        kind: 'modifier',
        applies_to: { roll: 'attack' },
        op: 'bonus_die',
        faces: 4,
        source: 'Bless',
        duration: { type: 'rounds', amount: 10, concentration: true },
      }, {
        kind: 'modifier',
        applies_to: { roll: 'saving_throw' },
        op: 'bonus_die',
        faces: 4,
        source: 'Bless',
        duration: { type: 'rounds', amount: 10, concentration: true },
      }],
    }],
    targeting: {
      domain: 'actor',
      actor_targets: true,
      shape: 'multiple',
      min_targets: 1,
      max_targets: 3,
      range_ft: 30,
      requires_line_of_sight: true,
      allowed_relations: ['self', 'ally', 'enemy', 'neutral'],
    },
  },
};

const SAVE_SPELL: RuleActionDefinition = {
  id: 'spell:sheet-save-resume',
  name: 'Sheet Save Resume',
  kind: 'spell',
  sourceEntityIds: ['spell:sheet-save-resume'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 60,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'wis',
      dc: '12',
      on_fail: [{
        kind: 'condition', value: 'unconscious',
        duration: { type: 'rounds', amount: 10 },
      }],
      on_success: [],
    }],
  },
};

function productionWorldUtilitySpell(
  cardNumber: string,
  id: string,
  concentration = false,
): RuleActionDefinition {
  const definition = utilityLevelOneSpells.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing production utility spell ${cardNumber}`);
  return {
    id,
    name: definition.name,
    kind: 'spell',
    sourceEntityIds: [definition.card_number],
    ...(concentration ? { concentration: true } : {}),
    spell: {
      level: 1,
      sourceClass: 'wizard',
      components: { verbal: true, somatic: true, material: true },
    },
    targeting: compileDeclaredMechanicsTargeting(definition.mechanics),
    mechanics: structuredClone(definition.mechanics),
  };
}

const SILENT_IMAGE = productionWorldUtilitySpell('SPELL-0161', 'spell:silent-image', true);
const ALARM = productionWorldUtilitySpell('SPELL-0288', 'spell:alarm');

function actor(id: string, armored = false): ActorState {
  const resources = { action: 1, spell_slot_1: 1 };
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    ac: armored ? 14 : 10,
    capabilities: { actionIds: id === 'caster' ? [MAGE_ARMOR.id] : [] },
    character: {
      abilityMods: { str: 0, dex: 2, con: 0, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: armored ? [ARMOR] : [],
      equippedCards: armored ? [ARMOR] : [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources,
      maxResources: { ...resources },
      equipment: armored ? { body: ARMOR.id } : {},
      inventory: [],
      activeEffects: [],
    },
    ...(id === 'caster' ? {
      spellcastingAccess: {
        grants: [{
          grantId: 'wizard:mage-armor',
          actionId: MAGE_ARMOR.id,
          sourceId: 'CLASS-wizard',
          access: 'always_prepared' as const,
          level: 1,
          spellcastingAbility: 'int' as const,
          slotResource: 'spell_slot_1',
        }],
        preparedSources: {},
      },
    } : {}),
  };
}

function fixture() {
  const caster = actor('caster');
  const catalog: RulesCatalog = {
    getAction: (actionId) => actionId === MAGE_ARMOR.id ? MAGE_ARMOR : undefined,
  };
  const world = createWorld({
    id: 'sheet-validation',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: '2024',
    },
    actors: [caster],
  });
  const canonical: SheetCanonicalActionContext = {
    action: MAGE_ARMOR,
    runtime: {
      actorId: caster.id,
      world,
      actions: [MAGE_ARMOR],
      catalog,
      cards: [],
      resourceBindings: {},
      actionFor: () => MAGE_ARMOR,
    },
  };
  const declaration = {
    sceneMode: 'exploration' as const,
    targetIds: ['target'],
    factsByTarget: {
      target: {
        factsSource: 'scenario' as const,
        boardRevision: 0,
        relation: 'ally' as const,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none' as const,
        willing: true,
      },
    },
    spell: { grantId: 'wizard:mage-armor', mode: 'normal' as const },
  };
  return { caster, canonical, declaration };
}

function blessFixture() {
  const caster = actor('caster');
  caster.capabilities.actionIds = [BLESS.id];
  caster.spellcastingAccess = {
    grants: [{
      grantId: 'cleric:bless',
      actionId: BLESS.id,
      sourceId: 'CLASS-cleric',
      access: 'always_prepared',
      level: 1,
      spellcastingAbility: 'wis',
      slotResource: 'spell_slot_1',
    }],
    preparedSources: {},
  };
  const catalog: RulesCatalog = {
    getAction: (actionId) => actionId === BLESS.id ? BLESS : undefined,
  };
  const world = createWorld({
    id: 'sheet-bless-multi-target',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: '2024',
    },
    actors: [caster],
  });
  const canonical: SheetCanonicalActionContext = {
    action: BLESS,
    runtime: {
      actorId: caster.id,
      world,
      actions: [BLESS],
      catalog,
      cards: [],
      resourceBindings: {},
      actionFor: () => BLESS,
    },
  };
  const targetIds = ['ally-1', 'ally-2', 'ally-3'];
  const declaration = buildSheetCombatDeclaration({
    action: BLESS,
    base: {
      sceneMode: 'exploration',
      targetIds: [],
      spell: { grantId: 'cleric:bless', mode: 'normal' },
    },
    targets: targetIds.map((targetId) => ({
      targetId,
      factsSource: 'scenario',
      boardRevision: 0,
      relation: 'ally',
      distanceFt: 30,
      lineOfSight: true,
      cover: 'none',
    })),
  });
  return {
    caster,
    canonical,
    targetActors: targetIds.map((id) => actor(id)),
    declaration,
  };
}

function saveSpellFixture() {
  const caster = actor('caster');
  caster.capabilities.actionIds = [SAVE_SPELL.id];
  caster.spellcastingAccess = {
    grants: [{
      grantId: 'wizard:sheet-save-resume',
      actionId: SAVE_SPELL.id,
      sourceId: 'CLASS-wizard',
      access: 'always_prepared',
      level: 1,
      spellcastingAbility: 'int',
      slotResource: 'spell_slot_1',
    }],
    preparedSources: {},
  };
  const catalog: RulesCatalog = {
    getAction: (actionId) => actionId === SAVE_SPELL.id ? SAVE_SPELL : undefined,
  };
  const world = createWorld({
    id: 'sheet-save-resume',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: '2024',
    },
    actors: [caster],
  });
  const canonical: SheetCanonicalActionContext = {
    action: SAVE_SPELL,
    runtime: {
      actorId: caster.id,
      world,
      actions: [SAVE_SPELL],
      catalog,
      cards: [],
      resourceBindings: {},
      actionFor: () => SAVE_SPELL,
    },
  };
  const declaration = buildSheetCombatDeclaration({
    action: SAVE_SPELL,
    base: {
      sceneMode: 'exploration',
      targetIds: [],
      spell: { grantId: 'wizard:sheet-save-resume', mode: 'normal' },
    },
    targets: [{
      targetId: 'target',
      factsSource: 'scenario',
      boardRevision: 0,
      relation: 'enemy',
      distanceFt: 5,
      lineOfSight: true,
      cover: 'none',
    }],
  });
  return { caster, canonical, declaration, target: actor('target') };
}

function worldUtilityFixture(action: RuleActionDefinition, grantId: string) {
  const caster = actor('caster');
  caster.capabilities.actionIds = [action.id];
  caster.spellcastingAccess = {
    grants: [{
      grantId,
      actionId: action.id,
      sourceId: 'CLASS-wizard',
      access: 'always_prepared',
      level: 1,
      spellcastingAbility: 'int',
      slotResource: 'spell_slot_1',
    }],
    preparedSources: {},
  };
  const catalog: RulesCatalog = {
    getAction: (actionId) => actionId === action.id ? action : undefined,
  };
  const world = createWorld({
    id: 'sheet-silent-image-world-target',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: '2024',
    },
    actors: [caster],
  });
  const canonical: SheetCanonicalActionContext = {
    action,
    runtime: {
      actorId: caster.id,
      world,
      actions: [action],
      catalog,
      cards: [],
      resourceBindings: {},
      actionFor: () => action,
    },
  };
  return {
    caster,
    canonical,
    declaration: {
      sceneMode: 'exploration' as const,
      targetIds: [],
      spell: { grantId, mode: 'normal' as const },
    },
  };
}

describe('ordinary sheet spell canonical pre-payment validation', () => {
  it('rejects an armored Mage Armor target without mutating the sheet runtime', () => {
    const { caster, canonical, declaration } = fixture();
    const before = JSON.parse(JSON.stringify(caster.runtime)) as RuntimeState;

    expect(() => validateSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors: [actor('target', true)],
    })).toThrow(/TargetArmored/);
    expect(caster.runtime).toEqual(before);
  });

  it('accepts the same data-owned spell contract for a willing unarmored target', () => {
    const { caster, canonical, declaration } = fixture();
    const detached = validateSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors: [actor('target')],
    });

    expect(detached.actors.caster.runtime.resources).toMatchObject({
      action: 0,
      spell_slot_1: 0,
    });
    expect(caster.runtime.resources).toMatchObject({ action: 1, spell_slot_1: 1 });
  });

  it('dispatches Bless once and applies its canonical effects to all three declared targets', () => {
    const { caster, canonical, declaration, targetActors } = blessFixture();
    const result = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors,
    });

    expect(declaration.targetIds).toEqual(['ally-1', 'ally-2', 'ally-3']);
    expect(result.state.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    for (const target of targetActors) {
      expect(result.canonicalWorld.actors[target.id].runtime.activeEffects).toHaveLength(2);
    }
    expect(result.canonicalWorld.concentrations.caster.effectLinks).toHaveLength(6);
    expect(caster.runtime.resources).toMatchObject({ action: 1, spell_slot_1: 1 });
    expect(targetActors.every((target) => target.runtime.activeEffects.length === 0)).toBe(true);
  });

  it('resumes a target save with the sheet dice RNG and returns one atomic completed world', () => {
    const { caster, canonical, declaration, target } = saveSpellFixture();
    const unresolved = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors: [target],
      rng: () => (1 - 0.5) / 20,
      commandId: 'sheet-save-unresolved',
    });
    expect(unresolved.pendingResolution?.type).toBe('target_save');
    expect(unresolved.canonicalWorld.actors.target.runtime.activeEffects).toEqual([]);

    const resolved = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors: [target],
      rng: () => (1 - 0.5) / 20,
      commandId: 'sheet-save-resolved',
      resolveTargetSaves: true,
    });

    expect(resolved.pendingResolution).toBeNull();
    expect(resolved.state.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    expect(resolved.canonicalWorld.actors.target.runtime.activeEffects).toEqual([
      expect.objectContaining({
        mechanics: expect.objectContaining({ kind: 'condition', value: 'unconscious' }),
      }),
    ]);
    expect(caster.runtime.resources).toMatchObject({ action: 1, spell_slot_1: 1 });
    expect(target.runtime.activeEffects).toEqual([]);
  });

  it('dispatches a production world-domain utility spell with no invented actor target', () => {
    const { caster, canonical, declaration } = worldUtilityFixture(
      SILENT_IMAGE,
      'wizard:silent-image',
    );

    expect(canonical.action.targeting).toMatchObject({
      minTargets: 0,
      maxTargets: 1,
      allowedRelations: [],
    });
    expect(sheetActionRequiresActorTargets(canonical.action)).toBe(false);

    const result = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors: [],
    });

    expect(declaration.targetIds).toEqual([]);
    expect(result.state.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    expect(result.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'illusion' }) }),
    ]));
    expect(caster.runtime.resources).toMatchObject({ action: 1, spell_slot_1: 1 });
  });

  it('keeps a world-domain in-play choice in the actor-free canonical declaration', () => {
    const { caster, canonical, declaration } = worldUtilityFixture(ALARM, 'wizard:alarm');
    const withChoice = {
      ...declaration,
      choices: { alarm_mode: ['mental'] },
    };

    expect(sheetActionRequiresActorTargets(canonical.action)).toBe(false);
    const result = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration: withChoice,
      targetActors: [],
    });

    expect(withChoice.targetIds).toEqual([]);
    expect(result.state.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    expect(result.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mechanics: expect.objectContaining({ kind: 'world_zone', alarm_mode: 'mental' }),
      }),
    ]));
  });

  it('replaces cached cross-sheet actors with fresh snapshots when Bless is recast', () => {
    const { caster, canonical, declaration, targetActors } = blessFixture();
    const first = executeSheetCanonicalAction({
      canonical,
      state: caster.runtime,
      declaration,
      targetActors,
    });
    const refreshedTargets = targetActors.map((target) => ({
      ...target,
      runtime: first.canonicalWorld.actors[target.id].runtime,
    }));
    const refreshedCaster = {
      ...first.state,
      resources: { ...first.state.resources, action: 1, spell_slot_1: 1 },
    };
    const second = executeSheetCanonicalAction({
      canonical: {
        ...canonical,
        runtime: { ...canonical.runtime, world: first.canonicalWorld },
      },
      state: refreshedCaster,
      declaration,
      targetActors: refreshedTargets,
    });

    for (const target of refreshedTargets) {
      expect(second.canonicalWorld.actors[target.id].runtime.activeEffects).toHaveLength(2);
    }
    expect(second.canonicalWorld.concentrations.caster.effectLinks).toHaveLength(6);
  });
});
