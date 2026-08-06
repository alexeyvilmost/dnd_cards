import { canonicalStringify } from './determinism';
import type {
  ActorState,
  RulesCatalog,
  WorldState,
} from './domain';
import {
  PACT_TOME_CATALOG_PROVENANCE,
  PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS,
  PACT_TOME_RUNTIME_SCHEMA_VERSION,
  createPactTomeCanonicalOwnerDeathIntegrationFixture,
  createPactTomeCanonicalRestIntegrationFixture,
  createPactTomeRuntimeState,
  pactTomeOwnerDeathFactIssue,
  pactTomeRuntimeStateIssue,
  transitionPactTomeRuntime,
  type ActivePactTomeRuntimeState,
  type PactTomeCatalogSelectionSource,
  type PactTomeOwnerDeathFact,
  type PactTomeOwnerDiedEvent,
  type PactTomeRestCompletedEvent,
  type PactTomeRestSelection,
  type PactTomeRuntimeRejectionCode,
  type PactTomeRuntimeState,
  type RecordedPactTomeRuntimeTransition,
} from './pactTomeRuntime';
import { PACT_TOME_STATE_CAPABILITY } from './warlockPacts';

export type { PactTomeRestSelection } from './pactTomeRuntime';
export type { PactTomeOwnerDeathFact } from './pactTomeRuntime';

export type PactTomeWorldAdapterFailureCode =
  | 'ActorNotFound'
  | 'FeatureNotGranted'
  | 'InvalidSelection'
  | 'InvalidCatalogAction'
  | 'InvalidWorldState'
  | PactTomeRuntimeRejectionCode;

export interface RejectedPactTomeWorldRestPlan {
  status: 'rejected';
  code: PactTomeWorldAdapterFailureCode;
  message: string;
}

export interface AppliedPactTomeWorldRestPlan {
  status: 'applied';
  transition: RecordedPactTomeRuntimeTransition;
  event: PactTomeRestCompletedEvent;
}

export type PactTomeWorldRestPlan =
  | AppliedPactTomeWorldRestPlan
  | RejectedPactTomeWorldRestPlan;

export interface AppliedPactTomeWorldOwnerDeathPlan {
  status: 'applied';
  transition: RecordedPactTomeRuntimeTransition;
  event: PactTomeOwnerDiedEvent;
}

export type PactTomeWorldOwnerDeathPlan =
  | AppliedPactTomeWorldOwnerDeathPlan
  | RejectedPactTomeWorldRestPlan;

export type PactTomeSpellCastAuditResult =
  | { status: 'not_pact_tome' }
  | {
      status: 'ready';
      focusObjectId: string;
      castingTimeAddedSeconds: number;
    }
  | { status: 'rejected'; message: string };

