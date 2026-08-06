import type { Card } from '../types';
import { parseWeaponProfile } from './weaponProfile';
import { canonicalStringify } from './determinism';
import type { Ability, ActorDeathAdjudicatedEvent } from './domain';
import {
  PACT_BLADE_DAMAGE_TYPES,
  PACT_BLADE_STATE_CAPABILITY,
  createPactBladeBond,
  createPactBladeInvocationState,
  pactBladeAttackProjection,
  advancePactBladeDistance,
  pactBladeLifecyclePolicyIssue,
  type PactBladeAttackProjection,
  type PactBladeBondState,
  type PactBladeDamageChoice,
  type PactBladeInvocationState,
  type PactBladeLifecyclePolicy,
} from './warlockPacts';
import type { WorldObjectState } from './worldObjects';

export const PACT_BLADE_RUNTIME_SCHEMA_VERSION = 1 as const;
export const PACT_BLADE_CATALOG_PROVENANCE = 'immutable_rules_catalog' as const;
export const PACT_BLADE_WORLD_PROVENANCE = 'canonical_world_state' as const;
export const PACT_BLADE_TURN_PROVENANCE = 'canonical_turn_state' as const;

export interface PactBladeCatalogAuthority {
  provenance: typeof PACT_BLADE_CATALOG_PROVENANCE;
  rulesetContentHash: string;
  cards: Card[];
}

/**
 * The canonical item-instance bridge. Eligibility is never accepted here as
 * caller-provided `melee`, `category`, or `magical` booleans: those facts are
 * derived from the immutable Card and the WorldObject below.
 */
export interface PactBladeWeaponObjectAuthority {
  object: WorldObjectState;
  weaponCardId: string;
  touchedByActorIds: string[];
  attunedToActorId?: string;
  bondedWarlockActorId?: string;
}

export interface PactBladeWorldAuthority {
  provenance: typeof PACT_BLADE_WORLD_PROVENANCE;
  rulesetContentHash: string;
  worldRevision: number;
  weaponObjects: PactBladeWeaponObjectAuthority[];
}

export interface PactBladeTurnAuthority {
  provenance: typeof PACT_BLADE_TURN_PROVENANCE;
  turnRevision: number;
  turnId: string;
  activeActorId: string;
  bonusActionsRemaining: number;
}

export interface PactBladeDistanceAuthority {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  actorId: string;
  weaponObjectId: string;
  distanceFt: number;
  elapsedSeconds: number;
}

/**
 * Death is an explicit actor-lifecycle observation. Hit Points reaching 0 is
 * intentionally not accepted as proof: a player character can instead be
 * Unconscious and making Death Saving Throws.
 */
export type PactBladeOwnerDeathAuthority = ActorDeathAdjudicatedEvent;

export interface PactBladeImmutableWeaponCardSnapshot {
  id: string;
  cardNumber: string;
  name: string;
  weaponType: string;
  category: 'simple' | 'martial';
  range: 'melee' | 'ranged';
  normalDamageType: string;
  properties: string[];
  tags: string[];
  enchantBonus: number | null;
  requiresAttunement: boolean;
}

export interface ActivePactBladeRuntimeState {
  invocation: PactBladeInvocationState;
  weaponCardId: string;
  weaponCard: PactBladeImmutableWeaponCardSnapshot;
  weaponObject: WorldObjectState;
  boundAtRulesetContentHash: string;
  lastBoardRevision: number | null;
}

export interface PactBladeRuntimeAuthority {
  capabilityId: typeof PACT_BLADE_STATE_CAPABILITY;
  ownerActorId: string;
  sourceEntityId: string;
  bondActionId: string;
  capabilitySourceEntityIds: string[];
  rulesetContentHash: string;
  lifecyclePolicy: PactBladeLifecyclePolicy;
}

export interface PactBladeRuntimeState {
  schemaVersion: typeof PACT_BLADE_RUNTIME_SCHEMA_VERSION;
  revision: number;
  observedWorldRevision: number;
  authority: PactBladeRuntimeAuthority;
  activeBlade: ActivePactBladeRuntimeState | null;
}

interface PactBladeCommandBase {
  schemaVersion: typeof PACT_BLADE_RUNTIME_SCHEMA_VERSION;
  commandId: string;
  expectedRevision: number;
  rulesetContentHash: string;
  actorId: string;
  sourceEntityId: string;
}

export interface PactBladeRuntimeBondCommand extends PactBladeCommandBase {
  type: 'BondPactBlade';
  mode: 'conjure' | 'touch_existing';
  weaponCardId: string;
  weaponObjectId: string;
  catalog: PactBladeCatalogAuthority;
  world: PactBladeWorldAuthority;
  turn: PactBladeTurnAuthority;
}

export interface ProjectPactBladeAttackCommand extends PactBladeCommandBase {
  type: 'ProjectPactBladeAttack';
  weaponCardId: string;
  weaponObjectId: string;
  abilityChoice: 'ordinary' | 'charisma';
  ordinaryAbility: 'str' | 'dex';
  damageType: PactBladeDamageChoice;
  catalog: PactBladeCatalogAuthority;
  world: PactBladeWorldAuthority;
}

export interface AdvancePactBladeDistanceCommand extends PactBladeCommandBase {
  type: 'AdvancePactBladeDistance';
  world: PactBladeWorldAuthority;
  facts: PactBladeDistanceAuthority;
}

export interface EndPactBladeOnOwnerDeathCommand extends PactBladeCommandBase {
  type: 'EndPactBladeOnOwnerDeath';
  world: PactBladeWorldAuthority;
  deathFact: PactBladeOwnerDeathAuthority;
}

export type PactBladeRuntimeCommand =
  | PactBladeRuntimeBondCommand
  | ProjectPactBladeAttackCommand
  | AdvancePactBladeDistanceCommand
  | EndPactBladeOnOwnerDeathCommand;

interface PactBladeEventBase {
  schemaVersion: typeof PACT_BLADE_RUNTIME_SCHEMA_VERSION;
  commandId: string;
  revision: number;
  actorId: string;
  sourceEntityId: string;
  rulesetContentHash: string;
  worldRevision: number;
}

