import {dispatchDecision, type DecisionExecutors} from './decisionDispatch';
import {dispatchCommand, type CommandExecutors} from './commandDispatch';
import {createAttackDamageContinuations} from './attackDamageContinuations';
import {recipientBindingEvents} from './recipientBindings';
import {hasReactionTrigger,triggerOwner} from './triggerOwnership';
import {queueEventReactions} from './eventReactionQueue';
import {bindTriggeredAttackTargeting} from './triggeredAttackTargeting';
import {changeEquipment} from './equipmentChange';
import {inherentWeaponBondEvents,thrownWeaponEvents,deployedItemEvents} from './itemWeaponLifecycle';
import {emitEvent as emitEngineEvent} from './legacy/engineAdapter';
import {teleportDestinationIssue} from './teleportDestination';
import {effectReactionActor,bindReceivedEffectAction,receivedEffectEvents} from './effectReceived';
import {effectRollFacts} from '../rules-primitives/effectRollFacts';
import {bindItemTool,itemToolMutationEvents,itemToolWorkSeconds} from './itemTools';
import {advanceEffectTime} from './legacy/engineAdapter';
import {reconcileEndedEffects} from './legacy/engineAdapter';
import {reconcileTemporaryResourceGrants} from './legacy/engineAdapter';
import {damageTransferSpec,damageTransferEligible} from './damageTransfer';
import {projectileReflection,hasProjectileReflection} from './projectileReflection';
import {attackRedirectionRules,redirectedAttackTarget} from './attackRedirection';
import {endedBondEffects} from './bondLifecycle';
import {magicProjectionEvents,magicActionIssue} from './magicSuppression';
import { applyItemSpellProjectiles } from './legacy/engineAdapter';
import {attackActionBudget} from './attackActionBudget';
import { itemLightEvents,bindItemLightFuel } from './itemLight';
import {bindWorldItemAction,worldItemActionSource} from './worldItemActions';
import {itemMaterialFocusEvents} from './itemMaterialFocus';
import {projectRuntimeCharacter} from './legacy/engineAdapter';
import {availableResources} from './legacy/engineAdapter';
import {weaponActionAvailability,weaponAttackKind} from './legacy/engineAdapter';
import {activeSlotRecoveryChoice,applyActiveSlotRecovery} from './activeSlotRecovery';
import {recoverAfterDeath} from './deathRecovery';
import {hideEligibilityIssue, hideActionDeclarationIssue} from './hide';
import {availableActionCostPolicies,applyActionCostPolicies} from './legacy/engineAdapter';
import {collectLifePolicies,actorHasConsciousVitality} from './legacy/engineAdapter';
import {payloadsOf} from '../rules-primitives/mechanicsView';
import {applyItemActionTargetLimit} from './legacy/engineAdapter';
import {applyFailedCheckBoost, failedCheckBoostActions} from './failedCheckBoost';
import { weaponBondProtectsHand, weaponBondRecallIssue, weaponBondRecallEvents } from './weaponBond';
import {concentrationProtectedUntilDeath} from './legacy/engineAdapter';
import {telekineticObjectIssue, telekineticHandEvents} from './telekineticMovement';
import {heldItemDropWorldEvents, consumedHeldItemWorldEvents} from './heldItemWorld';
import {effectiveArmorClass, effectiveArmorClassBreakdown} from './actorArmorClass';
import { resolveDamageCalculation } from './legacy/engineAdapter';
import {systemActionAsRuleDefinition, unarmedDamageActionFor, weaponAttackAction} from './attackDefinitions';
import {meleeWeaponDefenseEligible, singleAttackDefenseBonus} from './attackDefenseRuntime';
import {applyDeathSaveRoll,emptyDeathSaves,rollDeathSaveDie,describeDeathSaveOutcome} from './legacy/engineAdapter';
import {
  activeConditionsOf,
  activeConditionWorldFactEnabled,
  canHear,
  applyIncomingDamage,
  applyDamageConsequences,
  resolveDeferredSourceConsequences,
  breakdownValue,
  bindEquippedWeaponActionContext,
  canPay,
  collectRollModifiers,
  consumeNextRollEffects,
  deniedCapabilities,
  endTurn,
  executeAction,
  expireEffectsForTrigger,
  isArmorCard,
  isWeaponProficient,
  longRest,
  readTargetSave,
  retargetAttackRoll,
  resolveNextTurnCommand,
  rollD20,
  shortRest,
  startTurn,
  startEncounter,
  expireEncounterRound,
  weaponContext,
  parseWeaponProfile,
  weaponAttackModeAtDistance,
  evaluateWeaponHeavyRule,
  actorWeaponHasMasteryPrimitive,
  weaponMasteryCleaveUseKey,
  weaponMasteryNickUseKey,
  WEAPON_MASTERY_CLEAVE_USE_PREFIX,
  applySourceTurnBoundary,
  matchesWhen,
  activeEffectRequirementIssue,
  matchingRuntimeActionGrants,
  runtimeActionContext,
  disarmingSelectionIssue,
  projectActionSurgeCost,
  nonMagicActionCost,
  projectQuickenedSpellCost,
  addBonusDieToD20Roll,
  armBoonForNextRoll,
  consumeBoonAfterFailure,
  runtimeBoonSpec,
} from './legacy/engineAdapter';
import { compileDeclaredMechanicsTargeting, targetSlotBounds } from './actionTargeting';
import { generalFeatRangedDeclaration } from './generalFeatAttackDeclaration';
import {
  DUAL_WIELDER_CAPABILITY,
  generalFeatWeaponDamagePassives,
  ownsGeneralFeatCapability,
} from './generalFeatDamageRuntime';
import {
  actorOwnsGrappler,
  defensiveDuelistReactionEligible,
  grapplerAttackAdvantagePassive,
} from './generalFeatReactionRuntime';
import { spellAttackIgnoresCover } from './generalSpellFeatRuntime';
import type {
  CharacterContext,
  DeferredTargetSave,
  EngineEvent,
  ExecuteContext,
  RollLog,
  SpellCastContext,
} from './legacy/engineAdapter';
import type {
  Ability,
  ActorRuntimePatch,
  AttackActionState,
  ActorState,
  CommandRejectionCode,
  CommandResult,
  ActionWorldInput,
  ConcentrationEffectLink,
  DeterministicEnvironment,
  EncounterScene,
  GameCommand,
  PendingAttackVolley,
  PendingResolutionFollowUp,
  PendingTargetSaveResolution,
  PendingProtectionReactionResolution,
  PactBladeAttackContinuationProjection,
  ProtectionAttackContinuationKind,
  ProtectionReactionCandidateFacts,
  QueuedProtectionReaction,
  QueuedConcentrationSaveResolution,
  QueuedMagicMissileReaction,
  QueuedMasterySaveResolution,
  QueuedTargetSaveResolution,
  ReactionActionOption,
  RuleActionDefinition,
  RuleEventPayload,
  RuleHazardDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
  WorldState,
  GrappleState,
} from './domain';
import { foldEvents } from './reducer';
import { parseActivationCastTime } from './activationCastTime';
import { parseActivationLevelRequirement } from './activationRequirements';
import { createStrictRngTape } from './determinism';
import {
  advanceWorldObjectRounds,
  attachLight,
  createMinorIllusion,
  igniteBurningHandsObjects,
  observeDetectMagic,
  physicallyRevealMinorIllusion,
  pushWorldObjects,
  studyMinorIllusion,
} from './worldObjects';
import {
  createDancingLights,
  endSourceActorTurnWorldObjects,
  mendWorldObject,
  moveDancingLights,
  observeDetectPoisonAndDisease,
  purifyFoodAndDrink,
  resolveDruidcraft,
  resolvePrestidigitation,
  type DruidcraftOption,
  type PrestidigitationOption,
} from './worldSpellPrimitives';
import {
  magicMissileDartCount,
  parseWorldSpellPolicy,
  type BurningHandsObjectsPolicy,
  type DancingLightsWorldPolicy,
  type DetectMagicWorldPolicy,
  type DetectPoisonDiseaseWorldPolicy,
  type DruidcraftWorldPolicy,
  type LightWorldPolicy,
  type MagicMissilePolicy,
  type MendingWorldPolicy,
  type MinorIllusionWorldPolicy,
  type ParsedMechanicsTargeting,
  type PrestidigitationWorldPolicy,
  type PurifyFoodDrinkWorldPolicy,
} from './worldSpellPolicies';
import {
  applyArmorOfAgathysCast,
  temporaryHpMeleeRetaliationPolicyFromMechanics,
  temporaryHpMeleeRetaliations,
  createArmorOfAgathysEffect,
  endArmorOfAgathysWithoutTemporaryHp,
  type TemporaryHpChoice,
} from './armorOfAgathys';
import { longRestEligibility } from './actorTraits';
import {
  prepareSpellExecution,
  type PreparedSpellExecution,
} from './spellcastingExecution';
import {
  resolveSlotRecoveryRestDecision,
} from './restDecisions';
import {
  attackSequenceComplete,
  beginAttackSequence,
  performUnarmedStrike,
  performWeaponSequenceAttack,
  replaceSequenceAttack,
  type AttackSequenceState,
} from './attackSequence';
import type {
  MagicBlockingLayer,
  WorldObjectFacts,
  WorldObjectMutationEvent,
} from './worldObjects';
import { stoneworkContactIssue } from './dwarfTraits';
import {
  getSystemActionDefinition,
  SYSTEM_ACTION_IDS,
} from './systemActions';
import {
  applyUnarmedDamageProfileToAction,
  resolveTurnStartGrappleDamage,
} from './fightingStyleComplexPrimitives';
import {
  lightWeaponExtraAttackDamageAbility,
  lightWeaponExtraAttackEligibility,
  lightWeaponExtraAttackUseKey,
  type LightWeaponExtraAttackIssue,
} from './lightWeaponExtraAttack';
import {
  activateFamiliarSharedSenses,
  castFindFamiliar,
  deliverTouchSpellThroughFamiliar,
  dismissFamiliar,
  familiarDropsToZeroHp,
  parseFindFamiliarMechanicsPolicy,
  reappearFamiliar,
  startFamiliarTurn,
  startOwnerTurnForFamiliar,
  substitutePactChainFamiliarAttack,
  type FamiliarSpiritType,
  type FindFamiliarCastMethod,
  type FindFamiliarMechanicsPolicy,
} from './findFamiliar';
import { getFamiliarActorTemplate } from './familiarActorCatalog';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_PRIMITIVE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
  WILD_COMPANION_PRIMITIVE,
  canonicalTouchSpell,
  findFamiliarMaterialCost,
  familiarActorsOwnedBy,
  familiarAttackRuleAction,
  materializeCanonicalFamiliarActor,
  requireOwnedFamiliar,
  rollFamiliarInitiative,
  wildCompanionMechanicsPolicy,
} from './familiarRuntime';
import {
  PROTECTION_2024_CAPABILITY_ID,
  advanceProtection2024Effect,
  getProtection2024Eligibility,
  protection2024SourceIssue,
  resolveProtection2024AttackRoll,
  resolveProtection2024Reaction,
  type Protection2024CapabilitySource,
  type Protection2024ReactionFacts,
} from './protection';
import {
  actorHoldsCanonicalShield,
  actorProtectionEffects,
  pendingProtectionResolutionIssue,
} from './protectionRuntime';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  parseDeclaredWeaponActionPolicy,
  WEAPON_ATTACK_PRIMITIVE,
  type DeclaredWeaponActionPrimitive,
} from './weaponActionPolicies';
import {
  pactTomeSpellCastAudit,
  planPactTomeOwnerDeathTransition,
  planPactTomeRestTransition,
  type PactTomeWorldAdapterFailureCode,
} from './pactTomeWorldAdapter';
import { PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS } from './pactTomeRuntime';
import {
  planPactBladeAttackProjection,
  planPactBladeBondTransition,
  planPactBladeDistanceTransition,
  planPactBladeMaterialFocus,
  planPactBladeOwnerDeathTransition,
  type PactBladeAttackSelection,
  type PactBladeWorldAdapterFailureCode,
} from './pactBladeWorldAdapter';
import {
  conditionInteractionDenied,
  conditionTargetingSightIssue,
  terminalConditionFacts,
} from './conditionsRuntime';

export type EventInput = Omit<UncommittedRuleEvent, 'ordinal'>;

const ABILITY_LABEL: Record<Ability, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

const SKILL_ABILITY: Record<string,Ability> = {
  acrobatics:'dex',animal_handling:'wis',arcana:'int',athletics:'str',deception:'cha',
  history:'int',insight:'wis',intimidation:'cha',investigation:'int',medicine:'wis',
  nature:'int',perception:'wis',performance:'cha',persuasion:'cha',religion:'int',
  sleight_of_hand:'dex',stealth:'dex',survival:'wis',
};

function liveCharacter(actor:ActorState){return projectRuntimeCharacter(actor.character,actor.runtime,actor.passives??[]);}

function actorCheckMods(actor:ActorState):Record<string,number>{
  return Object.fromEntries(Object.entries(SKILL_ABILITY).map(([skill,ability])=>{
    const proficiency=actor.character.skillExpertise?.includes(skill)
      ? liveCharacter(actor).profBonus*2
      : actor.character.skillProficiencies?.includes(skill) ? liveCharacter(actor).profBonus : 0;
    return [skill,(liveCharacter(actor).abilityMods[ability]??0)+proficiency];
  }));
}

function rejected(world: WorldState, code: CommandRejectionCode, message: string): CommandResult {
  return { status: 'rejected', code, message, state: world };
}

function currentActor(scene: EncounterScene): string {
  return scene.initiative[scene.activeIndex] ?? '';
}

function validateCommon(world: WorldState, command: GameCommand): CommandResult | null {
  // Idempotency is deliberately checked before revision, so a retry is not
  // misreported as an unrelated optimistic-concurrency conflict.
  if (world.processedCommandIds.includes(command.commandId)) {
    return rejected(world, 'DuplicateCommand', `Command ${command.commandId} was already committed`);
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(command.commandId)) {
    return rejected(world, 'InvalidCommandId', 'commandId must be a stable 1-128 character identifier');
  }
  if (command.expectedRevision !== world.revision) {
    return rejected(world, 'StaleRevision', `Expected revision ${command.expectedRevision}, got ${world.revision}`);
  }
  if (command.rulesetContentHash !== world.ruleset.contentHash) {
    return rejected(world, 'RulesetMismatch', 'Command was created for another ruleset release');
  }
  if (!world.actors[command.actorId]) {
    return rejected(world, 'ActorNotFound', `Unknown actor ${command.actorId}`);
  }
  if (command.type !== 'AdjudicateActorDeath'
    && world.actors[command.actorId].lifecycle?.status === 'dead') {
    return rejected(world, 'ActorDead', `Actor ${command.actorId} has been adjudicated dead`);
  }
  return null;
}

function validateTurn(world: WorldState, command: GameCommand): CommandResult | null {
  if (command.type === 'ResolveDecision') return null;
  if (command.type === 'DeathSavingThrow' && world.actors[command.actorId]?.runtime.firedThisTurn?.includes('system:immediate-death-save-due')) return null;
  // Reaction actions are catalog-gated in the UseReactionAction handler below.
  if (command.type === 'UseReactionAction' || command.type === 'UseTriggeredAction') return null;
  if (command.type === 'SwapInitiative') return null;
  // A catalog-owned environmental area can force a save when it appears or
  // when another creature moves; the affected creature need not own the turn.
  if (command.type === 'TriggerHazard') return null;
  if (command.type === 'ReleaseGrapple' || command.type === 'BreakGrappleRange') return null;
  if (command.type === 'ObserveProtectionProximity') return null;
  if (command.type === 'ObservePactBladeDistance' || command.type === 'AdjudicateActorDeath') return null;
  if (world.scene.mode !== 'encounter' || command.type === 'StartEncounter') return null;
  if (command.type === 'TakeShortRest' || command.type === 'TakeLongRest') {
    return rejected(world, 'InvalidActionTiming', 'A rest cannot begin while an encounter is active');
  }
  if (currentActor(world.scene) !== command.actorId) {
    return rejected(world, 'NotActorsTurn', `It is not ${command.actorId}'s turn`);
  }
  if (command.type === 'StartTurn' && world.scene.turnStarted) {
    return rejected(world, 'TurnAlreadyStarted', 'The active turn has already started');
  }
  if (command.type !== 'StartTurn' && !world.scene.turnStarted) {
    return rejected(world, 'TurnNotStarted', 'Start the active turn before acting');
  }
  return null;
}

function validateResolutionLock(world: WorldState, command: GameCommand): CommandResult | null {
  if (world.pendingResolution
    && command.type !== 'ResolveDecision'
    && command.type !== 'ReleaseGrapple'
    && command.type !== 'BreakGrappleRange') {
    return rejected(world, 'ResolutionInProgress', `Resolution ${world.pendingResolution.id} must be completed first`);
  }
  if (!world.pendingResolution && command.type === 'ResolveDecision') {
    return rejected(world, 'NoPendingResolution', 'There is no decision to resolve');
  }
  return null;
}

function factualTargetRangeFt(action: RuleActionDefinition): number {
  const targeting = action.mechanics.targeting;
  if (!targeting || typeof targeting !== 'object' || Array.isArray(targeting)) {
    return action.targeting?.rangeFt ?? 0;
  }
  const declaration = targeting as Record<string, unknown>;
  const area = declaration.area;
  if (declaration.shape === 'area' && area && typeof area === 'object' && !Array.isArray(area)) {
    const geometry = area as Record<string, unknown>;
    const radiusFt = Number(geometry.radius_ft ?? geometry.size_ft);
    // An emanation's origin has range 0, while its actor targets occupy the
    // declared radius around that origin. Target validation therefore uses
    // the radius; keeping range 0 as the casting-origin authority is correct.
    if (geometry.kind === 'emanation' && Number.isFinite(radiusFt) && radiusFt > 0) {
      return radiusFt;
    }
  }
  return action.targeting?.rangeFt ?? 0;
}

function factsIssue(action: RuleActionDefinition, targetId: string, facts?: SpatialFacts): [CommandRejectionCode, string] | null {
  const targeting = action.targeting;
  if (!targeting) return null;
  if (!facts) return ['MissingSpatialFacts', `Missing spatial facts for target ${targetId}`];
  const rawTargeting=action.mechanics.targeting as Record<string,unknown> | undefined;
  const delivery=rawTargeting?.shape==='area' ? facts.areaDelivery : undefined;
  const targetRangeFt = factualTargetRangeFt(action);
  const distanceFt=delivery?.distanceFt ?? facts.distanceFt;
  if (!Number.isFinite(distanceFt) || distanceFt < 0 || distanceFt > (delivery ? targeting.rangeFt : targetRangeFt)) {
    return ['OutOfRange', `${targetId} is outside ${targetRangeFt} ft range`];
  }
  if (targeting.requiresLineOfSight && (!facts.lineOfSight || facts.cover === 'total')) {
    return ['LineOfSightBlocked', `Line of sight to ${targetId} is blocked`];
  }
  if (delivery && (!delivery.lineOfSight || delivery.cover==='total')) {
    return ['LineOfSightBlocked', 'The area origin is blocked'];
  }
  if (!targeting.allowedRelations.includes(facts.relation)) {
    return ['IllegalRelation', `${facts.relation} is not a legal relation for ${action.id}`];
  }
  if (targeting.requiresTargetPerception && facts.targetCanSeeSource !== true && facts.targetCanHearSource !== true) {
    return ['InvalidFacts', `${targetId} must be able to see or hear the source`];
  }
  if (targeting.requiresWilling && facts.willing !== true) {
    return ['TargetNotWilling', `${targetId} has not explicitly consented to ${action.id}`];
  }
  if (targeting.requiresStoneworkContact) {
    const issue = stoneworkContactIssue(facts.stonework);
    if (issue) return ['InvalidFacts', issue];
  }
  return null;
}

function actorCard(actor: ActorState, cardId: string) {
  return [
    ...(actor.character.knownCards ?? []),
    ...(actor.character.equippedCards ?? []),
  ].find((card) => card.id === cardId);
}

function armorState(actor: ActorState): 'unarmored' | 'armored' | 'unknown' {
  const bodyId = actor.runtime.equipment.body;
  if (!bodyId) return 'unarmored';
  const bodyCard = actorCard(actor, bodyId);
  if (!bodyCard) return 'unknown';
  return isArmorCard(bodyCard) ? 'armored' : 'unarmored';
}

function actionValidation(
  world: WorldState,
  action: RuleActionDefinition,
  targetIds: string[],
  factsByTarget: Record<string, SpatialFacts> | undefined,
  sourceActorId: string,
  spellCastLevel?: number,
): CommandResult | null {
  const targeting = action.targeting;
  if (targeting?.allowRepeatTargets !== true && new Set(targetIds).size !== targetIds.length) {
    return rejected(world, 'InvalidTargets', 'Each target actor may appear only once in an action');
  }
  let minTargets=0,maxTargets=0;
  if(targeting){
    try{
      ({minTargets,maxTargets}=targetSlotBounds(action,spellCastLevel,world.actors[sourceActorId]?.character.level));
    }catch(error){
      return rejected(world,'InvalidActionDefinition',error instanceof Error?error.message:String(error));
    }
  }
  if (targeting && (targetIds.length < minTargets || targetIds.length > maxTargets)) {
    return rejected(world, 'InvalidTargets', `${action.id} requires ${minTargets}-${maxTargets} target slots`);
  }
  if (sourceActorId && targeting?.allowedRelations.length === 1
    && targeting.allowedRelations[0] === 'self'
    && targetIds.some((targetId) => targetId !== sourceActorId)) {
    return rejected(world, 'InvalidTargets', `${action.id} can target only its acting actor`);
  }
  if (targetIds.length > 1) {
    if (!hasAttackRoll(action) && !hasTargetSave(action)
      && !hasIndependentTargetAutoEffects(action) && !magicMissileSpec(action)) {
      return rejected(world, 'InvalidTargets', `${action.id} cannot be executed independently for multiple targets`);
    }
  }
  if (targeting?.additionalTargetsWithinFtOfFirst !== undefined) {
    for (const targetId of targetIds.slice(1)) {
      const distance = factsByTarget?.[targetId]?.distanceToFirstTargetFt;
      if (distance === undefined || !Number.isFinite(distance) || distance < 0) {
        return rejected(world, 'MissingSpatialFacts', `Missing distance from ${targetId} to first target`);
      }
      if (distance > targeting.additionalTargetsWithinFtOfFirst) {
        return rejected(world, 'OutOfRange', `${targetId} is too far from the first target`);
      }
    }
  }
  for (const targetId of targetIds) {
    const target = world.actors[targetId];
    if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${targetId}`);
    const source=world.actors[sourceActorId];
    if(source&&source.id!==target.id&&(source.planeId??'material')!==(target.planeId??'material')
      &&(action.mechanics.targeting as Record<string,unknown>|undefined)?.allow_cross_plane!==true)
      return rejected(world,'InvalidTargets',`${targetId} находится на другой плоскости`);
    if (target.itemTurn && targetId !== sourceActorId) {
      return rejected(world, 'InvalidTargets', 'An item initiative slot is not a creature target');
    }
    const issue = factsIssue(action, targetId, factsByTarget?.[targetId]);
    if (issue) return rejected(world, issue[0], issue[1]);
    if (targeting?.requiresTargetPerception) {
      const facts = factsByTarget?.[targetId];
      const source = sourceActorId ? world.actors[sourceActorId] : undefined;
      if (!source || (source.id === target.id && !targeting.allowedRelations.includes('self'))) {
        return rejected(world, 'InvalidTargets', 'A companion must be another actor');
      }
      const seesSource = facts?.targetCanSeeSource === true && !conditionTargetingSightIssue({
        world, sourceActorId: target.id, targetActorId: source.id, requiresSight: true,
        canSeeTarget: facts.targetCanSeeSource, distanceFt: facts.distanceFt,
      });
      const hearsSource = facts?.targetCanHearSource === true
        && canHear(target.runtime, target.passives)
        && !activeConditionWorldFactEnabled(source.runtime, 'cannot_speak');
      if (!seesSource && !hearsSource) {
        return rejected(world, 'CapabilityDenied', `${targetId} cannot see or hear ${source.id}`);
      }
    }
    const sightIssue = conditionTargetingSightIssue({
      world,
      sourceActorId,
      targetActorId: targetId,
      requiresSight: targeting?.requiresSight === true,
      canSeeTarget: factsByTarget?.[targetId]?.canSeeTarget,
      distanceFt: factsByTarget?.[targetId]?.distanceFt,
    });
    if (sightIssue === 'source_cannot_see') {
      return rejected(world, 'CapabilityDenied', `${sourceActorId} cannot see a required target`);
    }
    if (sightIssue === 'target_unseen') {
      return rejected(world, 'CapabilityDenied', `${targetId} cannot be seen by ${sourceActorId}`);
    }
    if(targeting?.requiresTargetConditionsAny?.length&&!targeting.requiresTargetConditionsAny.some(condition=>activeConditionsOf(target.runtime).has(condition))){
      return rejected(world,'InvalidTargets',`${targetId} lacks a required condition for ${action.id}`);
    }
    if (targeting?.requiresUnarmored) {
      const state = armorState(target);
      if (state === 'unknown') {
        return rejected(
          world,
          'InvalidEquipmentState',
          `${targetId} has an unresolved body-slot Card and cannot be proven unarmored`,
        );
      }
      if (state === 'armored') {
        return rejected(world, 'TargetArmored', `${targetId} is wearing armor`);
      }
    }
  }
  return null;
}

function actionDefinitionIssue(action: RuleActionDefinition): string | null {
  const raw = action as unknown as Record<string, unknown>;
  const interaction = action.mechanics.interaction;
  if (interaction !== undefined) {
    if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)
      || (interaction as Record<string, unknown>).intent !== 'harmful') {
      return `${action.id} has an invalid interaction intent marker`;
    }
  }
  if (!Array.isArray(action.sourceEntityIds) || action.sourceEntityIds.length === 0
    || action.sourceEntityIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    return `${action.id} must have at least one stable sourceEntityId`;
  }
  if (new Set(action.sourceEntityIds).size !== action.sourceEntityIds.length) {
    return `${action.id} contains duplicate sourceEntityIds`;
  }
  const worldSpellPolicy = parseWorldSpellPolicy(action.mechanics);
  if (worldSpellPolicy.status === 'invalid') {
    return `${action.id} has invalid data-owned primitive policy: ${worldSpellPolicy.issue}`;
  }
  const castTime = parseActivationCastTime(action.mechanics);
  if (castTime.status === 'invalid') {
    return `${action.id} has invalid activation cast time: ${castTime.issue}`;
  }
  if (action.targeting) {
    if (action.targeting.requiresWilling != null
      && typeof action.targeting.requiresWilling !== 'boolean') {
      return `${action.id} has an invalid requiresWilling targeting requirement`;
    }
    if (action.targeting.requiresUnarmored != null
      && typeof action.targeting.requiresUnarmored !== 'boolean') {
      return `${action.id} has an invalid requiresUnarmored targeting requirement`;
    }
    if (action.targeting.requiresStoneworkContact !== undefined
      && action.targeting.requiresStoneworkContact !== true) {
      return `${action.id} has an invalid requiresStoneworkContact targeting requirement`;
    }
  }
  if (action.attackReplacement) {
    const replacement = action.attackReplacement;
    if (typeof replacement.replacementKey !== 'string' || !replacement.replacementKey.trim()) {
      return `${action.id} has an invalid attack-replacement key`;
    }
    if (replacement.replacesAttacks !== 1
      || replacement.totalAttacks!=='actor'&&(!Number.isInteger(replacement.totalAttacks)
      || replacement.totalAttacks < 1)
      || typeof replacement.oncePerAttackAction !== 'boolean') {
      return `${action.id} has an invalid attack-replacement policy`;
    }
    const actionCosts = activationCost(action).filter((cost) => (
      String(cost.resource ?? '') === 'action'
    ));
    if (actionCosts.length !== 1 || Number(actionCosts[0].amount ?? 1) !== 1) {
      return `${action.id} must spend exactly one Action when used as an attack replacement`;
    }
    if (raw.kind !== 'nonSpell' || (!hasTargetSave(action) && (action.mechanics.activation as Record<string, unknown> | undefined)?.commanded_attack !== true)) {
      return `${action.id} attack replacement must be a non-spell target-save action`;
    }
  }
  if (raw.kind === 'spell') {
    const spell = raw.spell as Record<string, unknown> | undefined;
    if (!spell) return `${action.id} is a spell but has no spell metadata`;
    if (!Number.isInteger(spell.level) || Number(spell.level) < 0 || Number(spell.level) > 9) {
      return `${action.id} has an invalid canonical spell level`;
    }
    if (spell.components != null) {
      const components = spell.components as Record<string, unknown>;
      if (!components || typeof components !== 'object'
        || typeof components.verbal !== 'boolean'
        || typeof components.somatic !== 'boolean'
        || typeof components.material !== 'boolean') {
        return `${action.id} has invalid canonical spell components`;
      }
    }
    return null;
  }
  if (raw.kind !== 'nonSpell') return `${action.id} has an unknown action kind`;
  if (raw.spell != null) return `${action.id} is non-spell but has spell metadata`;
  return null;
}

/** A harmful interaction is content authority, never inferred from an action
 * id, localized name, spell status, targeting relation, or payload shape. */
function actionDeclaresHarmfulInteraction(action: RuleActionDefinition): boolean {
  const interaction = action.mechanics.interaction;
  return Boolean(interaction && typeof interaction === 'object' && !Array.isArray(interaction)
    && (interaction as Record<string, unknown>).intent === 'harmful');
}

function harmfulConditionRejection(input: {
  world: WorldState;
  attackerActorId: string;
  targetActorIds: readonly string[];
}): CommandResult | null {
  if (!input.world.actors[input.attackerActorId]) return null;
  for (const targetActorId of input.targetActorIds) {
    if (!input.world.actors[targetActorId]) continue;
    if (conditionInteractionDenied({
      world: input.world,
      actorId: input.attackerActorId,
      targetActorId,
      capability: 'harm',
    })) {
      return rejected(
        input.world,
        'CapabilityDenied',
        `${input.attackerActorId} cannot harm ${targetActorId} in its current state`,
      );
    }
  }
  return null;
}

export type CanonicalSpellContext = SpellCastContext & {
  castLevel: number;
  baseCastingTimeSeconds?: number;
  castingTimeAddedSeconds?: number;
  focusObjectId?: string;
  focusHand?: 'main_hand' | 'off_hand';
};
type AuthoritativeUseActionCommand = Omit<
  Extract<GameCommand, { type: 'UseAction' }>,
  'spell'
> & { spell?: CanonicalSpellContext; triggeringAttack?: ExecuteContext['triggeringAttack'] };

function spellDeclarationIssue(
  action: RuleActionDefinition,
  declaration?: { baseLevel: number; castLevel?: number; sourceClass?: string },
): string | null {
  if (action.kind === 'nonSpell') {
    return declaration ? `${action.id} is not a spell` : null;
  }
  if (declaration && declaration.baseLevel !== action.spell.level) {
    return `${action.id} has canonical level ${action.spell.level}, not ${declaration.baseLevel}`;
  }
  if (declaration?.sourceClass != null && declaration.sourceClass !== action.spell.sourceClass) {
    return `${action.id} is not a ${declaration.sourceClass} spell`;
  }
  const castLevel = declaration?.castLevel ?? action.spell.level;
  if (!Number.isInteger(castLevel) || castLevel < action.spell.level || castLevel > 9) {
    return `${action.id} cannot be cast at level ${castLevel}`;
  }
  if (action.spell.level === 0 && castLevel !== 0) {
    return `${action.id} is a cantrip and cannot consume a spell slot`;
  }
  return null;
}

function canonicalSpellContext(
  action: RuleActionDefinition,
  declaration?: { baseLevel: number; castLevel?: number; sourceClass?: string },
  prepared?: PreparedSpellExecution,
  audit?: Pick<CanonicalSpellContext, 'baseCastingTimeSeconds' | 'castingTimeAddedSeconds' | 'focusObjectId' | 'focusHand'>,
): CanonicalSpellContext | undefined {
  if (action.kind !== 'spell') return undefined;
  return {
    spellId: action.spell.entityId ?? action.id,
    baseLevel: action.spell.level,
    castLevel: declaration?.castLevel ?? action.spell.level,
    ...(action.spell.school ? { school: action.spell.school } : {}),
    concentration: action.concentration === true,
    ...(action.spell.sourceClass ? { sourceClass: action.spell.sourceClass } : {}),
    ...(action.spell.components ? { components: { ...action.spell.components } } : {}),
    ...(prepared ? {
      grantId: prepared.provenance.grantId,
      sourceId: prepared.provenance.sourceId,
      spellcastingAbility: prepared.provenance.spellcastingAbility,
      ...(prepared.provenance.fixedSpellcastingModifier !== undefined ? { fixedSpellcastingModifier: prepared.provenance.fixedSpellcastingModifier } : {}),
      mode: prepared.provenance.mode,
      payment: { ...prepared.payment },
    } : {}),
    ...(audit?.castingTimeAddedSeconds !== undefined
      ? { castingTimeAddedSeconds: audit.castingTimeAddedSeconds }
      : {}),
    ...(audit?.baseCastingTimeSeconds !== undefined
      ? { baseCastingTimeSeconds: audit.baseCastingTimeSeconds }
      : {}),
    ...(audit?.focusObjectId ? { focusObjectId: audit.focusObjectId } : {}),
    ...(audit?.focusHand ? { focusHand: audit.focusHand } : {}),
  };
}

function actionObligationIds(action: RuleActionDefinition, ...systemIds: string[]): string[] {
  return [...new Set([
    `entity:${action.id}`,
    ...action.sourceEntityIds.map((id) => `entity:${id}`),
    ...systemIds,
  ])];
}

function stableSourceEntityIds(value: unknown): value is readonly [string, ...string[]] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((sourceId) => (
      typeof sourceId === 'string' && sourceId.length > 0 && sourceId.trim() === sourceId
    ))
    && new Set(value).size === value.length;
}

type WorldActionPrimitive =
  | 'item_tool'
  | 'item_light'
  | 'light_world_object'
  | 'minor_illusion_world_object'
  | 'burning_hands_objects'
  | 'area_object_push'
  | 'detect_magic_world_sensing'
  | 'dancing_lights_world'
  | 'druidcraft_world'
  | 'mending_world'
  | 'prestidigitation_world'
  | 'detect_poison_disease_world'
  | 'purify_food_drink_world'
  | 'owned_summon'
  | 'temporary_hp_melee_retaliation';

function worldActionPrimitive(action: RuleActionDefinition): WorldActionPrimitive | null {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  switch (primitive?.type) {
    case 'item_tool':
    case 'item_light':
    case 'light_world_object':
    case 'minor_illusion_world_object':
    case 'burning_hands_objects':
    case 'area_object_push':
    case 'detect_magic_world_sensing':
    case 'dancing_lights_world':
    case 'druidcraft_world':
    case 'mending_world':
    case 'prestidigitation_world':
    case 'detect_poison_disease_world':
    case 'purify_food_drink_world':
    case 'owned_summon':
    case 'temporary_hp_melee_retaliation':
      return primitive.type;
    default:
      return null;
  }
}

function forcedObjectPushPolicy(action: RuleActionDefinition) {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  if (primitive?.type !== 'area_object_push'
    || !Number.isFinite(primitive.object_push_distance_ft)
    || Number(primitive.object_push_distance_ft) <= 0
    || !Number.isFinite(primitive.object_max_distance_ft)
    || Number(primitive.object_max_distance_ft) <= 0
    || primitive.object_area_requirement !== 'entirely_in_area'
    || typeof primitive.exclude_secured_objects !== 'boolean'
    || typeof primitive.exclude_carried_objects !== 'boolean') return null;
  return {
    distanceFt: Number(primitive.object_push_distance_ft),
    maxObjectDistanceFt: Number(primitive.object_max_distance_ft),
    areaRequirement: 'entirely_in_area' as const,
    excludeSecured: primitive.exclude_secured_objects,
    excludeCarried: primitive.exclude_carried_objects,
  };
}

function worldObjectFactsIssue(facts: unknown): string | null {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    return 'World-object interaction requires explicit object facts';
  }
  const value = facts as Record<string, unknown>;
  if (!['scenario', 'board', 'gm_ruling'].includes(String(value.factsSource ?? ''))) {
    return 'World-object facts require a recognized source';
  }
  if (!Number.isInteger(value.boardRevision) || Number(value.boardRevision) < 0) {
    return 'World-object facts require a non-negative board revision';
  }
  if (!Number.isFinite(value.distanceFt) || Number(value.distanceFt) < 0
    || typeof value.lineOfSight !== 'boolean') {
    return 'World-object distance and line of sight facts are malformed';
  }
  for (const key of ['inArea', 'entirelyInArea', 'touched'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      return `World-object ${key} fact must be boolean`;
    }
  }
  return null;
}

function creationTargetingFactsIssue(
  facts: unknown,
  targeting: ParsedMechanicsTargeting,
): string | null {
  const issue = worldObjectFactsIssue(facts);
  if (issue) return issue;
  const value = facts as WorldObjectFacts;
  if (value.distanceFt > targeting.rangeFt) {
    return `World creation point is outside declared range ${targeting.rangeFt}`;
  }
  if (targeting.requiresLineOfSight && value.lineOfSight !== true) {
    return 'World creation point requires line of sight';
  }
  return null;
}

function worldObjectEvents(
  sourceActorId: string,
  action: RuleActionDefinition,
  mutations: readonly WorldObjectMutationEvent[],
  ...extraObligations: string[]
): EventInput[] {
  const obligationIds = actionObligationIds(
    action,
    'system:world-object',
    ...extraObligations,
  );
  return mutations.map((event) => ({
    sourceActorId,
    obligationIds,
    payload: { type: 'WorldObjectMutationRecorded', event },
  }));
}

function validateObjectFactsMap(
  world: WorldState,
  value: unknown,
): { factsByObject: Record<string, WorldObjectFacts> } | { rejection: CommandResult } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { rejection: rejected(world, 'InvalidFacts', 'Area-object facts must be an object map') };
  }
  const factsByObject = value as Record<string, WorldObjectFacts>;
  for (const objectId of Object.keys(factsByObject).sort()) {
    if (!world.objects[objectId]) {
      return { rejection: rejected(world, 'WorldObjectNotFound', `Unknown world object ${objectId}`) };
    }
    const issue = worldObjectFactsIssue(factsByObject[objectId]);
    if (issue) return { rejection: rejected(world, 'InvalidFacts', `${objectId}: ${issue}`) };
  }
  return { factsByObject };
}

const CORE_HIDE_ACTION: RuleActionDefinition = {
  id: 'core.action.hide',
  name: 'Hide',
  kind: 'nonSpell',
  sourceEntityIds: ['core:dnd5e-2024:action:hide'],
  mechanics: {
    name: 'Hide',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'ability_check',
      ability: 'dex',
      skill: 'stealth',
      dc: '15',
      on_success: [{
        kind: 'condition',
        value: 'invisible',
        op: 'apply',
        // Kept as canonical data even though the current turn engine only
        // interprets the condition itself. Future trigger commands can expire
        // this effect without changing the action/check contract.
        hidden_end_triggers: [
          'noise_above_whisper',
          'enemy_finds_actor',
          'actor_makes_attack_roll',
          'actor_casts_spell_with_verbal_component',
        ],
      }],
      on_fail: [],
    }],
  },
};

const CORE_ATTACK_ACTION = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.attack, {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
});

const CORE_LIGHT_WEAPON_EXTRA_ATTACK = systemActionAsRuleDefinition(
  SYSTEM_ACTION_IDS.lightExtraAttack,
  {
    activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
    effects: [{
      ability: 'auto',
      attack_kind: 'weapon_melee',
      resolution: 'attack_roll',
      vs: 'ac',
      tags: ['light_property_extra_attack'],
      on_hit: [{ ability: 'none', dice: 'weapon', kind: 'damage', type: 'weapon' }],
    }],
  },
);

const CORE_STUDY_WORLD_OBJECT_ACTION: RuleActionDefinition = {
  id: 'core.action.study-world-object',
  name: 'Study',
  kind: 'nonSpell',
  sourceEntityIds: ['core:dnd5e-2024:action:study'],
  mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] } },
};

const CORE_PHYSICAL_WORLD_INTERACTION: RuleActionDefinition = {
  id: 'core.interaction.physical-world-object',
  name: 'Physical interaction',
  kind: 'nonSpell',
  sourceEntityIds: ['core:dnd5e-2024:interaction:physical-object'],
  mechanics: { activation: { mode: 'active', cost: [] } },
};

const CORE_WORLD_TIME_ACTION: RuleActionDefinition = {
  id: 'core.system.world-time',
  name: 'World time',
  kind: 'nonSpell',
  sourceEntityIds: ['core:dnd5e-2024:time:combat-round'],
  mechanics: { activation: { mode: 'system', cost: [] } },
};

const ALERT_INITIATIVE_SWAP_CAPABILITY = 'alert.initiative_swap';
function observableFactProvenanceIssue(facts: unknown): string | null {
  if (!facts || typeof facts !== 'object') return 'Observable event requires explicit facts';
  const record = facts as Record<string, unknown>;
  if (!['scenario', 'board', 'gm_ruling'].includes(String(record.factsSource ?? ''))) {
    return 'Observable facts require a recognized source';
  }
  if (!Number.isInteger(record.boardRevision) || Number(record.boardRevision) < 0) {
    return 'Observable facts require a non-negative board revision';
  }
  return null;
}

function noiseFactsIssue(facts: unknown): string | null {
  const provenance = observableFactProvenanceIssue(facts);
  if (provenance) return provenance;
  const record = facts as Record<string, unknown>;
  if (!['whisper_or_quieter', 'above_whisper'].includes(String(record.loudness ?? ''))) {
    return 'Noise facts require a canonical loudness';
  }
  return null;
}

function enemyFindingFactsIssue(facts: unknown): [CommandRejectionCode, string] | null {
  const provenance = observableFactProvenanceIssue(facts);
  if (provenance) return ['InvalidFacts', provenance];
  const record = facts as Record<string, unknown>;
  if (record.relation !== 'enemy') {
    return ['IllegalRelation', 'Only an enemy finding the actor ends Hide'];
  }
  if (record.found !== true) {
    return ['InvalidFacts', 'FindHiddenActor requires a positive finding fact'];
  }
  return null;
}

function initiativeSwapFactsIssue(
  facts: unknown,
  allyControllerId: string,
): [CommandRejectionCode, string] | null {
  const provenance = observableFactProvenanceIssue(facts);
  if (provenance) return ['InvalidFacts', provenance];
  const record = facts as Record<string, unknown>;
  if (record.relation !== 'ally') {
    return ['IllegalRelation', 'Alert can swap Initiative only with an ally'];
  }
  if (record.willing !== true || record.confirmedByControllerId !== allyControllerId) {
    return ['InvalidFacts', 'Alert requires explicit consent from the ally controller'];
  }
  return null;
}

function hazardDefinitionIssue(hazard: RuleHazardDefinition): string | null {
  const raw = hazard as unknown as Record<string, unknown>;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(raw.id ?? ''))) return 'Hazard id must be stable';
  if (typeof raw.name !== 'string' || !raw.name.trim()) return `${String(raw.id ?? 'hazard')} must have a name`;
  if (hazard.sourceKind !== 'environment' && hazard.sourceKind !== 'system') {
    return `${hazard.id} has an invalid source kind`;
  }
  if (hazard.sourceActorId !== undefined && (typeof hazard.sourceActorId !== 'string' || !hazard.sourceActorId.trim()
    || hazard.resolution !== 'automatic')) return `${hazard.id} has an invalid actor origin`;
  if (!Array.isArray(hazard.sourceEntityIds) || hazard.sourceEntityIds.length === 0
    || hazard.sourceEntityIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    return `${hazard.id} must have at least one stable sourceEntityId`;
  }
  if (new Set(hazard.sourceEntityIds).size !== hazard.sourceEntityIds.length) {
    return `${hazard.id} contains duplicate sourceEntityIds`;
  }
  if (hazard.resolution === 'automatic') {
    if (hazard.damageSourceKind !== undefined && !['item','spell','ability'].includes(hazard.damageSourceKind)) return `${hazard.id} has invalid damage source kind`;
    if (!Array.isArray(hazard.effects) || hazard.effects.length === 0) {
      return `${hazard.id} must define at least one automatic consequence`;
    }
    if (hazard.grantedEffects != null && (typeof hazard.grantedEffects !== 'object'
      || Array.isArray(hazard.grantedEffects))) return `${hazard.id} has invalid granted effects`;
    return null;
  }
  const save = raw.save as Record<string, unknown> | undefined;
  if (!save || !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(String(save.ability ?? ''))) {
    return `${hazard.id} has an invalid saving throw ability`;
  }
  if (!Number.isInteger(save.dc) || Number(save.dc) < 1 || Number(save.dc) > 30) {
    return `${hazard.id} has an invalid saving throw DC`;
  }
  if (!Array.isArray(hazard.onFailure) || hazard.onFailure.length === 0) {
    return `${hazard.id} must define at least one failure consequence`;
  }
  if (hazard.onSuccess != null && !Array.isArray(hazard.onSuccess)) {
    return `${hazard.id} has invalid success consequences`;
  }
  if (hazard.grantedEffects != null && (typeof hazard.grantedEffects !== 'object'
    || Array.isArray(hazard.grantedEffects))) return `${hazard.id} has invalid granted effects`;
  return null;
}

function cloneHazard(hazard: RuleHazardDefinition): RuleHazardDefinition {
  return JSON.parse(JSON.stringify(hazard)) as RuleHazardDefinition;
}

function hazardSourceId(hazard: RuleHazardDefinition): string {
  return hazard.sourceActorId ?? `${hazard.sourceKind}:${hazard.id}`;
}

function hazardObligationIds(hazard: RuleHazardDefinition): string[] {
  return [...new Set([
    `hazard:${hazard.id}`,
    ...hazard.sourceEntityIds.map((id) => `entity:${id}`),
    ...(hazard.resolution === 'automatic'
      ? ['system:hazard-resolution']
      : ['system:hazard-save', 'system:pending-resolution']),
  ])];
}

function hazardAvoidedConditions(hazard: RuleHazardDefinition): string[] {
  if (hazard.resolution !== 'save') return [];
  return hazard.onFailure.flatMap((payload) => (
    payload.kind === 'condition' && payload.value != null ? [String(payload.value)] : []
  ));
}

function actionDeclaredEvent(input: {
  actorId: string;
  action: RuleActionDefinition;
  targetIds: string[];
  timing: 'active' | 'reaction';
  spell?: CanonicalSpellContext;
  facts?: Record<string, unknown>;
  obligationIds: string[];
}): EventInput {
  const { actorId, action, targetIds, timing, spell, facts, obligationIds } = input;
  return {
    sourceActorId: actorId,
    obligationIds,
    payload: {
      type: 'ActionDeclared',
      actorId,
      actionId: action.id,
      actionKind: action.kind,
      sourceEntityIds: [...action.sourceEntityIds],
      targetIds: [...targetIds],
      timing,
      ...(facts ? { facts } : {}),
      ...(action.kind === 'spell' && spell ? {
        spell: {
          baseLevel: spell.baseLevel,
          castLevel: spell.castLevel,
          ...(spell.school ? { school: spell.school } : {}),
          concentration: action.concentration === true,
          ...(action.spell.sourceClass ? { sourceClass: action.spell.sourceClass } : {}),
          ...(spell.components ? { components: { ...spell.components } } : {}),
          ...(spell.grantId ? { grantId: spell.grantId } : {}),
          ...(spell.sourceId ? { sourceId: spell.sourceId } : {}),
          ...(spell.spellcastingAbility ? { spellcastingAbility: spell.spellcastingAbility } : {}),
          ...(spell.fixedSpellcastingModifier !== undefined ? { fixedSpellcastingModifier: spell.fixedSpellcastingModifier } : {}),
          ...(spell.mode ? { mode: spell.mode } : {}),
          ...(spell.payment ? { payment: { ...spell.payment } } : {}),
          ...(spell.castingTimeAddedSeconds !== undefined
            ? { castingTimeAddedSeconds: spell.castingTimeAddedSeconds }
            : {}),
          ...(spell.baseCastingTimeSeconds !== undefined
            ? { baseCastingTimeSeconds: spell.baseCastingTimeSeconds }
            : {}),
          ...(spell.focusObjectId ? { focusObjectId: spell.focusObjectId } : {}),
          ...(spell.focusHand ? { focusHand: spell.focusHand } : {}),
        },
      } : {}),
    },
  };
}

function actorContext(actor: ActorState): CharacterContext & { selfId: string; passives?: Record<string, unknown>[]; grantedEffects?:ExecuteContext['grantedEffects'] } {
  return { ...actor.character, selfId: actor.id, grantedEffects:actor.grantedEffects, ...(actor.passives?.length ? { passives: actor.passives } : {}) };
}

/**
 * Keep formula-backed passive modifiers on the same character projection as
 * action execution.  Supplying only the roll kind made literal modifiers work
 * while silently dropping expressions such as `max(1,wis)`.
 */
function actorFormulaContext(character: CharacterContext) {
  return {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
    spellcastingMod: character.spellcastingMod,
    characterSpeed: character.characterSpeed,
    variables: character.variables,
  };
}

/**
 * Return provenance only for passives whose declared mechanics contribute to
 * this exact roll query. Active effects are deliberately removed from the
 * isolated query, so one unrelated runtime modifier cannot authorize every
 * passive's source identifiers.
 */
function passiveModifierSourceEntityIds(
  actor: ActorState,
  options: Parameters<typeof collectRollModifiers>[2],
): string[] {
  const passiveOnlyRuntime = { ...actor.runtime, activeEffects: [] };
  return (actor.passives ?? []).flatMap((passive) => {
    if (!stableSourceEntityIds(passive.sourceEntityIds)) return [];
    const result = collectRollModifiers(passiveOnlyRuntime, [passive], options);
    const contributes = result.modifiers.length > 0
      || result.ops.length > 0
      || result.rules.length > 0
      || result.hasAdvantage
      || result.hasDisadvantage
      || result.autoFail
      || result.denied;
    return contributes ? [...passive.sourceEntityIds] : [];
  });
}


/** Runtime transformations (for example Goliath Large Form) must participate
 * in every relative-size rule, not only in the sheet projection. */
function effectiveActorSize(actor: ActorState, runtime = actor.runtime): number | undefined {
  const declared = actor.attackProfile?.size;
  if (!Number.isInteger(declared)) return undefined;
  const withoutTransient = { ...runtime, activeEffects: [] };
  const baseline = breakdownValue('size', actor.character, withoutTransient, actor.passives ?? []).value;
  const projected = breakdownValue('size', actor.character, runtime, actor.passives ?? []).value;
  return declared! + (projected - baseline);
}

function actionContext(
  source: ActorState,
  env: DeterministicEnvironment,
  target?: ActorState,
  targetRuntime = target?.runtime,
  facts?: SpatialFacts,
  spell?: SpellCastContext,
): ExecuteContext & { passives?: Record<string, unknown>[] } {
  source={...source,character:liveCharacter(source)};
  if(target)target={...target,character:projectRuntimeCharacter(target.character,targetRuntime??target.runtime,target.passives??[])};
  const spellcastingAbility = spell?.spellcastingAbility;
  const character = spell?.fixedSpellcastingModifier !== undefined
    ? { ...source.character, spellcastingMod: spell.fixedSpellcastingModifier }
    : spellcastingAbility
    ? {
      ...source.character,
      spellcastingAbility,
      spellcastingMod: liveCharacter(source).abilityMods[spellcastingAbility] ?? 0,
    }
    : source.character;
  return {
    character,
    selfRuntime: source.runtime,
    deferConcentrationSaves:true,
    selfId: source.id,
    passives: source.passives,
    conditionImmunities: source.traits?.conditionImmunities,
    grantedEffects: source.grantedEffects,
    masteryEffects: source.masteryEffects,
    rng: env.rng,
    nextId: env.nextId,
    ...(facts ? {attackFacts: {nearbyEligibleAllyToTarget: facts.nearbyEligibleAllyToTarget,
      attackFromBehind:facts.attackFromBehind,
      immediateStraightMovementFt: facts.immediateStraightMovementFt}} : {}),
    ...(facts?.positionExchangeValidated ? {positionExchangeValidated: true as const} : {}),
    ...(facts?.commandedAttackValidated ? {commandedAttackValidated: true as const} : {}),
    ...(facts?.maneuveringMovementValidated ? {maneuveringMovementValidated: true as const} : {}),
    ...(target && facts ? {
      // Relational condition clauses consume the same board/GM observations as
      // targeting. The executor receives facts, never a condition-specific UI
      // flag, and fails closed when an observation is absent.
      conditionSourceFacts: {
        [target.id]: { lineOfSight: facts.lineOfSight },
      },
      conditionRelationFacts: {
        distancesFt: {
          [source.id]: { [target.id]: facts.distanceFt },
          [target.id]: { [source.id]: facts.distanceFt },
        },
        visibility: {
          [source.id]: { [target.id]: facts.canSeeTarget ?? true },
          [target.id]: { [source.id]: facts.targetCanSeeSource ?? true },
        },
      },
    } : {}),
    ...(target ? {
      target: {
        id: target.id,
        actorKind: target.kind,
        checkMods:actorCheckMods(target),
        ...(Number.isInteger(effectiveActorSize(target, targetRuntime))
          ? { size: effectiveActorSize(target, targetRuntime)! }
          : {}),
        ac: effectiveArmorClass(target, targetRuntime ?? target.runtime),
        acBreakdown: effectiveArmorClassBreakdown(target, targetRuntime ?? target.runtime),
        characterContext: target.character,
        passives: target.passives,
        conditionImmunities: target.traits?.conditionImmunities,
        sleepRequired: target.traits?.restProfile?.sleepRequired,
        sleepTraitSourceEntityIds: target.traits?.restProfile?.sourceEntityIds,
        ...(facts ? { relationToSource: facts.relation } : {}),
        // A self target shares the source runtime. Leaving runtimeState unset
        // makes the legacy executor route `who:target` payloads into `state`
        // instead of creating a second, conflicting copy of the same actor.
        ...(targetRuntime && target.id !== source.id ? { runtimeState: targetRuntime } : {}),
      },
    } : {}),
  };
}

function engineTrace(
  actorId: string,
  targetIds: string[],
  events: EngineEvent[],
  obligationIds: string[],
  audit?: { sourceActorId?: string; facts?: Record<string, unknown> },
): EventInput[] {
  return events.map((event) => ({
    sourceActorId: audit?.sourceActorId ?? actorId,
    obligationIds,
    payload: {
      type: 'EngineEventRecorded',
      actorId,
      targetIds: event.type === 'effect_applied' && event.ownerActorId ? [event.ownerActorId] : targetIds,
      event,
      ...(audit?.facts ? { facts: audit.facts } : {}),
    },
  }));
}

function damageAdjustmentAudit(
  events: readonly EngineEvent[],
): Array<{
  damageType: string;
  adjustment: 'resistance' | 'immunity' | 'vulnerability';
  before: number;
  after: number;
  sourceEntityIds: string[];
}> {
  return events.flatMap((event) => (
    event.type === 'narrative' && event.damageAdjustment
      ? [{
        ...event.damageAdjustment,
        sourceEntityIds: [...event.damageAdjustment.sourceEntityIds],
      }]
      : []
  ));
}

function differs(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function runtimePatch(before: ActorState['runtime'], after: ActorState['runtime']): ActorRuntimePatch {
  const patch: ActorRuntimePatch = {};
  if (differs(before.deathSaves, after.deathSaves)) patch.deathSaves = after.deathSaves ?? emptyDeathSaves();
  if (differs(before.hp, after.hp)) patch.hp = after.hp;
  if (differs(before.resources, after.resources)) patch.resources = after.resources;
  if (differs(before.maxResources, after.maxResources)) patch.maxResources = after.maxResources;
  if (differs(before.equipment, after.equipment)) patch.equipment = after.equipment;
  if (differs(before.inventory, after.inventory)) patch.inventory = after.inventory;
  if (differs(before.activeEffects, after.activeEffects)) patch.activeEffects = after.activeEffects;
  if (differs(before.firedThisTurn, after.firedThisTurn)) patch.firedThisTurn = after.firedThisTurn ?? null;
  if (differs(before.firedThisRest, after.firedThisRest)) patch.firedThisRest = after.firedThisRest ?? null;
  if (differs(before.firedByPeriod, after.firedByPeriod)) patch.firedByPeriod = after.firedByPeriod ?? null;
  if (differs(before.eventOccurrences, after.eventOccurrences)) patch.eventOccurrences = after.eventOccurrences ?? null;
  if (differs(before.turnMovementFt, after.turnMovementFt)) patch.turnMovementFt = after.turnMovementFt ?? 0;
  if (before.encounterActive !== after.encounterActive) patch.encounterActive = after.encounterActive === true;
  // Regaining HP ends this dying episode, regardless of which entity healed.
  if(before.hp.current===0 && after.hp.current>0 && !after.deathSaves?.dead){
    patch.deathSaves=emptyDeathSaves();
    patch.firedThisTurn=(after.firedThisTurn??[]).filter(id=>id!=='system:death-save-due');
  }
  return patch;
}

function runtimeTransition(
  sourceActorId: string,
  actorId: string,
  before: ActorState['runtime'],
  after: ActorState['runtime'],
  reason: 'start_turn' | 'end_turn' | 'action' | 'ability_check' | 'hazard' | 'short_rest' | 'long_rest' | 'boon',
  obligationIds: string[],
): EventInput[] {
  const patch = runtimePatch(before, after);
  if (!Object.keys(patch).length) return [];
  return [{
    sourceActorId,
    obligationIds,
    payload: { type: 'ActorRuntimePatched', actorId, patch, reason },
  }];
}

function sourceTurnBoundary(
  world: WorldState,
  sourceActorId: string,
  boundary: 'start' | 'end',
): { runtimes: Map<string, ActorState['runtime']>; events: EventInput[] } {
  const runtimes = new Map<string, ActorState['runtime']>();
  const events: EventInput[] = [];
  const obligations = ['system:source-turn-expiry', `system:source-turn-${boundary}`];
  const owners = Object.values(world.actors).sort((left, right) => left.id.localeCompare(right.id));

  for (const owner of owners) {
    const transition = applySourceTurnBoundary(owner.runtime, {
      sourceActorId,
      ownerActorId: owner.id,
      boundary,
    });
    if (!transition.changed) continue;
    const after = transition.state;
    runtimes.set(owner.id, after);
    events.push(...runtimeTransition(
      sourceActorId,
      owner.id,
      owner.runtime,
      after,
      boundary === 'start' ? 'start_turn' : 'end_turn',
      obligations,
    ));
    events.push(...engineTrace(owner.id, [owner.id], transition.events, obligations, {
      sourceActorId,
      facts: { sourceActorId, ownerActorId: owner.id, boundary },
    }));
  }
  return { runtimes, events };
}

function concentrationLinkedEffectIds(
  before: ActorState['runtime'],
  after: ActorState['runtime'],
): string[] {
  const beforeIds = new Set(before.activeEffects.map((effect) => effect.id));
  return after.activeEffects.flatMap((effect) => {
    if (beforeIds.has(effect.id)) return [];
    const mechanics = effect.mechanics as Record<string, unknown>;
    const duration = mechanics.duration as Record<string, unknown> | undefined;
    return duration?.concentration === true ? [effect.id] : [];
  });
}

function mergeConcentrationEffectLinks(
  ...groups: ReadonlyArray<readonly ConcentrationEffectLink[]>
): ConcentrationEffectLink[] {
  const unique = new Map<string, ConcentrationEffectLink>();
  for (const link of groups.flat()) unique.set(`${link.actorId}\u0000${link.effectId}`, { ...link });
  return [...unique.values()].sort((left, right) => (
    left.actorId.localeCompare(right.actorId) || left.effectId.localeCompare(right.effectId)
  ));
}

function concentrationWorldObjectCleanup(
  world: WorldState,
  concentration: WorldState['concentrations'][string],
  obligations: readonly string[],
): EventInput[] {
  return Object.values(world.objects)
    .filter((object) => (
      object.sourceActorId === concentration.sourceActorId
      && object.sourceActionId === concentration.actionId
      && object.dancingLight !== undefined
    ))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((object) => ({
      sourceActorId: concentration.sourceActorId,
      obligationIds: [...new Set([
        ...obligations,
        'system:world-object',
        'system:dancing-lights',
        'system:concentration',
      ])],
      payload: {
        type: 'WorldObjectMutationRecorded' as const,
        event: {
          type: 'WorldObjectRemoved' as const,
          objectId: object.id,
          reason: 'concentration_ended',
        },
      },
    }));
}

/**
 * A concentration spell can own a modifier that explicitly ends after the
 * matching roll (Guidance is the L1 acceptance example).  Consuming that
 * modifier ends the spell, so the concentration ledger and every sibling
 * effect must be removed in the same committed command.
 */
function removeConcentrationEffects(actor: ActorState, before: ActorState['runtime'], ids: ReadonlySet<string>, env: DeterministicEnvironment) {
  const stripped = { ...before, activeEffects: before.activeEffects.filter(effect => !ids.has(effect.id)) };
  const ended = reconcileEndedEffects(before, stripped, actionContext({ ...actor, runtime: before }, env), executeAction);
  return { ...ended, state: reconcileTemporaryResourceGrants(before, ended.state, actorContext(actor)) };
}

function consumedConcentrationLifecycle(input: {
  env: DeterministicEnvironment;
  world: WorldState;
  actingActorId: string;
  changedActorId: string;
  before: ActorState['runtime'];
  after: ActorState['runtime'];
  obligations: string[];
}): { transitions: EventInput[]; lifecycle: EventInput[] } {
  const changedActor = input.world.actors[input.changedActorId];
  const consumed = reconcileEndedEffects(input.before, input.after,
    actionContext({ ...changedActor, runtime: input.before }, input.env), executeAction);
  const after = reconcileTemporaryResourceGrants(input.before, consumed.state, actorContext(changedActor));
  const afterIds = new Set(input.after.activeEffects.map((effect) => effect.id));
  const removedIds = new Set(input.before.activeEffects
    .filter((effect) => !afterIds.has(effect.id))
    .map((effect) => effect.id));
  const concentrations = Object.values(input.world.concentrations)
    .filter((concentration) => concentration.effectLinks.some((link) => (
      link.actorId === input.changedActorId && removedIds.has(link.effectId)
    )))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!concentrations.length) {
    return {
      transitions: runtimeTransition(
        input.actingActorId,
        input.changedActorId,
        input.before,
        after,
        'ability_check',
        input.obligations,
      ),
      lifecycle: engineTrace(input.actingActorId, [input.changedActorId], consumed.events, input.obligations),
    };
  }

  const obligations = [...new Set([
    ...input.obligations,
    'system:concentration-effect-consumed',
  ])];
  const runtimes = new Map<string, ActorState['runtime']>([
    [input.changedActorId, after],
  ]);
  const lifecycle: EventInput[] = engineTrace(input.actingActorId, [input.changedActorId], consumed.events, obligations);

  for (const concentration of concentrations) {
    for (const link of concentration.effectLinks) {
      const linkedActor = input.world.actors[link.actorId];
      if (!linkedActor) continue;
      const current = runtimes.get(link.actorId) ?? linkedActor.runtime;
      const linkedEffect = current.activeEffects.find((effect) => effect.id === link.effectId);
      if (!linkedEffect) continue;
      const ended = removeConcentrationEffects(linkedActor, current, new Set([link.effectId]), input.env);
      runtimes.set(link.actorId, ended.state);
      lifecycle.push(...engineTrace(concentration.sourceActorId, [link.actorId], ended.events, obligations));
      lifecycle.push(...engineTrace(concentration.sourceActorId, [link.actorId], [{
        type: 'effect_expired',
        name: linkedEffect.name,
      }], obligations));
    }
    lifecycle.push(...concentrationWorldObjectCleanup(input.world, concentration, obligations), {
      sourceActorId: concentration.sourceActorId,
      obligationIds: obligations,
      payload: {
        type: 'ConcentrationCleared',
        sourceActorId: concentration.sourceActorId,
        concentrationId: concentration.id,
        reason: 'effect_consumed',
      },
    });
  }

  const transitions = [...runtimes.entries()].flatMap(([actorId, after]) => {
    const before = input.world.actors[actorId]?.runtime;
    return before
      ? runtimeTransition(
          input.actingActorId,
          actorId,
          before,
          after,
          'ability_check',
          obligations,
        )
      : [];
  });
  return { transitions, lifecycle };
}

function actionStateEvents(input: {
  env: DeterministicEnvironment;
  world: WorldState;
  commandId: string;
  source: ActorState;
  action: RuleActionDefinition;
  sourceAfter: ActorState['runtime'];
  target?: ActorState;
  targetAfter?: ActorState['runtime'];
  targetUpdates?: Array<{ target: ActorState; targetAfter: ActorState['runtime'] }>;
  additionalConcentrationEffectLinks?: ConcentrationEffectLink[];
  manageConcentration?: boolean;
  /** The world primitive already emitted exact replacement removals in this command. */
  skipReplacedConcentrationWorldObjectCleanup?: boolean;
  obligations: string[];
}): EventInput[] {
  const { world, commandId, source, action, target, obligations } = input;
  const targetUpdates = [
    ...(target && input.targetAfter ? [{ target, targetAfter: input.targetAfter }] : []),
    ...(input.targetUpdates ?? []),
  ];
  const runtimes = new Map<string, ActorState['runtime']>([[source.id, input.sourceAfter]]);
  for (const update of targetUpdates) runtimes.set(update.target.id, update.targetAfter);
  const lifecycleEvents: EventInput[] = [];

  if (action.concentration && input.manageConcentration !== false) {
    const old = world.concentrations[source.id];
    if (old) {
      const expired: EngineEvent[] = [];
      for (const link of old.effectLinks) {
        const actor = world.actors[link.actorId];
        if (!actor) continue;
        const current = runtimes.get(link.actorId) ?? actor.runtime;
        const removed = current.activeEffects.find((effect) => effect.id === link.effectId);
        if (!removed) continue;
        const ended = removeConcentrationEffects(actor, current, new Set([link.effectId]), input.env);
        runtimes.set(link.actorId, ended.state);
        expired.push(...ended.events);
        expired.push({ type: 'effect_expired', name: removed.name });
      }
      if (expired.length) lifecycleEvents.push(...engineTrace(source.id, [], expired, obligations));
      lifecycleEvents.push(
        ...(input.skipReplacedConcentrationWorldObjectCleanup
          ? []
          : concentrationWorldObjectCleanup(
              world,
              old,
              [...obligations, 'system:concentration-replace'],
            )),
        {
        sourceActorId: source.id,
        obligationIds: [...obligations, 'system:concentration-replace'],
        payload: {
          type: 'ConcentrationCleared',
          sourceActorId: source.id,
          concentrationId: old.id,
          reason: 'replaced',
        },
      });
    }

    const candidateLinks = [
      ...(input.additionalConcentrationEffectLinks ?? []),
      ...concentrationLinkedEffectIds(source.runtime, input.sourceAfter)
        .map((effectId) => ({ actorId: source.id, effectId })),
      ...targetUpdates.flatMap((update) => (
        concentrationLinkedEffectIds(update.target.runtime, update.targetAfter)
          .map((effectId) => ({ actorId: update.target.id, effectId }))
      )),
    ];
    const links = [...new Map(candidateLinks.map((link) => (
      [`${link.actorId}\u0000${link.effectId}`, link] as const
    ))).values()].sort((left, right) => left.actorId.localeCompare(right.actorId)
      || left.effectId.localeCompare(right.effectId));
    lifecycleEvents.push({
      sourceActorId: source.id,
      obligationIds: [...obligations, 'system:concentration-start'],
      payload: {
        type: 'ConcentrationSet',
        concentration: {
          id: `${commandId}:concentration`,
          sourceActorId: source.id,
          actionId: action.id,
          startedAtRevision: world.revision,
          effectLinks: links,
        },
      },
    });
  }

  // PHB 2024: becoming Incapacitated ends concentration immediately.  Detect
  // this from the post-action runtime, remove every linked effect in the same
  // transaction, and make the reason replay-visible.
  for (const [actorId, after] of [...runtimes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const concentratingActor = world.actors[actorId];
    const concentration = world.concentrations[actorId];
    if (!concentratingActor || !concentration) continue;
    if(concentrationProtectedUntilDeath(after,concentratingActor.passives??[]))continue;
    if (!deniedCapabilities(after, concentratingActor.passives ?? []).has('concentration')) continue;

    for (const link of concentration.effectLinks) {
      const linkedActor = world.actors[link.actorId];
      if (!linkedActor) continue;
      const current = runtimes.get(link.actorId) ?? linkedActor.runtime;
      const removed = current.activeEffects.find((effect) => effect.id === link.effectId);
      if (!removed) continue;
      const ended = removeConcentrationEffects(linkedActor, current, new Set([link.effectId]), input.env);
      runtimes.set(link.actorId, ended.state);
      lifecycleEvents.push(...engineTrace(source.id, [link.actorId], ended.events, obligations));
      lifecycleEvents.push(...engineTrace(source.id, [link.actorId], [{
        type: 'effect_expired',
        name: removed.name,
      }], [...obligations, 'system:concentration-incapacitated']));
    }
    lifecycleEvents.push(...concentrationWorldObjectCleanup(
      world,
      concentration,
      [...obligations, 'system:concentration-incapacitated'],
    ), {
      sourceActorId: source.id,
      obligationIds: [...obligations, 'system:concentration-incapacitated'],
      payload: {
        type: 'ConcentrationCleared',
        sourceActorId: actorId,
        concentrationId: concentration.id,
        reason: 'incapacitated',
      },
    });
  }

  const transitions = [...runtimes.entries()].flatMap(([actorId, after]) => {
    const before = world.actors[actorId]?.runtime;
    return before ? runtimeTransition(source.id, actorId, before, after, 'action', obligations) : [];
  });
  return [...transitions, ...lifecycleEvents];
}

function damageTaken(before: ActorState['runtime'], after: ActorState['runtime']): number {
  const beforeTotal = before.hp.current + before.hp.temp;
  const afterTotal = after.hp.current + after.hp.temp;
  return Math.max(0, beforeTotal - afterTotal);
}

function concentrationSaveFollowUp(input: {
  world: WorldState;
  actor: ActorState;
  actorAfter?: ActorState['runtime'];
  obligations: string[];
}): QueuedConcentrationSaveResolution | null {
  const { world, actor, actorAfter, obligations } = input;
  const concentration = world.concentrations[actor.id];
  if (!concentration || !actorAfter) return null;
  if(concentrationProtectedUntilDeath(actorAfter,actor.passives??[]))return null;
  const damage = damageTaken(actor.runtime, actorAfter);
  if (damage <= 0) return null;
  const dc = Math.min(30, Math.max(10, Math.floor(damage / 2)));
  return {
    type: 'concentration_save',
    actorId: actor.id,
    concentrationId: concentration.id,
    damage,
    dc,
    obligationIds: [...new Set([...obligations, 'system:concentration-damage-save'])],
  };
}

function concentrationSaveOpenedEvents(input: {
  world: WorldState;
  commandId: string;
  actor: ActorState;
  actorAfter?: ActorState['runtime'];
  env: DeterministicEnvironment;
  obligations: string[];
  followUps?: PendingResolutionFollowUp[];
}): EventInput[] {
  const { world, actor, commandId, env } = input;
  const continuation = concentrationSaveFollowUp(input);
  if (!continuation) return [];
  return [{
    sourceActorId: actor.id,
    obligationIds: continuation.obligationIds,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: env.nextId(),
        type: 'concentration_save',
        openedByCommandId: commandId,
        openedAtRevision: world.revision,
        deadlineLogicalClock: world.logicalClock + 10,
        actorId: actor.id,
        concentrationId: continuation.concentrationId,
        damage: continuation.damage,
        request: {
          id: env.nextId(),
          type: 'saving_throw',
          actorId: actor.id,
          ability: 'con',
          dc: continuation.dc,
          avoidsConditions: [],
        },
        ...(input.followUps?.length ? { followUps: input.followUps } : {}),
      },
    },
  }];
}

function masterySaveObligationIds(continuation: QueuedMasterySaveResolution): string[] {
  return [
    `entity:${continuation.actionId}`,
    `entity:${continuation.mastery.sourceEntityId}`,
    'system:weapon-mastery',
    'system:target-save',
    'system:pending-resolution',
  ];
}

function queuedMasterySaves(input: {
  deferred: readonly DeferredTargetSave[] | undefined;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
}): QueuedMasterySaveResolution[] {
  return (input.deferred ?? []).flatMap((offer) => {
    if (offer.source.kind !== 'weapon_mastery') return [];
    return [{
      type: 'mastery_save' as const,
      sourceActorId: input.sourceActorId,
      targetActorId: input.targetActorId,
      actionId: input.actionId,
      mastery: {
        sourceEntityId: offer.source.entityId,
        name: offer.source.name,
        effect: JSON.parse(JSON.stringify(offer.effect)) as Record<string, unknown>,
        ...(offer.source.weaponMod == null ? {} : { weaponMod: offer.source.weaponMod }),
      },
      save: {
        ability: offer.ability,
        dc: offer.dc,
        avoidsConditions: [...offer.avoidsConditions],
      },
    }];
  });
}

function masterySaveOpenedEvent(input: {
  world: WorldState;
  commandId: string;
  continuation: QueuedMasterySaveResolution;
  followUps: PendingResolutionFollowUp[];
  env: DeterministicEnvironment;
}): EventInput {
  const { world, commandId, continuation, followUps, env } = input;
  const obligations = masterySaveObligationIds(continuation);
  return {
    sourceActorId: continuation.sourceActorId,
    obligationIds: obligations,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        ...continuation,
        id: env.nextId(),
        openedByCommandId: commandId,
        openedAtRevision: world.revision,
        deadlineLogicalClock: world.logicalClock + 10,
        request: {
          id: env.nextId(),
          type: 'saving_throw',
          actorId: continuation.targetActorId,
          ability: continuation.save.ability,
          dc: continuation.save.dc,
          avoidsConditions: [...continuation.save.avoidsConditions],
        },
        followUps,
      },
    },
  };
}

function followUpOpenedEvents(input: {
  world: WorldState;
  commandId: string;
  followUps: readonly PendingResolutionFollowUp[];
  env: DeterministicEnvironment;
  invalidConcentrationIds?: ReadonlySet<string>;
}): EventInput[] {
  const { world, commandId, env } = input;
  const remaining = [...input.followUps];
  while (remaining.length) {
    const next = remaining.shift()!;
    if (next.type === 'mastery_save') {
      if (!world.actors[next.sourceActorId] || !world.actors[next.targetActorId]) continue;
      return [masterySaveOpenedEvent({ world, commandId, continuation: next, followUps: remaining, env })];
    }
    const concentration = world.concentrations[next.actorId];
    if (!concentration || concentration.id !== next.concentrationId
      || input.invalidConcentrationIds?.has(next.concentrationId)) continue;
    return [{
      sourceActorId: next.actorId,
      obligationIds: next.obligationIds,
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: env.nextId(),
          type: 'concentration_save',
          openedByCommandId: commandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          actorId: next.actorId,
          concentrationId: next.concentrationId,
          damage: next.damage,
          request: {
            id: env.nextId(),
            type: 'saving_throw',
            actorId: next.actorId,
            ability: 'con',
            dc: next.dc,
            avoidsConditions: [],
          },
          ...(remaining.length ? { followUps: remaining } : {}),
        },
      },
    }];
  }
  return [];
}

function attackFollowUpEvents(input: {
  world: WorldState;
  commandId: string;
  source: ActorState;
  sourceAfter?: ActorState['runtime'];
  target: ActorState;
  targetAfter?: ActorState['runtime'];
  action: RuleActionDefinition;
  deferred: readonly DeferredTargetSave[] | undefined;
  env: DeterministicEnvironment;
  obligations: string[];
}): EventInput[] {
  const masterySaves = queuedMasterySaves({
    deferred: input.deferred,
    sourceActorId: input.source.id,
    targetActorId: input.target.id,
    actionId: input.action.id,
  });
  const concentration = concentrationSaveFollowUp({
    world: input.world,
    actor: input.target,
    actorAfter: input.targetAfter,
    obligations: input.obligations,
  });
  const sourceConcentration = concentrationSaveFollowUp({
    world: input.world,
    actor: input.source,
    actorAfter: input.sourceAfter,
    obligations: input.obligations,
  });
  const queue: PendingResolutionFollowUp[] = [
    ...masterySaves,
    ...(concentration ? [concentration] : []),
    ...(sourceConcentration && (!concentration || input.source.id!==input.target.id) ? [sourceConcentration] : []),
  ];
  return followUpOpenedEvents({
    world: input.world,
    commandId: input.commandId,
    followUps: queue,
    env: input.env,
  });
}

function executeWorldActionPrimitive(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const primitive = worldActionPrimitive(action);
  if (!primitive) {
    return command.worldInput
      ? rejected(world, 'InvalidFacts', `${action.id} does not accept world-object input`)
      : [];
  }
  // Actor creation is owned by the tactical adapter, which has the placement
  // grid. Rules core still validates, pays, starts concentration and audits
  // this command through externalPrimitiveHandled.
  if (primitive === 'owned_summon') {
    return command.worldInput
      ? rejected(world, 'InvalidFacts', `${action.id} does not accept world-object input`)
      : [];
  }
  const parsedPolicy = parseWorldSpellPolicy(action.mechanics);
  if (parsedPolicy.status === 'invalid') {
    return rejected(world, 'InvalidActionDefinition', `${action.id}: ${parsedPolicy.issue}`);
  }
  const managedPolicy = parsedPolicy.status === 'valid' ? parsedPolicy : null;
  const source = world.actors[command.actorId];
  const payable = canPay(source.runtime, activationCost(action));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  if (primitive === 'detect_magic_world_sensing'
    || primitive === 'detect_poison_disease_world') {
    return command.worldInput
      ? rejected(
          world,
          'InvalidFacts',
          `${action.name} casting does not accept observation input`,
        )
      : [];
  }

  try {
    if(primitive==='item_tool'){bindItemTool(world,action,command.worldInput,command.actorId);return [];}
    if (primitive === 'item_light') {
      if (command.worldInput) return rejected(world, 'InvalidFacts', 'An item light uses its canonical inventory source');
      return worldObjectEvents(source.id, action, itemLightEvents({ actor: source, objects: world.objects, mechanics: action.mechanics, actionId: action.id, name: action.name, nextId: env.nextId }), 'system:item-light');
    }
    if (primitive === 'light_world_object') {
      if (command.worldInput?.type !== 'target_object') {
        return rejected(world, 'InvalidFacts', 'Light requires one explicit target-object input');
      }
      if (!world.objects[command.worldInput.objectId]) {
        return rejected(
          world,
          'WorldObjectNotFound',
          `Unknown world object ${command.worldInput.objectId}`,
        );
      }
      const issue = worldObjectFactsIssue(command.worldInput.facts);
      if (issue) return rejected(world, 'InvalidFacts', issue);
      const result = attachLight({
        objects: world.objects,
        targetObjectId: command.worldInput.objectId,
        facts: command.worldInput.facts,
        sourceActorId: source.id,
        sourceActionId: action.id,
        attachmentId: env.nextId(),
        policy: managedPolicy!.policy as LightWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:light-illumination');
    }

    if (primitive === 'minor_illusion_world_object') {
      if (command.worldInput?.type !== 'minor_illusion') {
        return rejected(world, 'InvalidFacts', 'Minor Illusion requires explicit sound or image input');
      }
      if (typeof command.worldInput.description !== 'string'
        || (command.worldInput.form !== 'sound' && command.worldInput.form !== 'image')) {
        return rejected(world, 'InvalidFacts', 'Minor Illusion input is malformed');
      }
      const factsIssue = creationTargetingFactsIssue(
        command.worldInput.facts,
        managedPolicy!.targeting,
      );
      if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
      const result = createMinorIllusion({
        objects: world.objects,
        id: env.nextId(),
        sourceActorId: source.id,
        sourceActionId: action.id,
        form: command.worldInput.form,
        description: command.worldInput.description,
        spellSaveDc: 8 + liveCharacter(source).profBonus + (command.spell?.fixedSpellcastingModifier ?? (
          command.spell?.spellcastingAbility
            ? liveCharacter(source).abilityMods[command.spell.spellcastingAbility] ?? 0
            : source.character.spellcastingMod ?? 0
        )),
        ...(command.worldInput.imageCubeSideFt === undefined
          ? {}
          : { imageCubeSideFt: command.worldInput.imageCubeSideFt }),
        policy: managedPolicy!.policy as MinorIllusionWorldPolicy,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:minor-illusion');
    }

    if (primitive === 'dancing_lights_world') {
      if (command.worldInput?.type !== 'dancing_lights'
        || !Array.isArray(command.worldInput.placements)
        || (command.worldInput.form !== 'individual'
          && command.worldInput.form !== 'medium_humanoid')) {
        return rejected(world, 'InvalidFacts', 'Dancing Lights requires a canonical placement snapshot');
      }
      const factsIssue = creationTargetingFactsIssue(
        command.worldInput.facts,
        managedPolicy!.targeting,
      );
      if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
      const groupId = env.nextId();
      const result = createDancingLights({
        objects: world.objects,
        groupId,
        sourceActorId: source.id,
        sourceActionId: action.id,
        form: command.worldInput.form,
        placements: command.worldInput.placements.map((placement) => ({
          id: env.nextId(),
          distanceFromCasterFt: placement.distanceFromCasterFt,
          ...(placement.withinRequiredSeparation === undefined
            ? {}
            : { withinRequiredSeparation: placement.withinRequiredSeparation }),
        })),
        policy: managedPolicy!.policy as DancingLightsWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(
        source.id,
        action,
        result.events,
        'system:dancing-lights',
        'system:concentration',
      );
    }

    if (primitive === 'druidcraft_world') {
      if (command.worldInput?.type !== 'druidcraft'
        || !command.worldInput.option
        || typeof command.worldInput.option !== 'object') {
        return rejected(world, 'InvalidFacts', 'Druidcraft requires one canonical option');
      }
      const selected = command.worldInput.option;
      let option: DruidcraftOption;
      switch (selected.kind) {
        case 'weather_sensor':
          option = { ...selected, id: env.nextId() };
          break;
        case 'sensory_effect':
          option = { ...selected, id: env.nextId() };
          break;
        case 'bloom':
        case 'fire_play':
          option = selected;
          break;
        default:
          return rejected(world, 'InvalidFacts', 'Unknown Druidcraft option');
      }
      const result = resolveDruidcraft({
        objects: world.objects,
        sourceActorId: source.id,
        sourceActionId: action.id,
        option,
        policy: managedPolicy!.policy as DruidcraftWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:druidcraft');
    }

    if (primitive === 'mending_world') {
      if (command.worldInput?.type !== 'mending') {
        return rejected(world, 'InvalidFacts', 'Mending requires one touched object');
      }
      if (!world.objects[command.worldInput.objectId]) {
        return rejected(
          world,
          'WorldObjectNotFound',
          `Unknown world object ${command.worldInput.objectId}`,
        );
      }
      const result = mendWorldObject({
        objects: world.objects,
        objectId: command.worldInput.objectId,
        facts: command.worldInput.facts,
        policy: managedPolicy!.policy as MendingWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:mending');
    }

    if (primitive === 'prestidigitation_world') {
      if (command.worldInput?.type !== 'prestidigitation'
        || !command.worldInput.option
        || typeof command.worldInput.option !== 'object') {
        return rejected(world, 'InvalidFacts', 'Prestidigitation requires one canonical option');
      }
      const selected = command.worldInput.option;
      let option: PrestidigitationOption;
      switch (selected.kind) {
        case 'sensory_effect':
          option = { ...selected, id: env.nextId() };
          break;
        case 'minor_sensation':
        case 'magic_mark':
          option = { ...selected, id: env.nextId() };
          break;
        case 'minor_creation':
          option = { ...selected, id: env.nextId() };
          break;
        case 'fire_play':
        case 'clean_or_soil':
          option = selected;
          break;
        default:
          return rejected(world, 'InvalidFacts', 'Unknown Prestidigitation option');
      }
      const result = resolvePrestidigitation({
        objects: world.objects,
        sourceActorId: source.id,
        sourceActionId: action.id,
        option,
        policy: managedPolicy!.policy as PrestidigitationWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:prestidigitation');
    }

    if (primitive === 'purify_food_drink_world') {
      if (command.worldInput?.type !== 'purify_food_drink') {
        return rejected(
          world,
          'InvalidFacts',
          'Purify Food and Drink requires an explicit sphere and object snapshot',
        );
      }
      const validated = validateObjectFactsMap(world, command.worldInput.factsByObject);
      if ('rejection' in validated) return validated.rejection;
      const result = purifyFoodAndDrink({
        objects: world.objects,
        sphereCenterDistanceFt: command.worldInput.sphereCenterDistanceFt,
        factsByObject: validated.factsByObject,
        policy: managedPolicy!.policy as PurifyFoodDrinkWorldPolicy,
        targeting: managedPolicy!.targeting,
      });
      return worldObjectEvents(source.id, action, result.events, 'system:purify-food-drink');
    }

    if (primitive === 'temporary_hp_melee_retaliation') {
      if (action.kind !== 'spell' || !action.spell) {
        return rejected(
          world,
          'InvalidActionDefinition',
          `${action.id} declares slot-scaled retaliation without a spell definition`,
        );
      }
      const armorPolicy = temporaryHpMeleeRetaliationPolicyFromMechanics(
        (action.mechanics.primitive as Record<string, unknown> | undefined),
      );
      if (!armorPolicy) {
        return rejected(world, 'InvalidActionDefinition', `${action.id} has invalid slot-retaliation metadata`);
      }
      const choice = command.choices?.temporary_hp;
      if (choice !== 'take_spell' && choice !== 'keep_current') {
        return rejected(
          world,
          'InvalidDecision',
          'Temporary HP retaliation requires temporary_hp = take_spell or keep_current',
        );
      }
      if (!command.spell?.grantId
        || !command.spell.sourceId
        || !command.spell.payment
        || command.spell.payment.kind === 'none') {
        return rejected(
          world,
          'InvalidSpellDeclaration',
          'Temporary HP retaliation requires an exact source-scoped paid spell grant',
        );
      }
      const paidSlotLevel = command.spell.payment.resource?.match(/_(\d+)$/)?.[1];
      if (command.spell.payment.kind === 'slot'
        && Number(paidSlotLevel) !== command.spell.castLevel) {
        return rejected(
          world,
          'InvalidSpellDeclaration',
          'Retaliation cast level must match its paid slot level',
        );
      }
      if (command.spell.payment.kind === 'free_use'
        && command.spell.castLevel !== action.spell.level) {
        return rejected(
          world,
          'InvalidSpellDeclaration',
          'A free retaliation use cannot be upcast without a higher-level slot',
        );
      }
      const effect = createArmorOfAgathysEffect({
        id: env.nextId(),
        actorId: source.id,
        actionId: action.id,
        name: action.name,
        slotLevel: command.spell.castLevel,
        policy: armorPolicy,
        sourceEntityIds: action.sourceEntityIds,
      });
      const after = applyArmorOfAgathysCast({
        state: source.runtime,
        effect,
        temporaryHpChoice: choice as TemporaryHpChoice,
      });
      const obligations = actionObligationIds(
        action,
        'system:temporary-hp-melee-retaliation',
        'system:temporary-hit-points',
        'system:source-turn-expiry',
      );
      return runtimeTransition(source.id, source.id, source.runtime, after, 'action', obligations);
    }

    if (command.worldInput?.type !== 'area_objects') {
      return rejected(world, 'InvalidFacts', `${action.id} requires an explicit area-object snapshot`);
    }
    const validated = validateObjectFactsMap(world, command.worldInput.factsByObject);
    if ('rejection' in validated) return validated.rejection;
    const objectPushPolicy = primitive === 'area_object_push'
      ? forcedObjectPushPolicy(action)
      : null;
    if (primitive === 'area_object_push' && !objectPushPolicy) {
      return rejected(world, 'InvalidActionDefinition', `${action.id} has invalid object-push metadata`);
    }
    const result = primitive === 'burning_hands_objects'
      ? igniteBurningHandsObjects({
        objects: world.objects,
        factsByObject: validated.factsByObject,
        policy: managedPolicy!.policy as BurningHandsObjectsPolicy,
        targeting: managedPolicy!.targeting,
      })
      : pushWorldObjects({
        objects: world.objects,
        factsByObject: validated.factsByObject,
        policy: objectPushPolicy!,
      });
    return worldObjectEvents(
      source.id,
      action,
      result.events,
      primitive === 'burning_hands_objects'
        ? 'system:environmental-object-ignition'
        : 'system:environmental-object-push',
    );
  } catch (error) {
    return rejected(
      world,
      'InvalidFacts',
      error instanceof Error ? error.message : 'Invalid world-object interaction',
    );
  }
}

function executeUseAction(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
  options: {
    skipReplacedConcentrationWorldObjectCleanup?: boolean;
    externalPrimitiveHandled?: true;
    triggeredConsequences?:boolean;
    suppressSpellCastEvent?: boolean;
  } = {},
): EventInput[] {
  const source = world.actors[command.actorId];
  const targets = command.targetIds.map((targetId) => world.actors[targetId]);
  const executionTargets: Array<ActorState | undefined> = targets.length ? targets : [undefined];
  const deferredCheckFailure=executionTargets.length===1&&Array.isArray(action.mechanics.effects)&&action.mechanics.effects.length===1
    && (action.mechanics.effects[0] as Record<string,unknown>).resolution==='ability_check';
  let sourceAfter = source.runtime;
  const executions: Array<{
    target?: ActorState;
    result: ReturnType<typeof executeAction>;
    retaliationEvents: EngineEvent[];
    retaliationSourceEntityIds: string[];
  }> = [];

  for (const [index, target] of executionTargets.entries()) {
    const sourceAtStepBase: ActorState = { ...source, runtime: sourceAfter };
    const grapplerSources = sourceAtStepBase.capabilities.featureSources?.['general_feat.grappler'] ?? [];
    const attacksGrappledTarget = target != null
      && actorOwnsGrappler(sourceAtStepBase)
      && Object.values(world.grapples).some((grapple) => (
        grapple.grapplerActorId === source.id && grapple.targetActorId === target.id
      ));
    const sourceAtStep: ActorState = attacksGrappledTarget ? {
      ...sourceAtStepBase,
      passives: [
        ...(sourceAtStepBase.passives ?? []),
        grapplerAttackAdvantagePassive(grapplerSources),
      ],
    } : sourceAtStepBase;
    const result = executeAction(
      sourceAfter,
      index === 0 ? action.mechanics : withoutActivationCost(action.mechanics),
      {
        ...actionContext(
          sourceAtStep,
          env,
          target && hasAttackRoll(action)
            ? attackTargetWithCover(target, action.kind === 'spell'
              && spellAttackIgnoresCover(sourceAtStep.passives ?? [], command.factsByTarget?.[target.id]?.cover ?? 'none')
              ? 'none' : command.factsByTarget?.[target.id]?.cover ?? 'none')
            : target,
          target?.runtime,
          target ? command.factsByTarget?.[target.id] : undefined,
          command.spell,
        ),
        actionName: action.name,
        deferFailedAbilityCheckEffects:deferredCheckFailure,
        // Ordinary stat-block attacks use this generic path as well. Damage
        // reducers must receive the same command identity as weapon attacks,
        // including when one attack emits multiple damage packets.
        attackCommandId: command.commandId,
        choices: command.choices,
        triggeringAttack: command.triggeringAttack,
        spell: command.spell,
        suppressSpellCastEvent: index > 0 || options.suppressSpellCastEvent === true,
        ...(options.triggeredConsequences?{triggeredConsequences:true}:{}),
        deferIncomingDamageConsequences: executions.length === 0 && executionTargets.length === 1
          && shouldDeferDamageConsequences(sourceAtStep, target, action, catalog, target ? command.factsByTarget?.[target.id] : undefined, world),
        deferTargetSaves: true,
        ...(options.externalPrimitiveHandled ? { externalPrimitiveHandled: true as const } : {}),
      },
    );
    const armor = target ? resolveTemporaryHpMeleeRetaliationAfterAttack({
      world,
      attacker: sourceAtStep,
      defender: target,
      attackerAfter: result.state,
      defenderAfter: result.targetState,
      action,
      attackEvents: result.events,
      env,
    }) : {
      attackerAfter: result.state,
      defenderAfter: result.targetState,
      retaliationEvents: [],
      retaliationSourceEntityIds: [],
    };
    sourceAfter = armor.attackerAfter;
    executions.push({
      target,
      result: {
        ...result,
        state: armor.attackerAfter,
        ...(armor.defenderAfter ? { targetState: armor.defenderAfter } : {}),
      },
      retaliationEvents: armor.retaliationEvents,
      retaliationSourceEntityIds: armor.retaliationSourceEntityIds,
    });
  }

  const deferredTargetSaves = executions.flatMap(({ result }) => result.deferredTargetSaves ?? []);
  const obligationIds = actionObligationIds(
    action,
    hasAttackRoll(action) ? 'system:attack-resolution' : 'system:action-resolution',
    ...(deferredTargetSaves.length ? ['system:pending-resolution'] : []),
    ...(executions.some(({ retaliationEvents }) => retaliationEvents.length)
      ? ['system:temporary-hp-melee-retaliation', 'system:retaliation']
      : []),
    ...executions.flatMap(({ retaliationSourceEntityIds }) => (
      retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`)
    )),
  );
  // Damage reactions belong to the damage transition, not to the attack-roll
  // primitive.  Keeping the gate action-agnostic lets every canonical damage
  // source (an automatic hazard/feature today, more primitives tomorrow) use
  // the same persisted pre-mutation continuation.  The helper's exact-HP
  // postcondition rejects mixed or deferred transitions that cannot be held
  // losslessly.
  if (executions.length === 1) {
    const execution = executions[0];
    const target = execution.target;
    const facts = target ? command.factsByTarget?.[target.id] : undefined;
    if (target && facts) {
      const opened = damageReactionOpenedEvents({
        world,
        commandId: command.commandId,
        source,
        target,
        action,
        facts,
        targetRuntimeBeforeDamage: target.runtime,
        sourceRuntimeAfter: execution.result.state,
        targetRuntimeAfter: execution.result.targetState,
        attackEvents: execution.result.events,
        retaliationEvents: execution.retaliationEvents,
        retaliationSourceEntityIds: execution.retaliationSourceEntityIds,
        deferredTargetSaves: execution.result.deferredTargetSaves,
        catalog,
        env,
        obligations: obligationIds,
      });
      if (opened) return opened;
      if (execution.result.targetState) {
        const completed = settleDamageConsequences(target, execution.result.targetState, execution.result.events, env, {...source,runtime:execution.result.state});
        execution.result.targetState = completed.state;
        execution.result.events = completed.events;
        sourceAfter=execution.result.state=completed.sourceState??execution.result.state;
      }
    }
  }
  const events: EventInput[] = actionStateEvents({
    env,
    world,
    commandId: command.commandId,
    source,
    action,
    sourceAfter,
    targetUpdates: executions.flatMap(({ target, result }) => (
      target && result.targetState ? [{ target, targetAfter: result.targetState }] : []
    )),
    obligations: obligationIds,
    ...options,
  });
  for (const { target, result, retaliationEvents } of executions) {
    events.push(...engineTrace(source.id, target ? [target.id] : [], result.events, obligationIds));
    if (target && retaliationEvents.length) {
      events.push(...engineTrace(
        target.id,
        [source.id],
        retaliationEvents,
        obligationIds,
        { sourceActorId: target.id, facts: { trigger: 'temporary_hp_melee_retaliation' } },
      ));
    }
  }
  const followUps: PendingResolutionFollowUp[] = executions.flatMap(({ target, result }) => {
    if (!target) return [];
    const targetAfter = target.id === source.id ? result.state : result.targetState;
    const masterySaves = queuedMasterySaves({
      deferred: result.deferredTargetSaves,
      sourceActorId: source.id,
      targetActorId: target.id,
      actionId: action.id,
    });
    const concentration = concentrationSaveFollowUp({
      world,
      actor: target,
      actorAfter: targetAfter,
      obligations: obligationIds,
    });
    return [...masterySaves, ...(concentration ? [concentration] : [])];
  });
  const sourceTookDamage=executions.some(({target,result,retaliationEvents})=>retaliationEvents.length
    ||(!target&&result.events.some(event=>event.type==='damage'))
    ||result.events.some(event=>event.type==='world_interaction'&&event.operation==='recovery_replacement'&&event.parameters.recipientActorId===source.id));
  if (sourceTookDamage&&!followUps.some(entry=>entry.type==='concentration_save'&&entry.actorId===source.id)) {
    const attackerConcentration = concentrationSaveFollowUp({
      world,
      actor: source,
      actorAfter: sourceAfter,
      obligations: obligationIds,
    });
    if (attackerConcentration) followUps.push(attackerConcentration);
  }
  events.push(...followUpOpenedEvents({
    world,
    commandId: command.commandId,
    followUps,
    env,
  }));
  const embeddedChecks = executions.flatMap(({target,result}) => (
    (result.abilityChecks ?? []).map(check => ({target,result,check}))
  ));
  if (followUps.length === 0 && embeddedChecks.length === 1) {
    const [{target,check}] = embeddedChecks;
    const boostEvents=openFailedCheckBoost(
      world,
      {...source,runtime:sourceAfter},
      check.roll,
      {
        type:'action_ability_check',
        ...(command.worldInput?{worldInput:JSON.parse(JSON.stringify(command.worldInput)) as ActionWorldInput}:{}),
        actionId:action.id,
        effectIndex:check.effectIndex,
        ...(target ? {targetActorId:target.id} : {}),
        ...(target ? {facts:command.factsByTarget?.[target.id]} : {}),
        ...(command.choices ? {choices:JSON.parse(JSON.stringify(command.choices)) as Record<string,string|string[]>} : {}),
        ...(command.spell ? {spell:JSON.parse(JSON.stringify(command.spell)) as SpellCastContext} : {}),
      },
      command.commandId,
      catalog,
      env,
    );
    events.push(...boostEvents);
    if(deferredCheckFailure&&check.roll.outcome==='fail'&&!boostEvents.length){
      const effect=(action.mechanics.effects as Record<string,unknown>[])[check.effectIndex];
      if(Array.isArray(effect.on_fail)&&effect.on_fail.length){
        const after=foldEvents(world,events.map((event,ordinal)=>({...event,ordinal}))),actor=after.actors[source.id],recipient=target?after.actors[target.id]:undefined;
        const failed=executeAction(actor.runtime,{activation:{mode:'active',cost:[]},effects:[{...effect,resolution:'auto',result:effect.on_fail}]},
          {...actionContext(actor,env,recipient,recipient?.runtime,target?command.factsByTarget?.[target.id]:undefined,command.spell),choices:command.choices,suppressSpellCastEvent:true});
        events.push(...actionStateEvents({env,world:after,commandId:command.commandId,source:actor,action,sourceAfter:failed.state,target:recipient,targetAfter:failed.targetState,manageConcentration:false,obligations:obligationIds}),
          ...engineTrace(source.id,target?[target.id]:[],failed.events,obligationIds));
      }
    }
  }
  return events;
}

/** An equipped item can own an independent initiative turn without owning a
 * second copy of its wielder's statistics. The virtual actor pays its Action;
 * the canonical action executor resolves the attack from the live owner. */
function executeItemTurnAction(
  world:WorldState,
  command:AuthoritativeUseActionCommand,
  action:RuleActionDefinition,
  catalog:RulesCatalog,
  env:DeterministicEnvironment,
):CommandResult|EventInput[]{
  const turnActor=world.actors[command.actorId];
  const policy=turnActor.itemTurn;
  if(!policy||command.actionId!==policy.actionId||!turnActor.capabilities.actionIds.includes(action.id))
    return rejected(world,'ActionNotGranted','The item turn owns only its declared attack');
  if(command.spell||command.worldInput||command.choices)
    return rejected(world,'InvalidActionDefinition','Item-owned weapon attacks do not accept spell or action choices');
  const owner=world.actors[policy.ownerActorId];
  if(!owner||owner.lifecycle?.status==='dead'||!actorHasConsciousVitality(owner))
    return rejected(world,'InvalidActionTiming','The wielder cannot direct this weapon');
  if(owner.runtime.equipment.main_hand!==policy.itemCardId
    ||![...(owner.character.equippedCards??[]),...(owner.character.knownCards??[])]
      .some(card=>card.id===policy.itemCardId))
    return rejected(world,'InvalidEquipmentState','The item is no longer held by its wielder');
  const activation=action.mechanics.activation as Record<string,unknown>|undefined;
  const costs=activationCost(action);
  if(action.kind!=='nonSpell'||activation?.mode!=='active'||costs.length!==1
    ||costs[0].resource!=='action'||Number(costs[0].amount??1)!==1
    ||action.mechanics.requires_held_item!==policy.itemCardId
    ||action.mechanics.weapon_source_id!==policy.itemCardId
    ||!hasAttackRoll(action)||action.attackReplacement){
    return rejected(world,'InvalidActionDefinition','Malformed item-owned weapon attack');
  }
  if(deniedCapabilities(owner.runtime,owner.passives??[]).has('action'))
    return rejected(world,'CapabilityDenied','The wielder cannot attack');
  const targetIssue=actionValidation(world,action,command.targetIds,command.factsByTarget,owner.id);
  if(targetIssue)return targetIssue;
  const payable=canPay(turnActor.runtime,costs);
  if(!payable.ok)return rejected(world,'InsufficientResources','The item has already attacked this turn');
  const paid=payCommandCost(turnActor,costs,env);
  const cancelled=cancelledCostEvents(turnActor,paid);
  if(cancelled)return cancelled;
  const obligations=actionObligationIds(action,'system:item-owned-actor','system:attack-resolution');
  const payment=[...runtimeTransition(turnActor.id,turnActor.id,turnActor.runtime,paid.state,'action',obligations),
    ...engineTrace(turnActor.id,[turnActor.id],paid.events,obligations)];
  const {spell:_spell,...itemCommand}=command;
  const delegated:AuthoritativeUseActionCommand={...itemCommand,actorId:owner.id};
  const withoutCost:RuleActionDefinition={...action,mechanics:withoutActivationCost(action.mechanics)};
  return [...payment,...executeUseAction(world,delegated,withoutCost,catalog,env)];
}

function activationCost(action: RuleActionDefinition): Record<string, unknown>[] {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  return Array.isArray(activation?.cost) ? activation.cost as Record<string, unknown>[] : [];
}

/** Cost-only phases use the same resource listeners as ordinary actions. */
function payCommandCost(actor:ActorState,cost:Record<string,unknown>[],env:DeterministicEnvironment){
  return executeAction(actor.runtime,{activation:{mode:'active',cost},effects:[]},actionContext(actor,env));
}
function cancelledCostEvents(actor:ActorState,paid:ReturnType<typeof payCommandCost>):EventInput[]|null{
  if(!paid.events.some(event=>event.type==='execution_cancelled'))return null;
  const obligations=['system:resource-spent','system:cancel-execution'];
  return [...runtimeTransition(actor.id,actor.id,actor.runtime,paid.state,'action',obligations),...engineTrace(actor.id,[],paid.events,obligations)];
}

function activationMode(action: RuleActionDefinition): string {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  return String(activation?.mode ?? 'active');
}


function requiredActionCapability(action: RuleActionDefinition): 'action' | 'bonus_action' | 'reaction' {
  if (activationMode(action) === 'reaction') return 'reaction';
  const resources = activationCost(action).map((cost) => String(cost.resource ?? ''));
  return resources.includes('bonus_action') ? 'bonus_action' : 'action';
}

function withoutActivationCost(mechanics: Record<string, unknown>): Record<string, unknown> {
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  // A saved continuation has already passed the source check and paid its
  // item/charge cost. The last consumable may therefore be gone by the time a
  // target answers the save; do not reinterpret that as a revoked action.
  const {requires_item_source: _itemSource, requires_any_item_source: _itemSources,
    requires_runtime_action_grant: _runtimeGrant, ...settled} = mechanics;
  return {
    ...settled,
    activation: { ...(activation ?? { mode: 'active' }), cost: [] },
  };
}

function withoutActionResourceCost(mechanics: Record<string, unknown>): Record<string, unknown> {
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  const costs = Array.isArray(activation?.cost)
    ? activation.cost as Record<string, unknown>[]
    : [];
  return {
    ...mechanics,
    activation: {
      ...(activation ?? { mode: 'attack_entry' }),
      mode: 'attack_entry',
      cost: costs.filter((cost) => String(cost.resource ?? '') !== 'action'),
    },
  };
}

/**
 * Some area primitives own both creature and world-object consequences.  The
 * immutable snapshot predates the world primitive and describes
 * Thunderwave's damage but omits its failed-save creature push.  Complete the
 * primitive at the authoritative execution boundary instead of trusting a UI
 * to append an ad-hoc payload.  The structural duplicate check keeps a future
 * corrected source/overlay from applying the push twice.
 */
function hasAttackRoll(action: RuleActionDefinition): boolean {
  const effects = action.mechanics.effects;
  return Array.isArray(effects) && effects.some((effect) => (
    typeof effect === 'object' && effect !== null
      && String((effect as Record<string, unknown>).resolution ?? '') === 'attack_roll'
  ));
}

function hasTargetSave(action: RuleActionDefinition): boolean {
  const effects = action.mechanics.effects;
  return Array.isArray(effects) && effects.some((effect) => (
    typeof effect === 'object' && effect !== null
      && String((effect as Record<string, unknown>).resolution ?? '') === 'save'
      && String((effect as Record<string, unknown>).who ?? 'target') === 'target'
  ));
}

function attackSequenceObligationIds(sequence?: AttackSequenceState): string[] {
  return sequence ? ['system:attack-action', 'system:attack-replacement'] : [];
}

function attackSequenceContinuationIssue(
  world: WorldState,
  sequence: AttackSequenceState | undefined,
  pending: { sourceActorId: string; actionId: string; id: string; attackActionId?: string },
  action: RuleActionDefinition,
): string | null {
  if (pending.attackActionId) {
    const ledger = world.attackActions[pending.attackActionId];
    const replacement = action.attackReplacement;
    if (!ledger || !replacement
      || ledger.actorId !== pending.sourceActorId
      || ledger.status !== 'open'
      || ledger.blockedByResolutionId !== pending.id) {
      return 'Attack replacement lost its active canonical Attack-action ledger';
    }
    const matchingEntries = ledger.sequence.entries.filter((entry) => (
      entry.kind === 'replacement'
      && entry.actionId === pending.actionId
      && entry.replacementKey === replacement.replacementKey
    ));
    if (matchingEntries.length !== 1
      || !ledger.sequence.usedReplacementKeys.includes(replacement.replacementKey)) {
      return 'Attack-action ledger does not contain exactly one canonical replacement entry';
    }
    const sources = [...matchingEntries[0].sourceEntityIds].sort();
    if (JSON.stringify(sources) !== JSON.stringify([...action.sourceEntityIds].sort())) {
      return 'Attack replacement provenance disagrees with the compiled action';
    }
    return null;
  }
  if (!sequence) return null;
  const replacement = action.attackReplacement;
  if (!replacement) return `${action.id} no longer defines the persisted attack replacement`;
  if (sequence.actorId !== pending.sourceActorId) {
    return 'Attack sequence source actor disagrees with the saving-throw continuation';
  }
  if ((replacement.totalAttacks!=='actor'&&sequence.totalAttacks !== replacement.totalAttacks) || !attackSequenceComplete(sequence)) {
    return 'Attack sequence budget is incomplete or disagrees with the compiled action';
  }
  const matchingEntries = sequence.entries.filter((entry) => (
    entry.kind === 'replacement'
      && entry.actionId === pending.actionId
      && entry.replacementKey === replacement.replacementKey
  ));
  if (matchingEntries.length !== 1
    || !sequence.usedReplacementKeys.includes(replacement.replacementKey)) {
    return 'Attack sequence does not contain exactly one canonical replacement entry';
  }
  const sources = [...matchingEntries[0].sourceEntityIds].sort();
  if (JSON.stringify(sources) !== JSON.stringify([...action.sourceEntityIds].sort())) {
    return 'Attack replacement provenance disagrees with the compiled action';
  }
  return null;
}

/**
 * Multi-target auto execution deliberately stays fail-closed.  Re-running a
 * self-scoped interaction could duplicate source resources, listeners, or
 * effects; target-only interactions can be evaluated independently after the
 * first invocation has paid the shared activation cost.
 */
function hasIndependentTargetAutoEffects(action: RuleActionDefinition): boolean {
  const effects = action.mechanics.effects;
  return Array.isArray(effects) && effects.length > 0 && effects.every((effect) => {
    if (typeof effect !== 'object' || effect === null) return false;
    const value = effect as Record<string, unknown>;
    return String(value.resolution ?? '') === 'auto' && String(value.who ?? 'target') === 'target';
  });
}

function magicMissileSpec(action: RuleActionDefinition): MagicMissilePolicy | null {
  const parsed = parseWorldSpellPolicy(action.mechanics);
  if (parsed.status !== 'valid' || parsed.primitiveType !== 'magic_missile') return null;
  return parsed.policy as MagicMissilePolicy;
}

function magicMissileAllocation(
  command: AuthoritativeUseActionCommand,
  spec: MagicMissilePolicy,
): { dartTargetIds: string[]; dartCount: number } | { issue: string } {
  const dartCount = command.spell
    ? magicMissileDartCount(spec, command.spell.castLevel)
    : null;
  if (dartCount === null) return { issue: 'Magic Missile cast level is outside its declared policy' };
  const selected = command.choices?.[spec.allocationChoiceId];
  if (!Array.isArray(selected) || selected.length !== dartCount
    || selected.some((targetId) => typeof targetId !== 'string' || !targetId)) {
    return { issue: `${spec.allocationChoiceId} must assign exactly ${dartCount} dart target ids` };
  }
  const uniqueInOrder = selected.filter((targetId, index) => selected.indexOf(targetId) === index);
  if (uniqueInOrder.length !== command.targetIds.length
    || uniqueInOrder.some((targetId, index) => command.targetIds[index] !== targetId)) {
    return { issue: 'targetIds must equal the unique dart targets in first-occurrence order' };
  }
  return { dartTargetIds: [...selected], dartCount };
}

function hasMagicMissileImmunity(actor: ActorState): boolean {
  return actor.runtime.activeEffects.some((effect) => (
    (effect.mechanics as Record<string, unknown>).magic_missile_immunity === true
  ));
}

function grantsMagicMissileImmunity(action: RuleActionDefinition): boolean {
  const effects = action.mechanics.effects;
  return Array.isArray(effects) && effects.some((effect) => {
    if (!effect || typeof effect !== 'object') return false;
    const interaction = effect as Record<string, unknown>;
    const payloads = interaction.result ?? interaction.results;
    return Array.isArray(payloads) && payloads.some((payload) => (
      payload != null
      && typeof payload === 'object'
      && (payload as Record<string, unknown>).magic_missile_immunity === true
    ));
  });
}

function attackRollFrom(events: readonly EngineEvent[]): RollLog | null {
  const event = events.find((candidate): candidate is Extract<EngineEvent, { type: 'roll' }> => (
    candidate.type === 'roll' && candidate.roll.kind === 'd20' && candidate.roll.target?.type === 'ac'
  ));
  return event?.roll ?? null;
}

function isMeleeAttackRollAction(action: RuleActionDefinition): boolean {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Record<string, unknown>[]
    : [];
  return effects.some((effect) => {
    if (effect.resolution !== 'attack_roll') return false;
    const kind = String(effect.attack_kind ?? '');
    return kind === 'melee'
      || kind === 'unarmed'
      || kind === 'weapon_melee'
      || kind === 'spell_melee';
  });
}

function resolveTemporaryHpMeleeRetaliationAfterAttack(input: {
  world: WorldState;
  attacker: ActorState;
  defender: ActorState;
  attackerAfter: ActorState['runtime'];
  defenderAfter?: ActorState['runtime'];
  action: RuleActionDefinition;
  attackEvents: readonly EngineEvent[];
  env: DeterministicEnvironment;
}): {
  attackerAfter: ActorState['runtime'];
  defenderAfter?: ActorState['runtime'];
  retaliationEvents: EngineEvent[];
  retaliationSourceEntityIds: string[];
} {
  const roll = attackRollFrom(input.attackEvents);
  const defenderAfterHit = input.defenderAfter
    ? endArmorOfAgathysWithoutTemporaryHp(input.defenderAfter)
    : undefined;
  const retaliations = temporaryHpMeleeRetaliations({
    effects: input.defender.runtime.activeEffects,
    facts: {
      defenderActorId: input.defender.id,
      attackerActorId: input.attacker.id,
      hit: roll?.outcome === 'hit' || roll?.outcome === 'crit',
      attackRollKind: isMeleeAttackRollAction(input.action) ? 'melee' : 'ranged',
      temporaryHpBeforeHit: input.defender.runtime.hp.temp,
    },
  });
  if (retaliations.length === 0) {
    return {
      attackerAfter: endArmorOfAgathysWithoutTemporaryHp(input.attackerAfter),
      defenderAfter: defenderAfterHit,
      retaliationEvents: [],
      retaliationSourceEntityIds: [],
    };
  }
  let attackerAfter = input.attackerAfter;
  const retaliationEvents: EngineEvent[] = [];
  const retaliationSourceEntityIds = new Set<string>();
  for (const retaliation of retaliations) {
    const attackerAtStep: ActorState = { ...input.attacker, runtime: attackerAfter };
    const damage = applyIncomingDamage(
      attackerAfter,
      retaliation.amount,
      actionContext(attackerAtStep, input.env),
      { damageType: retaliation.damageType },
    );
    attackerAfter = damage.state;
    retaliationEvents.push(...damage.events);
    retaliation.sourceEntityIds.forEach((sourceId) => retaliationSourceEntityIds.add(sourceId));
  }
  return {
    attackerAfter: endArmorOfAgathysWithoutTemporaryHp(attackerAfter),
    defenderAfter: defenderAfterHit,
    retaliationEvents,
    retaliationSourceEntityIds: [...retaliationSourceEntityIds].sort(),
  };
}

function relabelAttackRolls(events: readonly EngineEvent[], label: string): EngineEvent[] {
  return events.map((event) => (
    event.type === 'roll' && event.roll.kind === 'd20' && event.roll.target?.type === 'ac'
      ? { ...event, label }
      : event
  ));
}

function withoutAttackRoll(events: readonly EngineEvent[]): EngineEvent[] {
  let skipped = false;
  return events.filter((event) => {
    if (!skipped && event.type === 'roll' && event.roll.kind === 'd20' && event.roll.target?.type === 'ac') {
      skipped = true;
      return false;
    }
    return true;
  });
}

type ReactionSpellDeclaration = {
  grantId?: string;
  mode?: 'normal' | 'ritual';
  preferFreeUse?: boolean;
};

type PreparedReactionExecution = {
  status: 'ready';
  action: RuleActionDefinition;
  spell?: CanonicalSpellContext;
};

type RejectedReactionExecution = {
  status: 'rejected';
  code: CommandRejectionCode;
  message: string;
};

/** Read-only outcome preview using the same spell preparation, executor and AC
 * projection as resolution. No random draws, costs or events escape this clone.
 * Unsupported/non-deterministic effects return unknown rather than hiding a choice. */
export function previewAttackDefense(
  defender: ActorState, action: RuleActionDefinition, roll: RollLog,
  declaration?: ReactionSpellDeclaration,
): {ac: number; changesOutcome: boolean} | undefined {
  try {
    // AC projection also evaluates active modifier formulas. Do not allow a
    // random formula to reach that projection (which has its own RNG default).
    const randomAc = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(randomAc);
      const row = value as Record<string, unknown>;
      if ((row.applies_to as Record<string, unknown> | undefined)?.roll === 'ac'
        && typeof row.value === 'string' && /(?:\d*\s*[dдк]\s*\d+)/iu.test(row.value)) return true;
      return Object.values(row).some(randomAc);
    };
    if (randomAc(action.mechanics) || randomAc(defender.runtime.activeEffects) || randomAc(defender.passives)) return undefined;
    const actor = structuredClone(defender);
    const prepared = prepareReactionExecution(actor, action, declaration);
    if (prepared.status !== 'ready') return undefined;
    let id = 0;
    const result = executeAction(actor.runtime, prepared.action.mechanics, {
      ...actionContext(actor, {rng: () => {throw new Error('Random preview');}, clock: () => 0,
        nextId: () => `defense-preview:${++id}`}, undefined, undefined, undefined, prepared.spell),
      actionName: prepared.action.name, spell: prepared.spell,
    });
    const bonus = singleAttackDefenseBonus(prepared.action);
    const after = {...actor, runtime: result.state,
      ...(bonus ? {ac: effectiveArmorClass(actor, {...actor.runtime, activeEffects: []}) + bonus} : {})};
    // The saved roll already includes situational AC (e.g. cover). A defense
    // changes that target by its own delta, not by replacing it with sheet AC.
    const ac = (roll.target?.value ?? effectiveArmorClass(actor))
      + effectiveArmorClass(after) - effectiveArmorClass(actor);
    // A failed/unsupported modifier formula can be ignored by legacy AC
    // projections. No demonstrated AC change means no reliable prediction.
    if (effectiveArmorClass(after) === effectiveArmorClass(actor)) return undefined;
    if (result.pendingReactions?.length || result.deferredTargetSaves?.length) return undefined;
    const originalHit = roll.outcome === 'hit' || roll.outcome === 'crit';
    const adjusted = retargetAttackRoll(roll, ac);
    return {ac, changesOutcome: originalHit !== (adjusted.outcome === 'hit' || adjusted.outcome === 'crit')};
  } catch { return undefined; }
}

function prepareReactionExecution(
  actor: ActorState,
  action: RuleActionDefinition,
  declaration?: ReactionSpellDeclaration,
): PreparedReactionExecution | RejectedReactionExecution {
  if (action.kind === 'nonSpell') {
    if (declaration) {
      return {
        status: 'rejected',
        code: 'InvalidSpellDeclaration',
        message: `${action.id} is not a spell and cannot accept a spell-source declaration`,
      };
    }
    return { status: 'ready', action };
  }

  if (!actor.spellcastingAccess) {
    if (declaration) {
      return {
        status: 'rejected',
        code: 'InvalidSpellDeclaration',
        message: `${actor.id} has no source-scoped spell access for ${action.id}`,
      };
    }
    return { status: 'ready', action, spell: canonicalSpellContext(action) };
  }

  const preparation = prepareSpellExecution({
    action,
    accessState: actor.spellcastingAccess,
    resources: availableResources(actor.runtime,actor.character,actor.passives),
    declaration,
  });
  if (preparation.status === 'rejected') {
    return {
      status: 'rejected',
      code: preparation.stage === 'action_definition'
        ? 'InvalidActionDefinition'
        : preparation.code === 'SpellResourceUnavailable'
          ? 'InsufficientResources'
          : 'InvalidSpellDeclaration',
      message: preparation.message,
    };
  }
  if (preparation.provenance.mode === 'ritual') {
    return {
      status: 'rejected',
      code: 'InvalidActionTiming',
      message: 'A ritual cannot be cast as a reaction',
    };
  }
  return {
    status: 'ready',
    action: preparation.executableAction,
    spell: canonicalSpellContext(preparation.executableAction, undefined, preparation),
  };
}

function sourceScopedReactionOptions(
  target: ActorState,
  action: RuleActionDefinition,
): ReactionActionOption[] {
  const levelRequirement = parseActivationLevelRequirement(action.mechanics);
  if (levelRequirement.status === 'invalid'
    || (levelRequirement.status === 'required'
      && target.character.level < levelRequirement.minLevel)) return [];
  if (action.kind !== 'spell' || !target.spellcastingAccess) {
    const execution = prepareReactionExecution(target, action);
    if (execution.status === 'rejected'
      || !canPay(target.runtime, activationCost(execution.action)).ok) return [];
    return [{ actionId: action.id, label: action.name }];
  }

  const grantIds = [...new Set(target.spellcastingAccess.grants
    .filter((grant) => grant.actionId === action.id)
    .map((grant) => grant.grantId))];
  const spellSources = grantIds.flatMap((grantId) => {
    const execution = prepareSpellExecution({
      action,
      accessState: target.spellcastingAccess!,
      resources: availableResources(target.runtime,target.character,target.passives),
      declaration: { grantId },
    });
    if (execution.status === 'rejected'
      || execution.provenance.mode === 'ritual'
      || !canPay(target.runtime, activationCost(execution.executableAction)).ok) return [];
    return [{
      grantId: execution.provenance.grantId,
      sourceId: execution.provenance.sourceId,
      spellcastingAbility: execution.provenance.spellcastingAbility,
      ...(execution.provenance.fixedSpellcastingModifier !== undefined ? { fixedSpellcastingModifier: execution.provenance.fixedSpellcastingModifier } : {}),
      payment: { ...execution.payment },
    }];
  });
  return spellSources.length
    ? [{ actionId: action.id, label: action.name, spellSources }]
    : [];
}

function cloneReactionOption(option: ReactionActionOption): ReactionActionOption {
  return {
    ...option,
    ...(option.spellSources ? {
      spellSources: option.spellSources.map((source) => ({
        ...source,
        payment: { ...source.payment },
      })),
    } : {}),
  };
}

function hitReactionOptions(
  target: ActorState,
  catalog: RulesCatalog,
  incomingAction: RuleActionDefinition,
  facts: SpatialFacts,
): Array<{ action: RuleActionDefinition; option: ReactionActionOption }> {
  if (deniedCapabilities(target.runtime, target.passives ?? []).has('reaction')) return [];
  return target.capabilities.actionIds.flatMap((actionId) => {
    const action = catalog.getAction(actionId);
    if (!action || !hasReactionTrigger(action, 'hit_by_attack')) return [];
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const trigger = activation?.trigger as Record<string, unknown> | undefined;
    if (trigger?.melee_attack_while_holding_weapon === true && !meleeWeaponDefenseEligible(target, incomingAction)) return [];
    if (trigger?.feat_defensive_duelist === true
      && !defensiveDuelistReactionEligible({ defender: target, incomingAction, facts })) return [];
    const [option] = sourceScopedReactionOptions(target, action);
    return option ? [{ action, option }] : [];
  });
}

function catalogActionForActor(
  actor: ActorState,
  action: RuleActionDefinition,
): RuleActionDefinition {
  const refs=[action.id,...action.sourceEntityIds];
  const mechanics=applyItemSpellProjectiles(applyItemActionTargetLimit(action.mechanics,refs,actor.passives??[],action.kind==='spell',action.spell?.level),refs,actor.passives??[]);
  if(mechanics!==action.mechanics && action.targeting){
    const targeting=mechanics.targeting as Record<string,unknown>;
    action={...action,mechanics,targeting:{...action.targeting,maxTargets:Number(targeting.max_targets)}};
  }
  const holdsWeapon = (['main_hand', 'off_hand'] as const).some((slot) => {
    const cardId = actor.runtime.equipment[slot];
    return !!cardId && actorCard(actor, cardId)?.type === 'weapon';
  });
  return applyUnarmedDamageProfileToAction(action, actor.passives ?? [], {
    holdingWeaponOrShield: holdsWeapon || actorHoldsCanonicalShield(actor),
    wearingArmorOrShield: Object.values(actor.runtime.equipment).some(cardId =>
      !!cardId && actorCard(actor, cardId)?.defense_type != null),
    variables: actor.character.variables,
    abilityMods: liveCharacter(actor).abilityMods,
  });
}

function damageReactionOptions(
  target: ActorState,
  catalog: RulesCatalog,
  eventData: Record<string, unknown>,
): Array<{ action: RuleActionDefinition; option: ReactionActionOption }> {
  return target.capabilities.actionIds.flatMap((actionId) => {
    const action = catalog.getAction(actionId);
    if (!action || !hasReactionTrigger(action, 'damage_taken')) return [];
    if(deniedCapabilities(target.runtime,target.passives??[]).has(requiredActionCapability(action)))return [];
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const trigger = activation?.trigger as Record<string, unknown> | undefined;
    // Incoming damage is held before HP mutation. Reactions declared for an
    // after-damage window cannot be offered through this pre-damage protocol.
    if (trigger?.timing != null && trigger.timing !== 'before') return [];
    // Before simulation, packet types are unknown: hold provisionally. Once
    // computed, offer only declarations matching the immutable damage bundle.
    if (trigger?.damage_types_any !== undefined) {
      if (!Array.isArray(trigger.damage_types_any) || !trigger.damage_types_any.length) return [];
      const types = eventData.damage_types;
      if (Array.isArray(types) && !types.some(type => (trigger.damage_types_any as unknown[]).includes(type))) return [];
    }
    if (!matchesWhen(trigger?.circumstances as Record<string, unknown>[] | undefined, {
      character: target.character, state: target.runtime, activeConditions: activeConditionsOf(target.runtime),
      event: { kind: 'damage_taken', data: eventData },
    })) return [];
    const [option] = sourceScopedReactionOptions(target, action);
    return option ? [{ action, option }] : [];
  });
}

function damageReactors(world: WorldState, target: ActorState, catalog: RulesCatalog, facts: SpatialFacts, action: RuleActionDefinition, damageEvents?: readonly EngineEvent[]): Array<{actor: ActorState; options: Array<{action: RuleActionDefinition; option: ReactionActionOption}>}> {
  const savedFacts=damageEvents?.find((event):event is Extract<EngineEvent,{type:'damage'}>=>event.type==='damage'&&!!event.saveFacts)?.saveFacts;
  const eventData = {delivery: hasAttackRoll(action) ? 'attack' : 'other', melee_attack: isMeleeAttackRollAction(action), source_visible: facts.targetCanSeeSource ?? true,
    ...savedFacts,
    ...(damageEvents ? {damage_types: damagePackets(damageEvents).map(p => p.damageType)} : {})};
  return [target, ...Object.values(world.actors).filter(actor => actor.id !== target.id).sort((a,b) => a.id.localeCompare(b.id))].flatMap(actor => {
    const observer = actor.id !== target.id;
    const ownedObserver = actor.capabilities.actionIds.some(id => {
      const definition = catalog.getAction(id);
      const trigger = (definition?.mechanics.activation as Record<string,unknown>|undefined)?.trigger as Record<string,unknown>|undefined;
      return trigger?.protective_field === true || !!definition&&!!damageTransferSpec(definition)&&action.mechanics.damage_transfer_origin!==true;
    });
    if(observer && !ownedObserver) return [];
    if(observer) {
      const observations = facts.damageObservers?.filter(row => row.actorId === actor.id) ?? [];
      if(actor.capabilities.actionIds.some(id=>((catalog.getAction(id)?.mechanics.activation as Record<string,unknown>|undefined)?.trigger as Record<string,unknown>|undefined)?.protective_field===true)
        &&(observations.length!==1||!Number.isFinite(observations[0].distanceFt)||observations[0].distanceFt<0))throw new Error('Protective Field requires one valid distance and visibility observation per owner');
    }
    const options = damageReactionOptions(actor,catalog,eventData).filter(({action:reaction}) => {
      const trigger=(reaction.mechanics.activation as Record<string,unknown>|undefined)?.trigger as Record<string,unknown>|undefined;
      if(damageTransferSpec(reaction))return observer&&action.mechanics.damage_transfer_origin!==true&&damageTransferEligible(actor,target,reaction,facts);
      const observation=facts.damageObservers?.find(row=>row.actorId===actor.id);
      return !observer || trigger?.protective_field === true&&!!observation&&observation.distanceFt<=30&&observation.canSeeTarget;
    });
    return options.length ? [{actor,options}] : [];
  });
}

function damagePackets(events: readonly EngineEvent[]): Array<{
  amount: number;
  damageType: string;
  roll?: RollLog;
}> {
  return events.flatMap((event) => event.type === 'damage' && event.amount > 0
    ? [{
      amount: Math.max(0, Math.floor(event.amount)),
      damageType: event.damageType,
      ...(event.roll ? { roll: JSON.parse(JSON.stringify(event.roll)) as RollLog } : {}),
    }]
    : []);
}

function hpAfterDamage(
  hp: ActorState['runtime']['hp'],
  amount: number,
): ActorState['runtime']['hp'] {
  const next = { ...hp };
  let remaining = Math.max(0, Math.floor(amount));
  const absorbed = Math.min(next.temp, remaining);
  next.temp -= absorbed;
  remaining -= absorbed;
  next.current = Math.max(0, next.current - remaining);
  return next;
}

function sameHp(
  left: ActorState['runtime']['hp'],
  right: ActorState['runtime']['hp'],
): boolean {
  return left.current === right.current && left.max === right.max && left.temp === right.temp;
}

function adjustedDamageEvents(
  events: readonly EngineEvent[],
  reduction: number,
  multiplier = 1,
): { events: EngineEvent[]; amount: number } {
  let remainingReduction = Math.max(0, Math.floor(reduction));
  let amount = 0;
  const adjusted: EngineEvent[] = [];
  const calculatedTypes = new Set(events.flatMap(event => event.type === 'damage' && event.calculation ? [event.damageType] : []));
  for (const event of events) {
    if (event.type === 'narrative' && event.damageAdjustment && calculatedTypes.has(event.damageAdjustment.damageType)) continue;
    if (event.type !== 'damage') {
      adjusted.push(JSON.parse(JSON.stringify(event)) as EngineEvent);
      continue;
    }
    const before = Math.floor((event.calculation?.beforeResistance ?? event.amount)*multiplier);
    const applied = Math.min(before, remainingReduction);
    remainingReduction -= applied;
    const calculation = event.calculation ? { ...event.calculation, beforeResistance: before - applied } : undefined;
    const resolved = calculation ? resolveDamageCalculation(calculation, event.damageType) : { amount: before - applied, events: [] };
    amount += resolved.amount;
    adjusted.push(...resolved.events);
    adjusted.push({ ...event, amount: resolved.amount, ...(calculation ? { calculation } : {}) });
  }
  return { events: adjusted, amount };
}

function damageBeforeResistance(events: readonly EngineEvent[]): number {
  return events.reduce((sum, event) => event.type === 'damage'
    ? sum + (event.calculation?.beforeResistance ?? event.amount) : sum, 0);
}

function applyReactionRuntimeDelta(
  continuation: ActorState['runtime'],
  before: ActorState['runtime'],
  after: ActorState['runtime'],
): ActorState['runtime'] {
  const patch = runtimePatch(before, after);
  return {
    ...continuation,
    ...(patch.resources ? { resources: { ...patch.resources } } : {}),
    ...(patch.maxResources ? { maxResources: { ...patch.maxResources } } : {}),
    ...(patch.equipment ? { equipment: { ...patch.equipment } } : {}),
    ...(patch.inventory ? { inventory: patch.inventory.map((entry) => ({ ...entry })) } : {}),
    ...(patch.activeEffects ? {
      activeEffects: patch.activeEffects.map((entry) => JSON.parse(JSON.stringify(entry))),
    } : {}),
    ...(patch.firedThisTurn !== undefined
      ? { firedThisTurn: patch.firedThisTurn ?? undefined }
      : {}),
    ...(patch.firedThisRest !== undefined
      ? { firedThisRest: patch.firedThisRest ?? undefined }
      : {}),
    ...(patch.firedByPeriod !== undefined
      ? { firedByPeriod: patch.firedByPeriod ?? undefined }
      : {}),
    ...(patch.eventOccurrences !== undefined ? {eventOccurrences:patch.eventOccurrences ?? undefined} : {}),
    ...(patch.turnMovementFt !== undefined ? {turnMovementFt:patch.turnMovementFt ?? undefined} : {}),
  };
}

function shouldDeferDamageConsequences(
  _source: ActorState, target: ActorState | undefined, action: RuleActionDefinition,
  catalog: RulesCatalog, facts?: SpatialFacts, world?: WorldState, includeSaveReactions=false,
): boolean {
  if (!target || !facts) return false;
  // Mixed healing/damage transitions cannot use the exact-HP continuation.
  const changesHpOtherwise = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(changesHpOtherwise);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return ['healing', 'heal', 'temp_hp'].includes(String(record.kind))
      || Object.values(record).some(changesHpOtherwise);
  };
  return !changesHpOtherwise(action.mechanics) && (includeSaveReactions && target.capabilities.actionIds.some(id=>{const reaction=catalog.getAction(id);return !!reaction&&hasReactionTrigger(reaction,'damage_taken');}) || (world ? damageReactors(world,target,catalog,facts,action).length > 0 : damageReactionOptions(target,catalog,{delivery:hasAttackRoll(action)?'attack':'other',melee_attack:isMeleeAttackRollAction(action),source_visible:facts.targetCanSeeSource??true}).length > 0));
}

function settleDamageConsequences(
  target: ActorState,
  after: ActorState['runtime'],
  events: readonly EngineEvent[],
  env: DeterministicEnvironment,
  source?:ActorState,
): { state: ActorState['runtime']; events: EngineEvent[]; sourceState?:ActorState['runtime'] } {
  if (!events.some(event => event.type === 'damage' && event.deferredConsequences)) {
    return { state: after, events: [...events] };
  }
  let state = { ...after, hp: { ...target.runtime.hp } };
  let sourceState=source?.runtime;
  const completed: EngineEvent[] = [];
  for (const event of events) {
    completed.push(event);
    if (event.type !== 'damage') continue;
    const hpBefore = state.hp;
    state = { ...state, hp: hpAfterDamage(hpBefore, event.amount) };
    if (!event.deferredConsequences) continue;
    const consequence = applyDamageConsequences(state, event.amount, hpBefore,
      actionContext({ ...target, runtime: state }, env,source?{...source,runtime:sourceState!}:undefined,sourceState), {
        damageType: event.damageType,
        crit: event.deferredConsequences.critical,
        imposeConcentrationDisadvantage: event.deferredConsequences.concentrationDisadvantage,
        delivery:event.deferredConsequences.delivery,
      });
    state = consequence.state;
    sourceState=consequence.targetState??sourceState;
    completed.push(...consequence.events);
  }
  if(source){
    const lifecycle=resolveDeferredSourceConsequences(sourceState!,state,actionContext({...source,runtime:sourceState!},env,target,state),completed);
    return {state:lifecycle.targetState??state,sourceState:lifecycle.state,events:[...completed,...lifecycle.events]};
  }
  return { state, events: completed };
}

interface DamageReactionContinuationInput {
  world: WorldState;
  commandId: string;
  source: ActorState;
  target: ActorState;
  action: RuleActionDefinition;
  facts: SpatialFacts;
  targetRuntimeBeforeDamage: ActorState['runtime'];
  sourceRuntimeAfter: ActorState['runtime'];
  targetRuntimeAfter?: ActorState['runtime'];
  preDamageTargetEvents?: readonly EngineEvent[];
  attackEvents: readonly EngineEvent[];
  retaliationEvents?: readonly EngineEvent[];
  retaliationSourceEntityIds?: readonly string[];
  deferredTargetSaves?: readonly DeferredTargetSave[];
  attackActionId?: string;
  catalog: RulesCatalog;
  env: DeterministicEnvironment;
  obligations: string[];
}

/**
 * Hold an already-computed damage bundle outside WorldState until its owner
 * accepts or declines a payable `damage_taken` reaction.  The executor may
 * simulate freely, but the canonical event stream never mutates HP before the
 * decision and never needs to reroll the triggering action after a reload.
 */
function damageReactionOpenedEvents(
  input: DamageReactionContinuationInput,
): EventInput[] | null {
  if (!input.targetRuntimeAfter) return null;
  const packets = damagePackets(input.attackEvents);
  const amount = packets.reduce((sum, packet) => sum + packet.amount, 0);
  if (amount <= 0) return null;

  const targetAtWindow: ActorState = {
    ...input.target,
    runtime: input.targetRuntimeBeforeDamage,
  };
  const observerWorld = {...input.world,actors:{...input.world.actors,[input.source.id]:{...input.source,runtime:input.sourceRuntimeAfter}}};
  const reactors = damageReactors(observerWorld,targetAtWindow,input.catalog,input.facts,input.action,input.attackEvents);
  if (!reactors.length) return null;
  const {actor:reactor,options} = reactors[0];

  // Snapshot continuations are safe only when this action's HP transition is
  // exactly the held damage bundle.  Mixed damage/healing actions keep their
  // existing atomic path rather than manufacturing a lossy rollback.
  const expectedHp = hpAfterDamage(input.targetRuntimeBeforeDamage.hp, amount);
  if (!sameHp(expectedHp, input.targetRuntimeAfter.hp)) return null;

  const obligations = [...new Set([
    ...input.obligations,
    'system:damage-reaction-window',
    'system:pending-resolution',
  ])];
  const resolutionId = input.env.nextId();
  const masteryFollowUps = queuedMasterySaves({
    deferred: input.deferredTargetSaves,
    sourceActorId: input.source.id,
    targetActorId: input.target.id,
    actionId: input.action.id,
  });
  return [{
    sourceActorId: input.source.id,
    obligationIds: obligations,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: resolutionId,
        type: 'damage_reaction',
        transferReactorIds:reactors.filter(row=>row.options.some(option=>damageTransferSpec(option.action))).map(row=>row.actor.id),
        remainingReactorIds: reactors.slice(1).map(row=>row.actor.id),
        openedByCommandId: input.commandId,
        openedAtRevision: input.world.revision,
        deadlineLogicalClock: input.world.logicalClock + 10,
        sourceActorId: input.source.id,
        targetActorId: input.target.id,
        actionId: input.action.id,
        action: JSON.parse(JSON.stringify(input.action)) as RuleActionDefinition,
        facts: { ...input.facts },
        targetRuntimeBeforeDamage: JSON.parse(JSON.stringify(input.targetRuntimeBeforeDamage)),
        sourceRuntimeAfter: JSON.parse(JSON.stringify(input.sourceRuntimeAfter)),
        targetRuntimeAfter: JSON.parse(JSON.stringify(input.targetRuntimeAfter)),
        damage: packets,
        preDamageTargetEvents: JSON.parse(JSON.stringify(input.preDamageTargetEvents ?? [])),
        attackEvents: JSON.parse(JSON.stringify(input.attackEvents)),
        retaliationEvents: JSON.parse(JSON.stringify(input.retaliationEvents ?? [])),
        retaliationSourceEntityIds: [...(input.retaliationSourceEntityIds ?? [])],
        obligationIds: obligations,
        followUps: masteryFollowUps,
        ...(input.attackActionId ? { attackActionId: input.attackActionId } : {}),
        request: {
          id: input.env.nextId(),
          type: 'reaction',
          actorId: reactor.id,
          trigger: {
            type: 'damage_taken',
            sourceActorId: input.source.id,
            actionId: input.action.id,
            amount,
            damageTypes: [...new Set(packets.map((packet) => packet.damageType))],
          },
          options: options.map(({ option }) => cloneReactionOption(option)),
        },
      },
    },
  }];
}

interface PendingAttackOptions {
  projectileChecked?: boolean;
  prepaidCostResources?: string[];
  reflectedProjectile?: boolean;
  attackActionId?: string;
  preRollDisadvantageReasons?: readonly string[];
  protectionWindowResolved?: boolean;
  forceExecution?: boolean;
  continuationKind?: ProtectionAttackContinuationKind;
  weaponHand?: 'main' | 'off';
  weaponCardId?: string;
  pactBladeProjection?: PactBladeAttackContinuationProjection;
  /** World primitive was already validated/applied before this continuation. */
  externalPrimitiveHandled?: true;
  suppressSpellCastEvent?: boolean;
}

function protectionCapabilitySource(actor: ActorState): Protection2024CapabilitySource | null {
  const sourceEntityIds = actor.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID];
  if (!sourceEntityIds) return null;
  const source: Protection2024CapabilitySource = {
    ownerActorId: actor.id,
    capabilityId: PROTECTION_2024_CAPABILITY_ID,
    sourceEntityIds: [...sourceEntityIds] as [string, ...string[]],
  };
  return protection2024SourceIssue(source, actor.id) ? null : source;
}

function protectionCandidateShapeIssue(candidate: ProtectionReactionCandidateFacts): string | null {
  if (!candidate || typeof candidate !== 'object'
    || !['scenario', 'board', 'gm_ruling'].includes(candidate.factsSource)
    || !Number.isInteger(candidate.boardRevision) || candidate.boardRevision < 0
    || typeof candidate.protectorActorId !== 'string'
    || !candidate.protectorActorId || candidate.protectorActorId.trim() !== candidate.protectorActorId
    || typeof candidate.protectorCanSeeAttacker !== 'boolean'
    || !Number.isFinite(candidate.protectorDistanceToTargetFt)
    || candidate.protectorDistanceToTargetFt < 0) {
    return 'Protection requires a complete authoritative geometry and visibility observation';
  }
  return null;
}

function protectionCandidatesForAttack(input: {
  world: WorldState;
  command: AuthoritativeUseActionCommand;
  source: ActorState;
  target: ActorState;
  facts: SpatialFacts;
}): CommandResult | {
  candidates: ProtectionReactionCandidateFacts[];
  queued: QueuedProtectionReaction[];
} {
  const owners = Object.values(input.world.actors)
    .filter((actor) => actor.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID] !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidates = input.command.protectionCandidates ?? [];
  if (candidates.some((candidate) => protectionCandidateShapeIssue(candidate))) {
    return rejected(input.world, 'InvalidFacts', 'Protection candidate facts are malformed');
  }
  const candidateIds = candidates.map((candidate) => candidate.protectorActorId);
  if (new Set(candidateIds).size !== candidateIds.length
    || candidates.some((candidate) => candidate.boardRevision !== input.facts.boardRevision)
    || JSON.stringify([...candidateIds].sort()) !== JSON.stringify(owners.map((owner) => owner.id))) {
    return rejected(
      input.world,
      'InvalidFacts',
      'An attack must provide one current Protection observation for every source-owned protector',
    );
  }

  const queued: QueuedProtectionReaction[] = [];
  for (const owner of owners) {
    const source = protectionCapabilitySource(owner);
    if (!source) {
      return rejected(input.world, 'InvalidActionDefinition', `${owner.id} has forged Protection provenance`);
    }
    const candidate = candidates.find((value) => value.protectorActorId === owner.id)!;
    const facts: Protection2024ReactionFacts = {
      factsSource: candidate.factsSource,
      worldRevision: input.world.revision,
      attackId: input.command.commandId,
      protectorActorId: owner.id,
      attackerActorId: input.source.id,
      targetActorId: input.target.id,
      attackRollStage: 'before_roll',
      protectorCanSeeAttacker: candidate.protectorCanSeeAttacker,
      protectorHoldingShield: actorHoldsCanonicalShield(owner),
      protectorReactionAvailable: (owner.runtime.resources.reaction ?? 0) >= 1
        && !deniedCapabilities(owner.runtime, owner.passives ?? []).has('reaction'),
      protectorDistanceToTargetFt: candidate.protectorDistanceToTargetFt,
    };
    if (getProtection2024Eligibility(facts).eligible) queued.push({ protectorActorId: owner.id, facts });
  }
  return {
    candidates: candidates.map((candidate) => ({ ...candidate })),
    queued,
  };
}

function protectionContinuationKind(
  source: ActorState,
  action: RuleActionDefinition,
): ProtectionAttackContinuationKind {
  if (action.id === SYSTEM_ACTION_IDS.weaponAttack) {
    const effects = Array.isArray(action.mechanics.effects)
      ? action.mechanics.effects as Record<string, unknown>[]
      : [];
    return effects.some((effect) => String(effect.attack_kind).includes('ranged'))
      ? 'weapon_ranged'
      : 'weapon_melee';
  }
  if (action.id === SYSTEM_ACTION_IDS.unarmedDamage) return 'unarmed_damage';
  if (familiarAttackRuleAction(source, action.id)) return 'familiar_attack';
  return 'catalog';
}

function protectionOpenedEvent(input: {
  world: WorldState;
  command: AuthoritativeUseActionCommand;
  action: RuleActionDefinition;
  current: QueuedProtectionReaction;
  remaining: QueuedProtectionReaction[];
  candidates: ProtectionReactionCandidateFacts[];
  options: PendingAttackOptions;
  env: DeterministicEnvironment;
  obligations: string[];
}): EventInput {
  const resolutionId = input.env.nextId();
  const requestId = input.env.nextId();
  const continuationKind = input.options.continuationKind
    ?? protectionContinuationKind(input.world.actors[input.command.actorId], input.action);
  return {
    sourceActorId: input.command.actorId,
    obligationIds: input.obligations,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: resolutionId,
        type: 'protection_reaction',
        openedByCommandId: input.command.commandId,
        openedAtRevision: input.world.revision,
        deadlineLogicalClock: input.world.logicalClock + 10,
        sourceActorId: input.command.actorId,
        targetActorId: input.command.targetIds[0],
        actionId: input.action.id,
        facts: { ...input.command.factsByTarget![input.command.targetIds[0]] },
        choices: input.command.choices,
        spell: input.command.spell,
        ...(input.options.attackActionId ? { attackActionId: input.options.attackActionId } : {}),
        attackContinuationKind: continuationKind,
        ...(input.options.weaponHand ? { weaponHand: input.options.weaponHand } : {}),
        ...(input.options.weaponCardId ? { weaponCardId: input.options.weaponCardId } : {}),
        ...(input.options.pactBladeProjection
          ? { pactBladeProjection: { ...input.options.pactBladeProjection } }
          : {}),
        preRollDisadvantageReasons: [...(input.options.preRollDisadvantageReasons ?? [])],
        protectionCandidates: input.candidates.map((candidate) => ({ ...candidate })),
        remainingReactions: input.remaining.map((queued) => ({
          protectorActorId: queued.protectorActorId,
          facts: { ...queued.facts },
        })),
        request: {
          id: requestId,
          type: 'reaction',
          actorId: input.current.protectorActorId,
          trigger: {
            type: 'protection_before_attack',
            sourceActorId: input.command.actorId,
            targetActorId: input.command.targetIds[0],
            actionId: input.action.id,
            attackId: input.command.commandId,
          },
          options: [{
            actionId: PROTECTION_2024_CAPABILITY_ID,
            label: 'Боевой стиль: Защита',
          }],
        },
      },
    },
  };
}

function protectionEndEvent(input: {
  effect: ReturnType<typeof actorProtectionEffects>[number];
  facts: ProtectionReactionCandidateFacts;
  worldRevision: number;
  sourceActorId: string;
}): EventInput {
  return {
    sourceActorId: input.sourceActorId,
    obligationIds: [
      'system:fighting-style-protection',
      'system:effect-lifecycle',
      ...input.effect.source.sourceEntityIds.map((id) => `entity:${id}`),
    ],
    payload: {
      type: 'ProtectionEffectEnded',
      protectorActorId: input.effect.protectorActorId,
      protectedTargetActorId: input.effect.protectedTargetActorId,
      effectId: input.effect.id,
      reason: 'proximity_broken',
      lifecycleEvent: {
        type: 'distance_observed',
        factsSource: input.facts.factsSource,
        worldRevision: input.worldRevision,
        protectorActorId: input.effect.protectorActorId,
        protectedTargetActorId: input.effect.protectedTargetActorId,
        distanceFt: input.facts.protectorDistanceToTargetFt,
      },
    },
  };
}

/**
 * Attack roll is committed first; hit effects stay suspended until the target
 * has accepted or declined interrupt reactions. This avoids damage rollback.
 */
/** Post-miss maneuvers are source choices, not Reaction-resource actions. */
function attackAdjustmentOptions(source: ActorState, target: ActorState, catalog: RulesCatalog): RuleActionDefinition[] {
  if (target.runtime.activeEffects.some(effect => {
    const payload = effect.mechanics as Record<string, unknown>;
    return payload.attack_maneuver === true && payload.consume === 'next_attack' && effect.sourceId === source.id;
  })) return [];
  return source.capabilities.actionIds.flatMap(id => {
    const action = catalog.getAction(id);
    const activation = action?.mechanics.activation as Record<string, unknown> | undefined;
    const trigger = activation?.trigger as Record<string, unknown> | undefined;
    const faces = Number(trigger?.attack_roll_bonus_die);
    return action && activation?.mode === 'triggered' && Array.isArray(trigger?.events)
      && trigger.events.includes('attack_missed') && Number.isInteger(faces) && faces >= 2 && faces <= 100
      && !actionDefinitionIssue(action) && canPay(source.runtime, activationCost(action)).ok ? [action] : [];
  });
}

function pendingAttackEvents(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
  options: PendingAttackOptions = {},
): CommandResult | EventInput[] | null {
  let targetId = command.targetIds[0];
  if (!targetId || !hasAttackRoll(action)) return null;
  const originalSource = world.actors[command.actorId];
  const originalTarget = world.actors[targetId];
  let facts = command.factsByTarget?.[targetId];
  if (!facts) return rejected(world, 'MissingSpatialFacts', `Missing spatial facts for target ${targetId}`);
  const antimagicIssue=magicActionIssue(originalSource,action,[originalTarget]);
  if(antimagicIssue)return rejected(world,'InvalidActionTiming',antimagicIssue);
  const protection = options.reflectedProjectile?{candidates:[],queued:[]}:protectionCandidatesForAttack({
    world, command, source: originalSource, target: originalTarget, facts,
  });
  if ('status' in protection) return protection;

  const candidateByProtector = new Map(protection.candidates.map((candidate) => (
    [candidate.protectorActorId, candidate] as const
  )));
  let protectionDisadvantage = false;
  const protectionLifecycleEvents: EventInput[] = [];
  for (const protector of options.reflectedProjectile?[]:Object.values(world.actors)) {
    const candidate = candidateByProtector.get(protector.id);
    for (const effect of actorProtectionEffects(protector).filter((active) => (
      active.protectedTargetActorId === targetId
    ))) {
      if (!candidate) {
        return rejected(world, 'InvalidFacts', `Missing current proximity for Protection effect ${effect.id}`);
      }
      const result = resolveProtection2024AttackRoll(effect, {
        factsSource: candidate.factsSource,
        worldRevision: world.revision,
        attackId: command.commandId,
        targetActorId: targetId,
        attackRollStage: 'before_roll',
        protectorDistanceToProtectedTargetFt: candidate.protectorDistanceToTargetFt,
      });
      if (result.status === 'rejected') {
        return rejected(world, 'InvalidFacts', `Protection attack facts were rejected: ${result.reason}`);
      }
      if (result.status === 'ended') {
        protectionLifecycleEvents.push(protectionEndEvent({
          effect, facts: candidate, worldRevision: world.revision, sourceActorId: command.actorId,
        }));
      } else if (result.imposeDisadvantage) {
        protectionDisadvantage = true;
      }
    }
  }
  const effectiveWorld = protectionLifecycleEvents.length
    ? foldEvents(world, protectionLifecycleEvents.map((event, ordinal) => ({ ...event, ordinal })))
    : world;
  const source = effectiveWorld.actors[command.actorId];
  // Cover was an ephemeral projection in the original weapon/unarmed command.
  // A restored pre-roll continuation must reconstruct it from persisted facts.
  const spellCover = action.kind === 'spell'
    && spellAttackIgnoresCover(source.passives ?? [], facts.cover)
    ? 'none'
    : facts.cover;
  let target = action.kind === 'spell'
    ? attackTargetWithCover(effectiveWorld.actors[targetId], spellCover)
    : options.protectionWindowResolved || !options.continuationKind || options.continuationKind === 'catalog'
      ? attackTargetWithCover(effectiveWorld.actors[targetId], facts.cover)
      : effectiveWorld.actors[targetId];
  const obligations = actionObligationIds(
    action,
    'system:attack-resolution',
    'system:pending-resolution',
    ...(protection.queued.length || protectionDisadvantage || protectionLifecycleEvents.length
      ? ['system:fighting-style-protection']
      : []),
  );

  if (!options.protectionWindowResolved && protection.queued.length) {
    const payable = canPay(source.runtime, activationCost(action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
    }
    const paid = payCommandCost(source, activationCost(action),env);
  const cancelled = cancelledCostEvents(source,paid);
  if(cancelled)return cancelled;
    const [current, ...remaining] = protection.queued;
    return [
      ...protectionLifecycleEvents,
      ...runtimeTransition(source.id, source.id, source.runtime, paid.state, 'action', obligations),
      ...engineTrace(source.id, [target.id], paid.events, obligations),
      protectionOpenedEvent({
        world: effectiveWorld,
        command,
        action,
        current,
        remaining,
        candidates: protection.candidates,
        options,
        env,
        obligations,
      }),
    ];
  }

  // With no currently legal interrupt reaction, execute the action exactly
  // once.  The normal path now defers nested mastery saves itself; previewing
  // and replaying a multiattack would otherwise duplicate attack rolls and
  // incorrectly reuse the first roll for later attacks.
  if(!options.projectileChecked&&source.id!==target.id&&hasProjectileReflection(target,action)){
    const cost=activationCost(action),payable=canPay(source.runtime,cost);
    if(!payable.ok)return rejected(world,'InsufficientResources',`Missing resources: ${payable.missing.join(', ')}`);
    const paid=payCommandCost(source,cost,env),cancelled=cancelledCostEvents(source,paid);
    if(cancelled)return cancelled;
    const payment=[...runtimeTransition(source.id,source.id,source.runtime,paid.state,'action',obligations),...engineTrace(source.id,[target.id],paid.events,obligations)];
    const paidWorld=foldEvents(effectiveWorld,payment.map((event,ordinal)=>({...event,ordinal})));
    const reflection=projectileReflection(target,action,env.rng);
    if(reflection){
      const nextCommand=reflection.reflected?{...command,targetIds:[source.id],factsByTarget:{[source.id]:{...facts,cover:'none' as const,relation:'self' as const,targetCanSeeSource:true}}}:command;
      const result=pendingAttackEvents(paidWorld,nextCommand,{...action,mechanics:withoutActivationCost(action.mechanics)},catalog,env,{...options,projectileChecked:true,reflectedProjectile:reflection.reflected,
        prepaidCostResources:options.prepaidCostResources??cost.map(entry=>String(entry.resource)),
        protectionWindowResolved:true,forceExecution:true});
      if(result&&!Array.isArray(result))return result;
      return [...protectionLifecycleEvents,...payment,...engineTrace(target.id,[source.id],reflection.events,obligations),...(result??[])];
    }
  }
  const redirectionRules=attackRedirectionRules(source,action,options.weaponCardId);
  let availableAdjustments = attackAdjustmentOptions(source, target, catalog);
  let availableReactions = hitReactionOptions(target, catalog, action, facts);
  const availableDamageReactions = damageReactionOptions(target, catalog, {
    delivery: 'attack',
    melee_attack: isMeleeAttackRollAction(action),
    source_visible: facts.targetCanSeeSource ?? true,
  });
  if (!availableReactions.length
    && !availableAdjustments.length
    && !availableDamageReactions.length
    && !options.forceExecution
    && !redirectionRules.length
    && !protectionDisadvantage
    && !protectionLifecycleEvents.length) return null;

  const cost = activationCost(action);
  const payable = canPay(source.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = payCommandCost(source, cost,env);
  const cancelled = cancelledCostEvents(source,paid);
  if(cancelled)return cancelled;
  const continuationDisadvantages = options.protectionWindowResolved
    ? [...(options.preRollDisadvantageReasons ?? [])]
    : [];
  const sourceForRoll: ActorState = protectionDisadvantage || continuationDisadvantages.length ? {
    ...source,
    passives: [
      ...(source.passives ?? []),
      ...continuationDisadvantages.map(attackDisadvantagePassive),
      ...(protectionDisadvantage
        ? [attackDisadvantagePassive('Fighting Style: Protection')]
        : []),
    ],
  } : source;
  const preview = executeAction(paid.state, withoutActivationCost(action.mechanics), {
    ...actionContext(sourceForRoll, env, target, target.runtime, facts, command.spell),
    ...(options.attackActionId ? { attackActionId: options.attackActionId } : {}),
    attackCommandId: command.commandId,
    choices: command.choices,
    spell: command.spell,
    suppressSpellCastEvent: options.suppressSpellCastEvent === true,
    pauseAfterAttackRoll: true,
    actionCostResources: options.prepaidCostResources??cost.map(entry=>String(entry.resource)),
    ...(options.externalPrimitiveHandled ? { externalPrimitiveHandled: true as const } : {}),
  });
  let attackRoll = attackRollFrom(preview.events);
  if (!attackRoll) return rejected(world, 'InvalidDecision', `${action.id} did not produce an attack roll`);
  const redirected=redirectedAttackTarget(effectiveWorld,source,target,redirectionRules,attackRoll);
  if(redirected){
    targetId=redirected.target.id;facts=redirected.facts;target=attackTargetWithCover(redirected.target,facts.cover);
    attackRoll=retargetAttackRoll(redirected.roll,effectiveArmorClass(target));
    preview.events=preview.events.map(event=>event.type==='roll'&&event.roll.kind==='d20'?{...event,roll:attackRoll!}:event);
    preview.events.push({type:'narrative',text:`Атака перенаправлена: ${target.name}.`});
    command={...command,targetIds:[targetId],factsByTarget:{[targetId]:facts}};
    availableAdjustments=[];availableReactions=hitReactionOptions(target,catalog,action,facts);
  }

  const reactions = attackRoll.outcome === 'hit' || attackRoll.outcome === 'crit'
    ? availableReactions
    : [];
  const adjustments = !attackRoll.attackManeuverActionId
    && (attackRoll.outcome === 'miss' || attackRoll.outcome === 'crit_miss') ? availableAdjustments : [];
  if (reactions.length || adjustments.length) {
    const resolutionId = env.nextId();
    const requestId = env.nextId();
    return [
      ...protectionLifecycleEvents,
      ...runtimeTransition(source.id, source.id, source.runtime, preview.state, 'action', obligations),
      ...runtimeTransition(
        source.id,
        target.id,
        target.runtime,
        preview.targetState ?? target.runtime,
        'action',
        obligations,
      ),
      ...engineTrace(source.id, [target.id], [
        ...paid.events,
        ...relabelAttackRolls(preview.events, 'Атака — до реакции'),
      ], obligations),
      {
        sourceActorId: source.id,
        obligationIds: obligations,
        payload: {
          type: 'ResolutionOpened',
          resolution: {
            id: resolutionId,
            type: 'attack_reaction',
            openedByCommandId: command.commandId,
            openedAtRevision: world.revision,
            deadlineLogicalClock: world.logicalClock + 10,
            sourceActorId: source.id,
            targetActorId: target.id,
            actionId: action.id,
            facts,
            choices: command.choices,
            spell: command.spell,
            attackRoll,
            ...(adjustments.length ? {attackAdjustment: true as const} : {}),
            request: {
              id: requestId,
              type: 'reaction',
              actorId: adjustments.length ? source.id : target.id,
              trigger: {
                type: adjustments.length ? 'attack_missed' : 'hit_by_attack',
                sourceActorId: source.id,
                actionId: action.id,
                attackTotal: attackRoll.total,
                originalAc: effectiveArmorClass(target),
              },
              options: adjustments.length ? adjustments.map(action => ({actionId:action.id,label:action.name}))
                : reactions.map(({ option }) => cloneReactionOption(option)),
            },
            ...(options.attackActionId ? { attackActionId: options.attackActionId } : {}),
            ...(options.weaponHand ? { weaponHand: options.weaponHand } : {}),
            ...(options.weaponCardId ? { weaponCardId: options.weaponCardId } : {}),
            ...(options.pactBladeProjection
              ? { pactBladeProjection: { ...options.pactBladeProjection } }
              : {}),
          },
        },
      },
    ];
  }

  const resumed = executeAction(preview.state, withoutActivationCost(action.mechanics), {
    ...actionContext(sourceForRoll, env, target, target.runtime, facts, command.spell),
    ...(options.attackActionId ? { attackActionId: options.attackActionId } : {}),
    attackCommandId: command.commandId,
    choices: command.choices,
    spell: command.spell,
    suppressSpellCastEvent: true,
    forcedAttackRoll: attackRoll,
    deferIncomingDamageConsequences: shouldDeferDamageConsequences(sourceForRoll, target, action, catalog, facts, world),
    deferTargetSaves: true,
    ...(options.externalPrimitiveHandled ? { externalPrimitiveHandled: true as const } : {}),
  });
  const resumedEvents = [
    ...paid.events,
    ...relabelAttackRolls(preview.events, 'Атака'),
    ...withoutAttackRoll(resumed.events),
  ];
  const damageWindow = damageReactionOpenedEvents({
    world: effectiveWorld,
    commandId: command.commandId,
    source,
    target,
    action,
    facts,
    targetRuntimeBeforeDamage: source.id===target.id?preview.state:target.runtime,
    sourceRuntimeAfter: resumed.state,
    targetRuntimeAfter: source.id===target.id?resumed.state:resumed.targetState,
    attackEvents: resumedEvents,
    deferredTargetSaves: resumed.deferredTargetSaves,
    attackActionId: options.attackActionId,
    catalog,
    env,
    obligations,
  });
  if (damageWindow) return [...protectionLifecycleEvents, ...damageWindow];
  if (resumed.targetState) {
    const completed = settleDamageConsequences(target, resumed.targetState, resumedEvents, env,{...source,runtime:resumed.state});
    resumed.targetState = completed.state;
    resumed.state=completed.sourceState??resumed.state;
    resumedEvents.splice(0, resumedEvents.length, ...completed.events);
  }
  const events: EventInput[] = [
    ...protectionLifecycleEvents,
    ...actionStateEvents({
    env,
      world: effectiveWorld,
      commandId: command.commandId,
      source,
      action,
      sourceAfter: resumed.state,
      target,
      targetAfter: resumed.targetState,
      obligations,
    }),
    ...engineTrace(source.id, [target.id], resumedEvents, obligations),
  ];
  events.push(...attackFollowUpEvents({
    world: effectiveWorld,
    commandId: command.commandId,
    source,
    target,
    sourceAfter:resumed.state,
    targetAfter: resumed.targetState,
    action,
    deferred: resumed.deferredTargetSaves,
    env,
    obligations,
  }));
  return events;
}

/** One ordered attack occurrence. The volley is persisted before a reaction
 * can suspend execution, so a reload never rolls or pays an earlier slot again. */
function attackVolleyStep(
  world: WorldState,
  volley: PendingAttackVolley,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const index = volley.nextSlotIndex;
  if (index === volley.targetIds.length) return [{
    sourceActorId: volley.actorId,
    obligationIds: ['system:attack-volley'],
    payload: {type:'AttackVolleyChanged',volley:null},
  }];
  const targetId = volley.targetIds[index];
  if (!targetId) return rejected(world, 'InvalidDecision', 'Attack volley has no next target slot');
  const action = index === 0 ? volley.action : {
    ...volley.action,
    mechanics: withoutActivationCost(volley.action.mechanics),
  };
  const command: AuthoritativeUseActionCommand = {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: `${volley.id}:slot:${index}`,
    actorId: volley.actorId,
    expectedRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
    actionId: action.id,
    targetIds: [targetId],
    factsByTarget: {[targetId]: volley.factsByTarget[targetId]},
    ...(volley.choices ? {choices: JSON.parse(JSON.stringify(volley.choices))} : {}),
    ...(volley.spell ? {spell: {...volley.spell}} : {}),
    ...(volley.protectionCandidatesByTarget?.[targetId]
      ? {protectionCandidates: volley.protectionCandidatesByTarget[targetId].map(row => ({...row}))}
      : {}),
  };
  const pending = pendingAttackEvents(world, command, action, catalog, env, {
    suppressSpellCastEvent: index > 0,
  });
  if (pending && !Array.isArray(pending)) return pending;
  const events = pending ?? executeUseAction(world, command, action, catalog, env, {
    suppressSpellCastEvent: index > 0,
  });
  const nextIndex = index + 1;
  const holdsResolution = events.some(event => event.payload.type === 'ResolutionOpened');
  return [...events, {
    sourceActorId: volley.actorId,
    obligationIds: ['system:attack-volley'],
    payload: {type: 'AttackVolleyChanged', volley: nextIndex < volley.targetIds.length || holdsResolution
      ? {...volley, nextSlotIndex: nextIndex} : null},
  }];
}

function magicMissileReactionOptions(
  target: ActorState,
  catalog: RulesCatalog,
): ReactionActionOption[] {
  if (deniedCapabilities(target.runtime, target.passives ?? []).has('reaction')) return [];
  return target.capabilities.actionIds.flatMap((actionId) => {
    const action = catalog.getAction(actionId);
    if (!action || !hasReactionTrigger(action, 'targeted_by_magic_missile')) return [];
    if (actionDefinitionIssue(action) || spellDeclarationIssue(action)
      || !grantsMagicMissileImmunity(action)) return [];
    return sourceScopedReactionOptions(target, action);
  });
}

function magicMissileReactionOpenedEvent(input: {
  world: WorldState;
  actionCommandId: string;
  sourceActorId: string;
  actionId: string;
  spell: CanonicalSpellContext;
  dartTargetIds: string[];
  targets: Array<{ targetActorId: string; facts: SpatialFacts }>;
  protectedTargetIds: string[];
  current: QueuedMagicMissileReaction;
  remainingReactions: QueuedMagicMissileReaction[];
  env: DeterministicEnvironment;
  obligations: string[];
}): EventInput {
  const dartCount = input.dartTargetIds.filter((targetId) => targetId === input.current.targetActorId).length;
  return {
    sourceActorId: input.sourceActorId,
    obligationIds: input.obligations,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: input.env.nextId(),
        type: 'magic_missile_reaction',
        openedByCommandId: input.actionCommandId,
        openedAtRevision: input.world.revision,
        deadlineLogicalClock: input.world.logicalClock + 10,
        sourceActorId: input.sourceActorId,
        targetActorId: input.current.targetActorId,
        actionId: input.actionId,
        spell: input.spell,
        dartTargetIds: [...input.dartTargetIds],
        targets: input.targets.map((entry) => ({
          targetActorId: entry.targetActorId,
          facts: { ...entry.facts },
        })),
        protectedTargetIds: [...input.protectedTargetIds],
        remainingReactions: input.remainingReactions.map((entry) => ({
          targetActorId: entry.targetActorId,
          options: entry.options.map(cloneReactionOption),
        })),
        request: {
          id: input.env.nextId(),
          type: 'reaction',
          actorId: input.current.targetActorId,
          trigger: {
            type: 'targeted_by_magic_missile',
            sourceActorId: input.sourceActorId,
            actionId: input.actionId,
            dartCount,
          },
          options: input.current.options.map(cloneReactionOption),
        },
      },
    },
  };
}

function magicMissileDamageEvents(input: {
  world: WorldState;
  actionCommandId: string;
  sourceActorId: string;
  sourceRuntime?: ActorState['runtime'];
  action: RuleActionDefinition;
  policy: MagicMissilePolicy;
  dartTargetIds: readonly string[];
  targets: ReadonlyArray<{ targetActorId: string; facts: SpatialFacts }>;
  protectedTargetIds: readonly string[];
  runtimeOverrides?: ReadonlyMap<string, ActorState['runtime']>;
  env: DeterministicEnvironment;
  obligations: string[];
  followUpCommandId: string;
}): EventInput[] {
  const source = input.world.actors[input.sourceActorId];
  const factsByTarget = new Map(input.targets.map((entry) => [entry.targetActorId, entry.facts]));
  const protectedTargets = new Set(input.protectedTargetIds);
  const actorRuntimes = new Map<string, ActorState['runtime']>(input.runtimeOverrides ?? []);
  let sourceRuntime = input.sourceRuntime
    ?? actorRuntimes.get(source.id)
    ?? source.runtime;
  actorRuntimes.delete(source.id);
  const traces: EventInput[] = [];
  const dartMechanics: Record<string, unknown> = {
    activation: { mode: 'triggered', cost: [] },
    effects: [JSON.parse(JSON.stringify(input.policy.perDartEffect)) as Record<string, unknown>],
  };

  input.dartTargetIds.forEach((targetActorId, dartIndex) => {
    const target = input.world.actors[targetActorId];
    const facts = factsByTarget.get(targetActorId);
    if (!target || !facts) return;
    const auditFacts = {
      magicMissile: {
        dartOrdinal: dartIndex + 1,
        simultaneous: input.policy.simultaneous,
        shielded: protectedTargets.has(targetActorId),
      },
      spatialFacts: facts,
    };
    if (protectedTargets.has(targetActorId)) {
      traces.push(...engineTrace(source.id, [targetActorId], [{
        type: 'narrative',
        text: `Shield blocks Magic Missile dart ${dartIndex + 1}.`,
      }], input.obligations, { facts: auditFacts }));
      return;
    }

    const currentTargetRuntime = target.id === source.id
      ? sourceRuntime
      : actorRuntimes.get(target.id) ?? target.runtime;
    const sourceAtStep: ActorState = { ...source, runtime: sourceRuntime };
    const targetAtStep: ActorState = { ...target, runtime: currentTargetRuntime };
    const context = actionContext(sourceAtStep, input.env, targetAtStep, currentTargetRuntime, facts);
    if (target.id === source.id && context.target) context.target.runtimeState = currentTargetRuntime;
    const result = executeAction(sourceRuntime, dartMechanics, context);
    sourceRuntime = target.id === source.id ? result.targetState ?? result.state : result.state;
    if (target.id !== source.id && result.targetState) actorRuntimes.set(target.id, result.targetState);
    traces.push(...engineTrace(source.id, [targetActorId], result.events, input.obligations, {
      facts: auditFacts,
    }));
  });

  const events: EventInput[] = actionStateEvents({
    env: input.env,
    world: input.world,
    commandId: input.actionCommandId,
    source,
    action: input.action,
    sourceAfter: sourceRuntime,
    targetUpdates: [...actorRuntimes.entries()].flatMap(([actorId, targetAfter]) => {
      const target = input.world.actors[actorId];
      return target ? [{ target, targetAfter }] : [];
    }),
    obligations: input.obligations,
  });
  events.push(...traces);

  const damagedTargetIds = input.dartTargetIds.filter((targetId, index, all) => (
    !protectedTargets.has(targetId) && all.indexOf(targetId) === index
  ));
  const followUps: PendingResolutionFollowUp[] = damagedTargetIds.flatMap((targetId) => {
    const target = input.world.actors[targetId];
    if (!target) return [];
    const actorAfter = targetId === source.id ? sourceRuntime : actorRuntimes.get(targetId);
    const continuation = concentrationSaveFollowUp({
      world: input.world,
      actor: target,
      actorAfter,
      obligations: input.obligations,
    });
    return continuation ? [continuation] : [];
  });
  events.push(...followUpOpenedEvents({
    world: input.world,
    commandId: input.followUpCommandId,
    followUps,
    env: input.env,
  }));
  return events;
}

function magicMissileEvents(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  spec: MagicMissilePolicy,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const allocation = magicMissileAllocation(command, spec);
  if ('issue' in allocation) return rejected(world, 'InvalidTargets', allocation.issue);
  if (!command.spell) return rejected(world, 'InvalidSpellDeclaration', 'Magic Missile requires canonical spell metadata');
  const source = world.actors[command.actorId];
  const payable = canPay(source.runtime, activationCost(action));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const declaration = executeAction(source.runtime, {
    ...action.mechanics,
    effects: [],
  }, {
    ...actionContext(source, env, undefined, undefined, undefined, command.spell),
    choices: command.choices,
    spell: command.spell,
    externalPrimitiveHandled: true,
  });
  const obligations = actionObligationIds(
    action,
    'system:magic-missile',
    'system:reaction-window',
    'system:pending-resolution',
  );
  const targets = command.targetIds.map((targetActorId) => ({
    targetActorId,
    facts: { ...command.factsByTarget![targetActorId] },
  }));
  const protectedTargetIds = command.targetIds.filter((targetActorId) => (
    hasMagicMissileImmunity(world.actors[targetActorId])
  ));
  const reactions: QueuedMagicMissileReaction[] = command.targetIds.flatMap((targetActorId) => {
    if (protectedTargetIds.includes(targetActorId)) return [];
    const options = magicMissileReactionOptions(world.actors[targetActorId], catalog);
    return options.length ? [{ targetActorId, options }] : [];
  });
  const declarationTrace = engineTrace(source.id, command.targetIds, declaration.events, obligations);
  const [current, ...remainingReactions] = reactions;
  if (!current) {
    return [
      ...declarationTrace,
      ...magicMissileDamageEvents({
        world,
        actionCommandId: command.commandId,
        sourceActorId: source.id,
        sourceRuntime: declaration.state,
        action,
        policy: spec,
        dartTargetIds: allocation.dartTargetIds,
        targets,
        protectedTargetIds,
        env,
        obligations,
        followUpCommandId: command.commandId,
      }),
    ];
  }
  return [
    ...runtimeTransition(source.id, source.id, source.runtime, declaration.state, 'action', obligations),
    ...declarationTrace,
    magicMissileReactionOpenedEvent({
      world,
      actionCommandId: command.commandId,
      sourceActorId: source.id,
      actionId: action.id,
      spell: command.spell,
      dartTargetIds: allocation.dartTargetIds,
      targets,
      protectedTargetIds,
      current,
      remainingReactions,
      env,
      obligations,
    }),
  ];
}

/**
 * Opens a serializable target-save continuation. Costs are paid at declaration;
 * target HP/effects remain untouched until ResolveDecision resumes the action.
 */
function pendingSaveEvents(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  env: DeterministicEnvironment,
  attackSequence?: AttackSequenceState,
  attackActionId?: string,
): CommandResult | EventInput[] | null {
  if (!command.targetIds.length) return null;
  const source = world.actors[command.actorId];
  const queuedTargets: QueuedTargetSaveResolution[] = [];
  const automaticTargets: Array<{
    targetActorId: string;
    ability: Ability;
    reason: string;
    sourceEntityIds: string[];
  }> = [];
  for (const targetId of command.targetIds) {
    const target = world.actors[targetId];
    const facts = command.factsByTarget?.[target.id];
    if (!facts) return rejected(world, 'MissingSpatialFacts', `Missing spatial facts for target ${target.id}`);
    const save = readTargetSave(action.mechanics, {
      ...actionContext(source, env, target, target.runtime, facts, command.spell),
      triggeringAttack: command.triggeringAttack,
      choices: command.choices,
      spell: command.spell,
    });
    if (!save) return null;
    if (save.automaticSuccess) {
      automaticTargets.push({
        targetActorId: target.id,
        ability: save.ability as Ability,
        reason: save.automaticSuccess.reason,
        sourceEntityIds: [...save.automaticSuccess.sourceEntityIds],
      });
      continue;
    }
    queuedTargets.push({
      targetActorId: target.id,
      facts: { ...facts },
      save: {
        ability: save.ability as Ability,
        dc: save.dc,
        avoidsConditions: [...save.avoidsConditions],
      },
    });
  }
  // When every selected target has a data-owned automatic success, the normal
  // action path applies those success branches immediately. In mixed areas the
  // known successes are recorded at declaration and omitted from the manual
  // dice queue; their actor ids remain in resolvedTargetIds for replay/audit.
  if (!queuedTargets.length) return null;
  const [first, ...remainingTargets] = queuedTargets;
  if (!first) return null;
  const target = world.actors[first.targetActorId];

  const cost = activationCost(action);
  const payable = canPay(source.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = payCommandCost(source, cost,env);
  const cancelled = cancelledCostEvents(source,paid);
  if(cancelled)return cancelled;
  const declarationEvents = [...paid.events];
  const sourceAfterDeclaration = command.spell?.components?.verbal === true
    ? expireEffectsForTrigger(
      paid.state,
      'actor_casts_spell_with_verbal_component',
      declarationEvents,
    )
    : paid.state;
  const resolutionId = env.nextId();
  const requestId = env.nextId();
  const obligationIds = actionObligationIds(
    action,
    'system:target-save',
    'system:pending-resolution',
    ...attackSequenceObligationIds(attackSequence),
  );
  const events: EventInput[] = [];
  events.push(...runtimeTransition(
    source.id,
    source.id,
    source.runtime,
    sourceAfterDeclaration,
    'action',
    obligationIds,
  ));
  events.push(...engineTrace(source.id, command.targetIds, declarationEvents, obligationIds));
  for (const automatic of automaticTargets) {
    events.push(...engineTrace(source.id, [automatic.targetActorId], [{
      type: 'narrative',
      text: `Спасбросок ${ABILITY_LABEL[automatic.ability]} — автоуспех: ${automatic.reason}.`
        + (automatic.sourceEntityIds.length
          ? ` Источники: ${automatic.sourceEntityIds.join(', ')}.` : ''),
    }], obligationIds));
  }
  events.push({
    sourceActorId: source.id,
    obligationIds,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: resolutionId,
        type: 'target_save',
        openedByCommandId: command.commandId,
        openedAtRevision: world.revision,
        deadlineLogicalClock: world.logicalClock + 10,
        sourceActorId: source.id,
        targetActorId: target.id,
        actionId: action.id,
        facts: first.facts,
        choices: command.choices,
        triggeringAttack: command.triggeringAttack,
        spell: command.spell ?? runtimeActionContext(source.runtime, action.mechanics,
          actionContext(source, env, target, target.runtime, first.facts)).spell,
        request: {
          id: requestId,
          type: 'saving_throw',
          actorId: target.id,
          ability: first.save.ability,
          dc: first.save.dc,
          avoidsConditions: [...first.save.avoidsConditions],
        },
        remainingTargets,
        resolvedTargetIds: automaticTargets.map((entry) => entry.targetActorId),
        concentrationEffectLinks: [],
        followUps: [],
        spellCastEmitted: false,
        sharedDamageRolls: [],
        ...(attackSequence ? {
          attackSequence: JSON.parse(JSON.stringify(attackSequence)) as AttackSequenceState,
        } : {}),
        ...(attackActionId ? { attackActionId } : {}),
      },
    },
  });
  return events;
}

function executeHide(
  world: WorldState,
  command: Extract<GameCommand, { type: 'AttemptHide' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const issue = hideEligibilityIssue(command.eligibility);
  if (issue) return rejected(world, 'HideNotEligible', issue);
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Hide action in its current state`);
  }
  let hideAction = CORE_HIDE_ACTION;
  if (command.actionId !== undefined) {
    const declared = catalog.getAction(command.actionId);
    if (!declared) return rejected(world, 'ActionNotFound', 'Unknown Hide action');
    if (!actor.capabilities.actionIds.includes(declared.id)) return rejected(world, 'ActionNotGranted', 'Actor does not own this Hide action');
    const declarationIssue = actionDefinitionIssue(declared) ?? hideActionDeclarationIssue(declared);
    if (declarationIssue) return rejected(world, 'InvalidActionDefinition', declarationIssue);
    hideAction = {...CORE_HIDE_ACTION, id: declared.id, name: declared.name,
      sourceEntityIds: declared.sourceEntityIds,
      mechanics: {...CORE_HIDE_ACTION.mechanics, name: declared.name, activation: declared.mechanics.activation}};
  }
  const costContext={state:actor.runtime,character:actor.character,passives:actor.passives??[],actionRefs:[hideAction.id,...hideAction.sourceEntityIds],actionCategory:'hide'};
  const optional=availableActionCostPolicies(hideAction.mechanics,costContext).filter(policy=>policy.optional);
  if(command.selectedCostPolicyId===undefined&&optional.length)return actionCostChoice(world,command,actor.id,optional,env);
  let hideMechanics:Record<string,unknown>;
  try{hideMechanics=applyActionCostPolicies(hideAction.mechanics,costContext,command.selectedCostPolicyId).mechanics;}
  catch(error){return rejected(world,'InvalidDecision',error instanceof Error?error.message:'Invalid Hide cost policy');}
  const mechanics = projectActionSurgeCost(hideMechanics, actor.runtime, 'nonspell');
  const payable = canPay(actor.runtime, activationCost({...hideAction, mechanics}));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }

  const result = executeAction(actor.runtime, mechanics, actionContext(actor, env));
  const obligations = actionObligationIds(
    hideAction,
    'system:hide-action',
    'system:ability-check',
  );
  const check = result.events.find(event => event.type === 'roll' && event.roll.kind === 'check');
  const boost = check?.type === 'roll' ? openFailedCheckBoost(world, {...actor, runtime: result.state},
    {...check.roll, kind: 'd20'}, {type: 'hide'}, command.commandId, catalog, env) : [];
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action: hideAction,
      targetIds: [],
      timing: 'active',
      facts: { hideEligibility: { ...command.eligibility }, dc: 15 },
      obligationIds: obligations,
    }),
    ...runtimeTransition(actor.id, actor.id, actor.runtime, result.state, 'action', obligations),
    ...engineTrace(actor.id, [], result.events, obligations),
    ...boost,
  ];
}

function recordNoise(
  world: WorldState,
  command: Extract<GameCommand, { type: 'MakeNoise' }>,
): CommandResult | EventInput[] {
  const issue = noiseFactsIssue(command.facts);
  if (issue) return rejected(world, 'InvalidFacts', issue);
  const actor = world.actors[command.actorId];
  const louderThanWhisper = command.facts.loudness === 'above_whisper';
  const facts = {
    observation: 'actor_makes_noise',
    trigger: louderThanWhisper ? 'noise_above_whisper' : 'noise_at_or_below_whisper',
    noise: { ...command.facts },
  };
  const recorded: EngineEvent[] = [{
    type: 'narrative',
    text: louderThanWhisper
      ? `${actor.name} издаёт звук громче шёпота.`
      : `${actor.name} не издаёт звука громче шёпота.`,
  }];
  const after = louderThanWhisper
    ? expireEffectsForTrigger(actor.runtime, 'noise_above_whisper', recorded)
    : actor.runtime;
  const obligations = ['system:hide-lifecycle', 'system:observable-fact'];
  return [
    ...runtimeTransition(actor.id, actor.id, actor.runtime, after, 'action', obligations),
    ...engineTrace(actor.id, [], recorded, obligations, { facts }),
  ];
}

function recordEnemyFinding(
  world: WorldState,
  command: Extract<GameCommand, { type: 'FindHiddenActor' }>,
): CommandResult | EventInput[] {
  const target = world.actors[command.targetActorId];
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  if (target.id === command.actorId) {
    return rejected(world, 'InvalidTargets', 'An actor cannot be its own enemy finder');
  }
  const issue = enemyFindingFactsIssue(command.facts);
  if (issue) return rejected(world, issue[0], issue[1]);
  const finder = world.actors[command.actorId];
  const facts = {
    observation: 'enemy_finds_actor',
    targetActorId: target.id,
    finding: { ...command.facts },
  };
  const recorded: EngineEvent[] = [{
    type: 'narrative',
    text: `${finder.name} обнаруживает ${target.name}.`,
  }];
  const after = expireEffectsForTrigger(target.runtime, 'enemy_finds_actor', recorded);
  const obligations = ['system:hide-lifecycle', 'system:observable-fact'];
  return [
    ...runtimeTransition(finder.id, target.id, target.runtime, after, 'action', obligations),
    ...engineTrace(target.id, [target.id], recorded, obligations, {
      sourceActorId: finder.id,
      facts,
    }),
  ];
}

function swapAlertInitiative(
  world: WorldState,
  command: Extract<GameCommand, { type: 'SwapInitiative' }>,
): CommandResult | EventInput[] {
  if (world.scene.mode !== 'encounter'
    || world.scene.round !== 1
    || world.scene.activeIndex !== 0
    || world.scene.turnStarted) {
    return rejected(
      world,
      'InvalidActionTiming',
      'Alert Initiative Swap is available only after Initiative and before the first turn starts',
    );
  }
  const actor = world.actors[command.actorId];
  const sourceEntityIds = actor.capabilities.featureSources?.[ALERT_INITIATIVE_SWAP_CAPABILITY];
  if (!stableSourceEntityIds(sourceEntityIds)) {
    return rejected(
      world,
      'FeatureNotGranted',
      `${actor.id} does not own a mechanics-declared Alert Initiative Swap capability`,
    );
  }
  const ally = world.actors[command.allyActorId];
  if (!ally) return rejected(world, 'ActorNotFound', `Unknown ally ${command.allyActorId}`);
  if (ally.id === actor.id) return rejected(world, 'InvalidTargets', 'Alert requires a different ally');
  const factsIssue = initiativeSwapFactsIssue(command.facts, ally.controllerId);
  if (factsIssue) return rejected(world, factsIssue[0], factsIssue[1]);
  const actorIndex = world.scene.initiative.indexOf(actor.id);
  const allyIndex = world.scene.initiative.indexOf(ally.id);
  if (actorIndex < 0 || allyIndex < 0) {
    return rejected(world, 'InvalidTargets', 'Both creatures must participate in the same combat');
  }
  if (activeConditionsOf(actor.runtime).has('incapacitated')
    || activeConditionsOf(ally.runtime).has('incapacitated')) {
    return rejected(world, 'CapabilityDenied', 'Incapacitated creatures cannot use Alert Initiative Swap');
  }
  if (world.scene.initiativeSwapActorIds?.includes(actor.id)) {
    return rejected(world, 'InvalidActionTiming', `${actor.id} already swapped Initiative after this roll`);
  }

  const initiative = [...world.scene.initiative];
  [initiative[actorIndex], initiative[allyIndex]] = [initiative[allyIndex], initiative[actorIndex]];
  const scene: EncounterScene = {
    ...world.scene,
    initiative,
    initiativeSwapActorIds: [...(world.scene.initiativeSwapActorIds ?? []), actor.id],
  };
  const obligations = [
    'system:initiative-swap',
    ...sourceEntityIds.map((sourceId) => `entity:${sourceId}`),
  ];
  const facts = {
    capabilityId: ALERT_INITIATIVE_SWAP_CAPABILITY,
    sourceEntityIds: [...sourceEntityIds],
    consent: { ...command.facts },
    before: { initiative: [...world.scene.initiative] },
    after: { initiative: [...initiative] },
  };
  return [
    ...engineTrace(actor.id, [ally.id], [{
      type: 'narrative',
      text: `${actor.name} обменивается инициативой с ${ally.name} (Alert).`,
    }], obligations, { facts }),
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: { type: 'SceneSet', scene },
    },
  ];
}

function triggerHazard(
  world: WorldState,
  command: Extract<GameCommand, { type: 'TriggerHazard' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  if (command.targetActorId !== command.actorId) {
    return rejected(world, 'InvalidTargets', 'A hazard must be triggered for the command actor');
  }
  const definition = catalog.getHazard?.(command.hazardId);
  if (!definition) return rejected(world, 'HazardNotFound', `Unknown hazard ${command.hazardId}`);
  const issue = hazardDefinitionIssue(definition);
  if (issue) return rejected(world, 'InvalidHazardDefinition', issue);

  const hazard = cloneHazard(definition);
  const sourceActorId = hazardSourceId(hazard);
  const obligations = hazardObligationIds(hazard);
  if (hazard.resolution === 'automatic') {
    const target = world.actors[command.targetActorId];
    if (!target) return rejected(world, 'ActorNotFound', `Unknown actor ${command.targetActorId}`);
    const owner = hazard.sourceActorId ? world.actors[hazard.sourceActorId] : target;
    if (!owner) return rejected(world, 'ActorNotFound', `Unknown hazard origin ${hazard.sourceActorId}`);
    try {
      const result = executeAction(owner.runtime, {
        name: hazard.name,
        ...(hazard.damageSourceKind ? { damage_source_kind: hazard.damageSourceKind } : {}),
        activation: { mode: 'passive', cost: [] },
        effects: [{ resolution: 'auto', who: 'target', result: hazard.effects }],
      }, {
        ...actionContext(owner, env, target),
        grantedEffects: { ...(owner.grantedEffects ?? {}), ...(hazard.grantedEffects ?? {}) },
        selfId: owner.id,
        effectSourceId: sourceActorId,
      });
      const affected=owner.id===target.id?result.state:result.targetState??target.runtime;
      const concentration=concentrationSaveFollowUp({world,actor:target,actorAfter:affected,obligations});
      return [
        ...(owner.id === target.id ? [] : runtimeTransition(
          owner.id, owner.id, owner.runtime, result.state, 'hazard', obligations,
        )),
        ...runtimeTransition(
          sourceActorId,
          target.id,
          target.runtime,
          owner.id === target.id ? result.state : result.targetState ?? target.runtime,
          'hazard',
          obligations,
        ),
        ...engineTrace(sourceActorId, [target.id], result.events, obligations),
        ...(concentration?followUpOpenedEvents({world,commandId:command.commandId,followUps:[concentration],env}):[]),
      ];
    } catch (error) {
      return rejected(
        world,
        'InvalidHazardDefinition',
        error instanceof Error ? error.message : 'Invalid automatic hazard',
      );
    }
  }
  const resolutionId = env.nextId();
  const requestId = env.nextId();
  return [
    {
      sourceActorId,
      obligationIds: obligations,
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: resolutionId,
          type: 'hazard_save',
          openedByCommandId: command.commandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          targetActorId: command.targetActorId,
          hazard,
          request: {
            id: requestId,
            type: 'saving_throw',
            actorId: command.targetActorId,
            ability: hazard.save.ability,
            dc: hazard.save.dc,
            avoidsConditions: hazardAvoidedConditions(hazard),
          },
        },
      },
    },
  ];
}

function manualDecisionRng(command: Extract<GameCommand, { type: 'ResolveDecision' }>): {
  rng: () => number;
  assertExhausted: () => void;
} | null {
  if (command.response.kind !== 'roll' || command.response.roll.mode !== 'manual') return null;
  const tape = createStrictRngTape(command.response.roll.dice.map((die, index) => ({
    label: `manual-save-${index + 1}`,
    sides: die.sides,
    value: die.value,
  })));
  return { rng: tape.rng, assertExhausted: tape.assertExhausted };
}

function replayableSharedDamageRng(
  persisted: ReadonlyArray<{ sides: number; value: number }> | undefined,
  fallback: () => number,
): { rng: () => number; rolls: Array<{ sides: number; value: number }> } {
  const rolls = (persisted ?? []).map((entry) => ({ ...entry }));
  let cursor = 0;
  const rollDie = (sides: number): number => {
    const existing = rolls[cursor];
    if (existing) {
      if (existing.sides !== sides) {
        throw new Error(`Shared damage roll mismatch: requested d${sides}, persisted d${existing.sides}`);
      }
      cursor += 1;
      return existing.value;
    }
    const dieAware = fallback as (() => number) & { rollDie?: (requestedSides: number) => number };
    const unit = typeof dieAware.rollDie === 'function' ? null : fallback();
    if (unit != null && (!Number.isFinite(unit) || unit < 0 || unit >= 1)) {
      throw new Error(`RNG must return a finite value in [0, 1), got ${unit}`);
    }
    const generated = typeof dieAware.rollDie === 'function'
      ? dieAware.rollDie(sides)
      : Math.floor(unit! * sides) + 1;
    if (!Number.isInteger(generated) || generated < 1 || generated > sides) {
      throw new Error(`Damage RNG returned invalid d${sides} result: ${generated}`);
    }
    rolls.push({ sides, value: generated });
    cursor += 1;
    return generated;
  };
  const rng = Object.assign(
    () => {
      throw new Error('Shared damage rolls must declare die sides');
    },
    { rollDie },
  );
  return {
    rolls,
    rng,
  };
}

function afterFailureSavingThrowBoon(input: {
  target: ActorState;
  roll: RollLog;
  boonEffectId?: string;
  env: DeterministicEnvironment;
}): { runtime: ActorState['runtime']; roll: RollLog; events: EngineEvent[] } | { issue: string } {
  const { target, boonEffectId, env } = input;
  const events: EngineEvent[] = [];
  let runtime = target.runtime;
  if (input.roll.usedFailureBonus) {
    runtime = consumeNextRollEffects(runtime, 'saving_throw', events, {
      failed: true,
      onlyConditional: true,
    });
  }
  if (!boonEffectId) return { runtime, roll: input.roll, events };
  const entry = target.runtime.activeEffects.find((effect) => effect.id === boonEffectId);
  const boon = entry ? runtimeBoonSpec(entry) : null;
  if (!boon || !boon.appliesTo.includes('saving_throw')
    || !boon.timing.includes('after_failure')) {
    return { issue: 'The selected boon cannot modify this saving throw' };
  }
  if (input.roll.outcome !== 'fail') {
    return { runtime, roll: input.roll, events };
  }
  try {
    const consumed = consumeBoonAfterFailure(runtime, boonEffectId, 'saving_throw');
    const augmentedRoll = addBonusDieToD20Roll(input.roll, consumed.spec.faces, consumed.spec.name, env.rng);
    let consumedState = consumed.state;
    const refund = consumed.spec.refundOnFailure;
    const refundEvents: EngineEvent[] = [];
    if (augmentedRoll.outcome === 'fail' && refund) {
      const current = consumedState.resources[refund.resource] ?? 0;
      const maximum = consumedState.maxResources[refund.resource] ?? current + refund.amount;
      const nextValue = Math.min(maximum, current + refund.amount);
      const amount = nextValue - current;
      if (amount > 0) {
        consumedState = {
          ...consumedState,
          resources: { ...consumedState.resources, [refund.resource]: nextValue },
        };
        refundEvents.push({
          type: 'resource_restored', resource: refund.resource, amount, current: nextValue,
        });
      }
    }
    return {
      runtime: consumedState,
      roll: augmentedRoll,
      events: [...events, { type: 'effect_expired', name: consumed.spec.name }, ...refundEvents],
    };
  } catch (error) {
    return { issue: error instanceof Error ? error.message : 'Invalid boon' };
  }
}

function resolvePendingSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'target_save') {
    return rejected(world, 'NoPendingResolution', 'There is no target save to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the requested actor can resolve this saving throw');
  }
  if (command.response.kind !== 'roll') {
    return rejected(world, 'InvalidDecision', 'A saving throw requires a roll response');
  }
  const rollResponse = command.response;
  const declaredAction = catalog.getAction(pending.actionId);
  if (!declaredAction) return rejected(world, 'ActionNotFound', `Unknown action ${pending.actionId}`);
  const triggeredTargeting=bindTriggeredAttackTargeting(declaredAction,[pending.targetActorId],pending.triggeringAttack);
  if(triggeredTargeting.issue)return rejected(world,'InvalidDecision',triggeredTargeting.issue);
  const action=triggeredTargeting.action;
  const sequenceIssue = attackSequenceContinuationIssue(world, pending.attackSequence, pending, action);
  if (sequenceIssue) return rejected(world, 'InvalidDecision', sequenceIssue);
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  if (!source || !target) return rejected(world, 'ActorNotFound', 'Target-save continuation actor is missing');
  const continuationIds = [
    ...(pending.resolvedTargetIds ?? []),
    pending.targetActorId,
    ...(pending.remainingTargets ?? []).map((entry) => entry.targetActorId),
  ];
  if (new Set(continuationIds).size !== continuationIds.length) {
    return rejected(world, 'InvalidDecision', 'Target-save continuation contains duplicate actors');
  }
  const currentFactsIssue = factsIssue(action, target.id, pending.facts);
  if (currentFactsIssue) return rejected(world, 'InvalidDecision', currentFactsIssue[1]);
  for (const entry of pending.remainingTargets ?? []) {
    if (!world.actors[entry.targetActorId]) {
      return rejected(world, 'ActorNotFound', `Unknown queued target ${entry.targetActorId}`);
    }
    const issue = factsIssue(action, entry.targetActorId, entry.facts);
    if (issue) return rejected(world, 'InvalidDecision', issue[1]);
    if (!Number.isInteger(entry.save.dc) || entry.save.dc < 1 || entry.save.dc > 30) {
      return rejected(world, 'InvalidDecision', `Queued target ${entry.targetActorId} has an invalid saving throw DC`);
    }
  }
  if ((pending.sharedDamageRolls ?? []).some(({ sides, value }) => (
    !Number.isInteger(sides) || sides < 2
    || !Number.isInteger(value) || value < 1 || value > sides
  ))) {
    return rejected(world, 'InvalidDecision', 'Target-save continuation has an invalid shared damage roll');
  }
  const collected = collectRollModifiers(target.runtime, target.passives ?? [], {
    roll: 'saving_throw', filter: { ability: pending.request.ability, saveSource: pending.spell ? 'spell' : 'other',...effectRollFacts(action.mechanics) },
    formulaCtx: actorFormulaContext(target.character),
    evalCtx: {
      state: target.runtime,
      activeConditions: activeConditionsOf(target.runtime),
      savedConditions: new Set(pending.request.avoidsConditions),
    },
  });
  const proficient = target.character.saveProficiencies?.includes(pending.request.ability);
  const base = target.character.abilityMods[pending.request.ability] ?? 0;
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers: [
        { value: base, source: ABILITY_LABEL[pending.request.ability] },
        ...(proficient ? [{ value: target.character.profBonus, source: 'БМ' }] : []),
        ...collected.modifiers,
      ],
      target: { type: 'dc', value: pending.request.dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid manual roll');
  }

  const boonResolution = afterFailureSavingThrowBoon({
    target, roll, boonEffectId: rollResponse.boonEffectId, env,
  });
  if ('issue' in boonResolution) return rejected(world, 'InvalidDecision', boonResolution.issue);
  roll = boonResolution.roll;
  const targetRuntimeForResolution = boonResolution.runtime;
  const boonEvents = boonResolution.events;

  const sharedDamage = replayableSharedDamageRng(pending.sharedDamageRolls, env.rng);
  const targetForResolution = targetRuntimeForResolution === target.runtime
    ? target
    : { ...target, runtime: targetRuntimeForResolution };
  const result = executeAction(
    source.runtime,
    withoutActivationCost(action.mechanics),
    {
      ...actionContext(source, env, targetForResolution, targetRuntimeForResolution, pending.facts, pending.spell),
      triggeringAttack: pending.triggeringAttack,
      choices: pending.choices,
      spell: pending.spell,
      suppressSpellCastEvent: pending.spellCastEmitted === true,
      damageRng: sharedDamage.rng,
      forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
      forcedSaveRoll:roll,
      deferIncomingDamageConsequences:shouldDeferDamageConsequences(source,targetForResolution,action,catalog,pending.facts,world,true),
      ...(worldActionPrimitive(action) ? { externalPrimitiveHandled: true as const } : {}),
    },
  );
  const obligations=actionObligationIds(action,'system:target-save','system:pending-resolution');
  const held=damageReactionOpenedEvents({world,commandId:pending.openedByCommandId,source,target:targetForResolution,action,facts:pending.facts,
    targetRuntimeBeforeDamage:targetRuntimeForResolution,sourceRuntimeAfter:result.state,targetRuntimeAfter:result.targetState,
    attackEvents:result.events,catalog,env,obligations,...(pending.attackActionId?{attackActionId:pending.attackActionId}:{}),
  });
  if(held){
    const opened=held.find(e=>e.payload.type==='ResolutionOpened');
    if(opened?.payload.type!=='ResolutionOpened'||opened.payload.resolution.type!=='damage_reaction')throw Error('Invalid damage continuation');
    opened.payload.resolution.targetSaveContinuation={pending:JSON.parse(JSON.stringify(pending)),saveRoll:JSON.parse(JSON.stringify(roll)),sharedDamageRolls:sharedDamage.rolls.map(row=>({...row}))};
    const events:EventInput[]=[...runtimeTransition(target.id,target.id,target.runtime,targetRuntimeForResolution,'action',obligations),
      ...engineTrace(target.id,[source.id],[{type:'roll',label:`${action.name}: спасбросок ${ABILITY_LABEL[pending.request.ability]}`,roll:{...roll,kind:'save'}},...boonEvents],obligations),
      {sourceActorId:target.id,obligationIds:obligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:target.id,response:command.response}},
      {sourceActorId:target.id,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}},
    ];
    if(pending.attackActionId)events.push(...attackResolutionFinishedEvents({attackAction:world.attackActions[pending.attackActionId],resolutionId:pending.id,actorId:source.id,obligations,closeIfComplete:false}));
    events.push(...held);
    if(pending.attackActionId)events.push(blockAttackActionEvent({actorId:source.id,attackActionId:pending.attackActionId,resolutionId:opened.payload.resolution.id,obligations}));
    return events;
  }
  if(result.targetState){
    const completed=settleDamageConsequences(targetForResolution,result.targetState,result.events,env,{...source,runtime:result.state});
    result.targetState=completed.state;result.state=completed.sourceState??result.state;result.events=completed.events;
  }
  return finalizeTargetSave({world,command,pending,action,source,target,result,targetRuntimeForResolution,roll,boonEvents,sharedDamage,env});
}

function finalizeTargetSave(input:{
  world:WorldState;command:Extract<GameCommand,{type:'ResolveDecision'}>;pending:PendingTargetSaveResolution;
  action:RuleActionDefinition;source:ActorState;target:ActorState;result:ReturnType<typeof executeAction>;
  targetRuntimeForResolution:ActorState['runtime'];roll:RollLog;boonEvents:EngineEvent[];
  sharedDamage:{rolls:Array<{sides:number;value:number}>};env:DeterministicEnvironment;alreadyRecorded?:boolean;
}):EventInput[]{
  const {world,command,pending,action,source,target,result,targetRuntimeForResolution,roll,boonEvents,sharedDamage,env,alreadyRecorded}=input;
  const obligationIds = actionObligationIds(
    action,
    'system:target-save',
    'system:pending-resolution',
    ...attackSequenceObligationIds(pending.attackSequence),
    ...(pending.attackActionId ? ['system:attack-action', 'system:attack-replacement'] : []),
  );
  const saveEvent: EngineEvent = {
    type: 'roll',
    label: `${action.name}: спасбросок ${ABILITY_LABEL[pending.request.ability]}`,
    roll: { ...roll, kind: 'save' },
  };
  const targetAfter = target.id === source.id
    ? result.state
    : result.targetState ?? (targetRuntimeForResolution !== target.runtime
      ? targetRuntimeForResolution
      : undefined);
  const currentConcentrationLinks = mergeConcentrationEffectLinks(
    concentrationLinkedEffectIds(source.runtime, result.state)
      .map((effectId) => ({ actorId: source.id, effectId })),
    targetAfter && target.id !== source.id
      ? concentrationLinkedEffectIds(target.runtime, targetAfter)
        .map((effectId) => ({ actorId: target.id, effectId }))
      : [],
  );
  const accumulatedConcentrationLinks = mergeConcentrationEffectLinks(
    pending.concentrationEffectLinks ?? [],
    currentConcentrationLinks,
  );
  const damageFollowUp = concentrationSaveFollowUp({
    world,
    actor: target,
    actorAfter: targetAfter,
    obligations: obligationIds,
  });
  const followUps: PendingResolutionFollowUp[] = [
    ...(pending.followUps ?? []),
    ...(damageFollowUp ? [damageFollowUp] : []),
  ];
  const [nextTarget, ...remainingTargets] = pending.remainingTargets ?? [];
  const finalTarget = !nextTarget;
  // The target owns the saving throw, but the source player must also receive
  // its outcome. Sheet-only targets (for example the training dummy) have no
  // persisted journal of their own, so omitting the source here reduced a
  // successful save to a bare resource-spend row on the caster's sheet.
  const events: EventInput[] = alreadyRecorded ? [] : engineTrace(target.id, [source.id], [saveEvent, ...boonEvents], obligationIds);
  events.push(...actionStateEvents({
    env,
    world,
    commandId: pending.openedByCommandId,
    source,
    action,
    sourceAfter: result.state,
    ...(target.id === source.id || !targetAfter ? {} : { target, targetAfter }),
    additionalConcentrationEffectLinks: accumulatedConcentrationLinks,
    manageConcentration: finalTarget,
    obligations: obligationIds,
  }));
  const damageAdjustments = damageAdjustmentAudit(result.events);
  const resultObligations = [...new Set([
    ...obligationIds,
    ...damageAdjustments.flatMap((adjustment) => (
      adjustment.sourceEntityIds.map((sourceId) => `entity:${sourceId}`)
    )),
  ])];
  events.push(...engineTrace(
    source.id,
    [target.id],
    result.events,
    resultObligations,
    damageAdjustments.length ? { facts: { damageAdjustments } } : undefined,
  ));
  if(!alreadyRecorded) events.push({
    sourceActorId: target.id,
    obligationIds,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: target.id,
      response: command.response,
    },
  });
  events.push({
    sourceActorId: target.id,
    obligationIds,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  if (nextTarget) {
    const nextResolutionId = env.nextId();
    const nextRequestId = env.nextId();
    if (pending.attackActionId) {
      events.push(...attackResolutionFinishedEvents({
        attackAction: world.attackActions[pending.attackActionId],
        resolutionId: pending.id,
        actorId: source.id,
        obligations: obligationIds,
        closeIfComplete: false,
      }));
    }
    events.push({
      sourceActorId: source.id,
      obligationIds,
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: nextResolutionId,
          type: 'target_save',
          openedByCommandId: pending.openedByCommandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          sourceActorId: source.id,
          targetActorId: nextTarget.targetActorId,
          actionId: action.id,
          facts: { ...nextTarget.facts },
          choices: pending.choices,
          spell: pending.spell,
          request: {
            id: nextRequestId,
            type: 'saving_throw',
            actorId: nextTarget.targetActorId,
            ability: nextTarget.save.ability,
            dc: nextTarget.save.dc,
            avoidsConditions: [...nextTarget.save.avoidsConditions],
          },
          remainingTargets,
          resolvedTargetIds: [...(pending.resolvedTargetIds ?? []), target.id],
          concentrationEffectLinks: accumulatedConcentrationLinks,
          followUps,
          spellCastEmitted: true,
          sharedDamageRolls: sharedDamage.rolls.map((entry) => ({ ...entry })),
          ...(pending.attackSequence ? {
            attackSequence: JSON.parse(JSON.stringify(pending.attackSequence)) as AttackSequenceState,
          } : {}),
          ...(pending.attackActionId ? { attackActionId: pending.attackActionId } : {}),
        },
      },
    });
    if (pending.attackActionId) {
      events.push(blockAttackActionEvent({
        actorId: source.id,
        attackActionId: pending.attackActionId,
        resolutionId: nextResolutionId,
        obligations: obligationIds,
      }));
    }
  } else {
    if (pending.attackActionId) {
      events.push(...attackResolutionFinishedEvents({
        attackAction: world.attackActions[pending.attackActionId],
        resolutionId: pending.id,
        actorId: source.id,
        obligations: obligationIds,
      }));
    }
    const invalidConcentrationIds = new Set(events.flatMap((event) => (
      event.payload.type === 'ConcentrationCleared' ? [event.payload.concentrationId] : []
    )));
    events.push(...followUpOpenedEvents({
      world,
      commandId: command.commandId,
      followUps,
      env,
      invalidConcentrationIds,
    }));
  }
  return events;
}

/** Existing authoritative helpers injected into the saved decision phase. */
export interface AttackDamageContinuationServices {
  rejected: typeof rejected;
  attackAdjustmentOptions: typeof attackAdjustmentOptions;
  payCommandCost: typeof payCommandCost;
  activationCost: typeof activationCost;
  runtimeTransition: typeof runtimeTransition;
  engineTrace: typeof engineTrace;
  actorCard: typeof actorCard;
  weaponRanges: typeof weaponRanges;
  lightWeaponExtraAttackAction: typeof lightWeaponExtraAttackAction;
  selectedWeaponUsesMastery: typeof selectedWeaponUsesMastery;
  hitReactionOptions: typeof hitReactionOptions;
  attackResolutionFinishedEvents: typeof attackResolutionFinishedEvents;
  cloneReactionOption: typeof cloneReactionOption;
  blockAttackActionEvent: typeof blockAttackActionEvent;
  persistedPactBladeExecution: typeof persistedPactBladeExecution;
  cleaveWindowFor: typeof cleaveWindowFor;
  cleaveWeaponAttackAction: typeof cleaveWeaponAttackAction;
  pactBladeWeaponAttackAction: typeof pactBladeWeaponAttackAction;
  actionDefinitionIssue: typeof actionDefinitionIssue;
  spellDeclarationIssue: typeof spellDeclarationIssue;
  prepareReactionExecution: typeof prepareReactionExecution;
  actionContext: typeof actionContext;
  withoutActivationCost: typeof withoutActivationCost;
  shouldDeferDamageConsequences: typeof shouldDeferDamageConsequences;
  worldActionPrimitive: typeof worldActionPrimitive;
  resolveTemporaryHpMeleeRetaliationAfterAttack: typeof resolveTemporaryHpMeleeRetaliationAfterAttack;
  withoutPactBladeEquipmentProjection: typeof withoutPactBladeEquipmentProjection;
  actionObligationIds: typeof actionObligationIds;
  relabelAttackRolls: typeof relabelAttackRolls;
  damageReactionOpenedEvents: typeof damageReactionOpenedEvents;
  actionDeclaredEvent: typeof actionDeclaredEvent;
  settleDamageConsequences: typeof settleDamageConsequences;
  actionStateEvents: typeof actionStateEvents;
  attackFollowUpEvents: typeof attackFollowUpEvents;
  damageReactors: typeof damageReactors;
  requiredActionCapability: typeof requiredActionCapability;
  damageBeforeResistance: typeof damageBeforeResistance;
  adjustedDamageEvents: typeof adjustedDamageEvents;
  applyReactionRuntimeDelta: typeof applyReactionRuntimeDelta;
  hpAfterDamage: typeof hpAfterDamage;
  damagePackets: typeof damagePackets;
  finalizeTargetSave: typeof finalizeTargetSave;
  concentrationSaveFollowUp: typeof concentrationSaveFollowUp;
  followUpOpenedEvents: typeof followUpOpenedEvents;
}

const {resolvePendingAttack, resolvePendingDamageReaction} = createAttackDamageContinuations({
  rejected,
  attackAdjustmentOptions,
  payCommandCost,
  activationCost,
  runtimeTransition,
  engineTrace,
  actorCard,
  weaponRanges,
  lightWeaponExtraAttackAction,
  selectedWeaponUsesMastery,
  hitReactionOptions,
  attackResolutionFinishedEvents,
  cloneReactionOption,
  blockAttackActionEvent,
  persistedPactBladeExecution,
  cleaveWindowFor,
  cleaveWeaponAttackAction,
  pactBladeWeaponAttackAction,
  actionDefinitionIssue,
  spellDeclarationIssue,
  prepareReactionExecution,
  actionContext,
  withoutActivationCost,
  shouldDeferDamageConsequences,
  worldActionPrimitive,
  resolveTemporaryHpMeleeRetaliationAfterAttack,
  withoutPactBladeEquipmentProjection,
  actionObligationIds,
  relabelAttackRolls,
  damageReactionOpenedEvents,
  actionDeclaredEvent,
  settleDamageConsequences,
  actionStateEvents,
  attackFollowUpEvents,
  damageReactors,
  requiredActionCapability,
  damageBeforeResistance,
  adjustedDamageEvents,
  applyReactionRuntimeDelta,
  hpAfterDamage,
  damagePackets,
  finalizeTargetSave,
  concentrationSaveFollowUp,
  followUpOpenedEvents,
});

function resolveMagicMissileReaction(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'magic_missile_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no Magic Missile reaction to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the targeted actor can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'Magic Missile requires a reaction response');
  }
  if (command.response.actionId === null && command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'A declined reaction cannot select a spell source');
  }
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  const action = catalog.getAction(pending.actionId);
  const spec = action && source ? magicMissileSpec(catalogActionForActor(source, action)) : null;
  if (!source || !target) return rejected(world, 'ActorNotFound', 'Magic Missile continuation actor is missing');
  if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${pending.actionId}`);
  const expectedDartCount = spec && typeof pending.spell.castLevel === 'number'
    ? magicMissileDartCount(spec, pending.spell.castLevel)
    : null;
  if (!spec || expectedDartCount === null || pending.dartTargetIds.length !== expectedDartCount) {
    return rejected(world, 'InvalidDecision', 'Magic Missile continuation metadata is inconsistent');
  }
  if (pending.request.trigger.type !== 'targeted_by_magic_missile'
    || pending.request.trigger.actionId !== action.id
    || pending.request.trigger.sourceActorId !== source.id
    || pending.request.trigger.dartCount !== pending.dartTargetIds.filter((targetId) => (
      targetId === pending.targetActorId
    )).length) {
    return rejected(world, 'InvalidDecision', 'Magic Missile reaction trigger is inconsistent');
  }
  const uniqueTargetIds = pending.dartTargetIds.filter((targetId, index, all) => all.indexOf(targetId) === index);
  if (pending.targets.length !== uniqueTargetIds.length
    || pending.targets.some((entry, index) => entry.targetActorId !== uniqueTargetIds[index])) {
    return rejected(world, 'InvalidDecision', 'Magic Missile target snapshots are inconsistent');
  }
  const reactionTargetIds = [pending.targetActorId, ...pending.remainingReactions.map((entry) => entry.targetActorId)];
  if (new Set(reactionTargetIds).size !== reactionTargetIds.length
    || reactionTargetIds.some((targetId) => !uniqueTargetIds.includes(targetId))
    || reactionTargetIds.some((targetId) => pending.protectedTargetIds.includes(targetId))) {
    return rejected(world, 'InvalidDecision', 'Magic Missile reaction queue is inconsistent');
  }
  if (new Set(pending.protectedTargetIds).size !== pending.protectedTargetIds.length
    || pending.protectedTargetIds.some((targetId) => !uniqueTargetIds.includes(targetId))
    || pending.protectedTargetIds.some((targetId) => {
      const protectedActor = world.actors[targetId];
      return !protectedActor || !hasMagicMissileImmunity(protectedActor);
    })) {
    return rejected(world, 'InvalidDecision', 'Magic Missile protected targets are inconsistent');
  }
  for (const entry of pending.targets) {
    if (!world.actors[entry.targetActorId]) return rejected(world, 'ActorNotFound', `Unknown target ${entry.targetActorId}`);
    const issue = factsIssue(action, entry.targetActorId, entry.facts);
    if (issue) return rejected(world, 'InvalidDecision', issue[1]);
  }

  let selectedReaction: RuleActionDefinition | undefined;
  let selectedReactionSpell: CanonicalSpellContext | undefined;
  let selectedRuntime: ActorState['runtime'] | undefined;
  let reactionEngineEvents: EngineEvent[] = [];
  const selectedId = command.response.actionId;
  if (selectedId !== null) {
    if (!pending.request.options.some((option) => option.actionId === selectedId)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} was not offered`);
    }
    if (!target.capabilities.actionIds.includes(selectedId)) {
      return rejected(world, 'ActionNotGranted', `Actor ${target.id} does not own reaction ${selectedId}`);
    }
    const reaction = catalog.getAction(selectedId);
    if (!reaction || !hasReactionTrigger(reaction, 'targeted_by_magic_missile')
      || !grantsMagicMissileImmunity(reaction)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} cannot block Magic Missile`);
    }
    const definitionIssue = actionDefinitionIssue(reaction);
    if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
    const declarationIssue = spellDeclarationIssue(reaction);
    if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
    if (deniedCapabilities(target.runtime, target.passives ?? []).has('reaction')) {
      return rejected(world, 'CapabilityDenied', `${target.id} cannot take reactions in its current state`);
    }
    const preparedReaction = prepareReactionExecution(target, reaction, command.response.spell);
    if (preparedReaction.status === 'rejected') {
      return rejected(world, preparedReaction.code, preparedReaction.message);
    }
    const payable = canPay(target.runtime, activationCost(preparedReaction.action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing reaction resources: ${payable.missing.join(', ')}`);
    }
    selectedReaction = preparedReaction.action;
    selectedReactionSpell = preparedReaction.spell;
    const reactionResult = executeAction(target.runtime, preparedReaction.action.mechanics, {
      ...actionContext(target, env, undefined, undefined, undefined, selectedReactionSpell),
      actionName: preparedReaction.action.name,
      spell: selectedReactionSpell,
    });
    selectedRuntime = reactionResult.state;
    if (!hasMagicMissileImmunity({ ...target, runtime: selectedRuntime })) {
      return rejected(world, 'InvalidActionDefinition', `Reaction ${selectedId} did not create Magic Missile immunity`);
    }
    reactionEngineEvents = reactionResult.events;
  }

  const protectedTargetIds = selectedReaction
    ? [...new Set([...pending.protectedTargetIds, target.id])]
    : [...pending.protectedTargetIds];
  const obligations = [...new Set([
    ...actionObligationIds(
      action,
      'system:magic-missile',
      'system:reaction-window',
      'system:pending-resolution',
    ),
    ...(selectedReaction ? actionObligationIds(selectedReaction) : []),
  ])];
  const events: EventInput[] = [{
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: target.id,
      response: command.response,
    },
  }];
  if (selectedReaction) {
    events.push(actionDeclaredEvent({
      actorId: target.id,
      action: selectedReaction,
      targetIds: [target.id],
      timing: 'reaction',
      spell: selectedReactionSpell,
      facts: {
        trigger: 'targeted_by_magic_missile',
        dartCount: pending.request.trigger.dartCount,
      },
      obligationIds: obligations,
    }));
  }
  if (reactionEngineEvents.length) {
    events.push(...engineTrace(target.id, [target.id], reactionEngineEvents, obligations, {
      facts: { trigger: 'targeted_by_magic_missile' },
    }));
  }
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });

  const [nextReaction, ...remainingReactions] = pending.remainingReactions;
  if (nextReaction) {
    if (selectedReaction && selectedRuntime) {
      events.push(...actionStateEvents({
    env,
        world,
        commandId: command.commandId,
        source: target,
        action: selectedReaction,
        sourceAfter: selectedRuntime,
        obligations,
      }));
    }
    events.push(magicMissileReactionOpenedEvent({
      world,
      actionCommandId: pending.openedByCommandId,
      sourceActorId: source.id,
      actionId: action.id,
      spell: pending.spell as CanonicalSpellContext,
      dartTargetIds: pending.dartTargetIds,
      targets: pending.targets,
      protectedTargetIds,
      current: nextReaction,
      remainingReactions,
      env,
      obligations,
    }));
    return events;
  }

  const runtimeOverrides = new Map<string, ActorState['runtime']>();
  if (selectedRuntime) runtimeOverrides.set(target.id, selectedRuntime);
  events.push(...magicMissileDamageEvents({
    world,
    actionCommandId: pending.openedByCommandId,
    sourceActorId: source.id,
    ...(source.id === target.id && selectedRuntime ? { sourceRuntime: selectedRuntime } : {}),
    action,
    policy: spec,
    dartTargetIds: pending.dartTargetIds,
    targets: pending.targets,
    protectedTargetIds,
    runtimeOverrides,
    env,
    obligations,
    followUpCommandId: command.commandId,
  }));
  return events;
}

function masteryContinuationIssue(
  pending: Extract<NonNullable<WorldState['pendingResolution']>, { type: 'mastery_save' }>,
): string | null {
  if (typeof pending.mastery.sourceEntityId !== 'string' || !pending.mastery.sourceEntityId.trim()) {
    return 'Mastery continuation has no source entity';
  }
  const effect = pending.mastery.effect;
  if (effect.resolution !== 'save' || String(effect.who ?? 'target') !== 'target') {
    return 'Mastery continuation must contain one target saving throw';
  }
  if (String(effect.ability ?? 'dex') !== pending.save.ability || pending.request.ability !== pending.save.ability
    || pending.request.dc !== pending.save.dc) {
    return 'Mastery continuation save metadata is inconsistent';
  }
  if (!Number.isInteger(pending.save.dc) || pending.save.dc < 1 || pending.save.dc > 30) {
    return 'Mastery continuation has an invalid saving throw DC';
  }
  return null;
}

function resolveMasterySave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'mastery_save') {
    return rejected(world, 'NoPendingResolution', 'There is no weapon mastery save to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the mastery target can resolve this saving throw');
  }
  if (command.response.kind !== 'roll') {
    return rejected(world, 'InvalidDecision', 'A weapon mastery saving throw requires a roll response');
  }
  const issue = masteryContinuationIssue(pending);
  if (issue) return rejected(world, 'InvalidDecision', issue);
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  if (!source || !target) return rejected(world, 'ActorNotFound', 'Mastery continuation actor is missing');

  const ability = pending.request.ability;
  const collected = collectRollModifiers(target.runtime, target.passives ?? [], {
    roll: 'saving_throw', filter: { ability,...effectRollFacts(pending.mastery.effect) },
    formulaCtx: actorFormulaContext(target.character),
    evalCtx: {
      state: target.runtime,
      activeConditions: activeConditionsOf(target.runtime),
      savedConditions: new Set(pending.request.avoidsConditions),
    },
  });
  const proficient = target.character.saveProficiencies?.includes(ability);
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers: [
        { value: target.character.abilityMods[ability] ?? 0, source: ABILITY_LABEL[ability] },
        ...(proficient ? [{ value: target.character.profBonus, source: 'БМ' }] : []),
        ...collected.modifiers,
      ],
      target: { type: 'dc', value: pending.request.dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid mastery save');
  }
  const boonResolution = afterFailureSavingThrowBoon({
    target, roll, boonEffectId: command.response.boonEffectId, env,
  });
  if ('issue' in boonResolution) return rejected(world, 'InvalidDecision', boonResolution.issue);
  roll = boonResolution.roll;
  const targetRuntimeForResolution = boonResolution.runtime;

  const masteryAction: RuleActionDefinition = {
    id: pending.mastery.sourceEntityId,
    name: pending.mastery.name,
    kind: 'nonSpell',
    sourceEntityIds: [pending.mastery.sourceEntityId],
    mechanics: {
      name: pending.mastery.name,
      activation: { mode: 'triggered', cost: [] },
      effects: [pending.mastery.effect],
    },
  };
  const result = executeAction(source.runtime, masteryAction.mechanics, {
    ...actionContext(source, env, { ...target, runtime: targetRuntimeForResolution }, targetRuntimeForResolution),
    ...(pending.mastery.weaponMod == null ? {} : { weaponMod: pending.mastery.weaponMod }),
    forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
  });
  const obligations = masterySaveObligationIds(pending);
  const events: EventInput[] = engineTrace(target.id, [], [{
    type: 'roll',
    label: `${pending.mastery.name}: спасбросок ${ABILITY_LABEL[ability]}`,
    roll: { ...roll, kind: 'save' },
  }, ...boonResolution.events], obligations);
  events.push(...actionStateEvents({
    env,
    world,
    commandId: command.commandId,
    source,
    action: masteryAction,
    sourceAfter: result.state,
    target,
    targetAfter: result.targetState ?? targetRuntimeForResolution,
    obligations,
  }));
  events.push(...engineTrace(source.id, [target.id], result.events, obligations));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: target.id,
      response: command.response,
    },
  });
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });

  const masteryDamageSave = concentrationSaveFollowUp({
    world,
    actor: target,
    actorAfter: result.targetState,
    obligations,
  });
  const followUps: PendingResolutionFollowUp[] = [
    ...(pending.followUps ?? []),
    ...(masteryDamageSave ? [masteryDamageSave] : []),
  ];
  const invalidConcentrationIds = new Set(events.flatMap((event) => (
    event.payload.type === 'ConcentrationCleared' ? [event.payload.concentrationId] : []
  )));
  events.push(...followUpOpenedEvents({
    world,
    commandId: command.commandId,
    followUps,
    env,
    invalidConcentrationIds,
  }));
  return events;
}

function concentrationPreservationActions(actor:ActorState,catalog:RulesCatalog):RuleActionDefinition[]{
  return actor.capabilities.actionIds.flatMap(id=>{
    const action=catalog.getAction(id);
    return action?.kind==='nonSpell'&&action.mechanics.concentration_preservation===true
      && !activeEffectRequirementIssue(action.mechanics,actor.runtime,actor.character)
      && canPay(actor.runtime,activationCost(action)).ok ? [action] : [];
  });
}

function finishConcentrationSave(world: WorldState, pending: Extract<NonNullable<WorldState['pendingResolution']>, {type:'concentration_save'}>, command: Extract<GameCommand, {type:'ResolveDecision'}>, env: DeterministicEnvironment, preserved: boolean, events: EventInput[]): EventInput[] {
  // Earlier roll/boon and cost events already changed the runtime used for cleanup.
  world=foldEvents(world,events.map((event,ordinal)=>({...event,ordinal})));
  const actor=world.actors[pending.actorId], concentration=world.concentrations[pending.actorId];
  const obligations=['system:concentration-damage-save','system:pending-resolution'];
  if (!preserved) {
    const linkedIdsByActor = new Map<string, Set<string>>();
    for (const link of concentration.effectLinks) {
      const ids = linkedIdsByActor.get(link.actorId) ?? new Set<string>();
      ids.add(link.effectId);
      linkedIdsByActor.set(link.actorId, ids);
    }
    for (const [linkedActorId, linkedEffectIds] of [...linkedIdsByActor.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      const linkedActor = world.actors[linkedActorId];
      if (!linkedActor) continue;
      const ended = removeConcentrationEffects(linkedActor, linkedActor.runtime, linkedEffectIds, env);
      const after = ended.state;
      events.push(...engineTrace(actor.id, [linkedActor.id], ended.events, obligations));
      events.push(...runtimeTransition(actor.id, linkedActor.id, linkedActor.runtime, after, 'action', obligations));
    }
    events.push(...concentrationWorldObjectCleanup(world, concentration, obligations), {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: {
        type: 'ConcentrationCleared',
        sourceActorId: actor.id,
        concentrationId: concentration.id,
        reason: 'failed_save',
      },
    });
  }
  events.push({
    sourceActorId: actor.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  events.push(...followUpOpenedEvents({
    world,
    commandId: command.commandId,
    followUps: pending.followUps ?? [],
    env,
    ...(preserved ? {} : {
      invalidConcentrationIds: new Set([pending.concentrationId]),
    }),
  }));
  return events;
}

function resolveConcentrationSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
  catalog: RulesCatalog,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'concentration_save') {
    return rejected(world, 'NoPendingResolution', 'There is no concentration save to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.actorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the concentrating actor can resolve this save');
  }
  if (pending.request.type==='reaction') {
    if(command.response.kind!=='reaction'||!pending.heldSave)return rejected(world,'InvalidDecision','A held concentration outcome requires its saved action choice');
    const concentration=world.concentrations[pending.actorId],actor=world.actors[pending.actorId];
    if(!actor||!concentration||concentration.id!==pending.concentrationId)return rejected(world,'StaleDecision','The referenced concentration is no longer active');
    const obligations=['system:concentration-damage-save','system:pending-resolution'];
    const events:EventInput[]=[];
    if(command.response.actionId!==null){
      const selectedActionId=command.response.actionId;
      const action=concentrationPreservationActions(actor,catalog).find(row=>row.id===selectedActionId);
      if(!action||!pending.request.options.some(option=>option.actionId===action.id))return rejected(world,'InvalidDecision','The concentration preservation action is no longer available');
      const result=executeAction(actor.runtime,action.mechanics,{...actionContext(actor,env),actionName:action.name});
      events.push(...engineTrace(actor.id,[],result.events,actionObligationIds(action)),...runtimeTransition(actor.id,actor.id,actor.runtime,result.state,'action',actionObligationIds(action)));
    }
    events.push({sourceActorId:actor.id,obligationIds:obligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:actor.id,response:command.response}});
    return finishConcentrationSave(world,pending,command,env,command.response.actionId!==null,events);
  }
  if (command.response.kind !== 'roll') {
    return rejected(world, 'InvalidDecision', 'A concentration save requires a roll response');
  }
  const concentration = world.concentrations[pending.actorId];
  if (!concentration || concentration.id !== pending.concentrationId) {
    return rejected(world, 'StaleDecision', 'The referenced concentration is no longer active');
  }
  const actor = world.actors[pending.actorId];
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'saving_throw', filter: { ability: 'con', reason: 'maintain_concentration' },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const proficient = actor.character.saveProficiencies?.includes('con');
  const modifiers = [
    { value: liveCharacter(actor).abilityMods.con ?? 0, source: ABILITY_LABEL.con },
    ...(proficient ? [{ value: liveCharacter(actor).profBonus, source: 'БМ' }] : []),
    ...collected.modifiers,
  ];
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers,
      target: { type: 'dc', value: pending.request.dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid concentration roll');
  }
  const boonResolution = afterFailureSavingThrowBoon({
    target: actor, roll, boonEffectId: command.response.boonEffectId, env,
  });
  if ('issue' in boonResolution) return rejected(world, 'InvalidDecision', boonResolution.issue);
  roll = boonResolution.roll;

  const obligations = ['system:concentration-damage-save', 'system:pending-resolution'];
  const events: EventInput[] = engineTrace(actor.id, [], [{
    type: 'roll',
    label: `Концентрация (СЛ ${pending.request.dc})`,
    roll: { ...roll, kind: 'save' },
  }, ...boonResolution.events], obligations);
  if (boonResolution.runtime !== actor.runtime) {
    events.push(...runtimeTransition(
      actor.id, actor.id, actor.runtime, boonResolution.runtime, 'boon', obligations,
    ));
  }
  events.push({
    sourceActorId: actor.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: actor.id,
      response: command.response,
    },
  });
  if (roll.outcome !== 'success') {
    const candidates=concentrationPreservationActions({...actor,runtime:boonResolution.runtime},catalog);
    if(candidates.length){
      events.push({sourceActorId:actor.id,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}},
        {sourceActorId:actor.id,obligationIds:obligations,payload:{type:'ResolutionOpened',resolution:{...pending,id:env.nextId(),
          openedByCommandId:command.commandId,openedAtRevision:world.revision+1,heldSave:{roll:{...roll,kind:'save'},dc:pending.request.dc},
          request:{id:env.nextId(),type:'reaction',actorId:actor.id,trigger:{type:'event',sourceActorId:actor.id,eventKind:'concentration_save_failed'},
            options:candidates.flatMap(action=>sourceScopedReactionOptions({...actor,runtime:boonResolution.runtime},action))}}}});
      return events;
    }
  }
  return finishConcentrationSave(world,pending,command,env,roll.outcome==='success',events);
}

function resolveHazardSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'hazard_save') {
    return rejected(world, 'NoPendingResolution', 'There is no hazard save to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the affected actor can resolve this hazard save');
  }
  if (command.response.kind !== 'roll') {
    return rejected(world, 'InvalidDecision', 'A hazard saving throw requires a roll response');
  }
  const definitionIssue = hazardDefinitionIssue(pending.hazard);
  if (definitionIssue) return rejected(world, 'InvalidHazardDefinition', definitionIssue);

  const target = world.actors[pending.targetActorId];
  const ability = pending.request.ability;
  const collected = collectRollModifiers(target.runtime, target.passives ?? [], {
    roll: 'saving_throw', filter: { ability,...effectRollFacts(pending.hazard) },
    formulaCtx: actorFormulaContext(target.character),
    evalCtx: {
      state: target.runtime,
      activeConditions: activeConditionsOf(target.runtime),
      savedConditions: new Set(pending.request.avoidsConditions),
    },
  });
  const proficient = target.character.saveProficiencies?.includes(ability);
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers: [
        { value: target.character.abilityMods[ability] ?? 0, source: ABILITY_LABEL[ability] },
        ...(proficient ? [{ value: target.character.profBonus, source: 'БМ' }] : []),
        ...collected.modifiers,
      ],
      target: { type: 'dc', value: pending.request.dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid hazard save');
  }
  const boonResolution = afterFailureSavingThrowBoon({
    target, roll, boonEffectId: command.response.boonEffectId, env,
  });
  if ('issue' in boonResolution) return rejected(world, 'InvalidDecision', boonResolution.issue);
  roll = boonResolution.roll;

  const hazard = pending.hazard;
  const sourceActorId = hazardSourceId(hazard);
  const obligations = hazardObligationIds(hazard);
  const result = executeAction(boonResolution.runtime, {
    name: hazard.name,
    activation: { mode: 'passive', cost: [] },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: hazard.save.ability,
      dc: String(hazard.save.dc),
      on_fail: hazard.onFailure,
      on_success: hazard.onSuccess ?? [],
    }],
  }, {
    ...actionContext(
      target,
      env,
      { ...target, runtime: boonResolution.runtime },
      boonResolution.runtime,
    ),
    grantedEffects: { ...(target.grantedEffects ?? {}), ...(hazard.grantedEffects ?? {}) },
    selfId: target.id,
    effectSourceId: sourceActorId,
    forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
  });

  const events: EventInput[] = [];
  events.push(...engineTrace(target.id, [], [{
    type: 'roll',
    label: `${hazard.name}: спасбросок ${ABILITY_LABEL[ability]}`,
    roll: { ...roll, kind: 'save' },
  }, ...boonResolution.events], obligations));
  events.push(...runtimeTransition(
    sourceActorId,
    target.id,
    target.runtime,
    result.state,
    'hazard',
    obligations,
  ));
  events.push(...engineTrace(sourceActorId, [target.id], result.events, obligations));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: target.id,
      response: command.response,
    },
  });
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  events.push(...concentrationSaveOpenedEvents({
    world,
    commandId: command.commandId,
    actor: target,
    actorAfter: result.state,
    env,
    obligations,
  }));
  return events;
}

function studyWorldObject(
  world: WorldState,
  command: Extract<GameCommand, { type: 'StudyWorldObject' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const object = world.objects[command.objectId];
  if (!object) {
    return rejected(world, 'WorldObjectNotFound', `Unknown world object ${command.objectId}`);
  }
  if (!object.illusion) {
    return rejected(world, 'InvalidFacts', `${command.objectId} is not an illusion`);
  }
  const factsIssue = worldObjectFactsIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  if (object.illusion.form === 'image' && !command.facts.lineOfSight) {
    return rejected(world, 'LineOfSightBlocked', 'An image illusion must be visible to be studied');
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Study action`);
  }
  const cost = nonMagicActionCost(actor.runtime);
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = payCommandCost(actor, cost,env);
  const cancelled = cancelledCostEvents(actor,paid);
  if(cancelled)return cancelled;
  const skill = 'investigation';
  const proficient = actor.character.skillProficiencies?.includes(skill);
  const expertise = actor.character.skillExpertise?.includes(skill);
  const collected = collectRollModifiers(paid.state, actor.passives ?? [], {
    roll: 'ability_check',
    filter: { ability: 'int', skill },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const proficiency = expertise ? liveCharacter(actor).profBonus * 2
    : proficient ? liveCharacter(actor).profBonus : 0;
  const roll = rollD20({
    advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
    modifiers: [
      { value: liveCharacter(actor).abilityMods.int ?? 0, source: ABILITY_LABEL.int },
      ...(proficiency ? [{ value: proficiency, source: expertise ? 'Экспертиза' : 'БМ' }] : []),
      ...collected.modifiers,
    ],
    target: { type: 'dc', value: object.illusion.spellSaveDc },
    rules: collected.rules,
    rng: env.rng,
  });
  const checkEvents: EngineEvent[] = [
    ...paid.events,
    { type: 'roll', label: 'Study (Investigation)', roll: { ...roll, kind: 'check' } },
  ];
  const after = consumeNextRollEffects(paid.state, 'ability_check', checkEvents, {
    usedRuleKeys:roll.usedRuleKeys,
    filter: { ability: 'int', skill },
    failed: roll.usedFailureBonus === true,
    finalFailed: roll.usedFailureBonus === true && roll.outcome === 'fail',
  });
  const mutation = studyMinorIllusion({
    objects: world.objects,
    objectId: object.id,
    actorId: actor.id,
    checkTotal: roll.total,
  });
  const obligations = actionObligationIds(
    CORE_STUDY_WORLD_OBJECT_ACTION,
    'system:ability-check',
    'system:study-action',
    'system:minor-illusion',
  );
  const concentration = consumedConcentrationLifecycle({
    env,
    world,
    actingActorId: actor.id,
    changedActorId: actor.id,
    before: actor.runtime,
    after,
    obligations,
  });
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action: CORE_STUDY_WORLD_OBJECT_ACTION,
      targetIds: [],
      timing: 'active',
      facts: {
        objectId: object.id,
        objectFacts: JSON.parse(JSON.stringify(command.facts)) as Record<string, unknown>,
      },
      obligationIds: obligations,
    }),
    ...concentration.transitions,
    ...engineTrace(actor.id, [], checkEvents, obligations, {
      facts: { objectId: object.id, spellSaveDc: object.illusion.spellSaveDc },
    }),
    ...concentration.lifecycle,
    ...openFailedCheckBoost(world, {...actor, runtime: after}, roll, {type: 'study', objectId: object.id}, command.commandId, catalog, env),
    ...worldObjectEvents(
      actor.id,
      CORE_STUDY_WORLD_OBJECT_ACTION,
      mutation.events,
      'system:study-action',
      'system:minor-illusion',
    ),
  ];
}

function physicallyInteractWorldObject(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PhysicallyInteractWorldObject' }>,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  if (!world.objects[command.objectId]) {
    return rejected(world, 'WorldObjectNotFound', `Unknown world object ${command.objectId}`);
  }
  const factsIssue = worldObjectFactsIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  if (command.facts.touched !== true || command.facts.distanceFt !== 0) {
    return rejected(world, 'InvalidFacts', 'Physical interaction requires touched facts at distance 0');
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot physically interact with the object`);
  }
  try {
    const mutation = physicallyRevealMinorIllusion({
      objects: world.objects,
      objectId: command.objectId,
      actorId: actor.id,
    });
    const obligations = actionObligationIds(
      CORE_PHYSICAL_WORLD_INTERACTION,
      'system:minor-illusion',
      'system:physical-interaction',
    );
    return [
      actionDeclaredEvent({
        actorId: actor.id,
        action: CORE_PHYSICAL_WORLD_INTERACTION,
        targetIds: [],
        timing: 'active',
        facts: {
          objectId: command.objectId,
          objectFacts: JSON.parse(JSON.stringify(command.facts)) as Record<string, unknown>,
        },
        obligationIds: obligations,
      }),
      ...worldObjectEvents(
        actor.id,
        CORE_PHYSICAL_WORLD_INTERACTION,
        mutation.events,
        'system:minor-illusion',
        'system:physical-interaction',
      ),
    ];
  } catch (error) {
    return rejected(
      world,
      'InvalidFacts',
      error instanceof Error ? error.message : 'Invalid physical interaction',
    );
  }
}

function magicBlockingLayersIssue(layers: unknown): string | null {
  if (!Array.isArray(layers)) return 'Detect Magic blocking layers must be an array';
  const materials = ['stone', 'common_metal', 'lead', 'wood', 'dirt', 'other'];
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
      return 'Detect Magic contains a malformed blocking layer';
    }
    const value = layer as Record<string, unknown>;
    if (!materials.includes(String(value.material ?? ''))
      || !Number.isFinite(value.thicknessInches)
      || Number(value.thicknessInches) < 0) {
      return 'Detect Magic contains a malformed blocking layer';
    }
  }
  return null;
}

function revealMagicAura(
  world: WorldState,
  command: Extract<GameCommand, { type: 'RevealMagicAura' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const concentration = world.concentrations[actor.id];
  if (!concentration || concentration.id !== command.concentrationId) {
    return rejected(world, 'InvalidActionTiming', 'The actor is not maintaining this Detect Magic');
  }
  const detectMagic = catalog.getAction(concentration.actionId);
  if (!detectMagic) {
    return rejected(world, 'ActionNotFound', `Unknown concentration action ${concentration.actionId}`);
  }
  if (worldActionPrimitive(detectMagic) !== 'detect_magic_world_sensing') {
    return rejected(world, 'InvalidActionDefinition', `${detectMagic.id} is not Detect Magic`);
  }
  const parsedPolicy = parseWorldSpellPolicy(detectMagic.mechanics);
  if (parsedPolicy.status !== 'valid'
    || parsedPolicy.primitiveType !== 'detect_magic_world_sensing') {
    return rejected(
      world,
      'InvalidActionDefinition',
      `${detectMagic.id} has invalid Detect Magic policy${parsedPolicy.status === 'invalid' ? `: ${parsedPolicy.issue}` : ''}`,
    );
  }
  const detectMagicPolicy = parsedPolicy.policy as DetectMagicWorldPolicy;
  if (!command.observations || typeof command.observations !== 'object'
    || Array.isArray(command.observations)) {
    return rejected(world, 'InvalidFacts', 'Detect Magic requires an explicit observation map');
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Magic action`);
  }
  const cost = [{ resource: 'action' }];
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }

  const observationEvents: WorldObjectMutationEvent[] = [];
  for (const objectId of Object.keys(command.observations).sort()) {
    const object = world.objects[objectId];
    if (!object) {
      return rejected(world, 'WorldObjectNotFound', `Unknown world object ${objectId}`);
    }
    const input = command.observations[objectId];
    const factsIssue = worldObjectFactsIssue(input?.facts);
    if (factsIssue) return rejected(world, 'InvalidFacts', `${objectId}: ${factsIssue}`);
    const layerIssue = magicBlockingLayersIssue(input?.blockingLayers);
    if (layerIssue) return rejected(world, 'InvalidFacts', `${objectId}: ${layerIssue}`);
    const result = observeDetectMagic({
      object,
      facts: input.facts,
      blockingLayers: input.blockingLayers as MagicBlockingLayer[],
      revealAura: true,
      policy: detectMagicPolicy,
      targeting: parsedPolicy.targeting,
    });
    observationEvents.push({
      type: 'WorldObjectObserved',
      objectId,
      actorId: actor.id,
      observation: 'detect_magic_aura',
      details: {
        ...result,
        facts: JSON.parse(JSON.stringify(input.facts)) as Record<string, unknown>,
        blockingLayers: JSON.parse(JSON.stringify(input.blockingLayers)) as MagicBlockingLayer[],
      },
    });
  }

  const paid = payCommandCost(actor, cost,env);
  const cancelled = cancelledCostEvents(actor,paid);
  if(cancelled)return cancelled;
  const followUpAction: RuleActionDefinition = {
    id: 'core.action.detect-magic-aura',
    name: 'Detect Magic: reveal aura',
    kind: 'nonSpell',
    sourceEntityIds: [...new Set([
      'core:dnd5e-2024:action:magic',
      detectMagic.id,
      ...detectMagic.sourceEntityIds,
    ])] as [string, ...string[]],
    mechanics: { activation: { mode: 'active', cost } },
  };
  const obligations = actionObligationIds(
    detectMagic,
    'system:detect-magic',
    'system:magic-action',
    'system:world-object',
  );
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action: followUpAction,
      targetIds: [],
      timing: 'active',
      facts: {
        concentrationId: concentration.id,
        observations: JSON.parse(JSON.stringify(command.observations)) as Record<string, unknown>,
      },
      obligationIds: obligations,
    }),
    ...runtimeTransition(actor.id, actor.id, actor.runtime, paid.state, 'action', obligations),
    ...engineTrace(actor.id, [], paid.events, obligations),
    ...worldObjectEvents(
      actor.id,
      detectMagic,
      observationEvents,
      'system:detect-magic',
      'system:magic-action',
    ),
  ];
}

function moveActiveDancingLights(
  world: WorldState,
  command: Extract<GameCommand, { type: 'MoveDancingLights' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const concentration = world.concentrations[actor.id];
  if (!concentration || concentration.id !== command.concentrationId) {
    return rejected(world, 'InvalidActionTiming', 'The actor is not maintaining these Dancing Lights');
  }
  const action = catalog.getAction(concentration.actionId);
  if (!action) {
    return rejected(world, 'ActionNotFound', `Unknown concentration action ${concentration.actionId}`);
  }
  if (worldActionPrimitive(action) !== 'dancing_lights_world') {
    return rejected(world, 'InvalidActionDefinition', `${action.id} is not Dancing Lights`);
  }
  const parsedPolicy = parseWorldSpellPolicy(action.mechanics);
  if (parsedPolicy.status !== 'valid' || parsedPolicy.primitiveType !== 'dancing_lights_world') {
    return rejected(
      world,
      'InvalidActionDefinition',
      `${action.id} has invalid Dancing Lights policy${parsedPolicy.status === 'invalid' ? `: ${parsedPolicy.issue}` : ''}`,
    );
  }
  if (typeof command.groupId !== 'string' || !command.groupId.trim()
    || !['scenario', 'board', 'gm_ruling'].includes(command.factsSource)
    || !Number.isInteger(command.boardRevision) || command.boardRevision < 0
    || !Array.isArray(command.resultingFacts)) {
    return rejected(world, 'InvalidFacts', 'Dancing Lights movement facts are malformed');
  }
  const group = Object.values(world.objects).filter((object) => (
    object.dancingLight?.groupId === command.groupId
  ));
  if (!group.length
    || group.some((object) => (
      object.sourceActorId !== actor.id || object.sourceActionId !== action.id
    ))) {
    return rejected(world, 'InvalidFacts', 'Unknown source-owned Dancing Lights group');
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('bonus_action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take a Bonus Action`);
  }
  const cost = [{ resource: 'bonus_action' }];
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  try {
    const result = moveDancingLights({
      objects: world.objects,
      sourceActorId: actor.id,
      groupId: command.groupId,
      resultingFacts: command.resultingFacts,
      policy: parsedPolicy.policy as DancingLightsWorldPolicy,
      targeting: parsedPolicy.targeting,
    });
    const paid = payCommandCost(actor, cost,env);
  const cancelled = cancelledCostEvents(actor,paid);
  if(cancelled)return cancelled;
    const followUpAction: RuleActionDefinition = {
      id: 'core.bonus-action.dancing-lights-move',
      name: 'Dancing Lights: move lights',
      kind: 'nonSpell',
      sourceEntityIds: [...new Set([
        'core:dnd5e-2024:bonus-action',
        action.id,
        ...action.sourceEntityIds,
      ])] as [string, ...string[]],
      mechanics: { activation: { mode: 'active', cost } },
    };
    const obligations = actionObligationIds(
      action,
      'system:dancing-lights',
      'system:bonus-action',
      'system:world-object',
      'system:concentration',
    );
    return [
      actionDeclaredEvent({
        actorId: actor.id,
        action: followUpAction,
        targetIds: [],
        timing: 'active',
        facts: {
          concentrationId: concentration.id,
          groupId: command.groupId,
          factsSource: command.factsSource,
          boardRevision: command.boardRevision,
          resultingFacts: JSON.parse(JSON.stringify(command.resultingFacts)) as unknown as Record<string, unknown>,
        },
        obligationIds: obligations,
      }),
      ...runtimeTransition(actor.id, actor.id, actor.runtime, paid.state, 'action', obligations),
      ...engineTrace(actor.id, [], paid.events, obligations),
      ...worldObjectEvents(actor.id, action, result.events, 'system:dancing-lights', 'system:bonus-action'),
    ];
  } catch (error) {
    return rejected(
      world,
      'InvalidFacts',
      error instanceof Error ? error.message : 'Invalid Dancing Lights movement',
    );
  }
}

function observeActivePoisonDisease(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ObservePoisonDisease' }>,
  catalog: RulesCatalog,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const concentration = world.concentrations[actor.id];
  if (!concentration || concentration.id !== command.concentrationId) {
    return rejected(
      world,
      'InvalidActionTiming',
      'The actor is not maintaining this Detect Poison and Disease',
    );
  }
  const action = catalog.getAction(concentration.actionId);
  if (!action) {
    return rejected(world, 'ActionNotFound', `Unknown concentration action ${concentration.actionId}`);
  }
  if (worldActionPrimitive(action) !== 'detect_poison_disease_world') {
    return rejected(
      world,
      'InvalidActionDefinition',
      `${action.id} is not Detect Poison and Disease`,
    );
  }
  const parsedPolicy = parseWorldSpellPolicy(action.mechanics);
  if (parsedPolicy.status !== 'valid'
    || parsedPolicy.primitiveType !== 'detect_poison_disease_world') {
    return rejected(
      world,
      'InvalidActionDefinition',
      `${action.id} has invalid Detect Poison and Disease policy${parsedPolicy.status === 'invalid' ? `: ${parsedPolicy.issue}` : ''}`,
    );
  }
  if (!command.observations || typeof command.observations !== 'object'
    || Array.isArray(command.observations)) {
    return rejected(world, 'InvalidFacts', 'Detect Poison and Disease requires an observation map');
  }
  const observations: WorldObjectMutationEvent[] = [];
  for (const objectId of Object.keys(command.observations).sort()) {
    const object = world.objects[objectId];
    if (!object) {
      return rejected(world, 'WorldObjectNotFound', `Unknown world object ${objectId}`);
    }
    const input = command.observations[objectId];
    const factsIssue = worldObjectFactsIssue(input?.facts);
    if (factsIssue) return rejected(world, 'InvalidFacts', `${objectId}: ${factsIssue}`);
    const layerIssue = magicBlockingLayersIssue(input?.blockingLayers);
    if (layerIssue) return rejected(world, 'InvalidFacts', `${objectId}: ${layerIssue}`);
    const result = observeDetectPoisonAndDisease({
      object,
      facts: input.facts,
      blockingLayers: input.blockingLayers as MagicBlockingLayer[],
      policy: parsedPolicy.policy as DetectPoisonDiseaseWorldPolicy,
      targeting: parsedPolicy.targeting,
    });
    observations.push({
      type: 'WorldObjectObserved',
      objectId,
      actorId: actor.id,
      observation: 'detect_poison_and_disease',
      details: {
        ...result,
        concentrationId: concentration.id,
        facts: JSON.parse(JSON.stringify(input.facts)) as Record<string, unknown>,
        blockingLayers: JSON.parse(JSON.stringify(input.blockingLayers)) as MagicBlockingLayer[],
      },
    });
  }
  return worldObjectEvents(
    actor.id,
    action,
    observations,
    'system:detect-poison-disease',
    'system:concentration',
  );
}

function openFailedCheckBoost(
  world: WorldState, actor: ActorState, roll: RollLog,
  continuation: import('./domain').PendingCheckBoostResolution['continuation'],
  commandId: string, catalog: RulesCatalog, env: DeterministicEnvironment,
): EventInput[] {
  if (roll.kind !== 'd20' || roll.outcome !== 'fail' || roll.target?.type !== 'dc'
    || roll.usedFailureBonus === true) return [];
  const actions = failedCheckBoostActions(actor, catalog);
  if (!actions.length) return [];
  return [{sourceActorId: actor.id, obligationIds: ['system:ability-check', 'system:pending-resolution'], payload: {
    type: 'ResolutionOpened', resolution: {
      id: env.nextId(), type: 'check_boost', actorId: actor.id, roll,
      continuation, openedByCommandId: commandId, openedAtRevision: world.revision,
      deadlineLogicalClock: world.logicalClock + 10,
      request: {id: env.nextId(), type: 'reaction', actorId: actor.id,
        trigger: {type: 'ability_check_failed', sourceActorId: actor.id, total: roll.total, dc: roll.target.value},
        options: actions.map(action => ({actionId: action.id, label: action.name}))},
    },
  }}];
}

function resolveFailedCheckBoost(
  world: WorldState, command: Extract<GameCommand, {type: 'ResolveDecision'}>,
  catalog: RulesCatalog, env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'check_boost') return rejected(world, 'NoPendingResolution', 'Нет проваленной проверки');
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) return rejected(world, 'StaleDecision', 'Решение устарело');
  if (pending.actorId !== command.actorId || command.response.kind !== 'reaction' || command.response.spell) return rejected(world, 'InvalidDecision', 'Выберите способность для своей проверки');
  const actor = world.actors[pending.actorId];
  const trigger = pending.request.trigger;
  if (!actor || trigger.type !== 'ability_check_failed' || pending.roll.kind !== 'd20'
    || pending.roll.outcome !== 'fail' || pending.roll.target?.type !== 'dc'
    || pending.roll.total !== trigger.total || pending.roll.target.value !== trigger.dc) return rejected(world, 'InvalidDecision', 'Повреждён исходный результат проверки');
  const grapple = pending.continuation.type === 'escape_grapple' ? world.grapples[pending.continuation.grappleId] : undefined;
  if (pending.continuation.type === 'escape_grapple' && grapple?.targetActorId !== actor.id) return rejected(world, 'InvalidDecision', 'Захват больше не существует');
  const studyObject = pending.continuation.type === 'study' ? world.objects[pending.continuation.objectId] : undefined;
  if (pending.continuation.type === 'study' && studyObject?.illusion?.spellSaveDc !== trigger.dc) return rejected(world, 'InvalidDecision', 'Иллюзия для проверки изменилась');
  const actionContinuation = pending.continuation.type === 'action_ability_check' ? pending.continuation : undefined;
  let continuedAction = actionContinuation ? catalog.getAction(actionContinuation.actionId) : undefined;
  if(continuedAction&&worldActionPrimitive(continuedAction)==='item_tool'){
    try{continuedAction=bindItemTool(world,continuedAction,actionContinuation?.worldInput,actor.id);}
    catch(error){return rejected(world,'InvalidDecision',error instanceof Error?error.message:String(error));}
  }
  const continuedEffect = actionContinuation && continuedAction
    && Array.isArray(continuedAction.mechanics.effects)
    ? continuedAction.mechanics.effects[actionContinuation.effectIndex] as Record<string,unknown>|undefined
    : undefined;
  if (actionContinuation && (!continuedAction || continuedAction.id !== actionContinuation.actionId
    || !continuedEffect || continuedEffect.resolution !== 'ability_check'
    || !Array.isArray(continuedEffect.on_success)
    || (actionContinuation.targetActorId && !world.actors[actionContinuation.targetActorId]))) {
    return rejected(world,'InvalidDecision','Исход исходного действия больше нельзя продолжить');
  }
  const selected = command.response.actionId;
  const action = selected ? failedCheckBoostActions(actor, catalog).find(entry => entry.id === selected) : undefined;
  if (selected && (!action || !pending.request.options.some(option => option.actionId === selected))) return rejected(world, 'InvalidDecision', 'Способность недоступна для этой проверки');
  const obligations = ['system:ability-check', 'system:pending-resolution'];
  const events: EventInput[] = [];
  let roll = pending.roll;
  let runtime = actor.runtime;
  if (action) {
    const result = applyFailedCheckBoost(actor, action, roll, env.rng);
    roll = result.roll;
    runtime = result.runtime;
    events.push(actionDeclaredEvent({actorId: actor.id, action, targetIds: [actor.id], timing: 'active',
      facts: {failedCheckTotal: pending.roll.total, dc: trigger.dc}, obligationIds: obligations}),
      ...runtimeTransition(actor.id, actor.id, actor.runtime, result.runtime, 'ability_check', obligations),
      ...engineTrace(actor.id, [], result.events, obligations));
  }
  events.push({sourceActorId: actor.id, obligationIds: obligations, payload: {type: 'DecisionRecorded',
    resolutionId: pending.id, requestId: pending.request.id, actorId: actor.id, response: command.response}});
  if (grapple && roll.outcome === 'success') events.push({sourceActorId: actor.id, obligationIds: obligations,
    payload: {type: 'GrappleEnded', grappleId: grapple.id, reason: 'escaped'}});
  if (roll.outcome === 'success' && pending.continuation.type === 'hide') {
    const check = (CORE_HIDE_ACTION.mechanics.effects as Record<string, unknown>[])[0];
    const applied = executeAction(runtime, {name: CORE_HIDE_ACTION.name,
      effects: [{resolution: 'auto', result: check.on_success}]}, actionContext({...actor, runtime}, env));
    events.push(...runtimeTransition(actor.id, actor.id, runtime, applied.state, 'ability_check', obligations),
      ...engineTrace(actor.id, [], applied.events, obligations));
  }
  if (roll.outcome === 'success' && studyObject) {
    const mutation = studyMinorIllusion({objects: world.objects, objectId: studyObject.id, actorId: actor.id, checkTotal: roll.total});
    events.push(...worldObjectEvents(actor.id, CORE_STUDY_WORLD_OBJECT_ACTION, mutation.events, 'system:study-action', 'system:minor-illusion'));
  }
  if (actionContinuation && continuedAction && continuedEffect) {
    const target = actionContinuation.targetActorId ? world.actors[actionContinuation.targetActorId] : undefined;
    const resumed = executeAction(runtime, {
      name:continuedAction.name,
      activation:{mode:'active',cost:[]},
      effects:[{
        resolution:'auto',
        result:(roll.outcome==='success'?continuedEffect.on_success:continuedEffect.on_fail)??[],
        // Ability-check outcomes default to the target; auto effects default
        // to self. Preserve the original routing across the saved decision.
        who:continuedEffect.who ?? 'target',
        ...(continuedEffect.who_choice_id !== undefined ? {who_choice_id:continuedEffect.who_choice_id} : {}),
      }],
    }, {
      ...actionContext(
        {...actor,runtime},
        env,
        target,
        target?.runtime,
        actionContinuation.facts,
        actionContinuation.spell,
      ),
      actionName:continuedAction.name,
      choices:actionContinuation.choices,
      spell:actionContinuation.spell,
    });
    const continuationObligations=[...new Set([...obligations,...actionObligationIds(continuedAction)])];
    events.push(...runtimeTransition(actor.id,actor.id,runtime,resumed.state,'ability_check',continuationObligations));
    if(target && resumed.targetState) events.push(...runtimeTransition(actor.id,target.id,target.runtime,resumed.targetState,'ability_check',continuationObligations));
    events.push(...engineTrace(actor.id,target?[target.id]:[],resumed.events,continuationObligations));
  }
  events.push({sourceActorId: actor.id, obligationIds: obligations, payload: {type: 'ResolutionClosed', resolutionId: pending.id}});
  return events;
}
function executeCheck(
  world: WorldState,
  command: Extract<GameCommand, { type: 'AbilityCheck' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): EventInput[] {
  const actor = world.actors[command.actorId];
  const skill = command.skill?.trim().toLowerCase();
  const proficient = !!skill && actor.character.skillProficiencies?.includes(skill);
  const expertise = !!skill && actor.character.skillExpertise?.includes(skill);
  const base = liveCharacter(actor).abilityMods[command.ability] ?? 0;
  const proficiency = expertise ? liveCharacter(actor).profBonus * 2 : proficient ? liveCharacter(actor).profBonus : 0;
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'ability_check',
    filter: {
      ability: command.ability,
      ...(skill ? { skill } : {}),
      ...(command.context ? { context: command.context } : {}),
    },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const checkEvents: EngineEvent[] = [];
  const roll = rollD20({
    advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
    modifiers: [
      { value: base, source: ABILITY_LABEL[command.ability] },
      ...(proficiency ? [{ value: proficiency, source: expertise ? 'Экспертиза' : 'БМ' }] : []),
      ...collected.modifiers,
    ],
    ...(command.dc == null ? {} : { target: { type: 'dc' as const, value: command.dc } }),
    rules: collected.rules,
    rng: env.rng,
  });
  checkEvents.push({
    type: 'roll',
    label: command.skill ? `Проверка (${command.skill})` : `Проверка ${ABILITY_LABEL[command.ability]}`,
    roll: { ...roll, kind: 'check' },
  });
  const after = consumeNextRollEffects(actor.runtime, 'ability_check', checkEvents, {
    usedRuleKeys:roll.usedRuleKeys,
    filter: {
      ability: command.ability,
      ...(skill ? { skill } : {}),
      ...(command.context ? { context: command.context } : {}),
    },
    failed: roll.usedFailureBonus === true,
    finalFailed: roll.usedFailureBonus === true && roll.outcome === 'fail',
  });
  const obligations = ['system:ability-check', 'system:next-roll-effect'];
  const concentration = consumedConcentrationLifecycle({
    env,
    world,
    actingActorId: actor.id,
    changedActorId: actor.id,
    before: actor.runtime,
    after,
    obligations,
  });
  return [
    ...concentration.transitions,
    ...engineTrace(actor.id, [], checkEvents, obligations),
    ...concentration.lifecycle,
    ...openFailedCheckBoost(world, {...actor, runtime: after}, roll, {type: 'check'}, command.commandId, catalog, env),
  ];
}

function executeSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'SavingThrow' }>,
  env: DeterministicEnvironment,
): EventInput[] {
  const actor = world.actors[command.actorId];
  const proficient = actor.character.saveProficiencies?.includes(command.ability);
  const base = liveCharacter(actor).abilityMods[command.ability] ?? 0;
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'saving_throw', filter: { ability: command.ability },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const roll = rollD20({
    advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
    modifiers: [
      { value: base, source: ABILITY_LABEL[command.ability] },
      ...(proficient ? [{ value: liveCharacter(actor).profBonus, source: 'БМ' }] : []),
      ...collected.modifiers,
    ],
    target: { type: 'dc', value: command.dc },
    rules: collected.rules,
    rng: env.rng,
  });
  return engineTrace(actor.id, [], [{
    type: 'roll', label: `Спасбросок ${ABILITY_LABEL[command.ability]}`, roll: { ...roll, kind: 'save' },
  }], ['system:saving-throw']);
}

function donArmor(
  world: WorldState,
  command: Extract<GameCommand, { type: 'DonArmor' }>,
): CommandResult | EventInput[] {
  if (world.scene.mode === 'encounter') {
    return rejected(world, 'InvalidActionTiming', 'Armor can only be donned outside an encounter');
  }
  const actor = world.actors[command.actorId];
  const armor = actorCard(actor, command.armorCardId);
  if (!armor) {
    return rejected(world, 'CardNotFound', `Unknown Card ${command.armorCardId} for ${actor.id}`);
  }
  const owned = actor.runtime.inventory.some((entry) => (
    entry.cardId === armor.id && entry.qty > 0
  )) || Object.values(actor.runtime.equipment).includes(armor.id);
  if (!owned) {
    return rejected(world, 'ItemNotOwned', `${actor.id} does not own ${armor.id}`);
  }
  if (!isArmorCard(armor)) {
    return rejected(world, 'NotArmor', `${armor.id} is not wearable armor`);
  }
  if (actor.runtime.equipment.body === armor.id) {
    return rejected(world, 'InvalidEquipmentState', `${actor.id} is already wearing ${armor.id}`);
  }

  const expiryEvents: EngineEvent[] = [];
  const expired = expireEffectsForTrigger(
    actor.runtime,
    'wearer_dons_armor',
    expiryEvents,
  );
  const remainingIds = new Set(expired.activeEffects.map((effect) => effect.id));
  const endedEffectIds = actor.runtime.activeEffects
    .filter((effect) => !remainingIds.has(effect.id))
    .map((effect) => effect.id);
  const equipment = { ...actor.runtime.equipment, body: armor.id };
  const obligations = ['system:equipment', 'system:effect-lifecycle'];
  return [
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: {
        type: 'EquipmentChanged',
        actorId: actor.id,
        operation: 'don_armor',
        cardId: armor.id,
        equipment,
        endedEffectIds,
      },
    },
    ...engineTrace(actor.id, [actor.id], expiryEvents, obligations, {
      facts: { trigger: 'wearer_dons_armor', cardId: armor.id },
    }),
  ];
}

function spatialFactShapeIssue(facts: SpatialFacts | undefined): string | null {
  if (!facts || !['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)) {
    return 'Action requires explicit scenario, board, or GM facts';
  }
  if (!Number.isInteger(facts.boardRevision) || facts.boardRevision < 0
    || !Number.isFinite(facts.distanceFt) || facts.distanceFt < 0
    || (facts.positionExchangeValidated !== undefined && facts.positionExchangeValidated !== true)
    || (facts.commandedAttackValidated !== undefined && facts.commandedAttackValidated !== true)
    || (facts.maneuveringMovementValidated !== undefined && facts.maneuveringMovementValidated !== true)
    || (facts.immediateStraightMovementFt !== undefined && (!Number.isFinite(facts.immediateStraightMovementFt) || facts.immediateStraightMovementFt < 0))
    || typeof facts.lineOfSight !== 'boolean'
    || !['none', 'half', 'three_quarters', 'total'].includes(facts.cover)
    || !['self', 'ally', 'enemy', 'neutral'].includes(facts.relation)) {
    return 'Spatial facts are malformed';
  }
  return null;
}

function attackTurnKey(world: WorldState, actorId: string): string {
  return world.scene.mode === 'encounter'
    ? `encounter:${world.scene.round}:${world.scene.activeIndex}:${actorId}`
    : `exploration:${world.revision}:${actorId}`;
}

function openAttackAction(world: WorldState, actorId: string): AttackActionState | undefined {
  return Object.values(world.attackActions).find((entry) => (
    entry.actorId === actorId && entry.status === 'open'
  ));
}

function validateAttackAction(
  world: WorldState,
  actorId: string,
  attackActionId: string,
): { attackAction: AttackActionState } | { rejection: CommandResult } {
  const attackAction = world.attackActions[attackActionId];
  if (!attackAction || attackAction.actorId !== actorId) {
    return {
      rejection: rejected(world, 'AttackActionNotFound', `Unknown actor-owned Attack action ${attackActionId}`),
    };
  }
  if (attackAction.status !== 'open' || attackAction.sequence.attacksRemaining < 1) {
    return {
      rejection: rejected(world, 'AttackActionClosed', `Attack action ${attackActionId} has no attacks remaining`),
    };
  }
  if (attackAction.blockedByResolutionId) {
    return {
      rejection: rejected(
        world,
        'AttackActionBlocked',
        `Attack action ${attackActionId} is waiting for ${attackAction.blockedByResolutionId}`,
      ),
    };
  }
  if (attackAction.turnKey !== attackTurnKey(world, actorId)) {
    return {
      rejection: rejected(world, 'AttackActionClosed', `Attack action ${attackActionId} belongs to another turn`),
    };
  }
  return { attackAction };
}

function attackEntryEvent(input: {
  sourceActorId: string;
  attackActionId: string;
  entry: AttackActionState['sequence']['entries'][number];
  obligations: string[];
}): EventInput {
  return {
    sourceActorId: input.sourceActorId,
    obligationIds: input.obligations,
    payload: {
      type: 'AttackEntryCommitted',
      attackActionId: input.attackActionId,
      entry: JSON.parse(JSON.stringify(input.entry)) as typeof input.entry,
    },
  };
}

function completedAttackActionEvent(input: {
  actorId: string;
  attackActionId: string;
  attacksRemaining: number;
  obligations: string[];
}): EventInput[] {
  return input.attacksRemaining === 0 ? [{
    sourceActorId: input.actorId,
    obligationIds: input.obligations,
    payload: { type: 'AttackActionClosed', attackActionId: input.attackActionId, reason: 'completed' },
  }] : [];
}

function actionCostChoice(world:WorldState,command:Extract<GameCommand,{type:'BeginAttackAction'|'AttemptHide'}>,actorId:string,policies:ReturnType<typeof availableActionCostPolicies>,env:DeterministicEnvironment):EventInput[]{
 return [{sourceActorId:actorId,obligationIds:['system:action-cost-policy'],payload:{type:'ResolutionOpened',resolution:{
  id:env.nextId(),type:'action_cost_policy',openedByCommandId:command.commandId,openedAtRevision:world.revision,deadlineLogicalClock:world.logicalClock+10,actorId,
  continuation:JSON.parse(JSON.stringify(command)),request:{id:env.nextId(),type:'action_cost_policy',actorId,options:policies.map(({policyId,label,sourceEntity})=>({policyId,label,...(sourceEntity?{sourceEntity}:{})}))},
 }}}];
}

function beginAttackAction(
  world: WorldState,
  command: Extract<GameCommand, { type: 'BeginAttackAction' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  if (actor.familiarMetadata?.canInitiateAttackAction === false) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot initiate the Attack action`);
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Attack action`);
  }
  if (openAttackAction(world, actor.id)) {
    return rejected(world, 'InvalidActionTiming', `${actor.id} already has an open Attack action`);
  }
  const profile = actor.attackProfile;
  if (!profile || !Number.isInteger(profile.attacksPerAction) || profile.attacksPerAction < 1
    || !profile.sourceEntityIds.length) {
    return rejected(world, 'InvalidActionDefinition', `${actor.id} has no canonical Attack profile`);
  }

  const mainWeaponCardId = actor.runtime.equipment.main_hand;
  const declared = resolveDeclaredWeaponAction({
    actor,
    catalog,
    declaredActionId: command.declaredActionId,
    expectedPrimitive: WEAPON_ATTACK_PRIMITIVE,
    weaponCardId: mainWeaponCardId ?? '',
  });
  if (declared.status === 'invalid') {
    return rejected(world, 'InvalidActionDefinition', declared.issue);
  }
  const declarationAction = declared.status === 'valid' ? declared.action : CORE_ATTACK_ACTION;
  const declaredTimingCost = declared.status === 'valid'
    ? declared.cost.filter((entry) => entry.resource === 'action')
    : activationCost(CORE_ATTACK_ACTION);
  const declarationActivation = declarationAction.mechanics.activation as Record<string, unknown> | undefined;
  const originalTimingMechanics={...declarationAction.mechanics,activation:{...(declarationActivation??{}),cost:declaredTimingCost}};
  const policyContext={state:actor.runtime,character:actor.character,passives:actor.passives??[],actionRefs:[declarationAction.id,...declarationAction.sourceEntityIds],actionCategory:'attack'};
  const optional=availableActionCostPolicies(originalTimingMechanics,policyContext).filter(policy=>policy.optional);
  if(command.selectedCostPolicyId===undefined&&optional.length)return actionCostChoice(world,command,actor.id,optional,env);
  let applied:ReturnType<typeof applyActionCostPolicies>;
  try{applied=applyActionCostPolicies(originalTimingMechanics,policyContext,command.selectedCostPolicyId);}
  catch(error){return rejected(world,'InvalidDecision',error instanceof Error?error.message:'Invalid attack cost policy');}
  const attackBudget=attackActionBudget(actor,applied.appliedPolicyIds,policyContext.actionRefs);
  const timingAction:RuleActionDefinition={...declarationAction,mechanics:projectActionSurgeCost(applied.mechanics,actor.runtime,'nonspell')};
  const timingCost = activationCost(timingAction);
  const payable = canPay(actor.runtime, timingCost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = payCommandCost(actor, timingCost,env);
  const cancelled = cancelledCostEvents(actor,paid);
  if(cancelled)return cancelled;
  const attackActionId = env.nextId();
  const sequence = beginAttackSequence({
    id: attackActionId,
    actorId: actor.id,
    totalAttacks: attackBudget.value,
  });
  const attackAction: AttackActionState = {
    id: attackActionId,
    actorId: actor.id,
    startedAtRevision: world.revision,
    turnKey: attackTurnKey(world, actor.id),
    status: 'open',
    sequence,
    ...(applied.appliedPolicyIds.length?{costPolicyIds:applied.appliedPolicyIds}:{}),
    ...(declared.status === 'valid' ? {
      declaredActionId: declared.action.id,
      declaredActionSourceEntityIds: [...declared.action.sourceEntityIds] as [string, ...string[]],
    } : {}),
  };
  const obligations = [
    'system:attack-action',
    'system:action-declaration',
    ...(declared.status === 'valid' ? [`entity:${declared.action.id}`] : []),
    ...declarationAction.sourceEntityIds.map((id) => `entity:${id}`),
    ...profile.sourceEntityIds.map((id) => `entity:${id}`),
  ];
  const events:EventInput[] = [
    actionDeclaredEvent({
      actorId: actor.id,
      action: declarationAction,
      targetIds: [],
      timing: 'active',
      facts: {
        attackActionId,
        attacksPerAction: attackBudget.value, attackCountSources:attackBudget.sources,
        ...(declared.status === 'valid' ? { declaredActionId: declared.action.id } : {}),
        attackProfileSourceEntityIds: [...profile.sourceEntityIds],
      },
      obligationIds: obligations,
    }),
    ...runtimeTransition(actor.id, actor.id, actor.runtime, paid.state, 'action', obligations),
    ...engineTrace(actor.id, [], paid.events, obligations),
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: { type: 'AttackActionStarted', attackAction },
    },
  ];
  if(command.afterBegin){
    if(!['PerformWeaponAttack','PerformUnarmedStrike'].includes(command.afterBegin.type))return rejected(world,'InvalidActionDefinition','Invalid first Attack entry');
    const ready=foldEvents(world,events.map((event,ordinal)=>({...event,ordinal})));
    const continuation=executeCommand(ready,{...command,...command.afterBegin,attackActionId},catalog,env);
    return Array.isArray(continuation)?[...events,...continuation]:continuation;
  }
  return events;
}

function weaponRanges(
  card: NonNullable<ReturnType<typeof actorCard>>,
  distanceFt: number,
): {
  kind: 'melee' | 'ranged';
  normalFt: number;
  longFt: number;
} | null {
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) return null;
  const mode = weaponAttackModeAtDistance(parsed.profile, distanceFt);
  if (!mode) return null;
  return mode.kind === 'melee'
    ? { kind: 'melee', normalFt: mode.reachFt, longFt: mode.reachFt }
    : { kind: 'ranged', normalFt: mode.normalFt, longFt: mode.longFt };
}

function attackDisadvantagePassive(reason: string): Record<string, unknown> {
  return {
    name: reason,
    kind: 'modifier',
    applies_to: { roll: 'attack' },
    op: 'disadvantage',
    source: reason,
  };
}

function attackTargetWithCover(target: ActorState, cover: SpatialFacts['cover']): ActorState {
  const bonus = cover === 'half' ? 2 : cover === 'three_quarters' ? 5 : 0;
  return bonus ? { ...target, ac: (target.ac ?? effectiveArmorClass(target, {...target.runtime, activeEffects: []})) + bonus } : target;
}

function pactBladeWeaponAttackAction(
  action: RuleActionDefinition,
  projection: PactBladeAttackContinuationProjection,
): RuleActionDefinition {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Record<string, unknown>[]
    : [];
  return {
    ...action,
    mechanics: {
      ...action.mechanics,
      effects: effects.map((effect) => {
        if (effect.resolution !== 'attack_roll') return { ...effect };
        const onHit = Array.isArray(effect.on_hit)
          ? effect.on_hit as Record<string, unknown>[]
          : [];
        return {
          ...effect,
          ability: projection.attackAbility,
          on_hit: onHit.map((payload) => payload.dice === 'weapon'
            ? { ...payload, ability: projection.damageAbility }
            : { ...payload }),
        };
      }),
    },
  };
}

function pactBladeExecutionActor(input: {
  actor: ActorState;
  card: NonNullable<ReturnType<NonNullable<RulesCatalog['getCard']>>>;
  hand: 'main' | 'off';
  projection: PactBladeAttackContinuationProjection;
}): ActorState {
  const parsedProfile = parseWeaponProfile(input.card);
  if (!parsedProfile.valid) throw new Error(parsedProfile.issue);
  const mechanics = input.card.mechanics as Record<string, unknown>;
  const rawProfile = mechanics.weapon_profile as Record<string, unknown>;
  const damageLines = rawProfile.damage_lines as Record<string, unknown>[];
  const projectedCard = {
    ...input.card,
    damage_type: input.projection.resolvedDamageType,
    mechanics: {
      ...mechanics,
      weapon_profile: {
        ...rawProfile,
        damage_lines: damageLines.map((line, index) => index === 0
          ? { ...line, type: input.projection.resolvedDamageType }
          : { ...line }),
      },
    },
  };
  const replaceCard = (cards: typeof input.actor.character.knownCards | undefined) => [
    ...(cards ?? []).filter((candidate) => candidate.id !== projectedCard.id),
    projectedCard,
  ];
  const proficiencies = new Set(input.actor.character.weaponProficiencies ?? []);
  if (projectedCard.weapon_type) proficiencies.add(projectedCard.weapon_type);
  const slot = input.hand === 'main' ? 'main_hand' : 'off_hand';
  return {
    ...input.actor,
    character: {
      ...input.actor.character,
      knownCards: replaceCard(input.actor.character.knownCards),
      equippedCards: replaceCard(input.actor.character.equippedCards),
      weaponProficiencies: [...proficiencies],
    },
    runtime: {
      ...input.actor.runtime,
      equipment: { ...input.actor.runtime.equipment, [slot]: projectedCard.id },
    },
  };
}

function withoutPactBladeEquipmentProjection(
  runtime: ActorState['runtime'],
  canonical: ActorState['runtime'],
): ActorState['runtime'] {
  return { ...runtime, equipment: canonical.equipment };
}

function pactBladeContinuationProjection(input: {
  selection: PactBladeAttackSelection;
  event: Extract<RuleEventPayload, { type: 'PactBladeAttackProjected' }>;
}): PactBladeAttackContinuationProjection {
  return {
    weaponObjectId: input.event.weaponObjectId,
    weaponCardId: input.event.weaponCardId,
    weaponHand: input.selection.hand === 'off_hand' ? 'off' : 'main',
    abilityChoice: input.selection.abilityChoice,
    attackAbility: input.event.projection.attackAbility,
    damageAbility: input.event.projection.damageAbility,
    damageChoice: input.selection.damageType,
    resolvedDamageType: input.event.projection.damageType,
  };
}

function persistedPactBladeExecution(input: {
  world: WorldState;
  catalog: RulesCatalog;
  source: ActorState;
  commandId: string;
  projection: PactBladeAttackContinuationProjection;
}): {
  actor: ActorState;
  card: NonNullable<ReturnType<NonNullable<RulesCatalog['getCard']>>>;
} | { issue: string } {
  const planned = planPactBladeAttackProjection({
    world: input.world,
    catalog: input.catalog,
    actorId: input.source.id,
    commandId: input.commandId,
    selection: {
      weaponObjectId: input.projection.weaponObjectId,
      hand: input.projection.weaponHand === 'off' ? 'off_hand' : 'main_hand',
      abilityChoice: input.projection.abilityChoice,
      damageType: input.projection.damageChoice,
    },
  });
  if (planned.status === 'rejected') return { issue: planned.message };
  const expected = pactBladeContinuationProjection({
    selection: {
      weaponObjectId: input.projection.weaponObjectId,
      hand: input.projection.weaponHand === 'off' ? 'off_hand' : 'main_hand',
      abilityChoice: input.projection.abilityChoice,
      damageType: input.projection.damageChoice,
    },
    event: planned.event,
  });
  if (JSON.stringify(expected) !== JSON.stringify(input.projection)) {
    return { issue: 'Persisted Pact Blade attack projection diverges from canonical state' };
  }
  const card = input.catalog.getCard?.(input.projection.weaponCardId);
  if (!card || card.type !== 'weapon') {
    return { issue: 'Persisted Pact Blade Card is unavailable or no longer a weapon' };
  }
  const parsedProfile = parseWeaponProfile(card);
  if (!parsedProfile.valid) return { issue: parsedProfile.issue };
  return {
    card,
    actor: pactBladeExecutionActor({
      actor: input.source,
      card,
      hand: input.projection.weaponHand,
      projection: input.projection,
    }),
  };
}

function lightWeaponExtraAttackAction(
  source: ActorState,
  hand: 'main' | 'off',
  rangeKind: 'melee' | 'ranged',
  actionEconomy: 'bonus_action' | 'attack_action' = 'bonus_action',
): RuleActionDefinition | null {
  const weapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime, source.passives);
  if (!weapon) return null;
  const effect = (
    CORE_LIGHT_WEAPON_EXTRA_ATTACK.mechanics.effects as Record<string, unknown>[]
  )[0];
  const onHit = Array.isArray(effect.on_hit)
    ? effect.on_hit as Record<string, unknown>[]
    : [];
  const abilityModifier = liveCharacter(source).abilityMods[weapon.ability] ?? 0;
  return {
    ...CORE_LIGHT_WEAPON_EXTRA_ATTACK,
    mechanics: {
      ...CORE_LIGHT_WEAPON_EXTRA_ATTACK.mechanics,
      activation: {
        mode: actionEconomy === 'attack_action' ? 'attack_entry' : 'active',
        cost: actionEconomy === 'attack_action' ? [] : [{ resource: 'bonus_action' }],
      },
      effects: [{
        ...effect,
        part_of_attack_action: actionEconomy === 'attack_action',
        attack_kind: rangeKind === 'ranged' ? 'weapon_ranged' : 'weapon_melee',
        tags: [
          'light_property_extra_attack',
          ...(hand === 'off' ? ['off_hand'] : []),
        ],
        on_hit: onHit.map((payload) => payload.dice === 'weapon'
          ? {
            ...payload,
            ability: lightWeaponExtraAttackDamageAbility(abilityModifier),
          }
          : payload),
      }],
    },
  };
}

function selectedWeaponUsesMastery(
  actor: ActorState,
  weaponCardId: string,
  type: 'nick' | 'cleave',
): boolean {
  const hand = actor.runtime.equipment.main_hand === weaponCardId
    ? 'main'
    : actor.runtime.equipment.off_hand === weaponCardId
      ? 'off'
      : null;
  if (!hand) return false;
  return actorWeaponHasMasteryPrimitive({
    weapon: weaponContext(actor.character, hand, actor.runtime.equipment, actor.runtime, actor.passives),
    selectedWeaponTypes: actor.character.weaponMasteries,
    masteryEffects: actor.masteryEffects,
    type,
  });
}

type CleaveWindowEntry = ActorState['runtime']['activeEffects'][number];

function cleaveWindowFor(input: {
  actor: ActorState;
  attackActionId?: string;
  weaponCardId: string;
  committedByCommandId?: string;
}): CleaveWindowEntry | undefined {
  return input.actor.runtime.activeEffects.find((entry) => {
    const mechanics = entry.mechanics as Record<string, unknown>;
    return mechanics.kind === 'attack_follow_up'
      && mechanics.follow_up === 'cleave'
      && mechanics.weaponCardId === input.weaponCardId
      && (input.attackActionId === undefined || mechanics.attackActionId === input.attackActionId)
      && (input.committedByCommandId === undefined
        || mechanics.committedByCommandId === input.committedByCommandId);
  });
}

function cleaveWeaponAttackAction(
  source: ActorState,
  hand: 'main' | 'off',
): RuleActionDefinition | null {
  const weapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime, source.passives);
  if (!weapon) return null;
  const base = weaponAttackAction(hand, 'melee');
  const effect = (base.mechanics.effects as Record<string, unknown>[])[0];
  const onHit = Array.isArray(effect.on_hit)
    ? effect.on_hit as Record<string, unknown>[]
    : [];
  const abilityModifier = liveCharacter(source).abilityMods[weapon.ability] ?? 0;
  return {
    ...base,
    mechanics: {
      ...base.mechanics,
      activation: { mode: 'attack_entry', cost: [] },
      effects: [{
        ...effect,
        tags: [
          'weapon_mastery_cleave_attack',
          ...(hand === 'off' ? ['off_hand'] : []),
        ],
        on_hit: onHit.map((payload) => payload.dice === 'weapon'
          ? {
            ...payload,
            // Cleave keeps a negative ability modifier but omits zero/positive.
            ability: abilityModifier < 0 ? 'auto' : 'none',
          }
          : payload),
      }],
    },
  };
}

function blockAttackActionEvent(input: {
  actorId: string;
  attackActionId: string;
  resolutionId: string;
  obligations: string[];
}): EventInput {
  return {
    sourceActorId: input.actorId,
    obligationIds: input.obligations,
    payload: {
      type: 'AttackActionBlocked',
      attackActionId: input.attackActionId,
      resolutionId: input.resolutionId,
    },
  };
}

type DeclaredWeaponActionResolution =
  | { status: 'none' }
  | {
    status: 'valid';
    action: RuleActionDefinition;
    cost: Record<string, unknown>[];
    sourceEntityIds: string[];
  }
  | { status: 'invalid'; issue: string };

/**
 * Rebuild a contextual weapon cost from immutable catalog bytes plus the
 * authoritative actor equipment. Commands may select an action id, but can
 * never submit card_id, amount, hand, or action-economy cost themselves.
 */
function resolveDeclaredWeaponAction(input: {
  actor: ActorState;
  catalog: RulesCatalog;
  declaredActionId: string | undefined;
  expectedPrimitive: DeclaredWeaponActionPrimitive;
  weaponCardId: string;
}): DeclaredWeaponActionResolution {
  if (!input.declaredActionId) return { status: 'none' };
  const action = input.catalog.getAction(input.declaredActionId);
  if (!action) {
    return { status: 'invalid', issue: `Unknown declared weapon action ${input.declaredActionId}` };
  }
  if (!input.actor.capabilities.actionIds.includes(action.id)) {
    return { status: 'invalid', issue: `${input.actor.id} is not granted ${action.id}` };
  }
  const template = parseDeclaredWeaponActionPolicy(action, 'template');
  if (template.status !== 'valid') return template;
  if (template.policy.primitive !== input.expectedPrimitive) {
    return {
      status: 'invalid',
      issue: `${action.id} declares ${template.policy.primitive}, expected ${input.expectedPrimitive}`,
    };
  }
  const equipmentSlot = template.policy.hand === 'main' ? 'main_hand' : 'off_hand';
  if (input.actor.runtime.equipment[equipmentSlot] !== input.weaponCardId) {
    return {
      status: 'invalid',
      issue: `${action.id} requires the weapon selected in ${equipmentSlot}`,
    };
  }
  const cards = new Map([
    ...(input.actor.character.knownCards ?? []),
    ...(input.actor.character.equippedCards ?? []),
  ].map((card) => [card.id, card] as const));
  let boundMechanics: Record<string, unknown>;
  try {
    boundMechanics = bindEquippedWeaponActionContext(
      action.mechanics,
      input.actor.runtime.equipment,
      cards,
    );
  } catch (error) {
    return {
      status: 'invalid',
      issue: error instanceof Error ? error.message : `${action.id} contextual cost is invalid`,
    };
  }
  const bound: RuleActionDefinition = {
    ...action,
    mechanics: boundMechanics,
    targeting: compileDeclaredMechanicsTargeting(boundMechanics),
  };
  const parsed = parseDeclaredWeaponActionPolicy(bound, 'bound');
  if (parsed.status !== 'valid') return parsed;
  return {
    status: 'valid',
    action: bound,
    cost: parsed.policy.activationCost.map((entry) => ({ ...entry })),
    sourceEntityIds: [...action.sourceEntityIds],
  };
}

function withoutTimingCost(
  cost: readonly Record<string, unknown>[],
  resource: 'action' | 'bonus_action',
): Record<string, unknown>[] {
  return cost.filter((entry) => entry.resource !== resource).map((entry) => ({ ...entry }));
}

function actionWithoutActivationCost(action: RuleActionDefinition): RuleActionDefinition {
  const activation = action.mechanics.activation;
  return {
    ...action,
    mechanics: {
      ...action.mechanics,
      activation: {
        ...(activation && typeof activation === 'object' && !Array.isArray(activation)
          ? activation as Record<string, unknown>
          : {}),
        cost: [],
      },
    },
  };
}

function performWeaponAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PerformWeaponAttack' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const validated = validateAttackAction(world, command.actorId, command.attackActionId);
  if ('rejection' in validated) return validated.rejection;
  const { attackAction } = validated;
  const source = world.actors[command.actorId];
  const declaredWeaponAction = resolveDeclaredWeaponAction({
    actor: source,
    catalog,
    declaredActionId: command.declaredActionId,
    expectedPrimitive: WEAPON_ATTACK_PRIMITIVE,
    weaponCardId: command.weaponCardId,
  });
  if (declaredWeaponAction.status === 'invalid') {
    return rejected(world, 'InvalidActionDefinition', declaredWeaponAction.issue);
  }
  if (attackAction.declaredActionId !== command.declaredActionId) {
    return rejected(
      world,
      'InvalidActionDefinition',
      'Weapon attack declaration does not match the Attack ledger authority',
    );
  }
  if (declaredWeaponAction.status === 'valid'
    && JSON.stringify(attackAction.declaredActionSourceEntityIds)
      !== JSON.stringify(declaredWeaponAction.action.sourceEntityIds)) {
    return rejected(
      world,
      'InvalidActionDefinition',
      'Weapon attack declaration provenance differs from the Attack ledger',
    );
  }
  const declaredCost = declaredWeaponAction.status === 'valid'
    ? withoutTimingCost(declaredWeaponAction.cost, 'action')
    : [];
  const payable = canPay(source.runtime, declaredCost);
  if (!payable.ok) {
    return rejected(
      world,
      'InsufficientResources',
      `Cannot pay ${command.declaredActionId}: ${payable.missing.join(', ')}`,
    );
  }
  const declaredPayment = payCommandCost(source, declaredCost,env);
  const cancelled = cancelledCostEvents(source,declaredPayment);
  if(cancelled)return cancelled;
  const target = world.actors[command.targetActorId];
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  if (target.id === source.id) return rejected(world, 'InvalidTargets', 'A weapon attack cannot target its attacker');
  const conditionDenial = harmfulConditionRejection({
    world,
    attackerActorId: source.id,
    targetActorIds: [target.id],
  });
  if (conditionDenial) return conditionDenial;
  const factsIssue = spatialFactShapeIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  if (!command.facts.lineOfSight || command.facts.cover === 'total') {
    return rejected(world, 'LineOfSightBlocked', `Line of sight to ${target.id} is blocked`);
  }
  const hasPactObject = command.weaponObjectId !== undefined;
  const hasPactChoice = command.pactBlade !== undefined;
  if (hasPactObject !== hasPactChoice) {
    return rejected(
      world,
      'InvalidEquipmentState',
      'A Pact Blade attack requires both its concrete item instance and per-attack choices',
    );
  }
  let card = actorCard(source, command.weaponCardId);
  let hand: 'main' | 'off';
  let executionSource = source;
  let pactProjection: PactBladeAttackContinuationProjection | undefined;
  let pactProjectionEvent: EventInput | undefined;
  if (hasPactObject && hasPactChoice) {
    const object = world.objects[command.weaponObjectId!];
    if (!object) {
      return rejected(world, 'WorldObjectNotFound', `Unknown world object ${command.weaponObjectId}`);
    }
    if (object.heldInHand !== 'main_hand' && object.heldInHand !== 'off_hand') {
      return rejected(world, 'WeaponNotEquipped', 'The active Pact Blade is not held in a hand');
    }
    const selection: PactBladeAttackSelection = {
      weaponObjectId: command.weaponObjectId!,
      hand: object.heldInHand,
      abilityChoice: command.pactBlade!.abilityChoice,
      damageType: command.pactBlade!.damageType,
    };
    const planned = planPactBladeAttackProjection({
      world,
      catalog,
      actorId: source.id,
      commandId: command.commandId,
      selection,
    });
    if (planned.status === 'rejected') {
      return rejected(world, pactBladeRejectionCode(planned.code), planned.message);
    }
    if (planned.event.weaponCardId !== command.weaponCardId) {
      return rejected(world, 'InvalidEquipmentState', 'Attack Card is not the active Pact Blade Card');
    }
    card = catalog.getCard?.(planned.event.weaponCardId);
    if (!card) {
      return rejected(world, 'CardNotFound', `Unknown immutable Pact Blade Card ${planned.event.weaponCardId}`);
    }
    const pactWeaponProfile = parseWeaponProfile(card);
    if (!pactWeaponProfile.valid) {
      return rejected(world, 'InvalidEquipmentState', pactWeaponProfile.issue);
    }
    hand = selection.hand === 'off_hand' ? 'off' : 'main';
    pactProjection = pactBladeContinuationProjection({ selection, event: planned.event });
    executionSource = pactBladeExecutionActor({
      actor: source,
      card,
      hand,
      projection: pactProjection,
    });
    pactProjectionEvent = {
      sourceActorId: source.id,
      obligationIds: [
        'system:pact-blade-attack',
        `entity:${planned.event.sourceEntityId}`,
        `entity:${planned.event.weaponCardId}`,
      ],
      payload: planned.event,
    };
  } else {
    if (!card) {
      return rejected(world, 'CardNotFound', `Unknown Card ${command.weaponCardId} for ${source.id}`);
    }
    const equippedCard = card;
    const handEntry = Object.entries(source.runtime.equipment).find(([slot, cardId]) => (
      (slot === 'main_hand' || slot === 'off_hand') && cardId === equippedCard.id
    ));
    if (!handEntry) {
      return rejected(world, 'WeaponNotEquipped', `${source.id} has not equipped ${card.id} in a hand`);
    }
    hand = handEntry[0] === 'off_hand' ? 'off' : 'main';
    if (!source.runtime.inventory.some((entry) => entry.cardId === card!.id && entry.qty > 0)
      && !Object.values(source.runtime.equipment).includes(card.id)) {
      return rejected(world, 'ItemNotOwned', `${source.id} does not own ${card.id}`);
    }
    if (!weaponContext(source.character, hand, source.runtime.equipment, source.runtime, source.passives)) {
      return rejected(world, 'InvalidEquipmentState', `${card.id} cannot resolve from ${hand}_hand`);
    }
  }
  if (!card || card.type !== 'weapon') {
    return rejected(world, 'NotWeapon', `${card?.id ?? command.weaponCardId} is not an immutable weapon Card`);
  }
  const profileResult = parseWeaponProfile(card);
  if (!profileResult.valid) {
    return rejected(world, 'InvalidEquipmentState', profileResult.issue);
  }
  const resolvedWeapon = weaponContext(
    executionSource.character,
    hand,
    executionSource.runtime.equipment,
    executionSource.runtime,
    executionSource.passives,
  );
  if (!resolvedWeapon || resolvedWeapon.cardId !== card.id) {
    return rejected(world, 'InvalidEquipmentState', `${card.id} has no valid equipped weapon_profile`);
  }
  if (declaredWeaponAction.status === 'valid'
    && (!declaredWeaponAction.action.targeting
      || command.facts.distanceFt > declaredWeaponAction.action.targeting.rangeFt)) {
    return rejected(
      world,
      'OutOfRange',
      `${target.id} is outside the actor-bound weapon targeting contract`,
    );
  }
  const range = weaponRanges(card, command.facts.distanceFt);
  if (!range) {
    return rejected(world, 'OutOfRange', `${target.id} is outside every declared weapon attack mode`);
  }
  const heavy = evaluateWeaponHeavyRule(
    profileResult.profile,
    range.kind,
    executionSource.character.abilityScores,
  );
  if (heavy && !heavy.valid) {
    return rejected(world, 'InvalidEquipmentState', heavy.issue);
  }
  const generalFeatDeclaration = generalFeatRangedDeclaration({
    actor: source,
    rangeKind: range.kind,
    weaponName: card.name,
    weaponType: profileResult.profile.weaponType,
  });
  const disadvantageReasons = [
    ...(heavy?.valid && heavy.disadvantage
      ? [`Heavy (${heavy.ability.toUpperCase()} below ${heavy.threshold})`]
      : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt > range.normalFt
      && !generalFeatDeclaration.ignoreLongRangeDisadvantage ? ['Long range'] : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt <= 5 && command.facts.relation === 'enemy'
      && !generalFeatDeclaration.ignoreAdjacentEnemyDisadvantage
      ? ['Ranged attack in close combat'] : []),
  ];
  const baseAction = weaponAttackAction(hand, range.kind);
  const projectedAction = pactProjection
    ? pactBladeWeaponAttackAction(baseAction, pactProjection)
    : baseAction;
  const action: RuleActionDefinition = declaredWeaponAction.status === 'valid'
    ? {
      ...projectedAction,
      targeting: declaredWeaponAction.action.targeting,
      sourceEntityIds: [...new Set([
        ...projectedAction.sourceEntityIds,
        declaredWeaponAction.action.id,
        ...declaredWeaponAction.sourceEntityIds,
      ])] as [string, ...string[]],
    }
    : projectedAction;
  const paidExecutionSource: ActorState = {
    ...executionSource,
    runtime: declaredWeaponAction.status === 'valid'
      ? {
        ...executionSource.runtime,
        resources: declaredPayment.state.resources,
        inventory: declaredPayment.state.inventory,
      }
      : executionSource.runtime,
  };
  const featDamagePassives = generalFeatWeaponDamagePassives({
    actor: source,
    profile: profileResult.profile,
    attackActionId: attackAction.id,
    ownTurn: world.scene.mode === 'encounter'
      && world.scene.initiative[world.scene.activeIndex] === source.id,
  });
  const sourceForAttack: ActorState = disadvantageReasons.length || featDamagePassives.length ? {
    ...paidExecutionSource,
    passives: [
      ...(paidExecutionSource.passives ?? []),
      ...featDamagePassives,
      ...disadvantageReasons.map(attackDisadvantagePassive),
    ],
  } : paidExecutionSource;
  const targetForAttack = attackTargetWithCover(target,
    generalFeatDeclaration.ignoreHalfAndThreeQuarterCover ? 'none' : command.facts.cover);
  const nextSequence = performWeaponSequenceAttack({
    sequence: attackAction.sequence,
    actionId: action.id,
    weaponCardId: card.id,
    sourceEntityIds: [
      ...action.sourceEntityIds,
      `card:${card.id}`,
      ...(pactProjectionEvent?.payload.type === 'PactBladeAttackProjected'
        ? [pactProjectionEvent.payload.sourceEntityId]
        : []),
    ] as [string, ...string[]],
  });
  const entry = nextSequence.entries.at(-1)!;
  const obligations = [
    'system:attack-action',
    'system:weapon-attack',
    `entity:${card.id}`,
    ...(pactProjectionEvent?.payload.type === 'PactBladeAttackProjected'
      ? ['system:pact-blade-attack', `entity:${pactProjectionEvent.payload.sourceEntityId}`]
      : []),
    ...action.sourceEntityIds.map((id) => `entity:${id}`),
  ];
  const paymentEvents = [
    ...runtimeTransition(
      source.id,
      source.id,
      source.runtime,
      declaredPayment.state,
      'action',
      obligations,
    ),
    ...engineTrace(source.id, [], declaredPayment.events, obligations, {
      facts: command.declaredActionId
        ? { declaredActionId: command.declaredActionId, contextualWeaponCost: true }
        : undefined,
    }),
  ];
  const declaration = actionDeclaredEvent({
    actorId: source.id,
    action: { ...action, sourceEntityIds: entry.sourceEntityIds },
    targetIds: [target.id],
    timing: 'active',
    facts: {
      attackActionId: attackAction.id,
      weaponCardId: card.id,
      weaponType: resolvedWeapon.weaponType,
      proficient: pactProjection ? true : isWeaponProficient(
        source.character,
        resolvedWeapon.weaponType,
        resolvedWeapon.proficiencyCategory,
      ),
      hand,
      ...(pactProjection ? { pactBlade: { ...pactProjection } } : {}),
      range,
      disadvantageReasons,
      spatial: { ...command.facts },
    },
    obligationIds: obligations,
  });
  const attackCommand: AuthoritativeUseActionCommand = {
    ...command,
    type: 'UseAction',
    actionId: action.id,
    targetIds: [target.id],
    factsByTarget: { [target.id]: command.facts },
  };
  const pending = pendingAttackEvents(
    { ...world, actors: { ...world.actors, [source.id]: sourceForAttack, [target.id]: targetForAttack } },
    attackCommand,
    action,
    catalog,
    env,
    {
      attackActionId: attackAction.id,
      preRollDisadvantageReasons: disadvantageReasons,
      continuationKind: range.kind === 'ranged' ? 'weapon_ranged' : 'weapon_melee',
      weaponHand: hand,
      weaponCardId: card.id,
      ...(pactProjection ? { pactBladeProjection: pactProjection } : {}),
    },
  );
  if (pending && !Array.isArray(pending)) return pending;
  const entryEvent = attackEntryEvent({
    sourceActorId: source.id,
    attackActionId: attackAction.id,
    entry,
    obligations,
  });
  if (pending) {
    const opened = pending.find((event) => event.payload.type === 'ResolutionOpened');
    if (opened?.payload.type === 'ResolutionOpened'
      && (opened.payload.resolution.type === 'protection_reaction'
        || opened.payload.resolution.type === 'attack_reaction'
        || opened.payload.resolution.type === 'damage_reaction')) {
      return [
        ...(pactProjectionEvent ? [pactProjectionEvent] : []),
        declaration,
        entryEvent,
        ...paymentEvents,
        ...pending,
        blockAttackActionEvent({
          actorId: source.id,
          attackActionId: attackAction.id,
          resolutionId: opened.payload.resolution.id,
          obligations,
        }),
      ];
    }
    return [
      ...(pactProjectionEvent ? [pactProjectionEvent] : []),
      declaration,
      entryEvent,
      ...paymentEvents,
      ...pending,
      ...completedAttackActionEvent({
        actorId: source.id,
        attackActionId: attackAction.id,
        attacksRemaining: nextSequence.attacksRemaining,
        obligations,
      }),
    ];
  }
  const result = executeAction(sourceForAttack.runtime, action.mechanics, {
    ...actionContext(sourceForAttack, env, targetForAttack, target.runtime, command.facts),
    attackActionId: attackAction.id,
    attackCommandId: command.commandId,
    choices: command.choices,
    deferTargetSaves: true,
  });
  const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
    world,
    attacker: sourceForAttack,
    defender: target,
    attackerAfter: result.state,
    defenderAfter: result.targetState,
    action,
    attackEvents: result.events,
    env,
  });
  const sourceAfter = pactProjection
    ? withoutPactBladeEquipmentProjection(armor.attackerAfter, source.runtime)
    : armor.attackerAfter;
  const targetAfter = armor.defenderAfter;
  const attackObligations = [...new Set([
    ...obligations,
    ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
    ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
  ])];
  return [
    ...(pactProjectionEvent ? [pactProjectionEvent] : []),
    declaration,
    entryEvent,
    ...paymentEvents,
    ...actionStateEvents({
    env,
      world,
      commandId: command.commandId,
      source: sourceForAttack,
      action,
      sourceAfter,
      target,
      targetAfter,
      obligations: attackObligations,
    }),
    ...engineTrace(source.id, [target.id], result.events, attackObligations, {
      facts: { weaponCardId: card.id, spatial: { ...command.facts } },
    }),
    ...engineTrace(target.id, [source.id], armor.retaliationEvents, attackObligations, {
      sourceActorId: target.id,
      facts: { trigger: 'temporary_hp_melee_retaliation' },
    }),
    ...attackFollowUpEvents({
      world,
      commandId: command.commandId,
      source: sourceForAttack,
      sourceAfter,
      target,
      targetAfter,
      action,
      deferred: result.deferredTargetSaves,
      env,
      obligations: attackObligations,
    }),
    ...completedAttackActionEvent({
      actorId: source.id,
      attackActionId: attackAction.id,
      attacksRemaining: nextSequence.attacksRemaining,
      obligations,
    }),
  ];
}

function lightExtraAttackRejection(
  world: WorldState,
  issue: LightWeaponExtraAttackIssue,
): CommandResult {
  switch (issue) {
    case 'extra_weapon_missing':
      return rejected(world, 'CardNotFound', 'The selected extra-attack Card is not actor-owned immutable content');
    case 'extra_weapon_not_equipped':
    case 'qualifying_weapon_not_equipped':
      return rejected(world, 'WeaponNotEquipped', 'The Light attack requires both weapon Cards to remain equipped in distinct hands');
    case 'bonus_action_unavailable':
      return rejected(world, 'InsufficientResources', 'The Light-property extra attack requires one Bonus Action');
    case 'already_used':
    case 'attack_action_not_completed':
    case 'attack_action_blocked':
    case 'wrong_turn':
    case 'attack_budget_incomplete':
      return rejected(world, 'InvalidActionTiming', `The Light-property extra attack is unavailable: ${issue}`);
    case 'qualifying_weapon_missing':
      return rejected(world, 'InvalidActionDefinition', 'The completed Attack ledger references a missing weapon Card');
    default:
      return rejected(world, 'InvalidEquipmentState', `The Light-property extra attack is illegal: ${issue}`);
  }
}

/**
 * Execute the one Bonus Action attack granted by the 2024 Light property.
 * This is deliberately outside the Attack-action budget: the completed ledger
 * proves qualification and remains byte-for-byte unchanged by the extra hit.
 */
function performLightWeaponExtraAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PerformLightWeaponExtraAttack' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const source = world.actors[command.actorId];
  const declaredWeaponAction = resolveDeclaredWeaponAction({
    actor: source,
    catalog,
    declaredActionId: command.declaredActionId,
    expectedPrimitive: LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
    weaponCardId: command.weaponCardId,
  });
  if (declaredWeaponAction.status === 'invalid') {
    return rejected(world, 'InvalidActionDefinition', declaredWeaponAction.issue);
  }
  const attackAction = world.attackActions[command.attackActionId];
  if (!attackAction || attackAction.actorId !== source.id) {
    return rejected(
      world,
      'AttackActionNotFound',
      `Unknown actor-owned Attack action ${command.attackActionId}`,
    );
  }
  const cards = [
    ...(source.character.knownCards ?? []),
    ...(source.character.equippedCards ?? []),
  ];
  const nickTiming = selectedWeaponUsesMastery(source, command.weaponCardId, 'nick');
  const currentTurnKey = attackTurnKey(world, source.id);
  if (nickTiming && (source.runtime.firedThisTurn ?? []).includes(
    weaponMasteryNickUseKey(currentTurnKey),
  )) {
    return rejected(world, 'InvalidActionTiming', 'Nick extra attack was already used this turn');
  }
  const eligibility = lightWeaponExtraAttackEligibility({
    attackAction: {
      id: attackAction.id,
      status: attackAction.status,
      turnKey: attackAction.turnKey,
      ...(attackAction.blockedByResolutionId
        ? { blockedByResolutionId: attackAction.blockedByResolutionId }
        : {}),
      attacksRemaining: attackAction.sequence.attacksRemaining,
      entries: attackAction.sequence.entries,
    },
    currentTurnKey,
    selectedWeaponCardId: command.weaponCardId,
    cards,
    equipment: source.runtime.equipment,
    bonusActions: source.runtime.resources.bonus_action ?? 0,
    firedThisTurn: source.runtime.firedThisTurn ?? [],
    actionEconomy: nickTiming ? 'attack_action' : 'bonus_action',
    allowNonLightMeleeExtraWeapon: ownsGeneralFeatCapability(source, DUAL_WIELDER_CAPABILITY),
  });
  if (!eligibility.eligible) return lightExtraAttackRejection(world, eligibility.issue);

  const {
    qualifyingWeapon,
    extraWeapon,
    extraWeaponHand: hand,
  } = eligibility.facts;
  const actionEconomy = eligibility.facts.actionEconomy ?? 'bonus_action';
  const extraWeaponProfile = parseWeaponProfile(extraWeapon);
  if (!extraWeaponProfile.valid) {
    return rejected(world, 'InvalidEquipmentState', extraWeaponProfile.issue);
  }
  if (!source.runtime.inventory.some((entry) => entry.cardId === extraWeapon.id && entry.qty > 0)
    && !Object.values(source.runtime.equipment).includes(extraWeapon.id)) {
    return rejected(world, 'ItemNotOwned', `${source.id} does not own ${extraWeapon.id}`);
  }
  const selectedWeapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime, source.passives);
  if (!selectedWeapon || selectedWeapon.cardId !== extraWeapon.id) {
    return rejected(world, 'InvalidEquipmentState', `${extraWeapon.id} cannot resolve from ${hand}_hand`);
  }
  const target = world.actors[command.targetActorId];
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  if (target.id === source.id) {
    return rejected(world, 'InvalidTargets', 'A Light-property weapon attack cannot target its attacker');
  }
  const conditionDenial = harmfulConditionRejection({
    world,
    attackerActorId: source.id,
    targetActorIds: [target.id],
  });
  if (conditionDenial) return conditionDenial;
  const spatialIssue = spatialFactShapeIssue(command.facts);
  if (spatialIssue) return rejected(world, 'InvalidFacts', spatialIssue);
  if (!command.facts.lineOfSight || command.facts.cover === 'total') {
    return rejected(world, 'LineOfSightBlocked', `Line of sight to ${target.id} is blocked`);
  }
  if (declaredWeaponAction.status === 'valid'
    && (!declaredWeaponAction.action.targeting
      || command.facts.distanceFt > declaredWeaponAction.action.targeting.rangeFt)) {
    return rejected(
      world,
      'OutOfRange',
      `${target.id} is outside the actor-bound weapon targeting contract`,
    );
  }
  const range = weaponRanges(extraWeapon, command.facts.distanceFt);
  if (!range) {
    return rejected(world, 'OutOfRange', `${target.id} is outside every declared weapon attack mode`);
  }
  const heavy = evaluateWeaponHeavyRule(
    extraWeaponProfile.profile,
    range.kind,
    source.character.abilityScores,
  );
  if (heavy && !heavy.valid) {
    return rejected(world, 'InvalidEquipmentState', heavy.issue);
  }
  const generalFeatDeclaration = generalFeatRangedDeclaration({
    actor: source,
    rangeKind: range.kind,
    weaponName: extraWeapon.name,
    weaponType: extraWeaponProfile.profile.weaponType,
  });
  const disadvantageReasons = [
    ...(heavy?.valid && heavy.disadvantage
      ? [`Heavy (${heavy.ability.toUpperCase()} below ${heavy.threshold})`]
      : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt > range.normalFt
      && !generalFeatDeclaration.ignoreLongRangeDisadvantage ? ['Long range'] : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt <= 5 && command.facts.relation === 'enemy'
      && !generalFeatDeclaration.ignoreAdjacentEnemyDisadvantage
      ? ['Ranged attack in close combat'] : []),
  ];
  const declaredCost = declaredWeaponAction.status === 'valid'
    ? (actionEconomy === 'attack_action'
      ? withoutTimingCost(declaredWeaponAction.cost, 'bonus_action')
      : declaredWeaponAction.cost)
    : [];
  const payable = canPay(source.runtime, declaredCost);
  if (!payable.ok) {
    return rejected(
      world,
      'InsufficientResources',
      `Cannot pay ${command.declaredActionId}: ${payable.missing.join(', ')}`,
    );
  }
  const declaredPayment = payCommandCost(source, declaredCost,env);
  const cancelled = cancelledCostEvents(source,declaredPayment);
  if(cancelled)return cancelled;
  const markedRuntime = {
    ...declaredPayment.state,
    firedThisTurn: [
      ...(declaredPayment.state.firedThisTurn ?? []),
      lightWeaponExtraAttackUseKey(attackAction.id),
      ...(actionEconomy === 'attack_action'
        ? [weaponMasteryNickUseKey(currentTurnKey)]
        : []),
    ],
  };
  const markedSource: ActorState = { ...source, runtime: markedRuntime };
  const generatedAction = lightWeaponExtraAttackAction(markedSource, hand, range.kind, actionEconomy);
  if (!generatedAction) {
    return rejected(world, 'InvalidEquipmentState', `${extraWeapon.id} cannot build a canonical Light attack`);
  }
  const projectedAction = declaredWeaponAction.status === 'valid'
    ? actionWithoutActivationCost(generatedAction)
    : generatedAction;
  const action: RuleActionDefinition = declaredWeaponAction.status === 'valid'
    ? {
      ...projectedAction,
      targeting: declaredWeaponAction.action.targeting,
      sourceEntityIds: [...new Set([
        ...projectedAction.sourceEntityIds,
        declaredWeaponAction.action.id,
        ...declaredWeaponAction.sourceEntityIds,
      ])] as [string, ...string[]],
    }
    : projectedAction;
  const featDamagePassives = generalFeatWeaponDamagePassives({
    actor: source,
    profile: extraWeaponProfile.profile,
    attackActionId: attackAction.id,
    ownTurn: world.scene.mode === 'encounter'
      && world.scene.initiative[world.scene.activeIndex] === source.id,
    extraAttackSource: 'light_property',
  });
  const sourceForAttack: ActorState = disadvantageReasons.length || featDamagePassives.length ? {
    ...markedSource,
    passives: [
      ...(markedSource.passives ?? []),
      ...featDamagePassives,
      ...disadvantageReasons.map(attackDisadvantagePassive),
    ],
  } : markedSource;
  const targetForAttack = attackTargetWithCover(target,
    generalFeatDeclaration.ignoreHalfAndThreeQuarterCover ? 'none' : command.facts.cover);
  const passiveDamageSourceIds = passiveModifierSourceEntityIds(source, {
    roll: 'damage',
    filter: {
      attackKind: 'weapon',
      extraAttackSource: 'light_property',
      abilityModifierAlreadyIncluded: false,
    },
    formulaCtx: {
      ...actorFormulaContext(source.character),
      weaponMod: liveCharacter(source).abilityMods[selectedWeapon.ability] ?? 0,
    },
    evalCtx: { character: source.character, state: source.runtime },
  });
  const obligations = [...new Set([
    'system:light-property-extra-attack',
    ...(actionEconomy === 'attack_action'
      ? ['system:weapon-mastery', 'system:weapon-mastery:nick']
      : ['system:bonus-action']),
    `entity:${qualifyingWeapon.id}`,
    `entity:${extraWeapon.id}`,
    ...action.sourceEntityIds.map((id) => `entity:${id}`),
    ...passiveDamageSourceIds.map((id) => `entity:${id}`),
  ])];
  const paymentTrace = engineTrace(source.id, [], declaredPayment.events, obligations, {
    facts: command.declaredActionId
      ? { declaredActionId: command.declaredActionId, contextualWeaponCost: true }
      : undefined,
  });
  const declaredAction: RuleActionDefinition = {
    ...action,
    sourceEntityIds: [
      ...action.sourceEntityIds,
      `card:${extraWeapon.id}`,
    ] as [string, ...string[]],
  };
  const declaration = actionDeclaredEvent({
    actorId: source.id,
    action: declaredAction,
    targetIds: [target.id],
    timing: 'active',
    facts: {
      attackActionId: attackAction.id,
      qualifyingWeaponCardId: qualifyingWeapon.id,
      weaponCardId: extraWeapon.id,
      weaponType: selectedWeapon.weaponType,
      proficient: isWeaponProficient(
        source.character,
        selectedWeapon.weaponType,
        selectedWeapon.proficiencyCategory,
      ),
      hand,
      range,
      actionEconomy,
      disadvantageReasons,
      spatial: { ...command.facts },
    },
    obligationIds: obligations,
  });
  const attackCommand: AuthoritativeUseActionCommand = {
    ...command,
    type: 'UseAction',
    actionId: action.id,
    targetIds: [target.id],
    factsByTarget: { [target.id]: command.facts },
  };
  const pending = pendingAttackEvents(
    {
      ...world,
      actors: {
        ...world.actors,
        [source.id]: sourceForAttack,
        [target.id]: targetForAttack,
      },
    },
    attackCommand,
    action,
    catalog,
    env,
    {
      preRollDisadvantageReasons: disadvantageReasons,
      continuationKind: range.kind === 'ranged' ? 'weapon_ranged' : 'weapon_melee',
      weaponHand: hand,
      weaponCardId: extraWeapon.id,
    },
  );
  if (pending && !Array.isArray(pending)) return pending;
  if (pending) {
    return [
      declaration,
      ...runtimeTransition(
        source.id,
        source.id,
        source.runtime,
        markedRuntime,
        'action',
        obligations,
      ),
      ...paymentTrace,
      ...pending,
    ];
  }

  const result = executeAction(markedRuntime, action.mechanics, {
    ...actionContext(sourceForAttack, env, targetForAttack, target.runtime, command.facts),
    attackActionId: attackAction.id,
    attackCommandId: command.commandId,
    choices: command.choices,
  });
  const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
    world,
    attacker: source,
    defender: target,
    attackerAfter: result.state,
    defenderAfter: result.targetState,
    action,
    attackEvents: result.events,
    env,
  });
  const targetAfter = armor.defenderAfter;
  const attackObligations = [...new Set([
    ...obligations,
    ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
    ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
  ])];
  return [
    declaration,
    ...actionStateEvents({
    env,
      world,
      commandId: command.commandId,
      source,
      action,
      sourceAfter: armor.attackerAfter,
      target,
      targetAfter,
      obligations: attackObligations,
    }),
    ...paymentTrace,
    ...engineTrace(source.id, [target.id], result.events, attackObligations, {
      facts: {
        attackActionId: attackAction.id,
        qualifyingWeaponCardId: qualifyingWeapon.id,
        weaponCardId: extraWeapon.id,
        lightPropertyExtraAttack: true,
        actionEconomy,
        spatial: { ...command.facts },
      },
    }),
    ...engineTrace(target.id, [source.id], armor.retaliationEvents, attackObligations, {
      sourceActorId: target.id,
      facts: { trigger: 'temporary_hp_melee_retaliation' },
    }),
    ...attackFollowUpEvents({
      world,
      commandId: command.commandId,
      source,
      sourceAfter: armor.attackerAfter,
      target,
      targetAfter,
      action,
      deferred: result.deferredTargetSaves,
      env,
      obligations: attackObligations,
    }),
  ];
}

/** Execute and consume the serializable opportunity opened by Cleave. */
function performWeaponMasteryCleaveAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PerformWeaponMasteryCleaveAttack' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const source = world.actors[command.actorId];
  const attackAction = world.attackActions[command.attackActionId];
  if (!attackAction || attackAction.actorId !== source.id) {
    return rejected(world, 'AttackActionNotFound', `Unknown actor-owned Attack action ${command.attackActionId}`);
  }
  if (attackAction.status === 'forfeited'
    || attackAction.turnKey !== attackTurnKey(world, source.id)
    || attackAction.blockedByResolutionId) {
    return rejected(world, 'InvalidActionTiming', 'Cleave requires the current unblocked Attack action');
  }
  const window = cleaveWindowFor({
    actor: source,
    attackActionId: attackAction.id,
    weaponCardId: command.weaponCardId,
  });
  if (!window) {
    return rejected(world, 'InvalidActionTiming', 'No matching Cleave hit opportunity is open');
  }
  const windowMechanics = window.mechanics as Record<string, unknown>;
  if (windowMechanics.committedByCommandId !== undefined) {
    return rejected(world, 'InvalidActionTiming', 'This Cleave opportunity was already consumed');
  }
  if (!selectedWeaponUsesMastery(source, command.weaponCardId, 'cleave')) {
    return rejected(world, 'FeatureNotGranted', 'The equipped weapon has no selected Cleave mastery');
  }
  const useKey = weaponMasteryCleaveUseKey(attackAction.turnKey);
  if ((source.runtime.firedThisTurn ?? []).some((key) => (
    key === useKey || key.startsWith(WEAPON_MASTERY_CLEAVE_USE_PREFIX)
  ))) {
    return rejected(world, 'InvalidActionTiming', 'Cleave was already used this turn');
  }

  const primaryTargetId = String(windowMechanics.primaryTargetActorId ?? '');
  const primary = world.actors[primaryTargetId];
  const target = world.actors[command.targetActorId];
  if (!primary || !target) return rejected(world, 'ActorNotFound', 'Cleave lost its primary or secondary target');
  if (target.id === source.id || target.id === primary.id) {
    return rejected(world, 'InvalidTargets', 'Cleave requires a different secondary creature');
  }
  const conditionDenial = harmfulConditionRejection({
    world,
    attackerActorId: source.id,
    targetActorIds: [target.id],
  });
  if (conditionDenial) return conditionDenial;
  const factsIssue = spatialFactShapeIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  const maxSecondaryDistance = windowMechanics.secondaryWithinPrimaryFt;
  if (typeof maxSecondaryDistance !== 'number'
    || !Number.isFinite(maxSecondaryDistance)
    || maxSecondaryDistance <= 0) {
    return rejected(world, 'InvalidActionDefinition', 'Cleave opportunity has no valid declared secondary-target distance');
  }
  if (!Number.isFinite(command.secondaryDistanceFromPrimaryFt)
    || command.secondaryDistanceFromPrimaryFt < 0
    || command.secondaryDistanceFromPrimaryFt > maxSecondaryDistance) {
    return rejected(world, 'OutOfRange', `Cleave secondary target must be within ${maxSecondaryDistance} ft of the first`);
  }
  if (!command.facts.lineOfSight || command.facts.cover === 'total') {
    return rejected(world, 'LineOfSightBlocked', `Line of sight to ${target.id} is blocked`);
  }
  const card = actorCard(source, command.weaponCardId);
  if (!card || card.type !== 'weapon') {
    return rejected(world, 'NotWeapon', `${command.weaponCardId} is not an immutable weapon Card`);
  }
  const cardProfile = parseWeaponProfile(card);
  if (!cardProfile.valid) {
    return rejected(world, 'InvalidEquipmentState', cardProfile.issue);
  }
  const hand = source.runtime.equipment.main_hand === card.id
    ? 'main'
    : source.runtime.equipment.off_hand === card.id
      ? 'off'
      : null;
  if (!hand) return rejected(world, 'WeaponNotEquipped', 'Cleave requires the same weapon to remain equipped');
  const range = weaponRanges(card, command.facts.distanceFt);
  if (!range || range.kind !== 'melee') {
    return rejected(world, 'OutOfRange', 'Cleave requires a melee attack within this weapon’s reach');
  }
  const heavy = evaluateWeaponHeavyRule(
    cardProfile.profile,
    'melee',
    source.character.abilityScores,
  );
  if (heavy && !heavy.valid) {
    return rejected(world, 'InvalidEquipmentState', heavy.issue);
  }
  const heavyReason = heavy?.valid && heavy.disadvantage
    ? `Heavy (${heavy.ability.toUpperCase()} below ${heavy.threshold})`
    : null;
  const action = cleaveWeaponAttackAction(source, hand);
  if (!action) return rejected(world, 'InvalidEquipmentState', 'Cleave could not build its weapon attack');

  const committedEffects = source.runtime.activeEffects.map((entry) => entry.id === window.id
    ? {
      ...entry,
      mechanics: { ...(entry.mechanics as Record<string, unknown>), committedByCommandId: command.commandId },
    }
    : entry);
  const markedRuntime: ActorState['runtime'] = {
    ...source.runtime,
    activeEffects: committedEffects,
    firedThisTurn: [...(source.runtime.firedThisTurn ?? []), useKey],
  };
  const markedSource: ActorState = {
    ...source,
    runtime: markedRuntime,
    ...(heavyReason ? {
      passives: [...(source.passives ?? []), attackDisadvantagePassive(heavyReason)],
    } : {}),
  };
  const targetForAttack = attackTargetWithCover(target, command.facts.cover);
  const sourceEntityId = String(windowMechanics.sourceEntityId ?? '');
  const obligations = [
    'system:weapon-mastery',
    'system:weapon-mastery:cleave',
    'system:attack-resolution',
    `entity:${card.id}`,
    ...(sourceEntityId ? [`entity:${sourceEntityId}`] : []),
    ...action.sourceEntityIds.map((id) => `entity:${id}`),
  ];
  const declaredAction: RuleActionDefinition = {
    ...action,
    sourceEntityIds: ([
      ...action.sourceEntityIds,
      `card:${card.id}`,
      ...(sourceEntityId ? [sourceEntityId] : []),
    ] as [string, ...string[]]),
  };
  const declaration = actionDeclaredEvent({
    actorId: source.id,
    action: declaredAction,
    targetIds: [target.id],
    timing: 'active',
    facts: {
      attackActionId: attackAction.id,
      primaryTargetActorId: primary.id,
      secondaryTargetActorId: target.id,
      secondaryDistanceFromPrimaryFt: command.secondaryDistanceFromPrimaryFt,
      weaponCardId: card.id,
      ...(heavyReason ? { disadvantageReasons: [heavyReason] } : {}),
      spatial: { ...command.facts },
    },
    obligationIds: obligations,
  });
  const attackCommand: AuthoritativeUseActionCommand = {
    ...command,
    type: 'UseAction',
    actionId: action.id,
    targetIds: [target.id],
    factsByTarget: { [target.id]: command.facts },
  };
  const pending = pendingAttackEvents(
    { ...world, actors: { ...world.actors, [source.id]: markedSource, [target.id]: targetForAttack } },
    attackCommand,
    action,
    catalog,
    env,
    {
      continuationKind: 'weapon_melee',
      weaponHand: hand,
      weaponCardId: card.id,
    },
  );
  if (pending && !Array.isArray(pending)) return pending;
  if (pending) {
    return [
      declaration,
      ...runtimeTransition(source.id, source.id, source.runtime, markedRuntime, 'action', obligations),
      ...pending,
    ];
  }

  const result = executeAction(markedRuntime, action.mechanics, {
    ...actionContext(markedSource, env, targetForAttack, target.runtime, command.facts),
    attackActionId: attackAction.id,
    attackCommandId: command.commandId,
  });
  const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
    world,
    attacker: source,
    defender: target,
    attackerAfter: result.state,
    defenderAfter: result.targetState,
    action,
    attackEvents: result.events,
    env,
  });
  const finalObligations = [...new Set([
    ...obligations,
    ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
    ...armor.retaliationSourceEntityIds.map((id) => `entity:${id}`),
  ])];
  return [
    declaration,
    ...actionStateEvents({
    env,
      world,
      commandId: command.commandId,
      source,
      action,
      sourceAfter: armor.attackerAfter,
      target,
      targetAfter: armor.defenderAfter,
      obligations: finalObligations,
    }),
    ...engineTrace(source.id, [target.id], result.events, finalObligations, {
      facts: {
        weaponMastery: 'cleave',
        primaryTargetActorId: primary.id,
        secondaryDistanceFromPrimaryFt: command.secondaryDistanceFromPrimaryFt,
        spatial: { ...command.facts },
      },
    }),
    ...engineTrace(target.id, [source.id], armor.retaliationEvents, finalObligations, {
      sourceActorId: target.id,
      facts: { trigger: 'temporary_hp_melee_retaliation' },
    }),
    ...attackFollowUpEvents({
      world,
      commandId: command.commandId,
      source,
      sourceAfter: armor.attackerAfter,
      target,
      targetAfter: armor.defenderAfter,
      action,
      deferred: result.deferredTargetSaves,
      env,
      obligations: finalObligations,
    }),
  ];
}

function freeGraspingPart(world: WorldState, actor: ActorState): string | undefined {
  const occupied = new Set(Object.values(world.grapples).filter((grapple) => (
    grapple.grapplerActorId === actor.id
  )).map((grapple) => grapple.sourcePart));
  return actor.attackProfile?.graspingParts.find((part) => (
    !occupied.has(part)
    && (part !== 'main_hand' && part !== 'off_hand' || !actor.runtime.equipment[part])
  ));
}

function executeReactionUnarmedControl(
  world: WorldState,
  command: Extract<GameCommand, { type: 'UseReactionAction' }>,
  action: RuleActionDefinition,
  option: 'grapple' | 'shove',
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const source = world.actors[command.actorId];
  const targetId = command.targetIds[0];
  const target = world.actors[targetId];
  const facts = command.factsByTarget?.[targetId];
  const systemId = option === 'grapple'
    ? SYSTEM_ACTION_IDS.unarmedGrapple
    : SYSTEM_ACTION_IDS.unarmedShove;
  const system = getSystemActionDefinition(systemId)!;
  if (command.targetIds.length !== 1 || !target || !facts) {
    return rejected(world, 'InvalidTargets', 'Opportunity Unarmed Strike requires one observed target');
  }
  if (!action.sourceEntityIds.every((id) => typeof id === 'string')
    || system.sourceEntityIds.some((id) => !action.sourceEntityIds.includes(id))) {
    return rejected(world, 'InvalidActionDefinition', `${action.id} does not derive from ${systemId}`);
  }
  const sourceSize = effectiveActorSize(source);
  const targetSize = effectiveActorSize(target);
  if (!Number.isInteger(sourceSize) || !Number.isInteger(targetSize)) {
    return rejected(world, 'InvalidActionDefinition', 'Unarmed control requires canonical creature sizes');
  }
  if (targetSize! > sourceSize! + 1) {
    return rejected(world, 'TargetTooLarge', `${target.id} is more than one size larger than ${source.id}`);
  }
  const sourcePart = option === 'grapple' ? freeGraspingPart(world, source) : undefined;
  if (option === 'grapple' && !sourcePart) {
    return rejected(world, 'NoFreeGraspingPart', `${source.id} has no free part to maintain a grapple`);
  }
  const cost = activationCost(action);
  const paid = payCommandCost(source, cost,env);
  const cancelled = cancelledCostEvents(source,paid);
  if(cancelled)return cancelled;
  const dc = 8 + (liveCharacter(source).abilityMods.str ?? 0) + liveCharacter(source).profBonus;
  const obligations = actionObligationIds(
    action,
    'system:unarmed-strike',
    `system:unarmed-strike:${option}`,
    'system:target-save',
    'system:pending-resolution',
  );
  const resolutionId = env.nextId();
  return [
    actionDeclaredEvent({
      actorId: source.id,
      action,
      targetIds: [target.id],
      timing: 'reaction',
      facts: {option, ...(sourcePart ? {sourcePart} : {}), spatial: {...facts}},
      obligationIds: obligations,
    }),
    ...runtimeTransition(source.id, source.id, source.runtime, paid.state, 'action', obligations),
    ...engineTrace(source.id, [], paid.events, obligations),
    {
      sourceActorId: source.id,
      obligationIds: obligations,
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: resolutionId,
          type: 'unarmed_save',
          openedByCommandId: command.commandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          sourceActorId: source.id,
          targetActorId: target.id,
          reactionActionId: action.id,
          option,
          facts: {...facts},
          ...(sourcePart ? {sourcePart} : {}),
          request: {
            id: env.nextId(),
            type: 'saving_throw',
            actorId: target.id,
            ability: 'str',
            abilityOptions: ['str', 'dex'],
            dc,
            avoidsConditions: [option === 'grapple' ? 'grappled' : 'prone'],
          },
        },
      },
    },
  ];
}

function executeUnarmedStrike(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PerformUnarmedStrike' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const validated = validateAttackAction(world, command.actorId, command.attackActionId);
  if ('rejection' in validated) return validated.rejection;
  const { attackAction } = validated;
  const source = world.actors[command.actorId];
  const target = world.actors[command.targetActorId];
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  if (target.id === source.id) return rejected(world, 'InvalidTargets', 'Unarmed Strike requires another creature');
  const conditionDenial = harmfulConditionRejection({
    world,
    attackerActorId: source.id,
    targetActorIds: [target.id],
  });
  if (conditionDenial) return conditionDenial;
  const factsIssue = spatialFactShapeIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  const reachFt = source.attackProfile?.reachFt;
  if (!Number.isFinite(reachFt) || reachFt! <= 0) {
    return rejected(world, 'InvalidActionDefinition', `${source.id} has no canonical unarmed reach`);
  }
  if (command.facts.distanceFt > reachFt!) {
    return rejected(world, 'OutOfRange', `${target.id} is outside ${reachFt} ft unarmed reach`);
  }
  if (!command.facts.lineOfSight || command.facts.cover === 'total') {
    return rejected(world, 'LineOfSightBlocked', `Target ${target.id} is not observable for Unarmed Strike`);
  }

  const systemId = command.option === 'damage'
    ? SYSTEM_ACTION_IDS.unarmedDamage
    : command.option === 'grapple'
      ? SYSTEM_ACTION_IDS.unarmedGrapple
      : SYSTEM_ACTION_IDS.unarmedShove;
  const system = getSystemActionDefinition(systemId);
  if (!system) return rejected(world, 'InvalidActionDefinition', `Missing system action ${systemId}`);
  if (command.option !== 'damage') {
    const sourceSize = effectiveActorSize(source);
    const targetSize = effectiveActorSize(target);
    if (!Number.isInteger(sourceSize) || !Number.isInteger(targetSize)) {
      return rejected(world, 'InvalidActionDefinition', 'Unarmed control requires canonical creature sizes');
    }
    if (targetSize! > sourceSize! + 1) {
      return rejected(world, 'TargetTooLarge', `${target.id} is more than one size larger than ${source.id}`);
    }
  }
  const sourcePart = command.option === 'grapple' ? freeGraspingPart(world, source) : undefined;
  if (command.option === 'grapple' && !sourcePart) {
    return rejected(world, 'NoFreeGraspingPart', `${source.id} has no free part to maintain a grapple`);
  }
  const nextSequence = performUnarmedStrike({
    sequence: attackAction.sequence,
    actionId: system.id,
    option: command.option,
    sourceEntityIds: [...system.sourceEntityIds] as [string, ...string[]],
  });
  const entry = nextSequence.entries.at(-1)!;
  const obligations = [
    'system:attack-action',
    'system:unarmed-strike',
    `system:unarmed-strike:${command.option}`,
    ...system.sourceEntityIds.map((id) => `entity:${id}`),
  ];
  const ruleAction = command.option === 'damage'
    ? unarmedDamageActionFor(source)
    : systemActionAsRuleDefinition(system.id, {
      activation: { mode: 'attack_entry', cost: [] },
    });
  const declaration = actionDeclaredEvent({
    actorId: source.id,
    action: ruleAction,
    targetIds: [target.id],
    timing: 'active',
    facts: {
      attackActionId: attackAction.id,
      option: command.option,
      ...(sourcePart ? { sourcePart } : {}),
      spatial: { ...command.facts },
    },
    obligationIds: obligations,
  });
  const entryEvent = attackEntryEvent({
    sourceActorId: source.id,
    attackActionId: attackAction.id,
    entry,
    obligations,
  });

  if (command.option === 'damage') {
    const grapplerSources = source.capabilities.featureSources?.['general_feat.grappler'] ?? [];
    const hasGrapplerAdvantage = actorOwnsGrappler(source)
      && Object.values(world.grapples).some((grapple) => (
        grapple.grapplerActorId === source.id && grapple.targetActorId === target.id
      ));
    const sourceForAttack: ActorState = hasGrapplerAdvantage ? {
      ...source,
      passives: [
        ...(source.passives ?? []),
        grapplerAttackAdvantagePassive(grapplerSources),
      ],
    } : source;
    const targetForAttack = attackTargetWithCover(target, command.facts.cover);
    const attackCommand: AuthoritativeUseActionCommand = {
      ...command,
      type: 'UseAction',
      actionId: ruleAction.id,
      targetIds: [target.id],
      factsByTarget: { [target.id]: command.facts },
    };
    const pending = pendingAttackEvents(
      {
        ...world,
        actors: {
          ...world.actors,
          [source.id]: sourceForAttack,
          [target.id]: targetForAttack,
        },
      },
      attackCommand,
      ruleAction,
      catalog,
      env,
      { attackActionId: attackAction.id, continuationKind: 'unarmed_damage' },
    );
    if (pending && !Array.isArray(pending)) return pending;
    if (pending) {
      const opened = pending.find((event) => event.payload.type === 'ResolutionOpened');
      if (opened?.payload.type === 'ResolutionOpened'
        && (opened.payload.resolution.type === 'protection_reaction'
          || opened.payload.resolution.type === 'attack_reaction'
          || opened.payload.resolution.type === 'damage_reaction')) {
        return [
          declaration,
          entryEvent,
          ...pending,
          blockAttackActionEvent({
            actorId: source.id,
            attackActionId: attackAction.id,
            resolutionId: opened.payload.resolution.id,
            obligations,
          }),
        ];
      }
      return [
        declaration,
        entryEvent,
        ...pending,
        ...completedAttackActionEvent({
          actorId: source.id,
          attackActionId: attackAction.id,
          attacksRemaining: nextSequence.attacksRemaining,
          obligations,
        }),
      ];
    }
    const result = executeAction(source.runtime, ruleAction.mechanics, {
      ...actionContext(sourceForAttack, env, targetForAttack, target.runtime, command.facts),
      attackActionId: attackAction.id,
      attackCommandId: command.commandId,
    });
    const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
      world,
      attacker: source,
      defender: target,
      attackerAfter: result.state,
      defenderAfter: result.targetState,
      action: ruleAction,
      attackEvents: result.events,
      env,
    });
    const attackObligations = [...new Set([
      ...obligations,
      ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
      ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
    ])];
    return [
      declaration,
      entryEvent,
      ...actionStateEvents({
    env,
        world,
        commandId: command.commandId,
        source,
        action: ruleAction,
        sourceAfter: armor.attackerAfter,
        target,
        targetAfter: armor.defenderAfter,
        obligations: attackObligations,
      }),
      ...engineTrace(source.id, [target.id], result.events, attackObligations, {
        facts: { option: command.option, spatial: { ...command.facts } },
      }),
      ...engineTrace(target.id, [source.id], armor.retaliationEvents, attackObligations, {
        sourceActorId: target.id,
        facts: { trigger: 'temporary_hp_melee_retaliation' },
      }),
      ...attackFollowUpEvents({
        world,
        commandId: command.commandId,
        source,
        sourceAfter: armor.attackerAfter,
        target,
        targetAfter: armor.defenderAfter,
        action: ruleAction,
        deferred: result.deferredTargetSaves,
        env,
        obligations: attackObligations,
      }),
      ...completedAttackActionEvent({
        actorId: source.id,
        attackActionId: attackAction.id,
        attacksRemaining: nextSequence.attacksRemaining,
        obligations,
      }),
    ];
  }

  const resolutionId = env.nextId();
  const dc = 8 + (liveCharacter(source).abilityMods.str ?? 0) + liveCharacter(source).profBonus;
  return [
    declaration,
    entryEvent,
    {
      sourceActorId: source.id,
      obligationIds: [...obligations, 'system:target-save', 'system:pending-resolution'],
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: resolutionId,
          type: 'unarmed_save',
          openedByCommandId: command.commandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          sourceActorId: source.id,
          targetActorId: target.id,
          attackActionId: attackAction.id,
          option: command.option,
          facts: { ...command.facts },
          ...(sourcePart ? { sourcePart } : {}),
          request: {
            id: env.nextId(),
            type: 'saving_throw',
            actorId: target.id,
            ability: 'str',
            abilityOptions: ['str', 'dex'],
            dc,
            avoidsConditions: [command.option === 'grapple' ? 'grappled' : 'prone'],
          },
        },
      },
    },
    blockAttackActionEvent({
      actorId: source.id,
      attackActionId: attackAction.id,
      resolutionId,
      obligations,
    }),
  ];
}

function targetSaveRoll(input: {
  target: ActorState;
  ability: Ability;
  dc: number;
  command: Extract<GameCommand, { type: 'ResolveDecision' }>;
  env: DeterministicEnvironment;
  purpose?:'grapple'|'shove';
}): { roll: RollLog; event: EngineEvent } | { issue: string } {
  const { target, ability, dc, command, env } = input;
  const collected = collectRollModifiers(target.runtime, target.passives ?? [], {
    roll: 'saving_throw',
    filter: { ability,...(input.purpose?{purpose:input.purpose,against_forced_movement:input.purpose==='shove',against_prone:input.purpose==='shove'}:{}) },
    formulaCtx: actorFormulaContext(target.character),
    evalCtx: {
      state: target.runtime,
      activeConditions: activeConditionsOf(target.runtime),
      savedConditions: new Set<string>(),
    },
  });
  const proficient = target.character.saveProficiencies?.includes(ability);
  const manual = manualDecisionRng(command);
  try {
    const roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers: [
        { value: target.character.abilityMods[ability] ?? 0, source: ABILITY_LABEL[ability] },
        ...(proficient ? [{ value: target.character.profBonus, source: 'БМ' }] : []),
        ...collected.modifiers,
      ],
      target: { type: 'dc', value: dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
    return {
      roll,
      event: {
        type: 'roll',
        label: `Спасбросок ${ABILITY_LABEL[ability]}`,
        roll: { ...roll, kind: 'save' },
      },
    };
  } catch (error) {
    return { issue: error instanceof Error ? error.message : 'Invalid manual roll' };
  }
}

function attackResolutionFinishedEvents(input: {
  attackAction: AttackActionState;
  resolutionId: string;
  actorId: string;
  obligations: string[];
  closeIfComplete?: boolean;
}): EventInput[] {
  return [
    {
      sourceActorId: input.actorId,
      obligationIds: input.obligations,
      payload: {
        type: 'AttackActionUnblocked',
        attackActionId: input.attackAction.id,
        resolutionId: input.resolutionId,
      },
    },
    ...(input.closeIfComplete !== false
      ? completedAttackActionEvent({
        actorId: input.actorId,
        attackActionId: input.attackAction.id,
        attacksRemaining: input.attackAction.sequence.attacksRemaining,
        obligations: input.obligations,
      })
      : []),
  ];
}

function protectionContinuationAction(
  pending: PendingProtectionReactionResolution,
  source: ActorState,
  catalog: RulesCatalog,
): RuleActionDefinition | null {
  switch (pending.attackContinuationKind) {
    case 'catalog':
      return catalog.getAction(pending.actionId) ?? null;
    case 'weapon_melee':
    case 'weapon_ranged': {
      if ((pending.actionId !== SYSTEM_ACTION_IDS.weaponAttack
        && pending.actionId !== SYSTEM_ACTION_IDS.lightExtraAttack)
        || !pending.weaponHand) return null;
      const slot = pending.weaponHand === 'main' ? 'main_hand' : 'off_hand';
      const card = pending.weaponCardId ? actorCard(source, pending.weaponCardId) : undefined;
      if (!card || card.type !== 'weapon' || source.runtime.equipment[slot] !== card.id) return null;
      const rangeKind = pending.attackContinuationKind === 'weapon_ranged' ? 'ranged' : 'melee';
      return pending.actionId === SYSTEM_ACTION_IDS.lightExtraAttack
        ? lightWeaponExtraAttackAction(
          source,
          pending.weaponHand,
          rangeKind,
          selectedWeaponUsesMastery(source, card.id, 'nick')
            ? 'attack_action'
            : 'bonus_action',
        )
        : cleaveWindowFor({
          actor: source,
          weaponCardId: card.id,
          committedByCommandId: pending.openedByCommandId,
        })
          ? cleaveWeaponAttackAction(source, pending.weaponHand)
          : weaponAttackAction(pending.weaponHand, rangeKind);
    }
    case 'unarmed_damage':
      return pending.actionId === SYSTEM_ACTION_IDS.unarmedDamage
        ? unarmedDamageActionFor(source)
        : null;
    case 'familiar_attack':
      return familiarAttackRuleAction(source, pending.actionId);
    default:
      return null;
  }
}

/** Resume one attack that was durably paused before any attack-roll RNG. */
function resolvePendingProtection(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'protection_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no Protection reaction to resolve');
  }
  const persistedIssue = pendingProtectionResolutionIssue(pending, world);
  if (persistedIssue) return rejected(world, 'InvalidDecision', persistedIssue);
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active Protection request');
  }
  if (pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the requested protector can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'Protection requires a reaction response');
  }
  if (command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'Protection cannot select a spell source');
  }
  const selected = command.response.actionId;
  if (selected !== null && selected !== PROTECTION_2024_CAPABILITY_ID) {
    return rejected(world, 'InvalidDecision', `Reaction ${selected} was not offered`);
  }
  if (selected !== null
    && !pending.request.options.some((option) => option.actionId === selected)) {
    return rejected(world, 'InvalidDecision', `Reaction ${selected} was not offered`);
  }

  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  const protector = world.actors[pending.request.actorId];
  if (!source || !target || !protector) {
    return rejected(world, 'ActorNotFound', 'Protection continuation lost one of its actors');
  }
  let sourceForAttack = source;
  let pactCard: ReturnType<NonNullable<RulesCatalog['getCard']>> | undefined;
  if (pending.pactBladeProjection) {
    if (pending.actionId !== SYSTEM_ACTION_IDS.weaponAttack
      || pending.weaponHand !== pending.pactBladeProjection.weaponHand
      || pending.weaponCardId !== pending.pactBladeProjection.weaponCardId) {
      return rejected(world, 'InvalidDecision', 'Protection lost its Pact Blade continuation identity');
    }
    const persisted = persistedPactBladeExecution({
      world,
      catalog,
      source,
      commandId: pending.openedByCommandId,
      projection: pending.pactBladeProjection,
    });
    if ('issue' in persisted) return rejected(world, 'InvalidDecision', persisted.issue);
    sourceForAttack = persisted.actor;
    pactCard = persisted.card;
  }
  const baseAction = protectionContinuationAction(pending, sourceForAttack, catalog);
  const action = baseAction && pending.pactBladeProjection
    ? pactBladeWeaponAttackAction(baseAction, pending.pactBladeProjection)
    : baseAction;
  if (!action || action.id !== pending.actionId || !hasAttackRoll(action)) {
    return rejected(world, 'ActionNotFound', `Unknown Protection continuation ${pending.actionId}`);
  }
  const definitionIssue = actionDefinitionIssue(action);
  if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
  if ((action.kind === 'spell'
    && (!pending.spell || !Number.isInteger(pending.spell.castLevel)))
    || (action.kind === 'nonSpell' && pending.spell !== undefined)) {
    return rejected(world, 'InvalidSpellDeclaration', 'Protection continuation lost its canonical spell context');
  }
  if (pending.attackContinuationKind === 'catalog'
    && !source.capabilities.actionIds.includes(action.id)) {
    return rejected(world, 'ActionNotGranted', `Actor ${source.id} no longer owns ${action.id}`);
  }
  const spatialIssue = factsIssue(action, target.id, pending.facts);
  if (spatialIssue) return rejected(world, 'InvalidDecision', spatialIssue[1]);

  const candidate = pending.protectionCandidates.find((entry) => (
    entry.protectorActorId === protector.id
  ));
  const capabilitySource = protectionCapabilitySource(protector);
  if (!candidate || !capabilitySource) {
    return rejected(world, 'FeatureNotGranted', `${protector.id} has no canonical Protection source`);
  }
  const facts: Protection2024ReactionFacts = {
    factsSource: candidate.factsSource,
    worldRevision: world.revision,
    attackId: pending.openedByCommandId,
    protectorActorId: protector.id,
    attackerActorId: source.id,
    targetActorId: target.id,
    attackRollStage: 'before_roll',
    protectorCanSeeAttacker: candidate.protectorCanSeeAttacker,
    protectorHoldingShield: actorHoldsCanonicalShield(protector),
    protectorReactionAvailable: (protector.runtime.resources.reaction ?? 0) >= 1
      && !deniedCapabilities(protector.runtime, protector.passives ?? []).has('reaction'),
    protectorDistanceToTargetFt: candidate.protectorDistanceToTargetFt,
  };
  const resolved = resolveProtection2024Reaction({
    decision: selected === null ? 'decline' : 'use',
    ...(selected === null ? {} : { effectId: env.nextId() }),
    source: capabilitySource,
    facts,
  });
  if (resolved.status === 'rejected') {
    return rejected(world, 'InvalidDecision', `Protection is no longer legal: ${resolved.reason}`);
  }

  const obligations = [
    'system:fighting-style-protection',
    'system:reaction-window',
    'system:pending-resolution',
    ...capabilitySource.sourceEntityIds.map((id) => `entity:${id}`),
  ];
  const prefix: EventInput[] = [{
    sourceActorId: protector.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: protector.id,
      response: command.response,
    },
  }];
  if (resolved.status === 'activated') {
    prefix.push({
      sourceActorId: protector.id,
      obligationIds: [...obligations, 'system:effect-lifecycle'],
      payload: { type: 'ProtectionEffectActivated', effect: resolved.effect, facts },
    });
  }
  prefix.push({
    sourceActorId: protector.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });

  const attackAction = pending.attackActionId
    ? world.attackActions[pending.attackActionId]
    : undefined;
  if (pending.attackActionId && (!attackAction
    || attackAction.status !== 'open'
    || attackAction.blockedByResolutionId !== pending.id)) {
    return rejected(world, 'InvalidDecision', 'Protection lost its canonical Attack-action ledger');
  }
  if (attackAction) {
    prefix.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: attackAction.actorId,
      obligations: [...obligations, 'system:attack-action'],
      closeIfComplete: false,
    }));
  }

  const continuationAction: RuleActionDefinition = {
    ...action,
    mechanics: withoutActivationCost(action.mechanics),
  };
  const continuationCommand: AuthoritativeUseActionCommand = {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: pending.openedByCommandId,
    actorId: source.id,
    expectedRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
    actionId: action.id,
    targetIds: [target.id],
    factsByTarget: { [target.id]: { ...pending.facts } },
    protectionCandidates: pending.protectionCandidates.map((entry) => ({ ...entry })),
    ...(pending.choices ? { choices: JSON.parse(JSON.stringify(pending.choices)) } : {}),
    ...(pending.spell ? { spell: { ...pending.spell } as CanonicalSpellContext } : {}),
  };
  const continuationOptions: PendingAttackOptions = {
    ...(pending.attackActionId ? { attackActionId: pending.attackActionId } : {}),
    preRollDisadvantageReasons: [...pending.preRollDisadvantageReasons],
    protectionWindowResolved: true,
    forceExecution: true,
    continuationKind: pending.attackContinuationKind,
    ...(pending.weaponHand ? { weaponHand: pending.weaponHand } : {}),
    ...(pending.weaponCardId ? { weaponCardId: pending.weaponCardId } : {}),
    ...(pending.pactBladeProjection
      ? { pactBladeProjection: { ...pending.pactBladeProjection } }
      : {}),
  };

  if (resolved.status === 'declined' && pending.remainingReactions.length) {
    const interim = foldEvents(world, prefix.map((event, ordinal) => ({ ...event, ordinal })));
    const [next, ...remaining] = pending.remainingReactions;
    const opened = protectionOpenedEvent({
      world: interim,
      command: continuationCommand,
      action: continuationAction,
      current: next,
      remaining,
      candidates: pending.protectionCandidates,
      options: continuationOptions,
      env,
      obligations,
    });
    const events = [...prefix, opened];
    if (attackAction && opened.payload.type === 'ResolutionOpened') {
      events.push(blockAttackActionEvent({
        actorId: attackAction.actorId,
        attackActionId: attackAction.id,
        resolutionId: opened.payload.resolution.id,
        obligations: [...obligations, 'system:attack-action'],
      }));
    }
    return events;
  }

  const interim = foldEvents(world, prefix.map((event, ordinal) => ({ ...event, ordinal })));
  const resumedWorld = pending.pactBladeProjection && pactCard
    ? {
      ...interim,
      actors: {
        ...interim.actors,
        [source.id]: pactBladeExecutionActor({
          actor: interim.actors[source.id],
          card: pactCard,
          hand: pending.pactBladeProjection.weaponHand,
          projection: pending.pactBladeProjection,
        }),
      },
    }
    : interim;
  const resumed = pendingAttackEvents(
    resumedWorld,
    continuationCommand,
    continuationAction,
    catalog,
    env,
    continuationOptions,
  );
  if (!resumed) {
    return rejected(world, 'InvalidDecision', 'Protection continuation did not execute its attack');
  }
  if (!Array.isArray(resumed)) return resumed.status === 'rejected'
    ? rejected(world, resumed.code, resumed.message)
    : rejected(world, 'InvalidDecision', 'Protection continuation returned an invalid nested result');

  const events = [...prefix, ...resumed];
  if (attackAction) {
    const nextOpened = resumed.find((event) => event.payload.type === 'ResolutionOpened');
    if (nextOpened?.payload.type === 'ResolutionOpened'
      && (nextOpened.payload.resolution.type === 'attack_reaction'
        || nextOpened.payload.resolution.type === 'damage_reaction')) {
      events.push(blockAttackActionEvent({
        actorId: attackAction.actorId,
        attackActionId: attackAction.id,
        resolutionId: nextOpened.payload.resolution.id,
        obligations: [...obligations, 'system:attack-action'],
      }));
    } else {
      events.push(...completedAttackActionEvent({
        actorId: attackAction.actorId,
        attackActionId: attackAction.id,
        attacksRemaining: attackAction.sequence.attacksRemaining,
        obligations: [...obligations, 'system:attack-action'],
      }));
    }
  }
  return events;
}

function resolveUnarmedSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'unarmed_save') {
    return rejected(world, 'NoPendingResolution', 'There is no Unarmed Strike save to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active Unarmed Strike save');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the target can resolve this saving throw');
  }
  if (command.response.kind !== 'roll' && command.response.kind !== 'voluntary_fail') {
    return rejected(world, 'InvalidDecision', 'Unarmed Strike requires a save or voluntary failure');
  }
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  const attackAction = pending.attackActionId
    ? world.attackActions[pending.attackActionId]
    : undefined;
  if (!source || !target || (pending.attackActionId && (!attackAction
    || attackAction.actorId !== source.id
    || attackAction.blockedByResolutionId !== pending.id))) {
    return rejected(world, 'InvalidDecision', 'Unarmed Strike continuation lost its actors or Attack ledger');
  }
  const selectedAbility = command.response.selectedAbility;
  if (selectedAbility !== undefined && selectedAbility !== 'str' && selectedAbility !== 'dex') {
    return rejected(world, 'InvalidDecision', 'Target must choose Strength or Dexterity');
  }
  if (command.response.kind === 'roll' && !selectedAbility) {
    return rejected(world, 'InvalidDecision', 'A rolled Unarmed Strike save must choose Strength or Dexterity');
  }
  const obligations = [
    ...(attackAction ? ['system:attack-action'] : []),
    'system:unarmed-strike',
    `system:unarmed-strike:${pending.option}`,
    'system:target-save',
    'system:pending-resolution',
  ];
  let failed = command.response.kind === 'voluntary_fail';
  const traceEvents: EngineEvent[] = [];
  let targetRuntimeForResolution = target.runtime;
  if (command.response.kind === 'roll') {
    const rolled = targetSaveRoll({
      target,
      ability: selectedAbility!,
      dc: pending.request.dc,
      command,
      env,
      purpose:pending.option,
    });
    if ('issue' in rolled) return rejected(world, 'InvalidDecision', rolled.issue);
    const boonResolution = afterFailureSavingThrowBoon({
      target, roll: rolled.roll, boonEffectId: command.response.boonEffectId, env,
    });
    if ('issue' in boonResolution) return rejected(world, 'InvalidDecision', boonResolution.issue);
    failed = boonResolution.roll.outcome !== 'success';
    targetRuntimeForResolution = boonResolution.runtime;
    traceEvents.push({
      type: 'roll',
      label: `Спасбросок ${ABILITY_LABEL[selectedAbility!]}`,
      roll: { ...boonResolution.roll, kind: 'save' },
    }, ...boonResolution.events);
  } else {
    traceEvents.push({
      type: 'narrative',
      text: `${target.name} добровольно проваливает спасбросок Unarmed Strike.`,
    });
  }
  const events: EventInput[] = [
    ...engineTrace(target.id, [], traceEvents, obligations, {
      facts: {
        selectedAbility: selectedAbility ?? null,
        voluntaryFailure: command.response.kind === 'voluntary_fail',
      },
    }),
    {
      sourceActorId: target.id,
      obligationIds: obligations,
      payload: {
        type: 'DecisionRecorded',
        resolutionId: pending.id,
        requestId: pending.request.id,
        actorId: target.id,
        response: command.response,
      },
    },
    {
      sourceActorId: target.id,
      obligationIds: obligations,
      payload: { type: 'ResolutionClosed', resolutionId: pending.id },
    },
  ];
  if (targetRuntimeForResolution !== target.runtime) {
    events.push(...runtimeTransition(
      target.id, target.id, target.runtime, targetRuntimeForResolution, 'boon', obligations,
    ));
  }
  if (!failed) {
    if (attackAction) events.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: source.id,
      obligations,
    }));
    return events;
  }
  if (pending.option === 'grapple') {
    if (!pending.sourcePart || !source.attackProfile?.graspingParts.includes(pending.sourcePart)) {
      return rejected(world, 'InvalidDecision', 'Grapple continuation lost its source part');
    }
    if (Object.values(world.grapples).some((grapple) => (
      grapple.grapplerActorId === source.id && grapple.sourcePart === pending.sourcePart
    ))) {
      return rejected(world, 'InvalidDecision', 'Grapple source part became occupied');
    }
    const grapple: GrappleState = {
      id: env.nextId(),
      grapplerActorId: source.id,
      targetActorId: target.id,
      sourcePart: pending.sourcePart,
      escapeDc: pending.request.dc,
      reachFt: source.attackProfile.reachFt,
      sourceEntityIds: ([
        ...getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedGrapple)!.sourceEntityIds,
      ] as [string, ...string[]]),
      startedAtRevision: world.revision,
    };
    events.push({
      sourceActorId: source.id,
      obligationIds: obligations,
      payload: { type: 'GrappleApplied', grapple },
    });
    if (attackAction) events.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: source.id,
      obligations,
    }));
    return events;
  }

  const shoveResolutionId = env.nextId();
  if (attackAction) events.push(...attackResolutionFinishedEvents({
    attackAction,
    resolutionId: pending.id,
    actorId: source.id,
    obligations,
    closeIfComplete: false,
  }));
  events.push({
    sourceActorId: source.id,
    obligationIds: obligations,
    payload: {
      type: 'ResolutionOpened',
      resolution: {
        id: shoveResolutionId,
        type: 'shove_outcome',
        openedByCommandId: pending.openedByCommandId,
        openedAtRevision: world.revision,
        deadlineLogicalClock: world.logicalClock + 10,
        sourceActorId: source.id,
        targetActorId: target.id,
        ...(attackAction ? {attackActionId: attackAction.id} : {}),
        ...(pending.reactionActionId ? {reactionActionId: pending.reactionActionId} : {}),
        facts: { ...pending.facts },
        request: {
          id: env.nextId(),
          type: 'shove_outcome',
          actorId: source.id,
          options: ['push_5ft', 'prone'],
        },
      },
    },
  });
  if (attackAction) events.push(blockAttackActionEvent({
    actorId: source.id,
    attackActionId: attackAction.id,
    resolutionId: shoveResolutionId,
    obligations,
  }));
  return events;
}

function resolveActionCostPolicy(
  world:WorldState, command:Extract<GameCommand,{type:'ResolveDecision'}>,
  catalog:RulesCatalog, env:DeterministicEnvironment,
):CommandResult|EventInput[] {
  const pending=world.pendingResolution;
  if (pending?.type!=='action_cost_policy') return rejected(world,'NoPendingResolution','No pending action cost choice');
  if (pending.id!==command.resolutionId || pending.request.id!==command.requestId) return rejected(world,'StaleDecision','Action cost choice changed');
  if (pending.actorId!==command.actorId || command.response.kind!=='action_cost_policy') return rejected(world,'InvalidDecision','Only the action owner may choose its cost');
  const policyId=command.response.policyId;
  if (policyId!==null && !pending.request.options.some(option=>option.policyId===policyId)) return rejected(world,'InvalidDecision','Unknown action cost choice');
  const obligations=['system:action-cost-policy'];
  const closed:EventInput[]=[
    {sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,
      requestId:pending.request.id,actorId:command.actorId,response:command.response}},
    {sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}},
  ];
  const ready=foldEvents(world,closed.map((event,ordinal)=>({...event,ordinal})));
  const continued=executeCommand(ready,{...pending.continuation,commandId:command.commandId,
    selectedCostPolicyId:policyId},catalog,env);
  return Array.isArray(continued)?[...closed,...continued]:continued;
}

function resolveActiveSlotRecovery(world:WorldState,command:Extract<GameCommand,{type:'ResolveDecision'}>,catalog:RulesCatalog,env:DeterministicEnvironment):CommandResult|EventInput[]{
  const pending=world.pendingResolution;
  if(pending?.type!=='slot_recovery')return rejected(world,'NoPendingResolution','No pending slot recovery');
  if(pending.id!==command.resolutionId||pending.request.id!==command.requestId)return rejected(world,'StaleDecision','Slot recovery choice changed');
  if(pending.actorId!==command.actorId||command.response.kind!=='slot_recovery')return rejected(world,'InvalidDecision','Only the owner may select recovered slots');
  const obligations=['system:active-slot-recovery'];
  const closed:EventInput[]=[{sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:command.actorId,response:command.response}},
    {sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}}];
  if(command.response.slotLevels===null)return closed;
  if(!Array.isArray(command.response.slotLevels)||command.response.slotLevels.some(n=>!Number.isSafeInteger(n)))return rejected(world,'InvalidDecision','Invalid slot selection');
  const ready=foldEvents(world,closed.map((event,ordinal)=>({...event,ordinal})));
  const continued=executeCommand(ready,{...pending.continuation,commandId:command.commandId,selectedSlotRecovery:command.response.slotLevels},catalog,env);
  return Array.isArray(continued)?[...closed,...continued]:continued;
}

function resolveShoveOutcome(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'shove_outcome') {
    return rejected(world, 'NoPendingResolution', 'There is no Shove outcome to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active Shove choice');
  }
  if (pending.sourceActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the attacker can choose the Shove outcome');
  }
  if (command.response.kind !== 'shove_outcome'
    || !pending.request.options.includes(command.response.outcome)) {
    return rejected(world, 'InvalidDecision', 'Shove requires choosing push_5ft or prone');
  }
  const attackAction = pending.attackActionId
    ? world.attackActions[pending.attackActionId]
    : undefined;
  if (pending.attackActionId && (!attackAction || attackAction.blockedByResolutionId !== pending.id)) {
    return rejected(world, 'InvalidDecision', 'Shove choice lost its Attack-action ledger');
  }
  const obligations = [
    ...(attackAction ? ['system:attack-action'] : []),
    'system:unarmed-strike',
    'system:unarmed-strike:shove',
    'system:pending-resolution',
  ];
  return [
    {
      sourceActorId: command.actorId,
      obligationIds: obligations,
      payload: {
        type: 'DecisionRecorded',
        resolutionId: pending.id,
        requestId: pending.request.id,
        actorId: command.actorId,
        response: command.response,
      },
    },
    {
      sourceActorId: command.actorId,
      obligationIds: obligations,
      payload: {
        type: 'ShoveApplied',
        effectId: env.nextId(),
        sourceActorId: command.actorId,
        targetActorId: pending.targetActorId,
        outcome: command.response.outcome,
        facts: { ...pending.facts },
      },
    },
    ...engineTrace(command.actorId, [pending.targetActorId], [{
      type: 'narrative',
      text: command.response.outcome === 'prone'
        ? `${world.actors[pending.targetActorId].name} сбит с ног.`
        : `${world.actors[pending.targetActorId].name} оттолкнут на 5 футов.`,
    }], obligations),
    {
      sourceActorId: command.actorId,
      obligationIds: obligations,
      payload: { type: 'ResolutionClosed', resolutionId: pending.id },
    },
    ...(attackAction ? attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: command.actorId,
      obligations,
    }) : []),
  ];
}

function forfeitAttackAction(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ForfeitAttackAction' }>,
): CommandResult | EventInput[] {
  const validated = validateAttackAction(world, command.actorId, command.attackActionId);
  if ('rejection' in validated) return validated.rejection;
  const obligations = ['system:attack-action', 'system:attack-action-forfeit'];
  return [{
    sourceActorId: command.actorId,
    obligationIds: obligations,
    payload: { type: 'AttackActionClosed', attackActionId: command.attackActionId, reason: 'forfeited' },
  }];
}

function openEscapeGrapple(
  world: WorldState,
  command: Extract<GameCommand, { type: 'EscapeGrapple' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const grapple = world.grapples[command.grappleId];
  if (!grapple || grapple.targetActorId !== actor.id) {
    return rejected(world, 'GrappleNotFound', `Unknown target-owned grapple ${command.grappleId}`);
  }
  if (command.skill !== 'athletics' && command.skill !== 'acrobatics') {
    return rejected(world, 'InvalidDecision', 'Escape requires Athletics or Acrobatics');
  }
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Escape action`);
  }
  const cost = nonMagicActionCost(actor.runtime);
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = payCommandCost(actor, cost,env);
  const cancelled = cancelledCostEvents(actor,paid);
  if(cancelled)return cancelled;
  const action = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.escapeGrapple, {
    activation: { mode: 'active', cost },
  });
  const obligations = actionObligationIds(
    action,
    'system:grapple-lifecycle',
    'system:ability-check',
    'system:pending-resolution',
  );
  const resolutionId = env.nextId();
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action,
      targetIds: [actor.id],
      timing: 'active',
      facts: { grappleId: grapple.id, skill: command.skill, escapeDc: grapple.escapeDc },
      obligationIds: obligations,
    }),
    ...runtimeTransition(actor.id, actor.id, actor.runtime, paid.state, 'action', obligations),
    ...engineTrace(actor.id, [], paid.events, obligations),
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: {
        type: 'ResolutionOpened',
        resolution: {
          id: resolutionId,
          type: 'escape_grapple',
          openedByCommandId: command.commandId,
          openedAtRevision: world.revision,
          deadlineLogicalClock: world.logicalClock + 10,
          actorId: actor.id,
          grappleId: grapple.id,
          skill: command.skill,
          request: {
            id: env.nextId(),
            type: 'saving_throw',
            actorId: actor.id,
            ability: command.skill === 'athletics' ? 'str' : 'dex',
            dc: grapple.escapeDc,
            avoidsConditions: ['grappled'],
          },
        },
      },
    },
  ];
}

function resolveEscapeGrapple(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'escape_grapple') {
    return rejected(world, 'NoPendingResolution', 'There is no Escape Grapple check to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active Escape Grapple check');
  }
  if (pending.actorId !== command.actorId || command.response.kind !== 'roll') {
    return rejected(world, 'InvalidDecision', 'Only the grappled actor can roll the escape check');
  }
  const actor = world.actors[pending.actorId];
  const grapple = world.grapples[pending.grappleId];
  if (!actor || !grapple || grapple.targetActorId !== actor.id) {
    return rejected(world, 'InvalidDecision', 'Escape continuation lost its active grapple');
  }
  const ability: Ability = pending.skill === 'athletics' ? 'str' : 'dex';
  const proficient = actor.character.skillProficiencies?.includes(pending.skill);
  const expertise = actor.character.skillExpertise?.includes(pending.skill);
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'ability_check',
    filter: { ability, skill: pending.skill },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage, hasAdvantage: collected.hasAdvantage, hasDisadvantage: collected.hasDisadvantage,
      modifiers: [
        { value: liveCharacter(actor).abilityMods[ability] ?? 0, source: ABILITY_LABEL[ability] },
        ...(proficient ? [{
          value: liveCharacter(actor).profBonus * (expertise ? 2 : 1),
          source: expertise ? 'Экспертиза' : 'БМ',
        }] : []),
        ...collected.modifiers,
      ],
      target: { type: 'dc', value: grapple.escapeDc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid manual roll');
  }
  const obligations = [
    'system:grapple-lifecycle',
    'system:ability-check',
    'system:pending-resolution',
  ];
  const checkEvents: EngineEvent[] = [{
    type: 'roll',
    label: `Escape Grapple (${pending.skill})`,
    roll: { ...roll, kind: 'check' },
  }];
  const after = consumeNextRollEffects(actor.runtime, 'ability_check', checkEvents, {
    usedRuleKeys:roll.usedRuleKeys,
    filter: { ability, skill: pending.skill },
    failed: roll.usedFailureBonus === true,
    finalFailed: roll.usedFailureBonus === true && roll.outcome === 'fail',
  });
  const concentration = consumedConcentrationLifecycle({
    env,
    world, actingActorId: actor.id, changedActorId: actor.id,
    before: actor.runtime, after, obligations,
  });
  return [
    ...concentration.transitions,
    ...engineTrace(actor.id, [], checkEvents, obligations, { facts: { grappleId: grapple.id, escapeDc: grapple.escapeDc } }),
    ...concentration.lifecycle,
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: {
        type: 'DecisionRecorded',
        resolutionId: pending.id,
        requestId: pending.request.id,
        actorId: actor.id,
        response: command.response,
      },
    },
    ...(roll.outcome === 'success' ? [{
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: { type: 'GrappleEnded' as const, grappleId: grapple.id, reason: 'escaped' as const },
    }] : []),
    {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: { type: 'ResolutionClosed', resolutionId: pending.id },
    },
    ...openFailedCheckBoost(world, {...actor, runtime: after}, roll,
      {type: 'escape_grapple', grappleId: grapple.id}, command.commandId, catalog, env),
  ];
}

function releaseGrapple(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ReleaseGrapple' }>,
): CommandResult | EventInput[] {
  const grapple = world.grapples[command.grappleId];
  if (!grapple || grapple.grapplerActorId !== command.actorId) {
    return rejected(world, 'GrappleNotFound', `Unknown grappler-owned grapple ${command.grappleId}`);
  }
  const action = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.releaseGrapple, {
    activation: { mode: 'free', cost: [] },
  });
  const obligations = actionObligationIds(action, 'system:grapple-lifecycle');
  return [
    actionDeclaredEvent({
      actorId: command.actorId,
      action,
      targetIds: [grapple.targetActorId],
      timing: 'active',
      facts: { grappleId: grapple.id },
      obligationIds: obligations,
    }),
    {
      sourceActorId: command.actorId,
      obligationIds: obligations,
      payload: { type: 'GrappleEnded', grappleId: grapple.id, reason: 'released' },
    },
    ...(world.pendingResolution?.type === 'escape_grapple'
      && world.pendingResolution.grappleId === grapple.id ? [{
        sourceActorId: command.actorId,
        obligationIds: [...obligations, 'system:pending-resolution'],
        payload: {
          type: 'ResolutionClosed' as const,
          resolutionId: world.pendingResolution.id,
        },
      }] : []),
  ];
}

function breakGrappleRange(
  world: WorldState,
  command: Extract<GameCommand, { type: 'BreakGrappleRange' }>,
): CommandResult | EventInput[] {
  const grapple = world.grapples[command.grappleId];
  if (!grapple
    || (grapple.grapplerActorId !== command.actorId && grapple.targetActorId !== command.actorId)) {
    return rejected(world, 'GrappleNotFound', `Unknown participant grapple ${command.grappleId}`);
  }
  const issue = spatialFactShapeIssue(command.facts);
  if (issue) return rejected(world, 'InvalidFacts', issue);
  if (command.facts.distanceFt <= grapple.reachFt) {
    return rejected(world, 'InvalidFacts', `Distance must exceed persisted ${grapple.reachFt} ft reach`);
  }
  const obligations = ['system:grapple-lifecycle', 'system:observable-fact'];
  return [
    {
      sourceActorId: command.actorId,
      obligationIds: obligations,
      payload: {
        type: 'GrappleEnded',
        grappleId: grapple.id,
        reason: 'distance_exceeds_range',
      },
    },
    ...(world.pendingResolution?.type === 'escape_grapple'
      && world.pendingResolution.grappleId === grapple.id ? [{
        sourceActorId: command.actorId,
        obligationIds: [...obligations, 'system:pending-resolution'],
        payload: {
          type: 'ResolutionClosed' as const,
          resolutionId: world.pendingResolution.id,
        },
      }] : []),
  ];
}

function observeProtectionProximity(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ObserveProtectionProximity' }>,
): CommandResult | EventInput[] {
  const protector = world.actors[command.protectorActorId];
  const target = world.actors[command.protectedTargetActorId];
  if (!protector || !target
    || (command.actorId !== protector.id && command.actorId !== target.id)) {
    return rejected(world, 'ActorNotFound', 'Protection proximity requires one of its two participants');
  }
  if (!['scenario', 'board', 'gm_ruling'].includes(command.factsSource)
    || !Number.isInteger(command.boardRevision) || command.boardRevision < 0
    || !Number.isFinite(command.distanceFt) || command.distanceFt < 0) {
    return rejected(world, 'InvalidFacts', 'Protection proximity observation is malformed');
  }
  const effects = actorProtectionEffects(protector).filter((effect) => (
    effect.protectedTargetActorId === target.id
  ));
  if (!effects.length) {
    return rejected(world, 'InvalidDecision', 'There is no active Protection effect for these actors');
  }
  if (command.distanceFt <= 5) {
    return rejected(world, 'InvalidFacts', 'A maintained proximity observation does not end Protection');
  }
  const events: EventInput[] = [];
  for (const effect of effects) {
    const lifecycleEvent = {
      type: 'distance_observed' as const,
      factsSource: command.factsSource,
      worldRevision: world.revision,
      protectorActorId: protector.id,
      protectedTargetActorId: target.id,
      distanceFt: command.distanceFt,
    };
    const advanced = advanceProtection2024Effect(effect, lifecycleEvent);
    if (advanced.status !== 'ended' || advanced.reason !== 'proximity_broken') {
      return rejected(world, 'InvalidFacts', `Protection proximity was rejected: ${advanced.reason}`);
    }
    events.push({
      sourceActorId: command.actorId,
      obligationIds: [
        'system:fighting-style-protection',
        'system:effect-lifecycle',
        'system:observable-fact',
        ...effect.source.sourceEntityIds.map((id) => `entity:${id}`),
      ],
      payload: {
        type: 'ProtectionEffectEnded',
        protectorActorId: protector.id,
        protectedTargetActorId: target.id,
        effectId: effect.id,
        reason: 'proximity_broken',
        lifecycleEvent,
      },
    });
  }
  return events;
}

const FAMILIAR_SHARED_SENSES_ACTION: RuleActionDefinition = {
  id: 'system.familiar.shared-senses',
  name: 'Familiar Shared Senses',
  kind: 'nonSpell',
  sourceEntityIds: ['system:dnd5e-2024:find-familiar:shared-senses'],
  mechanics: { activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] } },
};

const FAMILIAR_DISMISS_ACTION: RuleActionDefinition = {
  id: 'system.familiar.dismiss',
  name: 'Dismiss Familiar',
  kind: 'nonSpell',
  sourceEntityIds: ['system:dnd5e-2024:find-familiar:dismiss'],
  mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] } },
};

const FAMILIAR_REAPPEAR_ACTION: RuleActionDefinition = {
  id: 'system.familiar.reappear',
  name: 'Reappear Familiar',
  kind: 'nonSpell',
  sourceEntityIds: ['system:dnd5e-2024:find-familiar:reappear'],
  mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] } },
};

function explicitStringChoice(
  choices: Record<string, string | string[]> | undefined,
  id: string,
): string | null {
  const value = choices?.[id];
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : null;
}

function familiarObservableFactsIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Familiar interaction requires explicit board, scenario, or GM facts';
  }
  const facts = value as Record<string, unknown>;
  if (!['scenario', 'board', 'gm_ruling'].includes(String(facts.factsSource ?? ''))
    || !Number.isInteger(facts.boardRevision) || Number(facts.boardRevision) < 0
    || !Number.isFinite(facts.distanceFt) || Number(facts.distanceFt) < 0
    || typeof facts.lineOfSight !== 'boolean') {
    return 'Familiar observable facts are malformed';
  }
  return null;
}

function familiarStateChangedEvent(input: {
  ownerActorId: string;
  familiarActorId: string;
  familiar: NonNullable<ActorState['familiarState']>;
  reason: Extract<UncommittedRuleEvent['payload'], { type: 'FamiliarStateChanged' }>['reason'];
  droppedItemIds?: string[];
  obligations: string[];
}): EventInput {
  return {
    sourceActorId: input.ownerActorId,
    obligationIds: input.obligations,
    payload: {
      type: 'FamiliarStateChanged',
      ownerActorId: input.ownerActorId,
      familiarActorId: input.familiarActorId,
      familiar: JSON.parse(JSON.stringify(input.familiar)) as typeof input.familiar,
      ...(input.droppedItemIds ? { droppedItemIds: [...input.droppedItemIds] } : {}),
      reason: input.reason,
    },
  };
}

function executeFindFamiliarCast(input: {
  world: WorldState;
  command: AuthoritativeUseActionCommand;
  action: RuleActionDefinition;
  env: DeterministicEnvironment;
}): CommandResult | EventInput[] {
  const { world, command, action, env } = input;
  const owner = world.actors[command.actorId];
  if (action.kind !== 'spell'
    || (action.mechanics.primitive as Record<string, unknown> | undefined)?.type
      !== FIND_FAMILIAR_PRIMITIVE) {
    return rejected(world, 'InvalidActionDefinition', `${action.id} is not canonical Find Familiar`);
  }
  const declaredPolicy = parseFindFamiliarMechanicsPolicy(action.mechanics);
  const declaredCastTime = parseActivationCastTime(action.mechanics);
  if (declaredPolicy.status === 'invalid' || declaredCastTime.status !== 'valid') {
    return rejected(
      world,
      'InvalidActionDefinition',
      declaredPolicy.status === 'invalid'
        ? `${action.id}: ${declaredPolicy.issue}`
        : `${action.id}: Find Familiar requires a declared positive casting time`,
    );
  }
  if (command.worldInput) {
    return rejected(world, 'InvalidFacts', 'Find Familiar does not accept arbitrary world input');
  }
  const formId = explicitStringChoice(command.choices, FIND_FAMILIAR_FORM_CHOICE);
  const spiritType = explicitStringChoice(command.choices, FIND_FAMILIAR_SPIRIT_CHOICE);
  const method = explicitStringChoice(command.choices, FIND_FAMILIAR_CAST_PATH_CHOICE);
  if (!formId || !spiritType || !method) {
    return rejected(
      world,
      'InvalidDecision',
      `Find Familiar requires explicit ${FIND_FAMILIAR_FORM_CHOICE}, ${FIND_FAMILIAR_SPIRIT_CHOICE}, and ${FIND_FAMILIAR_CAST_PATH_CHOICE}`,
    );
  }
  if (!['celestial', 'fey', 'fiend'].includes(spiritType)
    || !['spell_slot', 'ritual', 'pact_chain_magic_action'].includes(method)) {
    return rejected(world, 'InvalidDecision', 'Find Familiar has an invalid spirit or casting path');
  }
  if (world.scene.mode === 'encounter' && method !== 'pact_chain_magic_action') {
    return rejected(
      world,
      'InvalidActionTiming',
      'Find Familiar cannot complete its normal or ritual casting time during an encounter',
    );
  }
  if (!command.spell?.grantId || !command.spell.sourceId || !command.spell.payment) {
    return rejected(world, 'InvalidSpellDeclaration', 'Find Familiar requires an exact source-scoped spell grant');
  }

  const chain = owner.warlockPacts?.chain;
  const chainGrant = !!chain
    && chain.template.findFamiliarActionId === action.id
    && action.sourceEntityIds.includes(chain.sourceEntityId);
  if (method === 'pact_chain_magic_action') {
    if (!chainGrant || command.spell.mode !== 'normal' || command.spell.payment.kind !== 'none') {
      return rejected(world, 'InvalidSpellDeclaration', 'Pact Chain casting requires its at-will no-slot action');
    }
  } else if (method === 'ritual') {
    if (chainGrant || command.spell.mode !== 'ritual' || command.spell.payment.kind !== 'none') {
      return rejected(world, 'InvalidSpellDeclaration', 'Ritual Find Familiar requires a ritual-capable no-slot grant');
    }
  } else if (chainGrant || command.spell.mode !== 'normal' || command.spell.payment.kind !== 'slot') {
    return rejected(world, 'InvalidSpellDeclaration', 'Normal Find Familiar requires an exact level-1 slot payment');
  }

  const materialCost = findFamiliarMaterialCost(action);
  if (!materialCost) {
    return rejected(
      world,
      'InvalidActionDefinition',
      'Find Familiar requires one declared material activation cost with persistent binding',
    );
  }
  const incense = owner.runtime.resources[materialCost.resource];
  const incenseMaximum = owner.runtime.maxResources[materialCost.resource];
  if (!Number.isInteger(incense) || !Number.isInteger(incenseMaximum)
    || incense < materialCost.amount || incense > incenseMaximum
    || owner.character.resourceRecharge?.[materialCost.resource] !== materialCost.recharge) {
    return rejected(
      world,
      'InsufficientResources',
      `Find Familiar requires ${materialCost.amount} ${materialCost.binding.currency} in ${materialCost.resource}`,
    );
  }
  const owned = familiarActorsOwnedBy(world, owner.id);
  if (owned.length > 1) {
    return rejected(world, 'InvalidDecision', `${owner.id} has more than one canonical familiar`);
  }
  if (chainGrant && chain?.activeFamiliar && owned[0]?.id !== chain.activeFamiliar.actorId) {
    return rejected(world, 'InvalidDecision', 'Pact Chain has an unmaterialized legacy familiar projection');
  }
  const existing = owned[0] ?? null;
  const familiarActorId = existing?.id ?? env.nextId();
  if (!existing && world.actors[familiarActorId]) {
    return rejected(world, 'InvalidDecision', `Generated familiar actor ${familiarActorId} already exists`);
  }
  const payable = canPay(owner.runtime, activationCost(action));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }

  try {
    const paymentResource = command.spell.payment.resource;
    const slotCount = command.spell.payment.kind === 'slot' && paymentResource
      ? owner.runtime.resources[paymentResource] ?? 0
      : 0;
    const cast = castFindFamiliar({
      familiarActorId,
      summoningActionId: action.id,
      ownerActorId: owner.id,
      policy: chainGrant
        ? { kind: 'pact_chain', sourceEntityId: chain!.sourceEntityId }
        : { kind: 'base', sourceEntityId: action.sourceEntityIds[0] },
      method: method as FindFamiliarCastMethod,
      formId,
      spiritType: spiritType as FamiliarSpiritType,
      existingFamiliar: existing?.familiarState ?? null,
      resources: { level1SpellSlots: slotCount, incenseGp: incense },
      incenseOfferingGp: materialCost.amount,
      materialCostGp: materialCost.amount,
      baseCastingTimeSeconds: declaredCastTime.policy.seconds,
      mechanicsPolicy: declaredPolicy.policy,
    });
    let familiar = cast.familiar;
    if (world.scene.mode === 'encounter') {
      const template = getFamiliarActorTemplate(familiar.form.id);
      familiar = rollFamiliarInitiative({
        familiar,
        modifier: template.initiativeModifier,
        rng: env.rng,
      });
    }
    const actor = materializeCanonicalFamiliarActor({
      familiar,
      owner,
      summoningActionId: action.id,
    });
    const paid = payCommandCost(owner, activationCost(action),env);
  const cancelled = cancelledCostEvents(owner,paid);
  if(cancelled)return cancelled;
    const ownerAfter = paid.state;
    const obligations = actionObligationIds(
      action,
      'system:find-familiar',
      'system:summoned-actor',
      'system:material-component',
      'system:initiative',
    );
    const resourceEvents: EngineEvent[] = [
      ...paid.events,
      {
        type: 'narrative',
        text: `Find Familiar: ${familiar.form.name} (${familiar.spiritType}), ${cast.castingTime}.`,
      },
    ];
    return [
      ...runtimeTransition(owner.id, owner.id, owner.runtime, ownerAfter, 'action', obligations),
      ...engineTrace(owner.id, [actor.id], resourceEvents, obligations, {
        facts: {
          formId,
          spiritType,
          castingMethod: method,
          castingDuration: cast.castingDuration,
          catalogId: actor.familiarMetadata!.catalogId,
          catalogContentHash: actor.familiarMetadata!.catalogContentHash,
        },
      }),
      {
        sourceActorId: owner.id,
        obligationIds: obligations,
        payload: {
          type: 'FamiliarActorUpserted',
          ownerActorId: owner.id,
          actor,
          casting: {
            actionId: action.id,
            method: method as FindFamiliarCastMethod,
            consumedIncenseGp: cast.consumedIncenseGp,
            created: cast.created,
            changedForm: cast.changedForm,
          },
        },
      },
    ];
  } catch (error) {
    return rejected(
      world,
      'InvalidDecision',
      error instanceof Error ? error.message : 'Find Familiar choices are invalid',
    );
  }
}

function executeWildCompanionCast(input: {
  world: WorldState;
  command: AuthoritativeUseActionCommand;
  action: RuleActionDefinition;
  env: DeterministicEnvironment;
}): CommandResult | EventInput[] {
  const { world, command, action, env } = input;
  const owner = world.actors[command.actorId];
  const policy = wildCompanionMechanicsPolicy(action);
  if (action.kind === 'spell'
    || (action.mechanics.primitive as Record<string, unknown> | undefined)?.type
      !== WILD_COMPANION_PRIMITIVE
    || !policy) {
    return rejected(world, 'InvalidActionDefinition', `${action.id} is not canonical Wild Companion`);
  }
  if (command.worldInput || command.targetIds.length > 0) {
    return rejected(world, 'InvalidFacts', 'Wild Companion does not accept arbitrary targets or world input');
  }
  const formId = explicitStringChoice(command.choices, FIND_FAMILIAR_FORM_CHOICE);
  if (!formId) {
    return rejected(world, 'InvalidDecision', `Wild Companion requires explicit ${FIND_FAMILIAR_FORM_CHOICE}`);
  }
  const owned = familiarActorsOwnedBy(world, owner.id);
  if (owned.length > 1) {
    return rejected(world, 'InvalidDecision', `${owner.id} has more than one canonical familiar`);
  }
  const existing = owned[0] ?? null;
  const familiarActorId = existing?.id ?? env.nextId();
  if (!existing && world.actors[familiarActorId]) {
    return rejected(world, 'InvalidDecision', `Generated familiar actor ${familiarActorId} already exists`);
  }
  const payable = canPay(owner.runtime, activationCost(action));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  try {
    const cast = castFindFamiliar({
      familiarActorId,
      ownerActorId: owner.id,
      policy: { kind: 'base', sourceEntityId: action.sourceEntityIds[0] },
      method: 'wild_companion_magic_action',
      formId,
      spiritType: 'fey',
      existingFamiliar: existing?.familiarState ?? null,
      resources: { level1SpellSlots: 0, incenseGp: 0 },
      incenseOfferingGp: 0,
      materialCostGp: 0,
      baseCastingTimeSeconds: 6,
      mechanicsPolicy: policy,
    });
    let familiar = cast.familiar;
    if (world.scene.mode === 'encounter') {
      const template = getFamiliarActorTemplate(familiar.form.id);
      familiar = rollFamiliarInitiative({ familiar, modifier: template.initiativeModifier, rng: env.rng });
    }
    const actor = materializeCanonicalFamiliarActor({
      familiar,
      owner,
      summoningActionId: action.id,
    });
    const paid = payCommandCost(owner, activationCost(action),env);
  const cancelled = cancelledCostEvents(owner,paid);
  if(cancelled)return cancelled;
    const obligations = actionObligationIds(
      action,
      'system:wild-companion',
      'system:find-familiar',
      'system:summoned-actor',
      'system:initiative',
    );
    return [
      ...runtimeTransition(owner.id, owner.id, owner.runtime, paid.state, 'action', obligations),
      ...engineTrace(owner.id, [actor.id], [
        ...paid.events,
        { type: 'narrative', text: `Дикий спутник: ${familiar.form.name} (Фея) призван до долгого отдыха.` },
      ], obligations, {
        facts: {
          formId,
          spiritType: 'fey',
          castingMethod: 'wild_companion_magic_action',
          castingDuration: cast.castingDuration,
          catalogId: actor.familiarMetadata!.catalogId,
          catalogContentHash: actor.familiarMetadata!.catalogContentHash,
        },
      }),
      {
        sourceActorId: owner.id,
        obligationIds: obligations,
        payload: {
          type: 'FamiliarActorUpserted',
          ownerActorId: owner.id,
          actor,
          casting: {
            actionId: action.id,
            method: 'wild_companion_magic_action',
            consumedIncenseGp: 0,
            created: cast.created,
            changedForm: cast.changedForm,
          },
        },
      },
    ];
  } catch (error) {
    return rejected(
      world,
      'InvalidDecision',
      error instanceof Error ? error.message : 'Wild Companion choices are invalid',
    );
  }
}

function familiarPolicyFromSummoningAction(
  familiar: ActorState,
  catalog: RulesCatalog,
): { policy: FindFamiliarMechanicsPolicy } | { issue: string } {
  // An already cast, persistent spell keeps its declared policy even after
  // its caster changes prepared spells. This grants no casting capability.
  const ongoing = familiar.familiarState?.ongoingSpell;
  if (ongoing && ongoing.actionId === familiar.familiarMetadata?.summoningActionId) {
    return { policy: ongoing.policy };
  }
  const summoningActionId = familiar.familiarMetadata?.summoningActionId;
  if (!summoningActionId) {
    return { issue: 'Familiar has no summoning-action policy provenance' };
  }
  const action = catalog.getAction(summoningActionId);
  if (!action) return { issue: `Unknown familiar summoning action ${summoningActionId}` };
  const wildCompanion = wildCompanionMechanicsPolicy(action);
  if (wildCompanion) return { policy: wildCompanion };
  const parsed = parseFindFamiliarMechanicsPolicy(action.mechanics);
  return parsed.status === 'valid'
    ? { policy: parsed.policy }
    : { issue: `${summoningActionId}: ${parsed.issue}` };
}

function activateOwnedFamiliarSharedSenses(
  world: WorldState,
  command: Extract<GameCommand, { type: 'UseFamiliarSharedSenses' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const owner = world.actors[command.actorId];
  const familiar = requireOwnedFamiliar(world, owner.id, command.familiarActorId);
  if (!familiar?.familiarState) {
    return rejected(world, 'ActorNotFound', `Unknown owner familiar ${command.familiarActorId}`);
  }
  const declaredPolicy = familiarPolicyFromSummoningAction(familiar, catalog);
  if ('issue' in declaredPolicy) {
    return rejected(world, 'InvalidActionDefinition', declaredPolicy.issue);
  }
  const factsIssue = familiarObservableFactsIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  const payable = canPay(owner.runtime, activationCost(FAMILIAR_SHARED_SENSES_ACTION));
  if (!payable.ok) return rejected(world, 'InsufficientResources', 'Familiar shared senses requires a Bonus Action');
  try {
    // Use the persisted logical clock in both exploration and encounters so
    // the activation and the next owner-turn boundary share one time domain.
    const ownerTurn = world.logicalClock;
    const after = activateFamiliarSharedSenses({
      familiar: familiar.familiarState,
      ownerActorId: owner.id,
      distanceFt: command.facts.distanceFt,
      ownerTurn,
      mechanicsPolicy: declaredPolicy.policy,
    });
    const paid = payCommandCost(owner, activationCost(FAMILIAR_SHARED_SENSES_ACTION),env);
  const cancelled = cancelledCostEvents(owner,paid);
  if(cancelled)return cancelled;
    const obligations = actionObligationIds(
      FAMILIAR_SHARED_SENSES_ACTION,
      'system:find-familiar',
      'system:bonus-action',
    );
    return [
      actionDeclaredEvent({
        actorId: owner.id,
        action: FAMILIAR_SHARED_SENSES_ACTION,
        targetIds: [familiar.id],
        timing: 'active',
        facts: { ownerToFamiliar: { ...command.facts } },
        obligationIds: obligations,
      }),
      ...runtimeTransition(owner.id, owner.id, owner.runtime, paid.state, 'action', obligations),
      ...engineTrace(owner.id, [familiar.id], paid.events, obligations),
      familiarStateChangedEvent({
        ownerActorId: owner.id,
        familiarActorId: familiar.id,
        familiar: after,
        reason: 'shared_senses_started',
        obligations,
      }),
    ];
  } catch (error) {
    return rejected(world, 'InvalidFacts', error instanceof Error ? error.message : 'Invalid familiar senses facts');
  }
}

function dismissOwnedFamiliar(
  world: WorldState,
  command: Extract<GameCommand, { type: 'DismissFamiliar' }>,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const owner = world.actors[command.actorId];
  const familiar = requireOwnedFamiliar(world, owner.id, command.familiarActorId);
  if (!familiar?.familiarState) {
    return rejected(world, 'ActorNotFound', `Unknown owner familiar ${command.familiarActorId}`);
  }
  const payable = canPay(owner.runtime, activationCost(FAMILIAR_DISMISS_ACTION));
  if (!payable.ok) return rejected(world, 'InsufficientResources', 'Dismissing a familiar requires a Magic Action');
  try {
    const result = dismissFamiliar({
      familiar: familiar.familiarState,
      ownerActorId: owner.id,
      mode: command.mode,
    });
    const paid = payCommandCost(owner, activationCost(FAMILIAR_DISMISS_ACTION),env);
  const cancelled = cancelledCostEvents(owner,paid);
  if(cancelled)return cancelled;
    const obligations = actionObligationIds(
      FAMILIAR_DISMISS_ACTION,
      'system:find-familiar',
      'system:familiar-lifecycle',
    );
    return [
      actionDeclaredEvent({
        actorId: owner.id,
        action: FAMILIAR_DISMISS_ACTION,
        targetIds: [familiar.id],
        timing: 'active',
        facts: { mode: command.mode },
        obligationIds: obligations,
      }),
      ...runtimeTransition(owner.id, owner.id, owner.runtime, paid.state, 'action', obligations),
      ...engineTrace(owner.id, [familiar.id], paid.events, obligations),
      ...(result.familiar ? [familiarStateChangedEvent({
        ownerActorId: owner.id,
        familiarActorId: familiar.id,
        familiar: result.familiar,
        reason: 'temporary_dismissal',
        droppedItemIds: result.droppedItemIds,
        obligations,
      })] : [{
        sourceActorId: owner.id,
        obligationIds: obligations,
        payload: {
          type: 'FamiliarActorRemoved' as const,
          ownerActorId: owner.id,
          familiarActorId: familiar.id,
          reason: 'forever_dismissal' as const,
          droppedItemIds: result.droppedItemIds,
        },
      }]),
    ];
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid familiar dismissal');
  }
}

function reappearOwnedFamiliar(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ReappearFamiliar' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const owner = world.actors[command.actorId];
  const familiar = requireOwnedFamiliar(world, owner.id, command.familiarActorId);
  if (!familiar?.familiarState) {
    return rejected(world, 'ActorNotFound', `Unknown owner familiar ${command.familiarActorId}`);
  }
  const declaredPolicy = familiarPolicyFromSummoningAction(familiar, catalog);
  if ('issue' in declaredPolicy) {
    return rejected(world, 'InvalidActionDefinition', declaredPolicy.issue);
  }
  const factsIssue = familiarObservableFactsIssue(command.facts);
  if (factsIssue || typeof command.facts.unoccupiedSpace !== 'boolean') {
    return rejected(world, 'InvalidFacts', factsIssue ?? 'Familiar reappearance requires an occupancy fact');
  }
  const payable = canPay(owner.runtime, activationCost(FAMILIAR_REAPPEAR_ACTION));
  if (!payable.ok) return rejected(world, 'InsufficientResources', 'Reappearing a familiar requires a Magic Action');
  try {
    let after = reappearFamiliar({
      familiar: familiar.familiarState,
      ownerActorId: owner.id,
      distanceFt: command.facts.distanceFt,
      unoccupiedSpace: command.facts.unoccupiedSpace,
      mechanicsPolicy: declaredPolicy.policy,
    });
    if (world.scene.mode === 'encounter' && after.initiative.total === null) {
      after = rollFamiliarInitiative({
        familiar: after,
        modifier: familiar.familiarMetadata!.initiativeModifier,
        rng: env.rng,
      });
    }
    const paid = payCommandCost(owner, activationCost(FAMILIAR_REAPPEAR_ACTION),env);
  const cancelled = cancelledCostEvents(owner,paid);
  if(cancelled)return cancelled;
    const obligations = actionObligationIds(
      FAMILIAR_REAPPEAR_ACTION,
      'system:find-familiar',
      'system:familiar-lifecycle',
    );
    return [
      actionDeclaredEvent({
        actorId: owner.id,
        action: FAMILIAR_REAPPEAR_ACTION,
        targetIds: [familiar.id],
        timing: 'active',
        facts: { reappearance: { ...command.facts } },
        obligationIds: obligations,
      }),
      ...runtimeTransition(owner.id, owner.id, owner.runtime, paid.state, 'action', obligations),
      ...engineTrace(owner.id, [familiar.id], paid.events, obligations),
      familiarStateChangedEvent({
        ownerActorId: owner.id,
        familiarActorId: familiar.id,
        familiar: after,
        reason: 'reappeared',
        obligations,
      }),
    ];
  } catch (error) {
    return rejected(world, 'InvalidFacts', error instanceof Error ? error.message : 'Invalid familiar reappearance');
  }
}

function deliverTouchSpell(
  world: WorldState,
  command: Extract<GameCommand, { type: 'DeliverTouchSpellThroughFamiliar' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const owner = world.actors[command.actorId];
  const familiar = requireOwnedFamiliar(world, owner.id, command.familiarActorId);
  const target = world.actors[command.targetActorId];
  if (!familiar?.familiarState) {
    return rejected(world, 'ActorNotFound', `Unknown owner familiar ${command.familiarActorId}`);
  }
  const declaredFamiliarPolicy = familiarPolicyFromSummoningAction(familiar, catalog);
  if ('issue' in declaredFamiliarPolicy) {
    return rejected(world, 'InvalidActionDefinition', declaredFamiliarPolicy.issue);
  }
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  const connectionIssue = familiarObservableFactsIssue(command.ownerToFamiliarFacts);
  const targetFactsIssue = spatialFactShapeIssue(command.familiarToTargetFacts);
  if (connectionIssue || targetFactsIssue) {
    return rejected(world, 'InvalidFacts', connectionIssue ?? targetFactsIssue!);
  }
  const action = catalog.getAction(command.spellActionId);
  if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${command.spellActionId}`);
  const definitionIssue = actionDefinitionIssue(action);
  if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
  if (!owner.capabilities.actionIds.includes(action.id)) {
    return rejected(world, 'ActionNotGranted', `${owner.id} does not own spell ${action.id}`);
  }
  if (!canonicalTouchSpell(action)) {
    return rejected(world, 'InvalidActionDefinition', `${action.id} is not a canonical Touch spell`);
  }
  const declarationIssue = spellDeclarationIssue(action, command.spell);
  if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
  if (action.kind !== 'spell' || !owner.spellcastingAccess) {
    return rejected(world, 'InvalidSpellDeclaration', 'Touch delivery requires source-scoped spellcasting access');
  }
  const preparation = prepareSpellExecution({
    action,
    accessState: owner.spellcastingAccess,
    resources: availableResources(owner.runtime,owner.character,owner.passives),
    declaration: {
      ...(command.spell?.grantId ? { grantId: command.spell.grantId } : {}),
      ...(command.spell?.mode ? { mode: command.spell.mode } : {}),
      ...(command.spell?.preferFreeUse !== undefined
        ? { preferFreeUse: command.spell.preferFreeUse }
        : {}),
      ...(command.spell?.castLevel!==undefined?{castLevel:command.spell.castLevel}:{}),
    },
  });
  if (preparation.status === 'rejected') {
    return rejected(
      world,
      preparation.stage === 'action_definition' ? 'InvalidActionDefinition'
        : preparation.code === 'SpellResourceUnavailable' ? 'InsufficientResources'
          : 'InvalidSpellDeclaration',
      preparation.message,
    );
  }
  if (preparation.provenance.mode === 'ritual') {
    return rejected(world, 'InvalidSpellDeclaration', 'A delivered Touch spell cannot use ritual casting');
  }
  const executableAction = preparation.executableAction;
  const validation = actionValidation(
    world,
    executableAction,
    [target.id],
    { [target.id]: command.familiarToTargetFacts },
    owner.id,
  );
  if (validation) return validation;
  if (actionDeclaresHarmfulInteraction(executableAction)) {
    const conditionDenial = harmfulConditionRejection({
      world,
      // The familiar delivers the spell as if it had cast it; relation-based
      // condition restrictions therefore belong to that concrete actor.
      attackerActorId: familiar.id,
      targetActorIds: [target.id],
    });
    if (conditionDenial) return conditionDenial;
  }
  const payable = canPay(owner.runtime, activationCost(executableAction));
  if (!payable.ok) return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  try {
    const delivery = deliverTouchSpellThroughFamiliar({
      familiar: familiar.familiarState,
      ownerActorId: owner.id,
      distanceFt: command.ownerToFamiliarFacts.distanceFt,
      spellActionId: action.id,
      spellRange: 'touch',
      mechanicsPolicy: declaredFamiliarPolicy.policy,
    });
    const spell = canonicalSpellContext(executableAction, command.spell, preparation)!;
    const authoritative: AuthoritativeUseActionCommand = {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
      rulesetContentHash: command.rulesetContentHash,
      actorId: owner.id,
      actionId: executableAction.id,
      targetIds: [target.id],
      factsByTarget: { [target.id]: command.familiarToTargetFacts },
      choices: command.choices,
      ...(command.protectionCandidates ? {
        protectionCandidates: command.protectionCandidates.map((candidate) => ({ ...candidate })),
      } : {}),
      spell,
    };
    const obligations = actionObligationIds(
      executableAction,
      'system:find-familiar',
      'system:familiar-touch-delivery',
      'system:reaction',
    );
    const declaration = actionDeclaredEvent({
      actorId: owner.id,
      action: executableAction,
      targetIds: [target.id],
      timing: 'active',
      spell,
      facts: {
        deliveryActorId: familiar.id,
        ownerToFamiliar: { ...command.ownerToFamiliarFacts },
        familiarToTarget: { ...command.familiarToTargetFacts },
      },
      obligationIds: obligations,
    });
    const reactionSpent = familiarStateChangedEvent({
      ownerActorId: owner.id,
      familiarActorId: familiar.id,
      familiar: delivery.familiar,
      reason: 'touch_spell_delivered',
      obligations,
    });
    const pending = pendingSaveEvents(world, authoritative, executableAction, env)
      ?? pendingAttackEvents(world, authoritative, executableAction, catalog, env);
    if (pending && !Array.isArray(pending)) return pending;
    return [
      declaration,
      ...(pending ?? executeUseAction(world, authoritative, executableAction, catalog, env)),
      reactionSpent,
    ];
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid familiar touch delivery');
  }
}

function performPactChainFamiliarAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'PerformPactChainFamiliarAttack' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const validated = validateAttackAction(world, command.actorId, command.attackActionId);
  if ('rejection' in validated) return validated.rejection;
  const owner = world.actors[command.actorId];
  const familiar = requireOwnedFamiliar(world, owner.id, command.familiarActorId);
  const target = world.actors[command.targetActorId];
  const chain = owner.warlockPacts?.chain;
  if (!familiar?.familiarState || !familiar.familiarMetadata || !chain
    || familiar.familiarState.extension !== 'pact_chain'
    || chain.sourceEntityId !== familiar.familiarState.sourceEntityId
    || chain.activeFamiliar?.actorId !== familiar.id) {
    return rejected(world, 'FeatureNotGranted', `${owner.id} has no active canonical Pact Chain familiar`);
  }
  if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${command.targetActorId}`);
  if (target.id === familiar.id) return rejected(world, 'InvalidTargets', 'A familiar cannot attack itself');
  const conditionDenial = harmfulConditionRejection({
    world,
    // Pact Chain substitutes the familiar's attack, not the owner's attack.
    attackerActorId: familiar.id,
    targetActorIds: [target.id],
  });
  if (conditionDenial) return conditionDenial;
  const factsIssue = spatialFactShapeIssue(command.facts);
  if (factsIssue) return rejected(world, 'InvalidFacts', factsIssue);
  let action = familiarAttackRuleAction(familiar, command.familiarActionId);
  if (!action) {
    return rejected(world, 'InvalidActionDefinition', `${command.familiarActionId} is not a pinned familiar Attack`);
  }
  const validation = actionValidation(
    world,
    action,
    [target.id],
    { [target.id]: command.facts },
    familiar.id,
  );
  if (validation) return validation;
  const pinned = familiar.familiarMetadata.actions.find((entry) => entry.id === action!.id)!;
  const longRange = pinned.attack?.longRangeFt;
  const normalRange = pinned.attack?.normalRangeFt;
  const disadvantageReasons = pinned.attack?.mode === 'ranged'
    && normalRange !== undefined && longRange !== undefined
    && command.facts.distanceFt > normalRange
    ? ['Long range']
    : [];
  const sourceForAttack: ActorState = disadvantageReasons.length ? {
    ...familiar,
    passives: [...(familiar.passives ?? []), ...disadvantageReasons.map(attackDisadvantagePassive)],
  } : familiar;
  const targetForAttack = attackTargetWithCover(target, command.facts.cover);

  try {
    const substitution = substitutePactChainFamiliarAttack({
      familiar: familiar.familiarState,
      ownerActorId: owner.id,
      policy: { kind: 'pact_chain', sourceEntityId: chain.sourceEntityId },
      sequence: validated.attackAction.sequence,
      familiarAttackActionId: action.id,
    });
    const entry = substitution.sequence.entries.at(-1)!;
    action = {
      ...action,
      sourceEntityIds: ([
        ...new Set([...entry.sourceEntityIds, ...action.sourceEntityIds]),
      ] as [string, ...string[]]),
    };
    const obligations = actionObligationIds(
      action,
      'system:attack-action',
      'system:attack-replacement',
      'system:pact-chain',
      'system:familiar-reaction',
    );
    const declaration = actionDeclaredEvent({
      actorId: familiar.id,
      action,
      targetIds: [target.id],
      timing: 'reaction',
      facts: {
        ownerActorId: owner.id,
        attackActionId: validated.attackAction.id,
        familiarActorId: familiar.id,
        familiarActionId: action.id,
        disadvantageReasons,
        spatial: { ...command.facts },
      },
      obligationIds: obligations,
    });
    const entryEvent = attackEntryEvent({
      sourceActorId: owner.id,
      attackActionId: validated.attackAction.id,
      entry,
      obligations,
    });
    const attackCommand: AuthoritativeUseActionCommand = {
      ...command,
      type: 'UseAction',
      actorId: familiar.id,
      actionId: action.id,
      targetIds: [target.id],
      factsByTarget: { [target.id]: command.facts },
    };
    const pending = pendingAttackEvents(
      {
        ...world,
        actors: {
          ...world.actors,
          [familiar.id]: sourceForAttack,
          [target.id]: targetForAttack,
        },
      },
      attackCommand,
      action,
      catalog,
      env,
      {
        attackActionId: validated.attackAction.id,
        preRollDisadvantageReasons: disadvantageReasons,
        continuationKind: 'familiar_attack',
      },
    );
    if (pending && !Array.isArray(pending)) return pending;
    const reactionEvent = familiarStateChangedEvent({
      ownerActorId: owner.id,
      familiarActorId: familiar.id,
      familiar: substitution.familiar,
      reason: 'chain_attack_reaction',
      obligations,
    });
    if (pending) {
      const opened = pending.find((event) => event.payload.type === 'ResolutionOpened');
      if (opened?.payload.type === 'ResolutionOpened'
        && (opened.payload.resolution.type === 'protection_reaction'
          || opened.payload.resolution.type === 'attack_reaction'
          || opened.payload.resolution.type === 'damage_reaction')) {
        return [
          declaration,
          entryEvent,
          ...pending,
          reactionEvent,
          blockAttackActionEvent({
            actorId: owner.id,
            attackActionId: validated.attackAction.id,
            resolutionId: opened.payload.resolution.id,
            obligations,
          }),
        ];
      }
      return [
        declaration,
        entryEvent,
        ...pending,
        reactionEvent,
        ...completedAttackActionEvent({
          actorId: owner.id,
          attackActionId: validated.attackAction.id,
          attacksRemaining: substitution.sequence.attacksRemaining,
          obligations,
        }),
      ];
    }
    const result = executeAction(familiar.runtime, action.mechanics, {
      ...actionContext(sourceForAttack, env, targetForAttack, target.runtime, command.facts),
    });
    const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
      world,
      attacker: familiar,
      defender: target,
      attackerAfter: result.state,
      defenderAfter: result.targetState,
      action,
      attackEvents: result.events,
      env,
    });
    const finalObligations = [...new Set([
      ...obligations,
      ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
      ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
    ])];
    return [
      declaration,
      entryEvent,
      ...actionStateEvents({
    env,
        world,
        commandId: command.commandId,
        source: familiar,
        action,
        sourceAfter: armor.attackerAfter,
        target,
        targetAfter: armor.defenderAfter,
        obligations: finalObligations,
      }),
      ...engineTrace(familiar.id, [target.id], result.events, finalObligations, {
        facts: { ownerActorId: owner.id, spatial: { ...command.facts } },
      }),
      ...engineTrace(target.id, [familiar.id], armor.retaliationEvents, finalObligations, {
        sourceActorId: target.id,
        facts: { trigger: 'temporary_hp_melee_retaliation' },
      }),
      reactionEvent,
      ...attackFollowUpEvents({
        world,
        commandId: command.commandId,
        source: familiar,
        sourceAfter: armor.attackerAfter,
        target,
        targetAfter: armor.defenderAfter,
        action,
        deferred: result.deferredTargetSaves,
        env,
        obligations: finalObligations,
      }),
      ...completedAttackActionEvent({
        actorId: owner.id,
        attackActionId: validated.attackAction.id,
        attacksRemaining: substitution.sequence.attacksRemaining,
        obligations,
      }),
    ];
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid Pact Chain attack');
  }
}

function executeAttackReplacement(
  world: WorldState,
  command: Extract<GameCommand, { type: 'UseAttackReplacement' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const action = catalog.getAction(command.actionId);
  if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${command.actionId}`);
  const definitionIssue = actionDefinitionIssue(action);
  if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
  const replacement = action.attackReplacement;
  if (!replacement) {
    return rejected(world, 'InvalidActionTiming', `${action.id} cannot replace an Attack-action attack`);
  }
  if (!actor.capabilities.actionIds.includes(action.id)) {
    return rejected(world, 'ActionNotGranted', `Actor ${actor.id} does not own action ${action.id}`);
  }
  const sourceIssue=activeEffectRequirementIssue(action.mechanics,actor.runtime,actor.character);
  if(sourceIssue)return rejected(world,'CapabilityDenied',sourceIssue);
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Attack action`);
  }
  if (!command.targetIds.length) {
    return rejected(world, 'InvalidTargets', `${action.id} requires at least one factual area target`);
  }
  const validation = actionValidation(
    world,
    action,
    command.targetIds,
    command.factsByTarget,
    actor.id,
  );
  if (validation) return validation;
  if ((action.mechanics.activation as Record<string, unknown> | undefined)?.commanded_attack !== true) {
    const conditionDenial = harmfulConditionRejection({
      world,
      attackerActorId: actor.id,
      targetActorIds: command.targetIds,
    });
    if (conditionDenial) return conditionDenial;
  }

  let startEvents: EventInput[] = [];
  let worldWithAttack = world;
  let attackAction = openAttackAction(world, actor.id);
  if (attackAction) {
    const validated = validateAttackAction(world, actor.id, attackAction.id);
    if ('rejection' in validated) return validated.rejection;
    attackAction = validated.attackAction;
  } else {
    const started = beginAttackAction(world, { ...command, type: 'BeginAttackAction', selectedCostPolicyId:null }, catalog, env);
    if (!Array.isArray(started)) return started;
    startEvents = started;
    worldWithAttack = foldEvents(
      world,
      started.map((event, ordinal) => ({ ...event, ordinal })),
    );
    attackAction = openAttackAction(worldWithAttack, actor.id);
    if (!attackAction) {
      return rejected(world, 'InvalidActionDefinition', 'Attack replacement failed to open its Attack ledger');
    }
  }

  if(attackAction.costPolicyIds?.length)return rejected(world,'InvalidActionTiming','Restricted additional Attack action cannot be replaced by another action');
  let nextSequence: AttackSequenceState;
  try {
    nextSequence = replaceSequenceAttack({
      sequence: attackAction.sequence,
      actionId: action.id,
      replacementKey: replacement.replacementKey,
      sourceEntityIds: [...action.sourceEntityIds] as [string, ...string[]],
      oncePerSequence: replacement.oncePerAttackAction,
    });
  } catch (error) {
    return rejected(
      world,
      'InvalidActionDefinition',
      error instanceof Error ? error.message : 'Invalid Attack-action replacement policy',
    );
  }
  const entry = nextSequence.entries.at(-1)!;
  const entryAction: RuleActionDefinition = {
    ...action,
    mechanics: withoutActionResourceCost(action.mechanics),
  };

  const authoritativeCommand: AuthoritativeUseActionCommand = {
    ...command,
    type: 'UseAction',
  };
  if ((action.mechanics.activation as Record<string, unknown> | undefined)?.commanded_attack === true) {
    const obligations = actionObligationIds(action, 'system:attack-action', 'system:attack-replacement');
    return [...startEvents,
      attackEntryEvent({sourceActorId: actor.id, attackActionId: attackAction.id, entry, obligations}),
      ...executeUseAction(worldWithAttack, authoritativeCommand, entryAction, catalog, env),
      ...completedAttackActionEvent({actorId: actor.id, attackActionId: attackAction.id,
        attacksRemaining: nextSequence.attacksRemaining, obligations}),
    ];
  }
  const pending = pendingSaveEvents(
    worldWithAttack,
    authoritativeCommand,
    entryAction,
    env,
    undefined,
    attackAction.id,
  );
  if (!pending) {
    return rejected(world, 'InvalidActionDefinition', `${action.id} did not produce a target save`);
  }
  if (!Array.isArray(pending)) return pending;
  const obligations = actionObligationIds(
    action,
    'system:action-declaration',
    'system:attack-action',
    'system:attack-replacement',
  );
  const opened = pending.find((event) => event.payload.type === 'ResolutionOpened');
  if (!opened || opened.payload.type !== 'ResolutionOpened') {
    return rejected(world, 'InvalidDecision', 'Attack replacement did not open a durable resolution');
  }
  return [
    ...startEvents,
    actionDeclaredEvent({
      actorId: actor.id,
      action,
      targetIds: command.targetIds,
      timing: 'active',
      facts: {
        spatialByTarget: Object.fromEntries(command.targetIds.map((targetId) => [
          targetId,
          command.factsByTarget?.[targetId],
        ])),
        attackActionId: attackAction.id,
        attackEntryOrdinal: entry.ordinal,
        authoritativeAttacksPerAction: attackAction.sequence.totalAttacks,
        replacementPolicy: {
          replacementKey: replacement.replacementKey,
          replacesAttacks: replacement.replacesAttacks,
          oncePerAttackAction: replacement.oncePerAttackAction,
        },
      },
      obligationIds: obligations,
    }),
    attackEntryEvent({
      sourceActorId: actor.id,
      attackActionId: attackAction.id,
      entry,
      obligations,
    }),
    ...pending,
    blockAttackActionEvent({
      actorId: actor.id,
      attackActionId: attackAction.id,
      resolutionId: opened.payload.resolution.id,
      obligations,
    }),
  ];
}

function pactTomeRestRejectionCode(
  code: PactTomeWorldAdapterFailureCode,
): CommandRejectionCode {
  if (code === 'ActorNotFound') return 'ActorNotFound';
  if (code === 'FeatureNotGranted') return 'FeatureNotGranted';
  if (code === 'RulesetMismatch') return 'RulesetMismatch';
  if (code === 'RevisionConflict') return 'StaleRevision';
  if (code === 'SpellResourceUnavailable') return 'InsufficientResources';
  if (code === 'InvalidSelection'
    || code === 'InvalidCatalogAction'
    || code === 'InvalidRestSelection'
    || code === 'InvalidCommand') return 'InvalidDecision';
  return 'InvalidActionDefinition';
}

function pactTomeRestEvents(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  rest: 'short' | 'long';
  selection: NonNullable<Extract<
    GameCommand,
    { type: 'TakeShortRest' | 'TakeLongRest' }
  >['pactTome']>;
}): EventInput[] | CommandResult {
  const planned = planPactTomeRestTransition({
    world: input.world,
    catalog: input.catalog,
    actorId: input.actorId,
    commandId: input.commandId,
    rest: input.rest,
    selection: input.selection,
  });
  if (planned.status === 'rejected') {
    return rejected(
      input.world,
      pactTomeRestRejectionCode(planned.code),
      planned.message,
    );
  }
  return [{
    sourceActorId: input.actorId,
    obligationIds: [
      'system:pact-tome-rest',
      `system:${input.rest}-rest`,
      `entity:${planned.event.sourceEntityId}`,
    ],
    payload: planned.event,
  }];
}

function pactBladeRejectionCode(
  code: PactBladeWorldAdapterFailureCode,
): CommandRejectionCode {
  if (code === 'ActorNotFound') return 'ActorNotFound';
  if (code === 'FeatureNotGranted') return 'FeatureNotGranted';
  if (code === 'RulesetMismatch') return 'RulesetMismatch';
  if (code === 'RevisionConflict' || code === 'WorldRevisionConflict') return 'StaleRevision';
  if (code === 'TurnUnavailable') return 'InsufficientResources';
  if (code === 'InvalidTouchFacts'
    || code === 'InvalidDistanceFacts'
    || code === 'InvalidDeathFacts'
    || code === 'TouchRequired') return 'InvalidFacts';
  if (code === 'WeaponNotHeld') return 'WeaponNotEquipped';
  if (code === 'BladeUnavailable' || code === 'WeaponMismatch') return 'InvalidEquipmentState';
  if (code === 'IllegalWeapon' || code === 'IllegalAttackChoice') return 'NotWeapon';
  return 'InvalidActionDefinition';
}

function pactBladeBondEvents(input: {
  world: WorldState;
  command: Extract<GameCommand, { type: 'BondPactBlade' }>;
  catalog: RulesCatalog;
  env: DeterministicEnvironment;
}): CommandResult | EventInput[] {
  const { world, command, catalog, env } = input;
  let selection: Parameters<typeof planPactBladeBondTransition>[0]['selection'];
  if (command.mode === 'conjure') {
    selection = {
      mode: 'conjure',
      weaponCardId: command.weaponCardId,
      weaponObjectId: env.nextId(),
      conjureHand: command.hand,
    };
  } else {
    const object = world.objects[command.weaponObjectId];
    if (!object) {
      return rejected(world, 'WorldObjectNotFound', `Unknown world object ${command.weaponObjectId}`);
    }
    if (object.kind !== 'item' || !object.itemCardId) {
      return rejected(
        world,
        'InvalidEquipmentState',
        `${command.weaponObjectId} is not an item with an immutable Card bridge`,
      );
    }
    selection = {
      mode: 'touch_existing',
      weaponCardId: object.itemCardId,
      weaponObjectId: object.id,
      touchFacts: { ...command.facts, touched: command.facts.touched === true },
    };
  }
  const planned = planPactBladeBondTransition({
    world,
    catalog,
    actorId: command.actorId,
    commandId: command.commandId,
    selection,
  });
  if (planned.status === 'rejected') {
    return rejected(world, pactBladeRejectionCode(planned.code), planned.message);
  }
  return [{
    sourceActorId: command.actorId,
    obligationIds: [
      'system:pact-blade-bond',
      'system:bonus-action',
      `entity:${planned.event.sourceEntityId}`,
      `entity:${planned.event.activeBlade.weaponCardId}`,
    ],
    payload: planned.event,
  }];
}

function pactBladeDistanceEvents(input: {
  world: WorldState;
  command: Extract<GameCommand, { type: 'ObservePactBladeDistance' }>;
  catalog: RulesCatalog;
}): CommandResult | EventInput[] {
  const planned = planPactBladeDistanceTransition({
    world: input.world,
    catalog: input.catalog,
    actorId: input.command.actorId,
    commandId: input.command.commandId,
    weaponObjectId: input.command.weaponObjectId,
    facts: { ...input.command.facts },
  });
  if (planned.status === 'rejected') {
    return rejected(input.world, pactBladeRejectionCode(planned.code), planned.message);
  }
  return [{
    sourceActorId: input.command.actorId,
    obligationIds: [
      'system:pact-blade-distance',
      'system:explicit-time',
      `entity:${planned.event.sourceEntityId}`,
    ],
    payload: planned.event,
  }];
}

function adjudicateActorDeathEvents(input: {
  env: DeterministicEnvironment;
  world: WorldState;
  command: Extract<GameCommand, { type: 'AdjudicateActorDeath' }>;
  catalog: RulesCatalog;
  thresholdOrigin?: { condition: string; level: number };
}): CommandResult | EventInput[] {
  const { world, command, catalog } = input;
  const actor = world.actors[command.actorId];
  const fact = command.adjudication;
  if (actor.lifecycle?.status !== 'alive') {
    return rejected(world, 'InvalidFacts', `${actor.id} has already been adjudicated dead`);
  }
  if (!fact || fact.type !== 'ActorDeathAdjudicated'
    || fact.provenance !== 'canonical_actor_lifecycle'
    || typeof fact.factId !== 'string' || !fact.factId.trim()
    || typeof fact.adjudicatedBy !== 'string' || !fact.adjudicatedBy.trim()
    || fact.actorId !== actor.id
    || fact.observedAtWorldRevision !== world.revision
    || fact.rulesetContentHash !== world.ruleset.contentHash) {
    return rejected(world, 'InvalidFacts', 'Actor death requires an exact canonical lifecycle fact');
  }
  const events: EventInput[] = [{
    sourceActorId: actor.id,
    obligationIds: [
      'system:actor-lifecycle',
      ...(input.thresholdOrigin
        ? [
          'system:data-declared-condition-threshold',
          `system:condition:${input.thresholdOrigin.condition}`,
        ]
        : ['system:explicit-death-adjudication']),
    ],
    payload: JSON.parse(JSON.stringify(fact)) as typeof fact,
  }];
  if (actor.warlockPacts?.blade?.activeBond
    && actor.warlockPacts.blade.lifecyclePolicy.endOnOwnerDeath) {
    const planned = planPactBladeOwnerDeathTransition({
      world,
      catalog,
      actorId: actor.id,
      commandId: command.commandId,
      deathFact: fact,
    });
    if (planned.status === 'rejected') {
      return rejected(world, pactBladeRejectionCode(planned.code), planned.message);
    }
    events.push({
      sourceActorId: actor.id,
      obligationIds: [
        'system:actor-lifecycle',
        'system:pact-blade-owner-death',
        `entity:${planned.event.sourceEntityId}`,
      ],
      payload: planned.event,
    });
  }
  if (actor.warlockPacts?.tome) {
    const planned = planPactTomeOwnerDeathTransition({
      world,
      catalog,
      actorId: actor.id,
      commandId: command.commandId,
      deathFact: fact,
    });
    if (planned.status === 'rejected') {
      return rejected(world, pactTomeRestRejectionCode(planned.code), planned.message);
    }
    events.push({
      sourceActorId: actor.id,
      obligationIds: [
        'system:actor-lifecycle',
        'system:pact-tome-owner-death',
        `entity:${planned.event.sourceEntityId}`,
      ],
      payload: planned.event,
    });
  }
  const concentration = world.concentrations[actor.id];
  if (concentration) {
    const obligations = [
      'system:actor-lifecycle',
      'system:concentration-incapacitated',
    ];
    const linkedRuntimes = new Map<string, ActorState['runtime']>();
    for (const link of concentration.effectLinks) {
      const linkedActor = world.actors[link.actorId];
      if (!linkedActor) continue;
      const current = linkedRuntimes.get(link.actorId) ?? linkedActor.runtime;
      const linkedEffect = current.activeEffects.find((effect) => effect.id === link.effectId);
      if (!linkedEffect) continue;
      const ended = removeConcentrationEffects(linkedActor, current, new Set([link.effectId]), input.env);
      linkedRuntimes.set(link.actorId, ended.state);
      events.push(...engineTrace(actor.id, [link.actorId], ended.events, obligations));
      events.push(...engineTrace(actor.id, [link.actorId], [{
        type: 'effect_expired',
        name: linkedEffect.name,
      }], obligations));
    }
    for (const [linkedActorId, after] of [...linkedRuntimes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      events.push(...runtimeTransition(
        actor.id,
        linkedActorId,
        world.actors[linkedActorId].runtime,
        after,
        'action',
        obligations,
      ));
    }
    events.push(...concentrationWorldObjectCleanup(world, concentration, obligations), {
      sourceActorId: actor.id,
      obligationIds: obligations,
      payload: {
        type: 'ConcentrationCleared',
        sourceActorId: actor.id,
        concentrationId: concentration.id,
        reason: 'incapacitated',
      },
    });
  }
  return events;
}

function automaticTerminalConditionDeaths(input: {
  world: WorldState;
  command: GameCommand;
  catalog: RulesCatalog;
  env: DeterministicEnvironment;
}): CommandResult | { events: EventInput[]; world: WorldState } {
  const terminalByActor = new Map<string, ReturnType<typeof terminalConditionFacts>[number]>();
  for (const fact of terminalConditionFacts(input.world)
    .sort((left, right) => left.actorId.localeCompare(right.actorId)
      || left.condition.localeCompare(right.condition)
      || left.level - right.level)) {
    // Several future data-declared thresholds can reach death together. One
    // actor lifecycle transition is canonical; the deterministic first fact
    // owns its audit provenance.
    if (!terminalByActor.has(fact.actorId)) terminalByActor.set(fact.actorId, fact);
  }

  let current = input.world;
  const events: EventInput[] = [];
  for (const fact of terminalByActor.values()) {
    const actor = current.actors[fact.actorId];
    if (!actor || actor.lifecycle?.status !== 'alive') continue;
    const terminalCommandId = input.env.nextId();
    const adjudication = {
      type: 'ActorDeathAdjudicated' as const,
      provenance: 'canonical_actor_lifecycle' as const,
      factId: `${terminalCommandId}:${fact.condition}:${fact.level}`,
      actorId: actor.id,
      adjudicatedBy: 'system:data-declared-condition-threshold',
      observedAtWorldRevision: current.revision,
      rulesetContentHash: current.ruleset.contentHash,
    };
    const planned = adjudicateActorDeathEvents({
    env: input.env,
      world: current,
      command: {
        schemaVersion: input.command.schemaVersion,
        type: 'AdjudicateActorDeath',
        commandId: terminalCommandId,
        expectedRevision: current.revision,
        rulesetContentHash: current.ruleset.contentHash,
        actorId: actor.id,
        adjudication,
      },
      catalog: input.catalog,
      thresholdOrigin: { condition: fact.condition, level: fact.level },
    });
    if (!Array.isArray(planned)) return planned;
    events.push(...planned);
    current = foldEvents(
      current,
      planned.map((event, ordinal) => ({ ...event, ordinal })),
    );
  }
  return { events, world: current };
}

/** Invoke an existing owned self action at an explicit lifecycle boundary.
 * The same command validates equipment, resources, conditions and payment;
 * an item cannot grant or invent the referenced class feature. */
function encounterAutomaticActions(world:WorldState,command:GameCommand,catalog:RulesCatalog,env:DeterministicEnvironment):EventInput[]{
  let current=world;const changes:EventInput[]=[];
  for(const initial of Object.values(world.actors)){
    const rules=[...initial.passives??[],...initial.runtime.activeEffects.map(effect=>effect.mechanics)].flatMap(payloadsOf)
      .filter(payload=>payload.kind==='automatic_action'&&payload.event==='encounter_start');
    for(const rule of rules){
      const actor=current.actors[initial.id];
      if(rule.requires_owned!==true||rule.target!=='self'||!Array.isArray(rule.action_refs)||!rule.action_refs.every(ref=>typeof ref==='string'))throw Error('Invalid automatic owned action policy');
      if(!matchesWhen(rule.when as Record<string,unknown>[]|undefined,{state:actor.runtime,character:actor.character}))continue;
      const action=actor.capabilities.actionIds.map(id=>catalog.getAction(id)).find(candidate=>candidate&&candidate.kind==='nonSpell'
        &&(rule.action_refs as string[]).some(ref=>candidate.id===ref||candidate.sourceEntityIds.includes(ref)));
      if(!action||!actorHasConsciousVitality(actor))continue;
      if(activeEffectRequirementIssue(action.mechanics,actor.runtime,liveCharacter(actor))||!canPay(actor.runtime,activationCost(action)).ok)continue;
      const invoked:AuthoritativeUseActionCommand={schemaVersion:1,commandId:command.commandId,expectedRevision:current.revision,
        rulesetContentHash:command.rulesetContentHash,type:'UseAction',actorId:actor.id,actionId:action.id,targetIds:[actor.id],
        factsByTarget:{[actor.id]:{factsSource:'scenario',boardRevision:current.revision,distanceFt:0,relation:'self',cover:'none',lineOfSight:true}}};
      const executed=executeCommand(current,invoked,catalog,env);
      if(!Array.isArray(executed)){
        if(executed.status==='rejected'&&['InsufficientResources','InvalidActionTiming','InvalidEquipmentState','InvalidTarget','ForbiddenAction'].includes(executed.code))continue;
        throw Error(executed.status==='rejected'?executed.message:'Invalid automatic action result');
      }
      changes.push(...executed);current=foldEvents(current,executed.map((event,ordinal)=>({...event,ordinal})));
      if(current.pendingResolution)throw Error('Automatic lifecycle actions cannot silently answer player choices');
    }
  }
  return changes;
}

function executeChangeEquipmentPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ChangeEquipment'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const result=changeEquipment(actor,command.operation,env),obligations=['system:equipment-change'];
      if(result.seconds){
        const elapsed=advanceEffectTime(result.state,result.seconds,{...actionContext(actor,env),character:result.character,passives:result.passives});
        result.state=elapsed.state;result.events.push(...elapsed.events,{type:'narrative',text:`Смена экипировки: прошло ${result.seconds} секунд.`});
      }
      return [...runtimeTransition(actor.id,actor.id,actor.runtime,result.state,'action',obligations),
        {sourceActorId:actor.id,obligationIds:obligations,payload:{type:'ActorEquipmentProjectionChanged',actorId:actor.id,passives:result.passives,equippedCards:result.character.equippedCards}},
        ...engineTrace(actor.id,[actor.id],result.events,obligations)];
}

function executeStartEncounterPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'StartEncounter'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  if(world.scene.mode==='encounter')return rejected(world,'InvalidActionTiming','An active encounter cannot be restarted');
  const unique = new Set(command.initiative);
  if (command.initiative.length < 2 || unique.size !== command.initiative.length
    || command.initiative.some((actorId) => !world.actors[actorId])) {
    return rejected(world, 'InvalidInitiative', 'Initiative must contain at least two unique world actors');
  }
  const deadParticipant = command.initiative.find((actorId) => (
    world.actors[actorId].lifecycle?.status === 'dead'
  ));
  if (deadParticipant) {
    return rejected(
      world,
      'InvalidInitiative',
      `Adjudicated-dead actor ${deadParticipant} cannot join Initiative`,
    );
  }
  const presentFamiliars = Object.values(world.actors).filter((candidate) => (
    candidate.familiarState?.presence === 'present'
  ));
  const missingFamiliar = presentFamiliars.find((candidate) => !unique.has(candidate.id));
  const unavailableFamiliar = command.initiative
    .map((actorId) => world.actors[actorId])
    .find((candidate) => candidate.familiarState
      && candidate.familiarState.presence !== 'present');
  if (missingFamiliar || unavailableFamiliar) {
    return rejected(
      world,
      'InvalidInitiative',
      missingFamiliar
        ? `Present familiar ${missingFamiliar.id} must roll its own Initiative`
        : `Unavailable familiar ${unavailableFamiliar!.id} cannot join Initiative`,
    );
  }
  const familiarInitiativeEvents = presentFamiliars
    .filter((candidate) => unique.has(candidate.id))
    .map((candidate) => familiarStateChangedEvent({
      ownerActorId: candidate.familiarState!.ownerActorId,
      familiarActorId: candidate.id,
      familiar: rollFamiliarInitiative({
        familiar: candidate.familiarState!,
        modifier: candidate.familiarMetadata!.initiativeModifier,
        rng: env.rng,
      }),
      reason: 'initiative_rolled',
      obligations: ['system:initiative', 'system:find-familiar'],
    }));
  const encounterEvents:EventInput[]=[];
  for(const participantId of command.initiative) {
    const participant=world.actors[participantId];
    const result=startEncounter(participant.runtime,actionContext(participant,env));
    const obligations=['system:encounter-start','system:resource-recharge'];
    encounterEvents.push(
      ...runtimeTransition(participant.id,participant.id,participant.runtime,result.state,'action',obligations),
      ...engineTrace(participant.id,[participant.id],result.events,obligations),
    );
  }
  const started:EventInput[]=[...familiarInitiativeEvents, ...encounterEvents, {
    sourceActorId: command.actorId,
    obligationIds: ['system:initiative'],
    payload: {
      type: 'SceneSet',
      scene: {
        mode: 'encounter',
        initiative: [...command.initiative],
        activeIndex: 0,
        round: 1,
        turnStarted: false,
        initiativeSwapActorIds: [],
      },
    },
  }];
  return [...started,...encounterAutomaticActions(foldEvents(world,started.map((event,ordinal)=>({...event,ordinal}))),command,catalog,env)];
}

function executeDeathSavingThrowPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'DeathSavingThrow'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const before=actor.runtime,ds=before.deathSaves??emptyDeathSaves();
      const immediate=before.firedThisTurn?.includes('system:immediate-death-save-due');
      if(actor.kind!=='playerCharacter'||before.hp.current!==0||ds.dead||ds.stable
        ||(!immediate && (!before.firedThisTurn?.includes('system:death-save-due')
          ||before.firedThisTurn?.includes('system:death-save'))))return rejected(world,'InvalidActionTiming','Death save is not due');
      const roll=rollDeathSaveDie(before,actor.passives??[],actorFormulaContext(actor.character),env.rng);
      const natural=roll.dice.find(d=>d.sides===20&&!d.discarded)!.result;
      const result=applyDeathSaveRoll(ds,natural,roll.total,roll.outcome,collectLifePolicies(before,actor.passives??[],actor.character));
      roll.kind='save';roll.deathSave=true;roll.target={type:'dc',value:10};roll.outcome=['revive','success','stable'].includes(result.outcome)?'success':'fail';
      roll.text=describeDeathSaveOutcome(result.outcome,natural);
      const after={...before,deathSaves:result.next,
        hp:result.outcome==='revive'?{...before.hp,current:1}:before.hp,
        firedThisTurn:immediate?(before.firedThisTurn??[]).filter(id=>id!=='system:immediate-death-save-due')
          :[...(before.firedThisTurn??[]),'system:death-save']};
      return [...runtimeTransition(actor.id,actor.id,before,after,'start_turn',['system:death-save']),
        ...engineTrace(actor.id,[],[{type:'roll',label:'Спасбросок от смерти',roll}],['system:death-save'])];
}

function executeStartTurnPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'StartTurn'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const boundary = sourceTurnBoundary(world, actor.id, 'start');
      const before = boundary.runtimes.get(actor.id) ?? actor.runtime;
      const turnContext = {
        ...actorContext({ ...actor, runtime: before }),
        rng: env.rng,
      };
      const started = startTurn(before, turnContext);
      const commandResolution = resolveNextTurnCommand(started.state, {
        ...actionContext({ ...actor, runtime: started.state }, env),
        selfId: actor.id,
      });
      const result = commandResolution
        ? {
          ...started,
          state: commandResolution.state,
          events: [...started.events, ...commandResolution.events],
        }
        : started;
      if(actor.kind==='playerCharacter' && result.state.hp.current===0 && !result.state.deathSaves?.dead && !result.state.deathSaves?.stable){
        result.state={...result.state,firedThisTurn:[...(result.state.firedThisTurn??[]),'system:death-save-due']};
      }
      const scene = world.scene as EncounterScene;
      const turnStartChoices = command.turnStartChoices ?? [];
      if (turnStartChoices.length > 1) {
        return rejected(world, 'InvalidDecision', 'Only one start-of-turn grapple-damage target can be selected');
      }
      const turnStartChoice = turnStartChoices[0];
      const grappleDamage = resolveTurnStartGrappleDamage({
        passives: actor.passives ?? [],
        sourceActorId: actor.id,
        selectedCapabilityId: turnStartChoice?.capabilityId,
        selectedTargetActorId: turnStartChoice?.targetActorId,
        grapples: Object.values(world.grapples),
        rng: env.rng,
      });
      if (grappleDamage.status === 'invalid_capability'
        || grappleDamage.status === 'invalid_target'
        || (grappleDamage.status === 'unavailable' && turnStartChoices.length)) {
        return rejected(world, 'InvalidDecision', `Invalid start-of-turn Fighting Style choice: ${grappleDamage.status}`);
      }
      const grappleDamageEvents: EventInput[] = [];
      if (grappleDamage.status === 'resolved') {
        const target = world.actors[grappleDamage.targetActorId];
        if (!target) return rejected(world, 'ActorNotFound', `Unknown grapple target ${grappleDamage.targetActorId}`);
        const targetBefore = boundary.runtimes.get(target.id) ?? target.runtime;
        const incoming = applyIncomingDamage(
          targetBefore,
          grappleDamage.amount,
          actionContext({ ...target, runtime: targetBefore }, env),
          { damageType: grappleDamage.damageType },
        );
        const obligations = [
          'system:turn-start',
          `capability:${grappleDamage.capabilityId}`,
          'system:grapple',
        ];
        grappleDamageEvents.push(
          ...runtimeTransition(actor.id, target.id, targetBefore, incoming.state, 'start_turn', obligations),
          ...engineTrace(actor.id, [target.id], [
            {
              type: 'narrative',
              text: `${grappleDamage.source}: ${grappleDamage.dice} = ${grappleDamage.amount}`,
            },
            ...incoming.events,
          ], obligations),
        );
      }
      const familiarLifecycleEvents: EventInput[] = [];
      if (actor.familiarState) {
        familiarLifecycleEvents.push(familiarStateChangedEvent({
          ownerActorId: actor.familiarState.ownerActorId,
          familiarActorId: actor.id,
          familiar: startFamiliarTurn({
            familiar: actor.familiarState,
            familiarActorId: actor.id,
          }),
          reason: 'turn_started',
          obligations: ['system:turn-start', 'system:find-familiar', 'system:reaction-refresh'],
        }));
      }
      for (const familiar of familiarActorsOwnedBy(world, actor.id)) {
        if (!familiar.familiarState) continue;
        const after = startOwnerTurnForFamiliar({
          familiar: familiar.familiarState,
          ownerActorId: actor.id,
          ownerTurn: world.logicalClock,
        });
        if (JSON.stringify(after) !== JSON.stringify(familiar.familiarState)) {
          familiarLifecycleEvents.push(familiarStateChangedEvent({
            ownerActorId: actor.id,
            familiarActorId: familiar.id,
            familiar: after,
            reason: 'shared_senses_ended',
            obligations: ['system:turn-start', 'system:find-familiar', 'system:effect-lifecycle'],
          }));
        }
      }
      const protectionLifecycleEvents: EventInput[] = [];
      for (const effect of actorProtectionEffects(actor)) {
        const lifecycleEvent = {
          type: 'turn_started' as const,
          factsSource: 'scenario' as const,
          worldRevision: world.revision,
          actorId: actor.id,
        };
        const advanced = advanceProtection2024Effect(effect, lifecycleEvent);
        if (advanced.status !== 'ended' || advanced.reason !== 'protector_turn_started') {
          return rejected(world, 'InvalidDecision', `Protection turn lifecycle was rejected: ${advanced.reason}`);
        }
        protectionLifecycleEvents.push({
          sourceActorId: actor.id,
          obligationIds: [
            'system:turn-start',
            'system:fighting-style-protection',
            'system:effect-lifecycle',
            ...effect.source.sourceEntityIds.map((id) => `entity:${id}`),
          ],
          payload: {
            type: 'ProtectionEffectEnded',
            protectorActorId: actor.id,
            protectedTargetActorId: effect.protectedTargetActorId,
            effectId: effect.id,
            reason: 'protector_turn_started',
            lifecycleEvent,
          },
        });
      }
      return [
        ...boundary.events,
        ...runtimeTransition(actor.id, actor.id, before, result.state, 'start_turn', ['system:turn-start']),
        ...engineTrace(actor.id, [], result.events, ['system:turn-start']),
        ...grappleDamageEvents,
        ...familiarLifecycleEvents,
        ...protectionLifecycleEvents,
        {
          sourceActorId: actor.id,
          obligationIds: ['system:turn-start'],
          payload: { type: 'SceneSet', scene: { ...scene, turnStarted: true } },
        },
      ];
}

function executeEndTurnPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'EndTurn'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const boundary = sourceTurnBoundary(world, actor.id, 'end');
      const before = boundary.runtimes.get(actor.id) ?? actor.runtime;
      const turnContext = { ...actorContext({ ...actor, runtime: before }), rng: env.rng };
      const result = endTurn(
        before,
        turnContext,
        { advanceRoundDurations: false },
      );
      const scene = world.scene;
      const nextIndex = scene.mode === 'encounter' ? (scene.activeIndex + 1) % scene.initiative.length : 0;
      const nextRound = scene.mode === 'encounter' ? (nextIndex === 0 ? scene.round + 1 : scene.round) : 0;
      const sourceRelative = endSourceActorTurnWorldObjects({
        objects: world.objects,
        sourceActorId: actor.id,
      });
      const elapsed = scene.mode !== 'encounter' || nextRound > scene.round
        ? advanceWorldObjectRounds({ objects: sourceRelative.objects, rounds: 1 })
        : { objects: sourceRelative.objects, events: [] };
      const roundExpiryEvents:EventInput[]=[];
      if(scene.mode==='encounter'&&nextRound>scene.round) {
        for(const participantId of scene.initiative) {
          const participant=world.actors[participantId];
          const current=participantId===actor.id?result.state:boundary.runtimes.get(participantId)??participant.runtime;
          const expired=expireEncounterRound(current);
          const obligations=['system:round-end'];
          roundExpiryEvents.push(
            ...runtimeTransition(actor.id,participantId,current,expired.state,'end_turn',obligations),
            ...engineTrace(participantId,[participantId],expired.events,obligations,{sourceActorId:actor.id}),
          );
        }
      }
      return [
        ...(openAttackAction(world, actor.id) ? [{
          sourceActorId: actor.id,
          obligationIds: ['system:attack-action', 'system:turn-end'],
          payload: {
            type: 'AttackActionClosed' as const,
            attackActionId: openAttackAction(world, actor.id)!.id,
            reason: 'forfeited' as const,
          },
        }] : []),
        ...boundary.events,
        ...runtimeTransition(actor.id, actor.id, before, result.state, 'end_turn', ['system:turn-end']),
        ...engineTrace(actor.id, [], result.events, ['system:turn-end']),
        ...roundExpiryEvents,
        ...worldObjectEvents(
          actor.id,
          CORE_WORLD_TIME_ACTION,
          sourceRelative.events,
          'system:world-object-source-turn-duration',
        ),
        ...worldObjectEvents(
          actor.id,
          CORE_WORLD_TIME_ACTION,
          elapsed.events,
          'system:world-object-duration',
        ),
        {
          sourceActorId: actor.id,
          obligationIds: ['system:turn-order'],
          payload: { type: 'SceneSet', scene: scene.mode === 'encounter' ? { ...scene, activeIndex: nextIndex, round: nextRound, turnStarted: false } : scene },
        },
      ];
}

function executeTakeShortRestPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'TakeShortRest'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const context = { ...actorContext(actor), rng: env.rng };
      const preview = shortRest(actor.runtime, context, { preview: true });
      const rawDecisions: unknown = command.decisions ?? [];
      if (!Array.isArray(rawDecisions)
        || rawDecisions.some((decision) => (
          !decision || typeof decision !== 'object'
            || typeof (decision as Record<string, unknown>).type !== 'string'
            || !Array.isArray((decision as Record<string, unknown>).slotLevels)
        ))) {
        return rejected(world, 'InvalidDecision', 'Short Rest decisions are malformed');
      }
      const availableRestActions = catalog.listActions?.().filter((action) => (
        action.restDecision?.rest === 'short_rest'
      )) ?? [];
      const decisions = command.decisions ?? [];
      const selectedPolicies: Array<{
        action: RuleActionDefinition;
        policy: NonNullable<RuleActionDefinition['restDecision']>;
        sources: readonly [string, ...string[]];
      }> = [];
      for (const decision of decisions) {
        const matches = availableRestActions.flatMap((action) => {
          const policy = action.restDecision;
          if (!policy || policy.decisionType !== decision.type) return [];
          const sources = actor.capabilities.featureSources?.[policy.capabilityId];
          if (!sources || !action.sourceEntityIds.some((sourceId) => sources.includes(sourceId))) {
            return [];
          }
          return [{ action, policy, sources }];
        });
        if (matches.length === 0) {
          return rejected(world, 'FeatureNotGranted', `${actor.id} does not own ${decision.type}`);
        }
        if (matches.length !== 1) {
          return rejected(world, 'InvalidDecision', `${decision.type} has ambiguous catalog policies`);
        }
        selectedPolicies.push(matches[0]);
      }
      const countsByAction = new Map<string, number>();
      for (const selection of selectedPolicies) {
        const count = (countsByAction.get(selection.action.id) ?? 0) + 1;
        if (count > selection.policy.maximumPerRest) {
          return rejected(
            world,
            'InvalidDecision',
            `${selection.policy.decisionType} can be selected at most `
              + `${selection.policy.maximumPerRest} time(s) per rest`,
          );
        }
        countsByAction.set(selection.action.id, count);
      }
      let stateAfterRest = preview.state;
      const recoveryEvents: EngineEvent[] = [];
      for (let index = 0; index < decisions.length; index += 1) {
        const selection = selectedPolicies[index];
        const recovery = resolveSlotRecoveryRestDecision({
          state: stateAfterRest,
          classLevels: actor.character.classLevels,
          policy: selection.policy,
          decision: decisions[index],
        });
        if (recovery.status === 'rejected') {
          return rejected(world, 'InvalidDecision', recovery.message);
        }
        stateAfterRest = recovery.state;
        recoveryEvents.push({
          type: 'resource_spent',
          ...recovery.spentResource,
        });
        for (const restored of recovery.restoredResources) {
          recoveryEvents.push({
            type: 'resource_restored',
            ...restored,
          });
        }
      }
      const obligations = [
        'system:short-rest',
        'system:resource-recharge',
        ...selectedPolicies.map(({ policy }) => `capability:${policy.capabilityId}`),
        ...selectedPolicies.flatMap(({ sources }) => (
          sources.map((sourceId) => `entity:${sourceId}`)
        )),
      ];
      const tomeEvents = command.pactTome
        ? pactTomeRestEvents({
          world,
          catalog,
          actorId: actor.id,
          commandId: command.commandId,
          rest: 'short',
          selection: command.pactTome,
        })
        : [];
      if (!Array.isArray(tomeEvents)) return tomeEvents;
      // Validate all choices before the one authoritative rest/chance draw.
      const result = shortRest(actor.runtime, context);
      stateAfterRest = result.state;
      recoveryEvents.length = 0;
      if (!result.restBenefitsDenied) for (let index = 0; index < decisions.length; index += 1) {
        const recovery = resolveSlotRecoveryRestDecision({ state: stateAfterRest, classLevels: actor.character.classLevels,
          policy: selectedPolicies[index].policy, decision: decisions[index] });
        if (recovery.status === 'rejected') throw Error(recovery.message);
        stateAfterRest = recovery.state;
        recoveryEvents.push({ type: 'resource_spent', ...recovery.spentResource }, ...recovery.restoredResources.map(restored => ({ type: 'resource_restored' as const, ...restored })));
      }
      return [
        ...runtimeTransition(actor.id, actor.id, actor.runtime, stateAfterRest, 'short_rest', obligations),
        ...engineTrace(actor.id, [], [...result.events, ...recoveryEvents], obligations),
        ...(result.restBenefitsDenied ? [] : tomeEvents),
      ];
}

function executeTakeLongRestPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'TakeLongRest'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      const durationHours = command.durationHours ?? 8;
      const eligibility = longRestEligibility(actor.traits, durationHours);
      if (!eligibility.eligible) {
        return rejected(
          world,
          'InvalidFacts',
          `Long Rest requires ${eligibility.requiredHours} hours; received ${durationHours}`,
        );
      }
      const context = { ...actorContext(actor), rng: env.rng };
      const obligations = [
        'system:long-rest',
        'system:resource-recharge',
        'system:rest-duration',
        ...(actor.traits?.restProfile?.sourceEntityIds ?? []).map((id) => `entity:${id}`),
      ];
      const tomeEvents = command.pactTome
        ? pactTomeRestEvents({
          world,
          catalog,
          actorId: actor.id,
          commandId: command.commandId,
          rest: 'long',
          selection: command.pactTome,
        })
        : [];
      if (!Array.isArray(tomeEvents)) return tomeEvents;
      const wildCompanion = familiarActorsOwnedBy(world, actor.id).find((candidate) => {
        const summoningActionId = candidate.familiarMetadata?.summoningActionId;
        const summoningAction = summoningActionId ? catalog.getAction(summoningActionId) : undefined;
        return (summoningAction?.mechanics.primitive as Record<string, unknown> | undefined)?.type
          === WILD_COMPANION_PRIMITIVE;
      });
      const wildCompanionEnd: EventInput[] = wildCompanion ? [{
        sourceActorId: actor.id,
        obligationIds: [
          'system:long-rest',
          'system:wild-companion',
          `entity:${wildCompanion.familiarMetadata!.summoningActionId}`,
        ],
        payload: {
          type: 'FamiliarActorRemoved',
          ownerActorId: actor.id,
          familiarActorId: wildCompanion.id,
          reason: 'wild_companion_long_rest',
          droppedItemIds: [
            ...wildCompanion.familiarState!.carriedItemIds,
            ...wildCompanion.familiarState!.wornItemIds,
          ].sort((left, right) => left.localeCompare(right)),
        },
      }] : [];
      const result = longRest(actor.runtime, context);
      return [
        ...runtimeTransition(actor.id, actor.id, actor.runtime, result.state, 'long_rest', obligations),
        ...engineTrace(actor.id, [], result.events, obligations),
        ...(result.restBenefitsDenied ? [] : tomeEvents),
        ...wildCompanionEnd,
      ];
}

function executeUseAttackReplacementPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'UseAttackReplacement'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return executeAttackReplacement(world, command, catalog, env);
}

function executeBeginAttackActionPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'BeginAttackAction'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return beginAttackAction(world, command, catalog, env);
}

function executePerformWeaponAttackPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PerformWeaponAttack'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return performWeaponAttack(world, command, catalog, env);
}

function executePerformLightWeaponExtraAttackPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PerformLightWeaponExtraAttack'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return performLightWeaponExtraAttack(world, command, catalog, env);
}

function executePerformWeaponMasteryCleaveAttackPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PerformWeaponMasteryCleaveAttack'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return performWeaponMasteryCleaveAttack(world, command, catalog, env);
}

function executePerformUnarmedStrikePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PerformUnarmedStrike'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return executeUnarmedStrike(world, command, catalog, env);
}

function executePerformPactChainFamiliarAttackPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PerformPactChainFamiliarAttack'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return performPactChainFamiliarAttack(world, command, catalog, env);
}

function executeBondPactBladePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'BondPactBlade'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return pactBladeBondEvents({ world, command, catalog, env });
}

function executeObservePactBladeDistancePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ObservePactBladeDistance'}>,
  catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return pactBladeDistanceEvents({ world, command, catalog });
}

function executeAdjudicateActorDeathPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'AdjudicateActorDeath'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return adjudicateActorDeathEvents({ world, command, catalog, env });
}

function executeForfeitAttackActionPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ForfeitAttackAction'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return forfeitAttackAction(world, command);
}

function executeEscapeGrapplePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'EscapeGrapple'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return openEscapeGrapple(world, command, env);
}

function executeReleaseGrapplePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ReleaseGrapple'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return releaseGrapple(world, command);
}

function executeBreakGrappleRangePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'BreakGrappleRange'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return breakGrappleRange(world, command);
}

function executeObserveProtectionProximityPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ObserveProtectionProximity'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return observeProtectionProximity(world, command);
}

function executeUseActionPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'UseReactionAction' | 'UseTriggeredAction' | 'UseAction'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
    const actor = world.actors[command.actorId];

        const hideDeclaration = catalog.getAction(command.actionId);
        if ((hideDeclaration?.mechanics.activation as Record<string, unknown> | undefined)?.counts_as === 'hide') {
          return rejected(world, 'InvalidActionTiming', 'Hide requires AttemptHide with observable eligibility facts');
        }
        if (actor.warlockPacts?.blade?.bondActionId === command.actionId) {
          return rejected(
            world,
            'InvalidActionTiming',
            `${command.actionId} is a canonical Pact Blade transition and must use BondPactBlade`,
          );
        }
        const action = catalog.getAction(command.actionId);
        if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${command.actionId}`);
        if(actor.itemTurn){
          if(command.type!=='UseAction')return rejected(world,'InvalidActionTiming','Item initiative permits only its declared attack');
          const {spell:_spell,...itemCommand}=command;
          return executeItemTurnAction(world,itemCommand,action,catalog,env);
        }
        if(action.concentration && world.concentrations[actor.id] && concentrationProtectedUntilDeath(actor.runtime,actor.passives??[])) {
          return rejected(world,'InvalidActionTiming','Concentration can be lost only upon death while this source is active');
        }
        const definitionIssue = actionDefinitionIssue(action);
        if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
        const levelRequirement = parseActivationLevelRequirement(action.mechanics);
        if (levelRequirement.status === 'invalid') {
          return rejected(world, 'InvalidActionDefinition', `${action.id}: ${levelRequirement.issue}`);
        }
        if (levelRequirement.status === 'required'
          && actor.character.level < levelRequirement.minLevel) {
          return rejected(
            world,
            'InvalidActionTiming',
            `${action.id} requires character level ${levelRequirement.minLevel}`,
          );
        }
        const variantParentId=action.mechanics.variant_of_spell_id;
        const variantScope=action.sourceEntityIds[0]&&action.id.startsWith(action.sourceEntityIds[0])
          ?action.id.slice(action.sourceEntityIds[0].length):'';
        const variantParent=typeof variantParentId==='string'
          ?catalog.getAction(`${variantParentId}${variantScope}`)??catalog.getAction(variantParentId):undefined;
        const actionParentId=action.mechanics.variant_of_action_id;
        const actionVariantParent=typeof actionParentId==='string'
          ?catalog.getAction(`${actionParentId}${variantScope}`)??catalog.getAction(actionParentId):undefined;
        if(variantParentId!==undefined&&(
          action.kind!=='spell'||!variantParent||variantParent.kind!=='spell'
          ||!Array.isArray(variantParent.mechanics.spell_variant_ids)
          ||!action.sourceEntityIds.some(id=>(variantParent.mechanics.spell_variant_ids as string[]).includes(id))
          ||variantParent.spell.level!==action.spell.level))
          return rejected(world,'InvalidActionDefinition','Вариант не связан с родительским заклинанием');
        if(actionParentId!==undefined&&(
          action.kind!=='nonSpell'||!actionVariantParent||actionVariantParent.kind!=='nonSpell'
          ||!Array.isArray(actionVariantParent.mechanics.action_variant_ids)
          ||!action.sourceEntityIds.some(id=>(actionVariantParent.mechanics.action_variant_ids as string[]).includes(id))))
          return rejected(world,'InvalidActionDefinition','Вариант не связан с родительским действием');
        if(action.kind==='spell'&&Array.isArray(action.mechanics.spell_variant_ids))
          return rejected(world,'InvalidDecision','Выберите вариант заклинания до его применения');
        if(action.kind==='nonSpell'&&Array.isArray(action.mechanics.action_variant_ids))
          return rejected(world,'InvalidDecision','Выберите вариант действия до его применения');
        const grantAction=variantParent??actionVariantParent??action;
        if (!actor.capabilities.actionIds.includes(grantAction.id)
          && !matchingRuntimeActionGrants(actor.runtime,grantAction.mechanics,actor.character.level).length
          && !worldItemActionSource(world,actor.id,grantAction)) {
          return rejected(world, 'ActionNotGranted', `Actor ${actor.id} does not own action ${action.id}`);
        }
        if (action.attackReplacement) {
          return rejected(
            world,
            'InvalidActionTiming',
            `${action.id} must replace an attack through the Attack-action sequence`,
          );
        }
        if (command.type === 'UseTriggeredAction') {
          const activation = action.mechanics.activation as Record<string, unknown> | undefined;
          const trigger = activation?.trigger as Record<string, unknown> | undefined;
          const events = [trigger?.event, ...(Array.isArray(trigger?.events) ? trigger.events : [])];
          if (activationMode(action) !== 'triggered' || !events.includes(command.trigger)) {
            return rejected(world, 'InvalidActionTiming', `${action.id} does not declare the ${command.trigger} ability trigger`);
          }
        } else if (command.type === 'UseReactionAction') {
          if (activationMode(action) !== 'reaction' || !hasReactionTrigger(action, command.trigger)) {
            return rejected(
              world,
              'InvalidActionTiming',
              `${action.id} does not declare the ${command.trigger} reaction trigger`,
            );
          }
        } else if (activationMode(action) === 'reaction') {
          return rejected(world, 'InvalidActionTiming', `${action.id} can only be used in a reaction window`);
        }
        const requiredCapability = requiredActionCapability(action);
        const denied = deniedCapabilities(actor.runtime, actor.passives ?? []);
        if (denied.has(requiredCapability)
          || (action.kind === 'spell' && denied.has('spellcasting'))) {
          return rejected(world, 'CapabilityDenied', `${actor.id} cannot use ${requiredCapability} in its current state`);
        }
        const declarationIssue = spellDeclarationIssue(action, command.spell);
        if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
        let preparedSpell: PreparedSpellExecution | undefined;
        let spellAudit: Pick<
          CanonicalSpellContext,
          'baseCastingTimeSeconds' | 'castingTimeAddedSeconds' | 'focusObjectId' | 'focusHand'
        > | undefined;
        let pactTomeFocusObjectId: string | undefined;
        const pactBladeFocusEvents: EventInput[] = [];
        const triggeredTargeting=bindTriggeredAttackTargeting(action,command.targetIds,
          command.type==='UseTriggeredAction'?command.triggeringAttack:undefined);
        if(triggeredTargeting.issue)return rejected(world,'InvalidTargets',triggeredTargeting.issue);
        let executableAction = triggeredTargeting.action;
        if (executableAction.kind === 'spell' && actor.spellcastingAccess) {
          const preparation = prepareSpellExecution({
            action:executableAction,
            ...(variantParent?{accessActionId:variantParent.id}:{}),
            accessState: actor.spellcastingAccess,
            resources: availableResources(actor.runtime,actor.character,actor.passives),
            declaration: {
              ...(command.spell?.grantId ? { grantId: command.spell.grantId } : {}),
              ...(command.spell?.mode ? { mode: command.spell.mode } : {}),
              ...(command.spell?.preferFreeUse !== undefined
                ? { preferFreeUse: command.spell.preferFreeUse }
                : {}),
              ...(command.spell?.castLevel!==undefined?{castLevel:command.spell.castLevel}:{}),
            },
          });
          if (preparation.status === 'rejected') {
            if (preparation.stage === 'action_definition') {
              return rejected(world, 'InvalidActionDefinition', preparation.message);
            }
            return rejected(
              world,
              preparation.code === 'SpellResourceUnavailable'
                ? 'InsufficientResources'
                : 'InvalidSpellDeclaration',
              preparation.message,
            );
          }
          if (preparation.provenance.mode === 'ritual' && world.scene.mode === 'encounter') {
            return rejected(world, 'InvalidActionTiming', 'A ritual cast requires additional casting time');
          }
          const tomeAudit = pactTomeSpellCastAudit({
            world,
            actorId: actor.id,
            actionId: variantParent?.id??preparation.executableAction.id,
            grantId: preparation.provenance.grantId,
            sourceId: preparation.provenance.sourceId,
            mode: preparation.provenance.mode,
            payment: preparation.payment,
          });
          if (tomeAudit.status === 'rejected') {
            return rejected(world, 'InvalidActionDefinition', tomeAudit.message);
          }
          spellAudit = tomeAudit.status === 'ready'
            ? {
              focusObjectId: tomeAudit.focusObjectId,
              castingTimeAddedSeconds: tomeAudit.castingTimeAddedSeconds,
            }
            : preparation.provenance.mode === 'ritual'
              ? { castingTimeAddedSeconds: PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS }
              : undefined;
          pactTomeFocusObjectId = tomeAudit.status === 'ready'
            ? tomeAudit.focusObjectId
            : undefined;
          preparedSpell = preparation;
          executableAction = preparation.executableAction;
          if (executableAction.mechanics.requires_unknown_spell === true) {
            const spellEntityId = executableAction.spell?.entityId;
            const alreadyKnown = actor.spellcastingAccess.grants.some((grant) => {
              if (grant.grantId === preparation.provenance.grantId) return false;
              const other = catalog.getAction(grant.actionId);
              return spellEntityId !== undefined && other?.kind === 'spell'
                && other.spell.entityId === spellEntityId;
            });
            if (alreadyKnown) {
              return rejected(world, 'InvalidSpellDeclaration', 'Выбранный заговор уже известен персонажу');
            }
          }
        }
          const teleportPolicy=action.mechanics.teleport_destination as Record<string,unknown>|undefined;
          const teleportIssue=teleportDestinationIssue(action,command.factsByTarget?.[
            teleportPolicy?.relative_to==='target'?command.targetIds[0]:actor.id]);
        if(teleportIssue)return rejected(world,'InvalidFacts',teleportIssue);
          const beneficiaryPolicy=action.mechanics.beneficiary_policy as Record<string,unknown>|undefined;
          if(beneficiaryPolicy){
            const group=beneficiaryPolicy.group,limit=Number(beneficiaryPolicy.max_targets);
            if(typeof group!=='string'||!group||!Number.isSafeInteger(limit)||limit<1)
              return rejected(world,'InvalidActionDefinition','Invalid beneficiary policy');
            const already=new Set(Object.values(world.actors).filter(candidate=>candidate.runtime.activeEffects.some(effect=>
              effect.sourceId===actor.id&&(effect.mechanics.bond_policy as Record<string,unknown>|undefined)?.group===group)).map(candidate=>candidate.id));
            const chosen=new Set([...already,...command.targetIds]);
            if(command.targetIds.includes(actor.id)||chosen.size>limit)
              return rejected(world,'InvalidDecision',`Выберите не более ${limit} других существ для благословения`);
          }
          const resurrectionPolicy=action.mechanics.resurrection_policy as Record<string,unknown>|undefined;
          if(resurrectionPolicy){
            const target=world.actors[command.targetIds[0]],facts=command.factsByTarget?.[command.targetIds[0]];
            const maxDays=Number(resurrectionPolicy.max_dead_days);
            if(command.targetIds.length!==1||!Number.isFinite(maxDays)||maxDays<=0||resurrectionPolicy.restore_full_hp!==true)
              return rejected(world,'InvalidActionDefinition','Invalid resurrection policy');
            if(!target||(target.lifecycle?.status!=='dead'&&target.runtime.deathSaves?.dead!==true)
              ||!facts||!['scenario','gm_ruling'].includes(facts.factsSource)
              ||!Number.isFinite(facts.deadForDays)||Number(facts.deadForDays)<0||Number(facts.deadForDays)>maxDays
              ||facts.deathByOldAge!==false||facts.targetIsUndead!==false||facts.soulFree!==true||facts.soulWilling!==true)
              return rejected(world,'InvalidFacts','Воскрешение требует подходящего мёртвого тела, свободной согласной души и подтверждённых обстоятельств смерти');
          }
        if ((action.mechanics.activation as Record<string,unknown>|undefined)?.telekinetic_movement === true) {
          const targetId=command.targetIds.length===1?command.targetIds[0]:'';
          const observed=command.factsByTarget?.[targetId];
          if(!observed?.telekineticMovementValidated || observed.canSeeTarget!==true || observed.distanceFt>30 || (observed.telekineticObjectId ? targetId!==actor.id || telekineticObjectIssue(world, actor.id, observed) !== null : targetId===actor.id || observed.willing!==true)) return rejected(world,'InvalidFacts','Телекинетическое перемещение требует выбора согласной цели и свободного места на поле');
        }
        if ((action.mechanics.activation as Record<string, unknown> | undefined)?.weapon_bond_recall === true) {
          const issue = weaponBondRecallIssue(world, actor.id, command.choices);
          if (issue || command.targetIds.length !== 1 || command.targetIds[0] !== actor.id) return rejected(world, 'InvalidDecision', issue ?? 'Призыв оружия направлен на себя');
        }
        const disarmIssue = disarmingSelectionIssue(action.mechanics, world.actors[command.targetIds[0]]?.runtime, command.choices);
        if(disarmIssue)return rejected(world,'InvalidDecision',disarmIssue);
        if (((action.mechanics.activation as Record<string, unknown> | undefined)?.trigger as Record<string, unknown> | undefined)?.disarm_held_item) {
          const selected = command.choices?.disarm_held_item;
          const hand = Array.isArray(selected) ? selected[0] : selected;
          if (typeof hand === 'string' && weaponBondProtectsHand(world, command.targetIds[0], hand)) return rejected(world, 'InvalidDecision', 'Связанное оружие нельзя выбить из рук');
        }
        executableAction=bindItemLightFuel(world,actor.id,bindWorldItemAction(world,actor.id,executableAction));
        const magicIssue=magicActionIssue(actor,executableAction,command.targetIds.map(id=>world.actors[id]).filter(Boolean));
        if(magicIssue)return rejected(world,'InvalidActionTiming',magicIssue);
        const activeEffectIssue = activeEffectRequirementIssue(executableAction.mechanics, actor.runtime, actor.character);
        if (activeEffectIssue) {
          return rejected(world, 'InvalidActionTiming', activeEffectIssue);
        }
        executableAction = catalogActionForActor(actor, executableAction);
        executableAction = {
          ...executableAction,
          mechanics: projectQuickenedSpellCost(
            projectActionSurgeCost(
              executableAction.mechanics,
              actor.runtime,
              executableAction.kind === 'spell' ? 'spell' : 'nonspell',
            ),
            actor.runtime,
            executableAction.kind === 'spell' ? 'spell' : 'nonspell',
          ),
        };
        const costPolicyContext={state:actor.runtime,character:actor.character,passives:actor.passives??[],
          actionRefs:[executableAction.id,...executableAction.sourceEntityIds],
          ...(executableAction.kind==='spell' ? {spell:{baseLevel:executableAction.spell?.level??0,school:executableAction.spell?.school,concentration:executableAction.concentration===true}} : {})};
        const optionalPolicies=availableActionCostPolicies(executableAction.mechanics,costPolicyContext).filter(policy=>policy.optional);
        if (command.selectedCostPolicyId===undefined && optionalPolicies.length) {
          return [{sourceActorId:actor.id,obligationIds:['system:action-cost-policy'],payload:{type:'ResolutionOpened',resolution:{
            id:env.nextId(),type:'action_cost_policy',openedByCommandId:command.commandId,
            openedAtRevision:world.revision,deadlineLogicalClock:world.logicalClock+10,actorId:actor.id,
            continuation:JSON.parse(JSON.stringify(command)),request:{id:env.nextId(),type:'action_cost_policy',actorId:actor.id,
              options:optionalPolicies.map(({policyId,label,sourceEntity})=>({policyId,label,...(sourceEntity?{sourceEntity}:{})}))},
          }}}];
        }
        try {
          const costPolicy=applyActionCostPolicies(executableAction.mechanics,costPolicyContext,command.selectedCostPolicyId);
          executableAction={...executableAction,mechanics:{...costPolicy.mechanics,
            ...(costPolicy.spellOverrides?.durationCapRounds!==undefined?{duration_cap_rounds:costPolicy.spellOverrides.durationCapRounds}:{})},
            ...(costPolicy.spellOverrides?{concentration:false}:{})};
        } catch(error) {return rejected(world,'InvalidDecision',error instanceof Error?error.message:'Invalid action cost policy');}
        const requestedBladeFocus = command.spell?.focusObjectId !== undefined
          || command.spell?.focusHand !== undefined;
        if (requestedBladeFocus) {
          if (!command.spell?.focusObjectId || !command.spell.focusHand) {
            return rejected(
              world,
              'InvalidSpellDeclaration',
              'A Pact Blade focus requires both its object identity and held hand',
            );
          }
          if (pactTomeFocusObjectId) {
            return rejected(
              world,
              'InvalidSpellDeclaration',
              'A Pact Tome sourced cast retains its Book of Shadows focus authority',
            );
          }
          const focus = planPactBladeMaterialFocus({
            world,
            catalog,
            actorId: actor.id,
            commandId: command.commandId,
            actionId: executableAction.id,
            weaponObjectId: command.spell.focusObjectId,
            hand: command.spell.focusHand,
          });
          if (focus.status === 'rejected') {
            return rejected(world, pactBladeRejectionCode(focus.code), focus.message);
          }
          spellAudit = {
            ...(spellAudit ?? {}),
            focusObjectId: focus.event.weaponObjectId,
            focusHand: focus.event.focusHand,
          };
          pactBladeFocusEvents.push({
            sourceActorId: actor.id,
            obligationIds: [
              'system:spell-components',
              'system:pact-blade-material-focus',
              `entity:${focus.event.sourceEntityId}`,
              `entity:${focus.event.actionId}`,
            ],
            payload: focus.event,
          });
        }
        if (worldActionPrimitive(executableAction) === 'temporary_hp_melee_retaliation') {
          executableAction = {
            ...executableAction,
            mechanics: { ...executableAction.mechanics, effects: [] },
          };
        }
        const activationCastTime = parseActivationCastTime(executableAction.mechanics);
        if (activationCastTime.status === 'invalid') {
          return rejected(
            world,
            'InvalidActionDefinition',
            `${executableAction.id}: ${activationCastTime.issue}`,
          );
        }
        const executablePrimitive = executableAction.mechanics.primitive as Record<string, unknown> | undefined;
        if (executablePrimitive?.type === FIND_FAMILIAR_PRIMITIVE) {
          const familiarPolicy = parseFindFamiliarMechanicsPolicy(executableAction.mechanics);
          if (familiarPolicy.status === 'invalid') {
            return rejected(
              world,
              'InvalidActionDefinition',
              `${executableAction.id}: ${familiarPolicy.issue}`,
            );
          }
          if (preparedSpell?.provenance.mode === 'ritual') {
            spellAudit = {
              ...(spellAudit ?? {}),
              castingTimeAddedSeconds: familiarPolicy.policy.ritualCastingAddedSeconds,
            };
          }
        }
        if (activationCastTime.status === 'valid') {
          if (world.scene.mode === 'encounter'
            && !activationCastTime.policy.atomicInEncounter
            && executablePrimitive?.type !== FIND_FAMILIAR_PRIMITIVE) {
            return rejected(
              world,
              'InvalidActionTiming',
              `${executableAction.id} requires ${activationCastTime.policy.seconds} seconds and cannot complete atomically in an encounter`,
            );
          }
          if (executableAction.kind === 'spell') {
            spellAudit = {
              ...(spellAudit ?? {}),
              baseCastingTimeSeconds: activationCastTime.policy.seconds,
            };
          }
        }
        const payable = canPay(actor.runtime, activationCost(executableAction));
        if (!payable.ok) {
          return rejected(
            world,
            'InsufficientResources',
            `Missing resources: ${payable.missing.join(', ')}`,
          );
        }
        const primitive = executableAction.mechanics.primitive as Record<string, unknown> | undefined;
        const missileSpec = magicMissileSpec(executableAction);
        if (primitive?.type === 'magic_missile' && !missileSpec) {
          return rejected(world, 'InvalidActionDefinition', `${executableAction.id} has invalid Magic Missile primitive metadata`);
        }
        const validation = actionValidation(
          world,
          executableAction,
          command.targetIds,
          command.factsByTarget,
          actor.id,
          command.spell?.castLevel,
        );
        if (validation) return validation;
        if (actionDeclaresHarmfulInteraction(executableAction)) {
          const conditionDenial = harmfulConditionRejection({
            world,
            attackerActorId: actor.id,
            targetActorIds: command.targetIds,
          });
          if (conditionDenial) return conditionDenial;
        }
        try {
          const recovery=activeSlotRecoveryChoice(executableAction.mechanics,actor.runtime,actor.character);
          if(recovery){
            if(command.type!=='UseAction')return rejected(world,'InvalidActionTiming','Slot recovery requires an ordinary action');
            if(!recovery.available)return rejected(world,'InsufficientResources','No recoverable slots or recovery budget');
            if(command.selectedSlotRecovery===undefined)return [{sourceActorId:actor.id,obligationIds:['system:active-slot-recovery'],payload:{type:'ResolutionOpened',resolution:{
              id:env.nextId(),type:'slot_recovery',actorId:actor.id,openedByCommandId:command.commandId,openedAtRevision:world.revision,deadlineLogicalClock:world.logicalClock+10,
              continuation:JSON.parse(JSON.stringify(command)),request:{id:env.nextId(),type:'slot_recovery',actorId:actor.id,budget:recovery.budget,recoverableByLevel:recovery.recoverableByLevel},
            }}}];
            applyActiveSlotRecovery(executableAction.mechanics,actor.runtime,actor.character,command.selectedSlotRecovery);
          }else if(command.selectedSlotRecovery!==undefined)return rejected(world,'InvalidDecision','This action cannot restore selected slots');
        }catch(error){return rejected(world,'InvalidDecision',error instanceof Error?error.message:'Invalid slot recovery');}
        const unarmedOpportunityOption = executableAction.mechanics.unarmed_opportunity_option;
        if (unarmedOpportunityOption !== undefined) {
          if (command.type !== 'UseReactionAction'
            || (unarmedOpportunityOption !== 'grapple' && unarmedOpportunityOption !== 'shove')) {
            return rejected(
              world,
              'InvalidActionDefinition',
              `${executableAction.id} has an invalid opportunity Unarmed Strike declaration`,
            );
          }
          return executeReactionUnarmedControl(
            world,
            command,
            executableAction,
            unarmedOpportunityOption,
            env,
          );
        }
        const spell = canonicalSpellContext(
          executableAction,
          command.spell,
          preparedSpell,
          spellAudit,
        );
        const authoritativeCommand: AuthoritativeUseActionCommand = { ...command, type: 'UseAction', spell,
          triggeringAttack: command.type === 'UseTriggeredAction' ? command.triggeringAttack : undefined };
        const executablePrimitiveType = (
          executableAction.mechanics.primitive as Record<string, unknown> | undefined
        )?.type;
        if (executablePrimitiveType === FIND_FAMILIAR_PRIMITIVE
          || executablePrimitiveType === WILD_COMPANION_PRIMITIVE) {
          const declaration = actionDeclaredEvent({
            actorId: actor.id,
            action: executableAction,
            targetIds: authoritativeCommand.targetIds,
            timing: command.type === 'UseReactionAction' ? 'reaction' : 'active',
            spell,
            facts: {
              choices: JSON.parse(JSON.stringify(authoritativeCommand.choices ?? {})) as Record<string, unknown>,
            },
            obligationIds: actionObligationIds(executableAction, 'system:action-declaration'),
          });
          const familiar = executablePrimitiveType === WILD_COMPANION_PRIMITIVE
            ? executeWildCompanionCast({ world, command: authoritativeCommand, action: executableAction, env })
            : executeFindFamiliarCast({ world, command: authoritativeCommand, action: executableAction, env });
          return Array.isArray(familiar)
            ? [...pactBladeFocusEvents, declaration, ...familiar]
            : familiar;
        }
        const missileAllocation = missileSpec ? magicMissileAllocation(authoritativeCommand, missileSpec) : null;
        if (missileAllocation && 'issue' in missileAllocation) {
          return rejected(world, 'InvalidTargets', missileAllocation.issue);
        }
        if(worldActionPrimitive(executableAction)==='item_tool'){
          try{executableAction=bindItemTool(world,executableAction,authoritativeCommand.worldInput,actor.id);}
          catch(error){return rejected(world,'InvalidFacts',error instanceof Error?error.message:String(error));}
        }
        const worldExecution = executeWorldActionPrimitive(
          world,
          authoritativeCommand,
          executableAction,
          env,
        );
        if (!Array.isArray(worldExecution)) return worldExecution;
        const declaration = actionDeclaredEvent({
          actorId: actor.id,
          action: executableAction,
          targetIds: authoritativeCommand.targetIds,
          timing: command.type === 'UseReactionAction' ? 'reaction' : 'active',
          spell,
          ...(authoritativeCommand.targetIds.length || authoritativeCommand.worldInput ? {
            facts: {
              ...(authoritativeCommand.targetIds.length ? {
                spatialByTarget: Object.fromEntries(authoritativeCommand.targetIds.map((targetId) => [
                  targetId,
                  authoritativeCommand.factsByTarget?.[targetId],
                ])),
              } : {}),
              ...(authoritativeCommand.worldInput ? {
                worldInput: JSON.parse(JSON.stringify(authoritativeCommand.worldInput)) as Record<string, unknown>,
              } : {}),
              ...(missileAllocation && !('issue' in missileAllocation) ? {
                magicMissileDartTargetIds: missileAllocation.dartTargetIds,
                simultaneous: missileSpec?.simultaneous,
              } : {}),
            },
          } : {}),
          obligationIds: actionObligationIds(executableAction, 'system:action-declaration'),
        });
        if (missileSpec) {
          const missile = magicMissileEvents(
            world,
            authoritativeCommand,
            executableAction,
            missileSpec,
            catalog,
            env,
          );
          return Array.isArray(missile)
            ? [...pactBladeFocusEvents, declaration, ...missile, ...worldExecution]
            : missile;
        }
        if (authoritativeCommand.targetIds.length > 1 && hasAttackRoll(executableAction)) {
          const volley: PendingAttackVolley = {
            id: authoritativeCommand.commandId,
            actorId: authoritativeCommand.actorId,
            action: executableAction,
            targetIds: [...authoritativeCommand.targetIds],
            factsByTarget: JSON.parse(JSON.stringify(authoritativeCommand.factsByTarget ?? {})),
            nextSlotIndex: 0,
            ...(authoritativeCommand.choices
              ? {choices: JSON.parse(JSON.stringify(authoritativeCommand.choices))} : {}),
            ...(authoritativeCommand.spell ? {spell: {...authoritativeCommand.spell}} : {}),
            ...(authoritativeCommand.protectionCandidatesByTarget
              ? {protectionCandidatesByTarget: JSON.parse(JSON.stringify(authoritativeCommand.protectionCandidatesByTarget))} : {}),
          };
          const first = attackVolleyStep(world, volley, catalog, env);
          return Array.isArray(first)
            ? [...pactBladeFocusEvents, declaration, ...first, ...worldExecution]
            : first;
        }
        if(executableAction.mechanics.active_slot_recovery!==undefined){
          try{
            const recovered=applyActiveSlotRecovery(executableAction.mechanics,actor.runtime,actor.character,command.selectedSlotRecovery??[]);
            const obligations=actionObligationIds(executableAction,'system:active-slot-recovery');
            const changed:EventInput[]=[...runtimeTransition(actor.id,actor.id,actor.runtime,recovered.state,'action',obligations),
              ...engineTrace(actor.id,[],recovered.events,obligations)];
            const ready=foldEvents(world,changed.map((event,ordinal)=>({...event,ordinal})));
            const executed=executeUseAction(ready,authoritativeCommand,executableAction,catalog,env);
            return [declaration,...changed,...executed];
          }catch(error){return rejected(world,'InvalidDecision',error instanceof Error?error.message:'Invalid slot recovery');}
        }
        const pending = pendingSaveEvents(world, authoritativeCommand, executableAction, env);
        if (pending) return Array.isArray(pending)
          ? [...pactBladeFocusEvents, declaration, ...pending, ...worldExecution]
          : pending;
        const pendingAttack = pendingAttackEvents(
          world,
          authoritativeCommand,
          executableAction,
          catalog,
          env,
          worldActionPrimitive(executableAction)
            ? { externalPrimitiveHandled: true }
            : {},
        );
        if (pendingAttack) return Array.isArray(pendingAttack)
          ? [...pactBladeFocusEvents, declaration, ...pendingAttack, ...worldExecution]
          : pendingAttack;
          if(resurrectionPolicy){
            const executed=executeUseAction(world,authoritativeCommand,executableAction,catalog,env);
            const committed=foldEvents(world,executed.map((event,ordinal)=>({...event,ordinal})));
            const recipient=committed.actors[command.targetIds[0]];
            const restored={...recipient.runtime,hp:{...recipient.runtime.hp,current:recipient.runtime.hp.max},deathSaves:emptyDeathSaves()};
            const obligations=actionObligationIds(executableAction,'system:resurrection');
            return [...pactBladeFocusEvents,declaration,...executed,
              ...runtimeTransition(actor.id,recipient.id,recipient.runtime,restored,'action',obligations),
              {sourceActorId:actor.id,obligationIds:obligations,payload:{type:'ActorRevived',actorId:recipient.id,
                sourceEntityId:executableAction.sourceEntityIds[0]??executableAction.id,provenance:'canonical_actor_lifecycle'}},...worldExecution];
          }
          return [
          ...pactBladeFocusEvents,
          declaration,
          ...executeUseAction(world, authoritativeCommand, executableAction, catalog, env, {
            skipReplacedConcentrationWorldObjectCleanup:
              primitive?.type === 'dancing_lights_world',
            ...(worldActionPrimitive(executableAction)
              ? { externalPrimitiveHandled: true as const }
              : {}),
          }),
          ...worldExecution,
        ];
}

function executeArmBoonPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ArmBoon'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];

      try {
        const after = armBoonForNextRoll(
          actor.runtime, command.effectId, command.rollKind, command.timing,
        );
        return runtimeTransition(
          actor.id,
          actor.id,
          actor.runtime,
          after,
          'boon',
          ['system:data-driven-boon'],
        );
      } catch (error) {
        return rejected(
          world,
          'InvalidDecision',
          error instanceof Error ? error.message : 'Invalid boon activation',
        );
      }
}

function executeAbilityCheckPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'AbilityCheck'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return executeCheck(world, command, catalog, env);
}

function executeAttemptHidePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'AttemptHide'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return executeHide(world, command, catalog, env);
}

function executeMakeNoisePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'MakeNoise'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return recordNoise(world, command);
}

function executeFindHiddenActorPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'FindHiddenActor'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return recordEnemyFinding(world, command);
}

function executeSwapInitiativePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'SwapInitiative'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return swapAlertInitiative(world, command);
}

function executeTriggerHazardPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'TriggerHazard'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return triggerHazard(world, command, catalog, env);
}

function executeSavingThrowPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'SavingThrow'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return executeSave(world, command, env);
}

function executeStudyWorldObjectPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'StudyWorldObject'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return studyWorldObject(world, command, catalog, env);
}

function executePhysicallyInteractWorldObjectPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'PhysicallyInteractWorldObject'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return physicallyInteractWorldObject(world, command);
}

function executeRevealMagicAuraPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'RevealMagicAura'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return revealMagicAura(world, command, catalog, env);
}

function executeMoveDancingLightsPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'MoveDancingLights'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return moveActiveDancingLights(world, command, catalog, env);
}

function executeObservePoisonDiseasePhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ObservePoisonDisease'}>,
  catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return observeActivePoisonDisease(world, command, catalog);
}

function executeDonArmorPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'DonArmor'}>,
  _catalog: RulesCatalog,
  _env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return donArmor(world, command);
}

function executeUseFamiliarSharedSensesPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'UseFamiliarSharedSenses'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return activateOwnedFamiliarSharedSenses(world, command, catalog, env);
}

function executeDismissFamiliarPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'DismissFamiliar'}>,
  _catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return dismissOwnedFamiliar(world, command, env);
}

function executeReappearFamiliarPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ReappearFamiliar'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return reappearOwnedFamiliar(world, command, catalog, env);
}

function executeDeliverTouchSpellThroughFamiliarPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'DeliverTouchSpellThroughFamiliar'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return deliverTouchSpell(world, command, catalog, env);
}

const decisionExecutors: DecisionExecutors = {
  event_reaction: resolveEventReaction,
  slot_recovery: resolveActiveSlotRecovery,
  action_cost_policy: resolveActionCostPolicy,
  check_boost: resolveFailedCheckBoost,
  protection_reaction: resolvePendingProtection,
  attack_reaction: resolvePendingAttack,
  damage_reaction: resolvePendingDamageReaction,
  unarmed_save: (world, command, _catalog, env) => resolveUnarmedSave(world, command, env),
  shove_outcome: (world, command, _catalog, env) => resolveShoveOutcome(world, command, env),
  escape_grapple: resolveEscapeGrapple,
  magic_missile_reaction: resolveMagicMissileReaction,
  mastery_save: (world, command, _catalog, env) => resolveMasterySave(world, command, env),
  concentration_save: (world, command, catalog, env) => resolveConcentrationSave(world, command, env, catalog),
  hazard_save: (world, command, _catalog, env) => resolveHazardSave(world, command, env),
  target_save: resolvePendingSave,
};

function executeResolveDecisionPhase(
  world: WorldState,
  command: Extract<GameCommand, {type: 'ResolveDecision'}>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  return dispatchDecision(world, command, catalog, env, decisionExecutors);
}

const commandExecutors: CommandExecutors = {
  ChangeEquipment: executeChangeEquipmentPhase,
  StartEncounter: executeStartEncounterPhase,
  DeathSavingThrow: executeDeathSavingThrowPhase,
  StartTurn: executeStartTurnPhase,
  EndTurn: executeEndTurnPhase,
  TakeShortRest: executeTakeShortRestPhase,
  TakeLongRest: executeTakeLongRestPhase,
  UseAttackReplacement: executeUseAttackReplacementPhase,
  BeginAttackAction: executeBeginAttackActionPhase,
  PerformWeaponAttack: executePerformWeaponAttackPhase,
  PerformLightWeaponExtraAttack: executePerformLightWeaponExtraAttackPhase,
  PerformWeaponMasteryCleaveAttack: executePerformWeaponMasteryCleaveAttackPhase,
  PerformUnarmedStrike: executePerformUnarmedStrikePhase,
  PerformPactChainFamiliarAttack: executePerformPactChainFamiliarAttackPhase,
  BondPactBlade: executeBondPactBladePhase,
  ObservePactBladeDistance: executeObservePactBladeDistancePhase,
  AdjudicateActorDeath: executeAdjudicateActorDeathPhase,
  ForfeitAttackAction: executeForfeitAttackActionPhase,
  EscapeGrapple: executeEscapeGrapplePhase,
  ReleaseGrapple: executeReleaseGrapplePhase,
  BreakGrappleRange: executeBreakGrappleRangePhase,
  ObserveProtectionProximity: executeObserveProtectionProximityPhase,
  UseReactionAction: executeUseActionPhase,
  UseTriggeredAction: executeUseActionPhase,
  UseAction: executeUseActionPhase,
  ArmBoon: executeArmBoonPhase,
  AbilityCheck: executeAbilityCheckPhase,
  AttemptHide: executeAttemptHidePhase,
  MakeNoise: executeMakeNoisePhase,
  FindHiddenActor: executeFindHiddenActorPhase,
  SwapInitiative: executeSwapInitiativePhase,
  TriggerHazard: executeTriggerHazardPhase,
  SavingThrow: executeSavingThrowPhase,
  StudyWorldObject: executeStudyWorldObjectPhase,
  PhysicallyInteractWorldObject: executePhysicallyInteractWorldObjectPhase,
  RevealMagicAura: executeRevealMagicAuraPhase,
  MoveDancingLights: executeMoveDancingLightsPhase,
  ObservePoisonDisease: executeObservePoisonDiseasePhase,
  DonArmor: executeDonArmorPhase,
  UseFamiliarSharedSenses: executeUseFamiliarSharedSensesPhase,
  DismissFamiliar: executeDismissFamiliarPhase,
  ReappearFamiliar: executeReappearFamiliarPhase,
  DeliverTouchSpellThroughFamiliar: executeDeliverTouchSpellThroughFamiliarPhase,
  ResolveDecision: executeResolveDecisionPhase,
};

function executeCommand(world: WorldState, command: GameCommand, catalog: RulesCatalog, env: DeterministicEnvironment): CommandResult | EventInput[] {
  return dispatchCommand(world, command, catalog, env, commandExecutors, rejected);
}

function bindEventReaction(actor:ActorState,action:RuleActionDefinition):RuleActionDefinition|null{
  if(!weaponAttackKind(action.mechanics))return action;
  const cards=new Map([...(actor.character.knownCards??[]),...(actor.character.equippedCards??[])].map(card=>[card.id,card]));
  if(!weaponActionAvailability(action.mechanics,actor.runtime.equipment,cards,actor.passives??[]).available)return null;
  try{
    const mechanics=bindEquippedWeaponActionContext(action.mechanics,actor.runtime.equipment,cards);
    return {...action,mechanics,targeting:mechanics.targeting?compileDeclaredMechanicsTargeting(mechanics):action.targeting};
  }catch{return null;}
}
function eventReactionOptions(world:WorldState,opportunity:import('./domain').QueuedEventReaction,catalog:RulesCatalog):ReactionActionOption[]{
  const actor=effectReactionActor(world.actors[opportunity.actorId],opportunity);
  if(!actor||actor.lifecycle?.status==='dead')return [];
  return opportunity.actionIds.flatMap(id=>{
    if(!actor.capabilities.actionIds.includes(id))return [];
    const raw=catalog.getAction(id),action=raw?bindEventReaction(actor,raw):null;
    if(!action||triggerOwner(action)!=='world'||!hasReactionTrigger(action,opportunity.event.kind)||actionDefinitionIssue(action))return [];
    if(deniedCapabilities(actor.runtime,actor.passives??[]).has(requiredActionCapability(action)))return [];
    const activation=action.mechanics.activation as Record<string,unknown>;
    const trigger=activation.trigger as Record<string,unknown>;
    if(trigger.observer_range_ft!==undefined){
      const affected=opportunity.event.data?.targetActorId;
      if(trigger.exclude_self_target===true&&affected===actor.id)return [];
      const observation=actor.character.spatialObservations?.nearby.find(row=>row.actorId===opportunity.targetActorId);
      if(!observation||observation.distanceFt>Number(trigger.observer_range_ft)
        ||Array.isArray(trigger.observer_relations)&&!trigger.observer_relations.includes(observation.relation))return [];
    }
    if(trigger.timing!==undefined&&opportunity.event.timing!==undefined&&trigger.timing!==opportunity.event.timing)return [];
    if(opportunity.event.kind==='damage_taken'&&trigger.timing!=='after')return [];
    if(!matchesWhen(trigger.circumstances as Record<string,unknown>[]|undefined,{
      character:liveCharacter(actor),state:actor.runtime,activeConditions:activeConditionsOf(actor.runtime),event:opportunity.event}))return [];
    const targetId=action.targeting?.allowedRelations.every(relation=>relation==='self')?actor.id:opportunity.targetActorId;
    const targetFacts=targetId===actor.id?{factsSource:'scenario' as const,boardRevision:0,distanceFt:0,relation:'self' as const,cover:'none' as const,lineOfSight:true}:opportunity.facts;
    if(targetId&&actionValidation(world,action,[targetId],targetFacts?{[targetId]:targetFacts}:undefined,actor.id))return [];
    return sourceScopedReactionOptions(actor,action);
  });
}

function resolveEventReaction(world:WorldState,command:Extract<GameCommand,{type:'ResolveDecision'}>,catalog:RulesCatalog,env:DeterministicEnvironment):CommandResult|EventInput[]{
  const pending=world.pendingResolution;
  if(pending?.type!=='event_reaction')return rejected(world,'NoPendingResolution','No event reaction');
  if(command.resolutionId!==pending.id||command.requestId!==pending.request.id)return rejected(world,'StaleDecision','Event reaction has changed');
  if(command.actorId!==pending.request.actorId||command.response.kind!=='reaction')return rejected(world,'InvalidDecision','Only the requested actor can resolve this reaction');
  const obligations=['system:event-reaction'];
  const events:EventInput[]=[{sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:command.actorId,response:command.response}},
    {sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}}];
  const selected=command.response.actionId;
  if(selected===null){
    if(command.response.spell)return rejected(world,'InvalidDecision','A declined reaction cannot select a spell');
    return events;
  }
  if(!pending.request.options.some(option=>option.actionId===selected)||!eventReactionOptions(world,pending.opportunity,catalog).some(option=>option.actionId===selected))return rejected(world,'InvalidDecision','Reaction is no longer available');
  const actor=world.actors[command.actorId];
  const bound=bindEventReaction(actor,catalog.getAction(selected)!);
  if(!bound)return rejected(world,'InvalidEquipmentState','Reaction weapon is no longer available');
  const prepared=prepareReactionExecution(actor,bound,command.response.spell);
  if(prepared.status==='rejected')return rejected(world,prepared.code,prepared.message);
  const effectAction=bindReceivedEffectAction(prepared.action,pending.opportunity);
  if(effectAction){
    const result=executeAction(actor.runtime,effectAction.mechanics,{...actionContext(actor,env),actionName:effectAction.name});
    return [...events,actionDeclaredEvent({actorId:actor.id,action:effectAction,targetIds:[actor.id],timing:'reaction',obligationIds:obligations}),
      ...engineTrace(actor.id,[actor.id],result.events,actionObligationIds(effectAction)),...runtimeTransition(actor.id,actor.id,actor.runtime,result.state,'action',actionObligationIds(effectAction))];
  }
  const action=prepared.action;
  const targetId=action.targeting?.allowedRelations.every(relation=>relation==='self')?actor.id:pending.opportunity.targetActorId;
  const ready={...world,pendingResolution:null};
    const teleportPolicy=action.mechanics.teleport_destination as Record<string,unknown>|undefined;
    const destinationFacts=command.response.teleportDestinationFacts;
    if(teleportPolicy?.relative_to==='target'&&(!command.response.teleportDestination||!destinationFacts))
      return rejected(world,'InvalidDecision','Выберите место телепортации цели');
    const actionCommand:AuthoritativeUseActionCommand={...command,type:'UseAction',actionId:selected,targetIds:targetId?[targetId]:[],
      ...(targetId&&(destinationFacts??pending.opportunity.facts)?{factsByTarget:{[targetId]:destinationFacts??pending.opportunity.facts!}}:{}),...(prepared.spell?{spell:prepared.spell}:{})};
    const destinationIssue=teleportDestinationIssue(action,targetId?actionCommand.factsByTarget?.[targetId]:undefined);
    if(destinationIssue)return rejected(world,'InvalidFacts',destinationIssue);
  events.push(actionDeclaredEvent({actorId:actor.id,action,targetIds:actionCommand.targetIds,timing:'reaction',spell:prepared.spell,obligationIds:obligations}));
  const held=pendingAttackEvents(ready,actionCommand,action,catalog,env);
  if(held&&!Array.isArray(held))return held;
  return [...events,...(held??executeUseAction(ready,actionCommand,action,catalog,env))];
}

function executeAutomaticEventReaction(world: WorldState, opportunity: import('./domain').QueuedEventReaction, automatic: ReactionActionOption, command: GameCommand, catalog: RulesCatalog, env: DeterministicEnvironment): EventInput[] | null {
    const actor = world.actors[opportunity.actorId], bound = bindEventReaction(actor, catalog.getAction(automatic.actionId)!);
    if (!bound)
        return null;
    const actionCommand: AuthoritativeUseActionCommand = { schemaVersion: 1, commandId: command.commandId, expectedRevision: command.expectedRevision, rulesetContentHash: command.rulesetContentHash,
        type: 'UseAction', actorId: actor.id, actionId: bound.id, targetIds: opportunity.targetActorId ? [opportunity.targetActorId] : [],
        ...(opportunity.targetActorId && opportunity.facts ? { factsByTarget: { [opportunity.targetActorId]: opportunity.facts } } : {}) };
    const held = pendingAttackEvents(world, actionCommand, bound, catalog, env);
    if (held && !Array.isArray(held))
        throw Error(`Automatic event action failed: ${held.status === 'rejected' ? held.message : held.status}`);
    const changes = [actionDeclaredEvent({ actorId: actor.id, action: bound, targetIds: actionCommand.targetIds, timing: 'reaction', obligationIds: ['system:event-action'] }),
        ...(held ?? executeUseAction(world, actionCommand, bound, catalog, env))];
    return changes;
}

function resolveAreaConsequences(world:WorldState,incoming:EventInput[],command:GameCommand,catalog:RulesCatalog,env:DeterministicEnvironment):{world:WorldState;events:EventInput[]}{
  let provisional=world;
  const execution:EventInput[]=[];
  const areaQueue=[...(world.areaConsequences??[])];
  const appendAreas=(events:EventInput[])=>{
    for(const row of events){
      if(row.payload.type!=='EngineEventRecorded'||!['area_damage','area_healing','area_effect'].includes(row.payload.event.type))continue;
      const effect=row.payload.event as Extract<EngineEvent,{type:'area_damage'|'area_healing'|'area_effect'}>;
      const source=provisional.actors[effect.sourceActorId];
      for(const targetId of effect.targetIds){
        const observation=source?.character.spatialObservations?.nearby.find(entry=>entry.actorId===targetId);
        const declaration=command as unknown as {factsByTarget?:Record<string,SpatialFacts>;facts?:SpatialFacts;targetActorId?:string};
        const observedFacts=declaration.factsByTarget?.[targetId]??(declaration.targetActorId===targetId?declaration.facts:undefined);
        const facts:SpatialFacts|undefined=observedFacts??(targetId===source?.id?{factsSource:'scenario',boardRevision:source.character.spatialObservations?.boardRevision??0,distanceFt:0,relation:'self',cover:'none',lineOfSight:true}:
          observation?{factsSource:'board',boardRevision:source.character.spatialObservations!.boardRevision,distanceFt:observation.distanceFt,relation:observation.relation,cover:'none',lineOfSight:false,targetCanSeeSource:false}:undefined);
        areaQueue.push({id:env.nextId(),effect,targetActorId:targetId,...(facts?{facts}:{})});
      }
    }
  };
  appendAreas(incoming);
  for(let index=0;areaQueue.length&&!provisional.pendingResolution;index++){
    if(index>=256)throw Error('Area consequences exceeded the cascade budget');
    const queued=areaQueue.shift()!,effect=queued.effect;
    const source=provisional.actors[effect.sourceActorId],target=provisional.actors[queued.targetActorId];
    if(!source||!target||target.lifecycle?.status==='dead'||target.runtime.deathSaves?.dead)continue;
    if(effect.magicOrigin&&!['artifact','deity'].includes(effect.magicOrigin.kind)
      &&(source.character.magicSuppressed||target.character.magicSuppressed))continue;
    const payload=effect.type==='area_effect'?null:effect.type==='area_healing'?{kind:'healing',amount:effect.amount}
      :{kind:'damage',amount:effect.amount,type:effect.damageType,suppress_damage_modifiers:true};
    const action:RuleActionDefinition={id:`system:area:${queued.id}`,name:effect.source??'Эффект по области',kind:'nonSpell',sourceEntityIds:['system:area-consequences'],
      mechanics:{activation:{mode:'active',cost:[]},...(effect.magicOrigin?{magical:true,captured_magic_origin:effect.magicOrigin}:{}),...(effect.type==='area_damage'?{damage_source_kind:effect.damageSourceKind,...effect.transferred?{damage_transfer_origin:true}:{}}:{}),effects:[{resolution:'auto',who:'target',result:effect.type==='area_effect'?effect.effects:[payload]}]}};
    const areaCommand:AuthoritativeUseActionCommand={schemaVersion:1,commandId:command.commandId,expectedRevision:command.expectedRevision,rulesetContentHash:command.rulesetContentHash,type:'UseAction',actorId:source.id,actionId:action.id,targetIds:[target.id],
      ...(queued.facts?{factsByTarget:{[target.id]:queued.facts}}:{})};
    const changes=executeUseAction(provisional,areaCommand,action,catalog,env,{triggeredConsequences:true});
    execution.push(...changes);
    provisional=foldEvents(provisional,changes.map((event,ordinal)=>({...event,ordinal})));
    appendAreas(changes);
  }
  if(JSON.stringify(areaQueue)!==JSON.stringify(world.areaConsequences??[])){
    const queueEvent:EventInput={sourceActorId:command.actorId,obligationIds:['system:area-consequences'],payload:{type:'AreaConsequenceQueueChanged',queue:areaQueue}};
    execution.push(queueEvent);
    provisional=foldEvents(provisional,[{...queueEvent,ordinal:0}]);
  }
  return {world:provisional,events:execution};
}

/** These facts describe committed interaction outcomes, never a UI label. */
function physicalInteractionConsequences(world:WorldState,events:EventInput[],env:DeterministicEnvironment):EventInput[]{
  let current=foldEvents(world,events.map((event,ordinal)=>({...event,ordinal})));
  const changes:EventInput[]=[];
  for(const envelope of events){
    const p=envelope.payload;
    if(p.type!=='GrappleApplied'&&p.type!=='ShoveApplied')continue;
    const kind=p.type==='GrappleApplied'?'grapple':'shove';
    const sourceId=p.type==='GrappleApplied'?p.grapple.grapplerActorId:p.sourceActorId;
    const targetId=p.type==='GrappleApplied'?p.grapple.targetActorId:p.targetActorId;
    const source=current.actors[sourceId],target=current.actors[targetId];
    if(!source||!target)continue;
    const trace:EngineEvent[]=[];
    const recipient={state:target.runtime,mutated:false};
    const ctx=actionContext(source,env,target,target.runtime);
    const state=emitEngineEvent({kind:'physical_interaction',source:'self',target:targetId,data:{kind,targetActorId:targetId,sourceActorId:sourceId}},source.runtime,ctx,trace,[],recipient,[],true);
    const obligations=['system:physical-interaction'];
    const next=[...engineTrace(sourceId,[targetId],trace,obligations),
      ...runtimeTransition(sourceId,sourceId,source.runtime,state,'action',obligations),
      ...runtimeTransition(sourceId,targetId,target.runtime,recipient.state,'action',obligations)];
    changes.push(...next);current=foldEvents(current,next.map((event,ordinal)=>({...event,ordinal})));
  }
  return changes;
}

function bondLifecycleEvents(world:WorldState,env:DeterministicEnvironment,before?:WorldState):EventInput[]{
 const changes:EventInput[]=[],obligations=['system:bond-lifecycle'];
 for(const [id,removed] of endedBondEffects(world,before)){
  const actor=world.actors[id];
  const raw={...actor.runtime,activeEffects:actor.runtime.activeEffects.filter(effect=>!removed.has(effect.id))};
  const ended=reconcileEndedEffects(actor.runtime,raw,actionContext(actor,env),executeAction);
  const trace:EngineEvent[]=[...actor.runtime.activeEffects.filter(effect=>removed.has(effect.id)).map(effect=>({type:'effect_expired' as const,name:effect.name})),...ended.events];
  changes.push(...runtimeTransition(id,id,actor.runtime,ended.state,'action',obligations),...engineTrace(id,[id],trace,obligations));
 }
 return changes;
}

export function handleCommand(
  world: WorldState,
  command: GameCommand,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult {
  const common = validateCommon(world, command);
  if (common) return common;
  const lock = validateResolutionLock(world, command);
  if (lock) return lock;
  const turn = validateTurn(world, command);
  if (turn) return turn;

  // Persisted IDs are derived from the idempotency key, never from hidden
  // in-memory generator state. A reload can therefore resume byte-identically.
  let generatedIdOrdinal = 0;
  const commandEnv: DeterministicEnvironment = {
    ...env,
    nextId: () => `${command.commandId}:id:${++generatedIdOrdinal}`,
  };
  const magicBefore=magicProjectionEvents(world);
  const magicWorld=magicBefore.length?foldEvents(world,magicBefore.map((event,ordinal)=>({...event,ordinal}))):world;
  const expiredBonds=bondLifecycleEvents(magicWorld,commandEnv);
  const preparedWorld=expiredBonds.length?foldEvents(magicWorld,expiredBonds.map((event,ordinal)=>({...event,ordinal}))):magicWorld;
  const execution = executeCommand(preparedWorld, command, catalog, commandEnv);
  if (!Array.isArray(execution)) return execution;
  execution.unshift(...magicBefore,...expiredBonds);
  execution.push(...itemMaterialFocusEvents(preparedWorld,execution,catalog));
  execution.push(...physicalInteractionConsequences(world,execution,commandEnv));
  execution.push(...recipientBindingEvents(world,foldEvents(world,execution.map((event,ordinal)=>({...event,ordinal}))),execution,catalog,commandEnv));
  execution.push(...itemToolMutationEvents(world,execution));
  const toolWorkSeconds=itemToolWorkSeconds(execution);
  if(toolWorkSeconds){
    const beforeWork=foldEvents(world,execution.map((event,ordinal)=>({...event,ordinal}))),obligations=['system:item-tool-work-time'];
    for(const actor of Object.values(beforeWork.actors).sort((a,b)=>a.id.localeCompare(b.id))){
      const elapsed=advanceEffectTime(actor.runtime,toolWorkSeconds,actionContext(actor,commandEnv));
      execution.push(...runtimeTransition(command.actorId,actor.id,actor.runtime,elapsed.state,'action',obligations),...engineTrace(actor.id,[],elapsed.events,obligations));
    }
    execution.push(...advanceWorldObjectRounds({objects:beforeWork.objects,rounds:Math.floor(toolWorkSeconds/6)}).events.map(event=>({sourceActorId:command.actorId,obligationIds:obligations,payload:{type:'WorldObjectMutationRecorded' as const,event}})));
  }
  if (command.type === 'UseAction' && (catalog.getAction(command.actionId)?.mechanics.activation as Record<string, unknown> | undefined)?.telekinetic_movement === true) {
    const facts = command.factsByTarget?.[command.actorId];
    if (facts?.telekineticObjectId && facts.telekineticHandMode) {
      const paid = foldEvents(world, execution.map((event, ordinal) => ({...event, ordinal})));
      execution.push(...telekineticHandEvents(paid, paid.actors[command.actorId], facts));
    }
  }

  if (command.type === 'UseAction' && (catalog.getAction(command.actionId)?.mechanics.activation as Record<string, unknown> | undefined)?.weapon_bond_recall === true) {
    const paid = foldEvents(world, execution.map((event, ordinal) => ({ ...event, ordinal })));
    execution.push(...weaponBondRecallEvents(paid, command.actorId, command.choices));
  }

  // Cross-cutting lifecycle rules are generic post-conditions of every
  // accepted command, so individual spells/features cannot forget them.
  const provisionalEvents = execution.map((event, ordinal) => ({ ...event, ordinal }));
  let provisional = foldEvents(world, provisionalEvents);
  const magicAfter=magicProjectionEvents(provisional);
  execution.push(...magicAfter);
  provisional=foldEvents(provisional,magicAfter.map((event,ordinal)=>({...event,ordinal})));
  const endedBonds=bondLifecycleEvents(provisional,commandEnv,world);
  execution.push(...endedBonds);
  provisional=foldEvents(provisional,endedBonds.map((event,ordinal)=>({...event,ordinal})));
  let incomingConsequences=execution.slice();
  let receivedSnapshot=world;
  for (let volleyPass = 0; volleyPass < 128; volleyPass++) {
    for(let cascade=0;cascade<128;cascade++){
      const areas=resolveAreaConsequences(provisional,incomingConsequences,command,catalog,commandEnv);
      const closedBonds=bondLifecycleEvents(areas.world,commandEnv,provisional);
      areas.events.push(...closedBonds);
      areas.world=foldEvents(areas.world,closedBonds.map((event,ordinal)=>({...event,ordinal})));
      const received=receivedEffectEvents(receivedSnapshot,areas.world);
      receivedSnapshot=areas.world;
      const reactions=queueEventReactions(areas.world,[...(cascade===0?incomingConsequences:[]),...areas.events,...received],command,catalog,commandEnv,world,{
        options:eventReactionOptions,
        executeAutomatic:(current,opportunity,option)=>executeAutomaticEventReaction(current,opportunity,option,command,catalog,commandEnv),
      });
      execution.push(...areas.events,...received,...reactions);
      provisional=foldEvents(areas.world,reactions.map((event,ordinal)=>({...event,ordinal})));
      if(!areas.events.length&&!received.length&&!reactions.length)break;
      incomingConsequences=reactions;
      if(cascade===127)return rejected(world,'InvalidActionDefinition','Consequence cascade exceeded its budget');
    }
    const volley = provisional.attackVolley;
    if (!volley || provisional.pendingResolution) break;
    const next = attackVolleyStep(provisional, volley, catalog, commandEnv);
    if (!Array.isArray(next)) return next.status === 'rejected'
      ? rejected(world, next.code, next.message)
      : rejected(world, 'InvalidDecision', 'Attack volley returned an invalid nested acceptance');
    const beforeStep = provisional;
    execution.push(...next);
    provisional = foldEvents(provisional, next.map((event,ordinal) => ({...event,ordinal})));
    const projected = magicProjectionEvents(provisional);
    execution.push(...projected);
    provisional = foldEvents(provisional, projected.map((event,ordinal) => ({...event,ordinal})));
    incomingConsequences = next;
    receivedSnapshot = beforeStep;
    if (volleyPass === 127) return rejected(world,'InvalidActionDefinition','Attack volley exceeded its slot budget');
  }
  const finalMagic=magicProjectionEvents(provisional);
  execution.push(...finalMagic);
  provisional=foldEvents(provisional,finalMagic.map((event,ordinal)=>({...event,ordinal})));
  const terminal = automaticTerminalConditionDeaths({
    world: provisional,
    command,
    catalog,
    env: commandEnv,
  });
  if ('status' in terminal) {
    if (terminal.status === 'accepted') {
      return rejected(world, 'InvalidDecision', 'Terminal condition lifecycle returned an invalid nested acceptance');
    }
    return rejected(world, terminal.code, terminal.message);
  }
  let postTerminal = terminal.world;
  const recoveryEvents:EventInput[]=[];
  for(const actor of Object.values(postTerminal.actors).sort((left,right)=>left.id.localeCompare(right.id))){
    const before=world.actors[actor.id];
    if(!before)continue;
    const recovered=recoverAfterDeath(before,actor,commandEnv);
    if(!recovered)continue;
    const obligations=['system:death-recovery',`entity:${recovered.sourceId}`];
    const changes:EventInput[]=[...runtimeTransition(actor.id,actor.id,actor.runtime,recovered.state,'long_rest',obligations),
      ...engineTrace(actor.id,[actor.id],recovered.events,obligations),
      {sourceActorId:actor.id,obligationIds:obligations,payload:{type:'ActorRevived',actorId:actor.id,
        sourceEntityId:recovered.sourceId,provenance:'canonical_actor_lifecycle'}}];
    recoveryEvents.push(...changes);
    postTerminal=foldEvents(postTerminal,changes.map((event,ordinal)=>({...event,ordinal})));
  }
  const automaticArmorOfAgathysEnds: EventInput[] = Object.values(postTerminal.actors)
    .flatMap((actor) => {
      if (actor.runtime.hp.temp > 0) return [];
      const activeArmor = actor.runtime.activeEffects.filter((effect) => (
        (effect.mechanics as Record<string, unknown>).kind === 'temporary_hp_melee_retaliation'
      ));
      if (!activeArmor.length) return [];
      const after = endArmorOfAgathysWithoutTemporaryHp(actor.runtime);
      return runtimeTransition(
        command.actorId,
        actor.id,
        actor.runtime,
        after,
        'action',
        [...new Set([
          'system:temporary-hp-melee-retaliation',
          'system:temporary-hit-points',
          'system:effect-lifecycle',
          ...activeArmor.flatMap((effect) => {
            const mechanics = effect.mechanics as Record<string, unknown>;
            return Array.isArray(mechanics.sourceEntityIds)
              ? mechanics.sourceEntityIds.map((sourceId) => `entity:${String(sourceId)}`)
              : [];
          }),
        ])],
      );
    });
  const automaticFamiliarDisappears: EventInput[] = Object.values(postTerminal.actors)
    .flatMap((actor) => {
      if (!actor.familiarState
        || actor.familiarState.presence !== 'present'
        || actor.runtime.hp.current > 0) return [];
      const disappearance = familiarDropsToZeroHp(actor.familiarState);
      if (!disappearance.familiar) return [];
      return [familiarStateChangedEvent({
        ownerActorId: actor.familiarState.ownerActorId,
        familiarActorId: actor.id,
        familiar: disappearance.familiar,
        reason: 'zero_hp',
        droppedItemIds: disappearance.droppedItemIds,
        obligations: [
          'system:find-familiar',
          'system:familiar-lifecycle',
          'system:zero-hit-points',
        ],
      })];
    });
  const automaticGrappleEnds: EventInput[] = Object.values(postTerminal.grapples)
    .filter((grapple) => {
      const grappler = postTerminal.actors[grapple.grapplerActorId];
      return grappler && (grappler.lifecycle?.status === 'dead'
        || activeConditionsOf(grappler.runtime).has('incapacitated'));
    })
    .map((grapple) => ({
      sourceActorId: grapple.grapplerActorId,
      obligationIds: ['system:grapple-lifecycle', 'system:condition:incapacitated'],
      payload: {
        type: 'GrappleEnded',
        grappleId: grapple.id,
        reason: 'grappler_incapacitated',
      },
    }));

  const eventReactions:EventInput[]=[];
  const nextRevision = world.revision + 1;
  const rawEvents: EventInput[] = [
    ...execution,
    ...terminal.events,
    ...recoveryEvents,
    ...inherentWeaponBondEvents(postTerminal),
    ...thrownWeaponEvents(world,postTerminal,execution,command.commandId),
    ...deployedItemEvents(world,postTerminal,execution,command.commandId),
    ...heldItemDropWorldEvents(world, postTerminal, execution, command.commandId),
    ...consumedHeldItemWorldEvents(postTerminal, execution),
    ...automaticArmorOfAgathysEnds,
    ...automaticFamiliarDisappears,
    ...automaticGrappleEnds,
    ...eventReactions,
    {
      sourceActorId: command.actorId,
      obligationIds: ['system:command-commit'],
      payload: {
        type: 'CommandCommitted',
        commandId: command.commandId,
        revision: nextRevision,
        logicalClock: commandEnv.clock(),
      },
    },
  ];
  const events = rawEvents.map((event, ordinal) => ({ ...event, ordinal }));
  return { status: 'accepted', events, nextState: foldEvents(world, events) };
}
