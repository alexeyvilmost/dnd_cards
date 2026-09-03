import { afterEach, describe, expect, it } from 'vitest';
import { replaceConditionEntityReferences, resetConditionsToOfflineFixture } from '../engine/conditions';
import { applyIncomingDamage } from '../engine/execute';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  createCombatArea,
  movementCostThroughAreas,
  queueCombatAreaEvent,
  reanchorSourceCombatAreas,
  normalizeSourceAnchoredCombatAreas,
  reconcileInsideAreaConditions,
  removeInactiveCombatAreas,
  worldZonePayload,
} from './combatAreas';
import { spatialFacts, type CombatAreaState, type SoloCombatState } from './types';
import { autoResolveSystemDecisions, executeCombatAction, moveActor } from './engine';

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
          grantedEffects: {
            'COND-blinded': {
              id: 'effect-blinded', card_number: 'COND-blinded', name: 'Ослеплён',
              mechanics: { activation: { mode: 'passive' }, condition: { id: 'blinded' }, effects: [] },
            },
            'COND-prone': {
              id: 'effect-prone', card_number: 'COND-prone', name: 'Распластан',
              mechanics: { activation: { mode: 'passive' }, condition: { id: 'prone' }, effects: [] },
            },
          },
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
      scene: { mode: 'encounter', round: 1, activeIndex: 0, initiative: ['caster', 'target'], turnStarted: true },
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
        on_failure: [{ kind: 'grant_effect', value: 'COND-prone', area_linked: true }], on_success: [],
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
    expect(area?.hazard).toMatchObject({
      resolution: 'save', save: { ability: 'dex', dc: 13 },
    });
    expect(area?.duration).toEqual({ type: 'rounds', roundsLeft: 10 });
    const withArea = { ...initial, combatAreas: { [area!.id]: area! } };
    const once = queueCombatAreaEvent(withArea, 'created', ['target']);
    const twice = queueCombatAreaEvent(once, 'created', ['target']);
    expect(twice.pendingCombatAreaTriggers).toHaveLength(1);
    expect(movementCostThroughAreas(withArea, { x: 2, y: 3 }, { x: 3, y: 3 }, 5)).toBe(10);
  });

  it('projects Web light obscurement without blocking line of sight', () => {
    const initial = state();
    const web: RuleActionDefinition = {
      ...grease,
      id: 'web', name: 'Паутина', sourceEntityIds: ['SPELL-0257'], concentration: true,
      mechanics: {
        targeting: grease.mechanics.targeting,
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'web',
          geometry: { shape: 'cube', size_ft: 20 }, duration: { type: 'concentration' },
          tactical: { lightly_obscured: true, difficult_terrain: true },
        }] }],
      },
    };
    const area = createCombatArea({
      state: initial, action: web, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    expect(area.lightlyObscured).toBe(true);
    expect(area.heavilyObscured).toBe(false);
    const withWeb = { ...initial, combatAreas: { [area.id]: area } };
    expect(spatialFacts(withWeb, 'caster', 'target').lineOfSight).toBe(true);
  });

  it('uses a real condition entity inside fog and removes it on exit/concentration loss', () => {
    replaceConditionEntityReferences({ blinded: { kind: 'effect', id: 'effect-blinded', cardNumber: 'COND-blinded' } });
    const initial = state();
    const fogAction: RuleActionDefinition = {
      ...grease, id: 'fog', name: 'Туманное облако', sourceEntityIds: ['SPELL-0303'],
      concentration: true,
      mechanics: {
        targeting: grease.mechanics.targeting,
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'fog_cloud', geometry: { shape: 'cube', size_ft: 10 },
          duration: { type: 'concentration' }, tactical: {
            heavily_obscured: true,
            inside_effect: { kind: 'grant_effect', value: 'COND-blinded' },
          },
        }] }],
      },
    };
    const fog = createCombatArea({
      state: initial, action: fogAction, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    expect(fog.insideEffect).toEqual({
      cardNumber: 'COND-blinded', entityId: 'effect-blinded', name: 'Ослеплён', conditionId: 'blinded',
    });
    const inside = reconcileInsideAreaConditions({
      ...initial,
      combatAreas: { [fog.id]: fog },
      world: { ...initial.world, concentrations: { caster: {
        id: 'conc', sourceActorId: 'caster', actionId: 'fog', startedAtRevision: 3, effectLinks: [],
      } } },
    });
    expect(inside.world.actors.target.runtime.activeEffects[0].entityRef).toEqual({
      kind: 'effect', id: 'effect-blinded', cardNumber: 'COND-blinded',
    });
    expect(spatialFacts(inside, 'caster', 'target').lineOfSight).toBe(false);
    const cleared = removeInactiveCombatAreas({
      ...inside, world: { ...inside.world, concentrations: {} },
    });
    expect(cleared.combatAreas).toEqual({});
    expect(cleared.world.actors.target.runtime.activeEffects).toEqual([]);
  });

  it('opens and resolves an entry hazard through the canonical saving-throw pipeline', () => {
    replaceConditionEntityReferences({ prone: { kind: 'effect', id: 'effect-prone', cardNumber: 'COND-prone' } });
    const initial = state();
    initial.tokens.target.position = { x: 2, y: 3 };
    const contextualGrease = { ...grease, id: 'grease@CLASS-wizard' };
    const area = createCombatArea({
      state: initial, action: contextualGrease, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    expect(area.hazard?.id).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(area.hazard?.id).not.toContain('@');
    initial.combatAreas = { [area.id]: area };
    const moved = moveActor({ state: initial, actorId: 'target', destination: { x: 3, y: 3 }, rng: () => 0 });
    expect(moved.world.pendingResolution).toBeNull();
    expect(moved.world.actors.target.runtime.activeEffects).toEqual([
      expect.objectContaining({
        mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }),
        entityRef: { kind: 'effect', id: 'effect-prone', cardNumber: 'COND-prone' },
        ownerId: 'target',
        sourceId: `environment:${area.hazard!.id}`,
      }),
    ]);
    const outside = reconcileInsideAreaConditions({
      ...moved,
      tokens: { ...moved.tokens, target: { ...moved.tokens.target, position: { x: 5, y: 5 } } },
    });
    expect(outside.world.actors.target.runtime.activeEffects).toEqual([]);
  });

  it('applies no-save area damage on entry without opening a fake saving throw', () => {
    const initial = state();
    initial.tokens.target.position = { x: 2, y: 3 };
    const cloud: RuleActionDefinition = {
      ...grease,
      id: 'cloud-of-daggers', name: 'Облако кинжалов', sourceEntityIds: ['SPELL-0234'],
      mechanics: {
        targeting: {
          shape: 'area', domain: 'world', actor_targets: false, range_ft: 60,
          area: { kind: 'cube', size_ft: 5 },
        },
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'cloud_of_daggers',
          geometry: { shape: 'cube', size_ft: 5 }, duration: { type: 'rounds', amount: 10 },
          tactical: {
            triggers: ['created', 'enter', 'end_turn'],
            auto_effects: [{ kind: 'damage', dice: '2d4', type: 'force' }],
          },
        }] }],
      },
    };
    const area = createCombatArea({
      state: initial, action: cloud, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    expect(area.hazard).toMatchObject({
      resolution: 'automatic', effects: [{ kind: 'damage', dice: '2d4', type: 'force' }],
    });
    initial.combatAreas = { [area.id]: area };
    const moved = moveActor({ state: initial, actorId: 'target', destination: { x: 3, y: 3 }, rng: () => 0 });
    expect(moved.world.pendingResolution).toBeNull();
    expect(moved.world.actors.target.runtime.hp.current).toBe(8);
    expect(moved.log.flatMap((entry) => entry.records ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceActorId: `environment:${area.hazard!.id}`,
        actorId: `environment:${area.hazard!.id}`,
        targetIds: ['target'],
        event: expect.objectContaining({ type: 'damage', amount: 2, damageType: 'force' }),
      }),
    ]));
  });

  it('applies Spike Growth damage once for every five feet moved inside its area', () => {
    const initial = state();
    initial.tokens.target.position = { x: 1, y: 3 };
    const spikeGrowth: RuleActionDefinition = {
      ...grease,
      id: 'spike-growth', name: 'Поросль шипов', sourceEntityIds: ['SPELL-0266'],
      mechanics: {
        targeting: {
          shape: 'area', domain: 'world', actor_targets: false, range_ft: 150,
          area: { kind: 'cube', size_ft: 20 },
        },
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'spike_growth',
          geometry: { shape: 'cube', size_ft: 20 }, duration: { type: 'concentration' },
          tactical: {
            triggers: ['move'], difficult_terrain: true,
            auto_effects: [{ kind: 'damage', dice: '2d4', type: 'piercing' }],
          },
        }] }],
      },
    };
    const area = createCombatArea({
      state: initial, action: spikeGrowth, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    initial.combatAreas = { [area.id]: area };
    const moved = moveActor({
      state: initial, actorId: 'target', destination: { x: 4, y: 3 }, maxFeet: 30, rng: () => 0,
    });
    expect(moved.world.actors.target.runtime.hp.current).toBe(4);
    expect(moved.log.flatMap((entry) => entry.records ?? []).filter((record) => (
      record.event?.type === 'damage'
    ))).toHaveLength(3);
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

  it('blocks a verbal spell while its caster is inside a Silence area', () => {
    const initial = state();
    initial.catalogActions = [grease];
    initial.playerActionIds = [grease.id];
    initial.combatAreas = { silence: {
      id: 'silence', name: 'Тишина', zoneType: 'silence', sourceActorId: 'caster',
      sourceActionId: 'silence', sourceEntityIds: ['SPELL-0301'], origin: { x: 0, y: 0 },
      cells: [{ x: 0, y: 0 }], duration: { type: 'concentration' }, triggers: [],
      blocksVerbalComponents: true,
    } };
    expect(() => executeCombatAction({
      state: initial, actorId: 'caster', actionId: grease.id, targetIds: [],
      worldPosition: { x: 3, y: 3 },
    })).toThrow(/Вербальный компонент/u);
  });

  it('grants and removes Silence thunder immunity with exact area membership', () => {
    const initial = state();
    const silence: CombatAreaState = {
      id: 'silence', name: 'Тишина', zoneType: 'silence', sourceActorId: 'caster',
      sourceActionId: 'silence', sourceEntityIds: ['SPELL-0301'], origin: { x: 3, y: 3 },
      cells: [{ x: 3, y: 3 }], duration: { type: 'concentration' }, triggers: [],
      damageImmunities: ['thunder'],
    };
    const inside = reconcileInsideAreaConditions({ ...initial, combatAreas: { silence } });
    const target = inside.world.actors.target;
    const thunder = applyIncomingDamage(target.runtime, 8, {
      character: target.character, rng: () => 0,
    }, { damageType: 'thunder' });
    expect(thunder.state.hp.current).toBe(10);
    const outside = reconcileInsideAreaConditions({
      ...inside,
      tokens: { ...inside.tokens, target: { ...inside.tokens.target, position: { x: 4, y: 3 } } },
    });
    expect(outside.world.actors.target.runtime.activeEffects).toEqual([]);
  });

  it('uses a distinct end-turn save hazard after an automatic start-turn rider', () => {
    const initial = state();
    const hadar: RuleActionDefinition = {
      ...grease,
      id: 'hunger-of-hadar', name: 'Голод Хадара', sourceEntityIds: ['SPELL-9999'],
      concentration: true,
      mechanics: {
        targeting: {
          shape: 'area', domain: 'world', actor_targets: false, range_ft: 150,
          area: { kind: 'sphere', radius_ft: 20 },
        },
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'hunger_of_hadar',
          geometry: { shape: 'sphere', radius_ft: 20 }, duration: { type: 'concentration' },
          tactical: {
            triggers: ['start_turn'],
            auto_effects: [{ kind: 'damage', dice: '2d6', type: 'cold' }],
            end_turn_save: {
              ability: 'dex', dc: 'spell_save_dc',
              on_failure: [{ kind: 'damage', dice: '2d6', type: 'acid' }], on_success: [],
            },
          },
        }] }],
      },
    };
    const area = createCombatArea({
      state: initial, action: hadar, sourceActorId: 'caster', origin: { x: 3, y: 3 },
    })!;
    expect(area.triggers).toEqual(['start_turn', 'end_turn']);
    expect(area.hazard).toMatchObject({ resolution: 'automatic' });
    expect(area.eventHazards?.end_turn).toMatchObject({
      resolution: 'save', save: { ability: 'dex', dc: 13 },
      onFailure: [{ kind: 'damage', dice: '2d6', type: 'acid' }],
    });
    initial.combatAreas = { [area.id]: area };
    const queued = queueCombatAreaEvent(initial, 'end_turn', ['target']);
    const opened = autoResolveSystemDecisions(queued, () => 0);
    expect(opened.world.actors.target.runtime.hp.current).toBe(8);
    expect(opened.world.pendingResolution).toBeNull();
    expect(opened.log.flatMap((entry) => entry.records ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceActorId: `environment:${area.eventHazards!.end_turn!.id}`,
        event: expect.objectContaining({ type: 'damage', amount: 2, damageType: 'acid' }),
      }),
    ]));
  });

  it('moves a source-anchored emanation and queues actors entered by its footprint', () => {
    const initial = state();
    const radiance: RuleActionDefinition = {
      ...grease,
      id: 'radiance', name: 'Внутренний свет', sourceEntityIds: ['ACT-aasimar-revelation'],
      mechanics: {
        targeting: {
          shape: 'area', domain: 'world', actor_targets: false, range_ft: 0,
          area: { kind: 'emanation', radius_ft: 5 },
        },
        effects: [{ resolution: 'auto', result: [{
          kind: 'world_zone', zone_type: 'aasimar_radiance',
          duration: { type: 'rounds', amount: 10 },
          tactical: {
            anchor: 'source', triggers: ['enter'], notice: 'Источник приблизился.',
          },
        }] }],
      },
    };
    const area = createCombatArea({
      state: initial, action: radiance, sourceActorId: 'caster', origin: { x: 9, y: 9 },
    })!;
    expect(area).toMatchObject({
      origin: { x: 0, y: 0 }, sourceAnchored: true, sourceAnchorRadiusFt: 5,
    });
    expect(area.cells).toHaveLength(4);

    const moved = reanchorSourceCombatAreas({
      ...initial,
      combatAreas: { [area.id]: area },
      tokens: {
        ...initial.tokens,
        caster: { ...initial.tokens.caster, position: { x: 2, y: 2 } },
      },
    }, 'caster');
    expect(moved.combatAreas?.[area.id]).toMatchObject({ origin: { x: 2, y: 2 } });
    expect(moved.combatAreas?.[area.id].cells).toHaveLength(9);
    expect(moved.pendingCombatAreaTriggers).toEqual([
      expect.objectContaining({ areaId: area.id, actorId: 'target', event: 'enter' }),
    ]);
  });

  it('keeps a source-anchored emanation attached through action teleport', () => {
    const initial = state();
    const teleport: RuleActionDefinition = {
      id: 'teleport', name: 'Телепортация', kind: 'nonSpell', sourceEntityIds: ['fixture'],
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
      },
      mechanics: {
        activation: { mode: 'active', cost: [] },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'self', min_targets: 1, max_targets: 1,
          range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'],
        },
        effects: [{ resolution: 'auto', result: [{ kind: 'movement', value: 'teleport', distance: 15 }] }],
      },
    };
    initial.world.actors.caster.capabilities = {
      actionIds: [teleport.id], featureSources: { [teleport.id]: ['fixture'] },
    };
    initial.catalogActions = [teleport];
    initial.playerActionIds = [teleport.id];
    initial.combatAreas = {
      radiance: {
        id: 'radiance', name: 'Внутренний свет', zoneType: 'aasimar_radiance',
        sourceActorId: 'caster', sourceActionId: 'revelation', sourceEntityIds: ['fixture'],
        origin: { x: 0, y: 0 }, cells: [{ x: 0, y: 0 }],
        duration: { type: 'rounds', roundsLeft: 10 }, triggers: [],
        sourceAnchored: true, sourceAnchorRadiusFt: 5,
      },
    };
    const moved = executeCombatAction({
      state: initial, actorId: 'caster', actionId: teleport.id, targetIds: ['caster'],
      worldPosition: { x: 2, y: 2 }, rng: () => 0,
    });
    expect(moved.tokens.caster.position).toEqual({ x: 2, y: 2 });
    expect(moved.combatAreas?.radiance.origin).toEqual({ x: 2, y: 2 });
  });

  it('keeps a source-anchored emanation attached through forced movement', () => {
    const initial = state();
    initial.tokens.target.position = { x: 0, y: 0 };
    initial.tokens.caster.position = { x: 2, y: 2 };
    if (initial.world.scene.mode !== 'encounter') throw new Error('fixture');
    initial.world.scene.activeIndex = 1;
    const push: RuleActionDefinition = {
      id: 'push', name: 'Толчок', kind: 'nonSpell', sourceEntityIds: ['fixture'],
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 30,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
      mechanics: {
        activation: { mode: 'active', cost: [] },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
          range_ft: 30, requires_line_of_sight: true, allowed_relations: ['enemy'],
        },
        effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'movement', value: 'push', distance: 5 }] }],
      },
    };
    initial.world.actors.target.capabilities = {
      actionIds: [push.id], featureSources: { [push.id]: ['fixture'] },
    };
    initial.catalogActions = [push];
    initial.monsterActionIds.target = [push.id];
    initial.combatAreas = {
      radiance: {
        id: 'radiance', name: 'Внутренний свет', zoneType: 'aasimar_radiance',
        sourceActorId: 'caster', sourceActionId: 'revelation', sourceEntityIds: ['fixture'],
        origin: { x: 2, y: 2 }, cells: [{ x: 2, y: 2 }],
        duration: { type: 'rounds', roundsLeft: 10 }, triggers: [],
        sourceAnchored: true, sourceAnchorRadiusFt: 5,
      },
    };
    const moved = executeCombatAction({
      state: initial, actorId: 'target', actionId: push.id, targetIds: ['caster'], rng: () => 0,
    });
    expect(moved.tokens.caster.position).not.toEqual({ x: 2, y: 2 });
    expect(moved.combatAreas?.radiance.origin).toEqual(moved.tokens.caster.position);
  });

  it('rebuilds persisted source-anchored cells from the source token', () => {
    const initial = state();
    initial.tokens.caster.position = { x: 4, y: 4 };
    initial.combatAreas = {
      radiance: {
        id: 'radiance', name: 'Внутренний свет', zoneType: 'aasimar_radiance',
        sourceActorId: 'caster', sourceActionId: 'revelation', sourceEntityIds: ['fixture'],
        origin: { x: 0, y: 0 }, cells: [{ x: 11, y: 9 }],
        duration: { type: 'rounds', roundsLeft: 10 }, triggers: [],
        sourceAnchored: true, sourceAnchorRadiusFt: 5,
      },
    };
    const normalized = normalizeSourceAnchoredCombatAreas(initial);
    expect(normalized.combatAreas?.radiance.origin).toEqual({ x: 4, y: 4 });
    expect(normalized.combatAreas?.radiance.cells).toEqual(expect.arrayContaining([
      { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 5 },
    ]));
  });

  it('targets every member only when a source-turn emanation owner ends their turn', () => {
    const initial = state();
    const radiance: CombatAreaState = {
      id: 'radiance', name: 'Внутренний свет', zoneType: 'aasimar_radiance',
      sourceActorId: 'caster', sourceActionId: 'revelation',
      sourceEntityIds: ['ACT-aasimar-revelation'], origin: { x: 2, y: 2 },
      cells: [{ x: 2, y: 2 }, { x: 3, y: 3 }],
      duration: { type: 'rounds', roundsLeft: 10 }, triggers: ['end_turn'],
      sourceAnchored: true, sourceAnchorRadiusFt: 10, sourceTurnAffectsAllInside: true,
      notice: 'Всем внутри.',
    };
    initial.tokens.caster.position = { x: 2, y: 2 };
    initial.combatAreas = { [radiance.id]: radiance };
    expect(queueCombatAreaEvent(initial, 'end_turn', ['target']).pendingCombatAreaTriggers).toEqual([]);
    expect(queueCombatAreaEvent(initial, 'end_turn', ['caster']).pendingCombatAreaTriggers).toEqual([
      expect.objectContaining({ actorId: 'caster', event: 'end_turn' }),
      expect.objectContaining({ actorId: 'target', event: 'end_turn' }),
    ]);
  });

  it('creates a selected source-anchored emanation without a map destination', () => {
    const initial = state();
    initial.world.actors.caster.character.profBonus = 5;
    initial.world.actors.target.character.profBonus = 2;
    const revelation: RuleActionDefinition = {
      id: 'revelation', name: 'Небесное откровение', kind: 'nonSpell',
      sourceEntityIds: ['ACT-aasimar-revelation'],
      targeting: {
        minTargets: 0, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
      },
      mechanics: {
        targeting: {
          shape: 'self', domain: 'actor', actor_targets: false, range_ft: 0,
          min_targets: 0, max_targets: 1, requires_line_of_sight: false,
          allowed_relations: ['self'],
        },
        effects: [{
          kind: 'choice', id: 'revelation', count: 1,
          options: { source: 'explicit', items: [{
            id: 'radiance', name: 'Внутренний свет', grants: [{
              kind: 'world_zone', zone_type: 'aasimar_radiance',
              geometry: { shape: 'emanation', size_ft: 10 },
              duration: { type: 'rounds', amount: 10 },
              tactical: {
                anchor: 'source', triggers: ['end_turn'], notice: 'Свет следует за источником.',
                auto_effects: [{ kind: 'damage', dice: 'prof_bonus', type: 'radiant' }],
              },
            }],
          }] },
        }],
      },
    };
    initial.world.actors.caster.capabilities.actionIds = [revelation.id];
    initial.catalogActions = [revelation];
    initial.playerActionIds = [revelation.id];
    const executed = executeCombatAction({
      state: initial, actorId: 'caster', actionId: revelation.id,
      targetIds: ['caster'], choices: { revelation: ['radiance'] }, rng: () => 0,
    });
    expect(Object.values(executed.combatAreas ?? {})).toEqual([
      expect.objectContaining({
        sourceActorId: 'caster', sourceAnchored: true,
        origin: { x: 0, y: 0 }, sourceAnchorRadiusFt: 10,
        hazard: expect.objectContaining({
          resolution: 'automatic',
          effects: [expect.objectContaining({ kind: 'damage', dice: 5, type: 'radiant' })],
        }),
      }),
    ]);
  });
});