export interface PactBladeBondedEvent extends PactBladeEventBase {
  type: 'PactBladeBonded';
  turnId: string;
  turnRevision: number;
  actionCost: { kind: 'bonus_action'; amount: 1 };
  activeBlade: ActivePactBladeRuntimeState;
  endedPreviousBond?: PactBladeBondState;
  removedWorldObjectIds: string[];
  upsertWorldObjects: WorldObjectState[];
  removedWeaponBridgeObjectIds: string[];
  upsertWeaponBridges: Array<{ weaponObjectId: string; weaponCardId: string }>;
  clearPactBondObjectIds: string[];
  setPactBondObjectId: string;
}

export interface PactBladeAttackProjectedEvent extends PactBladeEventBase {
  type: 'PactBladeAttackProjected';
  weaponCardId: string;
  weaponObjectId: string;
  projection: PactBladeAttackProjection;
}

export interface PactBladeDistanceAdvancedEvent extends PactBladeEventBase {
  type: 'PactBladeDistanceAdvanced';
  facts: PactBladeDistanceAuthority;
  previousBond: PactBladeBondState;
  activeBlade: ActivePactBladeRuntimeState | null;
  pactState: PactBladeInvocationState;
  bondEnded: boolean;
  removedWorldObjectIds: string[];
  removedWeaponBridgeObjectIds: string[];
}

export interface PactBladeEndedOnOwnerDeathEvent extends PactBladeEventBase {
  type: 'PactBladeEndedOnOwnerDeath';
  deathFact: PactBladeOwnerDeathAuthority;
  previousBond: PactBladeBondState;
  pactState: PactBladeInvocationState;
  removedWorldObjectIds: string[];
  removedWeaponBridgeObjectIds: string[];
}

export type PactBladeRuntimeEvent =
  | PactBladeBondedEvent
  | PactBladeAttackProjectedEvent
  | PactBladeDistanceAdvancedEvent
  | PactBladeEndedOnOwnerDeathEvent;

export interface RecordedPactBladeRuntimeTransition {
  command: PactBladeRuntimeCommand;
  event: PactBladeRuntimeEvent;
}

export interface AppliedPactBladeRuntimeTransition {
  status: 'applied';
  state: PactBladeRuntimeState;
  transition: RecordedPactBladeRuntimeTransition;
}

export type PactBladeRuntimeRejectionCode =
  | 'InvalidState'
  | 'InvalidCommand'
  | 'RevisionConflict'
  | 'AuthorityMismatch'
  | 'RulesetMismatch'
  | 'InvalidProvenance'
  | 'WorldRevisionConflict'
  | 'TurnUnavailable'
  | 'IllegalWeapon'
  | 'WorldObjectConflict'
  | 'TouchRequired'
  | 'MagicWeaponRequired'
  | 'AttunedToAnother'
  | 'BondedToAnother'
  | 'BladeUnavailable'
  | 'WeaponMismatch'
  | 'IllegalAttackChoice'
  | 'InvalidDistanceFacts'
  | 'InvalidDeathFacts';

export interface RejectedPactBladeRuntimeTransition {
  status: 'rejected';
  code: PactBladeRuntimeRejectionCode;
  message: string;
  state: PactBladeRuntimeState;
}

export type PactBladeRuntimeTransitionResult =
  | AppliedPactBladeRuntimeTransition
  | RejectedPactBladeRuntimeTransition;

export interface PactBladeCanonicalWorldIntegrationFixture {
  commandType: 'UseAction' | 'AdvanceExplicitTime' | 'ObserveActorDeath';
  expectedActorRevision: number;
  expectedWorldRevision: number;
  actorId: string;
  sourceEntityId: string;
  consumeActionEconomy: Array<{ kind: 'bonus_action'; amount: 1 }>;
  removeObjectIds: string[];
  upsertObjects: WorldObjectState[];
  removeWeaponBridgeObjectIds: string[];
  upsertWeaponBridges: Array<{ weaponObjectId: string; weaponCardId: string }>;
  clearPactBondObjectIds: string[];
  setPactBondObjectId: string | null;
  pactState: PactBladeInvocationState;
}

export interface PactBladeCanonicalAttackIntegrationFixture {
  commandType: 'ResolveWeaponAttack';
  expectedActorRevision: number;
  expectedWorldRevision: number;
  actorId: string;
  sourceEntityId: string;
  immutableWeaponCardId: string;
  weaponObjectId: string;
  attackAbility: Ability;
  damageAbility: Ability;
  damageType: string;
  proficient: true;
  spellcastingFocus: true;
}

export const PACT_BLADE_CANONICAL_INTEGRATION_PLAN = {
  authority: [
    'resolve the selected Card only from the pinned immutable rules catalog',
    'resolve item identity, touch, attunement, bonds, and magic aura from canonical WorldState',
    'resolve Bonus Action availability from canonical turn state',
  ],
  atomicBondCommit: [
    'consume exactly one Bonus Action',
    'remove the former conjured object and card-object bridge when replacing it',
    'upsert the new conjured object and immutable Card bridge, or bind the touched existing object',
    'replace actor.warlockPacts.blade.activeBond and append the recorded transition',
  ],
  attackProjection: [
    'validate the active Card and WorldObject bridge again',
    'project proficiency and spellcasting-focus capability from the active bond',
    'choose ordinary STR/DEX or CHA and normal/necrotic/psychic/radiant for this attack only',
  ],
  lifecycle: 'feed explicit board/GM distance facts and evaluate the declared separation threshold, continuous duration, and owner-death policy',
  replay: 'persist the complete JSON transition and re-run it from the prior Pact Blade revision',
} as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalized(values: readonly string[] | null | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase().replace(/[ -]+/g, '_'));
}

function reject(
  state: PactBladeRuntimeState,
  code: PactBladeRuntimeRejectionCode,
  message: string,
): RejectedPactBladeRuntimeTransition {
  return { status: 'rejected', code, message, state: cloneJson(state) };
}

