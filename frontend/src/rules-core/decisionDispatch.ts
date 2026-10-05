import type {CommandResult, DeterministicEnvironment, GameCommand, PendingResolution, RulesCatalog, UncommittedRuleEvent, WorldState} from './domain';

type DecisionExecutor = (world: WorldState, command: Extract<GameCommand, {type: 'ResolveDecision'}>, catalog: RulesCatalog, env: DeterministicEnvironment) => CommandResult | Omit<UncommittedRuleEvent, 'ordinal'>[];

/** The saved phase chooses its continuation. Each continuation validates its own request. */
export type DecisionExecutors = Record<PendingResolution['type'], DecisionExecutor>;

export function dispatchDecision(world: WorldState, command: Extract<GameCommand, {type: 'ResolveDecision'}>, catalog: RulesCatalog, env: DeterministicEnvironment, executors: DecisionExecutors) {
  const phase = world.pendingResolution?.type;
  // The existing save continuation rejects absent/unknown saved phases. Keep that
  // reader behavior for old snapshots instead of guessing a new phase.
  const execute = phase && Object.prototype.hasOwnProperty.call(executors, phase)
    ? executors[phase] : executors.target_save;
  return execute(world, command, catalog, env);
}
