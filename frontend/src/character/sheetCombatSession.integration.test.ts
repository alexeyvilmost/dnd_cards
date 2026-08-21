import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type RulesetReference,
} from '../rules-core/domain';
import { canonicalStringify } from '../rules-core/determinism';
import type {
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import { buildSheetCombatDeclaration } from './sheetCombatDeclaration';
import { loadCertifiedSheetCombatCatalog } from './sheetCombatCertifiedCatalog';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import {
  acceptedSheetCombatCharacters,
  advanceSheetCombatTurn,
  assertCertifiedSheetCombatSession,
  clearSheetCombatSession,
  commitPreparedSheetCombat,
  createSheetCombatSession,
  executeSheetCombatAction,
  hasSheetCombatSession,
  prepareSheetCombatCommit,
  readSheetCombatSession,
  resolveSheetCombatDecision,
  SHEET_COMBAT_SESSION_KEY,
  writeSheetCombatSession,
  type PreparedSheetCombatCommit,
  type SheetCombatParticipantSeed,
  type SheetRuntimeCommandStore,
} from './sheetCombatSession';
import type { ForgeCharacter } from './types';
import {
  createSheetSceneTargetActor,
  TRAINING_DUMMY,
  TRAINING_DUMMY_TARGET_ID,
} from './sheetSceneTargets';

const fixture = compiledFixtureJson as unknown as {
  source: { ruleset: RulesetReference };
  roots: {
    wizard: { actor: ActorState; actions: RuleActionDefinition[] };
    fighter: { actor: ActorState; actions: RuleActionDefinition[] };
  };
};

const IDS = {
  source: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primitive(action: RuleActionDefinition): string | undefined {
  return String(object(action.mechanics.primitive)?.type ?? '') || undefined;
}

const actions = clone(fixture.roots.wizard.actions).filter((action) => (
  ['burning_hands_objects', 'area_object_push', 'magic_missile'].includes(primitive(action) ?? '')
  || (object(object(action.mechanics.activation)?.trigger)?.events as unknown[] | undefined)
    ?.includes('targeted_by_magic_missile')
));

function action(type: string): RuleActionDefinition {
  const found = actions.find((candidate) => primitive(candidate) === type);
  if (!found) throw new Error(`Missing generated ${type}`);
  return found;
}

function actor(role: 'wizard' | 'fighter', id: string): ActorState {
  const value = clone(fixture.roots[role].actor);
  value.id = id;
  value.name = role === 'wizard' ? `Wizard ${id.slice(0, 4)}` : `Fighter ${id.slice(0, 4)}`;
  value.controllerId = `test:${id}`;
  return value;
}

function character(value: ActorState, revision = 0): ForgeCharacter {
  return {
    id: value.id,
    name: value.name,
    user_id: 'test-user',
    access_mode: 'owner',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    runtime_revision: revision,
    current_hp: value.runtime.hp.current,
    max_hp: value.runtime.hp.max,
    resources: clone(value.runtime.resources),
    max_resources: clone(value.runtime.maxResources),
    active_effects: clone(value.runtime.activeEffects),
    currency: { gold: 0, silver: 0, copper: 0 },
    turn_state: {},
  } as unknown as ForgeCharacter;
}

function canonical(value: ActorState, availableActions = actions): SheetCanonicalRuntime {
  const actionMap = new Map(availableActions.map((candidate) => [candidate.id, candidate]));
  const catalog: RulesCatalog = {
    getAction: (id) => actionMap.get(id),
    listActions: () => availableActions,
  };
  return {
    actorId: value.id,
    world: createWorld({
      id: `sheet:${value.id}`,
      ruleset: fixture.source.ruleset,
      actors: [clone(value)],
    }),
    actions: availableActions,
    catalog,
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used by combat session tests'); },
  };
}

function seed(role: 'wizard' | 'fighter', id: string): SheetCombatParticipantSeed {
  const value = actor(role, id);
  return {
    character: character(value),
    canonical: canonical(value, role === 'wizard' ? actions : []),
  };
}

function spellGrantId(value: ActorState, actionId: string): string {
  const grant = value.spellcastingAccess?.grants.find((candidate) => candidate.actionId === actionId);
  if (!grant) throw new Error(`Missing grant for ${actionId}`);
  return grant.grantId;
}

function targetFacts(targetId: string, distanceFt = 10) {
  return [{
    targetId,
    factsSource: 'scenario' as const,
    boardRevision: 0,
    relation: 'enemy' as const,
    distanceFt,
    lineOfSight: true,
    cover: 'none' as const,
  }];
}

function declaration(
  source: SheetCombatParticipantSeed,
  spell: RuleActionDefinition,
  targetId: string,
) {
  const cast = {
    sceneMode: 'encounter' as const,
    targetIds: [] as string[],
    spell: {
      grantId: spellGrantId(source.canonical.world.actors[source.character.id], spell.id),
      mode: 'normal' as const,
      castLevel: 1,
    },
  };
  return buildSheetCombatDeclaration({
    action: spell,
    base: cast,
    targets: targetFacts(targetId),
    ...(primitive(spell) === 'magic_missile'
      ? { dartAllocation: { [targetId]: 3 } }
      : {}),
  });
}

class AtomicMemoryStore implements SheetRuntimeCommandStore {
  private readonly rows = new Map<string, ForgeCharacter>();

  private readonly ledger = new Map<string, {
    request: string;
    response: CharacterRuntimeCommandResponse;
  }>();

  commits = 0;

  committedEvents = 0;

  loseNextResponse = false;

  rejectBeforeCommit = false;

  constructor(characters: readonly ForgeCharacter[]) {
    for (const current of characters) this.rows.set(current.id, clone(current));
  }

  get(id: string): ForgeCharacter {
    const found = this.rows.get(id);
    if (!found) throw new Error(`Unknown ${id}`);
    return clone(found);
  }

  async commit(request: CharacterRuntimeCommandRequest): Promise<CharacterRuntimeCommandResponse> {
    const bytes = canonicalStringify(request);
    const replay = this.ledger.get(request.command_id);
    if (replay) {
      if (replay.request !== bytes) throw new Error('command_id_reuse');
      return { ...clone(replay.response), replayed: true };
    }
    const staged = new Map<string, ForgeCharacter>();
    for (const participant of request.participants) {
      const before = this.rows.get(participant.character_id);
      if (!before || before.runtime_revision !== participant.expected_runtime_revision) {
        throw new Error('runtime_revision_conflict');
      }
      const patch = participant.patch;
      staged.set(participant.character_id, {
        ...before,
        ...(patch.current_hp === undefined ? {} : { current_hp: patch.current_hp }),
        ...(patch.resources === undefined ? {} : { resources: clone(patch.resources) }),
        ...(patch.max_resources === undefined ? {} : { max_resources: clone(patch.max_resources) }),
        ...(patch.active_effects === undefined ? {} : { active_effects: clone(patch.active_effects) }),
        ...(patch.currency === undefined ? {} : { currency: clone(patch.currency) }),
        ...(patch.turn_state === undefined ? {} : {
          turn_state: { ...(before.turn_state ?? {}), ...clone(patch.turn_state) },
        }),
        runtime_revision: participant.expected_runtime_revision + 1,
      });
    }
    if (this.rejectBeforeCommit) throw new Error('injected_atomic_failure');
    for (const [id, next] of staged) this.rows.set(id, next);
    this.commits += 1;
    this.committedEvents += request.events.length;
    const response: CharacterRuntimeCommandResponse = {
      command_id: request.command_id,
      replayed: false,
      participants: request.participants.map((participant) => {
        const next = this.get(participant.character_id);
        return {
          character_id: participant.character_id,
          runtime_revision: next.runtime_revision!,
          character: next,
        };
      }),
    };
    this.ledger.set(request.command_id, { request: bytes, response: clone(response) });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new Error('response_lost_after_commit');
    }
    return response;
  }
}

async function openSpell(type: 'burning_hands_objects' | 'area_object_push') {
  const source = seed('wizard', IDS.source);
  const target = seed('fighter', IDS.target);
  const spell = action(type);
  const session = await createSheetCombatSession({ source, targets: [target] });
  const transition = executeSheetCombatAction({
    session,
    actionId: spell.id,
    actorId: IDS.source,
    declaration: declaration(source, spell, IDS.target),
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    rng: () => 0,
  });
  return { source, target, spell, transition };
}

describe('CharacterV3 atomic pending-combat session', () => {
  it('explicitly clears only the combat continuation from turn state', () => {
    const turnState = {
      ordinary_runtime: { kept: true },
      [SHEET_COMBAT_SESSION_KEY]: { stale: true },
    };
    expect(hasSheetCombatSession(turnState)).toBe(true);
    expect(clearSheetCombatSession(turnState)).toEqual({ ordinary_runtime: { kept: true } });
    expect(hasSheetCombatSession(clearSheetCombatSession(turnState))).toBe(false);
    expect(turnState).toHaveProperty(SHEET_COMBAT_SESSION_KEY);
  });
  it('drops a completed continuation after an ordinary sheet revision changes', async () => {
    const source = seed('wizard', IDS.source);
    const session = await createSheetCombatSession({ source, targets: [] });
    const turnState = writeSheetCombatSession({}, session);

    expect(readSheetCombatSession(turnState, IDS.source, 0)).not.toBeNull();
    expect(readSheetCombatSession(turnState, IDS.source, 1)).toBeNull();
  });

  it('drops a completed continuation from a previous certified release', async () => {
    const source = seed('wizard', IDS.source);
    const session = await createSheetCombatSession({ source, targets: [] });
    const turnState = writeSheetCombatSession({}, session);
    const nextRuleset = {
      ...fixture.source.ruleset,
      contentHash: 'sha256:next-certified-release',
    };

    expect(readSheetCombatSession(
      turnState,
      IDS.source,
      0,
      nextRuleset,
    )).toBeNull();
  });

  it('fails closed when a sheet changes during a pending target decision', async () => {
    const source = seed('wizard', IDS.source);
    const thunderwave = action('area_object_push');
    const session = await createSheetCombatSession({
      source,
      targets: [],
      sceneActors: [createSheetSceneTargetActor(TRAINING_DUMMY)],
    });
    const pending = executeSheetCombatAction({
      session,
      actorId: IDS.source,
      actionId: thunderwave.id,
      declaration: declaration(source, thunderwave, TRAINING_DUMMY_TARGET_ID),
      commandId: '09090909-0909-4090-8090-090909090909',
      rng: () => 0,
    });
    const turnState = writeSheetCombatSession({}, {
      ...session,
      world: pending.nextWorld,
    });

    expect(() => readSheetCombatSession(turnState, IDS.source, 1))
      .toThrow('Ожидающее боевое решение устарело');
    expect(() => readSheetCombatSession(
      turnState,
      IDS.source,
      0,
      { ...fixture.source.ruleset, contentHash: 'sha256:next-certified-release' },
    )).toThrow('Ожидающее боевое решение относится к другой версии правил');
  });

  it('runs Thunderwave against a scene target and persists only the source sheet', async () => {
    const source = seed('wizard', IDS.source);
    const thunderwave = action('area_object_push');
    const session = await createSheetCombatSession({
      source,
      targets: [],
      sceneActors: [createSheetSceneTargetActor(TRAINING_DUMMY)],
    });
    expect(session.world.actors[TRAINING_DUMMY_TARGET_ID]).toMatchObject({
      name: 'Пугало',
      ac: 10,
      kind: 'monster',
    });
    const opened = executeSheetCombatAction({
      session,
      actorId: IDS.source,
      actionId: thunderwave.id,
      declaration: declaration(source, thunderwave, TRAINING_DUMMY_TARGET_ID),
      commandId: '10101010-1010-4010-8010-101010101010',
      rng: () => 0,
    });
    expect(opened.nextWorld.pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: TRAINING_DUMMY_TARGET_ID,
    });
    const characters = { [IDS.source]: source.character };
    const first = prepareSheetCombatCommit({ transition: opened, characters });
    expect(first.request.participants.map((row) => row.character_id)).toEqual([IDS.source]);
    const store = new AtomicMemoryStore([source.character]);
    const firstResponse = await commitPreparedSheetCombat(store, first);
    const reloadedCharacters = acceptedSheetCombatCharacters(first, firstResponse);
    const reloaded = readSheetCombatSession(
      reloadedCharacters[IDS.source].turn_state,
      IDS.source,
    )!;
    const resolved = resolveSheetCombatDecision({
      session: reloaded,
      commandId: '20202020-2020-4020-8020-202020202020',
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] } },
      rng: () => 0,
    });
    const second = prepareSheetCombatCommit({
      transition: resolved,
      characters: reloadedCharacters,
    });
    expect(second.request.participants.map((row) => row.character_id)).toEqual([IDS.source]);
    const secondResponse = await commitPreparedSheetCombat(store, second);
    const completed = acceptedSheetCombatCharacters(second, secondResponse);
    const completedSession = readSheetCombatSession(completed[IDS.source].turn_state, IDS.source)!;
    expect(completedSession.world.actors[TRAINING_DUMMY_TARGET_ID].runtime.hp.current)
      .toBeLessThan(TRAINING_DUMMY.hitPoints);
    expect(completedSession.world.pendingResolution).toBeNull();
  });

  it.each([
    ['Burning Hands', 'burning_hands_objects'],
    ['Thunderwave', 'area_object_push'],
  ] as const)('%s survives source and target reload before the sequential save', async (_name, type) => {
    const opened = await openSpell(type);
    expect(opened.transition.nextWorld.pendingResolution?.type).toBe('target_save');
    const characters = {
      [IDS.source]: opened.source.character,
      [IDS.target]: opened.target.character,
    };
    const prepared = prepareSheetCombatCommit({ transition: opened.transition, characters });
    expect(prepared.request.ruleset_ref).toEqual({
      system_id: fixture.source.ruleset.systemId,
      release_id: fixture.source.ruleset.releaseId,
      content_hash: fixture.source.ruleset.contentHash,
      errata_version: fixture.source.ruleset.errataVersion,
    });
    expect(prepared.request.participants.map((row) => row.character_id)).toEqual([
      IDS.source,
      IDS.target,
    ]);
    expect(prepared.request.participants.every((row) => (
      object(row.patch.turn_state)?.[SHEET_COMBAT_SESSION_KEY] != null
    ))).toBe(true);
    expect(prepared.committedSession.certifiedActionIdsByActor[IDS.source])
      .toContain(opened.spell.id);
    expect(prepared.committedSession.certifiedActionIdsByActor[IDS.target]).toEqual([]);

    const store = new AtomicMemoryStore(Object.values(characters));
    store.loseNextResponse = true;
    await expect(commitPreparedSheetCombat(store, prepared)).rejects.toThrow('response_lost');
    expect(store.commits).toBe(1);
    const replay = await commitPreparedSheetCombat(store, prepared);
    expect(replay.replayed).toBe(true);
    expect(store.commits).toBe(1);
    const reloaded = acceptedSheetCombatCharacters(prepared, replay);
    const fromTarget = readSheetCombatSession(reloaded[IDS.target].turn_state, IDS.target);
    const fromSource = readSheetCombatSession(reloaded[IDS.source].turn_state, IDS.source);
    expect(fromTarget?.world).toEqual(fromSource?.world);
    expect(fromTarget?.world.pendingResolution?.type).toBe('target_save');

    const resolved = resolveSheetCombatDecision({
      session: fromTarget!,
      commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] } },
      rng: () => 0,
    });
    const second = prepareSheetCombatCommit({ transition: resolved, characters: reloaded });
    const secondResponse = await commitPreparedSheetCombat(store, second);
    const completed = acceptedSheetCombatCharacters(second, secondResponse);
    expect(completed[IDS.target].current_hp).toBeLessThan(opened.target.character.current_hp);
    expect(readSheetCombatSession(completed[IDS.target].turn_state, IDS.target)
      ?.world.pendingResolution).toBeNull();
  });

  it('reloads Magic Missile on the target, pays exact Shield grant, and advances ordered turns', async () => {
    const source = seed('wizard', IDS.source);
    const target = seed('wizard', IDS.target);
    const missile = action('magic_missile');
    const session = await createSheetCombatSession({ source, targets: [target] });
    const opened = executeSheetCombatAction({
      session,
      actorId: IDS.source,
      actionId: missile.id,
      declaration: declaration(source, missile, IDS.target),
      commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      rng: () => 0,
    });
    expect(opened.nextWorld.pendingResolution?.type).toBe('magic_missile_reaction');
    const initialCharacters = {
      [IDS.source]: source.character,
      [IDS.target]: target.character,
    };
    const first = prepareSheetCombatCommit({ transition: opened, characters: initialCharacters });
    const store = new AtomicMemoryStore(Object.values(initialCharacters));
    const firstResponse = await commitPreparedSheetCombat(store, first);
    const afterOpen = acceptedSheetCombatCharacters(first, firstResponse);
    const reloaded = readSheetCombatSession(afterOpen[IDS.target].turn_state, IDS.target)!;
    const pending = reloaded.world.pendingResolution;
    if (!pending || pending.type !== 'magic_missile_reaction') throw new Error('reaction missing');
    const shield = pending.request.options.find((option) => option.spellSources?.length);
    const payment = shield?.spellSources?.find((sourceOption) => sourceOption.payment.kind === 'slot')
      ?? shield?.spellSources?.[0];
    if (!shield || !payment) throw new Error('Shield source missing');

    const resolved = resolveSheetCombatDecision({
      session: reloaded,
      commandId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      response: {
        kind: 'reaction',
        actionId: shield.actionId,
        spell: {
          grantId: payment.grantId,
          mode: 'normal',
          preferFreeUse: payment.payment.kind === 'free_use',
        },
      },
      rng: () => 0,
    });
    const second = prepareSheetCombatCommit({ transition: resolved, characters: afterOpen });
    const secondResponse = await commitPreparedSheetCombat(store, second);
    const afterShield = acceptedSheetCombatCharacters(second, secondResponse);
    expect(afterShield[IDS.target].current_hp).toBe(target.character.current_hp);
    expect(afterShield[IDS.target].resources?.reaction).toBe(0);
    expect(afterShield[IDS.target].resources?.spell_slot_1).toBe(1);

    const completed = readSheetCombatSession(afterShield[IDS.source].turn_state, IDS.source)!;
    const end = advanceSheetCombatTurn({
      session: completed,
      commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      type: 'EndTurn',
      actorId: IDS.source,
    });
    const endPrepared = prepareSheetCombatCommit({ transition: end, characters: afterShield });
    const endResponse = await commitPreparedSheetCombat(store, endPrepared);
    const afterEnd = acceptedSheetCombatCharacters(endPrepared, endResponse);
    const targetReload = readSheetCombatSession(afterEnd[IDS.target].turn_state, IDS.target)!;
    expect(targetReload.world.scene).toMatchObject({ activeIndex: 1, turnStarted: false });
    const start = advanceSheetCombatTurn({
      session: targetReload,
      commandId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      type: 'StartTurn',
      actorId: IDS.target,
    });
    const startPrepared = prepareSheetCombatCommit({ transition: start, characters: afterEnd });
    const startResponse = await commitPreparedSheetCombat(store, startPrepared);
    const afterStart = acceptedSheetCombatCharacters(startPrepared, startResponse);
    expect(readSheetCombatSession(afterStart[IDS.target].turn_state, IDS.target)?.world.scene)
      .toMatchObject({ activeIndex: 1, turnStarted: true });
  });

  it('rolls back every participant when an atomic store rejects before commit', async () => {
    const opened = await openSpell('burning_hands_objects');
    const characters = {
      [IDS.source]: opened.source.character,
      [IDS.target]: opened.target.character,
    };
    const prepared = prepareSheetCombatCommit({ transition: opened.transition, characters });
    const store = new AtomicMemoryStore(Object.values(characters));
    store.rejectBeforeCommit = true;
    await expect(commitPreparedSheetCombat(store, prepared)).rejects.toThrow('atomic_failure');
    expect(store.get(IDS.source)).toEqual(characters[IDS.source]);
    expect(store.get(IDS.target)).toEqual(characters[IDS.target]);
    expect(store.commits).toBe(0);
  });

  it('rejects an altered payload that reuses a committed command id', async () => {
    const opened = await openSpell('area_object_push');
    const characters = {
      [IDS.source]: opened.source.character,
      [IDS.target]: opened.target.character,
    };
    const prepared = prepareSheetCombatCommit({ transition: opened.transition, characters });
    const store = new AtomicMemoryStore(Object.values(characters));
    await commitPreparedSheetCombat(store, prepared);
    const altered = clone(prepared) as PreparedSheetCombatCommit;
    altered.request.participants[0].patch.current_hp = 1;
    await expect(commitPreparedSheetCombat(store, altered)).rejects.toThrow('command_id_reuse');
    expect(store.commits).toBe(1);
  });

  it('does not let one participant execute an action certified to another actor', async () => {
    const source = seed('wizard', IDS.source);
    const target = seed('fighter', IDS.target);
    const burningHands = action('burning_hands_objects');
    const session = await createSheetCombatSession({ source, targets: [target] });
    expect(() => executeSheetCombatAction({
      session,
      actorId: IDS.target,
      actionId: burningHands.id,
      declaration: declaration(source, burningHands, IDS.source),
      commandId: '12121212-1212-4212-8212-121212121212',
      rng: () => 0,
    })).toThrow('is not certified to execute');
  });

  it('fails closed when a reloaded actor grant drifts from the certified release', async () => {
    const source = seed('wizard', IDS.source);
    const target = seed('fighter', IDS.target);
    const session = await createSheetCombatSession({ source, targets: [target] });
    const certified = await loadCertifiedSheetCombatCatalog();
    const drifted: typeof session = {
      ...session,
      world: clone(session.world),
    };
    const sourceActor = drifted.world.actors[IDS.source];
    const certifiedActionIds = new Set(drifted.certifiedActionIdsByActor[IDS.source]);
    const grant = sourceActor.spellcastingAccess?.grants.find((candidate) => (
      certifiedActionIds.has(candidate.actionId)
    ));
    if (!grant) throw new Error('Expected a certified spell grant in the wizard fixture');
    grant.slotResource = 'invented_slot_namespace';
    expect(() => assertCertifiedSheetCombatSession(drifted, certified))
      .toThrow('differs from certified access');
  });
});