export function pactBladeWeaponCardSnapshot(card: Card): PactBladeImmutableWeaponCardSnapshot | string {
  if (!nonBlank(card.id) || !nonBlank(card.card_number) || !nonBlank(card.name)
    || card.type !== 'weapon') {
    return 'Pact Blade requires a complete immutable weapon Card identity and damage profile';
  }
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) return parsed.issue;
  const { profile } = parsed;
  const hasDeclaredEnchantment = profile.enchantment.attackBonus > 0
    || profile.enchantment.damageBonus > 0
    || profile.enchantment.extraDamageLines.length > 0;
  return {
    id: card.id,
    cardNumber: card.card_number,
    name: card.name,
    weaponType: profile.weaponType,
    category: profile.proficiencyCategory,
    range: profile.defaultAttackMode,
    normalDamageType: profile.damageLines[0].type,
    properties: sortedUnique(profile.properties),
    tags: [],
    enchantBonus: hasDeclaredEnchantment ? profile.enchantment.attackBonus : null,
    requiresAttunement: profile.attunement.required,
  };
}

/**
 * UI/catalog projection for the exact same immutable-card contract used by
 * the authoritative Pact Blade transition.  Keeping this next to
 * `pactBladeWeaponCardSnapshot` prevents a sheet from offering a weapon that the command
 * handler must then reject (or from maintaining a second name-based list).
 */
export function pactBladeConjureCardIssue(card: Card): string | null {
  const snapshot = pactBladeWeaponCardSnapshot(card);
  if (typeof snapshot === 'string') return snapshot;
  return snapshot.range === 'melee'
    ? null
    : 'A conjured Pact Blade must be a Simple or Martial Melee weapon';
}

export function isPactBladeConjurableCard(card: Card): boolean {
  return pactBladeConjureCardIssue(card) === null;
}

function magicWeaponFromFacts(
  card: PactBladeImmutableWeaponCardSnapshot,
  object: WorldObjectState,
): boolean {
  const objectTags = normalized(object.tags);
  const magicTags = new Set(['magic', 'magical', 'magic_weapon', 'магическое', 'магический']);
  // A spell aura (Light, Detect Magic, and similar) does not turn an ordinary
  // weapon into a magic weapon. Eligibility comes only from immutable item
  // content or an explicit canonical magic-weapon item provenance tag.
  return card.enchantBonus !== null
    || card.requiresAttunement
    || objectTags.some((tag) => magicTags.has(tag));
}

function weaponSnapshotIssue(card: PactBladeImmutableWeaponCardSnapshot): string | null {
  if (!nonBlank(card.id) || !nonBlank(card.cardNumber) || !nonBlank(card.name)
    || !nonBlank(card.weaponType) || !nonBlank(card.normalDamageType)
    || !['simple', 'martial'].includes(card.category)
    || !['melee', 'ranged'].includes(card.range)
    || !Array.isArray(card.properties) || !Array.isArray(card.tags) || card.tags.length !== 0
    || card.properties.some((value) => !nonBlank(value))
    || card.tags.some((value) => !nonBlank(value))
    || canonicalStringify(card.properties) !== canonicalStringify(sortedUnique(card.properties))
    || canonicalStringify(card.tags) !== canonicalStringify(sortedUnique(card.tags))
    || (card.enchantBonus !== null
      && (!Number.isSafeInteger(card.enchantBonus) || card.enchantBonus < 0))
    || typeof card.requiresAttunement !== 'boolean') {
    return 'Pact Blade immutable weapon-profile snapshot is malformed';
  }
  return null;
}

function catalogIssue(catalog: PactBladeCatalogAuthority, expectedHash: string): string | null {
  if (catalog.provenance !== PACT_BLADE_CATALOG_PROVENANCE) {
    return 'Pact Blade requires immutable rules-catalog provenance';
  }
  if (!nonBlank(catalog.rulesetContentHash) || catalog.rulesetContentHash !== expectedHash) {
    return 'Pact Blade catalog hash does not match the authoritative ruleset';
  }
  if (!Array.isArray(catalog.cards)) return 'Pact Blade catalog cards must be an array';
  const ids = catalog.cards.map((card) => card?.id);
  if (ids.some((id) => !nonBlank(id)) || new Set(ids).size !== ids.length) {
    return 'Pact Blade catalog Card identities must be non-blank and unique';
  }
  return null;
}

function worldIssue(world: PactBladeWorldAuthority, expectedHash: string): string | null {
  if (world.provenance !== PACT_BLADE_WORLD_PROVENANCE) {
    return 'Pact Blade requires canonical WorldState provenance';
  }
  if (!nonBlank(world.rulesetContentHash) || world.rulesetContentHash !== expectedHash) {
    return 'Pact Blade WorldState hash does not match the authoritative ruleset';
  }
  if (!Number.isInteger(world.worldRevision) || world.worldRevision < 0) {
    return 'Pact Blade WorldState revision must be a non-negative integer';
  }
  if (!Array.isArray(world.weaponObjects)) return 'Pact Blade weapon objects must be an array';
  const objectIds = world.weaponObjects.map((record) => record?.object?.id);
  if (objectIds.some((id) => !nonBlank(id)) || new Set(objectIds).size !== objectIds.length) {
    return 'Pact Blade WorldObject identities must be non-blank and unique';
  }
  for (const record of world.weaponObjects) {
    if (!nonBlank(record.weaponCardId) || !nonBlank(record.object.name)
      || record.object.kind !== 'item' || !nonBlank(record.object.size)) {
      return `Pact Blade WorldObject ${record.object.id} has an invalid Card bridge or item shape`;
    }
    if (!Array.isArray(record.touchedByActorIds)
      || record.touchedByActorIds.some((actorId) => !nonBlank(actorId))
      || canonicalStringify(record.touchedByActorIds)
        !== canonicalStringify(sortedUnique(record.touchedByActorIds))) {
      return `Pact Blade WorldObject ${record.object.id} touch facts must be non-blank, unique, and sorted`;
    }
    if ((record.attunedToActorId !== undefined && !nonBlank(record.attunedToActorId))
      || (record.bondedWarlockActorId !== undefined && !nonBlank(record.bondedWarlockActorId))) {
      return `Pact Blade WorldObject ${record.object.id} has an invalid attunement or bond identity`;
    }
  }
  return null;
}

