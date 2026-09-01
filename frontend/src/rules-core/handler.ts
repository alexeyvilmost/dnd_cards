import {
  activeConditionsOf,
  applyIncomingDamage,
  armorClassValue,
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
  pay,
  readTargetSave,
  resolveNextTurnCommand,
  rollD20,
  shortRest,
  startTurn,
  weaponContext,
  parseWeaponProfile,
  weaponAttackModeAtDistance,
  evaluateWeaponHeavyRule,
  actorWeaponHasMasteryPrimitive,
  weaponMasteryCleaveUseKey,
  weaponMasteryNickUseKey,
  WEAPON_MASTERY_CLEAVE_USE_PREFIX,
} from './legacy/engineAdapter';
import { applySourceTurnBoundary } from '../engine/sourceTurnExpiry';
import { compileDeclaredMechanicsTargeting } from './actionTargeting';
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
  ConcentrationEffectLink,
  DeterministicEnvironment,
  EncounterScene,
  GameCommand,
  HideEligibilityFacts,
  PendingResolutionFollowUp,
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
  resolveUnarmedDamageProfile,
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
  canonicalTouchSpell,
  findFamiliarMaterialCost,
  familiarActorsOwnedBy,
  familiarAttackRuleAction,
  materializeCanonicalFamiliarActor,
  requireOwnedFamiliar,
  rollFamiliarInitiative,
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

type EventInput = Omit<UncommittedRuleEvent, 'ordinal'>;

const ABILITY_LABEL: Record<Ability, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

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
  // Reaction actions are catalog-gated in the UseReactionAction handler below.
  if (command.type === 'UseReactionAction') return null;
  if (command.type === 'SwapInitiative') return null;
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

