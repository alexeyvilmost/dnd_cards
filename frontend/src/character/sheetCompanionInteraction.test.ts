import { describe, expect, it } from 'vitest';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import { createWorld, type GameCommand, type RuleActionDefinition, type RulesCatalog } from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import { getSystemActionDefinition, SYSTEM_ACTION_IDS } from '../rules-core/systemActions';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
} from '../rules-core/familiarRuntime';
import {
  RULES_LAB_FAMILIAR_ACTOR_IDS,
  RULES_LAB_FAMILIAR_SESSION_CONFIG,
  RULES_LAB_PACT_EXECUTION,
} from '../pages/rulesLabFixture';
import generatedFixture from '../pages/rulesLabFixture.generated.json';
import type { ForgeCharacter } from './types';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import { readSheetCanonicalWorld } from './sheetCanonicalWorld';
import { collectSheetCompanionControls, SheetCompanionActionError } from './sheetCompanionActions';
import {
  acceptedSheetCompanionCharacters,
  prepareSheetFamiliarTouchInteraction,
  projectSheetCompanionParticipantWorld,
  SHEET_COMPANION_CONTINUATION_REASON,
  sheetCompanionRetryPolicy,
} from './sheetCompanionInteraction';
import { mergeSheetCombatParticipantWorlds } from './sheetCombatSession';

const COMMAND_ID = 'c8d9b9a8-f1a3-4f11-8b24-b5d2e65d9621';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogWithExplicitTouch(): RulesCatalog {
  const generated = generatedFixture as unknown as {
    roots: { familiarWizard: { actions: RuleActionDefinition[] } };
  };
  const actions = generated.roots.familiarWizard.actions
    .map((action) => {
      const targeting = action.mechanics.targeting as Record<string, unknown> | undefined;
      return targeting?.requires_touch === true
        ? { ...clone(action), targeting: { ...clone(action.targeting!), requiresTouch: true as const } }
        : clone(action);
    });
  const byId = new Map(actions.map((action) => [action.id, action]));
  return { getAction: (id) => byId.get(id), listActions: () => actions };
}

function canonical(actorId: string, world: ReturnType<typeof createWorld>, catalog: RulesCatalog): SheetCanonicalRuntime {
  return {
    actorId, world, catalog, actions: catalog.listActions?.() ?? [], cards: [],
    resourceBindings: {}, actionFor: () => { throw new Error('not used'); },
  };
}

function character(actorId: string, world: ReturnType<typeof createWorld>, revision: number): ForgeCharacter {
  const actor = world.actors[actorId];
  return {
    id: actorId, user_id: 'owner', name: actor.name,
    system_id: world.ruleset.systemId, ruleset_version: '2024', character_type: 'free',
    character_schema_version: 3, level: 1, max_hp: actor.runtime.hp.max,
    current_hp: actor.runtime.hp.current, speed: 30, proficiency_bonus: 2,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {}, currency: { gold: 20 },
    runtime_revision: revision, access_mode: 'owner', created_at: '', updated_at: '',
  } as ForgeCharacter;
}