function turnIssue(turn: PactBladeTurnAuthority, actorId: string): string | null {
  if (turn.provenance !== PACT_BLADE_TURN_PROVENANCE) {
    return 'Pact Blade requires canonical turn-state provenance';
  }
  if (!Number.isInteger(turn.turnRevision) || turn.turnRevision < 0 || !nonBlank(turn.turnId)) {
    return 'Pact Blade turn authority requires a valid revision and turn identity';
  }
  if (turn.activeActorId !== actorId) return 'Only the active actor can use the Pact Blade Bonus Action';
  if (!Number.isInteger(turn.bonusActionsRemaining) || turn.bonusActionsRemaining < 1) {
    return 'Pact Blade requires one available Bonus Action';
  }
  return null;
}

function activeStateIssue(
  active: ActivePactBladeRuntimeState,
  authority: PactBladeRuntimeAuthority,
  observedWorldRevision: number,
): string | null {
  const invocation = active.invocation;
  const bond = invocation.activeBond;
  if (invocation.kind !== 'blade' || invocation.sourceEntityId !== authority.sourceEntityId
    || invocation.ownerActorId !== authority.ownerActorId
    || invocation.bondActionId !== authority.bondActionId
    || canonicalStringify(invocation.lifecyclePolicy) !== canonicalStringify(authority.lifecyclePolicy)
    || !bond) {
    return 'Active Pact Blade invocation is not owned by the authoritative actor and source';
  }
  const snapshotIssue = weaponSnapshotIssue(active.weaponCard);
  if (snapshotIssue) {
    return 'Active Pact Blade immutable Card snapshot is invalid';
  }
  if (active.weaponCardId !== active.weaponCard.id
    || bond.weaponCardId !== active.weaponCardId
    || active.weaponObject.id !== bond.weaponObjectId
    || active.weaponObject.kind !== 'item'
    || bond.sourceEntityId !== authority.sourceEntityId
    || bond.warlockActorId !== authority.ownerActorId
    || bond.weaponType !== active.weaponCard.weaponType
    || bond.normalDamageType !== active.weaponCard.normalDamageType) {
    return 'Active Pact Blade Card, WorldObject, and bond identities diverged';
  }
  if (!Number.isInteger(bond.bondedAtRevision) || bond.bondedAtRevision < 0
    || bond.bondedAtRevision > observedWorldRevision
    || !Number.isFinite(bond.continuousSeparationSeconds) || bond.continuousSeparationSeconds < 0
    || bond.continuousSeparationSeconds >= authority.lifecyclePolicy.continuousSeparationSecondsToEnd) {
    return 'Active Pact Blade bond revision or distance lifecycle is invalid';
  }
  if (active.boundAtRulesetContentHash !== authority.rulesetContentHash
    || bond.lastDistanceBoardRevision !== active.lastBoardRevision
    || (active.lastBoardRevision !== null
      && (!Number.isInteger(active.lastBoardRevision) || active.lastBoardRevision < 0))) {
    return 'Active Pact Blade provenance or board revision is invalid';
  }
  if (bond.conjured && (active.weaponObject.ownerActorId !== authority.ownerActorId
    || active.weaponObject.sourceActorId !== authority.ownerActorId
    || active.weaponObject.sourceActionId !== authority.sourceEntityId
    || !normalized(active.weaponObject.tags).includes('pact_weapon'))) {
    return 'Conjured Pact Blade WorldObject is not source-owned';
  }
  return null;
}

function stateIssue(state: PactBladeRuntimeState): string | null {
  if (state.schemaVersion !== PACT_BLADE_RUNTIME_SCHEMA_VERSION) {
    return 'Unsupported Pact Blade runtime schema version';
  }
  if (!Number.isInteger(state.revision) || state.revision < 0
    || !Number.isInteger(state.observedWorldRevision) || state.observedWorldRevision < 0) {
    return 'Pact Blade runtime revisions must be non-negative integers';
  }
  const authority = state.authority;
  if (authority.capabilityId !== PACT_BLADE_STATE_CAPABILITY) {
    return 'Pact Blade runtime capability identity is invalid';
  }
  if (!nonBlank(authority.ownerActorId) || !nonBlank(authority.sourceEntityId)
    || !nonBlank(authority.bondActionId) || !nonBlank(authority.rulesetContentHash)) {
    return 'Pact Blade runtime authority requires actor, source, action, and ruleset identities';
  }
  const lifecycleIssue = pactBladeLifecyclePolicyIssue(authority.lifecyclePolicy);
  if (lifecycleIssue) return lifecycleIssue;
  if (!Array.isArray(authority.capabilitySourceEntityIds)
    || !authority.capabilitySourceEntityIds.includes(authority.sourceEntityId)) {
    return 'Pact Blade source is not owned by the actor capability';
  }
  if (authority.capabilitySourceEntityIds.some((sourceId) => !nonBlank(sourceId))
    || canonicalStringify(authority.capabilitySourceEntityIds)
      !== canonicalStringify(sortedUnique(authority.capabilitySourceEntityIds))) {
    return 'Pact Blade capability sources must be non-blank, unique, and sorted';
  }
  return state.activeBlade
    ? activeStateIssue(state.activeBlade, authority, state.observedWorldRevision)
    : null;
}