interface ImmutableTomeSpellMetadata {
  level: number;
  sourceClass?: string;
  ritual?: boolean;
  classListIds?: readonly string[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalStringify([...left].sort()) === canonicalStringify([...right].sort());
}

function rejected(
  code: PactTomeWorldAdapterFailureCode,
  message: string,
): RejectedPactTomeWorldRestPlan {
  return { status: 'rejected', code, message };
}

function selectionIssue(selection: PactTomeRestSelection): string | null {
  if (!selection || typeof selection !== 'object') return 'Pact Tome rest selection must be an object';
  if (!nonBlank(selection.bookObjectId)) return 'Pact Tome rest selection requires a book object ID';
  if (!Array.isArray(selection.cantripActionIds) || !Array.isArray(selection.ritualActionIds)) {
    return 'Pact Tome rest spell selections must be arrays';
  }
  if ([...selection.cantripActionIds, ...selection.ritualActionIds]
    .some((actionId) => !nonBlank(actionId))) {
    return 'Pact Tome rest spell selections require non-blank action IDs';
  }
  return null;
}

function invocationSourceFromSelection(
  actor: ActorState,
  selection: PactTomeRestSelection,
  catalog: RulesCatalog,
  capabilitySources: readonly string[],
): string | null {
  const activeSource = actor.warlockPacts?.tome?.sourceEntityId;
  if (activeSource) return activeSource;
  const actionIds = [...selection.cantripActionIds, ...selection.ritualActionIds];
  const actions = actionIds.map((actionId) => catalog.getAction(actionId));
  // Unknown actions are diagnosed by immutableOption with a catalog-specific
  // rejection. They can never contribute authority here.
  if (actions.some((action) => action === undefined)) return capabilitySources[0] ?? null;
  const commonSources = capabilitySources.filter((sourceId) => actions.every((action) => (
    action!.sourceEntityIds.includes(sourceId)
  )));
  const authoritativeSource = capabilitySources[0];
  return authoritativeSource && commonSources.includes(authoritativeSource)
    ? authoritativeSource
    : null;
}

function immutableOption(input: {
  catalog: RulesCatalog;
  actionId: string;
  sourceEntityId: string;
}): { option?: PactTomeCatalogSelectionSource['options'][number]; issue?: string } {
  const action = input.catalog.getAction(input.actionId);
  if (!action) return { issue: `Unknown immutable spell action ${input.actionId}` };
  if (action.kind !== 'spell') return { issue: `${input.actionId} is not an immutable spell action` };
  const spell = action.spell as ImmutableTomeSpellMetadata;
  if (!action.sourceEntityIds.includes(input.sourceEntityId)) {
    return { issue: `${input.actionId} is not scoped to this Pact Tome invocation source` };
  }
  if (typeof spell.ritual !== 'boolean') {
    return { issue: `${input.actionId} lacks immutable ritual metadata` };
  }
  if (!Array.isArray(spell.classListIds) || spell.classListIds.length === 0
    || spell.classListIds.some((classId) => !nonBlank(classId))
    || new Set(spell.classListIds).size !== spell.classListIds.length) {
    return { issue: `${input.actionId} lacks immutable class-list provenance` };
  }
  return {
    option: {
      actionId: action.id,
      level: spell.level,
      ritual: spell.ritual,
      classListIds: sortedUnique(spell.classListIds),
    },
  };
}

function catalogSelection(input: {
  catalog: RulesCatalog;
  actionIds: readonly string[];
  sourceEntityId: string;
  rulesetContentHash: string;
}): { catalog?: PactTomeCatalogSelectionSource; issue?: string } {
  const options: PactTomeCatalogSelectionSource['options'] = [];
  for (const actionId of input.actionIds) {
    const derived = immutableOption({
      catalog: input.catalog,
      actionId,
      sourceEntityId: input.sourceEntityId,
    });
    if (derived.issue) return { issue: derived.issue };
    options.push(derived.option!);
  }
  return {
    catalog: {
      provenance: PACT_TOME_CATALOG_PROVENANCE,
      rulesetContentHash: input.rulesetContentHash,
      options,
    },
  };
}

function pactSlotResource(
  actor: ActorState,
  capabilitySources: readonly string[],
): string | null {
  const ownedSources = new Set(capabilitySources);
  const fromCapabilityGrants = sortedUnique((actor.spellcastingAccess?.grants ?? [])
    .filter((grant) => (
      ownedSources.has(grant.sourceId)
        && grant.level === 1
        && nonBlank(grant.slotResource)
    ))
    .map((grant) => grant.slotResource as string));
  return fromCapabilityGrants.length === 1 ? fromCapabilityGrants[0] : null;
}

function activeRuntimeState(input: {
  actor: ActorState;
  world: WorldState;
  catalog: RulesCatalog;
  sourceEntityId: string;
}): { active?: ActivePactTomeRuntimeState | null; issue?: string } {
  const invocation = input.actor.warlockPacts?.tome;
  if (!invocation) return { active: null };
  if (invocation.ownerActorId !== input.actor.id
    || invocation.sourceEntityId !== input.sourceEntityId) {
    return { issue: 'Actor Pact Tome state does not match its capability owner and source' };
  }
  const bookObject = input.world.objects[invocation.tome.bookObjectId];
  if (!bookObject) return { issue: 'Active Book of Shadows object is missing from the world' };
  const access = input.actor.spellcastingAccess;
  if (!access) return { issue: 'Active Pact Tome actor has no spellcasting access' };
  const grants = invocation.tome.spellGrantIds.map((grantId) => (
    access.grants.find((grant) => grant.grantId === grantId)
  ));
  if (grants.some((grant) => grant === undefined)) {
    return { issue: 'Active Book of Shadows grant is missing from actor spellcasting access' };
  }
  const selected = catalogSelection({
    catalog: input.catalog,
    actionIds: [...invocation.tome.cantripActionIds, ...invocation.tome.ritualActionIds],
    sourceEntityId: input.sourceEntityId,
    rulesetContentHash: input.world.ruleset.contentHash,
  });
  if (selected.issue) return { issue: selected.issue };
  selected.catalog!.options.sort((left, right) => left.actionId.localeCompare(right.actionId));
  return {
    active: {
      invocation: cloneJson(invocation),
      bookObject: cloneJson(bookObject),
      grants: cloneJson(grants as NonNullable<(typeof grants)[number]>[]),
      selectedFromCatalog: selected.catalog!,
    },
  };
}

function componentState(input: {
  world: WorldState;
  actor: ActorState;
  catalog: RulesCatalog;
  sourceEntityId: string;
  capabilitySources: readonly string[];
}): { state?: PactTomeRuntimeState; issue?: string } {
  let state: PactTomeRuntimeState;
  try {
    state = createPactTomeRuntimeState({
      ownerActorId: input.actor.id,
      sourceEntityId: input.sourceEntityId,
      capabilitySourceEntityIds: input.capabilitySources,
      rulesetContentHash: input.world.ruleset.contentHash,
    });
  } catch (error) {
    return { issue: String(error).replace(/^Error: /, '') };
  }
  const active = activeRuntimeState(input);
  if (active.issue) return { issue: active.issue };
  state.revision = input.world.revision;
  state.activeTome = active.active ?? null;
  const issue = pactTomeRuntimeStateIssue(state);
  return issue ? { issue } : { state };
}

export function planPactTomeRestTransition(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  rest: 'short' | 'long';
  selection: PactTomeRestSelection;
}): PactTomeWorldRestPlan {
  const actor = input.world.actors[input.actorId];
  if (!actor) return rejected('ActorNotFound', `Unknown actor ${input.actorId}`);
  const issue = selectionIssue(input.selection);
  if (issue) return rejected('InvalidSelection', issue);
  const capabilitySources = actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY];
  if (!capabilitySources) {
    return rejected('FeatureNotGranted', `${actor.id} does not own Pact of the Tome`);
  }
  const sourceEntityId = invocationSourceFromSelection(
    actor,
    input.selection,
    input.catalog,
    capabilitySources,
  );
  if (!sourceEntityId || !capabilitySources.includes(sourceEntityId)) {
    return rejected('FeatureNotGranted', 'Pact Tome selection has no actor-owned invocation source');
  }
  const selectedActionIds = [
    ...input.selection.cantripActionIds,
    ...input.selection.ritualActionIds,
  ];
  const derived = catalogSelection({
    catalog: input.catalog,
    actionIds: selectedActionIds,
    sourceEntityId,
    rulesetContentHash: input.world.ruleset.contentHash,
  });
  if (derived.issue) return rejected('InvalidCatalogAction', derived.issue);
  const runtime = componentState({
    world: input.world,
    actor,
    catalog: input.catalog,
    sourceEntityId,
    capabilitySources,
  });
  if (runtime.issue) return rejected('InvalidWorldState', runtime.issue);
  const slotResource = pactSlotResource(actor, capabilitySources);
  if (!slotResource) {
    return rejected('InvalidWorldState', 'Pact Tome actor has no level-1 Pact Magic slot resource');
  }
  const result = transitionPactTomeRuntime(runtime.state!, {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'CompletePactTomeRest',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: actor.id,
    sourceEntityId,
    rest: input.rest,
    bookObjectId: input.selection.bookObjectId,
    cantripActionIds: [...input.selection.cantripActionIds],
    ritualActionIds: [...input.selection.ritualActionIds],
    catalog: derived.catalog!,
    actorSpellcastingAccess: cloneJson(actor.spellcastingAccess ?? {
      grants: [], preparedSources: {},
    }),
    slotResource,
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  const event = result.transition.event as PactTomeRestCompletedEvent;
  return {
    status: 'applied',
    transition: result.transition,
    event,
  };
}

/**
 * Internal bridge from the future canonical ActorDied lifecycle event. This
 * function is intentionally not exposed as a public GameCommand handler and
 * never derives death from hit points.
 */
export function planPactTomeOwnerDeathTransition(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  deathFact: PactTomeOwnerDeathFact;
}): PactTomeWorldOwnerDeathPlan {
  const actor = input.world.actors[input.actorId];
  if (!actor) return rejected('ActorNotFound', `Unknown actor ${input.actorId}`);
  const invocation = actor.warlockPacts?.tome;
  if (!invocation) return rejected('TomeUnavailable', `${actor.id} has no active Book of Shadows`);
  const capabilitySources = actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY];
  if (!capabilitySources || !capabilitySources.includes(invocation.sourceEntityId)) {
    return rejected('FeatureNotGranted', `${actor.id} has no authoritative Pact Tome source`);
  }
  const runtime = componentState({
    world: input.world,
    actor,
    catalog: input.catalog,
    sourceEntityId: invocation.sourceEntityId,
    capabilitySources,
  });
  if (runtime.issue) return rejected('InvalidWorldState', runtime.issue);
  const result = transitionPactTomeRuntime(runtime.state!, {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'AdjudicatePactTomeOwnerDeath',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: actor.id,
    sourceEntityId: invocation.sourceEntityId,
    deathFact: cloneJson(input.deathFact),
    actorSpellcastingAccess: cloneJson(actor.spellcastingAccess!),
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  const event = result.transition.event as PactTomeOwnerDiedEvent;
  return {
    status: 'applied',
    transition: result.transition,
    event,
  };
}

function eventComponentState(
  world: WorldState,
  actor: ActorState,
  event: PactTomeRestCompletedEvent,
): PactTomeRuntimeState {
  const capabilitySources = actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY] ?? [];
  const state = createPactTomeRuntimeState({
    ownerActorId: actor.id,
    sourceEntityId: event.sourceEntityId,
    capabilitySourceEntityIds: capabilitySources,
    rulesetContentHash: world.ruleset.contentHash,
  });
  state.revision = event.revision;
  state.activeTome = cloneJson(event.activeTome);
  return state;
}

