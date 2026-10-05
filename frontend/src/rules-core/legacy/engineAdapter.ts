export {disarmingSelectionIssue} from '../../engine/heldItemDrop';
export {startEncounter,expireEncounterRound} from '../../engine/encounter';
export { isDamageCalculation, resolveDamageCalculation } from '../../engine/damageCalculation';
/**
 * Temporary anti-corruption boundary around the existing single-actor engine.
 * Stateful single-actor operations stay here; stateless declarations belong in
 * rules-primitives. Type-only mvp/contracts imports do not execute this adapter.
 */
export { canPay, pay } from '../../engine/cost';
export {
  applyIncomingDamage,
  applyDamageConsequences,
  resolveDeferredSourceConsequences,
  consumeNextRollEffects,
  executeAction,
  expireEffectsForTrigger,
  preflightMechanicsExecution,
  projectedAgainst,
  readTargetSave,
  resolveNextTurnCommand,
  emitEvent,
} from '../../engine/execute';
export {
  collectRollModifiers,
  collectModifiers,
  foldModifiers,
  conditionCapabilityDenied,
  deniedCapabilities,
} from '../../engine/modifiers';
export { activeConditionsOf, matchesWhen } from '../../engine/circumstances';
export {
  activeConditionWorldFactEnabled,
  conditionRule,
  conditionEffectEntityRef,
  conditionRegistryAuthority,
  conditionThresholdOutcomes,
} from '../../engine/conditions';
export { addBonusDieToD20Roll, retargetAttackRoll, rollD20 } from '../../engine/roll';
export { applySourceTurnBoundary } from '../../engine/sourceTurnExpiry';
export { activeEffectRequirementIssue, itemSourceRequirementIssue } from '../../engine/actionRequirements';
export { matchingRuntimeActionGrants, runtimeActionContext } from '../../engine/actionGrantContext';
export { nonMagicActionCost, projectActionSurgeCost, projectQuickenedSpellCost } from '../../engine/actionSurge';
export { armBoonForNextRoll, consumeBoonAfterFailure, runtimeBoonSpec } from '../../engine/boons';
export { payloadsOf } from '../../engine/mechanicsView';
export { armorClassValue } from '../../engine/ac';
export { breakdownValue } from '../../engine/breakdown';
export { isArmorCard } from '../../engine/equipment';
export {
  bindEquippedWeaponActionContext,
  bindEquippedWeaponAmmoCost,
  isWeaponProficient,
  weaponAttackKind,
  weaponActionAvailability,
  weaponContext,
} from '../../engine/weapon';
export {
  parseWeaponProfile,
  weaponAttackMode,
  weaponAttackModeAtDistance,
  evaluateWeaponHeavyRule,
} from '../../engine/weaponProfile';
export type { WeaponAttackMode, WeaponProfile } from '../../engine/weaponProfile';
export {
  actorWeaponHasMasteryPrimitive,
  weaponMasteryCleaveUseKey,
  weaponMasteryNickUseKey,
  WEAPON_MASTERY_CLEAVE_USE_PREFIX,
  WEAPON_MASTERY_NICK_USE_PREFIX,
} from '../../engine/weaponMastery2024';
export { endTurn, longRest, shortRest, startTurn } from '../../engine/turn';
export type {
  CharacterContext,
  DeferredTargetSave,
  EngineEvent,
  ExecuteContext,
  RollLog,
  ResourceRestRecovery,
  RuntimeState,
  SpellCastContext,
  SpellComponents,
} from '../../mvp/contracts';
export type { ModifierQueryFacts } from '../../engine/modifiers';
export type { EvalContext } from '../../engine/circumstances';

export {canHear, perceivesWithoutSight} from '../../engine/senses';
export {applyDeathSaveRoll,emptyDeathSaves,rollDeathSaveDie,describeDeathSaveOutcome} from '../../engine/deathSaves';

// Runtime projections and policies depend on the existing single-actor model.
// Keep explicit exports (never export *) so a new dependency needs review.
export {projectRuntimeCharacter} from '../../engine/runtimeCharacterProjection';
export {reconcileEquipmentResourceGrants} from '../../character/resourceInit';
export {availableActionCostPolicies, applyActionCostPolicies} from '../../engine/actionCostPolicy';
export {actorIsDead, resurrectionPermitted, collectLifePolicies, actorHasConsciousVitality} from '../../engine/lifePolicies';
export {itemEquipmentChangeIssue} from '../../engine/itemEquipmentPolicy';
export {advanceEffectTime} from '../../engine/elapsedTime';
export {reconcileEndedEffects} from '../../engine/effectLifecycle';
export {reconcileTemporaryResourceGrants} from '../../engine/temporaryResourceGrants';
export {applyItemSpellProjectiles} from '../../engine/itemSpellProjectiles';
export {availableResources} from '../../engine/resourceRestrictions';
export {applyItemActionTargetLimit} from '../../engine/itemExecutionCapabilities';
export {concentrationProtectedUntilDeath} from '../../engine/concentration';
export {isAntimagicField, isMagicalMechanics} from '../../engine/magic';
export {triggerChance} from '../../engine/triggerChance';
export {parseResourceRestRecovery} from '../../engine/actionUses';
