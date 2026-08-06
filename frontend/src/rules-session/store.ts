import type { UncommittedRuleEvent, WorldState } from '../rules-core/domain';

export interface StoredRuleEvent {
  key: string;
  worldId: string;
  revision: number;
  ordinal: number;
  event: UncommittedRuleEvent;
}

export interface RulesWorldStore {
  loadWorld(worldId: string): Promise<WorldState | null>;
  /** Immutable genesis used as the replay root; never replaced by snapshots. */
  loadGenesis(worldId: string): Promise<WorldState | null>;
  initialize(world: WorldState): Promise<WorldState>;
  commit(input: {
    worldId: string;
    expectedRevision: number;
    nextState: WorldState;
    events: UncommittedRuleEvent[];
  }): Promise<void>;
  loadEvents(worldId: string): Promise<StoredRuleEvent[]>;
}

export class SessionStoreConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Session store revision conflict: expected ${expectedRevision}, got ${actualRevision}`);
    this.name = 'SessionStoreConflictError';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRulesWorldStore implements RulesWorldStore {
  private readonly worlds = new Map<string, WorldState>();
  private readonly genesis = new Map<string, WorldState>();
  private readonly events = new Map<string, StoredRuleEvent>();

  async loadWorld(worldId: string): Promise<WorldState | null> {
    const world = this.worlds.get(worldId);
    return world ? clone(world) : null;
  }

  async loadGenesis(worldId: string): Promise<WorldState | null> {
    const world = this.genesis.get(worldId);
    return world ? clone(world) : null;
  }

  async initialize(world: WorldState): Promise<WorldState> {
    const existing = this.worlds.get(world.id);
    if (existing) return clone(existing);
    this.genesis.set(world.id, clone(world));
    this.worlds.set(world.id, clone(world));
    return clone(world);
  }

  async commit(input: {
    worldId: string;
    expectedRevision: number;
    nextState: WorldState;
    events: UncommittedRuleEvent[];
  }): Promise<void> {
    const current = this.worlds.get(input.worldId);
    if (!current) throw new Error(`World ${input.worldId} is not initialized`);
    if (current.revision !== input.expectedRevision) {
      throw new SessionStoreConflictError(input.expectedRevision, current.revision);
    }
    for (const event of input.events) {
      const key = storedEventKey(input.worldId, input.nextState.revision, event.ordinal);
      if (this.events.has(key)) throw new Error(`Duplicate stored rule event ${key}`);
      this.events.set(key, {
        key,
        worldId: input.worldId,
        revision: input.nextState.revision,
        ordinal: event.ordinal,
        event: clone(event),
      });
    }
    this.worlds.set(input.worldId, clone(input.nextState));
  }

  async loadEvents(worldId: string): Promise<StoredRuleEvent[]> {
    return [...this.events.values()]
      .filter((row) => row.worldId === worldId)
      .sort((a, b) => a.revision - b.revision || a.ordinal - b.ordinal)
      .map(clone);
  }
}

export function storedEventKey(worldId: string, revision: number, ordinal: number): string {
  return `${worldId}:${revision.toString().padStart(12, '0')}:${ordinal.toString().padStart(6, '0')}`;
}
