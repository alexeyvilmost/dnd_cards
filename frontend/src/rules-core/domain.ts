import type {
  CharacterContext,
  EngineEvent,
  RollLog,
  RuntimeState,
  SpellCastContext,
  SpellComponents,
} from '../mvp/contracts';
import type { Card } from '../types';
import type {
  MagicBlockingLayer,
  WorldObjectFacts,
  WorldObjectMutationEvent,
  WorldObjectSize,
  WorldObjectState,
} from './worldObjects';
import type { SpellCastMode, SpellcastingAccessState } from './spellcastingAccess';
import type {
  RestDecisionSelection,
  SlotRecoveryRestDecisionPolicy,
} from './restDecisions';
import type { ActorRuleTraits } from './actorTraits';
import type {
  AttackSequenceEntry,
  AttackSequenceState,
  UnarmedStrikeOption,
} from './attackSequence';
import type { ShoveOutcome } from './systemActions';
import type { WarlockPactStates } from './warlockPacts';
import type { StoneworkContactFacts } from './dwarfTraits';
import type { FamiliarState } from './findFamiliar';
import type { FamiliarActorDraft } from './familiarActorCatalog';
import type {
  Protection2024Effect,
  Protection2024LifecycleEvent,
  Protection2024ReactionFacts,
} from './protection';
import type {
  PactTomeRestCompletedEvent,
  PactTomeOwnerDiedEvent,
  PactTomeRestSelection,
} from './pactTomeRuntime';
import type {
  PactBladeMaterialFocusProjection,
  PactBladeWorldBondedEvent,
  PactBladeWorldDistanceAdvancedEvent,
  PactBladeWorldEndedOnOwnerDeathEvent,
} from './pactBladeWorldAdapter';
import type { PactBladeAttackProjectedEvent } from './pactBladeRuntime';

export type JsonObject = Record<string, unknown>;

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface RulesetReference {
  systemId: 'dnd5e-2024';
  releaseId: string;
  contentHash: string;
  errataVersion: string;
}

export const ACTOR_LIFECYCLE_PROVENANCE = 'canonical_actor_lifecycle' as const;

/**
 * Strong GM/system adjudication. Zero Hit Points is deliberately not this
 * fact: player characters can instead be Unconscious and make Death Saves.
 */
export interface ActorDeathAdjudicatedEvent {
  type: 'ActorDeathAdjudicated';
  provenance: typeof ACTOR_LIFECYCLE_PROVENANCE;
  factId: string;
  actorId: string;
  adjudicatedBy: string;
  observedAtWorldRevision: number;
  rulesetContentHash: string;
}

export type ActorLifecycleState =
  | { status: 'alive' }
  | { status: 'dead'; adjudication: ActorDeathAdjudicatedEvent };

export interface ActorState {
  id: string;
  name: string;
  kind: 'playerCharacter' | 'monster' | 'summonedActor';
  controllerId: string;
  ac?: number;
  /** Compiled, actor-owned capabilities. Commands fail closed outside this set. */
  capabilities: {
    actionIds: string[];
    /** Capability id -> immutable content entities proving the grant. */
    featureSources?: Record<string, readonly [string, ...string[]]>;
  };
  character: CharacterContext;
  runtime: RuntimeState;
  /** Materialized by createWorld/schema-v5 migration; optional only at TS fixture edges. */
  lifecycle?: ActorLifecycleState;
  passives?: JsonObject[];
  grantedEffects?: Record<string, {
    id?: string;
    card_number?: string;
    name?: string;
    mechanics?: unknown;
    repeatable?: boolean;
  } | undefined>;
  masteryEffects?: Record<string, {
    name?: string;
    mechanics?: unknown;
    /** Selected weapon types whose class-granted mastery resolves to this effect. */
    weaponTypes?: readonly string[];
    /** Immutable class feature, class, weapon data, and mastery effect proving the grant. */
    sourceEntityIds?: readonly [string, ...string[]];
  } | undefined>;
  /** Source-scoped spell grants and preparation state owned by this actor. */
  spellcastingAccess?: SpellcastingAccessState;
  /** Compiled creature traits that affect generic rest and condition rules. */
  traits?: ActorRuleTraits;
  /** Source-owned durable state for Pact invocations selected by this actor. */
  warlockPacts?: WarlockPactStates;
  /**
   * Canonical Find Familiar state.  It is present only on actors created by
   * the spell; generic summonedActor records remain valid without it.
   */
  familiarState?: FamiliarState;
  /** Pinned stat-block projection plus the exact actor-owned action that cast the spell. */
  familiarMetadata?: FamiliarActorDraft['familiarMetadata'] & {
    summoningActionId: string;
    catalogId: string;
    catalogContentHash: string;
  };
  /**
   * Compiled Attack-action facts.  It is optional only at the TypeScript edge
   * while schema <=3 snapshots are being upgraded; createWorld/migration always
   * materialize it before the actor enters the authoritative runtime.
   */
  attackProfile?: ActorAttackProfile;
}

export interface ActorAttackProfile {
  attacksPerAction: number;
  /** Tiny=0, Small=1, Medium=2, Large=3, Huge=4, Gargantuan=5. */
  size: number;
  reachFt: number;
  /** Stable anatomical/equipment slots able to maintain one grapple each. */
  graspingParts: string[];
  sourceEntityIds: [string, ...string[]];
}

export interface AttackActionState {
  id: string;
  actorId: string;
  startedAtRevision: number;
  /** Encounter turn identity prevents a budget surviving into another turn. */
  turnKey: string;
  status: 'open' | 'completed' | 'forfeited';
  sequence: AttackSequenceState;
  /** Immutable data action whose timing cost opened this Attack ledger. */
  declaredActionId?: string;
  /** Exact release provenance retained across pending decisions and reloads. */
  declaredActionSourceEntityIds?: [string, ...string[]];
  /** A persisted decision/reaction pauses, but does not erase, the sequence. */
  blockedByResolutionId?: string;
}

export interface GrappleState {
  id: string;
  grapplerActorId: string;
  targetActorId: string;
  sourcePart: string;
  escapeDc: number;
  reachFt: number;
  sourceEntityIds: [string, ...string[]];
  startedAtRevision: number;
}

export interface ExplorationScene {
  mode: 'exploration';
}

export interface EncounterScene {
  mode: 'encounter';
  initiative: string[];
  activeIndex: number;
  round: number;
  turnStarted: boolean;
  /** Alert users that already exercised their one post-Initiative swap window. */
  initiativeSwapActorIds?: string[];
}

export type SceneState = ExplorationScene | EncounterScene;

