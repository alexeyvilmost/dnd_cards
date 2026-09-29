import { describe, expect, it } from 'vitest';
import contentPatchJson from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import { compileMechanicsTargeting } from '../rules-core/actionTargeting';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  buildSheetCombatDeclaration,
  sheetCombatDeclarationPolicy,
} from './sheetCombatDeclaration';

const patch = contentPatchJson as unknown as {
  mechanicsPatches: {
    spells: Array<{ entityId: string; cardNumber: string; mechanics: Record<string, unknown> }>;
    actions: Array<{ entityId: string; cardNumber: string; mechanics: Record<string, unknown> }>;
  };
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchedAction(primitiveType: string): RuleActionDefinition {
  const row = patch.mechanicsPatches.spells.find((candidate) => {
    const primitive = candidate.mechanics.primitive as Record<string, unknown> | undefined;
    return primitive?.type === primitiveType;
  });
  if (!row) throw new Error(`Patch misses ${primitiveType}`);
  const mechanics = clone(row.mechanics);
  return {
    id: `${row.entityId}@CLASS-wizard`,
    name: row.cardNumber,
    sourceEntityIds: [row.entityId, 'CLASS-wizard'],
    mechanics,
    targeting: compileMechanicsTargeting(mechanics),
    kind: 'spell',
    spell: {
      level: 1,
      sourceClass: 'CLASS-wizard',
      components: { verbal: true, somatic: true, material: false },
    },
  };
}

function boundWeaponAction(
  primitiveType: 'weapon_attack' | 'light_weapon_extra_attack',
  rangeFt: number,
): RuleActionDefinition {
  const row = patch.mechanicsPatches.actions.find((candidate) => (
    (candidate.mechanics.primitive as Record<string, unknown> | undefined)?.type === primitiveType
  ));
  if (!row) throw new Error(`Patch misses ${primitiveType}`);
  const mechanics = clone(row.mechanics);
  const activation = mechanics.activation as { cost: Array<Record<string, unknown>> };
  activation.cost = activation.cost.filter((cost) => cost.resource !== 'equipped_weapon_ammo');
  (mechanics.targeting as Record<string, unknown>).range_ft = rangeFt;
  return {
    id: `${row.entityId}@bound-test-weapon`,
    name: row.cardNumber,
    sourceEntityIds: [row.entityId, 'bound-test-weapon'],
    mechanics,
    targeting: compileMechanicsTargeting(mechanics),
    kind: 'nonSpell',
  };
}

const TARGET = '22222222-2222-4222-8222-222222222222';

function fact(overrides: Record<string, unknown> = {}) {
  return {
    targetId: TARGET,
    factsSource: 'scenario' as const,
    boardRevision: 7,
    relation: 'enemy' as const,
    distanceFt: 30,
    lineOfSight: true,
    cover: 'none' as const,
    ...overrides,
  };
}

describe('sheet combat declaration is mechanics-owned', () => {
  it.each([
    ['weapon_attack', 37],
    ['light_weapon_extra_attack', 19],
  ] as const)('accepts one %s target using the bound action range and preserves facts', (
    primitiveType,
    rangeFt,
  ) => {
    const action = boundWeaponAction(primitiveType, rangeFt);
    const target = fact({
      factsSource: 'board',
      boardRevision: 11,
      relation: 'neutral',
      distanceFt: rangeFt,
      lineOfSight: true,
      cover: 'half',
    });
    expect(sheetCombatDeclarationPolicy(action)).toMatchObject({
      primitiveType,
      minTargets: 1,
      maxTargets: 1,
      rangeFt,
    });
    const declaration = buildSheetCombatDeclaration({
      action,
      base: { sceneMode: 'encounter', targetIds: [] },
      targets: [target],
    });
    expect(declaration.targetIds).toEqual([TARGET]);
    expect(declaration.factsByTarget).toEqual({
      [TARGET]: {
        factsSource: 'board',
        boardRevision: 11,
        relation: 'neutral',
        distanceFt: rangeFt,
        lineOfSight: true,
        cover: 'half',
      },
    });
    expect(declaration).not.toHaveProperty('spell');
    expect(declaration).not.toHaveProperty('worldInput');
  });

  it('fails closed for malformed or template-phase weapon declarations', () => {
    const bound = boundWeaponAction('weapon_attack', 30);
    expect(() => buildSheetCombatDeclaration({
      action: bound,
      base: { sceneMode: 'encounter', targetIds: [] },
      targets: [],
    })).toThrow('1–1');
    expect(() => buildSheetCombatDeclaration({
      action: bound,
      base: { sceneMode: 'encounter', targetIds: [] },
      targets: [fact(), fact({ targetId: '33333333-3333-4333-8333-333333333333' })],
    })).toThrow('1–1');

    const outside = fact({ distanceFt: 31 });
    expect(() => buildSheetCombatDeclaration({
      action: bound,
      base: { sceneMode: 'encounter', targetIds: [] },
      targets: [outside],
    })).toThrow('30');
    expect(() => buildSheetCombatDeclaration({
      action: bound,
      base: {
        sceneMode: 'encounter',
        targetIds: [],
        worldInput: { type: 'area_objects', factsByObject: {} },
      },
      targets: [fact()],
    })).toThrow('только цель');
    expect(() => buildSheetCombatDeclaration({
      action: bound,
      base: { sceneMode: 'encounter', targetIds: [] },
      targets: [fact()],
      dartAllocation: { [TARGET]: 1 },
    })).toThrow('только цель');

    const template = boundWeaponAction('weapon_attack', 30);
    const activation = template.mechanics.activation as { cost: Array<Record<string, unknown>> };
    activation.cost.push({ resource: 'equipped_weapon_ammo', amount: 1 });
    expect(() => sheetCombatDeclarationPolicy(template)).toThrow('bound cost still contains');

    const malformed = boundWeaponAction('light_weapon_extra_attack', 30);
    (malformed.mechanics.effects as Array<Record<string, unknown>>)[0].tags = ['off_hand'];
    expect(() => sheetCombatDeclarationPolicy(malformed)).toThrow('off_hand and two_weapon');
  });

  it('derives Magic Missile allocation count from a policy mutation', () => {
    const action = patchedAction('magic_missile');
    const primitive = action.mechanics.primitive as Record<string, unknown>;
    const policy = primitive.policy as Record<string, unknown>;
    policy.base_dart_count = 5;
    (action.mechanics.targeting as Record<string, unknown>).max_targets = 13;
    action.targeting = compileMechanicsTargeting(action.mechanics);
    const projection = sheetCombatDeclarationPolicy(action, 1);
    expect(projection.dartCount).toBe(5);
    expect(() => buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'encounter', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact()],
      dartAllocation: { [TARGET]: 3 },
    })).toThrow('ровно 5');
    expect(buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'encounter', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact()],
      dartAllocation: { [TARGET]: 5 },
    }).choices).toEqual({
      magic_missile_dart_targets: [TARGET, TARGET, TARGET, TARGET, TARGET],
    });
  });

  it('takes range from compiled mechanics and rejects a fact outside a mutated range', () => {
    const action = patchedAction('burning_hands_objects');
    const targeting = action.mechanics.targeting as Record<string, unknown>;
    targeting.range_ft = 20;
    action.targeting = compileMechanicsTargeting(action.mechanics);
    expect(sheetCombatDeclarationPolicy(action).rangeFt).toBe(20);
    expect(() => buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'encounter', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact({ distanceFt: 21 })],
    })).toThrow('20');
  });

  it('fails closed when any observed target fact is omitted or invented', () => {
    const action = patchedAction('magic_missile');
    expect(() => buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'encounter', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact({ cover: '' }) as never],
      dartAllocation: { [TARGET]: 3 },
    })).toThrow('укрытие');
    expect(() => buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'encounter', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact({ factsSource: 'client_guess' }) as never],
      dartAllocation: { [TARGET]: 3 },
    })).toThrow('источник фактов');
  });

  it('preserves explicit consent facts for an ordinary canonical action', () => {
    const action = patchedAction('magic_missile');
    delete (action.mechanics as Record<string, unknown>).primitive;
    (action.mechanics.targeting as Record<string, unknown>).requires_willing = true;
    action.targeting = compileMechanicsTargeting(action.mechanics);

    expect(sheetCombatDeclarationPolicy(action)).toMatchObject({
      primitiveType: 'generic_action',
      requiresWilling: true,
    });
    expect(() => buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'exploration', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact()],
    })).toThrow('согласие');
    expect(buildSheetCombatDeclaration({
      action,
      base: {
        sceneMode: 'exploration', targetIds: [],
        spell: { grantId: 'exact-grant', mode: 'normal', castLevel: 1 },
      },
      targets: [fact({ willing: false })],
    }).factsByTarget?.[TARGET]).toMatchObject({ willing: false });
  });

  it('projects ordered repeat slots and upcast ray count from targeting data', () => {
    const mechanics={targeting:{shape:'multiple',domain:'actor',actor_targets:true,
      min_targets:3,max_targets:3,range_ft:120,requires_line_of_sight:true,
      allowed_relations:['enemy'],allow_repeat_targets:true,
      additional_target_slots_per_spell_slot_above_base:1},
      activation:{mode:'active',cost:[]},effects:[]};
    const action:RuleActionDefinition={id:'spell:repeat-rays',name:'Repeat rays',kind:'spell',
      sourceEntityIds:['spell:repeat-rays'],spell:{level:2,sourceClass:'wizard'},
      mechanics,targeting:compileMechanicsTargeting(mechanics)};
    expect(sheetCombatDeclarationPolicy(action,3)).toMatchObject({minTargets:4,maxTargets:4,allowRepeatTargets:true});
    const base={sceneMode:'encounter' as const,targetIds:[],spell:{grantId:'exact',mode:'normal' as const,castLevel:3}};
    expect(buildSheetCombatDeclaration({action,base,targets:[fact(),fact(),fact(),fact()]}).targetIds)
      .toEqual([TARGET,TARGET,TARGET,TARGET]);
    expect(() => buildSheetCombatDeclaration({action,base,targets:[fact(),fact(),fact()]}))
      .toThrow('4–4');
  });

  it('requires additional targets to be close to the first selected actor', () => {
    const mechanics={targeting:{shape:'multiple',domain:'actor',actor_targets:true,
      min_targets:1,max_targets:4,range_ft:150,requires_line_of_sight:true,
      allowed_relations:['enemy'],additional_targets_within_ft_of_first:30},
      activation:{mode:'active',cost:[]},effects:[]};
    const action:RuleActionDefinition={id:'spell:near-first',name:'Near first',kind:'spell',
      sourceEntityIds:['spell:near-first'],spell:{level:6,sourceClass:'wizard'},
      mechanics,targeting:compileMechanicsTargeting(mechanics)};
    const second='33333333-3333-4333-8333-333333333333';
    const base={sceneMode:'encounter' as const,targetIds:[],spell:{grantId:'exact',mode:'normal' as const,castLevel:6}};
    expect(sheetCombatDeclarationPolicy(action)).toMatchObject({additionalTargetsWithinFtOfFirst:30});
    expect(() => buildSheetCombatDeclaration({action,base,
      targets:[fact(),fact({targetId:second,distanceToFirstTargetFt:35})]})).toThrow('30 фт. от первой');
    expect(buildSheetCombatDeclaration({action,base,
      targets:[fact(),fact({targetId:second,distanceToFirstTargetFt:25})]}).factsByTarget?.[second])
      .toMatchObject({distanceToFirstTargetFt:25});
  });

  it('uses the same character-level ray tiers in sheet policy and declaration',()=>{
    const mechanics={targeting:{shape:'multiple',domain:'actor',actor_targets:true,
      min_targets:1,max_targets:1,range_ft:120,requires_line_of_sight:true,
      allowed_relations:['enemy'],allow_repeat_targets:true,
      target_slots_by_character_level:{1:1,5:2,11:3,17:4}},
      activation:{mode:'active',cost:[]},effects:[]};
    const action:RuleActionDefinition={id:'spell:leveled-rays',name:'Level rays',kind:'spell',
      sourceEntityIds:['spell:leveled-rays'],spell:{level:0,sourceClass:'warlock'},
      mechanics,targeting:compileMechanicsTargeting(mechanics)};
    expect(sheetCombatDeclarationPolicy(action,undefined,5)).toMatchObject({minTargets:2,maxTargets:2,allowRepeatTargets:true});
    expect(sheetCombatDeclarationPolicy(action,undefined,17)).toMatchObject({minTargets:4,maxTargets:4});
    const base={sceneMode:'encounter' as const,targetIds:[],spell:{grantId:'exact',mode:'normal' as const}};
    expect(buildSheetCombatDeclaration({action,base,actorLevel:5,targets:[fact(),fact()]}).targetIds)
      .toEqual([TARGET,TARGET]);
    expect(()=>buildSheetCombatDeclaration({action,base,actorLevel:5,targets:[fact()]})).toThrow('2–2');
  });
});
