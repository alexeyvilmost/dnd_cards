import { canonicalStringify } from './determinism';
import {
  PACT_TOME_STATE_CAPABILITY,
  conjurePactTome,
  createPactTomeInvocationState,
  type PactTomeInvocationState,
  type PactTomeResult,
  type PactTomeSpellOption,
} from './warlockPacts';
import {
  resolveSpellAccess,
  type ResolvedSpellAccess,
  type SpellAccessFailureCode,
  type SpellCastMode,
  type SpellGrantAccess,
  type SpellcastingAccessState,
} from './spellcastingAccess';
import type { WorldObjectState } from './worldObjects';

export const PACT_TOME_RUNTIME_SCHEMA_VERSION = 1 as const;
export const PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS = 600 as const;
export const PACT_TOME_CATALOG_PROVENANCE = 'immutable_rules_catalog' as const;
export const PACT_TOME_OWNER_DEATH_FACT_PROVENANCE = 'canonical_actor_lifecycle' as const;

export interface PactTomeCatalogSpellOption extends PactTomeSpellOption {
  /** At least one immutable class-list identity; no Warlock-only filter is applied. */
  classListIds: string[];
}

export interface PactTomeCatalogSelectionSource {
  provenance: typeof PACT_TOME_CATALOG_PROVENANCE;
  rulesetContentHash: string;
  options: PactTomeCatalogSpellOption[];
}

/** Client-visible rest choices contain identities only; eligibility is catalog-owned. */
export interface PactTomeRestSelection {
  bookObjectId: string;
  cantripActionIds: string[];
  ritualActionIds: string[];
}

export interface PactTomeRuntimeAuthority {
  capabilityId: typeof PACT_TOME_STATE_CAPABILITY;
  ownerActorId: string;
  sourceEntityId: string;
  capabilitySourceEntityIds: string[];
  rulesetContentHash: string;
}

export interface ActivePactTomeRuntimeState {
  invocation: PactTomeInvocationState;
  bookObject: WorldObjectState;
  grants: SpellGrantAccess[];
  selectedFromCatalog: PactTomeCatalogSelectionSource;
}

export interface PactTomeRuntimeState {
  schemaVersion: typeof PACT_TOME_RUNTIME_SCHEMA_VERSION;
  revision: number;
  authority: PactTomeRuntimeAuthority;
  activeTome: ActivePactTomeRuntimeState | null;
}

interface PactTomeCommandBase {
  schemaVersion: typeof PACT_TOME_RUNTIME_SCHEMA_VERSION;
  commandId: string;
  expectedRevision: number;
  rulesetContentHash: string;
  actorId: string;
  sourceEntityId: string;
}

export interface CompletePactTomeRestCommand extends PactTomeCommandBase {
  type: 'CompletePactTomeRest';
  rest: 'short' | 'long';
  bookObjectId: string;
  cantripActionIds: string[];
  ritualActionIds: string[];
  catalog: PactTomeCatalogSelectionSource;
  actorSpellcastingAccess: SpellcastingAccessState;
  /** The actor's level-1 Pact Magic resource at this character level. */
  slotResource: string;
}

export interface CastPactTomeSpellCommand extends PactTomeCommandBase {
  type: 'CastPactTomeSpell';
  bookObjectId: string;
  actionId: string;
  grantId: string;
  mode: SpellCastMode;
  actorSpellcastingAccess: SpellcastingAccessState;
  resources: Record<string, number>;
}

/**
 * Internal fact emitted by the authoritative actor lifecycle. It is not a
 * browser command and deliberately contains no HP inference: 0 HP is not
 * equivalent to death for a player character.
 */
export interface PactTomeOwnerDeathFact {
  type: 'ActorDeathAdjudicated';
  provenance: typeof PACT_TOME_OWNER_DEATH_FACT_PROVENANCE;
  factId: string;
  actorId: string;
  adjudicatedBy: string;
  observedAtWorldRevision: number;
  rulesetContentHash: string;
}