export interface WorldState {
  schemaVersion: 5;
  id: string;
  ruleset: RulesetReference;
  revision: number;
  logicalClock: number;
  actors: Record<string, ActorState>;
  /** Event-sourced, non-creature state such as lit objects and spell illusions. */
  objects: Record<string, WorldObjectState>;
  scene: SceneState;
  processedCommandIds: string[];
  pendingResolution: PendingResolution | null;
  concentrations: Record<string, ConcentrationState>;
  /** Durable Attack-action budget ledger; closed rows remain replay-auditable. */
  attackActions: Record<string, AttackActionState>;
  /** Active grapple relations.  This relation, not a generic condition, is authoritative. */
  grapples: Record<string, GrappleState>;
}

export interface ConcentrationEffectLink {
  actorId: string;
  effectId: string;
}

export interface ConcentrationState {
  id: string;
  sourceActorId: string;
  actionId: string;
  startedAtRevision: number;
  effectLinks: ConcentrationEffectLink[];
}

export type Relation = 'self' | 'ally' | 'enemy' | 'neutral';

/**
 * Геометрию пока вычисляет доска или задаёт GM. Rules core принимает только
 * проверяемые факты конкретной ревизии, а не координаты и не доверенный UI patch.
 */
export interface SpatialFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  distanceFt: number;
  lineOfSight: boolean;
  cover: 'none' | 'half' | 'three_quarters' | 'total';
  relation: Relation;
  /**
   * Directed visibility facts are distinct from geometric line of sight.
   * For example, an Invisible creature can remain inside an observer's line
   * of sight while still being unseen. Absence is treated as "seen" by the
   * rules adapter so a client cannot manufacture Advantage by omitting data.
   */
  canSeeTarget?: boolean;
  targetCanSeeSource?: boolean;
  /**
   * Explicit consent supplied by the board/GM for rules that target a willing
   * creature. Absence is deliberately not treated as consent.
   */
  willing?: boolean;
  /**
   * Board/GM assertion used by rules such as Sneak Attack. The rules core still
   * derives weapon qualification and roll advantage itself.
   */
  nearbyEligibleAllyToTarget?: boolean;
  /**
   * Explicit actor-to-surface observation used while board geometry does not
   * own material/contact data. Rules core still decides whether it is legal.
   */
  stonework?: StoneworkContactFacts;
}

/**
 * The board/GM supplies only the observable facts required by the 2024 Hide
 * action.  The rules core owns the eligibility predicate and the DC; clients
 * cannot declare that Hide succeeded or apply Invisible directly.
 */
export interface HideEligibilityFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  heavilyObscured: boolean;
  cover: 'none' | 'half' | 'three_quarters' | 'total';
  visibleToAnyEnemy: boolean;
}

/** Provenance shared by observable board/GM facts that can end Hide. */
export interface ObservableFactProvenance {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
}

export interface NoiseFacts extends ObservableFactProvenance {
  loudness: 'whisper_or_quieter' | 'above_whisper';
}

export interface EnemyFindingFacts extends ObservableFactProvenance {
  /** Relation from the finding creature to the hidden creature. */
  relation: 'enemy';
  /** A FindHiddenActor command reports a positive observation, not an attempt. */
  found: true;
}

export interface InitiativeSwapFacts extends ObservableFactProvenance {
  relation: 'ally';
  willing: true;
  /** Explicit consent must come from the ally controller represented in ActorState. */
  confirmedByControllerId: string;
}

export interface ActionTargeting {
  minTargets: number;
  maxTargets: number;
  rangeFt: number;
  requiresLineOfSight: boolean;
  /** Content-owned "a target you can see" requirement. This is distinct from
   * geometric line of sight: attacks may still target an unseen creature. */
  requiresSight?: boolean;
  allowedRelations: Relation[];
  /** Catalog-owned legality requirements, never client-declared outcomes. */
  requiresWilling?: boolean;
  requiresUnarmored?: boolean;
  /** Exact content declaration used by delivery/origin-changing rules. */
  requiresTouch?: true;
  /** Stonecunning: actor must stand on or touch natural/worked stone. */
  requiresStoneworkContact?: true;
}

interface RuleActionDefinitionBase {
  id: string;
  name: string;
  /**
   * Immutable content entities that granted/defined this capability.  This is
   * authoritative catalog metadata, never a fact supplied by a UseAction
   * command.  A non-empty tuple makes build provenance auditable in traces.
   */
  sourceEntityIds: readonly [string, ...string[]];
  mechanics: JsonObject;
  targeting?: ActionTargeting;
  concentration?: boolean;
  /**
   * Catalog-owned declaration that this action can replace one attack inside
   * the Attack action. `totalAttacks` is compiled for the actor/root release;
   * clients cannot increase the sequence budget in a command.
   */
  attackReplacement?: {
    replacementKey: string;
    replacesAttacks: 1;
    totalAttacks: number;
    oncePerAttackAction: true;
  };
  /** Catalog-owned policy resolved only at the declared rest boundary. */
  restDecision?: SlotRecoveryRestDecisionPolicy;
}

export type RuleActionDefinition =
  | (RuleActionDefinitionBase & {
    kind: 'nonSpell';
    spell?: never;
  })
  | (RuleActionDefinitionBase & {
    kind: 'spell';
    spell: {
      /** Canonical spell level: 0 for a cantrip, 1-9 for a levelled spell. */
      level: number;
      /** Stable class id used by class-scoped spell modifiers. */
      sourceClass?: string;
      /** Immutable Ritual tag copied from the spell entity. */
      ritual?: boolean;
      /** Immutable class spell-list identities copied from the spell entity. */
      classListIds?: readonly string[];
      /** Canonical V/S/M flags copied from the immutable spell entity. */
      components?: SpellComponents;
    };
  });

/** Catalog-owned non-creature source that forces a saving throw. */
export interface RuleHazardDefinition {
  id: string;
  name: string;
  sourceKind: 'environment' | 'system';
  sourceEntityIds: readonly [string, ...string[]];
  save: {
    ability: Ability;
    dc: number;
  };
  onFailure: JsonObject[];
  onSuccess?: JsonObject[];
  /** Catalog effects referenced by grant_effect consequences. The source actor
   * snapshots these so a monster target never needs to own the item/spell. */
  grantedEffects?: NonNullable<ActorState['grantedEffects']>;
}

export interface SavingThrowDecisionRequest {
  id: string;
  type: 'saving_throw';
  actorId: string;
  ability: Ability;
  /** When present the requested creature chooses one of these abilities. */
  abilityOptions?: Ability[];
  dc: number;
  avoidsConditions: string[];
}

export interface ShoveOutcomeDecisionRequest {
  id: string;
  type: 'shove_outcome';
  actorId: string;
  options: ShoveOutcome[];
}

