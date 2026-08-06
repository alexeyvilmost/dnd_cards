import type {
  CommandResult,
  DeterministicEnvironment,
  GameCommand,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { canonicalStringify } from '../rules-core/determinism';
import { foldEvents } from '../rules-core/reducer';
import { migrateWorldState } from '../rules-core/worldMigration';
import { storedEventKey, type RulesWorldStore, type StoredRuleEvent } from './store';

export type RulesSessionListener = (world: WorldState, events: readonly UncommittedRuleEvent[]) => void;

export type RulesSessionIntegrityCode =
  | 'missing_genesis'
  | 'initial_world_mismatch'
  | 'invalid_event_stream'
  | 'snapshot_replay_mismatch';

export class RulesSessionIntegrityError extends Error {
  constructor(readonly code: RulesSessionIntegrityCode, message: string) {
    super(message);
    this.name = 'RulesSessionIntegrityError';
  }
}

function replayStoredEvents(
  genesis: WorldState,
  rows: readonly StoredRuleEvent[],
): WorldState {
  let world = genesis;
  let offset = 0;
  let expectedRevision = genesis.revision + 1;
  while (offset < rows.length) {
    const revision = rows[offset].revision;
    if (revision !== expectedRevision) {
      throw new RulesSessionIntegrityError(
        'invalid_event_stream',
        `Stored event revision is not contiguous: expected ${expectedRevision}, got ${revision}`,
      );
    }
    const group: StoredRuleEvent[] = [];
    while (offset < rows.length && rows[offset].revision === revision) {
      group.push(rows[offset]);
      offset += 1;
    }
    for (const [ordinal, row] of group.entries()) {
      if (row.worldId !== genesis.id
        || row.ordinal !== ordinal
        || row.event.ordinal !== ordinal
        || row.key !== storedEventKey(genesis.id, revision, ordinal)) {
        throw new RulesSessionIntegrityError(
          'invalid_event_stream',
          `Stored event envelope is invalid at revision ${revision}, ordinal ${ordinal}`,
        );
      }
    }
    const commits = group.filter((row) => row.event.payload.type === 'CommandCommitted');
    const last = group.at(-1);
    if (commits.length !== 1
      || last?.event.payload.type !== 'CommandCommitted'
      || last.event.payload.revision !== revision) {
      throw new RulesSessionIntegrityError(
        'invalid_event_stream',
        `Revision ${revision} must end with exactly one matching CommandCommitted event`,
      );
    }
    try {
      world = foldEvents(world, group.map((row) => row.event));
    } catch (error) {
      throw new RulesSessionIntegrityError(
        'invalid_event_stream',
        `Revision ${revision} cannot be replayed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (world.revision !== revision) {
      throw new RulesSessionIntegrityError(
        'invalid_event_stream',
        `Revision ${revision} replay produced world revision ${world.revision}`,
      );
    }
    expectedRevision += 1;
  }
  return world;
}

/**
 * The only runtime write gateway for migrated browser flows. A successful
 * command becomes visible to subscribers only after the atomic store commit.
 */
export class PersistentRulesSession {
  private readonly listeners = new Set<RulesSessionListener>();

  private constructor(
    private world: WorldState,
    private readonly catalog: RulesCatalog,
    private readonly env: DeterministicEnvironment,
    private readonly store: RulesWorldStore,
  ) {}

  static async open(input: {
    initialWorld: WorldState;
    catalog: RulesCatalog;
    env: DeterministicEnvironment;
    store: RulesWorldStore;
  }): Promise<PersistentRulesSession> {
    const initialWorld = migrateWorldState(input.initialWorld);
    const snapshot = migrateWorldState(await input.store.initialize(initialWorld));
    const storedGenesis = await input.store.loadGenesis(initialWorld.id);
    if (!storedGenesis) {
      throw new RulesSessionIntegrityError(
        'missing_genesis',
        `World ${initialWorld.id} has no immutable replay genesis`,
      );
    }
    const genesis = migrateWorldState(storedGenesis);
    if (canonicalStringify(genesis) !== canonicalStringify(initialWorld)) {
      throw new RulesSessionIntegrityError(
        'initial_world_mismatch',
        `World ${initialWorld.id} was opened with a different genesis or rules release`,
      );
    }
    const rows = await input.store.loadEvents(initialWorld.id);
    const replayed = replayStoredEvents(genesis, rows);
    if (canonicalStringify(replayed) !== canonicalStringify(snapshot)) {
      throw new RulesSessionIntegrityError(
        'snapshot_replay_mismatch',
        `World ${initialWorld.id} snapshot diverges from its canonical event replay`,
      );
    }
    const world = replayed;
    return new PersistentRulesSession(world, input.catalog, input.env, input.store);
  }

  getState(): WorldState {
    return this.world;
  }

  subscribe(listener: RulesSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispatch(command: GameCommand): Promise<CommandResult> {
    const before = this.world;
    const result = handleCommand(before, command, this.catalog, this.env);
    if (result.status === 'rejected') return result;
    await this.store.commit({
      worldId: before.id,
      expectedRevision: before.revision,
      nextState: result.nextState,
      events: result.events,
    });
    this.world = result.nextState;
    for (const listener of this.listeners) listener(this.world, result.events);
    return result;
  }

  async persistedEvents(): Promise<UncommittedRuleEvent[]> {
    return (await this.store.loadEvents(this.world.id)).map((row) => row.event);
  }
}
