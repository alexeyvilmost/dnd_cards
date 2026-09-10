export {disarmingSelectionIssue} from '../../engine/heldItemDrop';
export { isDamageCalculation, resolveDamageCalculation } from '../../engine/damageCalculation';
/**
 * Temporary anti-corruption boundary around the existing single-actor engine.
 * No other rules-core module should import legacy engine modules directly.
 */
export { canPay, pay } from '../../engine/cost';
export {
  applyIncomingDamage,
  applyDamageConsequences,
  consumeNextRollEffects,
  executeAction,
  expireEffectsForTrigger,
  preflightMechanicsExecution,
  projectedAgainst,
  readTargetSave,
  resolveNextTurnCommand,
} from '../../engine/execute';
export {
  collectRollModifiers,
  conditionCapabilityDenied,
  deniedCapabilities,
} from '../../engine/modifiers';
export { activeConditionsOf, matchesWhen } from '../../engine/circumstances';
export {
  activeConditionWorldFactEnabled,
  conditionEffectEntityRef,
  conditionRegistryAuthority,
  conditionThresholdOutcomes,
} from '../../engine/conditions';
export { addBonusDieToD20Roll, rollD20 } from '../../engine/roll';
export { applySourceTurnBoundary } from '../../engine/sourceTurnExpiry';
export { activeEffectRequirementIssue } from '../../engine/actionRequirements';
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