export interface ReactionDecisionRequest {
  id: string;
  type: 'reaction';
  actorId: string;
  trigger:
    | {
      type: 'hit_by_attack';
      sourceActorId: string;
      actionId: string;
      attackTotal: number;
      originalAc: number;
    }
    | {
      type: 'targeted_by_magic_missile';
      sourceActorId: string;
      actionId: string;
      dartCount: number;
    }
    | {
      /** Damage is already rolled, but no HP mutation has been committed. */
      type: 'damage_taken';
      sourceActorId: string;
      actionId: string;
      amount: number;
      damageTypes: string[];
    }
    | {
      type: 'protection_before_attack';
      sourceActorId: string;
      targetActorId: string;
      actionId: string;
      attackId: string;
    };
  options: ReactionActionOption[];
}

/** One currently payable source for a spell reaction shown to the controller. */
export interface ReactionSpellSourceOption {
  grantId: string;
  sourceId: string;
  spellcastingAbility: Ability;
  payment: { kind: 'none' | 'free_use' | 'slot'; resource?: string };
}

export interface ReactionActionOption {
  actionId: string;
  label: string;
  /** Present only for actors using source-scoped spellcasting access. */
  spellSources?: ReactionSpellSourceOption[];
}

/**
 * Immutable per-creature area facts retained by a serial target-save action.
 * The board/GM remains authoritative for membership in the area; rules-core
 * only validates and replays the supplied snapshot in declaration order.
 */
export interface QueuedTargetSaveResolution {
  targetActorId: string;
  facts: SpatialFacts;
  save: {
    ability: Ability;
    dc: number;
    avoidsConditions: string[];
  };
}

export interface PendingTargetSaveResolution {
  id: string;
  type: 'target_save';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  facts: SpatialFacts;
  choices?: Record<string, string | string[]>;
  spell?: SpellCastContext;
  request: SavingThrowDecisionRequest;
  /** Remaining saves in the exact, deterministic declaration order. */
  remainingTargets?: QueuedTargetSaveResolution[];
  /** Audit/checkpoint data for already committed per-target consequences. */
  resolvedTargetIds?: string[];
  /** New concentration effects created on targets resolved before this one. */
  concentrationEffectLinks?: ConcentrationEffectLink[];
  /** Damage-triggered decisions are deferred until every area save resolves. */
  followUps?: PendingResolutionFollowUp[];
  /** Prevents spell-cast listeners/components from firing once per target. */
  spellCastEmitted?: boolean;
  /**
   * Authoritative die-aware tape for the action's one shared area-damage roll.
   * Every target replays it from offset zero; later targets may extend it only
   * when an earlier save branch did not roll that damage.
   */
  sharedDamageRolls?: Array<{ sides: number; value: number }>;
  /**
   * Exact Attack-action sequence that produced this save. Keeping it in the
   * continuation makes a checkpoint/reload independent of UI process memory.
   */
  attackSequence?: AttackSequenceState;
  /** Schema-v4 continuation joins the canonical ledger instead of copying it. */
  attackActionId?: string;
}

export interface PendingAttackReactionResolution {
  id: string;
  type: 'attack_reaction';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  facts: SpatialFacts;
  choices?: Record<string, string | string[]>;
  spell?: SpellCastContext;
  attackRoll: RollLog;
  request: ReactionDecisionRequest;
  attackActionId?: string;
  /** Exact weapon selection retained while Shield or another hit Reaction is pending. */
  weaponHand?: 'main' | 'off';
  weaponCardId?: string;
  pactBladeProjection?: PactBladeAttackContinuationProjection;
}

export interface PendingDamageReactionResolution {
  id: string;
  type: 'damage_reaction';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  /** Exact immutable action definition that produced the held continuation. */
  action: RuleActionDefinition;
  facts: SpatialFacts;
  request: ReactionDecisionRequest;
  /** State immediately before the exact incoming damage bundle is committed. */
  targetRuntimeBeforeDamage: RuntimeState;
  /** Fully simulated action result, held off-world until the decision resolves. */
  sourceRuntimeAfter: RuntimeState;
  targetRuntimeAfter: RuntimeState;
  /** Exact resistance-adjusted damage packets shown to the controller. */
  damage: Array<{
    amount: number;
    damageType: string;
    roll?: RollLog;
  }>;
  /** Replay-visible traces delayed with the HP mutation. */
  preDamageTargetEvents: EngineEvent[];
  attackEvents: EngineEvent[];
  retaliationEvents: EngineEvent[];
  retaliationSourceEntityIds: string[];
  obligationIds: string[];
  followUps: PendingResolutionFollowUp[];
  /** Attack-action ledger identity, when damage came from one attack entry. */
  attackActionId?: string;
}

export type ProtectionAttackContinuationKind =
  | 'catalog'
  | 'weapon_melee'
  | 'weapon_ranged'
  | 'unarmed_damage'
  | 'familiar_attack';

export interface ProtectionReactionCandidateFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  protectorActorId: string;
  protectorCanSeeAttacker: boolean;
  protectorDistanceToTargetFt: number;
}

export interface QueuedProtectionReaction {
  protectorActorId: string;
  facts: Protection2024ReactionFacts;
}

/** Durable pre-roll continuation; the attack has paid its activation cost but has not rolled. */
export interface PendingProtectionReactionResolution {
  id: string;
  type: 'protection_reaction';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  facts: SpatialFacts;
  choices?: Record<string, string | string[]>;
  spell?: SpellCastContext;
  attackActionId?: string;
  attackContinuationKind: ProtectionAttackContinuationKind;
  weaponHand?: 'main' | 'off';
  /** Exact immutable card selected before the attack was suspended. */
  weaponCardId?: string;
  pactBladeProjection?: PactBladeAttackContinuationProjection;
  preRollDisadvantageReasons: string[];
  protectionCandidates: ProtectionReactionCandidateFacts[];
  remainingReactions: QueuedProtectionReaction[];
  request: ReactionDecisionRequest;
}

export interface PendingUnarmedSaveResolution {
  id: string;
  type: 'unarmed_save';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  attackActionId: string;
  option: 'grapple' | 'shove';
  facts: SpatialFacts;
  /** Selected source part is persisted before the target can decide. */
  sourcePart?: string;
  request: SavingThrowDecisionRequest;
}

export interface PendingShoveOutcomeResolution {
  id: string;
  type: 'shove_outcome';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  attackActionId: string;
  facts: SpatialFacts;
  request: ShoveOutcomeDecisionRequest;
}

export interface PendingEscapeGrappleResolution {
  id: string;
  type: 'escape_grapple';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  actorId: string;
  grappleId: string;
  skill: 'athletics' | 'acrobatics';
  request: SavingThrowDecisionRequest;
}