export interface AdjudicatePactTomeOwnerDeathCommand extends PactTomeCommandBase {
  type: 'AdjudicatePactTomeOwnerDeath';
  deathFact: PactTomeOwnerDeathFact;
  actorSpellcastingAccess: SpellcastingAccessState;
}

export type PactTomeRuntimeCommand =
  | CompletePactTomeRestCommand
  | CastPactTomeSpellCommand
  | AdjudicatePactTomeOwnerDeathCommand;

interface PactTomeEventBase {
  schemaVersion: typeof PACT_TOME_RUNTIME_SCHEMA_VERSION;
  commandId: string;
  revision: number;
  actorId: string;
  sourceEntityId: string;
}

export interface PactTomeRestCompletedEvent extends PactTomeEventBase {
  type: 'PactTomeRestCompleted';
  rest: 'short' | 'long';
  rulesetContentHash: string;
  activeTome: ActivePactTomeRuntimeState;
  removedBookObjectIds: string[];
  removedSpellGrantIds: string[];
}

export interface PactTomeSpellCastEvent extends PactTomeEventBase {
  type: 'PactTomeSpellCast';
  bookObjectId: string;
  focusObjectId: string;
  actionId: string;
  grantId: string;
  mode: SpellCastMode;
  payment: ResolvedSpellAccess['payment'];
  resourceChanges: Array<{ resource: string; delta: -1 }>;
  castingTimeAddedSeconds: number;
}

/** Exact source-owned state removed when the Tome owner is adjudicated dead. */
export interface PactTomeOwnerDiedEvent extends PactTomeEventBase {
  type: 'PactTomeOwnerDied';
  rulesetContentHash: string;
  deathFact: PactTomeOwnerDeathFact;
  dismissedTome: PactTomeInvocationState;
  removedBookObjectIds: [string];
  removedSpellGrantIds: string[];
  removedActionIds: string[];
}

export type PactTomeRuntimeEvent =
  | PactTomeRestCompletedEvent
  | PactTomeSpellCastEvent
  | PactTomeOwnerDiedEvent;

export interface RecordedPactTomeRuntimeTransition {
  command: PactTomeRuntimeCommand;
  event: PactTomeRuntimeEvent;
}

export interface AppliedPactTomeRuntimeTransition {
  status: 'applied';
  state: PactTomeRuntimeState;
  transition: RecordedPactTomeRuntimeTransition;
}

export type PactTomeRuntimeRejectionCode =
  | 'InvalidState'
  | 'InvalidCommand'
  | 'RevisionConflict'
  | 'AuthorityMismatch'
  | 'RulesetMismatch'
  | 'InvalidProvenance'
  | 'InvalidRestSelection'
  | 'InvalidOwnerDeathFact'
  | 'TomeUnavailable'
  | 'GrantOwnershipMismatch'
  | SpellAccessFailureCode;

export interface RejectedPactTomeRuntimeTransition {
  status: 'rejected';
  code: PactTomeRuntimeRejectionCode;
  message: string;
  state: PactTomeRuntimeState;
}

export type PactTomeRuntimeTransitionResult =
  | AppliedPactTomeRuntimeTransition
  | RejectedPactTomeRuntimeTransition;

export interface PactTomeCanonicalRestIntegrationFixture {
  commandType: 'CompleteRest';
  expectedActorRevision: number;
  actorId: string;
  sourceEntityId: string;
  removeObjectIds: string[];
  upsertObjects: WorldObjectState[];
  removeSpellGrantIds: string[];
  upsertSpellGrants: SpellGrantAccess[];
  pactState: PactTomeInvocationState;
}

export interface PactTomeCanonicalOwnerDeathIntegrationFixture {
  triggerEventType: 'ActorDied';
  requiredFactProvenance: typeof PACT_TOME_OWNER_DEATH_FACT_PROVENANCE;
  expectedWorldRevision: number;
  actorId: string;
  sourceEntityId: string;
  removeObjectIds: [string];
  removeSpellGrantIds: string[];
  removeActionIds: string[];
  clearPactTomeState: true;
}

