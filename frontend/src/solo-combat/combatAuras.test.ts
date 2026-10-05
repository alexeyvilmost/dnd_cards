import { describe, expect, it, vi } from 'vitest';
import { createWorld, type ActorState } from '../rules-core/domain';
import { effectiveArmorClass } from '../rules-core/actorArmorClass';
import { collectModifiers } from '../engine/modifiers';
import { projectCombatAuras } from './combatAuras';
import {boardLightSources,type BoardLightSource} from './combatIllumination';
import {spatialFacts} from './types';
import { executeCombatAction, moveActor, runCombatAuraLifecycle } from './engine';
import type { SoloCombatState } from './types';

type Dict = Record<string, unknown>;
const passive = (id: string, result: Dict[]): Dict => ({ id, name: id, effects: [{ resolution: 'auto', result }] });
const aura = (id: string, effects: Dict[], options: Dict = {}) => passive(id, [{ kind: 'aura', radius_ft: 5, recipients: 'allies', effects, ...options }]);
function setup(): SoloCombatState {
  const actors = ['source', 'ally', 'enemy'].map((id): ActorState => ({ id, name: id, kind: id === 'enemy' ? 'monster' : 'playerCharacter', controllerId: id, ac: 10,
    capabilities: { actionIds: ['attack'] }, passives: [],
    character: { level: 5, profBonus: 3, baseSpeed: 30, abilityScores: { str: 14, dex: 10, con: 10, int: 10, wis: id === 'source' ? 16 : 8, cha: 10 },
      abilityMods: { str: 2, dex: 0, con: 0, int: 0, wis: id === 'source' ? 3 : -1, cha: 0 } },
    runtime: { hp: { current: 10, max: 40, temp: 0 }, resources: { action: 1, reaction: 1 }, maxResources: { action: 1, reaction: 1 }, equipment: {}, inventory: [], activeEffects: [] },
  }));
  const world = createWorld({ id: 'aura-test', ruleset: { systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: 'test' }, actors });
  world.scene = { mode: 'encounter', round: 1, activeIndex: 0, initiative: ['source', 'ally', 'enemy'], turnStarted: true };
  return { schemaVersion: 1, characterId: 'source', controlledCharacterIds: ['source', 'ally'], world, runtimeRevision: 0,
    tokens: { source: { actorId: 'source', position: { x: 0, y: 0 } }, ally: { actorId: 'ally', position: { x: 1, y: 0 } }, enemy: { actorId: 'enemy', position: { x: 0, y: 1 } } },
    sideByActorId: { source: 'party', ally: 'party', enemy: 'enemy' }, combatAreas: {}, boardRevision: 0,
    opportunityActionIds: {}, movementRemainingFt: { source: 30, ally: 30, enemy: 30 }, log: [], outcome: 'active', actionPresentation: {},
    catalogActions: [{ id: 'attack', name: 'Attack', kind: 'nonSpell', sourceEntityIds: ['attack'], targeting: { rangeFt: 30, minTargets: 1, maxTargets: 1, allowedRelations: ['enemy', 'ally'], requiresLineOfSight: true },
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [{ resolution: 'attack_roll', attack_kind: 'spell_ranged', ability: 'str', on_hit: [{ kind: 'damage', amount: 3, type: 'force' }] }] } }],
    playerActionIds: ['attack'], certifiedPlayerActionIds: [],
  } as unknown as SoloCombatState;
}
const ac = (value: number): Dict => ({ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value });

