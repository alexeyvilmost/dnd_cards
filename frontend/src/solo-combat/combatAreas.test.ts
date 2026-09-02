import { afterEach, describe, expect, it } from 'vitest';
import { replaceConditionEntityReferences, resetConditionsToOfflineFixture } from '../engine/conditions';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  createCombatArea,
  movementCostThroughAreas,
  queueCombatAreaEvent,
  reconcileInsideAreaConditions,
  removeInactiveCombatAreas,
  worldZonePayload,
} from './combatAreas';
import { spatialFacts, type CombatAreaState, type SoloCombatState } from './types';
import { moveActor } from './engine';

function state(): SoloCombatState {
  const runtime = () => ({
    hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
    equipment: {}, inventory: [], activeEffects: [],
  });
  return {
    schemaVersion: 1, characterId: 'caster', runtimeRevision: 0,
    world: {
      id: 'world', schemaVersion: 5, ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      revision: 3, logicalClock: 3,
      actors: {
        caster: {
          id: 'caster', name: 'Caster', kind: 'playerCharacter', controllerId: 'u',
          capabilities: { actionIds: ['grease'] },
          character: { level: 1, profBonus: 2, abilityMods: { int: 3 }, spellcastingAbility: 'int' },
          runtime: runtime(), lifecycle: { status: 'alive' },
          spellcastingAccess: { schemaVersion: 1, grants: [{
            grantId: 'wizard:grease', actionId: 'grease', sourceId: 'CLASS-wizard',
            access: 'prepared', level: 1, spellcastingAbility: 'int', slotResource: 'spell_slot_1',
          }] },
        },
        target: {
          id: 'target', name: 'Target', kind: 'monster', controllerId: 'system',
          capabilities: { actionIds: [] }, character: { level: 1, profBonus: 2, abilityMods: { dex: 0 } },
          runtime: runtime(), lifecycle: { status: 'alive' },
        },
      },
      objects: {}, concentrations: {}, attackActions: {}, grapples: {}, processedCommandIds: [],
      pendingResolution: null,
      scene: { mode: 'encounter', round: 1, activeIndex: 0, initiative: ['caster', 'target'] },
    },
    catalogActions: [], sideByActorId: { caster: 'heroes', target: 'monsters' }, actorPresentation: {},
    playerActionIds: [], certifiedPlayerActionIds: [], monsterActionIds: {}, opportunityActionIds: {},
    resourceBindings: {}, tokens: {
      caster: { actorId: 'caster', color: 'blue', position: { x: 0, y: 0 } },
      target: { actorId: 'target', color: 'red', position: { x: 3, y: 3 } },
    },
    combatAreas: {}, boardRevision: 1, movementRemainingFt: { caster: 30, target: 30 },
    initiativeBonuses: {}, initiative: [], log: [], outcome: 'active',
  } as unknown as SoloCombatState;
}

const grease: RuleActionDefinition = {
  id: 'grease', name: 'Смазка', kind: 'spell', sourceEntityIds: ['SPELL-0292'], concentration: false,
  spell: { level: 1, classListIds: ['CLASS-wizard'], components: { verbal: true, somatic: true, material: true } },
  targeting: { minTargets: 0, maxTargets: 0, rangeFt: 60, requiresLineOfSight: true, allowedRelations: [] },
  mechanics: {
    targeting: { shape: 'area', domain: 'world', actor_targets: false, range_ft: 60, area: { kind: 'cube', size_ft: 10 } },
    effects: [{ resolution: 'auto', result: [{
      kind: 'world_zone', zone_type: 'grease', geometry: { shape: 'cube', size_ft: 10 },
      duration: { type: 'rounds', amount: 10 }, tactical: {
        triggers: ['created', 'enter', 'end_turn'], difficult_terrain: true,
        save: { ability: 'dex', dc: 'spell_save_dc' },
        on_failure: [{ kind: 'condition', value: 'prone', op: 'apply' }], on_success: [],
      },
    }] }],
  },
};

afterEach(() => resetConditionsToOfflineFixture('combat_area_test_cleanup'));

