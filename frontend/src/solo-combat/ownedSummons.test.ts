import { describe, expect, it } from 'vitest';
import type { ActorState, RuleActionDefinition, RulesetReference } from '../rules-core/domain';
import { isPlayerControlledCombatActor, type SoloCombatState } from './types';
import { materializeOwnedSummon, ownedSummonPolicy, reconcileOwnedSummons } from './ownedSummons';
import { executeCombatAction, setSoloCombatMount } from './engine';
import { validateMechanics } from '../engine/validateMechanics';
import { immediateSoloCombatTargetIds } from './actionChoices';
import { migrateWorldState } from '../rules-core/worldMigration';

const RULESET: RulesetReference = {
  systemId: 'dnd5e-2024', releaseId: 'summon-test', contentHash: 'summon-hash', errataVersion: '2024',
};

function actor(id: string, kind: ActorState['kind'] = 'playerCharacter'): ActorState {
  return {
    id, name: id, kind, controllerId: kind === 'monster' ? 'ai' : 'user', ac: 10,
    capabilities: { actionIds: [] },
    character: {
      creatureType: kind === 'monster' ? 'humanoid' : 'human',
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 3, level: 5, characterSpeed: 30, baseSpeed: 30,
      saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: { action: 1 }, maxResources: { action: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
    lifecycle: { status: 'alive' },
    attackProfile: {
      attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: [], sourceEntityIds: ['fixture'],
    },
  };
}

function summonAction(duration: unknown = 'concentration'): RuleActionDefinition {
  return {
    id: 'spell:summon-beast', name: 'Вызов зверя', kind: 'spell', spell: { level: 2 },
    sourceEntityIds: ['SPELL-0178'],
    concentration: true,
    targeting: { minTargets: 0, maxTargets: 0, rangeFt: 90, requiresLineOfSight: true, allowedRelations: [] },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }, { resource: 'spell_slot_2', amount: 1 }] },
      targeting: { domain: 'world', actor_targets: false, shape: 'single', min_targets: 0, max_targets: 0, range_ft: 90, requires_line_of_sight: true, allowed_relations: [] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Призыв духа.' }] }],
      primitive: {
        type: 'owned_summon', summon_key: 'bestial_spirit', name: 'Дух зверя',
        creature_type: 'beast', size: 1, speed_ft: 40,
        armor_class: { base: 11, per_spell_level: 1 },
        hit_points: { base: 20, per_spell_level: 5, scale_from_level: 2 },
        duration, initiative: 'immediately_after_owner', replace_existing: true,
      },
    },
  };
}

function state(action = summonAction()): SoloCombatState {
  const owner = actor('owner');
  owner.capabilities = { actionIds: [action.id], featureSources: { [action.id]: ['SPELL-0178'] } };
  owner.runtime.resources.spell_slot_2 = 1;
  owner.runtime.maxResources.spell_slot_2 = 1;
  owner.spellcastingAccess = {
    grants: [{
      grantId: 'owner:summon-grant', actionId: action.id, sourceId: 'owner:class',
      access: 'always_prepared', level: 2, spellcastingAbility: 'wis', slotResource: 'spell_slot_2',
    }],
    preparedSources: {},
  };
  const enemy = actor('enemy', 'monster');
  return {
    schemaVersion: 1, characterId: owner.id, runtimeRevision: 0,
    world: {
      schemaVersion: 5, id: 'world', ruleset: RULESET, revision: 3, logicalClock: 3,
      actors: { owner, enemy }, objects: {}, processedCommandIds: [], pendingResolution: null,
      concentrations: {
        owner: { id: 'concentration', sourceActorId: owner.id, actionId: action.id, startedAtRevision: 3, effectLinks: [] },
      },
      attackActions: {}, grapples: {},
      scene: { mode: 'encounter', initiative: ['owner', 'enemy'], activeIndex: 0, round: 2, turnStarted: true },
    },
    catalogActions: [action], actionPresentation: {}, sideByActorId: { owner: 'party', enemy: 'enemy' },
    actorPresentation: { owner: { actionIds: [], traits: [] }, enemy: { actionIds: [], traits: [] } },
    controlledCharacterIds: ['owner'], playerActionIdsByActor: { owner: [] }, playerActionIds: [],
    certifiedPlayerActionIdsByActor: { owner: [] }, certifiedPlayerActionIds: [],
    monsterActionIds: { enemy: [] }, opportunityActionIds: {}, resourceBindingsByActor: { owner: {} },
    resourceBindings: {}, tokens: {
      owner: { actorId: 'owner', color: 'blue', position: { x: 2, y: 8 } },
      enemy: { actorId: 'enemy', color: 'red', position: { x: 2, y: 1 } },
    },
    boardRevision: 1, movementRemainingFt: { owner: 30, enemy: 30 },
    initiativeBonuses: { owner: 2, enemy: 1 },
    initiative: [
      { actorId: 'owner', die: 16, bonus: 2, total: 18 },
      { actorId: 'enemy', die: 10, bonus: 1, total: 11 },
    ],
    log: [], outcome: 'active',
  };
}