function baseCommandRejection(
  state: PactBladeRuntimeState,
  command: PactBladeRuntimeCommand,
): RejectedPactBladeRuntimeTransition | null {
  const issue = stateIssue(state);
  if (issue) return reject(state, 'InvalidState', issue);
  if (command.schemaVersion !== PACT_BLADE_RUNTIME_SCHEMA_VERSION
    || !nonBlank(command.commandId) || !Number.isInteger(command.expectedRevision)
    || command.expectedRevision < 0) {
    return reject(state, 'InvalidCommand', 'Pact Blade command envelope is invalid');
  }
  if (command.expectedRevision !== state.revision) {
    return reject(state, 'RevisionConflict', 'Pact Blade command revision is stale');
  }
  if (command.actorId !== state.authority.ownerActorId
    || command.sourceEntityId !== state.authority.sourceEntityId) {
    return reject(state, 'AuthorityMismatch', 'Pact Blade command actor or source is not authoritative');
  }
  if (command.rulesetContentHash !== state.authority.rulesetContentHash) {
    return reject(state, 'RulesetMismatch', 'Pact Blade command ruleset hash is not authoritative');
  }
  return null;
}

function applied(
  state: PactBladeRuntimeState,
  command: PactBladeRuntimeCommand,
  event: PactBladeRuntimeEvent,
): AppliedPactBladeRuntimeTransition {
  return {
    status: 'applied',
    state: cloneJson(state),
    transition: { command: cloneJson(command), event: cloneJson(event) },
  };
}

function catalogCard(
  state: PactBladeRuntimeState,
  catalog: PactBladeCatalogAuthority,
  cardId: string,
): PactBladeImmutableWeaponCardSnapshot | RejectedPactBladeRuntimeTransition {
  const issue = catalogIssue(catalog, state.authority.rulesetContentHash);
  if (issue) return reject(state, 'InvalidProvenance', issue);
  const card = catalog.cards.find((candidate) => candidate.id === cardId);
  if (!card) return reject(state, 'IllegalWeapon', `Unknown immutable weapon Card ${cardId}`);
  const snapshot = pactBladeWeaponCardSnapshot(card);
  if (typeof snapshot === 'string') return reject(state, 'IllegalWeapon', snapshot);
  return snapshot;
}

function checkedWorld(
  state: PactBladeRuntimeState,
  world: PactBladeWorldAuthority,
): RejectedPactBladeRuntimeTransition | null {
  const issue = worldIssue(world, state.authority.rulesetContentHash);
  if (issue) return reject(state, 'InvalidProvenance', issue);
  if (world.worldRevision < state.observedWorldRevision) {
    return reject(state, 'WorldRevisionConflict', 'Pact Blade WorldState revision is stale');
  }
  return null;
}

function activeWorldRecord(
  state: PactBladeRuntimeState,
  world: PactBladeWorldAuthority,
): PactBladeWeaponObjectAuthority | RejectedPactBladeRuntimeTransition {
  // Every caller establishes activeBlade before validating its current bridge.
  const active = state.activeBlade!;
  const record = world.weaponObjects.find((candidate) => (
    candidate.object.id === active.invocation.activeBond?.weaponObjectId
  ));
  if (!record || record.weaponCardId !== active.weaponCardId) {
    return reject(state, 'WeaponMismatch', 'Active Pact Blade Card and WorldObject bridge is unavailable');
  }
  if (record.bondedWarlockActorId
    && record.bondedWarlockActorId !== state.authority.ownerActorId) {
    return reject(state, 'BondedToAnother', 'Active pact weapon is bonded to another Warlock');
  }
  return record;
}

