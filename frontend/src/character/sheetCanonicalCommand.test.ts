import { describe, expect, it } from 'vitest';
import contentPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import { compileMechanicsTargeting } from '../rules-core/actionTargeting';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
} from '../rules-core/domain';
import {
  buildSheetCanonicalCommand,
  SheetCanonicalCommandInputError,
  stageSheetScenarioObjects,
} from './sheetCanonicalCommand';
import { sheetActionRequiresActorTargets } from './sheetPrimitiveUi';

type PatchRow = {
  entityId: string;
  mechanics: Record<string, unknown>;
};

const patches = contentPatch.mechanicsPatches.spells as PatchRow[];

function productionSpell(primitiveType: string): RuleActionDefinition {
  const row = patches.find((candidate) => (
    (candidate.mechanics.primitive as { type?: string } | undefined)?.type === primitiveType
  ));
  if (!row) throw new Error(`Missing production patch for ${primitiveType}`);
  return {
    id: `compiled:${row.entityId}`,
    name: primitiveType,
    kind: 'spell',
    sourceEntityIds: [row.entityId],
    spell: {
      level: 1,
      components: { verbal: true, somatic: true, material: false },
    },
    targeting: compileMechanicsTargeting(row.mechanics),
    mechanics: structuredClone(row.mechanics),
  };
}

function actor(id = 'pc:self'): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 10,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
    },
  };
}

function world() {
  return createWorld({
    id: 'sheet-command-test',
    ruleset: {
      systemId: 'dnd5e-2024',
      releaseId: 'sheet-command-test@1',
      contentHash: 'sha256:sheet-command-test',
      errataVersion: 'PHB-2024',
    },
    actors: [actor()],
  });
}

describe('typed canonical sheet command declaration', () => {
  it('uses the world actor level when validating repeated cantrip beam slots',()=>{
    const mechanics={activation:{mode:'active',cost:[{resource:'action'}]},
      targeting:{shape:'multiple',domain:'actor',actor_targets:true,min_targets:1,max_targets:1,
        range_ft:120,requires_line_of_sight:true,allowed_relations:['enemy'],allow_repeat_targets:true,
        target_slots_by_character_level:{1:1,5:2,11:3,17:4}},effects:[]};
    const action:RuleActionDefinition={id:'compiled:level-beams',name:'Level beams',kind:'spell',
      sourceEntityIds:['entity:level-beams'],spell:{level:0},mechanics,
      targeting:compileMechanicsTargeting(mechanics)};
    const state=world();
    state.actors['pc:self'].character.level=11;
    const declaration={sceneMode:'encounter' as const,targetIds:['pc:target','pc:target','pc:target'],
      factsByTarget:{'pc:target':{factsSource:'board' as const,boardRevision:1,distanceFt:10,
        lineOfSight:true,cover:'none' as const,relation:'enemy' as const}},
      spell:{grantId:'grant:beams',mode:'normal' as const}};
    const input={world:state,actorId:'pc:self',action,primitiveType:'generic_action',
      commandId:'command:beams'};
    expect(buildSheetCanonicalCommand({...input,declaration})).toMatchObject({targetIds:declaration.targetIds});
    expect(()=>buildSheetCanonicalCommand({...input,declaration:{...declaration,targetIds:['pc:target']}}))
      .toThrow('requires 3–3');
  });
  it.each([
    ['temporary_hp_melee_retaliation', { temporary_hp: 'take_spell' }],
    ['find_familiar', {
      find_familiar_form: 'owl',
      find_familiar_spirit: 'fey',
      find_familiar_cast_path: 'spell_slot',
    }],
  ] as const)('%s is self-targeted from production mechanics and never invents an actor target', (
    primitiveType,
    choices,
  ) => {
    const action = productionSpell(primitiveType);
    expect(action.targeting).toMatchObject({ minTargets: 0, allowedRelations: ['self'] });
    expect(sheetActionRequiresActorTargets(action)).toBe(false);
    const command = buildSheetCanonicalCommand({
      world: world(),
      actorId: 'pc:self',
      action,
      primitiveType,
      commandId: `command:${primitiveType}`,
      declaration: {
        sceneMode: 'exploration',
        targetIds: [],
        choices,
        spell: { grantId: `grant:${primitiveType}`, mode: 'normal' },
      },
    });
    expect(command).toMatchObject({ type: 'UseAction', targetIds: [] });
    expect('factsByTarget' in command).toBe(false);
  });

  it('requires exact facts for every selected actor and rejects extras before dispatch', () => {
    const action: RuleActionDefinition = {
      id: 'compiled:actor-target',
      name: 'Actor target',
      kind: 'nonSpell',
      sourceEntityIds: ['entity:actor-target'],
      targeting: {
        minTargets: 1,
        maxTargets: 1,
        rangeFt: 30,
        requiresLineOfSight: true,
        allowedRelations: ['enemy'],
      },
      mechanics: { activation: { mode: 'active', cost: [] } },
    };
    expect(() => buildSheetCanonicalCommand({
      world: world(), actorId: 'pc:self', action,
      primitiveType: 'future_actor_primitive', commandId: 'command:missing-facts',
      declaration: { sceneMode: 'exploration', targetIds: ['pc:target'] },
    })).toThrowError(SheetCanonicalCommandInputError);
    expect(() => buildSheetCanonicalCommand({
      world: world(), actorId: 'pc:self', action,
      primitiveType: 'future_actor_primitive', commandId: 'command:extra-facts',
      declaration: {
        sceneMode: 'exploration', targetIds: ['pc:target'],
        factsByTarget: {
          'pc:target': {
            factsSource: 'board', boardRevision: 1, distanceFt: 10,
            lineOfSight: true, cover: 'none', relation: 'enemy',
          },
          'pc:other': {
            factsSource: 'board', boardRevision: 1, distanceFt: 10,
            lineOfSight: true, cover: 'none', relation: 'enemy',
          },
        },
      },
    })).toThrowError(SheetCanonicalCommandInputError);
  });

  it('stages scenario objects on a clone and leaves the persisted source world unchanged', () => {
    const source = world();
    const staged = stageSheetScenarioObjects(source, [{
      id: 'object:torch', name: 'Torch', kind: 'item', size: 'tiny',
      flame: { kind: 'torch', lit: false },
    }]);
    expect(source.objects).toEqual({});
    expect(staged.objects['object:torch']).toMatchObject({ name: 'Torch' });
    expect(() => stageSheetScenarioObjects(staged, [{
      id: 'object:torch', name: 'Duplicate', kind: 'item', size: 'tiny',
    }])).toThrowError(SheetCanonicalCommandInputError);
    expect(Object.keys(staged.objects)).toEqual(['object:torch']);
  });
});
