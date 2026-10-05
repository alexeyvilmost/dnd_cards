import type {CommandResult, CommandRejectionCode, GameCommand, RulesCatalog, DeterministicEnvironment, WorldState, UncommittedRuleEvent} from './domain';

type EventInput = Omit<UncommittedRuleEvent, 'ordinal'>;
/** Every supported command has exactly one canonical phase owner. */
export type CommandExecutors = {[K in GameCommand['type']]: (world: WorldState, command: Extract<GameCommand, {type: K}>, catalog: RulesCatalog, env: DeterministicEnvironment) => CommandResult | EventInput[]};

export function dispatchCommand(world: WorldState, command: GameCommand, catalog: RulesCatalog, env: DeterministicEnvironment, executors: CommandExecutors, rejected: (world: WorldState, code: CommandRejectionCode, message: string) => CommandResult): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  if(actor.itemTurn&&!['StartTurn','EndTurn','UseAction'].includes(command.type))
    return rejected(world,'InvalidActionTiming','Item initiative permits only its declared attack and turn boundaries');
  switch (command.type) {
    case 'ChangeEquipment': return executors.ChangeEquipment(world, command, catalog, env);
    case 'StartEncounter': return executors.StartEncounter(world, command, catalog, env);
    case 'DeathSavingThrow': return executors.DeathSavingThrow(world, command, catalog, env);
    case 'StartTurn': return executors.StartTurn(world, command, catalog, env);
    case 'EndTurn': return executors.EndTurn(world, command, catalog, env);
    case 'TakeShortRest': return executors.TakeShortRest(world, command, catalog, env);
    case 'TakeLongRest': return executors.TakeLongRest(world, command, catalog, env);
    case 'UseAttackReplacement': return executors.UseAttackReplacement(world, command, catalog, env);
    case 'BeginAttackAction': return executors.BeginAttackAction(world, command, catalog, env);
    case 'PerformWeaponAttack': return executors.PerformWeaponAttack(world, command, catalog, env);
    case 'PerformLightWeaponExtraAttack': return executors.PerformLightWeaponExtraAttack(world, command, catalog, env);
    case 'PerformWeaponMasteryCleaveAttack': return executors.PerformWeaponMasteryCleaveAttack(world, command, catalog, env);
    case 'PerformUnarmedStrike': return executors.PerformUnarmedStrike(world, command, catalog, env);
    case 'PerformPactChainFamiliarAttack': return executors.PerformPactChainFamiliarAttack(world, command, catalog, env);
    case 'BondPactBlade': return executors.BondPactBlade(world, command, catalog, env);
    case 'ObservePactBladeDistance': return executors.ObservePactBladeDistance(world, command, catalog, env);
    case 'AdjudicateActorDeath': return executors.AdjudicateActorDeath(world, command, catalog, env);
    case 'ForfeitAttackAction': return executors.ForfeitAttackAction(world, command, catalog, env);
    case 'EscapeGrapple': return executors.EscapeGrapple(world, command, catalog, env);
    case 'ReleaseGrapple': return executors.ReleaseGrapple(world, command, catalog, env);
    case 'BreakGrappleRange': return executors.BreakGrappleRange(world, command, catalog, env);
    case 'ObserveProtectionProximity': return executors.ObserveProtectionProximity(world, command, catalog, env);
    case 'UseReactionAction': return executors.UseReactionAction(world, command, catalog, env);
    case 'UseTriggeredAction': return executors.UseTriggeredAction(world, command, catalog, env);
    case 'UseAction': return executors.UseAction(world, command, catalog, env);
    case 'ArmBoon': return executors.ArmBoon(world, command, catalog, env);
    case 'AbilityCheck': return executors.AbilityCheck(world, command, catalog, env);
    case 'AttemptHide': return executors.AttemptHide(world, command, catalog, env);
    case 'MakeNoise': return executors.MakeNoise(world, command, catalog, env);
    case 'FindHiddenActor': return executors.FindHiddenActor(world, command, catalog, env);
    case 'SwapInitiative': return executors.SwapInitiative(world, command, catalog, env);
    case 'TriggerHazard': return executors.TriggerHazard(world, command, catalog, env);
    case 'SavingThrow': return executors.SavingThrow(world, command, catalog, env);
    case 'StudyWorldObject': return executors.StudyWorldObject(world, command, catalog, env);
    case 'PhysicallyInteractWorldObject': return executors.PhysicallyInteractWorldObject(world, command, catalog, env);
    case 'RevealMagicAura': return executors.RevealMagicAura(world, command, catalog, env);
    case 'MoveDancingLights': return executors.MoveDancingLights(world, command, catalog, env);
    case 'ObservePoisonDisease': return executors.ObservePoisonDisease(world, command, catalog, env);
    case 'DonArmor': return executors.DonArmor(world, command, catalog, env);
    case 'UseFamiliarSharedSenses': return executors.UseFamiliarSharedSenses(world, command, catalog, env);
    case 'DismissFamiliar': return executors.DismissFamiliar(world, command, catalog, env);
    case 'ReappearFamiliar': return executors.ReappearFamiliar(world, command, catalog, env);
    case 'DeliverTouchSpellThroughFamiliar': return executors.DeliverTouchSpellThroughFamiliar(world, command, catalog, env);
    case 'ResolveDecision': return executors.ResolveDecision(world, command, catalog, env);
  }
}