export interface QueuedMagicMissileReaction {
  targetActorId: string;
  options: ReactionActionOption[];
}

export interface PendingMagicMissileReactionResolution {
  id: string;
  type: 'magic_missile_reaction';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  spell: SpellCastContext;
  /** One actor id per dart; duplicates are the canonical allocation. */
  dartTargetIds: string[];
  /** Unique targets and their declaration-time board/GM facts. */
  targets: Array<{ targetActorId: string; facts: SpatialFacts }>;
  protectedTargetIds: string[];
  remainingReactions: QueuedMagicMissileReaction[];
  request: ReactionDecisionRequest;
}

export interface PendingConcentrationSaveResolution {
  id: string;
  type: 'concentration_save';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  actorId: string;
  concentrationId: string;
  damage: number;
  request: SavingThrowDecisionRequest;
  followUps?: PendingResolutionFollowUp[];
}

export interface QueuedMasterySaveResolution {
  type: 'mastery_save';
  sourceActorId: string;
  targetActorId: string;
  actionId: string;
  mastery: {
    sourceEntityId: string;
    name: string;
    effect: JsonObject;
    weaponMod?: number;
  };
  save: {
    ability: Ability;
    dc: number;
    avoidsConditions: string[];
  };
}

export interface QueuedConcentrationSaveResolution {
  type: 'concentration_save';
  actorId: string;
  concentrationId: string;
  damage: number;
  dc: number;
  obligationIds: string[];
}

export type PendingResolutionFollowUp =
  | QueuedMasterySaveResolution
  | QueuedConcentrationSaveResolution;

export interface PendingMasterySaveResolution extends QueuedMasterySaveResolution {
  id: string;
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  request: SavingThrowDecisionRequest;
  followUps: PendingResolutionFollowUp[];
}

export interface PendingHazardSaveResolution {
  id: string;
  type: 'hazard_save';
  openedByCommandId: string;
  openedAtRevision: number;
  deadlineLogicalClock: number;
  targetActorId: string;
  /**
   * Canonical snapshot makes the continuation independent of mutable process
   * memory and therefore safe to JSON-persist and resume after a reload.
   */
  hazard: RuleHazardDefinition;
  request: SavingThrowDecisionRequest;
}

export type PendingResolution =
  | PendingTargetSaveResolution
  | PendingAttackReactionResolution
  | PendingDamageReactionResolution
  | PendingProtectionReactionResolution
  | PendingUnarmedSaveResolution
  | PendingShoveOutcomeResolution
  | PendingEscapeGrappleResolution
  | PendingMagicMissileReactionResolution
  | PendingConcentrationSaveResolution
  | PendingMasterySaveResolution
  | PendingHazardSaveResolution;

export interface RulesCatalog {
  getAction(id: string): RuleActionDefinition | undefined;
  /** Optional enumeration used by catalog-owned rest-decision policies. */
  listActions?(): readonly RuleActionDefinition[];
  getHazard?(id: string): RuleHazardDefinition | undefined;
  /** Immutable item content; optional catalogs fail closed for item-instance rules. */
  getCard?(id: string): Card | undefined;
}

interface CommandBase {
  schemaVersion: 1;
  commandId: string;
  expectedRevision: number;
  rulesetContentHash: string;
  actorId: string;
}

export interface StartEncounterCommand extends CommandBase {
  type: 'StartEncounter';
  initiative: string[];
}

export interface StartTurnCommand extends CommandBase {
  type: 'StartTurn';
  /** Optional data-owned start-of-turn capability choices; omission declines them. */
  turnStartChoices?: Array<{ capabilityId: string; targetActorId: string }>;
}

export interface EndTurnCommand extends CommandBase {
  type: 'EndTurn';
}

export type ActionWorldInput =
  | { type: 'target_object'; objectId: string; facts: WorldObjectFacts }
  | { type: 'area_objects'; factsByObject: Record<string, WorldObjectFacts> }
  | {
    type: 'minor_illusion';
    form: 'sound' | 'image';
    description: string;
    imageCubeSideFt?: number;
    facts: WorldObjectFacts;
  }
  | {
    type: 'dancing_lights';
    form: 'individual' | 'medium_humanoid';
    placements: Array<{
      distanceFromCasterFt: number;
      withinRequiredSeparation?: boolean;
    }>;
    facts: WorldObjectFacts;
  }
  | {
    type: 'druidcraft';
    option:
      | { kind: 'weather_sensor'; prediction: string; facts: WorldObjectFacts }
      | { kind: 'bloom'; objectId: string; facts: WorldObjectFacts }
      | {
        kind: 'sensory_effect'; description: string; cubeSideFt: number; facts: WorldObjectFacts;
      }
      | {
        kind: 'fire_play'; objectId: string; operation: 'light' | 'snuff'; facts: WorldObjectFacts;
      };
  }
  | { type: 'mending'; objectId: string; facts: WorldObjectFacts }
  | {
    type: 'prestidigitation';
    option:
      | { kind: 'sensory_effect'; description: string; facts: WorldObjectFacts }
      | {
        kind: 'fire_play'; objectId: string; operation: 'light' | 'snuff'; facts: WorldObjectFacts;
      }
      | {
        kind: 'clean_or_soil'; objectId: string; operation: 'clean' | 'soil'; facts: WorldObjectFacts;
      }
      | {
        kind: 'minor_sensation' | 'magic_mark'; objectId: string; description: string;
        facts: WorldObjectFacts; replaceEffectId?: string;
      }
      | {
        kind: 'minor_creation'; description: string; size: WorldObjectSize; fitsInHand: boolean;
        facts: WorldObjectFacts; replaceEffectId?: string;
      };
  }
  | {
    type: 'purify_food_drink';
    sphereCenterDistanceFt: number;
    factsByObject: Record<string, WorldObjectFacts>;
  };

export interface FamiliarObservableFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  distanceFt: number;
  lineOfSight: boolean;
}

export interface ProtectionAttackWindowInput {
  /** One authoritative geometry/visibility observation per Protection owner in the world. */
  protectionCandidates?: ProtectionReactionCandidateFacts[];
}