/**
 * Integration boundary for the future canonical rest command. Rest duration,
 * actor turn eligibility, and world revision stay in the handler; this module
 * owns the deterministic Pact Tome sub-transition committed atomically with
 * the rest event.
 */
export const PACT_TOME_CANONICAL_REST_INTEGRATION_PLAN = {
  commandType: 'CompleteRest',
  invokeAfter: 'canonical rest duration and actor authority validation',
  inputs: [
    'actor spellcastingAccess before the rest commit',
    'immutable spell catalog options with class-list provenance',
    'three cantrip and two level-1 ritual selections',
    'a deterministic new Book of Shadows object ID',
  ],
  atomicCommit: [
    'remove the previous source-owned book and its grants',
    'upsert the new physical Book of Shadows focus',
    'upsert exactly five source-scoped grants',
    'replace actor.warlockPacts.tome and append the transition event',
  ],
  replay: 'persist the JSON transition and re-run it against the prior Pact Tome revision',
} as const;

/** Proposed shared handler/reducer contract; registration is intentionally separate. */
export const PACT_TOME_CANONICAL_OWNER_DEATH_INTEGRATION_PLAN = {
  triggerEventType: 'ActorDied',
  acceptFrom: 'canonical actor lifecycle only; never infer player-character death from HP=0',
  factProvenance: PACT_TOME_OWNER_DEATH_FACT_PROVENANCE,
  handler: [
    'derive the fact from the authoritative ActorDied event at the current world revision',
    'plan the Pact Tome transition before committing any lifecycle side effect',
    'append PactTomeOwnerDied in the same atomic command batch',
  ],
  reducer: [
    'verify exact active source-owned physical book, five grants, and five selected actions',
    'remove only that book, those grants, and those actions',
    'delete actor.warlockPacts.tome while retaining any other Pact projections',
  ],
  replay: 'fold PactTomeOwnerDied before CommandCommitted and reproduce byte-identical WorldState',
} as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function thrownMessage(error: unknown): string {
  return String(error).replace(/^Error: /, '');
}

function reject(
  state: PactTomeRuntimeState,
  code: PactTomeRuntimeRejectionCode,
  message: string,
): RejectedPactTomeRuntimeTransition {
  return { status: 'rejected', code, message, state: cloneJson(state) };
}

function catalogIssue(
  catalog: PactTomeCatalogSelectionSource,
  rulesetContentHash: string,
): string | null {
  if (catalog.provenance !== PACT_TOME_CATALOG_PROVENANCE) {
    return 'Pact Tome selections require immutable rules-catalog provenance';
  }
  if (!nonBlank(catalog.rulesetContentHash)
    || catalog.rulesetContentHash !== rulesetContentHash) {
    return 'Pact Tome catalog provenance does not match the authoritative ruleset hash';
  }
  if (!Array.isArray(catalog.options)) return 'Pact Tome catalog options must be an array';
  for (const option of catalog.options) {
    if (!Array.isArray(option.classListIds) || option.classListIds.length === 0) {
      return `${String(option.actionId)} has no authoritative class-list provenance`;
    }
    if (option.classListIds.some((classId) => !nonBlank(classId))) {
      return `${String(option.actionId)} has a blank class-list identity`;
    }
    if (new Set(option.classListIds).size !== option.classListIds.length) {
      return `${String(option.actionId)} repeats a class-list identity`;
    }
  }
  return null;
}

function canonicalCatalog(
  catalog: PactTomeCatalogSelectionSource,
  selectedActionIds: readonly string[],
): PactTomeCatalogSelectionSource {
  const selected = new Set(selectedActionIds);
  return {
    provenance: PACT_TOME_CATALOG_PROVENANCE,
    rulesetContentHash: catalog.rulesetContentHash,
    options: catalog.options
      .filter((option) => selected.has(option.actionId))
      .map((option) => ({
        actionId: option.actionId,
        level: option.level,
        ritual: option.ritual,
        classListIds: sortedUnique(option.classListIds),
      }))
      .sort((left, right) => left.actionId.localeCompare(right.actionId)),
  };
}