describe('data-owned summon lifecycle', () => {
  it('fails closed for malformed policies', () => {
    expect(immediateSoloCombatTargetIds(summonAction(), 'owner')).toBeNull();
    expect(validateMechanics(summonAction().mechanics, {
      id: 'summon-beast', name: 'Summon Beast', kind: 'spell',
    })).toEqual({ valid: true, errors: [] });
    const malformed = summonAction();
    delete (malformed.mechanics.primitive as Record<string, unknown>).replace_existing;
    expect(() => ownedSummonPolicy(malformed)).toThrow(/malformed/);
    (malformed.mechanics.primitive as Record<string, unknown>).replace_existing = true;
    (malformed.mechanics.primitive as Record<string, unknown>).speed_ft = 0;
    expect(() => ownedSummonPolicy(malformed)).toThrow(/malformed/);
  });

  it('creates one owned board actor immediately after its owner and replaces it on recast', () => {
    const action = summonAction();
    const first = materializeOwnedSummon({
      state: state(action), action, ownerActorId: 'owner', castLevel: 3, position: { x: 3, y: 8 },
    });
    const summonId = 'owner:summon:bestial_spirit';
    expect(first.world.scene.mode === 'encounter' && first.world.scene.initiative)
      .toEqual(['owner', summonId, 'enemy']);
    expect(first.world.actors[summonId]).toMatchObject({
      kind: 'summonedActor', controllerId: 'user', ac: 14,
      runtime: { hp: { current: 25, max: 25 } },
      ownedSummon: { ownerActorId: 'owner', sourceActionId: action.id, duration: { type: 'concentration' } },
    });
    expect(first.sideByActorId[summonId]).toBe('party');
    expect(isPlayerControlledCombatActor(first, summonId)).toBe(true);

    first.world.actors[summonId].runtime.hp.current = 2;
    const second = materializeOwnedSummon({
      state: first, action, ownerActorId: 'owner', castLevel: 4, position: { x: 4, y: 8 },
    });
    expect(Object.values(second.world.actors).filter((row) => row.ownedSummon).map((row) => row.id))
      .toEqual([summonId]);
    expect(second.world.actors[summonId].runtime.hp.current).toBe(30);
    expect(second.tokens[summonId].position).toEqual({ x: 4, y: 8 });
  });

  it('hooks the primitive into a real solo-combat cast after cost and concentration commit', () => {
    const action = summonAction();
    const result = executeCombatAction({
      state: state(action), actorId: 'owner', actionId: action.id, targetIds: [],
      worldPosition: { x: 3, y: 8 }, rng: () => 0.5,
    });
    const summonId = 'owner:summon:bestial_spirit';
    expect(result.world.actors.owner.runtime.resources).toMatchObject({ action: 0, spell_slot_2: 0 });
    expect(result.world.concentrations.owner?.actionId).toBe(action.id);
    expect(result.world.actors[summonId]?.ownedSummon?.duration).toEqual({ type: 'concentration' });
    expect(result.world.scene.mode === 'encounter' && result.world.scene.initiative)
      .toEqual(['owner', summonId, 'enemy']);
  });

  it('rejects an occupied placement without mutating the input payment state', () => {
    const action = summonAction();
    const initial = state(action);
    expect(() => executeCombatAction({
      state: initial, actorId: 'owner', actionId: action.id, targetIds: [],
      worldPosition: { ...initial.tokens.enemy.position }, rng: () => 0.5,
    })).toThrow(/свободная клетка/);
    expect(initial.world.actors.owner.runtime.resources).toMatchObject({ action: 1, spell_slot_2: 1 });
    expect(Object.values(initial.world.actors).some((row) => row.ownedSummon)).toBe(false);
  });

  it('rejects tampered persisted ownership before it can confer player control', () => {
    const action = summonAction();
    const cast = materializeOwnedSummon({
      state: state(action), action, ownerActorId: 'owner', castLevel: 2, position: { x: 3, y: 8 },
    });
    expect(migrateWorldState(cast.world).actors['owner:summon:bestial_spirit'].ownedSummon)
      .toMatchObject({ ownerActorId: 'owner', sourceActionId: action.id });
    cast.world.actors['owner:summon:bestial_spirit'].ownedSummon!.ownerActorId = 'enemy';
    expect(() => migrateWorldState(cast.world)).toThrow(/same controller|deterministic actor id/);
  });

  it('allows the exact owner to ride its Faithful Steed without granting Mounted Combatant', () => {
    const action = summonAction('until_destroyed');
    const primitive = action.mechanics.primitive as Record<string, unknown>;
    primitive.summon_key = 'otherworldly_steed';
    primitive.name = 'Потусторонний скакун';
    primitive.size = 3;
    const initial = state(action);
    const steed = materializeOwnedSummon({
      state: initial, action, ownerActorId: 'owner', castLevel: 2, position: { x: 3, y: 8 },
    });
    const mounted = setSoloCombatMount(steed, 'owner', 'owner:summon:otherworldly_steed');
    expect(mounted.mountByRiderId).toEqual({ owner: 'owner:summon:otherworldly_steed' });
    expect(mounted.log.at(-1)?.text).not.toContain('Удар всадника');

    const spoof = state(action);
    spoof.world.actors.enemy.attackProfile!.size = 3;
    spoof.sideByActorId.enemy = 'party';
    spoof.tokens.enemy.position = { x: 3, y: 8 };
    expect(() => setSoloCombatMount(spoof, 'owner', 'enemy')).toThrow(/только собственного/);
  });

  it('cleans up on concentration loss, zero HP, owner death and declared duration', () => {
    const action = summonAction();
    const cast = () => materializeOwnedSummon({
      state: state(action), action, ownerActorId: 'owner', castLevel: 2,
      position: { x: 3, y: 8 },
    });
    const summonId = 'owner:summon:bestial_spirit';

    const noConcentration = cast(); delete noConcentration.world.concentrations.owner;
    expect(reconcileOwnedSummons(noConcentration).world.actors[summonId]).toBeUndefined();

    const zero = cast(); zero.world.actors[summonId].runtime.hp.current = 0;
    zero.world.grapples.stale = {
      id: 'stale', grapplerActorId: 'enemy', targetActorId: summonId,
      sourcePart: 'hand', escapeDc: 10, reachFt: 5, startedAtRevision: 3,
      sourceEntityIds: ['fixture'],
    };
    zero.combatAreas = {
      stale: {
        id: 'stale', name: 'Summon zone', zoneType: 'test', sourceActorId: summonId,
        sourceActionId: action.id, sourceEntityIds: ['fixture'], origin: { x: 3, y: 8 },
        cells: [{ x: 3, y: 8 }], duration: { type: 'permanent' }, triggers: ['end_turn'],
      },
    };
    zero.pendingCombatAreaTriggers = [
      { areaId: 'stale', actorId: summonId, event: 'end_turn', turnKey: '2:0:owner' },
    ];
    const cleanedZero = reconcileOwnedSummons(zero);
    expect(cleanedZero.tokens[summonId]).toBeUndefined();
    expect(cleanedZero.world.grapples).toEqual({});
    expect(cleanedZero.combatAreas).toEqual({});
    expect(cleanedZero.pendingCombatAreaTriggers).toEqual([]);

    const deadOwner = cast();
    deadOwner.world.actors.owner.lifecycle = {
      status: 'dead',
      adjudication: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle', factId: 'death',
        actorId: 'owner', adjudicatedBy: 'gm', observedAtWorldRevision: 3,
        rulesetContentHash: RULESET.contentHash,
      },
    };
    expect(reconcileOwnedSummons(deadOwner).world.actors[summonId]).toBeUndefined();

    const timedAction = summonAction({ rounds: 2 });
    const timed = materializeOwnedSummon({
      state: state(timedAction), action: timedAction, ownerActorId: 'owner', castLevel: 2,
      position: { x: 3, y: 8 },
    });
    if (timed.world.scene.mode !== 'encounter') throw new Error('fixture');
    timed.world.scene.round = 5;
    expect(reconcileOwnedSummons(timed).world.actors[summonId]).toBeUndefined();
  });
});
