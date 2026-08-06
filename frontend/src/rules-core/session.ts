import type {
  CommandResult,
  DeterministicEnvironment,
  GameCommand,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { handleCommand } from './handler';

export interface RulesSessionSnapshot {
  world: WorldState;
  events: UncommittedRuleEvent[];
}

/** In-memory adapter used by scenarios and as the contract for future local/server adapters. */
export class InMemoryRulesSession {
  private world: WorldState;
  private readonly eventLog: UncommittedRuleEvent[] = [];

  constructor(
    initialWorld: WorldState,
    private readonly catalog: RulesCatalog,
    private readonly env: DeterministicEnvironment,
  ) {
    this.world = initialWorld;
  }

  getState(): WorldState {
    return this.world;
  }

  getEvents(): readonly UncommittedRuleEvent[] {
    return this.eventLog;
  }

  dispatch(command: GameCommand): CommandResult {
    const result = handleCommand(this.world, command, this.catalog, this.env);
    if (result.status === 'accepted') {
      this.world = result.nextState;
      this.eventLog.push(...result.events);
    }
    return result;
  }

  snapshot(): RulesSessionSnapshot {
    return { world: this.world, events: [...this.eventLog] };
  }
}