describe('board-owned item auras', () => {
  it('shares light discovery only within one unchanged projection and retains two-source visibility after changes',()=>{
    const state=setup();
    state.battleMap={id:'dark-test',name:'Dark',description:'Local lighting fixture',background:'',maxFootprint:4,maxActors:12,width:8,height:8,features:[],ambientLight:'dark'};
    state.world.actors.source.passives=[passive('warm-lamp',[{kind:'illumination',bright_radius_ft:5,dim_additional_radius_ft:5}])];
    state.world.actors.ally.passives=[passive('cold-lamp',[{kind:'illumination',bright_radius_ft:0,dim_additional_radius_ft:20}])];
    for(const change of [()=>{},()=>{state.tokens.source.position={x:7,y:7};},()=>{state.world.actors.ally.passives=[];},()=>{state.boardRevision++;state.battleMap!.ambientLight='bright';}]){
      change();const before=structuredClone(state);let sources:BoardLightSource[]|undefined;let collections=0;
      const query=()=>{if(!sources){collections++;sources=boardLightSources(state);}return sources;};
      for(const from of ['source','ally','enemy'])for(const to of ['source','ally','enemy']){
        expect(spatialFacts(state,from,to,true,query)).toEqual(spatialFacts(state,from,to,true));
      }
      expect(collections).toBe(1);expect(state).toEqual(before);
      const projected=projectCombatAuras(state);
      for(const actor of Object.values(projected.world.actors))for(const observed of actor.character.spatialObservations!.nearby){
        const canonical=spatialFacts(state,actor.id,observed.actorId,false);
        expect(observed.canSeeTarget).toBe(canonical.canSeeTarget);expect(observed.targetCanSeeSource).toBe(canonical.targetCanSeeSource);
      }
    }
  });
  it('projects two different recipient filters and strips old generations after reload, movement and revocation', () => {
    const state = setup();
    state.world.actors.source.passives = [aura('shelter', [ac(2)], { recipients: 'others' })];
    state.world.actors.ally.passives = [aura('hostile', [ac(-1)], { recipients: 'enemies', radius_ft: 10 })];
    const projected = projectCombatAuras(state);
    expect(effectiveArmorClass(projected.world.actors.source)).toBe(10);
    expect(effectiveArmorClass(projected.world.actors.ally)).toBe(12);
    expect(effectiveArmorClass(projected.world.actors.enemy)).toBe(11);
    expect(projectCombatAuras(JSON.parse(JSON.stringify(projected)))).toEqual(projected);
    const moved = moveActor({ state: projected, actorId: 'source', destination: { x: 4, y: 0 }, voluntary: false, maxFeet: 30, rng: () => 0.5 });
    expect(effectiveArmorClass(moved.world.actors.ally)).toBe(10);
    expect(effectiveArmorClass(moved.world.actors.enemy)).toBe(9);
    moved.world.actors.ally.passives = [];
    expect(effectiveArmorClass(projectCombatAuras(moved).world.actors.enemy)).toBe(10);
  });

  it('uses projected target КД for the actual attack and preserves the historical roll target', () => {
    const state = setup();
    state.world.actors.ally.passives = [aura('shelter', [ac(3)], { recipients: 'others', radius_ft: 10 })];
    const result = executeCombatAction({ state, actorId: 'source', actionId: 'attack', targetIds: ['enemy'], rng: () => 0.35 });
    // Natural 8 + STR2 + PB3 = 13; spell attack proficiency is canonical.
    expect(result.log.flatMap(row => row.records ?? []).some(record => record.event?.type === 'roll' && record.event.roll.target?.value === 13)).toBe(true);
  });

  it('gates distinct modifiers by current nearby-enemy counts and reverses ability grants', () => {
    const state = setup(), actor = state.world.actors.source;
    actor.passives = [passive('surrounded', [{ kind: 'grant_ability_score', ability: 'str', amount: 2,
      when: [{ kind: 'nearby_enemies', min: 1, range_ft: 5 }] }, { kind: 'modifier', op: 'add', value: 1, applies_to: { roll: 'spell_dc' },
      when: [{ kind: 'nearby_enemies', min: 1, range_ft: 5 }] }])];
    let projected = projectCombatAuras(state), current = projected.world.actors.source;
    expect(current.character.abilityScores?.str).toBe(16);
    expect(current.character.abilityMods.str).toBe(3);
    expect(collectModifiers(current.runtime, current.passives ?? [], { roll: 'spell_dc', evalCtx: { state: current.runtime, character: current.character } }).modifiers).toHaveLength(1);
    projected.tokens.enemy.position = { x: 5, y: 5 };
    projected = projectCombatAuras(JSON.parse(JSON.stringify(projected))); current = projected.world.actors.source;
    expect(current.character.abilityScores?.str).toBe(14); expect(current.character.abilityMods.str).toBe(2);
    expect(collectModifiers(current.runtime, current.passives ?? [], { roll: 'spell_dc', evalCtx: { state: current.runtime, character: current.character } }).modifiers).toHaveLength(0);
  });

  it('executes source-owned healing on the source boundary with durable per-target receipts', () => {
    const state = setup();
    state.world.actors.source.passives = [aura('restoring', [{ kind: 'healing', amount: '1d4 + wis' }], { events: ['turn_end'] }),
      passive('outgoing', [{ kind: 'modifier', op: 'multiply', value: 2, applies_to: { roll: 'healing' } }])];
    state.world.actors.ally.passives = [passive('not-source', [{ kind: 'modifier', op: 'multiply', value: 3, applies_to: { roll: 'healing' } }])];
    const rng = vi.fn(() => 0.5), healed = runCombatAuraLifecycle(state, 'turn_end', 'source', rng);
    expect(healed.world.actors.ally.runtime.hp.current).toBe(22); // (d4=3 + source WIS3)×2
    expect(healed.world.actors.source.runtime.hp.current).toBe(10);
    expect(runCombatAuraLifecycle(JSON.parse(JSON.stringify(healed)), 'turn_end', 'source', rng)).toEqual(healed);
    expect(rng).toHaveBeenCalledTimes(1);
  });

  it('executes an independent hostile damage aura with the owner ability and recipient resistance', () => {
    const state = setup();
    state.world.actors.source.passives = [aura('fire', [{ kind: 'damage', amount: '1d4 + wis', type: 'fire' }], { recipients: 'enemies', events: ['turn_start'] })];
    state.world.actors.enemy.passives = [passive('resist', [{ kind: 'resistance', damage_type: 'fire', value: 'resistance' }])];
    const result = runCombatAuraLifecycle(state, 'turn_start', 'source', () => 0.5);
    expect(result.world.actors.enemy.runtime.hp.current).toBe(7);
    expect(result.world.actors.ally.runtime.hp.current).toBe(10);
    expect(result.world.actors.source.runtime.hp.current).toBe(10);
  });
});