/** Reducer adapter: applies one already-authorized event as an atomic world patch. */
export function evolvePactTomeRestCompleted(
  world: WorldState,
  event: PactTomeRestCompletedEvent,
): WorldState {
  const actor = world.actors[event.actorId];
  if (!actor) throw new Error(`Cannot evolve Pact Tome for unknown actor ${event.actorId}`);
  if (event.revision !== world.revision + 1
    || event.rulesetContentHash !== world.ruleset.contentHash) {
    throw new Error('Pact Tome rest event revision or ruleset provenance diverged');
  }
  const component = eventComponentState(world, actor, event);
  const componentIssue = pactTomeRuntimeStateIssue(component);
  if (componentIssue) throw new Error(`Invalid Pact Tome rest event: ${componentIssue}`);

  const previous = actor.warlockPacts?.tome;
  if (previous) {
    const previousIssue = pactTomeActorWorldIssue(world, actor.id);
    if (previousIssue) {
      throw new Error(`Pact Tome rest cannot replace invalid previous state: ${previousIssue}`);
    }
  }
  const expectedRemovedBooks = previous ? [previous.tome.bookObjectId] : [];
  const expectedRemovedGrants = previous ? [...previous.tome.spellGrantIds].sort() : [];
  if (!sameStringSet(event.removedBookObjectIds, expectedRemovedBooks)
    || !sameStringSet(event.removedSpellGrantIds, expectedRemovedGrants)) {
    throw new Error('Pact Tome rest event does not replace exactly the previous source-owned book');
  }
  const access = actor.spellcastingAccess ?? { grants: [], preparedSources: {} };
  const removedGrantIds = new Set(event.removedSpellGrantIds);
  const retainedGrants = access.grants.filter((grant) => !removedGrantIds.has(grant.grantId));
  const newGrantIds = new Set(event.activeTome.grants.map((grant) => grant.grantId));
  if (retainedGrants.some((grant) => (
    newGrantIds.has(grant.grantId)
      || grant.sourceId === event.activeTome.invocation.tome.bookObjectId
  ))) {
    throw new Error('Pact Tome rest event collides with a retained spellcasting source');
  }
  const objects = { ...world.objects };
  for (const objectId of event.removedBookObjectIds) {
    // Previous-state validation proves every exact source-owned object exists.
    delete objects[objectId];
  }
  if (objects[event.activeTome.bookObject.id]) {
    throw new Error(`Pact Tome rest cannot overwrite object ${event.activeTome.bookObject.id}`);
  }
  objects[event.activeTome.bookObject.id] = cloneJson(event.activeTome.bookObject);

  const removedActionIds = new Set(previous
    ? [...previous.tome.cantripActionIds, ...previous.tome.ritualActionIds]
    : []);
  const addedActionIds = [
    ...event.activeTome.invocation.tome.cantripActionIds,
    ...event.activeTome.invocation.tome.ritualActionIds,
  ];
  const actionIds = sortedUnique([
    ...actor.capabilities.actionIds.filter((actionId) => !removedActionIds.has(actionId)),
    ...addedActionIds,
  ]);
  const nextActor: ActorState = {
    ...actor,
    capabilities: { ...actor.capabilities, actionIds },
    spellcastingAccess: {
      grants: [...retainedGrants, ...cloneJson(event.activeTome.grants)]
        .sort((left, right) => left.grantId.localeCompare(right.grantId)),
      preparedSources: cloneJson(access.preparedSources),
    },
    warlockPacts: {
      ...actor.warlockPacts,
      tome: cloneJson(event.activeTome.invocation),
    },
  };
  return {
    ...world,
    actors: { ...world.actors, [actor.id]: nextActor },
    objects,
  };
}