export interface UseActionCommand extends CommandBase, ProtectionAttackWindowInput {
  type: 'UseAction';
  actionId: string;
  targetIds: string[];
  factsByTarget?: Record<string, SpatialFacts>;
  choices?: Record<string, string | string[]>;
  /** Client declaration is validated and replaced with canonical catalog data. */
  spell?: {
    baseLevel: number;
    castLevel?: number;
    sourceClass?: string;
    /** Required when several immutable grants can execute the same action. */
    grantId?: string;
    mode?: SpellCastMode;
    /** False preserves a free use and deliberately pays a legal slot. */
    preferFreeUse?: boolean;
    /** Optional physical focus; rules core resolves its authority from WorldState. */
    focusObjectId?: string;
    focusHand?: 'main_hand' | 'off_hand';
  };
  /**
   * Observable object facts and player choices. The action's immutable
   * catalog primitive determines the operation; this input can never request
   * an arbitrary state patch.
   */
  worldInput?: ActionWorldInput;
}

/**
 * Executes a data-driven reaction whose observable trigger is owned by an
 * adapter (for example a tactical board observing a reach exit).  The catalog
 * must declare the same trigger and reaction activation/cost; the caller cannot
 * turn an ordinary action into an off-turn action.
 */
export type UseReactionActionCommand = Omit<UseActionCommand, 'type'> & {
  type: 'UseReactionAction';
  trigger: 'opportunity_attack';
};

/**
 * Takes the Attack action and replaces one of its compiled attacks with the
 * named catalog capability. The command supplies targets/facts only; sequence
 * size and replacement policy remain authoritative catalog data.
 */
export interface UseAttackReplacementCommand extends CommandBase {
  type: 'UseAttackReplacement';
  actionId: string;
  targetIds: string[];
  factsByTarget?: Record<string, SpatialFacts>;
  choices?: Record<string, string | string[]>;
}

/** Ruleset-owned Attack action.  The client cannot provide its attack count. */
export interface BeginAttackActionCommand extends CommandBase {
  type: 'BeginAttackAction';
  /** Optional for legacy/system callers; required by the real-sheet weapon bridge. */
  declaredActionId?: string;
}

export interface PerformWeaponAttackCommand extends CommandBase, ProtectionAttackWindowInput {
  type: 'PerformWeaponAttack';
  attackActionId: string;
  /** Exact immutable entry action whose mechanics authorize contextual costs. */
  declaredActionId?: string;
  weaponCardId: string;
  /** Concrete item instance; required together with pactBlade. */
  weaponObjectId?: string;
  pactBlade?: {
    abilityChoice: 'str' | 'dex' | 'cha';
    damageType: 'normal' | 'necrotic' | 'psychic' | 'radiant';
  };
  targetActorId: string;
  facts: SpatialFacts;
  /** In-play choices declared by data-driven weapon rules (for example Push distance). */
  choices?: Record<string, string | string[]>;
}

export interface PactBladeAttackContinuationProjection {
  weaponObjectId: string;
  weaponCardId: string;
  weaponHand: 'main' | 'off';
  abilityChoice: 'str' | 'dex' | 'cha';
  attackAbility: Ability;
  damageAbility: Ability;
  damageChoice: 'normal' | 'necrotic' | 'psychic' | 'radiant';
  resolvedDamageType: string;
}

/**
 * The Bonus Action attack granted by the 2024 Light property. The client names
 * only the completed Attack action, selected Card, target, and observed board
 * facts; qualification is rebuilt from the immutable Card/equipment/ledger.
 */
export interface PerformLightWeaponExtraAttackCommand
  extends CommandBase, ProtectionAttackWindowInput {
  type: 'PerformLightWeaponExtraAttack';
  attackActionId: string;
  /** Exact immutable Light-extra-attack action; never a client-authored cost. */
  declaredActionId?: string;
  weaponCardId: string;
  targetActorId: string;
  facts: SpatialFacts;
  /** In-play choices declared by the selected weapon mastery. */
  choices?: Record<string, string | string[]>;
}

/** Consume the typed Cleave opportunity produced by a prior melee hit. */
export interface PerformWeaponMasteryCleaveAttackCommand
  extends CommandBase, ProtectionAttackWindowInput {
  type: 'PerformWeaponMasteryCleaveAttack';
  attackActionId: string;
  weaponCardId: string;
  targetActorId: string;
  facts: SpatialFacts;
  /** Explicit board/GM fact: secondary creature is within this distance of primary. */
  secondaryDistanceFromPrimaryFt: number;
}

export interface PerformUnarmedStrikeCommand extends CommandBase, ProtectionAttackWindowInput {
  type: 'PerformUnarmedStrike';
  attackActionId: string;
  option: UnarmedStrikeOption;
  targetActorId: string;
  facts: SpatialFacts;
}

export interface ForfeitAttackActionCommand extends CommandBase {
  type: 'ForfeitAttackAction';
  attackActionId: string;
}

export interface EscapeGrappleCommand extends CommandBase {
  type: 'EscapeGrapple';
  grappleId: string;
  skill: 'athletics' | 'acrobatics';
}

export interface ReleaseGrappleCommand extends CommandBase {
  type: 'ReleaseGrapple';
  grappleId: string;
}

/** Board/GM fact that the two creatures are now outside the persisted reach. */
export interface BreakGrappleRangeCommand extends CommandBase {
  type: 'BreakGrappleRange';
  grappleId: string;
  facts: SpatialFacts;
}

export interface AbilityCheckCommand extends CommandBase {
  type: 'AbilityCheck';
  ability: Ability;
  skill?: string;
  dc?: number;
}

export interface AttemptHideCommand extends CommandBase {
  type: 'AttemptHide';
  eligibility: HideEligibilityFacts;
}

/** Records an observable sound made by the actor; only above-whisper sound ends Hide. */
export interface MakeNoiseCommand extends CommandBase {
  type: 'MakeNoise';
  facts: NoiseFacts;
}

/** Records that the command actor, as an enemy, found the hidden target. */
export interface FindHiddenActorCommand extends CommandBase {
  type: 'FindHiddenActor';
  targetActorId: string;
  facts: EnemyFindingFacts;
}

/** Alert's immediate post-Initiative exchange with one consenting ally. */
export interface SwapInitiativeCommand extends CommandBase {
  type: 'SwapInitiative';
  allyActorId: string;
  facts: InitiativeSwapFacts;
}

export interface TriggerHazardCommand extends CommandBase {
  type: 'TriggerHazard';
  hazardId: string;
  /** The affected actor also owns the resulting saving-throw decision. */
  targetActorId: string;
}

export interface SavingThrowCommand extends CommandBase {
  type: 'SavingThrow';
  ability: Ability;
  dc: number;
}

/** The Study action examines one persisted illusion using INT (Investigation). */
export interface StudyWorldObjectCommand extends CommandBase {
  type: 'StudyWorldObject';
  objectId: string;
  facts: WorldObjectFacts;
}

/** Physical interaction reveals an image illusion only to the interacting actor. */
export interface PhysicallyInteractWorldObjectCommand extends CommandBase {
  type: 'PhysicallyInteractWorldObject';
  objectId: string;
  facts: WorldObjectFacts;
}