function bondBlade(
  state: PactBladeRuntimeState,
  command: PactBladeRuntimeBondCommand,
): PactBladeRuntimeTransitionResult {
  const snapshot = catalogCard(state, command.catalog, command.weaponCardId);
  if ('status' in snapshot) return snapshot;
  if (command.mode === 'conjure' && snapshot.range !== 'melee') {
    return reject(state, 'IllegalWeapon', 'A conjured Pact Blade must be a Simple or Martial Melee weapon');
  }
  const worldRejection = checkedWorld(state, command.world);
  if (worldRejection) return worldRejection;
  const turnProblem = turnIssue(command.turn, command.actorId);
  if (turnProblem) return reject(state, 'TurnUnavailable', turnProblem);
  if (!nonBlank(command.weaponObjectId)) {
    return reject(state, 'WorldObjectConflict', 'Pact Blade requires a unique WorldObject identity');
  }

  const previous = state.activeBlade;
  if (previous) {
    const previousRecord = command.world.weaponObjects.find((record) => (
      record.object.id === previous.weaponObject.id && record.weaponCardId === previous.weaponCardId
    ));
    if (!previousRecord) {
      return reject(state, 'WeaponMismatch', 'The prior active pact weapon is absent from WorldState');
    }
    if (previous.weaponObject.id === command.weaponObjectId) {
      return reject(state, 'WorldObjectConflict', 'The named WorldObject is already the active pact weapon');
    }
  }

  const existing = command.world.weaponObjects.find((record) => (
    record.object.id === command.weaponObjectId
  ));
  let object: WorldObjectState;
  let magical = false;
  let touched = false;
  let attunedToActorId: string | undefined;
  let bondedWarlockId: string | undefined;

  if (command.mode === 'conjure') {
    if (existing) {
      return reject(state, 'WorldObjectConflict', 'Conjured pact weapon WorldObject identity already exists');
    }
  } else if (command.mode === 'touch_existing') {
    if (!existing || existing.weaponCardId !== snapshot.id) {
      return reject(state, 'WeaponMismatch', 'Touched WorldObject does not bridge to the selected immutable Card');
    }
    touched = existing.touchedByActorIds.includes(command.actorId);
    if (!touched) return reject(state, 'TouchRequired', 'Warlock is not touching the existing weapon');
    magical = magicWeaponFromFacts(snapshot, existing.object);
    if (!magical) return reject(state, 'MagicWeaponRequired', 'An existing pact weapon must be magical');
    attunedToActorId = existing.attunedToActorId;
    bondedWarlockId = existing.bondedWarlockActorId;
    if (attunedToActorId && attunedToActorId !== command.actorId) {
      return reject(state, 'AttunedToAnother', 'Pact weapon is attuned to another creature');
    }
    if (bondedWarlockId && bondedWarlockId !== command.actorId) {
      return reject(state, 'BondedToAnother', 'Pact weapon is bonded to another Warlock');
    }
  } else {
    return reject(state, 'InvalidCommand', 'Pact Blade bond mode is invalid');
  }

  const result = createPactBladeBond({
    sourceEntityId: command.sourceEntityId,
    warlockActorId: command.actorId,
    worldRevision: command.world.worldRevision,
    candidate: {
      objectId: command.weaponObjectId,
      weaponCardId: snapshot.id,
      name: snapshot.name,
      weaponType: snapshot.weaponType,
      category: snapshot.category,
      melee: snapshot.range === 'melee',
      magical,
      normalDamageType: snapshot.normalDamageType,
      ...(attunedToActorId ? { attunedToActorId } : {}),
      ...(bondedWarlockId ? { bondedWarlockId } : {}),
    },
    ...(previous?.invocation.activeBond
      ? { previousBond: previous.invocation.activeBond }
      : {}),
    conjure: command.mode === 'conjure',
    touched,
  });
  object = result.conjuredObject ?? cloneJson(existing!.object);
  const invocation: PactBladeInvocationState = {
    ...createPactBladeInvocationState({
      sourceEntityId: command.sourceEntityId,
      ownerActorId: command.actorId,
      bondActionId: state.authority.bondActionId,
      lifecyclePolicy: state.authority.lifecyclePolicy,
    }),
    activeBond: result.bond,
  };
  const activeBlade: ActivePactBladeRuntimeState = {
    invocation,
    weaponCardId: snapshot.id,
    weaponCard: cloneJson(snapshot),
    weaponObject: cloneJson(object),
    boundAtRulesetContentHash: command.rulesetContentHash,
    lastBoardRevision: null,
  };
  const nextState: PactBladeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    observedWorldRevision: command.world.worldRevision,
    activeBlade,
  };
  const removedWorldObjectIds = previous?.invocation.activeBond?.conjured
    ? [previous.weaponObject.id]
    : [];
  const event: PactBladeBondedEvent = {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'PactBladeBonded',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rulesetContentHash: command.rulesetContentHash,
    worldRevision: command.world.worldRevision,
    turnId: command.turn.turnId,
    turnRevision: command.turn.turnRevision,
    actionCost: { kind: 'bonus_action', amount: 1 },
    activeBlade: cloneJson(activeBlade),
    ...(result.endedPreviousBond ? { endedPreviousBond: result.endedPreviousBond } : {}),
    removedWorldObjectIds,
    upsertWorldObjects: result.conjuredObject ? [cloneJson(result.conjuredObject)] : [],
    removedWeaponBridgeObjectIds: [...removedWorldObjectIds],
    upsertWeaponBridges: result.conjuredObject
      ? [{ weaponObjectId: result.conjuredObject.id, weaponCardId: snapshot.id }]
      : [],
    clearPactBondObjectIds: previous ? [previous.weaponObject.id] : [],
    setPactBondObjectId: object.id,
  };
  return applied(nextState, command, event);
}

function projectAttack(
  state: PactBladeRuntimeState,
  command: ProjectPactBladeAttackCommand,
): PactBladeRuntimeTransitionResult {
  const active = state.activeBlade;
  if (!active) return reject(state, 'BladeUnavailable', 'No active Pact Blade bond exists');
  const snapshot = catalogCard(state, command.catalog, command.weaponCardId);
  if ('status' in snapshot) return snapshot;
  const worldRejection = checkedWorld(state, command.world);
  if (worldRejection) return worldRejection;
  const record = activeWorldRecord(state, command.world);
  if ('status' in record) return record;
  if (command.weaponCardId !== active.weaponCardId
    || command.weaponObjectId !== active.weaponObject.id
    || canonicalStringify(snapshot) !== canonicalStringify(active.weaponCard)) {
    return reject(state, 'WeaponMismatch', 'Attack does not use the active immutable Pact Blade Card and WorldObject');
  }
  if ((command.abilityChoice !== 'ordinary' && command.abilityChoice !== 'charisma')
    || (command.ordinaryAbility !== 'str' && command.ordinaryAbility !== 'dex')
    || (command.ordinaryAbility === 'dex' && !snapshot.properties.includes('finesse'))
    || !PACT_BLADE_DAMAGE_TYPES.includes(command.damageType)) {
    return reject(state, 'IllegalAttackChoice', 'Pact Blade attack ability or damage choice is illegal');
  }
  const projection = pactBladeAttackProjection({
    bond: active.invocation.activeBond!,
    weaponObjectId: command.weaponObjectId,
    useCharisma: command.abilityChoice === 'charisma',
    ordinaryAbility: command.ordinaryAbility,
    damageType: command.damageType,
  });
  const nextState: PactBladeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    observedWorldRevision: command.world.worldRevision,
    activeBlade: {
      ...cloneJson(active),
      weaponObject: cloneJson(record.object),
    },
  };
  const event: PactBladeAttackProjectedEvent = {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'PactBladeAttackProjected',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rulesetContentHash: command.rulesetContentHash,
    worldRevision: command.world.worldRevision,
    weaponCardId: command.weaponCardId,
    weaponObjectId: command.weaponObjectId,
    projection,
  };
  return applied(nextState, command, event);
}