function activeFromConjuration(
  result: PactTomeResult,
  catalog: PactTomeCatalogSelectionSource,
): ActivePactTomeRuntimeState {
  const selectedActionIds = [...result.tome.cantripActionIds, ...result.tome.ritualActionIds];
  return {
    invocation: createPactTomeInvocationState({
      sourceEntityId: result.tome.sourceEntityId,
      ownerActorId: result.tome.ownerActorId,
      tome: result.tome,
    }),
    bookObject: cloneJson(result.bookObject),
    grants: cloneJson(result.grants),
    selectedFromCatalog: canonicalCatalog(catalog, selectedActionIds),
  };
}

function activeStateIssue(
  active: ActivePactTomeRuntimeState,
  authority: PactTomeRuntimeAuthority,
): string | null {
  const provenanceIssue = catalogIssue(active.selectedFromCatalog, authority.rulesetContentHash);
  if (provenanceIssue) return provenanceIssue;
  const tome = active.invocation.tome;
  const ritualIds = new Set(tome.ritualActionIds);
  const slotResources = sortedUnique(active.grants
    .filter((grant) => ritualIds.has(grant.actionId) && nonBlank(grant.slotResource ?? ''))
    .map((grant) => grant.slotResource as string));
  try {
    const expected = conjurePactTome({
      sourceEntityId: authority.sourceEntityId,
      ownerActorId: authority.ownerActorId,
      bookObjectId: tome.bookObjectId,
      rest: tome.createdAfterRest,
      cantripActionIds: tome.cantripActionIds,
      ritualActionIds: tome.ritualActionIds,
      options: active.selectedFromCatalog.options,
      alreadyPreparedActionIds: [],
      slotResource: slotResources.length === 1 ? slotResources[0] : '',
    });
    const expectedActive = activeFromConjuration(expected, active.selectedFromCatalog);
    if (canonicalStringify(expectedActive) !== canonicalStringify(active)) {
      return 'Pact Tome invocation, book, grants, or catalog provenance diverged';
    }
  } catch (error) {
    return `Invalid active Pact Tome state: ${thrownMessage(error)}`;
  }
  return null;
}

function stateIssue(state: PactTomeRuntimeState): string | null {
  if (state.schemaVersion !== PACT_TOME_RUNTIME_SCHEMA_VERSION) {
    return 'Unsupported Pact Tome runtime schema version';
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    return 'Pact Tome runtime revision must be a non-negative integer';
  }
  const authority = state.authority;
  if (authority.capabilityId !== PACT_TOME_STATE_CAPABILITY) {
    return 'Pact Tome runtime capability identity is invalid';
  }
  if (!nonBlank(authority.ownerActorId) || !nonBlank(authority.sourceEntityId)
    || !nonBlank(authority.rulesetContentHash)) {
    return 'Pact Tome runtime authority requires actor, source, and ruleset identities';
  }
  if (!Array.isArray(authority.capabilitySourceEntityIds)
    || !authority.capabilitySourceEntityIds.includes(authority.sourceEntityId)) {
    return 'Pact Tome source is not owned by the actor capability';
  }
  if (authority.capabilitySourceEntityIds.some((sourceId) => !nonBlank(sourceId))
    || canonicalStringify(authority.capabilitySourceEntityIds)
      !== canonicalStringify(sortedUnique(authority.capabilitySourceEntityIds))) {
    return 'Pact Tome capability sources must be non-blank, unique, and sorted';
  }
  return state.activeTome ? activeStateIssue(state.activeTome, authority) : null;
}

/** Browser-safe migration/reducer guard for JSON-restored component state. */
export function pactTomeRuntimeStateIssue(state: PactTomeRuntimeState): string | null {
  return stateIssue(state);
}