/** Detect Magic's follow-up Magic action while its exact concentration is active. */
export interface RevealMagicAuraCommand extends CommandBase {
  type: 'RevealMagicAura';
  concentrationId: string;
  observations: Record<string, {
    facts: WorldObjectFacts;
    blockingLayers: MagicBlockingLayer[];
  }>;
}

/** Dancing Lights' source-owned Bonus Action move while its exact concentration is active. */
export interface MoveDancingLightsCommand extends CommandBase {
  type: 'MoveDancingLights';
  concentrationId: string;
  groupId: string;
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  resultingFacts: Array<{
    lightId: string;
    movementFt: number;
    distanceFromCasterFt: number;
    withinRequiredSeparation?: boolean;
  }>;
}

/** Replay-visible sensing supplied by the board while the exact spell concentration is active. */
export interface ObservePoisonDiseaseCommand extends CommandBase {
  type: 'ObservePoisonDisease';
  concentrationId: string;
  observations: Record<string, {
    facts: WorldObjectFacts;
    blockingLayers: MagicBlockingLayer[];
  }>;
}

/**
 * Canonical exploration-time path for donning body armor. The command names
 * only an actor-owned Card; rules-core derives slots and effect expirations.
 */
export interface DonArmorCommand extends CommandBase {
  type: 'DonArmor';
  armorCardId: string;
}

/** Owner Bonus Action: perceive through a present familiar within 100 feet. */
export interface UseFamiliarSharedSensesCommand extends CommandBase {
  type: 'UseFamiliarSharedSenses';
  familiarActorId: string;
  facts: FamiliarObservableFacts;
}

/** Owner Magic Action: temporarily or permanently dismiss its familiar. */
export interface DismissFamiliarCommand extends CommandBase {
  type: 'DismissFamiliar';
  familiarActorId: string;
  mode: 'temporary' | 'forever';
}

/** Owner Magic Action: return a temporarily dismissed familiar within 30 feet. */
export interface ReappearFamiliarCommand extends CommandBase {
  type: 'ReappearFamiliar';
  familiarActorId: string;
  facts: FamiliarObservableFacts & { unoccupiedSpace: boolean };
}

/**
 * Cast one actor-owned Touch spell while a present familiar spends its
 * Reaction to become the delivery origin.
 */
export interface DeliverTouchSpellThroughFamiliarCommand
  extends CommandBase, ProtectionAttackWindowInput {
  type: 'DeliverTouchSpellThroughFamiliar';
  familiarActorId: string;
  spellActionId: string;
  targetActorId: string;
  ownerToFamiliarFacts: FamiliarObservableFacts;
  familiarToTargetFacts: SpatialFacts;
  spell?: UseActionCommand['spell'];
  choices?: Record<string, string | string[]>;
}

/** Pact Chain: replace one owner attack and spend the familiar's Reaction. */
export interface PerformPactChainFamiliarAttackCommand extends CommandBase, ProtectionAttackWindowInput {
  type: 'PerformPactChainFamiliarAttack';
  attackActionId: string;
  familiarActorId: string;
  familiarActionId: string;
  targetActorId: string;
  facts: SpatialFacts;
}

export type BondPactBladeCommand = CommandBase & {
  type: 'BondPactBlade';
} & (
  | {
    mode: 'conjure';
    weaponCardId: string;
    hand: 'main_hand' | 'off_hand';
  }
  | {
    mode: 'touch_existing';
    weaponObjectId: string;
    facts: WorldObjectFacts;
  }
);

export interface ObservePactBladeDistanceCommand extends CommandBase {
  type: 'ObservePactBladeDistance';
  weaponObjectId: string;
  facts: {
    factsSource: 'scenario' | 'board' | 'gm_ruling';
    boardRevision: number;
    distanceFt: number;
    elapsedSeconds: number;
  };
}

export interface AdjudicateActorDeathCommand extends CommandBase {
  type: 'AdjudicateActorDeath';
  adjudication: ActorDeathAdjudicatedEvent;
}

/** Board/GM observation that can irreversibly end one active Protection effect. */
export interface ObserveProtectionProximityCommand extends CommandBase {
  type: 'ObserveProtectionProximity';
  protectorActorId: string;
  protectedTargetActorId: string;
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  distanceFt: number;
}

export interface TakeShortRestCommand extends CommandBase {
  type: 'TakeShortRest';
  /** Optional feature decisions resolved atomically at the end of this rest. */
  decisions?: RestDecisionSelection[];
  /** Explicit identities only; the handler derives all spell eligibility from the catalog. */
  pactTome?: PactTomeRestSelection;
}

export interface TakeLongRestCommand extends CommandBase {
  type: 'TakeLongRest';
  /** Explicit elapsed time; omitted legacy commands represent a full eight-hour rest. */
  durationHours?: number;
  /** Explicit identities only; the handler derives all spell eligibility from the catalog. */
  pactTome?: PactTomeRestSelection;
}

export type DecisionRoll =
  | { mode: 'system' }
  | { mode: 'manual'; dice: Array<{ sides: number; value: number }> };

export type DecisionResponse =
  | { kind: 'roll'; roll: DecisionRoll; selectedAbility?: Ability; boonEffectId?: string }
  | { kind: 'voluntary_fail'; selectedAbility?: Ability }
  | { kind: 'shove_outcome'; outcome: ShoveOutcome }
  | {
    kind: 'reaction';
    actionId: string | null;
    /** Source selection is required when the action has several owned grants. */
    spell?: {
      grantId?: string;
      mode?: SpellCastMode;
      /** False deliberately preserves a free use and pays a legal slot. */
      preferFreeUse?: boolean;
    };
  };

export interface ResolveDecisionCommand extends CommandBase {
  type: 'ResolveDecision';
  resolutionId: string;
  requestId: string;
  response: DecisionResponse;
}

export interface ArmBoonCommand extends CommandBase {
  type: 'ArmBoon';
  effectId: string;
  rollKind: 'attack_roll' | 'saving_throw' | 'ability_check';
  timing: 'before_roll' | 'after_failure';
}