function distanceFactsIssue(
  facts: PactBladeDistanceAuthority,
  active: ActivePactBladeRuntimeState,
  ownerActorId: string,
): string | null {
  if (!['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)
    || !Number.isInteger(facts.boardRevision) || facts.boardRevision < 0
    || facts.actorId !== ownerActorId || facts.weaponObjectId !== active.weaponObject.id
    || !Number.isFinite(facts.distanceFt) || facts.distanceFt < 0
    || !Number.isFinite(facts.elapsedSeconds) || facts.elapsedSeconds < 0) {
    return 'Pact Blade distance lifecycle requires authoritative non-negative explicit facts';
  }
  if (active.lastBoardRevision !== null && facts.boardRevision < active.lastBoardRevision) {
    return 'Pact Blade distance board revision is stale';
  }
  return null;
}

function advanceDistance(
  state: PactBladeRuntimeState,
  command: AdvancePactBladeDistanceCommand,
): PactBladeRuntimeTransitionResult {
  const active = state.activeBlade;
  if (!active) return reject(state, 'BladeUnavailable', 'No active Pact Blade bond exists');
  const worldRejection = checkedWorld(state, command.world);
  if (worldRejection) return worldRejection;
  const record = activeWorldRecord(state, command.world);
  if ('status' in record) return record;
  const factsProblem = distanceFactsIssue(command.facts, active, command.actorId);
  if (factsProblem) return reject(state, 'InvalidDistanceFacts', factsProblem);
  const previousBond = active.invocation.activeBond!;
  const advanced = advancePactBladeDistance(
    previousBond,
    active.invocation.lifecyclePolicy,
    command.facts.distanceFt,
    command.facts.elapsedSeconds,
    command.facts.boardRevision,
  );
  const nextActive: ActivePactBladeRuntimeState | null = advanced
    ? {
      ...cloneJson(active),
      invocation: { ...cloneJson(active.invocation), activeBond: advanced },
      weaponObject: cloneJson(record.object),
      lastBoardRevision: command.facts.boardRevision,
    }
    : null;
  const nextState: PactBladeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    observedWorldRevision: command.world.worldRevision,
    activeBlade: nextActive,
  };
  const removedWorldObjectIds = !advanced && previousBond.conjured
    ? [active.weaponObject.id]
    : [];
  const event: PactBladeDistanceAdvancedEvent = {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'PactBladeDistanceAdvanced',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rulesetContentHash: command.rulesetContentHash,
    worldRevision: command.world.worldRevision,
    facts: cloneJson(command.facts),
    previousBond: cloneJson(previousBond),
    activeBlade: cloneJson(nextActive),
    pactState: cloneJson(nextActive?.invocation ?? createPactBladeInvocationState({
      sourceEntityId: state.authority.sourceEntityId,
      ownerActorId: state.authority.ownerActorId,
      bondActionId: state.authority.bondActionId,
      lifecyclePolicy: state.authority.lifecyclePolicy,
    })),
    bondEnded: advanced === null,
    removedWorldObjectIds,
    removedWeaponBridgeObjectIds: [...removedWorldObjectIds],
  };
  return applied(nextState, command, event);
}

function ownerDeathFactsIssue(
  facts: PactBladeOwnerDeathAuthority,
  ownerActorId: string,
  worldRevision: number,
  rulesetContentHash: string,
): string | null {
  if (!facts || facts.type !== 'ActorDeathAdjudicated'
    || facts.provenance !== 'canonical_actor_lifecycle'
    || !nonBlank(facts.factId) || !nonBlank(facts.adjudicatedBy)
    || facts.actorId !== ownerActorId
    || !Number.isInteger(facts.observedAtWorldRevision)
    || facts.observedAtWorldRevision !== worldRevision
    || facts.rulesetContentHash !== rulesetContentHash) {
    return 'Pact Blade death lifecycle requires an authoritative explicit owner-death fact';
  }
  return null;
}

function endOnOwnerDeath(
  state: PactBladeRuntimeState,
  command: EndPactBladeOnOwnerDeathCommand,
): PactBladeRuntimeTransitionResult {
  const active = state.activeBlade;
  if (!active) return reject(state, 'BladeUnavailable', 'No active Pact Blade bond exists');
  if (!active.invocation.lifecyclePolicy.endOnOwnerDeath) {
    return reject(state, 'InvalidDeathFacts', 'Pact Blade declaration does not end this bond on owner death');
  }
  const worldRejection = checkedWorld(state, command.world);
  if (worldRejection) return worldRejection;
  const record = activeWorldRecord(state, command.world);
  if ('status' in record) return record;
  const factsProblem = ownerDeathFactsIssue(
    command.deathFact,
    command.actorId,
    command.world.worldRevision,
    command.rulesetContentHash,
  );
  if (factsProblem) return reject(state, 'InvalidDeathFacts', factsProblem);
  const previousBond = active.invocation.activeBond!;
  const pactState = createPactBladeInvocationState({
    sourceEntityId: state.authority.sourceEntityId,
    ownerActorId: state.authority.ownerActorId,
    bondActionId: state.authority.bondActionId,
    lifecyclePolicy: state.authority.lifecyclePolicy,
  });
  const removedWorldObjectIds = previousBond.conjured ? [active.weaponObject.id] : [];
  const nextState: PactBladeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    observedWorldRevision: command.world.worldRevision,
    activeBlade: null,
  };
  const event: PactBladeEndedOnOwnerDeathEvent = {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'PactBladeEndedOnOwnerDeath',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rulesetContentHash: command.rulesetContentHash,
    worldRevision: command.world.worldRevision,
    deathFact: cloneJson(command.deathFact),
    previousBond: cloneJson(previousBond),
    pactState,
    removedWorldObjectIds,
    removedWeaponBridgeObjectIds: [...removedWorldObjectIds],
  };
  return applied(nextState, command, event);
}

export function createPactBladeRuntimeState(input: {
  ownerActorId: string;
  sourceEntityId: string;
  bondActionId: string;
  capabilitySourceEntityIds: readonly string[];
  rulesetContentHash: string;
  lifecyclePolicy: PactBladeLifecyclePolicy;
  observedWorldRevision?: number;
}): PactBladeRuntimeState {
  const state: PactBladeRuntimeState = {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    revision: 0,
    observedWorldRevision: input.observedWorldRevision ?? 0,
    authority: {
      capabilityId: PACT_BLADE_STATE_CAPABILITY,
      ownerActorId: input.ownerActorId,
      sourceEntityId: input.sourceEntityId,
      bondActionId: input.bondActionId,
      capabilitySourceEntityIds: sortedUnique(input.capabilitySourceEntityIds),
      rulesetContentHash: input.rulesetContentHash,
      lifecyclePolicy: cloneJson(input.lifecyclePolicy),
    },
    activeBlade: null,
  };
  const issue = stateIssue(state);
  if (issue) throw new Error(issue);
  return state;
}