function fixture() {
  const initial = RULES_LAB_FAMILIAR_SESSION_CONFIG.createWorld();
  const sourceId = RULES_LAB_FAMILIAR_ACTOR_IDS[0];
  const targetId = RULES_LAB_FAMILIAR_ACTOR_IDS[1];
  const findActionId = RULES_LAB_PACT_EXECUTION.familiar.findFamiliarActionId;
  const session = new InMemoryRulesSession(initial, RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog, {
    rng: () => 0.5,
    clock: createLogicalClock(initial.logicalClock),
    nextId: createSequentialIdFactory('atomic-familiar'),
  });
  const summon: GameCommand = {
    schemaVersion: 1, type: 'UseAction', commandId: 'summon',
    expectedRevision: initial.revision, rulesetContentHash: initial.ruleset.contentHash,
    actorId: sourceId, actionId: findActionId, targetIds: [],
    spell: { baseLevel: 1, grantId: RULES_LAB_PACT_EXECUTION.familiar.findFamiliarGrantId, mode: 'ritual' },
    choices: {
      [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
      [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
      [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
    },
  };
  expect(session.dispatch(summon).status).toBe('accepted');
  const summoned = session.getState();
  const familiar = Object.values(summoned.actors).find((actor) => actor.familiarState?.ownerActorId === sourceId)!;
  const source = clone(summoned.actors[sourceId]);
  source.runtime.resources.action = 1;

  const mageArmor = (catalogWithExplicitTouch().listActions?.() ?? [])
    .find((action) => (action.mechanics.targeting as Record<string, unknown> | undefined)?.requires_touch === true
      && action.mechanics.effects instanceof Array
      && (action.mechanics.effects as Record<string, unknown>[]).every((effect) => effect.resolution === 'auto'))!;
  const prepared = source.spellcastingAccess?.preparedSources['CLASS-wizard'];
  if (!prepared) throw new Error('Wizard fixture has no preparation source');
  prepared.preparedActionIds = [mageArmor.id, ...prepared.preparedActionIds.filter((id) => id !== mageArmor.id)]
    .slice(0, prepared.capacity);

  const sourceWorld = createWorld({
    id: 'source-world', ruleset: initial.ruleset, actors: [source, clone(familiar)],
  });
  const target = clone(initial.actors[targetId]);
  target.runtime.equipment = {};
  const targetWorld = createWorld({ id: 'target-world', ruleset: initial.ruleset, actors: [target] });
  const catalog = catalogWithExplicitTouch();
  return {
    sourceId, targetId, mageArmor,
    source: { character: character(sourceId, sourceWorld, 7), canonical: canonical(sourceId, sourceWorld, catalog) },
    target: { character: character(targetId, targetWorld, 11), canonical: canonical(targetId, targetWorld, catalog) },
  };
}

function mergedFixtureWorlds() {
  const value = fixture();
  const merged = mergeSheetCombatParticipantWorlds({
    seeds: [value.source, value.target],
    ruleset: clone(value.source.canonical.world.ruleset),
    worldId: 'projection-world',
    sceneMode: 'exploration',
  });
  return { value, merged };
}

function forfeitedAttack(id: string, actorId: string, totalAttacks: number, revision: number) {
  return {
    id,
    actorId,
    startedAtRevision: revision,
    turnKey: `projection:${actorId}`,
    status: 'forfeited' as const,
    sequence: {
      id,
      actorId,
      totalAttacks,
      attacksRemaining: totalAttacks,
      entries: [],
      usedReplacementKeys: [],
    },
  };
}

describe('fully resolved atomic CharacterV3 familiar interaction', () => {
  it('classifies concentration ownership over source plus every link, including empty links', () => {
    const { value, merged } = mergedFixtureWorlds();
    const after = clone(merged);
    after.concentrations[value.sourceId] = {
      id: 'source-empty',
      sourceActorId: value.sourceId,
      actionId: 'spell:source-empty',
      startedAtRevision: after.revision,
      effectLinks: [],
    };
    after.concentrations[value.targetId] = {
      id: 'foreign-empty',
      sourceActorId: value.targetId,
      actionId: 'spell:foreign-empty',
      startedAtRevision: after.revision,
      effectLinks: [],
    };
    const projected = projectSheetCompanionParticipantWorld({
      participant: value.source,
      mergedBefore: merged,
      mergedAfter: after,
      commandId: COMMAND_ID,
    });
    expect(projected.concentrations[value.sourceId]?.id).toBe('source-empty');
    expect(projected.concentrations[value.targetId]).toBeUndefined();

    const mixed = clone(after);
    mixed.concentrations[value.targetId] = {
      ...mixed.concentrations[value.targetId],
      effectLinks: [
        { actorId: value.targetId, effectId: 'foreign-effect' },
        { actorId: value.sourceId, effectId: 'owned-effect' },
      ],
    };
    expect(() => projectSheetCompanionParticipantWorld({
      participant: value.source,
      mergedBefore: merged,
      mergedAfter: mixed,
      commandId: COMMAND_ID,
    })).toThrow(SHEET_COMPANION_CONTINUATION_REASON);
  });

  it('deletes removed owned records, replaces surviving records, and does not import foreign ledgers', () => {
    const { value, merged } = mergedFixtureWorlds();
    const before = clone(merged);
    const local = value.source.canonical.world;
    const familiar = Object.values(before.actors).find((actor) => (
      actor.familiarState?.ownerActorId === value.sourceId
    ));
    if (!familiar) throw new Error('Expected source familiar');

    const oldConcentration = {
      id: 'concentration:old',
      sourceActorId: value.sourceId,
      actionId: 'spell:touch-concentration',
      startedAtRevision: before.revision,
      effectLinks: [] as Array<{ actorId: string; effectId: string }>,
    };
    before.concentrations[value.sourceId] = clone(oldConcentration);
    local.concentrations[value.sourceId] = clone(oldConcentration);

    const removedObject = {
      id: 'object:removed', name: 'Removed', kind: 'item' as const, size: 'tiny' as const,
      ownerActorId: value.sourceId, itemCardId: 'card:removed',
    };
    const replacedObject = {
      id: 'object:replaced', name: 'Before', kind: 'item' as const, size: 'tiny' as const,
      ownerActorId: value.sourceId, itemCardId: 'card:replaced',
    };
    before.objects[removedObject.id] = clone(removedObject);
    before.objects[replacedObject.id] = clone(replacedObject);
    local.objects[removedObject.id] = clone(removedObject);
    local.objects[replacedObject.id] = clone(replacedObject);

    const attacks = before.actors[value.sourceId].attackProfile!.attacksPerAction;
    const removedAttack = forfeitedAttack(
      'attack:removed', value.sourceId, attacks, before.revision,
    );
    const replacedAttack = forfeitedAttack(
      'attack:replaced', value.sourceId, attacks, before.revision,
    );
    before.attackActions[removedAttack.id] = clone(removedAttack);
    before.attackActions[replacedAttack.id] = clone(replacedAttack);
    local.attackActions[removedAttack.id] = clone(removedAttack);
    local.attackActions[replacedAttack.id] = clone(replacedAttack);

    const grappleSource = getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedGrapple)!;
    const sourcePart = before.actors[value.sourceId].attackProfile!.graspingParts[0];
    const grapple = {
      id: 'grapple:removed',
      grapplerActorId: value.sourceId,
      targetActorId: familiar.id,
      sourcePart,
      escapeDc: 12,
      reachFt: before.actors[value.sourceId].attackProfile!.reachFt,
      sourceEntityIds: [...grappleSource.sourceEntityIds] as [string, ...string[]],
      startedAtRevision: before.revision,
    };
    const grappleEffect = {
      id: `grapple:${grapple.id}`,
      name: 'Grappled',
      mechanics: { kind: 'condition', value: 'grappled', grappleId: grapple.id },
      expiry: 'manual' as const,
      source: grapple.sourceEntityIds[0],
      ownerId: familiar.id,
      sourceId: value.sourceId,
    };
    before.grapples[grapple.id] = clone(grapple);
    before.actors[familiar.id].runtime.activeEffects.push(clone(grappleEffect));
    local.grapples[grapple.id] = clone(grapple);
    local.actors[familiar.id].runtime.activeEffects.push(clone(grappleEffect));

    const after = clone(before);
    after.concentrations[value.sourceId] = {
      ...clone(oldConcentration),
      id: 'concentration:replacement',
      startedAtRevision: before.revision + 1,
    };
    delete after.objects[removedObject.id];
    after.objects[replacedObject.id] = { ...clone(replacedObject), name: 'After' };
    after.objects['object:added'] = {
      id: 'object:added', name: 'Added', kind: 'item', size: 'tiny',
      ownerActorId: value.sourceId, itemCardId: 'card:added',
    };
    delete after.attackActions[removedAttack.id];
    after.attackActions[replacedAttack.id] = {
      ...clone(replacedAttack), startedAtRevision: before.revision + 1,
    };
    delete after.grapples[grapple.id];
    after.actors[familiar.id].runtime.activeEffects = after.actors[familiar.id]
      .runtime.activeEffects.filter((effect) => effect.id !== grappleEffect.id);
    const foreignAttack = forfeitedAttack(
      'attack:foreign',
      value.targetId,
      after.actors[value.targetId].attackProfile!.attacksPerAction,
      after.revision,
    );
    after.attackActions[foreignAttack.id] = foreignAttack;
    local.actors[value.targetId] = clone(before.actors[value.targetId]);
    local.attackActions[foreignAttack.id] = {
      ...clone(foreignAttack),
      startedAtRevision: 777,
    };

    const projected = projectSheetCompanionParticipantWorld({
      participant: value.source,
      mergedBefore: before,
      mergedAfter: after,
      commandId: COMMAND_ID,
    });
    expect(projected.concentrations[value.sourceId]?.id)
      .toBe('concentration:replacement');
    expect(projected.objects[removedObject.id]).toBeUndefined();
    expect(projected.objects[replacedObject.id]?.name).toBe('After');
    expect(projected.objects['object:added']?.name).toBe('Added');
    expect(projected.attackActions[removedAttack.id]).toBeUndefined();
    expect(projected.attackActions[replacedAttack.id]?.startedAtRevision)
      .toBe(before.revision + 1);
    expect(projected.attackActions[foreignAttack.id]?.startedAtRevision).toBe(777);
    expect(projected.grapples[grapple.id]).toBeUndefined();
    expect(projected.actors[familiar.id].runtime.activeEffects)
      .not.toContainEqual(expect.objectContaining({ id: grappleEffect.id }));
  });

  it('delivers an explicit Touch spell, persists both worlds, and produces stable idempotent bytes', () => {
    const f = fixture();
    const touch = collectSheetCompanionControls({ runtime: f.source.canonical })
      .touchSpells.find(({ action }) => action.id === f.mageArmor.id)!;
    const run = () => prepareSheetFamiliarTouchInteraction({
      source: f.source, target: f.target, commandId: COMMAND_ID,
      spellActionId: f.mageArmor.id, castOptionId: touch.castOptions[0].id,
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 5,
        lineOfSight: true, cover: 'none', relation: 'ally', willing: true,
      },
      rng: () => 0.5,
    });
    const prepared = run();
    expect(run().request).toEqual(prepared.request);
    expect(prepared.request.participants.map((row) => [row.character_id, row.expected_runtime_revision]))
      .toEqual([[f.sourceId, 7], [f.targetId, 11]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(prepared.worldsByCharacterId[f.targetId].actors[f.targetId].runtime.activeEffects)
      .toContainEqual(expect.objectContaining({ name: expect.any(String) }));
    const familiar = Object.values(prepared.worldsByCharacterId[f.sourceId].actors)
      .find((actor) => actor.familiarState?.ownerActorId === f.sourceId)!;
    expect(familiar.familiarState?.reactionAvailable).toBe(false);

    for (const participant of prepared.request.participants) {
      const restored = readSheetCanonicalWorld(
        participant.patch.turn_state,
        participant.character_id,
        prepared.worldsByCharacterId[participant.character_id].ruleset.contentHash,
      );
      expect(restored).toEqual(prepared.worldsByCharacterId[participant.character_id]);
    }

    const response = {
      command_id: COMMAND_ID,
      replayed: true,
      participants: prepared.request.participants.map((participant) => ({
        character_id: participant.character_id,
        runtime_revision: participant.expected_runtime_revision + 1,
        character: {
          ...(participant.character_id === f.sourceId ? f.source.character : f.target.character),
          runtime_revision: participant.expected_runtime_revision + 1,
        },
      })),
    };
    expect(Object.keys(acceptedSheetCompanionCharacters(prepared, response)).sort())
      .toEqual([f.sourceId, f.targetId].sort());
  });

  it('fails closed before persistence when a Touch attack opens a continuation', () => {
    const f = fixture();
    const chillId = RULES_LAB_PACT_EXECUTION.familiar.chillTouchActionId;
    const touch = collectSheetCompanionControls({ runtime: f.source.canonical })
      .touchSpells.find(({ action }) => action.id === chillId)!;
    expect(() => prepareSheetFamiliarTouchInteraction({
      source: f.source, target: f.target, commandId: COMMAND_ID,
      spellActionId: chillId, castOptionId: touch.castOptions[0].id,
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 80, lineOfSight: true,
      },
      familiarToTargetFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 5,
        lineOfSight: true, cover: 'none', relation: 'enemy',
      },
      rng: () => 0.5,
    })).toThrow(SHEET_COMPANION_CONTINUATION_REASON);
  });

  it.each([
    ['releaseId', 'other-release'],
    ['contentHash', 'other-content-hash'],
    ['errataVersion', 'other-errata'],
  ] as const)(
    'rejects equal system_id sheets whose canonical rulesets differ by %s',
    (field, value) => {
      const f = fixture();
      const sourceCharacterBefore = clone(f.source.character);
      const sourceWorldBefore = clone(f.source.canonical.world);
      f.target.canonical.world.ruleset = {
        ...f.target.canonical.world.ruleset,
        [field]: value,
      };
      const targetCharacterBefore = clone(f.target.character);
      const targetWorldBefore = clone(f.target.canonical.world);
      const touch = collectSheetCompanionControls({ runtime: f.source.canonical })
        .touchSpells.find(({ action }) => action.id === f.mageArmor.id)!;

      expect(f.source.character.system_id).toBe(f.target.character.system_id);
      expect(() => prepareSheetFamiliarTouchInteraction({
        source: f.source, target: f.target, commandId: COMMAND_ID,
        spellActionId: f.mageArmor.id, castOptionId: touch.castOptions[0].id,
        ownerToFamiliarFacts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 80, lineOfSight: false,
        },
        familiarToTargetFacts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 5,
          lineOfSight: true, cover: 'none', relation: 'ally', willing: true,
        },
        rng: () => 0.5,
      })).toThrow('Characters use incompatible canonical ruleset releases');
      expect(f.source.character).toEqual(sourceCharacterBefore);
      expect(f.source.canonical.world).toEqual(sourceWorldBefore);
      expect(f.target.character).toEqual(targetCharacterBefore);
      expect(f.target.canonical.world).toEqual(targetWorldBefore);
    },
  );

  it('rejects missing and future mismatched canonical ruleset fields', () => {
    const run = (mutate: (ruleset: Record<string, unknown>) => void) => {
      const f = fixture();
      const targetRuleset = clone(f.target.canonical.world.ruleset) as unknown as Record<string, unknown>;
      mutate(targetRuleset);
      f.target.canonical.world.ruleset = targetRuleset as unknown as typeof f.target.canonical.world.ruleset;
      const touch = collectSheetCompanionControls({ runtime: f.source.canonical })
        .touchSpells.find(({ action }) => action.id === f.mageArmor.id)!;
      return () => prepareSheetFamiliarTouchInteraction({
        source: f.source, target: f.target, commandId: COMMAND_ID,
        spellActionId: f.mageArmor.id, castOptionId: touch.castOptions[0].id,
        ownerToFamiliarFacts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 80, lineOfSight: false,
        },
        familiarToTargetFacts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 5,
          lineOfSight: true, cover: 'none', relation: 'ally', willing: true,
        },
        rng: () => 0.5,
      });
    };

    expect(run((ruleset) => { delete ruleset.contentHash; }))
      .toThrow('Familiar Touch requires a complete canonical ruleset reference');
    expect(run((ruleset) => { ruleset.futurePolicy = 'target-only'; }))
      .toThrow('Characters use incompatible canonical ruleset releases');
  });

  it('rejects stale response identity instead of accepting a partial atomic result', () => {
    expect(() => acceptedSheetCompanionCharacters({ request: {
      command_id: COMMAND_ID,
      ruleset_ref: { system_id: 'dnd5e-2024', release_id: 'x', content_hash: 'x', errata_version: 'x' },
      participants: [], events: [],
    }, worldsByCharacterId: {} }, {
      command_id: `${COMMAND_ID}-other`, replayed: false, participants: [],
    })).toThrowError(SheetCompanionActionError);
  });

  it('discards definitive stale-CAS failures but retains byte-identical retry after ambiguous failures', () => {
    const f = fixture();
    const touch = collectSheetCompanionControls({ runtime: f.source.canonical })
      .touchSpells.find(({ action }) => action.id === f.mageArmor.id)!;
    const prepared = prepareSheetFamiliarTouchInteraction({
      source: f.source, target: f.target, commandId: COMMAND_ID,
      spellActionId: f.mageArmor.id, castOptionId: touch.castOptions[0].id,
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: {
        factsSource: 'scenario', boardRevision: 0, distanceFt: 5,
        lineOfSight: true, cover: 'none', relation: 'ally', willing: true,
      },
      rng: () => 0.5,
    });
    const before = clone(prepared);

    expect(sheetCompanionRetryPolicy({ status: 409 })).toBe('discard_and_refresh');
    expect(sheetCompanionRetryPolicy({ response: { status: 400 } })).toBe('discard_and_refresh');
    expect(sheetCompanionRetryPolicy(new Error('lost response'))).toBe('retain_exact_retry');
    expect(sheetCompanionRetryPolicy({ status: 500 })).toBe('retain_exact_retry');
    expect(sheetCompanionRetryPolicy({ status: 408 })).toBe('retain_exact_retry');
    expect(prepared).toEqual(before);
  });
});