export type GameCommand =
  | StartEncounterCommand
  | StartTurnCommand
  | EndTurnCommand
  | UseActionCommand
  | UseReactionActionCommand
  | UseAttackReplacementCommand
  | BeginAttackActionCommand
  | PerformWeaponAttackCommand
  | PerformLightWeaponExtraAttackCommand
  | PerformWeaponMasteryCleaveAttackCommand
  | PerformUnarmedStrikeCommand
  | ForfeitAttackActionCommand
  | EscapeGrappleCommand
  | ReleaseGrappleCommand
  | BreakGrappleRangeCommand
  | AbilityCheckCommand
  | AttemptHideCommand
  | MakeNoiseCommand
  | FindHiddenActorCommand
  | SwapInitiativeCommand
  | TriggerHazardCommand
  | SavingThrowCommand
  | StudyWorldObjectCommand
  | PhysicallyInteractWorldObjectCommand
  | RevealMagicAuraCommand
  | MoveDancingLightsCommand
  | ObservePoisonDiseaseCommand
  | DonArmorCommand
  | UseFamiliarSharedSensesCommand
  | DismissFamiliarCommand
  | ReappearFamiliarCommand
  | DeliverTouchSpellThroughFamiliarCommand
  | PerformPactChainFamiliarAttackCommand
  | BondPactBladeCommand
  | ObservePactBladeDistanceCommand
  | AdjudicateActorDeathCommand
  | ObserveProtectionProximityCommand
  | TakeShortRestCommand
  | TakeLongRestCommand
  | ResolveDecisionCommand
  | ArmBoonCommand;

export interface ActorRuntimePatch {
  hp?: RuntimeState['hp'];
  resources?: RuntimeState['resources'];
  maxResources?: RuntimeState['maxResources'];
  equipment?: RuntimeState['equipment'];
  inventory?: RuntimeState['inventory'];
  activeEffects?: RuntimeState['activeEffects'];
  firedThisTurn?: string[] | null;
  firedThisRest?: string[] | null;
}

export interface ActorRuntimePatchedEvent {
  type: 'ActorRuntimePatched';
  actorId: string;
  patch: ActorRuntimePatch;
  reason: 'start_turn' | 'end_turn' | 'action' | 'ability_check' | 'hazard' | 'short_rest' | 'long_rest' | 'boon';
}

/**
 * Replay-safe result of a validated DonArmor command. `equipment` is the
 * canonical post-command slot snapshot; ended effects cannot become dormant
 * and reappear after the armor is removed later.
 */
export interface EquipmentChangedEvent {
  type: 'EquipmentChanged';
  actorId: string;
  operation: 'don_armor';
  cardId: string;
  equipment: RuntimeState['equipment'];
  endedEffectIds: string[];
}

export interface SceneSetEvent {
  type: 'SceneSet';
  scene: SceneState;
}

export interface EngineEventRecordedEvent {
  type: 'EngineEventRecorded';
  actorId: string;
  targetIds: string[];
  event: EngineEvent;
  /** Auditable explicit facts that caused this engine event. */
  facts?: JsonObject;
}

/**
 * Authoritative action trace.  Scenario tests derive spell/non-spell evidence
 * from this event instead of trusting a label in the scenario or browser.
 */
export interface ActionDeclaredEvent {
  type: 'ActionDeclared';
  actorId: string;
  actionId: string;
  actionKind: RuleActionDefinition['kind'];
  sourceEntityIds: string[];
  targetIds: string[];
  timing: 'active' | 'reaction';
  /** Auditable board/GM facts used by a built-in action such as Hide. */
  facts?: JsonObject;
  spell?: {
    baseLevel: number;
    castLevel: number;
    sourceClass?: string;
    components?: SpellComponents;
    grantId?: string;
    sourceId?: string;
    spellcastingAbility?: Ability;
    mode?: SpellCastMode;
    payment?: { kind: 'none' | 'free_use' | 'slot'; resource?: string };
    /** Ritual casting adds exactly ten minutes and spends no slot. */
    castingTimeAddedSeconds?: number;
    /** Base casting duration declared by mechanics.activation.cast_time. */
    baseCastingTimeSeconds?: number;
    /** Physical focus proving a source-owned Pact Tome cast. */
    focusObjectId?: string;
    /** Exact hand for a held item focus such as Pact of the Blade. */
    focusHand?: 'main_hand' | 'off_hand';
  };
}

export interface CommandCommittedEvent {
  type: 'CommandCommitted';
  commandId: string;
  revision: number;
  logicalClock: number;
}

export interface ResolutionOpenedEvent {
  type: 'ResolutionOpened';
  resolution: PendingResolution;
}

export interface ResolutionClosedEvent {
  type: 'ResolutionClosed';
  resolutionId: string;
}

export interface DecisionRecordedEvent {
  type: 'DecisionRecorded';
  resolutionId: string;
  requestId: string;
  actorId: string;
  response: DecisionResponse;
}

export interface AttackActionStartedEvent {
  type: 'AttackActionStarted';
  attackAction: AttackActionState;
}

export interface AttackEntryCommittedEvent {
  type: 'AttackEntryCommitted';
  attackActionId: string;
  entry: AttackSequenceEntry;
}

export interface AttackActionBlockedEvent {
  type: 'AttackActionBlocked';
  attackActionId: string;
  resolutionId: string;
}

export interface AttackActionUnblockedEvent {
  type: 'AttackActionUnblocked';
  attackActionId: string;
  resolutionId: string;
}

export interface AttackActionClosedEvent {
  type: 'AttackActionClosed';
  attackActionId: string;
  reason: 'completed' | 'forfeited';
}

export interface GrappleAppliedEvent {
  type: 'GrappleApplied';
  grapple: GrappleState;
}

export interface GrappleEndedEvent {
  type: 'GrappleEnded';
  grappleId: string;
  reason: 'escaped' | 'released' | 'grappler_incapacitated' | 'distance_exceeds_range';
}

export interface ShoveAppliedEvent {
  type: 'ShoveApplied';
  effectId: string;
  sourceActorId: string;
  targetActorId: string;
  outcome: ShoveOutcome;
  facts: SpatialFacts;
}

export interface ConcentrationSetEvent {
  type: 'ConcentrationSet';
  concentration: ConcentrationState;
}

export interface ConcentrationClearedEvent {
  type: 'ConcentrationCleared';
  sourceActorId: string;
  concentrationId: string;
  reason: 'replaced' | 'failed_save' | 'incapacitated' | 'effect_consumed' | 'manual';
}

/** A validated domain mutation embedded in the canonical world event stream. */
export interface WorldObjectMutationRecordedEvent {
  type: 'WorldObjectMutationRecorded';
  event: WorldObjectMutationEvent;
}

/** Create or transform the owner's single familiar actor atomically. */
export interface FamiliarActorUpsertedEvent {
  type: 'FamiliarActorUpserted';
  ownerActorId: string;
  actor: ActorState;
  casting: {
    actionId: string;
    method: 'spell_slot' | 'ritual' | 'pact_chain_magic_action';
    consumedIncenseGp: number;
    created: boolean;
    changedForm: boolean;
  };
}