/** Reducer adapter for one lifecycle-authorized, replayable owner-death event. */
export function evolvePactTomeOwnerDied(
  world: WorldState,
  event: PactTomeOwnerDiedEvent,
): WorldState {
  const actor = world.actors[event.actorId];
  if (!actor) throw new Error(`Cannot dismiss Pact Tome for unknown actor ${event.actorId}`);
  if (event.revision !== world.revision + 1
    || event.rulesetContentHash !== world.ruleset.contentHash) {
    throw new Error('Pact Tome owner-death event revision or ruleset provenance diverged');
  }
  const factIssue = pactTomeOwnerDeathFactIssue(event.deathFact, {
    actorId: actor.id,
    worldRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
  });
  if (factIssue) throw new Error(`Invalid Pact Tome owner-death fact: ${factIssue}`);
  const invocation = actor.warlockPacts?.tome;
  if (!invocation) throw new Error(`Actor ${actor.id} has no active Pact Tome to dismiss`);
  const worldIssue = pactTomeActorWorldIssue(world, actor.id);
  if (worldIssue) throw new Error(`Pact Tome owner-death cannot remove foreign state: ${worldIssue}`);
  if (event.sourceEntityId !== invocation.sourceEntityId
    || canonicalStringify(event.dismissedTome) !== canonicalStringify(invocation)) {
    throw new Error('Pact Tome owner-death event names a foreign invocation');
  }
  const expectedBookIds = [invocation.tome.bookObjectId];
  const expectedGrantIds = [...invocation.tome.spellGrantIds].sort();
  const expectedActionIds = sortedUnique([
    ...invocation.tome.cantripActionIds,
    ...invocation.tome.ritualActionIds,
  ]);
  if (!sameStringSet(event.removedBookObjectIds, expectedBookIds)
    || !sameStringSet(event.removedSpellGrantIds, expectedGrantIds)
    || !sameStringSet(event.removedActionIds, expectedActionIds)) {
    throw new Error('Pact Tome owner-death event does not remove exactly the active source-owned state');
  }

  const objects = { ...world.objects };
  const bookObjectId = invocation.tome.bookObjectId;
  // pactTomeActorWorldIssue above proves this exact source-owned object exists.
  delete objects[bookObjectId];
  const removedGrantIds = new Set(event.removedSpellGrantIds);
  const removedActionIds = new Set(event.removedActionIds);
  const access = actor.spellcastingAccess!;
  const nextPacts = { ...actor.warlockPacts };
  delete nextPacts.tome;
  const nextActor: ActorState = {
    ...actor,
    capabilities: {
      ...actor.capabilities,
      actionIds: actor.capabilities.actionIds.filter((actionId) => !removedActionIds.has(actionId)),
    },
    spellcastingAccess: {
      grants: access.grants.filter((grant) => !removedGrantIds.has(grant.grantId)),
      preparedSources: cloneJson(access.preparedSources),
    },
    warlockPacts: nextPacts,
  };
  if (Object.keys(nextPacts).length === 0) delete nextActor.warlockPacts;
  return {
    ...world,
    actors: { ...world.actors, [actor.id]: nextActor },
    objects,
  };
}

