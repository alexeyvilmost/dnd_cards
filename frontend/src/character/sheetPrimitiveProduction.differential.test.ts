import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import {
  createWorld,
  type ActionWorldInput,
  type RuleActionDefinition,
  type RulesCatalog,
  type WorldState,
} from '../rules-core/domain';
import { parseActivationCastTime } from '../rules-core/activationCastTime';
import { InMemoryRulesSession } from '../rules-core/session';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from '../rules-core/testing/compiledMicroMvpAcceptanceCorpus';
import type { WorldObjectState } from '../rules-core/worldObjects';
import type {
  DancingLightsWorldPolicy,
  MendingWorldPolicy,
} from '../rules-core/worldSpellPolicies';
import {
  executeSheetAction,
  SheetCanonicalCommandRejectedError,
  SheetMechanicsPreflightError,
  sheetPrimitiveCommandId,
} from './sheetActionOrchestrator';
import {
  buildSheetCanonicalCommand,
  stageSheetScenarioObjects,
} from './sheetCanonicalCommand';
import {
  readSheetCanonicalWorld,
  writeSheetCanonicalWorld,
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import {
  buildSheetPrimitiveCommandInput,
  requireSheetWorldSpellPolicy,
  sheetActionRequiresActorTargets,
} from './sheetPrimitiveUi';
import {
  collectSheetSpellCastOptions,
  SHEET_SPELL_CAST_CHOICE,
} from './sheetSpellCastingUi';

const PRIMITIVES = [
  'temporary_hp_melee_retaliation',
  'detect_magic_world_sensing',
  'detect_poison_disease_world',
  'light_world_object',
  'mending_world',
  'minor_illusion_world_object',
  'dancing_lights_world',
  'druidcraft_world',
  'prestidigitation_world',
  'purify_food_drink_world',
] as const;

type Primitive = typeof PRIMITIVES[number];

let corpus: CompiledMicroMvpAcceptanceCorpus;
let roots: Record<'warlock' | 'wizard' | 'druid' | 'cleric', CompiledMicroMvpL1Root>;
let catalog: RulesCatalog;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled bridge fixture ${label}`);
  return value;
}

function cardId(cardNumber: string): string {
  return required(
    readProdSnapshotCatalogs().spells.find((spell) => spell.card_number === cardNumber),
    `spell ${cardNumber}`,
  ).id;
}

function baseRoot(classCardNumber: string): CompiledMicroMvpL1Root {
  return required(corpus.compiled.roots.find((root) => (
    root.matrixCase.klass.card_number === classCardNumber
      && root.matrixCase.species.card_number === 'RACE-0003'
  )), classCardNumber);
}

function ownerKey(primitive: Primitive): keyof typeof roots {
  if (['temporary_hp_melee_retaliation', 'detect_magic_world_sensing', 'minor_illusion_world_object']
    .includes(primitive)) return 'warlock';
  if (['dancing_lights_world', 'mending_world', 'prestidigitation_world']
    .includes(primitive)) return 'wizard';
  if (primitive === 'druidcraft_world') return 'druid';
  return 'cleric';
}

function primitiveOf(action: RuleActionDefinition): string | undefined {
  const value = action.mechanics.primitive;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? String((value as Record<string, unknown>).type ?? '')
    : undefined;
}

function compiledAction(root: CompiledMicroMvpL1Root, primitive: Primitive): RuleActionDefinition {
  const grantIds = new Set(root.actor.spellcastingAccess?.grants.map((grant) => grant.actionId));
  return required(root.rulesActions.find((action) => (
    primitiveOf(action) === primitive && grantIds.has(action.id)
  )), `${root.stableKey}:${primitive}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtimeFor(root: CompiledMicroMvpL1Root, world: WorldState, action: RuleActionDefinition): SheetCanonicalRuntime {
  return {
    actorId: root.actor.id,
    world,
    actions: [action],
    catalog,
    cards: [],
    resourceBindings: {},
    actionFor: () => action,
  };
}

const FACTS = {
  factsSource: 'board' as const,
  boardRevision: 42,
  distanceFt: 0,
  lineOfSight: true,
  touched: true,
  inArea: true,
  entirelyInArea: true,
  volumeCubicFt: 0.5,
};

function worldDeclaration(action: RuleActionDefinition, primitive: Primitive): {
  worldInput?: ActionWorldInput;
  scenarioObjects?: WorldObjectState[];
} {
  if (primitive === 'light_world_object') {
    return {
      scenarioObjects: [{ id: 'bridge:light', name: 'Lantern', kind: 'item', size: 'small' }],
      worldInput: { type: 'target_object', objectId: 'bridge:light', facts: FACTS },
    };
  }
  if (primitive === 'mending_world') {
    const policy = requireSheetWorldSpellPolicy(action).policy as MendingWorldPolicy;
    return {
      scenarioObjects: [{
        id: 'bridge:mending', name: 'Torn cloak', kind: 'item', size: 'small',
        breakOrTear: { maxDimensionFt: policy.maxBreakDimensionFt, repaired: false },
      }],
      worldInput: { type: 'mending', objectId: 'bridge:mending', facts: FACTS },
    };
  }
  if (primitive === 'minor_illusion_world_object') {
    return {
      worldInput: {
        type: 'minor_illusion', form: 'sound', description: 'A quiet bell', facts: FACTS,
      },
    };
  }
  if (primitive === 'dancing_lights_world') {
    const policy = requireSheetWorldSpellPolicy(action).policy as DancingLightsWorldPolicy;
    return {
      worldInput: {
        type: 'dancing_lights', form: 'individual', facts: FACTS,
        placements: Array.from({ length: policy.minIndividualLights }, () => ({
          distanceFromCasterFt: 0,
          ...(policy.minIndividualLights > 1 ? { withinRequiredSeparation: true } : {}),
        })),
      },
    };
  }
  if (primitive === 'druidcraft_world') {
    return {
      worldInput: {
        type: 'druidcraft', option: { kind: 'weather_sensor', prediction: 'Rain', facts: FACTS },
      },
    };
  }
  if (primitive === 'prestidigitation_world') {
    return {
      worldInput: {
        type: 'prestidigitation',
        option: { kind: 'sensory_effect', description: 'Harmless sparks', facts: FACTS },
      },
    };
  }
  if (primitive === 'purify_food_drink_world') {
    return {
      scenarioObjects: [{
        id: 'bridge:stew', name: 'Spoiled stew', kind: 'item', size: 'small',
        foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
      }],
      worldInput: {
        type: 'purify_food_drink', sphereCenterDistanceFt: 0,
        factsByObject: { 'bridge:stew': FACTS },
      },
    };
  }
  return {};
}

function preparedCase(primitive: Primitive) {
  const root = roots[ownerKey(primitive)];
  const action = compiledAction(root, primitive);
  const support = root === roots.cleric ? roots.wizard.actor : roots.cleric.actor;
  const world = createWorld({
    id: `sheet-production:${primitive}`,
    ruleset: corpus.compiled.ruleset,
    actors: [clone(root.actor), clone(support)],
    objects: [...clone(root.initialWorldObjects)],
  });
  const runtime = runtimeFor(root, world, action);
  const options = collectSheetSpellCastOptions({ runtime, action });
  const option = primitive === 'temporary_hp_melee_retaliation'
    ? options.find((candidate) => candidate.payment.kind === 'slot')
    : options[0];
  if (!option) throw new Error(`${primitive} has no payable compiled spell option`);
  const selectedChoices: Record<string, string[]> = {
    [SHEET_SPELL_CAST_CHOICE]: [option.id],
    ...(primitive === 'temporary_hp_melee_retaliation'
      ? { temporary_hp: ['take_spell'] }
      : {}),
  };
  const worldInput = worldDeclaration(action, primitive);
  const declaration = buildSheetPrimitiveCommandInput({
    runtime,
    action,
    selectedChoices,
    sceneMode: 'exploration',
    targetIds: [],
    ...worldInput,
  });
  return { root, action, world, runtime, selectedChoices, declaration };
}

describe('production-compiled real-sheet no-pending primitive differential', () => {
  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network is forbidden in compiled sheet tests'); };
    try {
      corpus = await compileMicroMvpAcceptanceCorpus();
      const [warlock, wizard, druid, cleric] = await compileMicroMvpL1ChoiceVariants([
        {
          stableKey: baseRoot('CLASS-warlock').stableKey,
          overrides: {
            warlock_cantrips: ['minor_illusion', 'chill_touch'].map(cardId),
            warlock_spells_known: ['detect_magic', 'SPELL-0189'].map(cardId),
          },
        },
        {
          stableKey: baseRoot('CLASS-wizard').stableKey,
          overrides: {
            wizard_cantrips: ['dancing_lights', 'mending', 'prestidigitation'].map(cardId),
            wizard_spellbook_level_1: [
              'detect_magic', 'SPELL-0174', 'SPELL-0242', 'SPELL-0317', 'SPELL-0190', 'SPELL-0171',
            ].map(cardId),
          },
        },
        {
          stableKey: baseRoot('CLASS-druid').stableKey,
          overrides: { druid_cantrips: ['druidcraft', 'poison_spray'].map(cardId) },
        },
        {
          stableKey: baseRoot('CLASS-cleric').stableKey,
          overrides: {
            cleric_cantrips: ['light', 'mending', 'SPELL-0286'].map(cardId),
            cleric_spells_l1: ['SPELL-0214', 'SPELL-0163', 'SPELL-0236', 'SPELL-0252'].map(cardId),
          },
        },
      ]);
      roots = { warlock, wizard, druid, cleric };
      const actions = new Map<string, RuleActionDefinition>();
      for (const root of Object.values(roots)) {
        for (const action of root.rulesActions) actions.set(action.id, action);
      }
      catalog = { getAction: (id) => actions.get(id) };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 90_000);

  it.each(PRIMITIVES)('%s matches direct rules-core dispatch and closes without pending state', {
    timeout: 60_000,
  }, (primitive) => {
    const prepared = preparedCase(primitive);
    expect(sheetActionRequiresActorTargets(prepared.action)).toBe(false);
    expect(prepared.declaration.targetIds).toEqual([]);
    const nextIdPrefix = `sheet-production:${primitive}:id`;
    const result = executeSheetAction({
      state: clone(prepared.root.actor.runtime),
      mechanics: prepared.action.mechanics,
      context: {
        character: prepared.root.actor.character,
        selfRuntime: prepared.root.actor.runtime,
        selfId: prepared.root.actor.id,
        choices: prepared.selectedChoices,
        rng: () => 0.5,
        nextId: createSequentialIdFactory(nextIdPrefix),
      },
      canonical: { runtime: prepared.runtime, action: prepared.action },
      canonicalInput: prepared.declaration,
    });

    const staged = stageSheetScenarioObjects(
      prepared.world,
      prepared.declaration.scenarioObjects,
    );
    const command = buildSheetCanonicalCommand({
      world: staged,
      actorId: prepared.root.actor.id,
      action: prepared.action,
      primitiveType: primitive,
      commandId: sheetPrimitiveCommandId(
        prepared.root.actor.id,
        prepared.action.id,
        staged.revision,
      ),
      declaration: prepared.declaration,
    });
    const direct = new InMemoryRulesSession(staged, catalog, {
      rng: () => 0.5,
      clock: createLogicalClock(staged.logicalClock),
      nextId: createSequentialIdFactory(nextIdPrefix),
    });
    const directResult = direct.dispatch(command);
    if (directResult.status === 'rejected') {
      throw new Error(`${directResult.code}: ${directResult.message}`);
    }
    expect(result.pendingResolution).toBeNull();
    expect(result.canonicalWorld).toEqual(direct.getState());
    if (prepared.declaration.worldInput) {
      expect(result.events).toContainEqual(expect.objectContaining({
        type: 'narrative',
        text: expect.stringContaining(prepared.action.name),
      }));
    }

    const castTime = parseActivationCastTime(prepared.action.mechanics);
    const declared = result.ruleEvents?.find((event) => (
      event.payload.type === 'ActionDeclared'
    ))?.payload;
    expect(declared?.type).toBe('ActionDeclared');
    if (castTime.status === 'valid' && declared?.type === 'ActionDeclared') {
      expect(declared.spell?.baseCastingTimeSeconds).toBe(castTime.policy.seconds);
    }

    if ([
      'temporary_hp_melee_retaliation',
      'light_world_object',
      'mending_world',
      'minor_illusion_world_object',
    ].includes(primitive)) {
      const persisted = writeSheetCanonicalWorld(
        {},
        prepared.root.actor.id,
        result.canonicalWorld!,
      );
      expect(readSheetCanonicalWorld(
        JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>,
        prepared.root.actor.id,
        result.canonicalWorld!.ruleset.contentHash,
      )).toEqual(result.canonicalWorld);
    }
  });

  it('rejects Mending in encounter mode before cost or staged object persistence', () => {
    const prepared = preparedCase('mending_world');
    prepared.declaration.sceneMode = 'encounter';
    const before = clone(prepared.world);
    expect(() => executeSheetAction({
      state: clone(prepared.root.actor.runtime),
      mechanics: prepared.action.mechanics,
      context: {
        character: prepared.root.actor.character,
        selfId: prepared.root.actor.id,
        rng: () => 0.5,
        choices: prepared.selectedChoices,
      },
      canonical: { runtime: prepared.runtime, action: prepared.action },
      canonicalInput: prepared.declaration,
    })).toThrowError(SheetMechanicsPreflightError);
    expect(prepared.world).toEqual(before);
    expect(prepared.world.actors[prepared.root.actor.id].runtime.resources.action).toBe(1);
    expect(prepared.world.objects['bridge:mending']).toBeUndefined();
  });

  it('rejects false Light geometry atomically and preserves action/resource state', () => {
    const prepared = preparedCase('light_world_object');
    if (prepared.declaration.worldInput?.type !== 'target_object') {
      throw new Error('Expected Light target object input');
    }
    prepared.declaration.worldInput.facts.distanceFt = 5;
    const before = clone(prepared.world);
    expect(() => executeSheetAction({
      state: clone(prepared.root.actor.runtime),
      mechanics: prepared.action.mechanics,
      context: {
        character: prepared.root.actor.character,
        selfId: prepared.root.actor.id,
        rng: () => 0.5,
        choices: prepared.selectedChoices,
      },
      canonical: { runtime: prepared.runtime, action: prepared.action },
      canonicalInput: prepared.declaration,
    })).toThrowError(SheetCanonicalCommandRejectedError);
    expect(prepared.world).toEqual(before);
    expect(prepared.world.objects['bridge:light']).toBeUndefined();
    expect(prepared.world.actors[prepared.root.actor.id].runtime.resources.action).toBe(1);
  });
});