/** Replayable lifecycle/reaction/senses mutation of an existing familiar. */
export interface FamiliarStateChangedEvent {
  type: 'FamiliarStateChanged';
  ownerActorId: string;
  familiarActorId: string;
  familiar: FamiliarState;
  /** Equipment left in the familiar's former space when it disappears. */
  droppedItemIds?: string[];
  reason:
    | 'initiative_rolled'
    | 'turn_started'
    | 'shared_senses_started'
    | 'shared_senses_ended'
    | 'touch_spell_delivered'
    | 'chain_attack_reaction'
    | 'temporary_dismissal'
    | 'reappeared'
    | 'zero_hp';
}

/** Permanent dismissal removes the actor and clears its owner projection. */
export interface FamiliarActorRemovedEvent {
  type: 'FamiliarActorRemoved';
  ownerActorId: string;
  familiarActorId: string;
  reason: 'forever_dismissal';
  droppedItemIds: string[];
}

/** Atomic Protection Reaction spend plus persistent source-owned effect. */
export interface ProtectionEffectActivatedEvent {
  type: 'ProtectionEffectActivated';
  effect: Protection2024Effect;
  facts: Protection2024ReactionFacts;
}

/** Replayable terminal lifecycle fact; an ended Protection effect cannot return. */
export interface ProtectionEffectEndedEvent {
  type: 'ProtectionEffectEnded';
  protectorActorId: string;
  protectedTargetActorId: string;
  effectId: string;
  reason: 'protector_turn_started' | 'proximity_broken';
  lifecycleEvent: Protection2024LifecycleEvent;
}

export type RuleEventPayload =
  | ActorRuntimePatchedEvent
  | ActorDeathAdjudicatedEvent
  | EquipmentChangedEvent
  | SceneSetEvent
  | ActionDeclaredEvent
  | EngineEventRecordedEvent
  | ResolutionOpenedEvent
  | DecisionRecordedEvent
  | AttackActionStartedEvent
  | AttackEntryCommittedEvent
  | AttackActionBlockedEvent
  | AttackActionUnblockedEvent
  | AttackActionClosedEvent
  | GrappleAppliedEvent
  | GrappleEndedEvent
  | ShoveAppliedEvent
  | ConcentrationSetEvent
  | ConcentrationClearedEvent
  | WorldObjectMutationRecordedEvent
  | FamiliarActorUpsertedEvent
  | FamiliarStateChangedEvent
  | FamiliarActorRemovedEvent
  | ProtectionEffectActivatedEvent
  | ProtectionEffectEndedEvent
  | PactTomeRestCompletedEvent
  | PactTomeOwnerDiedEvent
  | PactBladeWorldBondedEvent
  | PactBladeAttackProjectedEvent
  | PactBladeWorldDistanceAdvancedEvent
  | PactBladeWorldEndedOnOwnerDeathEvent
  | PactBladeMaterialFocusProjection
  | ResolutionClosedEvent
  | CommandCommittedEvent;

export interface UncommittedRuleEvent {
  ordinal: number;
  sourceActorId: string;
  obligationIds: string[];
  payload: RuleEventPayload;
}

export interface DeterministicEnvironment {
  rng: () => number;
  clock: () => number;
  nextId: () => string;
}

export type CommandRejectionCode =
  | 'ActorNotFound'
  | 'ActorDead'
  | 'WorldObjectNotFound'
  | 'CardNotFound'
  | 'ItemNotOwned'
  | 'NotArmor'
  | 'ActionNotGranted'
  | 'FeatureNotGranted'
  | 'ActionNotFound'
  | 'InvalidActionDefinition'
  | 'HazardNotFound'
  | 'InvalidHazardDefinition'
  | 'HideNotEligible'
  | 'InvalidFacts'
  | 'CapabilityDenied'
  | 'InvalidSpellDeclaration'
  | 'DuplicateCommand'
  | 'InsufficientResources'
  | 'InvalidDecision'
  | 'InvalidCommandId'
  | 'InvalidActionTiming'
  | 'InvalidInitiative'
  | 'InvalidTargets'
  | 'TargetNotWilling'
  | 'TargetArmored'
  | 'InvalidEquipmentState'
  | 'AttackActionNotFound'
  | 'AttackActionClosed'
  | 'AttackActionBlocked'
  | 'WeaponNotEquipped'
  | 'NotWeapon'
  | 'GrappleNotFound'
  | 'NoFreeGraspingPart'
  | 'TargetTooLarge'
  | 'MissingSpatialFacts'
  | 'OutOfRange'
  | 'LineOfSightBlocked'
  | 'IllegalRelation'
  | 'NotActorsTurn'
  | 'NoPendingResolution'
  | 'ResolutionInProgress'
  | 'StaleDecision'
  | 'TurnAlreadyStarted'
  | 'TurnNotStarted'
  | 'RulesetMismatch'
  | 'StaleRevision';

export interface AcceptedCommand {
  status: 'accepted';
  events: UncommittedRuleEvent[];
  nextState: WorldState;
}

export interface RejectedCommand {
  status: 'rejected';
  code: CommandRejectionCode;
  message: string;
  state: WorldState;
}

export type CommandResult = AcceptedCommand | RejectedCommand;

export function defaultAttackProfile(actor: Pick<ActorState, 'character'>): ActorAttackProfile {
  return {
    attacksPerAction: 1,
    size: actor.character.baseSize ?? 2,
    reachFt: 5,
    graspingParts: ['main_hand', 'off_hand'],
    sourceEntityIds: ['system:dnd5e-2024:attack-action'],
  };
}

export function createWorld(input: {
  id: string;
  ruleset: RulesetReference;
  actors: ActorState[];
  objects?: WorldObjectState[];
}): WorldState {
  const actors = Object.fromEntries(input.actors.map((actor) => [actor.id, {
    ...actor,
    lifecycle: actor.lifecycle ?? { status: 'alive' },
    attackProfile: actor.attackProfile ?? defaultAttackProfile(actor),
  }]));
  if (Object.keys(actors).length !== input.actors.length) {
    throw new Error('Actor IDs must be unique');
  }
  const objectList = input.objects ?? [];
  const objects = Object.fromEntries(objectList.map((object) => [object.id, object]));
  if (Object.keys(objects).length !== objectList.length) {
    throw new Error('World object IDs must be unique');
  }
  return {
    schemaVersion: 5,
    id: input.id,
    ruleset: input.ruleset,
    revision: 0,
    logicalClock: 0,
    actors,
    objects,
    scene: { mode: 'exploration' },
    processedCommandIds: [],
    pendingResolution: null,
    concentrations: {},
    attackActions: {},
    grapples: {},
  };
}
