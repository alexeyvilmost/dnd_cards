import type { UncommittedRuleEvent, WorldState } from '../rules-core/domain';
import {
  SessionStoreConflictError,
  storedEventKey,
  type RulesWorldStore,
  type StoredRuleEvent,
} from './store';

const WORLDS_STORE = 'worlds';
const GENESIS_STORE = 'world_genesis';
const EVENTS_STORE = 'events';
const WORLD_INDEX = 'by_world';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

export class BrowserIndexedDbRulesWorldStore implements RulesWorldStore {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(
    private readonly databaseName = 'dnd-cards-rules-v1',
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseVersion = 2,
  ) {}

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.factory.open(this.databaseName, this.databaseVersion);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(WORLDS_STORE)) {
            database.createObjectStore(WORLDS_STORE, { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains(GENESIS_STORE)) {
            database.createObjectStore(GENESIS_STORE, { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains(EVENTS_STORE)) {
            const events = database.createObjectStore(EVENTS_STORE, { keyPath: 'key' });
            events.createIndex(WORLD_INDEX, 'worldId', { unique: false });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB rules store'));
      });
    }
    return this.databasePromise;
  }

  async loadWorld(worldId: string): Promise<WorldState | null> {
    const database = await this.database();
    const transaction = database.transaction(WORLDS_STORE, 'readonly');
    const result = await requestResult(transaction.objectStore(WORLDS_STORE).get(worldId) as IDBRequest<WorldState | undefined>);
    await transactionDone(transaction);
    return result ?? null;
  }

  async loadGenesis(worldId: string): Promise<WorldState | null> {
    const database = await this.database();
    const transaction = database.transaction(GENESIS_STORE, 'readonly');
    const result = await requestResult(
      transaction.objectStore(GENESIS_STORE).get(worldId) as IDBRequest<WorldState | undefined>,
    );
    await transactionDone(transaction);
    return result ?? null;
  }

  async initialize(world: WorldState): Promise<WorldState> {
    const database = await this.database();
    const transaction = database.transaction([WORLDS_STORE, GENESIS_STORE], 'readwrite');
    const worlds = transaction.objectStore(WORLDS_STORE);
    const genesis = transaction.objectStore(GENESIS_STORE);
    const existing = await requestResult(worlds.get(world.id) as IDBRequest<WorldState | undefined>);
    const existingGenesis = await requestResult(
      genesis.get(world.id) as IDBRequest<WorldState | undefined>,
    );
    if (!existing) worlds.add(world);
    // Version-1 databases did not retain a replay root. The deterministic
    // caller-provided initial world is the only admissible upgrade genesis;
    // PersistentRulesSession immediately replays and compares it with the
    // stored snapshot, so an incompatible root fails closed.
    if (!existingGenesis) genesis.add(world);
    await transactionDone(transaction);
    return existing ?? world;
  }

  async commit(input: {
    worldId: string;
    expectedRevision: number;
    nextState: WorldState;
    events: UncommittedRuleEvent[];
  }): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction([WORLDS_STORE, EVENTS_STORE], 'readwrite');
    const worlds = transaction.objectStore(WORLDS_STORE);
    const events = transaction.objectStore(EVENTS_STORE);
    const current = await requestResult(worlds.get(input.worldId) as IDBRequest<WorldState | undefined>);
    if (!current) {
      transaction.abort();
      throw new Error(`World ${input.worldId} is not initialized`);
    }
    if (current.revision !== input.expectedRevision) {
      transaction.abort();
      throw new SessionStoreConflictError(input.expectedRevision, current.revision);
    }
    for (const event of input.events) {
      const row: StoredRuleEvent = {
        key: storedEventKey(input.worldId, input.nextState.revision, event.ordinal),
        worldId: input.worldId,
        revision: input.nextState.revision,
        ordinal: event.ordinal,
        event,
      };
      events.add(row);
    }
    worlds.put(input.nextState);
    await transactionDone(transaction);
  }

  async loadEvents(worldId: string): Promise<StoredRuleEvent[]> {
    const database = await this.database();
    const transaction = database.transaction(EVENTS_STORE, 'readonly');
    const index = transaction.objectStore(EVENTS_STORE).index(WORLD_INDEX);
    const rows = await requestResult(index.getAll(worldId) as IDBRequest<StoredRuleEvent[]>);
    await transactionDone(transaction);
    return rows.sort((a, b) => a.revision - b.revision || a.ordinal - b.ordinal);
  }

  async close(): Promise<void> {
    const database = await this.database();
    database.close();
    this.databasePromise = undefined;
  }
}