function accessShapeIssue(access: SpellcastingAccessState): string | null {
  if (!Array.isArray(access.grants)) return 'Actor spellcasting grants must be an array';
  const grantIds = access.grants.map((grant) => grant.grantId);
  if (grantIds.some((grantId) => !nonBlank(grantId))
    || new Set(grantIds).size !== grantIds.length) {
    return 'Actor spellcasting grant identities must be non-blank and unique';
  }
  if (access.grants.some((grant) => !nonBlank(grant.actionId) || !nonBlank(grant.sourceId))) {
    return 'Actor spellcasting grants require action and source provenance';
  }
  return null;
}

function activeAccessIssue(
  active: ActivePactTomeRuntimeState | null,
  access: SpellcastingAccessState,
): string | null {
  const shapeIssue = accessShapeIssue(access);
  if (shapeIssue) return shapeIssue;
  if (!active) return null;
  const bookObjectId = active.invocation.tome.bookObjectId;
  const activeGrantIds = new Set(active.grants.map((grant) => grant.grantId));
  const grantsClaimingBook = access.grants.filter((grant) => grant.sourceId === bookObjectId);
  const grantsClaimingIds = access.grants.filter((grant) => activeGrantIds.has(grant.grantId));
  if (canonicalStringify(grantsClaimingBook) !== canonicalStringify(active.grants)
    || canonicalStringify(grantsClaimingIds) !== canonicalStringify(active.grants)) {
    return 'Actor spellcasting access does not exactly own the active Book of Shadows grants';
  }
  return null;
}

export function pactTomeOwnerDeathFactIssue(
  fact: unknown,
  expected: {
    actorId: string;
    worldRevision: number;
    rulesetContentHash: string;
  },
): string | null {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
    return 'Pact Tome owner death requires an authoritative actor-lifecycle fact';
  }
  const value = fact as Partial<PactTomeOwnerDeathFact>;
  if (value.type !== 'ActorDeathAdjudicated'
    || value.provenance !== PACT_TOME_OWNER_DEATH_FACT_PROVENANCE) {
    return 'Pact Tome owner death fact has non-authoritative provenance';
  }
  if (typeof value.factId !== 'string' || !nonBlank(value.factId)
    || typeof value.adjudicatedBy !== 'string' || !nonBlank(value.adjudicatedBy)) {
    return 'Pact Tome owner death fact requires stable fact and adjudicator identities';
  }
  if (value.actorId !== expected.actorId) {
    return 'Pact Tome owner death fact belongs to another actor';
  }
  if (!Number.isInteger(value.observedAtWorldRevision)
    || value.observedAtWorldRevision !== expected.worldRevision) {
    return 'Pact Tome owner death fact was observed at another world revision';
  }
  if (value.rulesetContentHash !== expected.rulesetContentHash) {
    return 'Pact Tome owner death fact belongs to another ruleset';
  }
  return null;
}

function preparedActionsOutsideActiveTome(
  active: ActivePactTomeRuntimeState | null,
  access: SpellcastingAccessState,
): string[] {
  const excludedSourceId = active?.invocation.tome.bookObjectId;
  const probeResources: Record<string, number> = {};
  for (const grant of access.grants) {
    if (grant.freeUseResource) probeResources[grant.freeUseResource] = 1;
    if (grant.slotResource) probeResources[grant.slotResource] = 1;
  }
  const prepared: string[] = [];
  for (const grant of access.grants) {
    if (grant.sourceId === excludedSourceId) continue;
    const resolution = resolveSpellAccess({
      state: access,
      actionId: grant.actionId,
      grantId: grant.grantId,
      mode: 'normal',
      resources: probeResources,
    });
    if (resolution.status === 'allowed'
      || resolution.code === 'SpellResourceUnavailable') {
      prepared.push(grant.actionId);
    }
  }
  return sortedUnique(prepared);
}

