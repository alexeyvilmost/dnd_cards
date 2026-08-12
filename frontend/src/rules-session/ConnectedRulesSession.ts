import { apiClient } from '../api/client';
import { canonicalSha256, canonicalStringify } from '../rules-core/determinism';
import type {
  CommandResult,
  DeterministicEnvironment,
  GameCommand,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { handleCommand } from '../rules-core/handler';
import { migrateWorldState } from '../rules-core/worldMigration';

export const SERVER_RULES_AUTHORITY = 'server_rules_core_verified' as const;
export const SERVER_RULES_SCHEMA_VALIDATION = 'rules-core-world-v5-verified' as const;

export interface CanonicalSessionRead {
  sessionId: string;
  rulesetReleaseId: string;
  rulesArtifactHash: string;
  revision: number;
  snapshotSeq: number;
  stateHash: string;
  snapshotSchemaVersion: number;
  serializerVersion: string;
  snapshot: WorldState;
  semanticAuthority: typeof SERVER_RULES_AUTHORITY;
  schemaValidation: typeof SERVER_RULES_SCHEMA_VALIDATION;
}

export interface CanonicalRulesCommandAccepted {
  sessionId: string;
  commandId: string;
  semanticCommandId: string;
  revision: number;
  snapshotSeq: number;
  stateHash: string;
  semanticAuthority: typeof SERVER_RULES_AUTHORITY;
  schemaValidation: typeof SERVER_RULES_SCHEMA_VALIDATION;
  engineVersion: string;
  events: UncommittedRuleEvent[];
  snapshot: WorldState;
}

export interface ConnectedRulesTransport {
  create(input: {
    characterIds: string[];
    rulesArtifactHash: string;
    world: WorldState;
  }): Promise<CanonicalSessionRead>;
  get(sessionId: string): Promise<CanonicalSessionRead>;
  command(sessionId: string, command: GameCommand): Promise<CanonicalRulesCommandAccepted>;
  close(sessionId: string): Promise<void>;
}

export const httpConnectedRulesTransport: ConnectedRulesTransport = {
  async create(input) {
    const { data } = await apiClient.post<CanonicalSessionRead>(
      '/api/rules/canonical-sessions',
      input,
    );
    return data;
  },
  async get(sessionId) {
    const { data } = await apiClient.get<CanonicalSessionRead>(
      `/api/rules/canonical-sessions/${sessionId}`,
    );
    return data;
  },
  async command(sessionId, command) {
    const { data } = await apiClient.post<CanonicalRulesCommandAccepted>(
      `/api/rules/canonical-sessions/${sessionId}/commands`,
      { command },
    );
    return data;
  },
  async close(sessionId) {
    await apiClient.post(`/api/rules/canonical-sessions/${sessionId}/close`, {});
  },
};

export interface ConnectedDispatchResult {
  result: Extract<CommandResult, { status: 'accepted' }>;
  prediction: CommandResult;
  predictionMatched: boolean;
  reconciled: boolean;
}

export class ConnectedRulesProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectedRulesProtocolError';
  }
}

function assertServerEnvelope(
  value: CanonicalSessionRead | CanonicalRulesCommandAccepted,
): void {
  if (value.semanticAuthority !== SERVER_RULES_AUTHORITY
    || value.schemaValidation !== SERVER_RULES_SCHEMA_VALIDATION) {
    throw new ConnectedRulesProtocolError('Backend response is not server-rules authoritative');
  }
}

/**
 * Browser execution hides latency and previews legality. The server snapshot
 * and events are the only state committed by a connected shared session.
 */
export class ConnectedRulesSession {
  private world: WorldState;

  private constructor(
    readonly sessionId: string,
    initialWorld: WorldState,
    private readonly catalog: RulesCatalog,
    private readonly previewEnv: DeterministicEnvironment,
    private readonly transport: ConnectedRulesTransport,
  ) {
    this.world = initialWorld;
  }

