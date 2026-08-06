import { describe, expect, it } from 'vitest';
import { canonicalStringify, createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import type {
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  WorldState,
} from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
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
import type {
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import { runtimeInventoryPayload } from './runtime';
import {
  buildDismissFamiliarCommand,
  collectSheetCompanionControls,
} from './sheetCompanionActions';
import {
  acceptedSheetCompanionCharacters,
  prepareSheetCompanionCommand,
} from './sheetCompanionInteraction';
import { readSheetCanonicalWorld, type SheetCanonicalRuntime } from './sheetCanonicalWorld';
import { currentRuntimeCommandCharacters } from './sheetRuntimeCommand';
import type { ForgeCharacter } from './types';

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function remapPrimaryActor(worldValue: WorldState, from: string, to: string): WorldState {
  const world = clone(worldValue);
  const actor = world.actors[from];
  if (!actor) throw new Error(`Missing actor ${from}`);
  delete world.actors[from];
  actor.id = to;
  world.actors[to] = actor;
  for (const candidate of Object.values(world.actors)) {
    if (candidate.familiarState?.ownerActorId === from) {
      candidate.familiarState.ownerActorId = to;
    }
    if (candidate.familiarMetadata?.ownerActorId === from) {
      candidate.familiarMetadata.ownerActorId = to;
    }
  }
  for (const object of Object.values(world.objects)) {
    if (object.ownerActorId === from) object.ownerActorId = to;
    if (object.carriedByActorId === from) object.carriedByActorId = to;
    if (object.sourceActorId === from) object.sourceActorId = to;
    if (object.heldByActorId === from) object.heldByActorId = to;
    if (object.attunedToActorId === from) object.attunedToActorId = to;
  }
  return world;
}

function summonedFixture() {
  const initial = RULES_LAB_FAMILIAR_SESSION_CONFIG.createWorld();
  const sourceId = RULES_LAB_FAMILIAR_ACTOR_IDS[0];
  const actionId = RULES_LAB_PACT_EXECUTION.familiar.findFamiliarActionId;
  const session = new InMemoryRulesSession(initial, RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog, {
    rng: () => 0.5,
    clock: createLogicalClock(initial.logicalClock),
    nextId: createSequentialIdFactory('single-companion-cas'),
  });
  const summon: GameCommand = {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: 'fixture:summon',
    expectedRevision: initial.revision,
    rulesetContentHash: initial.ruleset.contentHash,
    actorId: sourceId,
    actionId,
    targetIds: [],
    spell: {
      baseLevel: 1,
      grantId: RULES_LAB_PACT_EXECUTION.familiar.findFamiliarGrantId,
      mode: 'ritual',
    },
    choices: {
      [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
      [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
      [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
    },
  };
  expect(session.dispatch(summon).status).toBe('accepted');
  const world = remapPrimaryActor(session.getState(), sourceId, CHARACTER_ID);
  world.actors[CHARACTER_ID].runtime.resources.action = 1;
  world.actors[CHARACTER_ID].runtime.maxResources.action = 1;
  const catalog: RulesCatalog = RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog;
  const canonical: SheetCanonicalRuntime = {
    actorId: CHARACTER_ID,
    world,
    catalog,
    actions: catalog.listActions?.() ?? [],
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const actor = world.actors[CHARACTER_ID];
  const character: ForgeCharacter = {
    id: CHARACTER_ID,
    user_id: 'owner',
    name: actor.name,
    system_id: world.ruleset.systemId,
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    max_hp: actor.runtime.hp.max,
    current_hp: actor.runtime.hp.current,
    speed: 30,
    proficiency_bonus: 2,
    inventory_items: runtimeInventoryPayload(actor.runtime),
    resources: clone(actor.runtime.resources),
    max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects),
    turn_state: {},
    currency: { gold: 20, silver: 0, copper: 0 },
    runtime_revision: 4,
    access_mode: 'owner',
    created_at: '',
    updated_at: '',
  };
  const command = buildDismissFamiliarCommand({
    runtime: canonical,
    commandId: COMMAND_ID,
    mode: 'temporary',
  });
  const prepared = prepareSheetCompanionCommand({
    participant: { character, canonical },
    command,
    rng: () => 0.5,
  });
  return { character, canonical, prepared };
}

class AtomicMemoryStore {
  private current: ForgeCharacter;

  private readonly ledger = new Map<string, {
    request: string;
    response: CharacterRuntimeCommandResponse;
  }>();

  commits = 0;

  committedEvents = 0;

  loseNextResponse = false;

  constructor(character: ForgeCharacter) {
    this.current = clone(character);
  }

  get = async (id: string): Promise<ForgeCharacter> => {
    if (id !== this.current.id) throw new Error(`Unknown ${id}`);
    return clone(this.current);
  };

  advanceAfterOriginalCommit(): void {
    this.current = {
      ...this.current,
      current_hp: this.current.current_hp - 1,
      runtime_revision: Number(this.current.runtime_revision) + 1,
    };
  }

  async commit(request: CharacterRuntimeCommandRequest): Promise<CharacterRuntimeCommandResponse> {
    const bytes = canonicalStringify(request);
    const receipt = this.ledger.get(request.command_id);
    if (receipt) {
      if (receipt.request !== bytes) throw new Error('command_id_reuse');
      return { ...clone(receipt.response), replayed: true };
    }
    const participant = request.participants[0];
    if (request.participants.length !== 1
      || participant.character_id !== this.current.id
      || participant.expected_runtime_revision !== this.current.runtime_revision) {
      throw new Error('runtime_revision_conflict');
    }
    const patch = participant.patch;
    this.current = {
      ...this.current,
      ...(patch.current_hp === undefined ? {} : { current_hp: patch.current_hp }),
      ...(patch.inventory_items === undefined ? {} : {
        inventory_items: clone(patch.inventory_items),
      }),
      ...(patch.resources === undefined ? {} : { resources: clone(patch.resources) }),
      ...(patch.max_resources === undefined ? {} : {
        max_resources: clone(patch.max_resources),
      }),
      ...(patch.active_effects === undefined ? {} : {
        active_effects: clone(patch.active_effects),
      }),
      ...(patch.currency === undefined ? {} : { currency: clone(patch.currency) }),
      ...(patch.turn_state === undefined ? {} : {
        turn_state: { ...(this.current.turn_state ?? {}), ...clone(patch.turn_state) },
      }),
      runtime_revision: participant.expected_runtime_revision + 1,
    };
    this.commits += 1;
    this.committedEvents += request.events.length;
    const response: CharacterRuntimeCommandResponse = {
      command_id: request.command_id,
      replayed: false,
      participants: [{
        character_id: this.current.id,
        runtime_revision: this.current.runtime_revision!,
        character: clone(this.current),
      }],
    };
    this.ledger.set(request.command_id, { request: bytes, response: clone(response) });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new Error('response_lost_after_commit');
    }
    return response;
  }
}

describe('one-sheet companion atomic runtime transport', () => {
  it('projects a rules-core item-cost postimage into the atomic inventory snapshot', () => {
    const fixture = summonedFixture();
    const itemId = '22222222-2222-4222-8222-222222222222';
    const action: RuleActionDefinition = {
      id: 'test:consume-companion-item',
      name: 'Consume declared item',
      kind: 'nonSpell',
      sourceEntityIds: ['test:consume-companion-item'],
      targeting: {
        minTargets: 0,
        maxTargets: 0,
        rangeFt: 0,
        requiresLineOfSight: false,
        allowedRelations: [],
      },
      mechanics: {
        activation: {
          mode: 'active',
          cost: [{ resource: 'item', card_id: itemId, amount: 1 }],
        },
        effects: [],
      },
    };
    fixture.canonical.world.actors[CHARACTER_ID].runtime.inventory = [{ cardId: itemId, qty: 2 }];
    fixture.canonical.world.actors[CHARACTER_ID].capabilities.actionIds.push(action.id);
    fixture.character.inventory_items = [{ card_id: itemId, qty: 2 }];
    const actions = [...fixture.canonical.actions, action];
    const baseCatalog = fixture.canonical.catalog;
    fixture.canonical.actions = actions;
    fixture.canonical.catalog = {
      getAction: (id) => id === action.id ? action : baseCatalog.getAction(id),
      listActions: () => actions,
    };
    const prepared = prepareSheetCompanionCommand({
      participant: { character: fixture.character, canonical: fixture.canonical },
      command: {
        schemaVersion: 1,
        type: 'UseAction',
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        expectedRevision: fixture.canonical.world.revision,
        rulesetContentHash: fixture.canonical.world.ruleset.contentHash,
        actorId: CHARACTER_ID,
        actionId: action.id,
        targetIds: [],
      },
      rng: () => 0.5,
    });
    expect(prepared.request.participants[0].patch.inventory_items)
      .toEqual([{ card_id: itemId, qty: 1 }]);
    expect(fixture.character.inventory_items).toEqual([{ card_id: itemId, qty: 2 }]);
  });

  it('fails closed if encounter authority links the sheet after command preparation', () => {
    const fixture = summonedFixture();
    const linked = {
      ...fixture.character,
      current_encounter_id: 'encounter:linked-after-build',
    };
    const before = clone(fixture.canonical.world);
    expect(() => prepareSheetCompanionCommand({
      participant: { character: linked, canonical: fixture.canonical },
      command: buildDismissFamiliarCommand({
        runtime: fixture.canonical,
        commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        mode: 'temporary',
      }),
      rng: () => 0.5,
    })).toThrow('серверная encounter authority');
    expect(fixture.canonical.world).toEqual(before);
    expect(fixture.canonical.world.actors[CHARACTER_ID].runtime.resources.action).toBe(1);
  });

  it('rejects stale CAS without changing the newer server snapshot', async () => {
    const fixture = summonedFixture();
    const newer = { ...fixture.character, runtime_revision: 5 };
    const store = new AtomicMemoryStore(newer);
    await expect(store.commit(fixture.prepared.request))
      .rejects.toThrow('runtime_revision_conflict');
    expect(await store.get(CHARACTER_ID)).toEqual(newer);
    expect(store.commits).toBe(0);
  });

  it('retries exact lost-response bytes without paying or writing events twice, then reloads world', async () => {
    const fixture = summonedFixture();
    const store = new AtomicMemoryStore(fixture.character);
    const requestBefore = clone(fixture.prepared.request);
    store.loseNextResponse = true;
    await expect(store.commit(fixture.prepared.request)).rejects.toThrow('response_lost');
    expect(store.commits).toBe(1);

    const replay = await store.commit(fixture.prepared.request);
    expect(replay.replayed).toBe(true);
    expect(fixture.prepared.request).toEqual(requestBefore);
    expect(store.commits).toBe(1);
    expect(fixture.prepared.request.events.length).toBeGreaterThan(0);
    expect(store.committedEvents).toBe(fixture.prepared.request.events.length);
    const accepted = acceptedSheetCompanionCharacters(fixture.prepared, replay);
    expect(accepted[CHARACTER_ID].resources?.action).toBe(0);

    const latest = await currentRuntimeCommandCharacters({
      request: fixture.prepared.request,
      response: replay,
      loadCurrent: store.get,
    });
    const restored = readSheetCanonicalWorld(
      latest[CHARACTER_ID].turn_state,
      CHARACTER_ID,
      fixture.canonical.world.ruleset.contentHash,
    );
    const familiar = collectSheetCompanionControls({
      runtime: { ...fixture.canonical, world: restored! },
    }).familiar;
    expect(familiar?.presence).toBe('pocket_dimension');
    expect(latest[CHARACTER_ID].runtime_revision).toBe(5);
  });

  it('uses the latest refetch after original commit, subsequent update, and receipt replay', async () => {
    const fixture = summonedFixture();
    const store = new AtomicMemoryStore(fixture.character);
    store.loseNextResponse = true;
    await expect(store.commit(fixture.prepared.request)).rejects.toThrow('response_lost');
    store.advanceAfterOriginalCommit();

    const replay = await store.commit(fixture.prepared.request);
    expect(replay.participants[0].runtime_revision).toBe(5);
    expect(replay.participants[0].character.current_hp).toBe(fixture.character.current_hp);
    const latest = await currentRuntimeCommandCharacters({
      request: fixture.prepared.request,
      response: replay,
      loadCurrent: store.get,
    });
    expect(latest[CHARACTER_ID].runtime_revision).toBe(6);
    expect(latest[CHARACTER_ID].current_hp).toBe(fixture.character.current_hp - 1);
    expect(latest[CHARACTER_ID].resources?.action).toBe(0);
    expect(store.commits).toBe(1);
  });
});
