import { describe, expect, it } from 'vitest';
import contentPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import { compileMechanicsTargeting } from '../rules-core/actionTargeting';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
} from '../rules-core/domain';
import type { WorldObjectState } from '../rules-core/worldObjects';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import {
  buildSheetWorldInput,
  initialSheetWorldInputDraft,
  sheetWorldInputFormContext,
} from './sheetWorldInputForm';

type PatchRow = { entityId: string; mechanics: Record<string, unknown> };
const patches = contentPatch.mechanicsPatches.spells as PatchRow[];

function actor(): ActorState {
  return {
    id: 'pc:sheet', name: 'Sheet', kind: 'playerCharacter', controllerId: 'controller:sheet',
    ac: 10, capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 2, cha: 1 },
      profBonus: 2, level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      equipment: {}, inventory: [], activeEffects: [], firedThisTurn: [],
    },
  };
}

function context(primitiveType: string, objects: WorldObjectState[] = []) {
  const patch = patches.find((candidate) => (
    (candidate.mechanics.primitive as { type?: string } | undefined)?.type === primitiveType
  ));
  if (!patch) throw new Error(`Missing production primitive ${primitiveType}`);
  const action: RuleActionDefinition = {
    id: `compiled:${patch.entityId}`, name: primitiveType, kind: 'spell',
    sourceEntityIds: [patch.entityId],
    spell: { level: 0, components: { verbal: true, somatic: true, material: false } },
    targeting: compileMechanicsTargeting(patch.mechanics),
    mechanics: structuredClone(patch.mechanics),
  };
  const world = createWorld({
    id: `world:${primitiveType}`,
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'sheet-form-test@1',
      contentHash: 'sha256:sheet-form-test', errataVersion: 'PHB-2024',
    },
    actors: [actor()], objects,
  });
  const runtime: SheetCanonicalRuntime = {
    actorId: 'pc:sheet', world, actions: [action], cards: [], resourceBindings: {},
    catalog: { getAction: (id) => id === action.id ? action : undefined },
    actionFor: () => action,
  };
  const result = sheetWorldInputFormContext({ runtime, action });
  if (!result) throw new Error(`Missing form context ${primitiveType}`);
  return result;
}

describe('explicit sheet world input forms', () => {
  it('builds Light from production policy and writes confirmed numeric facts', () => {
    const ctx = context('light_world_object');
    const draft = initialSheetWorldInputDraft(ctx, 'object:lantern');
    draft.newObjectName = 'Lantern';
    draft.newObjectSize = 'large';
    draft.facts.boardRevision = '17';
    draft.facts.distanceFt = '0';
    draft.facts.touched = true;
    const built = buildSheetWorldInput(ctx, draft);
    expect(built.issues).toEqual([]);
    expect(built.result).toEqual({
      scenarioObjects: [expect.objectContaining({ id: 'object:lantern', size: 'large' })],
      worldInput: {
        type: 'target_object', objectId: 'object:lantern',
        facts: expect.objectContaining({ boardRevision: 17, distanceFt: 0, touched: true }),
      },
    });

    draft.newObjectSize = 'huge';
    expect(buildSheetWorldInput(ctx, draft)).toMatchObject({
      result: null,
      issues: [expect.objectContaining({ fieldId: 'sheet-world-new-object-size' })],
    });
  });

  it('requires a policy-bounded explicit break and produces a Mending declaration', () => {
    const ctx = context('mending_world');
    const draft = initialSheetWorldInputDraft(ctx, 'object:torn-cloak');
    draft.newObjectName = 'Torn cloak';
    draft.newObjectProfile = 'broken';
    draft.facts.touched = true;
    const built = buildSheetWorldInput(ctx, draft);
    expect(built.issues).toEqual([]);
    expect(built.result?.worldInput).toEqual({
      type: 'mending', objectId: 'object:torn-cloak',
      facts: expect.objectContaining({ factsSource: 'scenario', touched: true }),
    });
    expect(built.result?.scenarioObjects[0].breakOrTear).toEqual({
      maxDimensionFt: 1, repaired: false,
    });
  });

  it.each([
    ['minor_illusion_world_object', (draft: ReturnType<typeof initialSheetWorldInputDraft>) => {
      draft.description = 'A quiet bell';
    }, 'minor_illusion'],
    ['dancing_lights_world', () => {}, 'dancing_lights'],
    ['druidcraft_world', (draft: ReturnType<typeof initialSheetWorldInputDraft>) => {
      draft.description = 'Rain tomorrow';
    }, 'druidcraft'],
    ['prestidigitation_world', (draft: ReturnType<typeof initialSheetWorldInputDraft>) => {
      draft.description = 'A harmless spark';
    }, 'prestidigitation'],
  ] as const)('%s records facts without silently creating an unused object', (
    primitiveType,
    configure,
    expectedType,
  ) => {
    const ctx = context(primitiveType);
    const draft = initialSheetWorldInputDraft(ctx, `unused:${primitiveType}`);
    configure(draft);
    expect(draft.createObject).toBe(true);
    const built = buildSheetWorldInput(ctx, draft);
    expect(built.issues).toEqual([]);
    expect(built.result?.scenarioObjects).toEqual([]);
    expect(built.result?.worldInput).toMatchObject({
      type: expectedType,
      ...(expectedType === 'druidcraft' || expectedType === 'prestidigitation'
        ? { option: { facts: expect.objectContaining({ boardRevision: 0 }) } }
        : { facts: expect.objectContaining({ boardRevision: 0 }) }),
    });
  });

  it('purifies only explicitly selected nonmagical food and rejects magical food before payment', () => {
    const stew: WorldObjectState = {
      id: 'food:stew', name: 'Stew', kind: 'item', size: 'small',
      foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
    };
    const wine: WorldObjectState = {
      id: 'drink:magic-wine', name: 'Magic wine', kind: 'item', size: 'tiny',
      foodOrDrink: { kind: 'drink', magical: true, poisoned: true, rotten: true },
    };
    const ctx = context('purify_food_drink_world', [stew, wine]);
    const draft = initialSheetWorldInputDraft(ctx, 'unused:food');
    draft.createObject = false;
    draft.selectedObjectIds = [stew.id];
    const valid = buildSheetWorldInput(ctx, draft);
    expect(valid.issues).toEqual([]);
    expect(valid.result?.worldInput).toEqual({
      type: 'purify_food_drink', sphereCenterDistanceFt: 0,
      factsByObject: {
        [stew.id]: expect.objectContaining({ inArea: true }),
      },
    });

    draft.selectedObjectIds = [wine.id];
    expect(buildSheetWorldInput(ctx, draft)).toMatchObject({
      result: null,
      issues: [expect.objectContaining({ fieldId: 'sheet-world-area-objects' })],
    });
  });

  it('fails closed on missing/rejected observable facts instead of filling geometry', () => {
    const ctx = context('minor_illusion_world_object');
    const draft = initialSheetWorldInputDraft(ctx, 'unused:illusion');
    draft.description = 'A shadow';
    draft.facts.boardRevision = '';
    draft.facts.distanceFt = String(ctx.parsed.targeting.rangeFt + 1);
    const built = buildSheetWorldInput(ctx, draft);
    expect(built.result).toBeNull();
    expect(built.issues.map((issue) => issue.fieldId)).toEqual([
      'sheet-world-board-revision',
      'sheet-world-distance',
    ]);
  });
});