function baseCommandRejection(
  state: PactTomeRuntimeState,
  command: PactTomeRuntimeCommand,
): RejectedPactTomeRuntimeTransition | null {
  const issue = stateIssue(state);
  if (issue) return reject(state, 'InvalidState', issue);
  if (command.schemaVersion !== PACT_TOME_RUNTIME_SCHEMA_VERSION
    || !nonBlank(command.commandId)
    || !Number.isInteger(command.expectedRevision)) {
    return reject(state, 'InvalidCommand', 'Pact Tome command envelope is invalid');
  }
  if (command.expectedRevision !== state.revision) {
    return reject(state, 'RevisionConflict', 'Pact Tome command revision is stale');
  }
  if (command.actorId !== state.authority.ownerActorId
    || command.sourceEntityId !== state.authority.sourceEntityId) {
    return reject(state, 'AuthorityMismatch', 'Pact Tome command actor or source is not authoritative');
  }
  if (command.rulesetContentHash !== state.authority.rulesetContentHash) {
    return reject(state, 'RulesetMismatch', 'Pact Tome command ruleset hash is not authoritative');
  }
  return null;
}

function applied(
  command: PactTomeRuntimeCommand,
  event: PactTomeRuntimeEvent,
  state: PactTomeRuntimeState,
): AppliedPactTomeRuntimeTransition {
  return {
    status: 'applied',
    state: cloneJson(state),
    transition: { command: cloneJson(command), event: cloneJson(event) },
  };
}

function completeRest(
  state: PactTomeRuntimeState,
  command: CompletePactTomeRestCommand,
): PactTomeRuntimeTransitionResult {
  const provenanceIssue = catalogIssue(command.catalog, command.rulesetContentHash);
  if (provenanceIssue) return reject(state, 'InvalidProvenance', provenanceIssue);
  const ownershipIssue = activeAccessIssue(state.activeTome, command.actorSpellcastingAccess);
  if (ownershipIssue) return reject(state, 'GrantOwnershipMismatch', ownershipIssue);

  let result: PactTomeResult;
  try {
    result = conjurePactTome({
      sourceEntityId: command.sourceEntityId,
      ownerActorId: command.actorId,
      bookObjectId: command.bookObjectId,
      rest: command.rest,
      cantripActionIds: command.cantripActionIds,
      ritualActionIds: command.ritualActionIds,
      options: command.catalog.options,
      alreadyPreparedActionIds: preparedActionsOutsideActiveTome(
        state.activeTome,
        command.actorSpellcastingAccess,
      ),
      slotResource: command.slotResource,
      ...(state.activeTome ? { previousTome: state.activeTome.invocation.tome } : {}),
    });
  } catch (error) {
    return reject(state, 'InvalidRestSelection', thrownMessage(error));
  }

  const removedGrantIds = state.activeTome?.grants.map((grant) => grant.grantId) ?? [];
  const removableGrantIds = new Set(removedGrantIds);
  const collidesWithExistingGrant = command.actorSpellcastingAccess.grants.some((existing) => (
    !removableGrantIds.has(existing.grantId)
      && (result.grants.some((grant) => grant.grantId === existing.grantId)
        || existing.sourceId === result.tome.bookObjectId)
  ));
  if (collidesWithExistingGrant) {
    return reject(
      state,
      'GrantOwnershipMismatch',
      'New Book of Shadows identity collides with another spellcasting source',
    );
  }

  const activeTome = activeFromConjuration(result, command.catalog);
  const nextState: PactTomeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    activeTome,
  };
  const event: PactTomeRestCompletedEvent = {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'PactTomeRestCompleted',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rest: command.rest,
    rulesetContentHash: command.rulesetContentHash,
    activeTome: cloneJson(activeTome),
    removedBookObjectIds: result.replacedBookObjectId ? [result.replacedBookObjectId] : [],
    removedSpellGrantIds: [...removedGrantIds].sort((left, right) => left.localeCompare(right)),
  };
  return applied(command, event, nextState);
}

function resourceShapeIssue(resources: Readonly<Record<string, number>>): string | null {
  for (const [resource, value] of Object.entries(resources)) {
    if (!nonBlank(resource) || !Number.isInteger(value) || value < 0) {
      return 'Pact Tome cast resources must be non-negative integer counts with named keys';
    }
  }
  return null;
}