export function pactTomeRestIntegrationFixture(
  plan: AppliedPactTomeWorldRestPlan,
) {
  return createPactTomeCanonicalRestIntegrationFixture(plan.transition);
}

export function pactTomeOwnerDeathIntegrationFixture(
  plan: AppliedPactTomeWorldOwnerDeathPlan,
) {
  return createPactTomeCanonicalOwnerDeathIntegrationFixture(plan.transition);
}

/** Structural guard used by migration tests before a catalog is available. */
export function pactTomeActorWorldIssue(world: WorldState, actorId: string): string | null {
  const actor = world.actors[actorId];
  if (!actor) return `Unknown actor ${actorId}`;
  const invocation = actor.warlockPacts?.tome;
  if (!invocation) return null;
  if (invocation.ownerActorId !== actor.id
    || invocation.tome.ownerActorId !== actor.id
    || invocation.tome.sourceEntityId !== invocation.sourceEntityId
    || !actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY]
      ?.includes(invocation.sourceEntityId)) {
    return 'Pact Tome actor has foreign owner or invocation-source state';
  }
  const object = world.objects[invocation.tome.bookObjectId];
  if (!object) return 'Pact Tome actor references a missing Book of Shadows';
  if (object.kind !== 'item'
    || object.ownerActorId !== actor.id
    || object.carriedByActorId !== actor.id
    || object.sourceActorId !== actor.id
    || object.sourceActionId !== invocation.sourceEntityId
    || !object.tags?.includes('book_of_shadows')
    || !object.tags.includes('spellcasting_focus')) {
    return 'Pact Tome actor references an invalid physical Book of Shadows focus';
  }
  const access = actor.spellcastingAccess;
  if (!access) return 'Pact Tome actor has no spellcasting access';
  const cantripActionIds = invocation.tome.cantripActionIds;
  const ritualActionIds = invocation.tome.ritualActionIds;
  const selectedActions = [...cantripActionIds, ...ritualActionIds];
  if (cantripActionIds.length !== 3
    || ritualActionIds.length !== 2
    || new Set(selectedActions).size !== 5
    || invocation.tome.spellGrantIds.length !== 5) {
    return 'Pact Tome actor does not own exactly three cantrips, two rituals, and five grants';
  }
  const scoped = access.grants.filter((grant) => grant.sourceId === invocation.tome.bookObjectId);
  if (!sameStringSet(scoped.map((grant) => grant.grantId), invocation.tome.spellGrantIds)) {
    return 'Pact Tome spell grants diverge from the active book';
  }
  if (!selectedActions.every((actionId) => actor.capabilities.actionIds.includes(actionId))) {
    return 'Pact Tome selected action is absent from actor capabilities';
  }
  for (const grant of scoped) {
    if (cantripActionIds.includes(grant.actionId)) {
      if (grant.access !== 'cantrip'
        || grant.level !== 0
        || grant.spellcastingAbility !== 'cha') {
        return 'Pact Tome cantrip grant has invalid source semantics';
      }
    } else if (ritualActionIds.includes(grant.actionId)) {
      if (grant.access !== 'always_prepared'
        || grant.level !== 1
        || grant.ritual !== true
        || !nonBlank(grant.slotResource)
        || grant.spellcastingAbility !== 'cha') {
        return 'Pact Tome ritual grant has invalid source semantics';
      }
    } else {
      return 'Pact Tome grant points outside the active book selections';
    }
  }
  return null;
}

