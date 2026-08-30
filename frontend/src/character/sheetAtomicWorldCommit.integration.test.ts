import { describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  createWorld,
  type ActorState,
  type RulesCatalog,
  type RulesetReference,
  type UncommittedRuleEvent,
} from '../rules-core/domain';
import type {
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import {
  commitPreparedSheetAtomicWorld,
  prepareSheetAtomicWorldCommit,
  projectSheetAtomicParticipantWorld,
  type PreparedSheetAtomicWorldCommit,
  type SheetAtomicRuntimeCommandStore,
  type SheetAtomicWorldParticipant,
} from './sheetAtomicWorldCommit';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import { readSheetCanonicalWorld } from './sheetCanonicalWorld';
import { currentRuntimeCommandCharacters } from './sheetRuntimeCommand';
import { sheetCompanionRetryPolicy } from './sheetCompanionInteraction';
import type { ForgeCharacter } from './types';

const COMMAND_ID = '8a5f49a1-408b-4d53-98fd-92d506cc92e4';
const SOURCE_ID = '00000000-0000-4000-8000-000000000004';
const TARGET_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const RULESET = {
  systemId: 'dnd5e-2024',
  releaseId: 'atomic-spell-test',
  contentHash: `sha256:${'a'.repeat(64)}`,
  errataVersion: '2024',
} satisfies RulesetReference;
const EMPTY_CATALOG: RulesCatalog = { getAction: () => undefined };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtime(source = false): RuntimeState {
  const resources: Record<string, number> = source
    ? { action: 1, spell_slot_1: 1 }
    : { action: 1 };
  return {
    hp: { current: 12, max: 12, temp: 0 },
    resources,
    maxResources: { ...resources },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function actor(id: string, source = false): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: runtime(source),
  };
}

function canonical(id: string, value: ActorState): SheetCanonicalRuntime {
  const world = createWorld({ id: `world:${id}`, ruleset: RULESET, actors: [value] });
  return {
    actorId: id,
    world,
    actions: [],
    catalog: EMPTY_CATALOG,
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
}

function character(id: string, value: ActorState): ForgeCharacter {
  return {
    id,
    user_id: 'owner',
    name: value.name,
    system_id: RULESET.systemId,
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 3,
    level: 1,
    max_hp: value.runtime.hp.max,
    current_hp: value.runtime.hp.current,
    speed: 30,
    proficiency_bonus: 2,
    resources: clone(value.runtime.resources),
    max_resources: clone(value.runtime.maxResources),
    inventory_items: [],
    active_effects: [],
    turn_state: {},
    runtime_revision: 0,
    access_mode: 'owner',
    created_at: '',
    updated_at: '',
  };
}

function fixture(): {
  prepared: PreparedSheetAtomicWorldCommit;
  initial: ForgeCharacter[];
} {
  const sourceActor = actor(SOURCE_ID, true);
  const targetActors = TARGET_IDS.map((id) => actor(id));
  const source = {
    character: character(SOURCE_ID, sourceActor),
    canonical: canonical(SOURCE_ID, sourceActor),
  };
  const targets = targetActors.map((value) => ({
    character: character(value.id, value),
    canonical: canonical(value.id, value),
  }));
  const postActors = [clone(sourceActor), ...targetActors.map((value, index) => {
    const next = clone(value);
    next.runtime.activeEffects = [{
      id: `bless:${index + 1}`,
      name: 'Bless',
      source: 'Bless',
      mechanics: { kind: 'modifier', op: 'bonus_die', faces: 4 },
    }];
    return next;
  })];
  postActors[0].runtime.resources.action = 0;
  postActors[0].runtime.resources.spell_slot_1 = 0;
  const acceptedWorld = createWorld({
    id: 'accepted:bless',
    ruleset: RULESET,
    actors: postActors,
  });
  acceptedWorld.revision = 1;
  acceptedWorld.concentrations[SOURCE_ID] = {
    id: 'concentration:bless',
    sourceActorId: SOURCE_ID,
    actionId: 'SPELL-0163',
    startedAtRevision: 1,
    effectLinks: TARGET_IDS.map((id, index) => ({
      actorId: id,
      effectId: `bless:${index + 1}`,
    })),
  };
  const participants: SheetAtomicWorldParticipant[] = [{
    ...source,
    world: acceptedWorld,
  }, ...targets.map((target) => ({
    ...target,
    world: projectSheetAtomicParticipantWorld({
      participant: target,
      acceptedWorld,
      commandId: COMMAND_ID,
    }),
  }))];
  return {
    prepared: prepareSheetAtomicWorldCommit({
      commandId: COMMAND_ID,
      participants,
      events: [{
        ordinal: 0,
        sourceActorId: SOURCE_ID,
        obligationIds: [],
        payload: {
          type: 'EngineEventRecorded',
          actorId: SOURCE_ID,
          targetIds: [...TARGET_IDS],
          event: {
            type: 'effect_applied',
            name: 'Bless',
            sourceAction: 'SPELL-0163',
          },
        },
      } satisfies UncommittedRuleEvent],
    }),
    initial: [source.character, ...targets.map((target) => target.character)],
  };
}

function applyPatch(
  characterValue: ForgeCharacter,
  participant: CharacterRuntimeCommandRequest['participants'][number],
): ForgeCharacter {
  const patch = participant.patch;
  return {
    ...clone(characterValue),
    ...(patch.current_hp === undefined ? {} : { current_hp: patch.current_hp }),
    ...(patch.inventory_items === undefined ? {} : { inventory_items: clone(patch.inventory_items) }),
    ...(patch.resources === undefined ? {} : { resources: clone(patch.resources) }),
    ...(patch.max_resources === undefined ? {} : { max_resources: clone(patch.max_resources) }),
    ...(patch.active_effects === undefined ? {} : { active_effects: clone(patch.active_effects) }),
    ...(patch.turn_state === undefined ? {} : { turn_state: clone(patch.turn_state) }),
    ...(patch.currency === undefined ? {} : { currency: clone(patch.currency) }),
    runtime_revision: participant.expected_runtime_revision + 1,
  };
}

class AtomicMemoryStore implements SheetAtomicRuntimeCommandStore {
  readonly characters = new Map<string, ForgeCharacter>();
  readonly receipts = new Map<string, CharacterRuntimeCommandResponse>();
  readonly requests: CharacterRuntimeCommandRequest[] = [];
  readonly events: CharacterRuntimeCommandRequest['events'] = [];
  calls = 0;
  loseFirstResponse = false;

  constructor(initial: readonly ForgeCharacter[]) {
    for (const value of initial) this.characters.set(value.id, clone(value));
  }

  async commit(request: CharacterRuntimeCommandRequest): Promise<CharacterRuntimeCommandResponse> {
    this.calls += 1;
    this.requests.push(clone(request));
    const replay = this.receipts.get(request.command_id);
    if (replay) return { ...clone(replay), replayed: true };

    // The production endpoint locks and validates every participant before the
    // transaction can publish any staged postimage.
    for (const participant of request.participants) {
      const current = this.characters.get(participant.character_id);
      if (!current || current.runtime_revision !== participant.expected_runtime_revision) {
        throw Object.assign(new Error('stale participant CAS'), { status: 409 });
      }
    }
    const staged = new Map(this.characters);
    for (const participant of request.participants) {
      staged.set(
        participant.character_id,
        applyPatch(staged.get(participant.character_id)!, participant),
      );
    }
    this.characters.clear();
    for (const [id, value] of staged) this.characters.set(id, value);
    this.events.push(...clone(request.events));
    const response: CharacterRuntimeCommandResponse = {
      command_id: request.command_id,
      replayed: false,
      participants: request.participants.map((participant) => ({
        character_id: participant.character_id,
        runtime_revision: participant.expected_runtime_revision + 1,
        character: clone(this.characters.get(participant.character_id)!),
      })),
    };
    this.receipts.set(request.command_id, clone(response));
    if (this.loseFirstResponse) {
      this.loseFirstResponse = false;
      throw new Error('lost response after commit');
    }
    return response;
  }
}

describe('ordinary spell atomic world commit', () => {
  it('builds one sorted source-plus-three-target CAS request', () => {
    const { prepared } = fixture();
    expect(prepared.request.participants.map((row) => row.character_id)).toEqual([
      ...TARGET_IDS,
      SOURCE_ID,
    ]);
    expect(prepared.request.participants).toHaveLength(4);
    expect(prepared.request.participants.find((row) => row.character_id === SOURCE_ID)?.patch.resources)
      .toMatchObject({ action: 0, spell_slot_1: 0 });
    for (const targetId of TARGET_IDS) {
      const targetPatch = prepared.request.participants.find((row) => row.character_id === targetId)?.patch;
      expect(targetPatch?.active_effects)
        .toHaveLength(1);
      const targetWorld = readSheetCanonicalWorld(
        targetPatch?.turn_state,
        targetId,
        RULESET.contentHash,
      );
      expect(Object.keys(targetWorld?.actors ?? {})).toEqual([targetId]);
      expect(targetWorld?.concentrations[SOURCE_ID]).toBeUndefined();
    }
    expect(prepared.request.events.map((event) => event.character_id)).toEqual([
      ...TARGET_IDS,
      SOURCE_ID,
    ]);
    expect(prepared.request.events.every((event) => (
      event.type === 'effect_applied'
      && event.payload.type === 'effect_applied'
      && event.payload.name === 'Bless'
    ))).toBe(true);
  });

  it('accepts different actor-content hashes from the same rules release and receipts their bundle', () => {
    const sourceActor = actor(SOURCE_ID, true);
    const targetActor = actor(TARGET_IDS[0]);
    const sourceCanonical = canonical(SOURCE_ID, sourceActor);
    const targetCanonical = canonical(TARGET_IDS[0], targetActor);
    const targetRuleset = {
      ...RULESET,
      contentHash: `sha256:${'b'.repeat(64)}`,
    };
    targetCanonical.world.ruleset = targetRuleset;
    const acceptedWorld = createWorld({
      id: 'accepted:different-builds',
      ruleset: RULESET,
      actors: [sourceActor, targetActor],
    });
    const prepared = prepareSheetAtomicWorldCommit({
      commandId: COMMAND_ID,
      participants: [{
        character: character(SOURCE_ID, sourceActor),
        canonical: sourceCanonical,
        world: acceptedWorld,
      }, {
        character: character(TARGET_IDS[0], targetActor),
        canonical: targetCanonical,
        world: projectSheetAtomicParticipantWorld({
          participant: {
            character: character(TARGET_IDS[0], targetActor),
            canonical: targetCanonical,
          },
          acceptedWorld,
          commandId: COMMAND_ID,
        }),
      }],
      events: [],
    });

    expect(prepared.request.ruleset_ref).toMatchObject({
      system_id: RULESET.systemId,
      release_id: RULESET.releaseId,
      errata_version: RULESET.errataVersion,
    });
    expect(prepared.request.ruleset_ref.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(prepared.request.ruleset_ref.content_hash).not.toBe(RULESET.contentHash);
    expect(prepared.request.ruleset_ref.content_hash).not.toBe(targetRuleset.contentHash);
    expect(prepared.worldsByCharacterId[SOURCE_ID].ruleset).toEqual(RULESET);
    expect(prepared.worldsByCharacterId[TARGET_IDS[0]].ruleset).toEqual(targetRuleset);
  });

  it('still rejects participants from different release or errata identities', () => {
    const sourceActor = actor(SOURCE_ID, true);
    const targetActor = actor(TARGET_IDS[0]);
    const sourceCanonical = canonical(SOURCE_ID, sourceActor);
    const targetCanonical = canonical(TARGET_IDS[0], targetActor);
    targetCanonical.world.ruleset = {
      ...RULESET,
      releaseId: `${RULESET.releaseId}:other`,
      contentHash: `sha256:${'b'.repeat(64)}`,
    };
    const acceptedWorld = createWorld({
      id: 'accepted:mismatched-release',
      ruleset: RULESET,
      actors: [sourceActor, targetActor],
    });

    expect(() => prepareSheetAtomicWorldCommit({
      commandId: COMMAND_ID,
      participants: [{
        character: character(SOURCE_ID, sourceActor),
        canonical: sourceCanonical,
        world: acceptedWorld,
      }, {
        character: character(TARGET_IDS[0], targetActor),
        canonical: targetCanonical,
        world: projectSheetAtomicParticipantWorld({
          participant: {
            character: character(TARGET_IDS[0], targetActor),
            canonical: targetCanonical,
          },
          acceptedWorld,
          commandId: COMMAND_ID,
        }),
      }],
      events: [],
    })).toThrow('Atomic participants use incompatible rulesets');
  });

  it('fails closed before HTTP when a canonical world uses a non-SHA content identity', () => {
    const sourceActor = actor(SOURCE_ID, true);
    const legacyRuleset = {
      ...RULESET,
      contentHash: 'sheet:dnd5e-2024:2024:fnv1a32:56593dfa',
    };
    const world = createWorld({
      id: 'legacy-sheet-world',
      ruleset: legacyRuleset,
      actors: [sourceActor],
    });
    const sourceCanonical = canonical(SOURCE_ID, sourceActor);
    sourceCanonical.world = world;

    expect(() => prepareSheetAtomicWorldCommit({
      commandId: COMMAND_ID,
      participants: [{
        character: character(SOURCE_ID, sourceActor),
        canonical: sourceCanonical,
        world,
      }],
      events: [],
    })).toThrow(/server-compatible ruleset identity/);
  });

  it('rolls back every target, caster resource, and concentration write when one target CAS is stale', async () => {
    const { prepared, initial } = fixture();
    const store = new AtomicMemoryStore(initial);
    const staleTarget = clone(store.characters.get(TARGET_IDS[1])!);
    staleTarget.runtime_revision = 1;
    store.characters.set(staleTarget.id, staleTarget);
    const before = clone([...store.characters.entries()]);

    await expect(commitPreparedSheetAtomicWorld(store, prepared)).rejects.toMatchObject({ status: 409 });

    expect([...store.characters.entries()]).toEqual(before);
    expect(store.characters.get(SOURCE_ID)?.resources).toMatchObject({ action: 1, spell_slot_1: 1 });
    expect(store.characters.get(SOURCE_ID)?.turn_state).toEqual({});
    for (const targetId of TARGET_IDS) {
      expect(store.characters.get(targetId)?.active_effects).toEqual([]);
    }
  });

  it('replays the exact idempotency key after a lost response without double spending or rebuffing', async () => {
    const { prepared, initial } = fixture();
    const store = new AtomicMemoryStore(initial);
    store.loseFirstResponse = true;
    let lost: unknown;
    try {
      await commitPreparedSheetAtomicWorld(store, prepared);
    } catch (cause) {
      lost = cause;
    }
    expect(sheetCompanionRetryPolicy(lost)).toBe('retain_exact_retry');

    const replay = await commitPreparedSheetAtomicWorld(store, prepared);
    expect(replay.replayed).toBe(true);
    const current = await currentRuntimeCommandCharacters({
      request: prepared.request,
      response: replay,
      loadCurrent: async (id) => clone(store.characters.get(id)!),
    });
    expect(store.calls).toBe(2);
    expect(store.requests[1]).toEqual(store.requests[0]);
    expect(store.requests[1].command_id).toBe(COMMAND_ID);
    expect(store.events).toHaveLength(4);
    expect(store.events.map((event) => event.character_id)).toEqual([
      ...TARGET_IDS,
      SOURCE_ID,
    ]);
    expect(current[SOURCE_ID].runtime_revision).toBe(1);
    expect(current[SOURCE_ID].resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    for (const targetId of TARGET_IDS) {
      expect(current[targetId].active_effects).toHaveLength(1);
      expect(current[targetId].runtime_revision).toBe(1);
    }
  });

  it('uses exactly one runtime-command store invocation', async () => {
    const { prepared } = fixture();
    const response: CharacterRuntimeCommandResponse = {
      command_id: prepared.request.command_id,
      replayed: false,
      participants: [],
    };
    const postRuntimeCommand = vi.fn(async () => response);

    await commitPreparedSheetAtomicWorld({ commit: postRuntimeCommand }, prepared);

    expect(postRuntimeCommand).toHaveBeenCalledOnce();
    expect(postRuntimeCommand).toHaveBeenCalledWith(prepared.request);
  });
});