function castSpell(
  state: PactTomeRuntimeState,
  command: CastPactTomeSpellCommand,
): PactTomeRuntimeTransitionResult {
  const active = state.activeTome;
  if (!active) return reject(state, 'TomeUnavailable', 'No active Book of Shadows exists');
  const ownershipIssue = activeAccessIssue(active, command.actorSpellcastingAccess);
  if (ownershipIssue) return reject(state, 'GrantOwnershipMismatch', ownershipIssue);
  if (command.bookObjectId !== active.invocation.tome.bookObjectId) {
    return reject(state, 'GrantOwnershipMismatch', 'Cast does not name the active Book of Shadows');
  }
  const grant = active.grants.find((candidate) => candidate.grantId === command.grantId);
  if (!grant || grant.actionId !== command.actionId || grant.sourceId !== command.bookObjectId) {
    return reject(state, 'GrantOwnershipMismatch', 'Cast is not owned by the active Book of Shadows');
  }
  if (command.mode !== 'normal' && command.mode !== 'ritual') {
    return reject(state, 'InvalidCommand', 'Pact Tome cast mode must be normal or ritual');
  }
  const resourcesIssue = resourceShapeIssue(command.resources);
  if (resourcesIssue) return reject(state, 'InvalidCommand', resourcesIssue);

  const resolution = resolveSpellAccess({
    state: { grants: active.grants, preparedSources: {} },
    actionId: command.actionId,
    grantId: command.grantId,
    mode: command.mode,
    resources: command.resources,
  });
  if (resolution.status === 'rejected') {
    return reject(state, resolution.code, resolution.message);
  }
  const resourceChanges: Array<{ resource: string; delta: -1 }> = resolution.payment.resource
    ? [{ resource: resolution.payment.resource, delta: -1 }]
    : [];
  const nextState: PactTomeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
  };
  const event: PactTomeSpellCastEvent = {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'PactTomeSpellCast',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    bookObjectId: command.bookObjectId,
    focusObjectId: active.bookObject.id,
    actionId: command.actionId,
    grantId: command.grantId,
    mode: command.mode,
    payment: cloneJson(resolution.payment),
    resourceChanges,
    castingTimeAddedSeconds: command.mode === 'ritual'
      ? PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS
      : 0,
  };
  return applied(command, event, nextState);
}

function adjudicateOwnerDeath(
  state: PactTomeRuntimeState,
  command: AdjudicatePactTomeOwnerDeathCommand,
): PactTomeRuntimeTransitionResult {
  const factIssue = pactTomeOwnerDeathFactIssue(command.deathFact, {
    actorId: command.actorId,
    worldRevision: command.expectedRevision,
    rulesetContentHash: command.rulesetContentHash,
  });
  if (factIssue) return reject(state, 'InvalidOwnerDeathFact', factIssue);
  const active = state.activeTome;
  if (!active) return reject(state, 'TomeUnavailable', 'No active Book of Shadows exists');
  const ownershipIssue = activeAccessIssue(active, command.actorSpellcastingAccess);
  if (ownershipIssue) return reject(state, 'GrantOwnershipMismatch', ownershipIssue);
  const tome = active.invocation.tome;
  const removedActionIds = sortedUnique([
    ...tome.cantripActionIds,
    ...tome.ritualActionIds,
  ]);
  const nextState: PactTomeRuntimeState = {
    ...cloneJson(state),
    revision: state.revision + 1,
    activeTome: null,
  };
  const event: PactTomeOwnerDiedEvent = {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'PactTomeOwnerDied',
    commandId: command.commandId,
    revision: nextState.revision,
    actorId: command.actorId,
    sourceEntityId: command.sourceEntityId,
    rulesetContentHash: command.rulesetContentHash,
    deathFact: cloneJson(command.deathFact),
    dismissedTome: cloneJson(active.invocation),
    removedBookObjectIds: [tome.bookObjectId],
    removedSpellGrantIds: active.grants
      .map((grant) => grant.grantId)
      .sort((left, right) => left.localeCompare(right)),
    removedActionIds,
  };
  return applied(command, event, nextState);
}