  static async open(input: {
    sessionId: string;
    catalog: RulesCatalog;
    previewEnv: DeterministicEnvironment;
    transport?: ConnectedRulesTransport;
  }): Promise<ConnectedRulesSession> {
    const transport = input.transport ?? httpConnectedRulesTransport;
    const current = await transport.get(input.sessionId);
    assertServerEnvelope(current);
    const world = migrateWorldState(structuredClone(current.snapshot));
    if (world.revision !== current.revision || await canonicalSha256(world) !== current.stateHash) {
      throw new ConnectedRulesProtocolError('Canonical session snapshot failed revision/hash verification');
    }
    return new ConnectedRulesSession(
      input.sessionId,
      world,
      input.catalog,
      input.previewEnv,
      transport,
    );
  }

  static async create(input: {
    characterIds: string[];
    rulesArtifactHash: string;
    world: WorldState;
    catalog: RulesCatalog;
    previewEnv: DeterministicEnvironment;
    transport?: ConnectedRulesTransport;
  }): Promise<ConnectedRulesSession> {
    const transport = input.transport ?? httpConnectedRulesTransport;
    const current = await transport.create({
      characterIds: [...input.characterIds].sort(),
      rulesArtifactHash: input.rulesArtifactHash,
      world: structuredClone(input.world),
    });
    assertServerEnvelope(current);
    const world = migrateWorldState(structuredClone(current.snapshot));
    if (world.revision !== current.revision || await canonicalSha256(world) !== current.stateHash) {
      throw new ConnectedRulesProtocolError('Canonical session genesis failed revision/hash verification');
    }
    return new ConnectedRulesSession(
      current.sessionId,
      world,
      input.catalog,
      input.previewEnv,
      transport,
    );
  }

  getState(): WorldState {
    return structuredClone(this.world);
  }

  async close(): Promise<void> {
    await this.transport.close(this.sessionId);
  }

  async refresh(): Promise<WorldState> {
    const current = await this.transport.get(this.sessionId);
    assertServerEnvelope(current);
    const world = migrateWorldState(structuredClone(current.snapshot));
    if (await canonicalSha256(world) !== current.stateHash) {
      throw new ConnectedRulesProtocolError('Refetched canonical snapshot hash mismatch');
    }
    this.world = world;
    return this.getState();
  }

  async dispatch(command: GameCommand): Promise<ConnectedDispatchResult> {
    if (command.expectedRevision !== this.world.revision) {
      throw new ConnectedRulesProtocolError('Command expectedRevision differs from connected state');
    }
    const prediction = handleCommand(
      structuredClone(this.world),
      structuredClone(command),
      this.catalog,
      this.previewEnv,
    );
    let committed: CanonicalRulesCommandAccepted;
    try {
      committed = await this.transport.command(this.sessionId, command);
    } catch (initialError) {
      // A command may have committed while its HTTP response was lost. Read
      // the authoritative head first; only an exact processed command id
      // permits replaying the same immutable command for its stored receipt.
      const current = await this.transport.get(this.sessionId);
      assertServerEnvelope(current);
      const refreshed = migrateWorldState(structuredClone(current.snapshot));
      if (await canonicalSha256(refreshed) !== current.stateHash
        || !refreshed.processedCommandIds.includes(command.commandId)) {
        throw initialError;
      }
      committed = await this.transport.command(this.sessionId, command);
    }
    assertServerEnvelope(committed);
    if (committed.commandId !== command.commandId || committed.revision !== this.world.revision + 1) {
      throw new ConnectedRulesProtocolError('Server acknowledgement does not match the submitted command');
    }
    const snapshot = migrateWorldState(structuredClone(committed.snapshot));
    if (snapshot.revision !== committed.revision
      || await canonicalSha256(snapshot) !== committed.stateHash) {
      throw new ConnectedRulesProtocolError('Server command snapshot failed revision/hash verification');
    }
    const result: Extract<CommandResult, { status: 'accepted' }> = {
      status: 'accepted',
      events: structuredClone(committed.events),
      nextState: snapshot,
    };
    const predictionMatched = prediction.status === 'accepted'
      && canonicalStringify(prediction.events) === canonicalStringify(result.events)
      && canonicalStringify(prediction.nextState) === canonicalStringify(result.nextState);
    this.world = snapshot;
    return { result, prediction, predictionMatched, reconciled: !predictionMatched };
  }
}