function factsIssue(action: RuleActionDefinition, targetId: string, facts?: SpatialFacts): [CommandRejectionCode, string] | null {
  const targeting = action.targeting;
  if (!targeting) return null;
  if (!facts) return ['MissingSpatialFacts', `Missing spatial facts for target ${targetId}`];
  if (facts.distanceFt < 0 || facts.distanceFt > targeting.rangeFt) {
    return ['OutOfRange', `${targetId} is outside ${targeting.rangeFt} ft range`];
  }
  if (targeting.requiresLineOfSight && (!facts.lineOfSight || facts.cover === 'total')) {
    return ['LineOfSightBlocked', `Line of sight to ${targetId} is blocked`];
  }
  if (!targeting.allowedRelations.includes(facts.relation)) {
    return ['IllegalRelation', `${facts.relation} is not a legal relation for ${action.id}`];
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
): CommandResult | null {
  const targeting = action.targeting;
  if (new Set(targetIds).size !== targetIds.length) {
    return rejected(world, 'InvalidTargets', 'Each target actor may appear only once in an action');
  }
  if (targeting && (targetIds.length < targeting.minTargets || targetIds.length > targeting.maxTargets)) {
    return rejected(world, 'InvalidTargets', `${action.id} requires ${targeting.minTargets}-${targeting.maxTargets} targets`);
  }
  if (sourceActorId && targeting?.allowedRelations.length === 1
    && targeting.allowedRelations[0] === 'self'
    && targetIds.some((targetId) => targetId !== sourceActorId)) {
    return rejected(world, 'InvalidTargets', `${action.id} can target only its acting actor`);
  }
  if (targetIds.length > 1) {
    if (hasAttackRoll(action)) {
      return rejected(world, 'InvalidTargets', 'Multi-target attack sequences require a dedicated attack-sequence primitive');
    }
    if (!hasTargetSave(action) && !hasIndependentTargetAutoEffects(action) && !magicMissileSpec(action)) {
      return rejected(world, 'InvalidTargets', `${action.id} cannot be executed independently for multiple targets`);
    }
  }
  for (const targetId of targetIds) {
    const target = world.actors[targetId];
    if (!target) return rejected(world, 'ActorNotFound', `Unknown target ${targetId}`);
    const issue = factsIssue(action, targetId, factsByTarget?.[targetId]);
    if (issue) return rejected(world, issue[0], issue[1]);
    const sightIssue = conditionTargetingSightIssue({
      world,
      sourceActorId,
      targetActorId: targetId,
      requiresSight: targeting?.requiresSight === true,
      canSeeTarget: factsByTarget?.[targetId]?.canSeeTarget,
    });
    if (sightIssue === 'source_cannot_see') {
      return rejected(world, 'CapabilityDenied', `${sourceActorId} cannot see a required target`);
    }
    if (sightIssue === 'target_unseen') {
      return rejected(world, 'CapabilityDenied', `${targetId} cannot be seen by ${sourceActorId}`);
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
      || !Number.isInteger(replacement.totalAttacks)
      || replacement.totalAttacks < 1
      || replacement.oncePerAttackAction !== true) {
      return `${action.id} has an invalid attack-replacement policy`;
    }
    const actionCosts = activationCost(action).filter((cost) => (
      String(cost.resource ?? '') === 'action'
    ));
    if (actionCosts.length !== 1 || Number(actionCosts[0].amount ?? 1) !== 1) {
      return `${action.id} must spend exactly one Action when used as an attack replacement`;
    }
    if (raw.kind !== 'nonSpell' || !hasTargetSave(action)) {
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

type CanonicalSpellContext = SpellCastContext & {
  castLevel: number;
  baseCastingTimeSeconds?: number;
  castingTimeAddedSeconds?: number;
  focusObjectId?: string;
  focusHand?: 'main_hand' | 'off_hand';
};
type AuthoritativeUseActionCommand = Omit<
  Extract<GameCommand, { type: 'UseAction' }>,
  'spell'
> & { spell?: CanonicalSpellContext };

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
    baseLevel: action.spell.level,
    castLevel: declaration?.castLevel ?? action.spell.level,
    ...(action.spell.sourceClass ? { sourceClass: action.spell.sourceClass } : {}),
    ...(action.spell.components ? { components: { ...action.spell.components } } : {}),
    ...(prepared ? {
      grantId: prepared.provenance.grantId,
      sourceId: prepared.provenance.sourceId,
      spellcastingAbility: prepared.provenance.spellcastingAbility,
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
  | 'temporary_hp_melee_retaliation';

function worldActionPrimitive(action: RuleActionDefinition): WorldActionPrimitive | null {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  switch (primitive?.type) {
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

function systemActionAsRuleDefinition(
  id: string,
  mechanics: Record<string, unknown>,
): RuleActionDefinition {
  const definition = getSystemActionDefinition(id);
  if (!definition) throw new Error(`Missing immutable system action ${id}`);
  return {
    id: definition.id,
    name: definition.name,
    kind: 'nonSpell',
    sourceEntityIds: [...definition.sourceEntityIds] as [string, ...string[]],
    mechanics,
  };
}

const CORE_ATTACK_ACTION = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.attack, {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
});

const CORE_WEAPON_ATTACK = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.weaponAttack, {
  activation: { mode: 'attack_entry', cost: [] },
  effects: [{
    ability: 'auto',
    attack_kind: 'weapon_melee',
    resolution: 'attack_roll',
    vs: 'ac',
    on_hit: [{ ability: 'auto', dice: 'weapon', kind: 'damage', type: 'weapon' }],
  }],
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

const CORE_UNARMED_DAMAGE = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.unarmedDamage, {
  activation: { mode: 'attack_entry', cost: [] },
  effects: [{
    ability: 'str',
    attack_kind: 'unarmed',
    resolution: 'attack_roll',
    vs: 'ac',
    on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
  }],
});

function unarmedDamageActionFor(actor: ActorState): RuleActionDefinition {
  const holdsWeapon = (['main_hand', 'off_hand'] as const).some((slot) => {
    const cardId = actor.runtime.equipment[slot];
    return !!cardId && actorCard(actor, cardId)?.type === 'weapon';
  });
  const profile = resolveUnarmedDamageProfile(actor.passives ?? [], {
    holdingWeaponOrShield: holdsWeapon || actorHoldsCanonicalShield(actor),
  });
  if (!profile) return CORE_UNARMED_DAMAGE;
  return {
    ...CORE_UNARMED_DAMAGE,
    mechanics: {
      ...CORE_UNARMED_DAMAGE.mechanics,
      effects: [{
        ability: 'str',
        attack_kind: 'unarmed',
        resolution: 'attack_roll',
        vs: 'ac',
        on_hit: [{
          amount: `${profile.dice} + ${profile.ability}`,
          kind: 'damage',
          type: profile.damageType,
        }],
      }],
    },
  };
}

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
function hideEligibilityIssue(facts: HideEligibilityFacts | undefined): string | null {
  if (!facts || typeof facts !== 'object') return 'Hide requires explicit eligibility facts';
  if (!['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)) {
    return 'Hide facts require a recognized source';
  }
  if (!Number.isInteger(facts.boardRevision) || facts.boardRevision < 0) {
    return 'Hide facts require a non-negative board revision';
  }
  if (typeof facts.heavilyObscured !== 'boolean' || typeof facts.visibleToAnyEnemy !== 'boolean'
    || !['none', 'half', 'three_quarters', 'total'].includes(facts.cover)) {
    return 'Hide facts are malformed';
  }
  const hasRequiredObscurement = facts.heavilyObscured
    || facts.cover === 'three_quarters'
    || facts.cover === 'total';
  if (!hasRequiredObscurement) {
    return 'Hide requires Heavy Obscurement, Three-Quarters Cover, or Total Cover';
  }
  if (facts.visibleToAnyEnemy) {
    return 'Hide is unavailable while any enemy can see the actor';
  }
  return null;
}

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
  if (!Array.isArray(hazard.sourceEntityIds) || hazard.sourceEntityIds.length === 0
    || hazard.sourceEntityIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    return `${hazard.id} must have at least one stable sourceEntityId`;
  }
  if (new Set(hazard.sourceEntityIds).size !== hazard.sourceEntityIds.length) {
    return `${hazard.id} contains duplicate sourceEntityIds`;
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
  return null;
}

function cloneHazard(hazard: RuleHazardDefinition): RuleHazardDefinition {
  return JSON.parse(JSON.stringify(hazard)) as RuleHazardDefinition;
}

function hazardSourceId(hazard: RuleHazardDefinition): string {
  return `${hazard.sourceKind}:${hazard.id}`;
}

function hazardObligationIds(hazard: RuleHazardDefinition): string[] {
  return [...new Set([
    `hazard:${hazard.id}`,
    ...hazard.sourceEntityIds.map((id) => `entity:${id}`),
    'system:hazard-save',
    'system:pending-resolution',
  ])];
}

function hazardAvoidedConditions(hazard: RuleHazardDefinition): string[] {
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
          ...(action.spell.sourceClass ? { sourceClass: action.spell.sourceClass } : {}),
          ...(spell.components ? { components: { ...spell.components } } : {}),
          ...(spell.grantId ? { grantId: spell.grantId } : {}),
          ...(spell.sourceId ? { sourceId: spell.sourceId } : {}),
          ...(spell.spellcastingAbility ? { spellcastingAbility: spell.spellcastingAbility } : {}),
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

function actorContext(actor: ActorState): CharacterContext & { passives?: Record<string, unknown>[] } {
  return { ...actor.character, ...(actor.passives?.length ? { passives: actor.passives } : {}) };
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

function effectiveArmorClass(actor: ActorState, runtime = actor.runtime): number {
  const withoutTransient = { ...runtime, activeEffects: [] };
  const baseline = armorClassValue(actor.character, withoutTransient, actor.passives ?? []).value;
  const projected = armorClassValue(actor.character, runtime, actor.passives ?? []).value;
  return (actor.ac ?? baseline) + (projected - baseline);
}

function actionContext(
  source: ActorState,
  env: DeterministicEnvironment,
  target?: ActorState,
  targetRuntime = target?.runtime,
  facts?: SpatialFacts,
  spell?: SpellCastContext,
): ExecuteContext & { passives?: Record<string, unknown>[] } {
  const spellcastingAbility = spell?.spellcastingAbility;
  const character = spellcastingAbility
    ? {
      ...source.character,
      spellcastingAbility,
      spellcastingMod: source.character.abilityMods[spellcastingAbility] ?? 0,
    }
    : source.character;
  return {
    character,
    selfRuntime: source.runtime,
    selfId: source.id,
    passives: source.passives,
    conditionImmunities: source.traits?.conditionImmunities,
    grantedEffects: source.grantedEffects,
    masteryEffects: source.masteryEffects,
    rng: env.rng,
    nextId: env.nextId,
    ...(facts?.nearbyEligibleAllyToTarget != null ? {
      attackFacts: { nearbyEligibleAllyToTarget: facts.nearbyEligibleAllyToTarget },
    } : {}),
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
        ...(Number.isInteger(target.attackProfile?.size)
          ? { size: target.attackProfile!.size }
          : {}),
        ac: effectiveArmorClass(target, targetRuntime ?? target.runtime),
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
      targetIds,
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
  if (differs(before.hp, after.hp)) patch.hp = after.hp;
  if (differs(before.resources, after.resources)) patch.resources = after.resources;
  if (differs(before.maxResources, after.maxResources)) patch.maxResources = after.maxResources;
  if (differs(before.equipment, after.equipment)) patch.equipment = after.equipment;
  if (differs(before.inventory, after.inventory)) patch.inventory = after.inventory;
  if (differs(before.activeEffects, after.activeEffects)) patch.activeEffects = after.activeEffects;
  if (differs(before.firedThisTurn, after.firedThisTurn)) patch.firedThisTurn = after.firedThisTurn ?? null;
  if (differs(before.firedThisRest, after.firedThisRest)) patch.firedThisRest = after.firedThisRest ?? null;
  return patch;
}

function runtimeTransition(
  sourceActorId: string,
  actorId: string,
  before: ActorState['runtime'],
  after: ActorState['runtime'],
  reason: 'start_turn' | 'end_turn' | 'action' | 'ability_check' | 'hazard' | 'short_rest' | 'long_rest',
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
function consumedConcentrationLifecycle(input: {
  world: WorldState;
  actingActorId: string;
  changedActorId: string;
  before: ActorState['runtime'];
  after: ActorState['runtime'];
  obligations: string[];
}): { transitions: EventInput[]; lifecycle: EventInput[] } {
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
        input.after,
        'ability_check',
        input.obligations,
      ),
      lifecycle: [],
    };
  }

  const obligations = [...new Set([
    ...input.obligations,
    'system:concentration-effect-consumed',
  ])];
  const runtimes = new Map<string, ActorState['runtime']>([
    [input.changedActorId, input.after],
  ]);
  const lifecycle: EventInput[] = [];

  for (const concentration of concentrations) {
    for (const link of concentration.effectLinks) {
      const linkedActor = input.world.actors[link.actorId];
      if (!linkedActor) continue;
      const current = runtimes.get(link.actorId) ?? linkedActor.runtime;
      const linkedEffect = current.activeEffects.find((effect) => effect.id === link.effectId);
      if (!linkedEffect) continue;
      runtimes.set(link.actorId, {
        ...current,
        activeEffects: current.activeEffects.filter((effect) => effect.id !== link.effectId),
      });
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
        runtimes.set(link.actorId, {
          ...current,
          activeEffects: current.activeEffects.filter((effect) => effect.id !== link.effectId),
        });
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
    if (!deniedCapabilities(after, concentratingActor.passives ?? []).has('concentration')) continue;

    for (const link of concentration.effectLinks) {
      const linkedActor = world.actors[link.actorId];
      if (!linkedActor) continue;
      const current = runtimes.get(link.actorId) ?? linkedActor.runtime;
      const removed = current.activeEffects.find((effect) => effect.id === link.effectId);
      if (!removed) continue;
      runtimes.set(link.actorId, {
        ...current,
        activeEffects: current.activeEffects.filter((effect) => effect.id !== link.effectId),
      });
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
    ...(sourceConcentration ? [sourceConcentration] : []),
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
        spellSaveDc: 8 + source.character.profBonus + (
          command.spell?.spellcastingAbility
            ? source.character.abilityMods[command.spell.spellcastingAbility] ?? 0
            : source.character.spellcastingMod ?? 0
        ),
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
  } = {},
): EventInput[] {
  const source = world.actors[command.actorId];
  const targets = command.targetIds.map((targetId) => world.actors[targetId]);
  const executionTargets: Array<ActorState | undefined> = targets.length ? targets : [undefined];
  let sourceAfter = source.runtime;
  const executions: Array<{
    target?: ActorState;
    result: ReturnType<typeof executeAction>;
    retaliationEvents: EngineEvent[];
    retaliationSourceEntityIds: string[];
  }> = [];

  for (const [index, target] of executionTargets.entries()) {
    const sourceAtStep: ActorState = { ...source, runtime: sourceAfter };
    const result = executeAction(
      sourceAfter,
      index === 0 ? action.mechanics : withoutActivationCost(action.mechanics),
      {
        ...actionContext(
          sourceAtStep,
          env,
          target,
          target?.runtime,
          target ? command.factsByTarget?.[target.id] : undefined,
          command.spell,
        ),
        actionName: action.name,
        choices: command.choices,
        spell: command.spell,
        suppressSpellCastEvent: index > 0,
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
    }
  }
  const events: EventInput[] = actionStateEvents({
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
  if (executions.some(({ retaliationEvents }) => retaliationEvents.length)) {
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
  return events;
}

function activationCost(action: RuleActionDefinition): Record<string, unknown>[] {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  return Array.isArray(activation?.cost) ? activation.cost as Record<string, unknown>[] : [];
}

function activationMode(action: RuleActionDefinition): string {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  return String(activation?.mode ?? 'active');
}

function reactionTriggers(action: RuleActionDefinition): string[] {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const trigger = activation?.trigger as Record<string, unknown> | undefined;
  if (activationMode(action) !== 'reaction') return [];
  const declared = [
    ...(typeof trigger?.event === 'string' ? [trigger.event] : []),
    ...(Array.isArray(trigger?.events) ? trigger.events.map(String) : []),
  ].filter(Boolean);
  return [...new Set(declared)];
}

function hasReactionTrigger(action: RuleActionDefinition, trigger: string): boolean {
  return reactionTriggers(action).includes(trigger);
}

function requiredActionCapability(action: RuleActionDefinition): 'action' | 'bonus_action' | 'reaction' {
  if (activationMode(action) === 'reaction') return 'reaction';
  const resources = activationCost(action).map((cost) => String(cost.resource ?? ''));
  return resources.includes('bonus_action') ? 'bonus_action' : 'action';
}

function withoutActivationCost(mechanics: Record<string, unknown>): Record<string, unknown> {
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  return {
    ...mechanics,
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
  if (sequence.totalAttacks !== replacement.totalAttacks || !attackSequenceComplete(sequence)) {
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
    resources: actor.runtime.resources,
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
      resources: target.runtime.resources,
      declaration: { grantId },
    });
    if (execution.status === 'rejected'
      || execution.provenance.mode === 'ritual'
      || !canPay(target.runtime, activationCost(execution.executableAction)).ok) return [];
    return [{
      grantId: execution.provenance.grantId,
      sourceId: execution.provenance.sourceId,
      spellcastingAbility: execution.provenance.spellcastingAbility,
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
): Array<{ action: RuleActionDefinition; option: ReactionActionOption }> {
  if (deniedCapabilities(target.runtime, target.passives ?? []).has('reaction')) return [];
  return target.capabilities.actionIds.flatMap((actionId) => {
    const action = catalog.getAction(actionId);
    if (!action || !hasReactionTrigger(action, 'hit_by_attack')) return [];
    const [option] = sourceScopedReactionOptions(target, action);
    return option ? [{ action, option }] : [];
  });
}

function catalogActionForActor(
  actor: ActorState,
  action: RuleActionDefinition,
): RuleActionDefinition {
  const holdsWeapon = (['main_hand', 'off_hand'] as const).some((slot) => {
    const cardId = actor.runtime.equipment[slot];
    return !!cardId && actorCard(actor, cardId)?.type === 'weapon';
  });
  return applyUnarmedDamageProfileToAction(action, actor.passives ?? [], {
    holdingWeaponOrShield: holdsWeapon || actorHoldsCanonicalShield(actor),
  });
}

function damageReactionOptions(
  target: ActorState,
  catalog: RulesCatalog,
): Array<{ action: RuleActionDefinition; option: ReactionActionOption }> {
  if (deniedCapabilities(target.runtime, target.passives ?? []).has('reaction')) return [];
  return target.capabilities.actionIds.flatMap((actionId) => {
    const action = catalog.getAction(actionId);
    if (!action || !hasReactionTrigger(action, 'damage_taken')) return [];
    const [option] = sourceScopedReactionOptions(target, action);
    return option ? [{ action, option }] : [];
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
): { events: EngineEvent[]; amount: number } {
  let remainingReduction = Math.max(0, Math.floor(reduction));
  let amount = 0;
  const adjusted = events.map((event): EngineEvent => {
    if (event.type !== 'damage' || event.amount <= 0) return JSON.parse(JSON.stringify(event)) as EngineEvent;
    const applied = Math.min(event.amount, remainingReduction);
    remainingReduction -= applied;
    const nextAmount = event.amount - applied;
    amount += nextAmount;
    return { ...event, amount: nextAmount };
  });
  return { events: adjusted, amount };
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
  };
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
  if (!input.targetRuntimeAfter || input.source.id === input.target.id) return null;
  const packets = damagePackets(input.attackEvents);
  const amount = packets.reduce((sum, packet) => sum + packet.amount, 0);
  if (amount <= 0) return null;

  const targetAtWindow: ActorState = {
    ...input.target,
    runtime: input.targetRuntimeBeforeDamage,
  };
  const options = damageReactionOptions(targetAtWindow, input.catalog);
  if (!options.length) return null;

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
          actorId: input.target.id,
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
function pendingAttackEvents(
  world: WorldState,
  command: AuthoritativeUseActionCommand,
  action: RuleActionDefinition,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
  options: PendingAttackOptions = {},
): CommandResult | EventInput[] | null {
  const targetId = command.targetIds[0];
  if (!targetId || !hasAttackRoll(action)) return null;
  const originalSource = world.actors[command.actorId];
  const originalTarget = world.actors[targetId];
  const facts = command.factsByTarget?.[targetId];
  if (!facts) return rejected(world, 'MissingSpatialFacts', `Missing spatial facts for target ${targetId}`);
  const protection = protectionCandidatesForAttack({
    world, command, source: originalSource, target: originalTarget, facts,
  });
  if ('status' in protection) return protection;

  const candidateByProtector = new Map(protection.candidates.map((candidate) => (
    [candidate.protectorActorId, candidate] as const
  )));
  let protectionDisadvantage = false;
  const protectionLifecycleEvents: EventInput[] = [];
  for (const protector of Object.values(world.actors)) {
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
  const target = options.protectionWindowResolved
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
    const paid = pay(source.runtime, activationCost(action));
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
  const availableReactions = hitReactionOptions(target, catalog);
  if (!availableReactions.length
    && !options.forceExecution
    && !protectionDisadvantage
    && !protectionLifecycleEvents.length) return null;

  const cost = activationCost(action);
  const payable = canPay(source.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = pay(source.runtime, cost);
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
    pauseAfterAttackRoll: true,
    ...(options.externalPrimitiveHandled ? { externalPrimitiveHandled: true as const } : {}),
  });
  const attackRoll = attackRollFrom(preview.events);
  if (!attackRoll) return rejected(world, 'InvalidDecision', `${action.id} did not produce an attack roll`);

  const reactions = attackRoll.outcome === 'hit' || attackRoll.outcome === 'crit'
    ? availableReactions
    : [];
  if (reactions.length) {
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
            request: {
              id: requestId,
              type: 'reaction',
              actorId: target.id,
              trigger: {
                type: 'hit_by_attack',
                sourceActorId: source.id,
                actionId: action.id,
                attackTotal: attackRoll.total,
                originalAc: effectiveArmorClass(target),
              },
              options: reactions.map(({ option }) => cloneReactionOption(option)),
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
    forcedAttackRoll: attackRoll,
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
    targetRuntimeBeforeDamage: target.runtime,
    sourceRuntimeAfter: resumed.state,
    targetRuntimeAfter: resumed.targetState,
    attackEvents: resumedEvents,
    deferredTargetSaves: resumed.deferredTargetSaves,
    attackActionId: options.attackActionId,
    catalog,
    env,
    obligations,
  });
  if (damageWindow) return [...protectionLifecycleEvents, ...damageWindow];
  const events: EventInput[] = [
    ...protectionLifecycleEvents,
    ...actionStateEvents({
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
    targetAfter: resumed.targetState,
    action,
    deferred: resumed.deferredTargetSaves,
    env,
    obligations,
  }));
  return events;
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
  const paid = pay(source.runtime, cost);
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
        spell: command.spell,
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
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  const issue = hideEligibilityIssue(command.eligibility);
  if (issue) return rejected(world, 'HideNotEligible', issue);
  if (deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) {
    return rejected(world, 'CapabilityDenied', `${actor.id} cannot take the Hide action in its current state`);
  }
  const payable = canPay(actor.runtime, activationCost(CORE_HIDE_ACTION));
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }

  const result = executeAction(actor.runtime, CORE_HIDE_ACTION.mechanics, actionContext(actor, env));
  const obligations = actionObligationIds(
    CORE_HIDE_ACTION,
    'system:hide-action',
    'system:ability-check',
  );
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action: CORE_HIDE_ACTION,
      targetIds: [],
      timing: 'active',
      facts: { hideEligibility: { ...command.eligibility }, dc: 15 },
      obligationIds: obligations,
    }),
    ...runtimeTransition(actor.id, actor.id, actor.runtime, result.state, 'action', obligations),
    ...engineTrace(actor.id, [], result.events, obligations),
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

function openHazardSave(
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
  const action = catalog.getAction(pending.actionId);
  if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${pending.actionId}`);
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
    roll: 'saving_throw', filter: { ability: pending.request.ability },
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
      advantage: collected.advantage,
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

  const sharedDamage = replayableSharedDamageRng(pending.sharedDamageRolls, env.rng);
  const result = executeAction(
    source.runtime,
    withoutActivationCost(action.mechanics),
    {
      ...actionContext(source, env, target, target.runtime, pending.facts, pending.spell),
      choices: pending.choices,
      spell: pending.spell,
      suppressSpellCastEvent: pending.spellCastEmitted === true,
      damageRng: sharedDamage.rng,
      forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
      ...(worldActionPrimitive(action) ? { externalPrimitiveHandled: true as const } : {}),
    },
  );
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
  const targetAfter = target.id === source.id ? result.state : result.targetState;
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
  const events: EventInput[] = engineTrace(target.id, [source.id], [saveEvent], obligationIds);
  events.push(...actionStateEvents({
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
  events.push({
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

function resolvePendingAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'attack_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no attack reaction to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the attacked actor can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'An attack reaction requires a reaction response');
  }
  if (command.response.actionId === null && command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'A declined reaction cannot select a spell source');
  }

  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  let sourceForAttack = source;
  let pendingWeapon = pending.weaponCardId ? actorCard(source, pending.weaponCardId) : undefined;
  if (pending.pactBladeProjection) {
    if (pending.actionId !== SYSTEM_ACTION_IDS.weaponAttack
      || pending.weaponHand !== pending.pactBladeProjection.weaponHand
      || pending.weaponCardId !== pending.pactBladeProjection.weaponCardId) {
      return rejected(world, 'InvalidDecision', 'Attack reaction lost its Pact Blade continuation identity');
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
    pendingWeapon = persisted.card;
  } else if ((pending.weaponHand === undefined) !== (pending.weaponCardId === undefined)
    || (pending.weaponHand && (!pendingWeapon
      || pendingWeapon.type !== 'weapon'
      || source.runtime.equipment[pending.weaponHand === 'main' ? 'main_hand' : 'off_hand']
        !== pendingWeapon.id))) {
    return rejected(world, 'InvalidDecision', 'Attack reaction lost its exact equipped weapon');
  }
  const pendingWeaponRange = pendingWeapon
    ? weaponRanges(pendingWeapon, pending.facts.distanceFt)
    : null;
  if (pendingWeapon && !pendingWeaponRange) {
    return rejected(world, 'InvalidDecision', 'Attack reaction weapon profile or range is no longer valid');
  }
  const baseAttack = pending.actionId === SYSTEM_ACTION_IDS.weaponAttack
    ? pending.weaponHand && pendingWeapon
      ? cleaveWindowFor({
        actor: sourceForAttack,
        weaponCardId: pendingWeapon.id,
        committedByCommandId: pending.openedByCommandId,
      })
        ? cleaveWeaponAttackAction(sourceForAttack, pending.weaponHand)
        : weaponAttackAction(pending.weaponHand, pendingWeaponRange!.kind)
      : CORE_WEAPON_ATTACK
    : pending.actionId === SYSTEM_ACTION_IDS.lightExtraAttack
      ? pending.weaponHand && pendingWeapon
        ? lightWeaponExtraAttackAction(
          sourceForAttack,
          pending.weaponHand,
          pendingWeaponRange!.kind,
          selectedWeaponUsesMastery(sourceForAttack, pendingWeapon.id, 'nick')
            ? 'attack_action'
            : 'bonus_action',
        )
        : null
    : pending.actionId === SYSTEM_ACTION_IDS.unarmedDamage
      ? unarmedDamageActionFor(sourceForAttack)
      : catalog.getAction(pending.actionId)
        ?? familiarAttackRuleAction(sourceForAttack, pending.actionId);
  const attack = baseAttack && pending.pactBladeProjection
    ? pactBladeWeaponAttackAction(baseAttack, pending.pactBladeProjection)
    : baseAttack;
  if (!attack) return rejected(world, 'ActionNotFound', `Unknown action ${pending.actionId}`);
  const attackDefinitionIssue = actionDefinitionIssue(attack);
  if (attackDefinitionIssue) return rejected(world, 'InvalidActionDefinition', attackDefinitionIssue);

  let targetRuntime = target.runtime;
  let reactionEvents: EngineEvent[] = [];
  let selectedReaction: RuleActionDefinition | undefined;
  let selectedReactionSpell: CanonicalSpellContext | undefined;
  const selectedId = command.response.actionId;
  if (selectedId !== null) {
    if (!pending.request.options.some((option) => option.actionId === selectedId)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} was not offered`);
    }
    if (!target.capabilities.actionIds.includes(selectedId)) {
      return rejected(world, 'ActionNotGranted', `Actor ${target.id} does not own reaction ${selectedId}`);
    }
    const reaction = catalog.getAction(selectedId);
    if (!reaction || !hasReactionTrigger(reaction, 'hit_by_attack')) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} is no longer valid for this trigger`);
    }
    const definitionIssue = actionDefinitionIssue(reaction);
    if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
    const declarationIssue = spellDeclarationIssue(reaction);
    if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
    if (deniedCapabilities(targetRuntime, target.passives ?? []).has('reaction')) {
      return rejected(world, 'CapabilityDenied', `${target.id} cannot take reactions in its current state`);
    }
    const preparedReaction = prepareReactionExecution(target, reaction, command.response.spell);
    if (preparedReaction.status === 'rejected') {
      return rejected(world, preparedReaction.code, preparedReaction.message);
    }
    const payable = canPay(targetRuntime, activationCost(preparedReaction.action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing reaction resources: ${payable.missing.join(', ')}`);
    }
    selectedReaction = preparedReaction.action;
    selectedReactionSpell = preparedReaction.spell;
    const reactionResult = executeAction(targetRuntime, preparedReaction.action.mechanics, {
      ...actionContext(target, env, undefined, undefined, undefined, selectedReactionSpell),
      actionName: preparedReaction.action.name,
      spell: selectedReactionSpell,
    });
    targetRuntime = reactionResult.state;
    reactionEvents = reactionResult.events;
  }

  const targetAfterReaction: ActorState = { ...target, runtime: targetRuntime };
  const resumed = executeAction(sourceForAttack.runtime, withoutActivationCost(attack.mechanics), {
    ...actionContext(sourceForAttack, env, targetAfterReaction, targetRuntime, pending.facts, pending.spell),
    ...(pending.attackActionId ? { attackActionId: pending.attackActionId } : {}),
    attackCommandId: pending.openedByCommandId,
    choices: pending.choices,
    spell: pending.spell,
    forcedAttackRoll: pending.attackRoll,
    deferTargetSaves: true,
    ...(worldActionPrimitive(attack) ? { externalPrimitiveHandled: true as const } : {}),
  });
  const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
    world,
    attacker: sourceForAttack,
    defender: targetAfterReaction,
    attackerAfter: resumed.state,
    defenderAfter: resumed.targetState ?? targetRuntime,
    action: attack,
    attackEvents: resumed.events,
    env,
  });
  const sourceAfter = pending.pactBladeProjection
    ? withoutPactBladeEquipmentProjection(armor.attackerAfter, source.runtime)
    : armor.attackerAfter;
  const finalTargetRuntime = armor.defenderAfter ?? targetRuntime;
  const obligations = [...new Set([
    ...actionObligationIds(
      attack,
      'system:attack-resolution',
      'system:reaction-window',
      'system:pending-resolution',
    ),
    ...(selectedReaction ? actionObligationIds(selectedReaction) : []),
    ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
    ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
  ])];
  const resumedAttackEvents = relabelAttackRolls(
    resumed.events,
    selectedId ? 'Атака — после реакции' : 'Атака',
  );
  const damageWindow = damageReactionOpenedEvents({
    world,
    commandId: command.commandId,
    source: sourceForAttack,
    target: targetAfterReaction,
    action: attack,
    facts: pending.facts,
    targetRuntimeBeforeDamage: targetRuntime,
    sourceRuntimeAfter: sourceAfter,
    targetRuntimeAfter: finalTargetRuntime,
    preDamageTargetEvents: reactionEvents,
    attackEvents: resumedAttackEvents,
    retaliationEvents: armor.retaliationEvents,
    retaliationSourceEntityIds: armor.retaliationSourceEntityIds,
    deferredTargetSaves: resumed.deferredTargetSaves,
    attackActionId: pending.attackActionId,
    catalog,
    env,
    obligations,
  });
  if (damageWindow) {
    const opened = damageWindow[0]?.payload.type === 'ResolutionOpened'
      ? damageWindow[0].payload.resolution
      : null;
    if (!opened || opened.type !== 'damage_reaction') {
      return rejected(world, 'InvalidDecision', 'Damage reaction continuation was not created');
    }
    const chained: EventInput[] = [{
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
      chained.push(actionDeclaredEvent({
        actorId: target.id,
        action: selectedReaction,
        targetIds: [target.id],
        timing: 'reaction',
        spell: selectedReactionSpell,
        obligationIds: obligations,
      }));
    }
    chained.push({
      sourceActorId: target.id,
      obligationIds: obligations,
      payload: { type: 'ResolutionClosed', resolutionId: pending.id },
    });
    if (pending.attackActionId) {
      const attackAction = world.attackActions[pending.attackActionId];
      if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
        return rejected(world, 'InvalidDecision', 'Attack reaction lost its canonical Attack-action ledger');
      }
      chained.push(...attackResolutionFinishedEvents({
        attackAction,
        resolutionId: pending.id,
        actorId: source.id,
        obligations: [...obligations, 'system:attack-action'],
        closeIfComplete: false,
      }));
    }
    chained.push(...damageWindow);
    if (pending.attackActionId) {
      chained.push(blockAttackActionEvent({
        actorId: source.id,
        attackActionId: pending.attackActionId,
        resolutionId: opened.id,
        obligations: [...obligations, 'system:attack-action'],
      }));
    }
    return chained;
  }
  const events: EventInput[] = [];
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
  if (selectedReaction) {
    events.push(actionDeclaredEvent({
      actorId: target.id,
      action: selectedReaction,
      targetIds: [target.id],
      timing: 'reaction',
      spell: selectedReactionSpell,
      obligationIds: obligations,
    }));
  }
  events.push(...actionStateEvents({
    world,
    commandId: pending.openedByCommandId,
    source: sourceForAttack,
    action: attack,
    sourceAfter,
    target,
    targetAfter: finalTargetRuntime,
    obligations,
  }));
  if (reactionEvents.length) {
    events.push(...engineTrace(target.id, [target.id], reactionEvents, obligations));
  }
  events.push(...engineTrace(source.id, [target.id], resumedAttackEvents, obligations));
  events.push(...engineTrace(target.id, [source.id], armor.retaliationEvents, obligations, {
    sourceActorId: target.id,
    facts: { trigger: 'temporary_hp_melee_retaliation' },
  }));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  if (pending.attackActionId) {
    const attackAction = world.attackActions[pending.attackActionId];
    if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
      return rejected(world, 'InvalidDecision', 'Attack reaction lost its canonical Attack-action ledger');
    }
    events.push({
      sourceActorId: source.id,
      obligationIds: [...obligations, 'system:attack-action'],
      payload: {
        type: 'AttackActionUnblocked',
        attackActionId: attackAction.id,
        resolutionId: pending.id,
      },
    });
    if (attackAction.sequence.attacksRemaining === 0) {
      events.push({
        sourceActorId: source.id,
        obligationIds: [...obligations, 'system:attack-action'],
        payload: { type: 'AttackActionClosed', attackActionId: attackAction.id, reason: 'completed' },
      });
    }
  }
  events.push(...attackFollowUpEvents({
    world,
    commandId: command.commandId,
    source: sourceForAttack,
    sourceAfter,
    target,
    targetAfter: finalTargetRuntime,
    action: attack,
    deferred: resumed.deferredTargetSaves,
    env,
    obligations,
  }));
  return events;
}

function resolvePendingDamageReaction(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'damage_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no incoming-damage reaction to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active damage request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the damaged actor can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'Incoming damage requires a reaction response');
  }
  if (command.response.actionId === null && command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'A declined reaction cannot select a spell source');
  }
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  if (!source || !target) return rejected(world, 'ActorNotFound', 'Damage continuation actor is missing');
  if (pending.request.trigger.type !== 'damage_taken'
    || pending.request.trigger.sourceActorId !== source.id
    || pending.request.trigger.actionId !== pending.actionId
    || pending.request.trigger.amount !== pending.damage.reduce((sum, packet) => sum + packet.amount, 0)) {
    return rejected(world, 'InvalidDecision', 'Incoming-damage continuation metadata is inconsistent');
  }
  if (pending.action.id !== pending.actionId || actionDefinitionIssue(pending.action)) {
    return rejected(world, 'InvalidActionDefinition', 'Held damage action is no longer a valid definition');
  }

  let targetReactionRuntime = pending.targetRuntimeBeforeDamage;
  let sourceAfter = pending.sourceRuntimeAfter;
  let reactionEvents: EngineEvent[] = [];
  let selectedReaction: RuleActionDefinition | undefined;
  let selectedReactionSpell: CanonicalSpellContext | undefined;
  let reactionTargetIds: string[] = [];
  const selectedId = command.response.actionId;
  if (selectedId !== null) {
    if (!pending.request.options.some((option) => option.actionId === selectedId)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} was not offered`);
    }
    if (!target.capabilities.actionIds.includes(selectedId)) {
      return rejected(world, 'ActionNotGranted', `Actor ${target.id} does not own reaction ${selectedId}`);
    }
    const reaction = catalog.getAction(selectedId);
    if (!reaction || !hasReactionTrigger(reaction, 'damage_taken')) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} is no longer valid for damage_taken`);
    }
    const definitionIssue = actionDefinitionIssue(reaction);
    if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
    const declarationIssue = spellDeclarationIssue(reaction);
    if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
    const targetAtWindow: ActorState = { ...target, runtime: targetReactionRuntime };
    if (deniedCapabilities(targetReactionRuntime, target.passives ?? []).has('reaction')) {
      return rejected(world, 'CapabilityDenied', `${target.id} cannot take reactions in its current state`);
    }
    const prepared = prepareReactionExecution(targetAtWindow, reaction, command.response.spell);
    if (prepared.status === 'rejected') return rejected(world, prepared.code, prepared.message);
    const payable = canPay(targetReactionRuntime, activationCost(prepared.action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing reaction resources: ${payable.missing.join(', ')}`);
    }
    selectedReaction = prepared.action;
    selectedReactionSpell = prepared.spell;
    const selfOnly = prepared.action.targeting?.allowedRelations.every((relation) => relation === 'self') === true;
    const reactionTarget = selfOnly
      ? undefined
      : { ...source, runtime: sourceAfter };
    reactionTargetIds = selfOnly ? [target.id] : [source.id];
    const result = executeAction(targetReactionRuntime, prepared.action.mechanics, {
      ...actionContext(
        targetAtWindow,
        env,
        reactionTarget,
        reactionTarget?.runtime,
        reactionTarget ? pending.facts : undefined,
        selectedReactionSpell,
      ),
      actionName: prepared.action.name,
      spell: selectedReactionSpell,
    });
    targetReactionRuntime = result.state;
    sourceAfter = result.targetState ?? sourceAfter;
    reactionEvents = result.events;
  }

  const rolledReduction = reactionEvents.reduce((sum, event) => (
    event.type === 'damage_reduction' ? sum + event.amount : sum
  ), 0);
  const originalAmount = pending.damage.reduce((sum, packet) => sum + packet.amount, 0);
  const reduction = Math.min(originalAmount, Math.max(0, Math.floor(rolledReduction)));
  const adjusted = adjustedDamageEvents(pending.attackEvents, reduction);
  let targetAfter = applyReactionRuntimeDelta(
    pending.targetRuntimeAfter,
    pending.targetRuntimeBeforeDamage,
    targetReactionRuntime,
  );
  targetAfter = {
    ...targetAfter,
    hp: hpAfterDamage(targetReactionRuntime.hp, adjusted.amount),
  };
  const obligations = [...new Set([
    ...pending.obligationIds,
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
      targetIds: reactionTargetIds,
      timing: 'reaction',
      spell: selectedReactionSpell,
      obligationIds: obligations,
    }));
  }
  events.push(...actionStateEvents({
    world,
    commandId: pending.openedByCommandId,
    source,
    action: pending.action,
    sourceAfter,
    target,
    targetAfter,
    obligations,
  }));
  if (pending.preDamageTargetEvents.length) {
    events.push(...engineTrace(target.id, [target.id], pending.preDamageTargetEvents, obligations));
  }
  if (reactionEvents.length) {
    events.push(...engineTrace(target.id, reactionTargetIds, reactionEvents, obligations, {
      sourceActorId: target.id,
      facts: { trigger: 'damage_taken', amount: originalAmount },
    }));
  }
  if (reduction > 0) {
    events.push(...engineTrace(target.id, [target.id], [{
      type: 'narrative',
      text: `Снижение урона: ${originalAmount} → ${adjusted.amount} (−${reduction})`,
    }], obligations));
  }
  events.push(...engineTrace(source.id, [target.id], adjusted.events, obligations));
  events.push(...engineTrace(target.id, [source.id], pending.retaliationEvents, obligations, {
    sourceActorId: target.id,
    facts: { trigger: 'temporary_hp_melee_retaliation' },
  }));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  if (pending.attackActionId) {
    const attackAction = world.attackActions[pending.attackActionId];
    if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
      return rejected(world, 'InvalidDecision', 'Damage reaction lost its canonical Attack-action ledger');
    }
    events.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: source.id,
      obligations: [...obligations, 'system:attack-action'],
    }));
  }
  const followUps: PendingResolutionFollowUp[] = [...pending.followUps];
  const targetConcentration = concentrationSaveFollowUp({
    world,
    actor: target,
    actorAfter: targetAfter,
    obligations,
  });
  if (targetConcentration) followUps.push(targetConcentration);
  const sourceConcentration = concentrationSaveFollowUp({
    world,
    actor: source,
    actorAfter: sourceAfter,
    obligations,
  });
  if (sourceConcentration) followUps.push(sourceConcentration);
  events.push(...followUpOpenedEvents({
    world,
    commandId: command.commandId,
    followUps,
    env,
  }));
  return events;
}

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
  const spec = action ? magicMissileSpec(action) : null;
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
    roll: 'saving_throw', filter: { ability },
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
      advantage: collected.advantage,
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
    ...actionContext(source, env, target, target.runtime),
    ...(pending.mastery.weaponMod == null ? {} : { weaponMod: pending.mastery.weaponMod }),
    forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
  });
  const obligations = masterySaveObligationIds(pending);
  const events: EventInput[] = engineTrace(target.id, [], [{
    type: 'roll',
    label: `${pending.mastery.name}: спасбросок ${ABILITY_LABEL[ability]}`,
    roll: { ...roll, kind: 'save' },
  }], obligations);
  events.push(...actionStateEvents({
    world,
    commandId: command.commandId,
    source,
    action: masteryAction,
    sourceAfter: result.state,
    target,
    targetAfter: result.targetState,
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

function resolveConcentrationSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  env: DeterministicEnvironment,
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
    { value: actor.character.abilityMods.con ?? 0, source: ABILITY_LABEL.con },
    ...(proficient ? [{ value: actor.character.profBonus, source: 'БМ' }] : []),
    ...collected.modifiers,
  ];
  const manual = manualDecisionRng(command);
  let roll: ReturnType<typeof rollD20>;
  try {
    roll = rollD20({
      advantage: collected.advantage,
      modifiers,
      target: { type: 'dc', value: pending.request.dc },
      rules: collected.rules,
      rng: manual?.rng ?? env.rng,
    });
    manual?.assertExhausted();
  } catch (error) {
    return rejected(world, 'InvalidDecision', error instanceof Error ? error.message : 'Invalid concentration roll');
  }

  const obligations = ['system:concentration-damage-save', 'system:pending-resolution'];
  const events: EventInput[] = engineTrace(actor.id, [], [{
    type: 'roll',
    label: `Концентрация (СЛ ${pending.request.dc})`,
    roll: { ...roll, kind: 'save' },
  }], obligations);
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
      const after = {
        ...linkedActor.runtime,
        activeEffects: linkedActor.runtime.activeEffects.filter((effect) => !linkedEffectIds.has(effect.id)),
      };
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
    ...(roll.outcome === 'success' ? {} : {
      invalidConcentrationIds: new Set([pending.concentrationId]),
    }),
  }));
  return events;
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
    roll: 'saving_throw', filter: { ability },
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
      advantage: collected.advantage,
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

  const hazard = pending.hazard;
  const sourceActorId = hazardSourceId(hazard);
  const obligations = hazardObligationIds(hazard);
  const result = executeAction(target.runtime, {
    name: hazard.name,
    activation: { mode: 'passive', cost: [] },
    effects: [{
      resolution: 'save',
      who: 'self',
      ability: hazard.save.ability,
      dc: String(hazard.save.dc),
      on_fail: hazard.onFailure,
      on_success: hazard.onSuccess ?? [],
    }],
  }, {
    ...actionContext(target, env),
    selfId: sourceActorId,
    forceSaveOutcome: roll.outcome === 'success' ? 'success' : 'fail',
  });

  const events: EventInput[] = [];
  events.push(...engineTrace(target.id, [], [{
    type: 'roll',
    label: `${hazard.name}: спасбросок ${ABILITY_LABEL[ability]}`,
    roll: { ...roll, kind: 'save' },
  }], obligations));
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
  const cost = [{ resource: 'action' }];
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = pay(actor.runtime, cost);
  const skill = 'investigation';
  const proficient = actor.character.skillProficiencies?.includes(skill);
  const expertise = actor.character.skillExpertise?.includes(skill);
  const collected = collectRollModifiers(paid.state, actor.passives ?? [], {
    roll: 'ability_check',
    filter: { ability: 'int', skill },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const proficiency = expertise ? actor.character.profBonus * 2
    : proficient ? actor.character.profBonus : 0;
  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [
      { value: actor.character.abilityMods.int ?? 0, source: ABILITY_LABEL.int },
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
    filter: { ability: 'int', skill },
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

  const paid = pay(actor.runtime, cost);
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
    const paid = pay(actor.runtime, cost);
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

function executeCheck(
  world: WorldState,
  command: Extract<GameCommand, { type: 'AbilityCheck' }>,
  env: DeterministicEnvironment,
): EventInput[] {
  const actor = world.actors[command.actorId];
  const skill = command.skill?.trim().toLowerCase();
  const proficient = !!skill && actor.character.skillProficiencies?.includes(skill);
  const expertise = !!skill && actor.character.skillExpertise?.includes(skill);
  const base = actor.character.abilityMods[command.ability] ?? 0;
  const proficiency = expertise ? actor.character.profBonus * 2 : proficient ? actor.character.profBonus : 0;
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'ability_check',
    filter: { ability: command.ability, ...(skill ? { skill } : {}) },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const checkEvents: EngineEvent[] = [];
  const roll = rollD20({
    advantage: collected.advantage,
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
    filter: { ability: command.ability, ...(skill ? { skill } : {}) },
  });
  const obligations = ['system:ability-check', 'system:next-roll-effect'];
  const concentration = consumedConcentrationLifecycle({
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
  ];
}

function executeSave(
  world: WorldState,
  command: Extract<GameCommand, { type: 'SavingThrow' }>,
  env: DeterministicEnvironment,
): EventInput[] {
  const actor = world.actors[command.actorId];
  const proficient = actor.character.saveProficiencies?.includes(command.ability);
  const base = actor.character.abilityMods[command.ability] ?? 0;
  const collected = collectRollModifiers(actor.runtime, actor.passives ?? [], {
    roll: 'saving_throw', filter: { ability: command.ability },
    formulaCtx: actorFormulaContext(actor.character),
  });
  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [
      { value: base, source: ABILITY_LABEL[command.ability] },
      ...(proficient ? [{ value: actor.character.profBonus, source: 'БМ' }] : []),
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
  const timingCost = declared.status === 'valid'
    ? declared.cost.filter((entry) => entry.resource === 'action')
    : activationCost(CORE_ATTACK_ACTION);
  const payable = canPay(actor.runtime, timingCost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = pay(actor.runtime, timingCost);
  const attackActionId = env.nextId();
  const sequence = beginAttackSequence({
    id: attackActionId,
    actorId: actor.id,
    totalAttacks: profile.attacksPerAction,
  });
  const attackAction: AttackActionState = {
    id: attackActionId,
    actorId: actor.id,
    startedAtRevision: world.revision,
    turnKey: attackTurnKey(world, actor.id),
    status: 'open',
    sequence,
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
  return [
    actionDeclaredEvent({
      actorId: actor.id,
      action: declarationAction,
      targetIds: [],
      timing: 'active',
      facts: {
        attackActionId,
        attacksPerAction: profile.attacksPerAction,
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
  return bonus ? { ...target, ac: (target.ac ?? effectiveArmorClass(target)) + bonus } : target;
}

function weaponAttackAction(
  hand: 'main' | 'off',
  rangeKind: 'melee' | 'ranged',
): RuleActionDefinition {
  const effect = (CORE_WEAPON_ATTACK.mechanics.effects as Record<string, unknown>[])[0];
  return {
    ...CORE_WEAPON_ATTACK,
    mechanics: {
      ...CORE_WEAPON_ATTACK.mechanics,
      effects: [{
        ...effect,
        attack_kind: rangeKind === 'ranged' ? 'weapon_ranged' : 'weapon_melee',
        ...(hand === 'off' ? { tags: ['off_hand'] } : {}),
      }],
    },
  };
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
  const weapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime);
  if (!weapon) return null;
  const effect = (
    CORE_LIGHT_WEAPON_EXTRA_ATTACK.mechanics.effects as Record<string, unknown>[]
  )[0];
  const onHit = Array.isArray(effect.on_hit)
    ? effect.on_hit as Record<string, unknown>[]
    : [];
  const abilityModifier = source.character.abilityMods[weapon.ability] ?? 0;
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
    weapon: weaponContext(actor.character, hand, actor.runtime.equipment, actor.runtime),
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
  const weapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime);
  if (!weapon) return null;
  const base = weaponAttackAction(hand, 'melee');
  const effect = (base.mechanics.effects as Record<string, unknown>[])[0];
  const onHit = Array.isArray(effect.on_hit)
    ? effect.on_hit as Record<string, unknown>[]
    : [];
  const abilityModifier = source.character.abilityMods[weapon.ability] ?? 0;
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
  const declaredPayment = pay(source.runtime, declaredCost);
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
    if (!weaponContext(source.character, hand, source.runtime.equipment, source.runtime)) {
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
  const disadvantageReasons = [
    ...(heavy?.valid && heavy.disadvantage
      ? [`Heavy (${heavy.ability.toUpperCase()} below ${heavy.threshold})`]
      : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt > range.normalFt ? ['Long range'] : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt <= 5 && command.facts.relation === 'enemy'
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
  const sourceForAttack: ActorState = disadvantageReasons.length ? {
    ...paidExecutionSource,
    passives: [
      ...(paidExecutionSource.passives ?? []),
      ...disadvantageReasons.map(attackDisadvantagePassive),
    ],
  } : paidExecutionSource;
  const targetForAttack = attackTargetWithCover(target, command.facts.cover);
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
  const selectedWeapon = weaponContext(source.character, hand, source.runtime.equipment, source.runtime);
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
  const disadvantageReasons = [
    ...(heavy?.valid && heavy.disadvantage
      ? [`Heavy (${heavy.ability.toUpperCase()} below ${heavy.threshold})`]
      : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt > range.normalFt ? ['Long range'] : []),
    ...(range.kind === 'ranged' && command.facts.distanceFt <= 5 && command.facts.relation === 'enemy'
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
  const declaredPayment = pay(source.runtime, declaredCost);
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
  const sourceForAttack: ActorState = disadvantageReasons.length ? {
    ...markedSource,
    passives: [
      ...(markedSource.passives ?? []),
      ...disadvantageReasons.map(attackDisadvantagePassive),
    ],
  } : markedSource;
  const targetForAttack = attackTargetWithCover(target, command.facts.cover);
  const passiveDamageSourceIds = passiveModifierSourceEntityIds(source, {
    roll: 'damage',
    filter: {
      attackKind: 'weapon',
      extraAttackSource: 'light_property',
      abilityModifierAlreadyIncluded: false,
    },
    formulaCtx: {
      ...actorFormulaContext(source.character),
      weaponMod: source.character.abilityMods[selectedWeapon.ability] ?? 0,
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
    const sourceSize = source.attackProfile?.size;
    const targetSize = target.attackProfile?.size;
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
    const targetForAttack = attackTargetWithCover(target, command.facts.cover);
    const attackCommand: AuthoritativeUseActionCommand = {
      ...command,
      type: 'UseAction',
      actionId: ruleAction.id,
      targetIds: [target.id],
      factsByTarget: { [target.id]: command.facts },
    };
    const pending = pendingAttackEvents(
      { ...world, actors: { ...world.actors, [target.id]: targetForAttack } },
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
      ...actionContext(source, env, targetForAttack, target.runtime, command.facts),
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
  const dc = 8 + (source.character.abilityMods.str ?? 0) + source.character.profBonus;
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
}): { roll: RollLog; event: EngineEvent } | { issue: string } {
  const { target, ability, dc, command, env } = input;
  const collected = collectRollModifiers(target.runtime, target.passives ?? [], {
    roll: 'saving_throw',
    filter: { ability },
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
      advantage: collected.advantage,
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
  const attackAction = world.attackActions[pending.attackActionId];
  if (!source || !target || !attackAction
    || attackAction.actorId !== source.id
    || attackAction.blockedByResolutionId !== pending.id) {
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
    'system:attack-action',
    'system:unarmed-strike',
    `system:unarmed-strike:${pending.option}`,
    'system:target-save',
    'system:pending-resolution',
  ];
  let failed = command.response.kind === 'voluntary_fail';
  const traceEvents: EngineEvent[] = [];
  if (command.response.kind === 'roll') {
    const rolled = targetSaveRoll({
      target,
      ability: selectedAbility!,
      dc: pending.request.dc,
      command,
      env,
    });
    if ('issue' in rolled) return rejected(world, 'InvalidDecision', rolled.issue);
    failed = rolled.roll.outcome !== 'success';
    traceEvents.push(rolled.event);
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
  if (!failed) {
    events.push(...attackResolutionFinishedEvents({
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
    events.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: source.id,
      obligations,
    }));
    return events;
  }

  const shoveResolutionId = env.nextId();
  events.push(...attackResolutionFinishedEvents({
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
        attackActionId: attackAction.id,
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
  events.push(blockAttackActionEvent({
    actorId: source.id,
    attackActionId: attackAction.id,
    resolutionId: shoveResolutionId,
    obligations,
  }));
  return events;
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
  const attackAction = world.attackActions[pending.attackActionId];
  if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
    return rejected(world, 'InvalidDecision', 'Shove choice lost its Attack-action ledger');
  }
  const obligations = [
    'system:attack-action',
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
    ...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: command.actorId,
      obligations,
    }),
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
  const cost = [{ resource: 'action' }];
  const payable = canPay(actor.runtime, cost);
  if (!payable.ok) {
    return rejected(world, 'InsufficientResources', `Missing resources: ${payable.missing.join(', ')}`);
  }
  const paid = pay(actor.runtime, cost);
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
      advantage: collected.advantage,
      modifiers: [
        { value: actor.character.abilityMods[ability] ?? 0, source: ABILITY_LABEL[ability] },
        ...(proficient ? [{
          value: actor.character.profBonus * (expertise ? 2 : 1),
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
  return [
    ...engineTrace(actor.id, [], [{
      type: 'roll',
      label: `Escape Grapple (${pending.skill})`,
      roll: { ...roll, kind: 'check' },
    }], obligations, { facts: { grappleId: grapple.id, escapeDc: grapple.escapeDc } }),
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
    const paid = pay(owner.runtime, activationCost(action));
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

function familiarPolicyFromSummoningAction(
  familiar: ActorState,
  catalog: RulesCatalog,
): { policy: FindFamiliarMechanicsPolicy } | { issue: string } {
  const summoningActionId = familiar.familiarMetadata?.summoningActionId;
  if (!summoningActionId) {
    return { issue: 'Familiar has no summoning-action policy provenance' };
  }
  const action = catalog.getAction(summoningActionId);
  if (!action) return { issue: `Unknown familiar summoning action ${summoningActionId}` };
  const parsed = parseFindFamiliarMechanicsPolicy(action.mechanics);
  return parsed.status === 'valid'
    ? { policy: parsed.policy }
    : { issue: `${summoningActionId}: ${parsed.issue}` };
}

function activateOwnedFamiliarSharedSenses(
  world: WorldState,
  command: Extract<GameCommand, { type: 'UseFamiliarSharedSenses' }>,
  catalog: RulesCatalog,
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
    const paid = pay(owner.runtime, activationCost(FAMILIAR_SHARED_SENSES_ACTION));
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
    const paid = pay(owner.runtime, activationCost(FAMILIAR_DISMISS_ACTION));
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
    const paid = pay(owner.runtime, activationCost(FAMILIAR_REAPPEAR_ACTION));
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
    resources: owner.runtime.resources,
    declaration: {
      ...(command.spell?.grantId ? { grantId: command.spell.grantId } : {}),
      ...(command.spell?.mode ? { mode: command.spell.mode } : {}),
      ...(command.spell?.preferFreeUse !== undefined
        ? { preferFreeUse: command.spell.preferFreeUse }
        : {}),
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
  const conditionDenial = harmfulConditionRejection({
    world,
    attackerActorId: actor.id,
    targetActorIds: command.targetIds,
  });
  if (conditionDenial) return conditionDenial;

  let startEvents: EventInput[] = [];
  let worldWithAttack = world;
  let attackAction = openAttackAction(world, actor.id);
  if (attackAction) {
    const validated = validateAttackAction(world, actor.id, attackAction.id);
    if ('rejection' in validated) return validated.rejection;
    attackAction = validated.attackAction;
  } else {
    const started = beginAttackAction(world, { ...command, type: 'BeginAttackAction' }, catalog, env);
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
      linkedRuntimes.set(link.actorId, {
        ...current,
        activeEffects: current.activeEffects.filter((effect) => effect.id !== link.effectId),
      });
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

function executeCommand(
  world: WorldState,
  command: GameCommand,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const actor = world.actors[command.actorId];
  switch (command.type) {
    case 'StartEncounter': {
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
      return [...familiarInitiativeEvents, {
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
    }
    case 'StartTurn': {
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
    case 'EndTurn': {
      const boundary = sourceTurnBoundary(world, actor.id, 'end');
      const before = boundary.runtimes.get(actor.id) ?? actor.runtime;
      const turnContext = { ...actorContext({ ...actor, runtime: before }), rng: env.rng };
      const result = endTurn(
        before,
        turnContext,
        { advanceRoundDurations: false },
      );
      const scene = world.scene as EncounterScene;
      const nextIndex = (scene.activeIndex + 1) % scene.initiative.length;
      const nextRound = nextIndex === 0 ? scene.round + 1 : scene.round;
      const sourceRelative = endSourceActorTurnWorldObjects({
        objects: world.objects,
        sourceActorId: actor.id,
      });
      const elapsed = nextRound > scene.round
        ? advanceWorldObjectRounds({ objects: sourceRelative.objects, rounds: 1 })
        : { objects: sourceRelative.objects, events: [] };
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
          payload: { type: 'SceneSet', scene: { ...scene, activeIndex: nextIndex, round: nextRound, turnStarted: false } },
        },
      ];
    }
    case 'TakeShortRest': {
      const context = { ...actorContext(actor), rng: env.rng };
      const result = shortRest(actor.runtime, context);
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
      let stateAfterRest = result.state;
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
      return [
        ...runtimeTransition(actor.id, actor.id, actor.runtime, stateAfterRest, 'short_rest', obligations),
        ...engineTrace(actor.id, [], [...result.events, ...recoveryEvents], obligations),
        ...tomeEvents,
      ];
    }
    case 'TakeLongRest': {
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
      const result = longRest(actor.runtime, context);
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
      return [
        ...runtimeTransition(actor.id, actor.id, actor.runtime, result.state, 'long_rest', obligations),
        ...engineTrace(actor.id, [], result.events, obligations),
        ...tomeEvents,
      ];
    }
    case 'UseAttackReplacement':
      return executeAttackReplacement(world, command, catalog, env);
    case 'BeginAttackAction':
      return beginAttackAction(world, command, catalog, env);
    case 'PerformWeaponAttack':
      return performWeaponAttack(world, command, catalog, env);
    case 'PerformLightWeaponExtraAttack':
      return performLightWeaponExtraAttack(world, command, catalog, env);
    case 'PerformWeaponMasteryCleaveAttack':
      return performWeaponMasteryCleaveAttack(world, command, catalog, env);
    case 'PerformUnarmedStrike':
      return executeUnarmedStrike(world, command, catalog, env);
    case 'PerformPactChainFamiliarAttack':
      return performPactChainFamiliarAttack(world, command, catalog, env);
    case 'BondPactBlade':
      return pactBladeBondEvents({ world, command, catalog, env });
    case 'ObservePactBladeDistance':
      return pactBladeDistanceEvents({ world, command, catalog });
    case 'AdjudicateActorDeath':
      return adjudicateActorDeathEvents({ world, command, catalog });
    case 'ForfeitAttackAction':
      return forfeitAttackAction(world, command);
    case 'EscapeGrapple':
      return openEscapeGrapple(world, command, env);
    case 'ReleaseGrapple':
      return releaseGrapple(world, command);
    case 'BreakGrappleRange':
      return breakGrappleRange(world, command);
    case 'ObserveProtectionProximity':
      return observeProtectionProximity(world, command);
    case 'UseReactionAction':
    case 'UseAction': {
      if (actor.warlockPacts?.blade?.bondActionId === command.actionId) {
        return rejected(
          world,
          'InvalidActionTiming',
          `${command.actionId} is a canonical Pact Blade transition and must use BondPactBlade`,
        );
      }
      const action = catalog.getAction(command.actionId);
      if (!action) return rejected(world, 'ActionNotFound', `Unknown action ${command.actionId}`);
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
      if (!actor.capabilities.actionIds.includes(action.id)) {
        return rejected(world, 'ActionNotGranted', `Actor ${actor.id} does not own action ${action.id}`);
      }
      if (action.attackReplacement) {
        return rejected(
          world,
          'InvalidActionTiming',
          `${action.id} must replace an attack through the Attack-action sequence`,
        );
      }
      if (command.type === 'UseReactionAction') {
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
      if (deniedCapabilities(actor.runtime, actor.passives ?? []).has(requiredCapability)) {
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
      let executableAction = action;
      if (action.kind === 'spell' && actor.spellcastingAccess) {
        const preparation = prepareSpellExecution({
          action,
          accessState: actor.spellcastingAccess,
          resources: actor.runtime.resources,
          declaration: {
            ...(command.spell?.grantId ? { grantId: command.spell.grantId } : {}),
            ...(command.spell?.mode ? { mode: command.spell.mode } : {}),
            ...(command.spell?.preferFreeUse !== undefined
              ? { preferFreeUse: command.spell.preferFreeUse }
              : {}),
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
          actionId: preparation.executableAction.id,
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
      }
      executableAction = catalogActionForActor(actor, executableAction);
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
      const spell = canonicalSpellContext(
        executableAction,
        command.spell,
        preparedSpell,
        spellAudit,
      );
      const authoritativeCommand: AuthoritativeUseActionCommand = { ...command, type: 'UseAction', spell };
      if ((executableAction.mechanics.primitive as Record<string, unknown> | undefined)?.type
        === FIND_FAMILIAR_PRIMITIVE) {
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
        const familiar = executeFindFamiliarCast({
          world,
          command: authoritativeCommand,
          action: executableAction,
          env,
        });
        return Array.isArray(familiar)
          ? [...pactBladeFocusEvents, declaration, ...familiar]
          : familiar;
      }
      const missileAllocation = missileSpec ? magicMissileAllocation(authoritativeCommand, missileSpec) : null;
      if (missileAllocation && 'issue' in missileAllocation) {
        return rejected(world, 'InvalidTargets', missileAllocation.issue);
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
    case 'AbilityCheck':
      return executeCheck(world, command, env);
    case 'AttemptHide':
      return executeHide(world, command, env);
    case 'MakeNoise':
      return recordNoise(world, command);
    case 'FindHiddenActor':
      return recordEnemyFinding(world, command);
    case 'SwapInitiative':
      return swapAlertInitiative(world, command);
    case 'TriggerHazard':
      return openHazardSave(world, command, catalog, env);
    case 'SavingThrow':
      return executeSave(world, command, env);
    case 'StudyWorldObject':
      return studyWorldObject(world, command, env);
    case 'PhysicallyInteractWorldObject':
      return physicallyInteractWorldObject(world, command);
    case 'RevealMagicAura':
      return revealMagicAura(world, command, catalog);
    case 'MoveDancingLights':
      return moveActiveDancingLights(world, command, catalog);
    case 'ObservePoisonDisease':
      return observeActivePoisonDisease(world, command, catalog);
    case 'DonArmor':
      return donArmor(world, command);
    case 'UseFamiliarSharedSenses':
      return activateOwnedFamiliarSharedSenses(world, command, catalog);
    case 'DismissFamiliar':
      return dismissOwnedFamiliar(world, command);
    case 'ReappearFamiliar':
      return reappearOwnedFamiliar(world, command, catalog, env);
    case 'DeliverTouchSpellThroughFamiliar':
      return deliverTouchSpell(world, command, catalog, env);
    case 'ResolveDecision':
      return world.pendingResolution?.type === 'protection_reaction'
        ? resolvePendingProtection(world, command, catalog, env)
        : world.pendingResolution?.type === 'attack_reaction'
        ? resolvePendingAttack(world, command, catalog, env)
        : world.pendingResolution?.type === 'damage_reaction'
          ? resolvePendingDamageReaction(world, command, catalog, env)
        : world.pendingResolution?.type === 'unarmed_save'
          ? resolveUnarmedSave(world, command, env)
        : world.pendingResolution?.type === 'shove_outcome'
          ? resolveShoveOutcome(world, command, env)
        : world.pendingResolution?.type === 'escape_grapple'
          ? resolveEscapeGrapple(world, command, env)
        : world.pendingResolution?.type === 'magic_missile_reaction'
          ? resolveMagicMissileReaction(world, command, catalog, env)
        : world.pendingResolution?.type === 'mastery_save'
          ? resolveMasterySave(world, command, env)
        : world.pendingResolution?.type === 'concentration_save'
          ? resolveConcentrationSave(world, command, env)
          : world.pendingResolution?.type === 'hazard_save'
            ? resolveHazardSave(world, command, env)
            : resolvePendingSave(world, command, catalog, env);
  }
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
  const execution = executeCommand(world, command, catalog, commandEnv);
  if (!Array.isArray(execution)) return execution;

  // Cross-cutting lifecycle rules are generic post-conditions of every
  // accepted command, so individual spells/features cannot forget them.
  const provisionalEvents = execution.map((event, ordinal) => ({ ...event, ordinal }));
  const provisional = foldEvents(world, provisionalEvents);
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
  const postTerminal = terminal.world;
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

  const nextRevision = world.revision + 1;
  const rawEvents: EventInput[] = [
    ...execution,
    ...terminal.events,
    ...automaticArmorOfAgathysEnds,
    ...automaticFamiliarDisappears,
    ...automaticGrappleEnds,
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