/**
 * Proves that a prepared generic spell execution really comes from the active,
 * carried Book of Shadows. This is deliberately derived from WorldState after
 * access resolution; no browser-provided Tome or ritual facts are trusted.
 */
export function pactTomeSpellCastAudit(input: {
  world: WorldState;
  actorId: string;
  actionId: string;
  grantId: string;
  sourceId: string;
  mode: 'normal' | 'ritual';
  payment: { kind: 'none' | 'free_use' | 'slot'; resource?: string };
}): PactTomeSpellCastAuditResult {
  const actor = input.world.actors[input.actorId];
  if (!actor) return { status: 'rejected', message: `Unknown actor ${input.actorId}` };
  const invocation = actor.warlockPacts?.tome;
  if (!invocation) return { status: 'not_pact_tome' };
  const bookObjectId = invocation.tome.bookObjectId;
  const selectedCantrip = invocation.tome.cantripActionIds.includes(input.actionId);
  const selectedRitual = invocation.tome.ritualActionIds.includes(input.actionId);
  if (!selectedCantrip && !selectedRitual) {
    return input.sourceId === bookObjectId
      ? { status: 'rejected', message: 'Book of Shadows grant points outside its selected spells' }
      : { status: 'not_pact_tome' };
  }
  const worldIssue = pactTomeActorWorldIssue(input.world, actor.id);
  if (worldIssue) return { status: 'rejected', message: worldIssue };
  if (input.sourceId !== bookObjectId || !invocation.tome.spellGrantIds.includes(input.grantId)) {
    return { status: 'rejected', message: 'Selected Pact Tome spell is not sourced by its active book' };
  }
  const grant = actor.spellcastingAccess!.grants.find((candidate) => (
    candidate.grantId === input.grantId
  ));
  if (!grant || grant.actionId !== input.actionId || grant.sourceId !== bookObjectId) {
    return { status: 'rejected', message: 'Selected Pact Tome spell grant diverges from its active book' };
  }
  if (selectedCantrip) {
    if (grant.access !== 'cantrip'
      || grant.level !== 0
      || input.mode !== 'normal'
      || input.payment.kind !== 'none') {
      return { status: 'rejected', message: 'Pact Tome cantrip requires its canonical no-cost cast' };
    }
  } else if (grant.access !== 'always_prepared'
    || grant.level !== 1
    || grant.ritual !== true
    || !grant.slotResource
    || (input.mode === 'ritual'
      ? input.payment.kind !== 'none'
      : input.payment.kind !== 'slot' || input.payment.resource !== grant.slotResource)) {
    return { status: 'rejected', message: 'Pact Tome ritual has invalid access or payment semantics' };
  }
  return {
    status: 'ready',
    focusObjectId: bookObjectId,
    castingTimeAddedSeconds: input.mode === 'ritual'
      ? PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS
      : 0,
  };
}