describe('persistent combat areas', () => {
  it('materializes data-owned geometry, dynamic spell DC and deduplicated lifecycle triggers', () => {
    const initial = state();
    const area = createCombatArea({ state: initial, action: grease, sourceActorId: 'caster', origin: { x: 3, y: 3 } });
    expect(area?.cells).toHaveLength(4);
    expect(area?.hazard?.save).toEqual({ ability: 'dex', dc: 13 });
    expect(area?.duration).toEqual({ type: 'rounds', roundsLeft: 10 });
    const withArea = { ...initial, combatAreas: { [area!.id]: area! } };
    const once = queueCombatAreaEvent(withArea, 'created', ['target']);
    const twice = queueCombatAreaEvent(once, 'created', ['target']);
    expect(twice.pendingCombatAreaTriggers).toHaveLength(1);
    expect(movementCostThroughAreas(withArea, { x: 2, y: 3 }, { x: 3, y: 3 }, 5)).toBe(10);
  });

  it('uses a real condition entity inside fog and removes it on exit/concentration loss', () => {
    replaceConditionEntityReferences({ blinded: { kind: 'effect', id: 'effect-blinded', cardNumber: 'EFFECT-blinded' } });
    const initial = state();
    const fog: CombatAreaState = {
      id: 'fog', name: 'Туманное облако', zoneType: 'fog_cloud', sourceActorId: 'caster',
      sourceActionId: 'fog', sourceEntityIds: ['SPELL-0303'], origin: { x: 3, y: 3 },
      cells: [{ x: 3, y: 3 }], duration: { type: 'concentration' }, triggers: [],
      heavilyObscured: true, insideCondition: 'blinded',
    };
    const inside = reconcileInsideAreaConditions({
      ...initial,
      combatAreas: { fog },
      world: { ...initial.world, concentrations: { caster: {
        id: 'conc', sourceActorId: 'caster', actionId: 'fog', startedAtRevision: 3, effectLinks: [],
      } } },
    });
    expect(inside.world.actors.target.runtime.activeEffects[0].entityRef).toEqual({
      kind: 'effect', id: 'effect-blinded', cardNumber: 'EFFECT-blinded',
    });
    expect(spatialFacts(inside, 'caster', 'target').lineOfSight).toBe(false);
    const cleared = removeInactiveCombatAreas({
      ...inside, world: { ...inside.world, concentrations: {} },
    });
    expect(cleared.combatAreas).toEqual({});
    expect(cleared.world.actors.target.runtime.activeEffects).toEqual([]);
  });

  it('opens and resolves an entry hazard through the canonical saving-throw pipeline', () => {
    replaceConditionEntityReferences({ prone: { kind: 'effect', id: 'effect-prone', cardNumber: 'EFFECT-prone' } });
    const initial = state();
    initial.tokens.target.position = { x: 2, y: 3 };
    const bearings: CombatAreaState = {
      id: 'bearings', name: 'Металлические шарики', zoneType: 'ball_bearings',
      sourceActorId: 'caster', sourceActionId: 'bearings-action', sourceEntityIds: ['CARD-0799'],
      origin: { x: 3, y: 3 }, cells: [{ x: 3, y: 3 }], duration: { type: 'permanent' },
      triggers: ['enter'], hazard: {
        id: 'combat-area:bearings', name: 'Металлические шарики', sourceKind: 'environment',
        sourceEntityIds: ['CARD-0799'], save: { ability: 'dex', dc: 10 },
        onFailure: [{ kind: 'condition', value: 'prone', op: 'apply' }], onSuccess: [],
      },
    };
    initial.combatAreas = { bearings };
    const moved = moveActor({ state: initial, actorId: 'target', destination: { x: 3, y: 3 }, rng: () => 0 });
    expect(moved.world.pendingResolution).toBeNull();
    expect(moved.world.actors.target.runtime.activeEffects).toEqual([
      expect.objectContaining({
        mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }),
        entityRef: { kind: 'effect', id: 'effect-prone', cardNumber: 'EFFECT-prone' },
        ownerId: 'target',
        sourceId: 'environment:combat-area:bearings',
      }),
    ]);
  });

  it('creates only the explicitly selected Alarm mode and keeps its entry notice data-owned', () => {
    const alarm: RuleActionDefinition = {
      ...grease,
      id: 'alarm', name: 'Тревога', sourceEntityIds: ['SPELL-0288'],
      mechanics: {
        targeting: grease.mechanics.targeting,
        effects: [{ resolution: 'auto', result: [{
          kind: 'choice', id: 'alarm_mode', options: { items: [
            { id: 'audible', grants: [{
              kind: 'world_zone', zone_type: 'alarm', geometry: { shape: 'cube', size_ft: 20 },
              tactical: { triggers: ['enter'], notice: 'Тревога сработала' },
            }] },
            { id: 'mental', grants: [{
              kind: 'world_zone', zone_type: 'alarm', geometry: { shape: 'cube', size_ft: 20 },
              tactical: { triggers: ['enter'], notice: 'Мысленная тревога сработала' },
            }] },
          ] } },
        ] }],
      },
    };
    expect(worldZonePayload(alarm)).toBeNull();
    const selected = createCombatArea({
      state: state(), action: alarm, sourceActorId: 'caster', origin: { x: 3, y: 3 },
      choices: { alarm_mode: ['mental'] },
    });
    expect(selected).toEqual(expect.objectContaining({
      zoneType: 'alarm', notice: 'Мысленная тревога сработала', triggers: ['enter'],
    }));
    expect(selected?.hazard).toBeUndefined();
  });
});