export function transitionPactBladeRuntime(
  state: PactBladeRuntimeState,
  command: PactBladeRuntimeCommand,
): PactBladeRuntimeTransitionResult {
  const rejection = baseCommandRejection(state, command);
  if (rejection) return rejection;
  if (command.type === 'BondPactBlade') return bondBlade(state, command);
  if (command.type === 'ProjectPactBladeAttack') return projectAttack(state, command);
  if (command.type === 'AdvancePactBladeDistance') return advanceDistance(state, command);
  if (command.type === 'EndPactBladeOnOwnerDeath') return endOnOwnerDeath(state, command);
  return reject(state, 'InvalidCommand', 'Unknown Pact Blade runtime command');
}

export function replayPactBladeRuntime(
  initialState: PactBladeRuntimeState,
  transitions: readonly RecordedPactBladeRuntimeTransition[],
): PactBladeRuntimeState {
  const initialIssue = stateIssue(initialState);
  if (initialIssue) throw new Error(`Cannot replay invalid Pact Blade state: ${initialIssue}`);
  let state = cloneJson(initialState);
  for (const recorded of transitions) {
    const result = transitionPactBladeRuntime(state, recorded.command);
    if (result.status === 'rejected') {
      throw new Error(`Recorded Pact Blade transition rejected: ${result.code}: ${result.message}`);
    }
    if (canonicalStringify(result.transition.event) !== canonicalStringify(recorded.event)) {
      throw new Error(`Recorded Pact Blade transition diverged at ${recorded.event.commandId}`);
    }
    state = result.state;
  }
  return state;
}

export function pactBladeTransitionsToCanonicalJson(
  transitions: readonly RecordedPactBladeRuntimeTransition[],
): string {
  return canonicalStringify(transitions);
}

export function replayPactBladeRuntimeFromJson(
  initialState: PactBladeRuntimeState,
  transitionsJson: string,
): PactBladeRuntimeState {
  const parsed: unknown = JSON.parse(transitionsJson);
  if (!Array.isArray(parsed)) throw new Error('Recorded Pact Blade transitions JSON must be an array');
  return replayPactBladeRuntime(initialState, parsed as RecordedPactBladeRuntimeTransition[]);
}

export function createPactBladeCanonicalWorldIntegrationFixture(
  transition: RecordedPactBladeRuntimeTransition,
): PactBladeCanonicalWorldIntegrationFixture {
  const event = transition.event;
  if (event.type === 'PactBladeAttackProjected') {
    throw new Error('Canonical WorldState integration fixture requires a bond or lifecycle transition');
  }
  if (event.type === 'PactBladeBonded') {
    return {
      commandType: 'UseAction',
      expectedActorRevision: event.revision - 1,
      expectedWorldRevision: event.worldRevision,
      actorId: event.actorId,
      sourceEntityId: event.sourceEntityId,
      consumeActionEconomy: [cloneJson(event.actionCost)],
      removeObjectIds: cloneJson(event.removedWorldObjectIds),
      upsertObjects: cloneJson(event.upsertWorldObjects),
      removeWeaponBridgeObjectIds: cloneJson(event.removedWeaponBridgeObjectIds),
      upsertWeaponBridges: cloneJson(event.upsertWeaponBridges),
      clearPactBondObjectIds: cloneJson(event.clearPactBondObjectIds),
      setPactBondObjectId: event.setPactBondObjectId,
      pactState: cloneJson(event.activeBlade.invocation),
    };
  }
  if (event.type === 'PactBladeEndedOnOwnerDeath') {
    return {
      commandType: 'ObserveActorDeath',
      expectedActorRevision: event.revision - 1,
      expectedWorldRevision: event.worldRevision,
      actorId: event.actorId,
      sourceEntityId: event.sourceEntityId,
      consumeActionEconomy: [],
      removeObjectIds: cloneJson(event.removedWorldObjectIds),
      upsertObjects: [],
      removeWeaponBridgeObjectIds: cloneJson(event.removedWeaponBridgeObjectIds),
      upsertWeaponBridges: [],
      clearPactBondObjectIds: [event.previousBond.weaponObjectId],
      setPactBondObjectId: null,
      pactState: cloneJson(event.pactState),
    };
  }
  return {
    commandType: 'AdvanceExplicitTime',
    expectedActorRevision: event.revision - 1,
    expectedWorldRevision: event.worldRevision,
    actorId: event.actorId,
    sourceEntityId: event.sourceEntityId,
    consumeActionEconomy: [],
    removeObjectIds: cloneJson(event.removedWorldObjectIds),
    upsertObjects: [],
    removeWeaponBridgeObjectIds: cloneJson(event.removedWeaponBridgeObjectIds),
    upsertWeaponBridges: [],
    clearPactBondObjectIds: event.bondEnded ? [event.previousBond.weaponObjectId] : [],
    setPactBondObjectId: event.activeBlade?.weaponObject.id ?? null,
    pactState: cloneJson(event.pactState),
  };
}

export function createPactBladeCanonicalAttackIntegrationFixture(
  transition: RecordedPactBladeRuntimeTransition,
): PactBladeCanonicalAttackIntegrationFixture {
  const event = transition.event;
  if (event.type !== 'PactBladeAttackProjected') {
    throw new Error('Canonical attack integration fixture requires a Pact Blade attack transition');
  }
  return {
    commandType: 'ResolveWeaponAttack',
    expectedActorRevision: event.revision - 1,
    expectedWorldRevision: event.worldRevision,
    actorId: event.actorId,
    sourceEntityId: event.sourceEntityId,
    immutableWeaponCardId: event.weaponCardId,
    weaponObjectId: event.weaponObjectId,
    attackAbility: event.projection.attackAbility,
    damageAbility: event.projection.damageAbility,
    damageType: event.projection.damageType,
    proficient: event.projection.proficient,
    spellcastingFocus: event.projection.spellcastingFocus,
  };
}