export function createPactTomeRuntimeState(input: {
  ownerActorId: string;
  sourceEntityId: string;
  capabilitySourceEntityIds: readonly string[];
  rulesetContentHash: string;
}): PactTomeRuntimeState {
  const state: PactTomeRuntimeState = {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    revision: 0,
    authority: {
      capabilityId: PACT_TOME_STATE_CAPABILITY,
      ownerActorId: input.ownerActorId,
      sourceEntityId: input.sourceEntityId,
      capabilitySourceEntityIds: sortedUnique(input.capabilitySourceEntityIds),
      rulesetContentHash: input.rulesetContentHash,
    },
    activeTome: null,
  };
  const issue = stateIssue(state);
  if (issue) throw new Error(issue);
  return state;
}

export function transitionPactTomeRuntime(
  state: PactTomeRuntimeState,
  command: PactTomeRuntimeCommand,
): PactTomeRuntimeTransitionResult {
  const rejection = baseCommandRejection(state, command);
  if (rejection) return rejection;
  if (command.type === 'CompletePactTomeRest') return completeRest(state, command);
  if (command.type === 'CastPactTomeSpell') return castSpell(state, command);
  if (command.type === 'AdjudicatePactTomeOwnerDeath') {
    return adjudicateOwnerDeath(state, command);
  }
  return reject(state, 'InvalidCommand', 'Unknown Pact Tome runtime command');
}

export function replayPactTomeRuntime(
  initialState: PactTomeRuntimeState,
  transitions: readonly RecordedPactTomeRuntimeTransition[],
): PactTomeRuntimeState {
  const initialIssue = stateIssue(initialState);
  if (initialIssue) throw new Error(`Cannot replay invalid Pact Tome state: ${initialIssue}`);
  let state = cloneJson(initialState);
  for (const recorded of transitions) {
    const result = transitionPactTomeRuntime(state, recorded.command);
    if (result.status === 'rejected') {
      throw new Error(`Recorded Pact Tome transition rejected: ${result.code}: ${result.message}`);
    }
    if (canonicalStringify(result.transition.event) !== canonicalStringify(recorded.event)) {
      throw new Error(`Recorded Pact Tome transition diverged at ${recorded.event.commandId}`);
    }
    state = result.state;
  }
  return state;
}

export function createPactTomeCanonicalRestIntegrationFixture(
  transition: RecordedPactTomeRuntimeTransition,
): PactTomeCanonicalRestIntegrationFixture {
  if (transition.event.type !== 'PactTomeRestCompleted') {
    throw new Error('Canonical rest integration fixture requires a Pact Tome rest transition');
  }
  const event = transition.event;
  return {
    commandType: 'CompleteRest',
    expectedActorRevision: event.revision - 1,
    actorId: event.actorId,
    sourceEntityId: event.sourceEntityId,
    removeObjectIds: cloneJson(event.removedBookObjectIds),
    upsertObjects: [cloneJson(event.activeTome.bookObject)],
    removeSpellGrantIds: cloneJson(event.removedSpellGrantIds),
    upsertSpellGrants: cloneJson(event.activeTome.grants),
    pactState: cloneJson(event.activeTome.invocation),
  };
}

export function createPactTomeCanonicalOwnerDeathIntegrationFixture(
  transition: RecordedPactTomeRuntimeTransition,
): PactTomeCanonicalOwnerDeathIntegrationFixture {
  if (transition.event.type !== 'PactTomeOwnerDied') {
    throw new Error('Canonical owner-death integration fixture requires a Pact Tome death transition');
  }
  const event = transition.event;
  return {
    triggerEventType: 'ActorDied',
    requiredFactProvenance: PACT_TOME_OWNER_DEATH_FACT_PROVENANCE,
    expectedWorldRevision: event.revision - 1,
    actorId: event.actorId,
    sourceEntityId: event.sourceEntityId,
    removeObjectIds: cloneJson(event.removedBookObjectIds),
    removeSpellGrantIds: cloneJson(event.removedSpellGrantIds),
    removeActionIds: cloneJson(event.removedActionIds),
    clearPactTomeState: true,
  };
}
