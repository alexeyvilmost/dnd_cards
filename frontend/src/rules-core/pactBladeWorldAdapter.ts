import type { Card } from '../types';
import { canonicalStringify } from './determinism';
import type {
  ActorDeathAdjudicatedEvent,
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  WorldState,
} from './domain';
import {
  PACT_BLADE_CATALOG_PROVENANCE,
  PACT_BLADE_RUNTIME_SCHEMA_VERSION,
  PACT_BLADE_TURN_PROVENANCE,
  PACT_BLADE_WORLD_PROVENANCE,
  createPactBladeCanonicalAttackIntegrationFixture,
  createPactBladeCanonicalWorldIntegrationFixture,
  createPactBladeRuntimeState,
  pactBladeWeaponCardSnapshot,
  transitionPactBladeRuntime,
  type ActivePactBladeRuntimeState,
  type PactBladeAttackProjectedEvent,
  type PactBladeBondedEvent,
  type PactBladeDistanceAdvancedEvent,
  type PactBladeEndedOnOwnerDeathEvent,
  type PactBladeImmutableWeaponCardSnapshot,
  type PactBladeRuntimeRejectionCode,
  type PactBladeRuntimeState,
  type PactBladeWeaponObjectAuthority,
  type PactBladeWorldAuthority,
  type RecordedPactBladeRuntimeTransition,
} from './pactBladeRuntime';
import {
  PACT_BLADE_DAMAGE_TYPES,
  PACT_BLADE_STATE_CAPABILITY,
  advancePactBladeDistance,
  type PactBladeBondState,
  type PactBladeDamageChoice,
  type PactBladeInvocationState,
} from './warlockPacts';
import type { WorldObjectFacts, WorldObjectState } from './worldObjects';
import { bindWarlockPactDeclaration } from './warlockPactDeclaration';

/**
 * Local preview of the generic item-instance bridge that WorldObjectState v5
 * will own.  The adapter reads it only from canonical WorldState; commands and
 * UI facts never supply item identity, magic, or attunement claims.
 */
export interface PactBladeItemWorldObject extends WorldObjectState {
  itemCardId?: string;
  attunedToActorId?: string;
  heldByActorId?: string;
  heldInHand?: PactBladeHand;
}

export interface PactBladeBoundItemWorldObject extends PactBladeItemWorldObject {
  itemCardId: string;
}

/** Local preview of the v5 actor state. */
export interface PactBladeCanonicalBondState extends PactBladeBondState {
  weaponCardId: string;
  lastDistanceBoardRevision: number | null;
}

export interface PactBladeCanonicalInvocationState
  extends Omit<PactBladeInvocationState, 'activeBond'> {
  activeBond: PactBladeCanonicalBondState | null;
}

export interface PactBladeCanonicalActiveState
  extends Omit<ActivePactBladeRuntimeState, 'invocation' | 'weaponObject'> {
  invocation: PactBladeCanonicalInvocationState;
  weaponObject: PactBladeBoundItemWorldObject;
}

export interface PactBladeTouchFacts extends WorldObjectFacts {
  touched: boolean;
}

export type PactBladeHand = 'main_hand' | 'off_hand';

export interface PactBladeDistanceFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  distanceFt: number;
  elapsedSeconds: number;
}

export interface PactBladeBondSelection {
  mode: 'conjure' | 'touch_existing';
  weaponCardId: string;
  weaponObjectId: string;
  /** Required only for conjure: PHB says the weapon appears in your hand. */
  conjureHand?: PactBladeHand;
  touchFacts?: PactBladeTouchFacts;
}

export interface PactBladeAttackSelection {
  weaponObjectId: string;
  hand: PactBladeHand;
  abilityChoice: 'str' | 'dex' | 'cha';
  damageType: PactBladeDamageChoice;
}

export type PactBladeOwnerDeathFacts = ActorDeathAdjudicatedEvent;

export interface PactBladeWorldBondedEvent
  extends Omit<
    PactBladeBondedEvent,
    'activeBlade' | 'endedPreviousBond' | 'upsertWorldObjects'
  > {
  mode: PactBladeBondSelection['mode'];
  conjureHand?: PactBladeHand;
  touchFacts?: PactBladeTouchFacts;
  activeBlade: PactBladeCanonicalActiveState;
  endedPreviousBond?: PactBladeCanonicalBondState;
  upsertWorldObjects: PactBladeBoundItemWorldObject[];
}

export interface PactBladeWorldDistanceAdvancedEvent
  extends Omit<
    PactBladeDistanceAdvancedEvent,
    'activeBlade' | 'previousBond' | 'pactState'
  > {
  previousBond: PactBladeCanonicalBondState;
  activeBlade: PactBladeCanonicalActiveState | null;
  pactState: PactBladeCanonicalInvocationState;
}

export interface PactBladeWorldEndedOnOwnerDeathEvent
  extends Omit<PactBladeEndedOnOwnerDeathEvent, 'previousBond' | 'pactState'> {
  previousBond: PactBladeCanonicalBondState;
  pactState: PactBladeCanonicalInvocationState;
}

export interface PactBladeMaterialFocusProjection {
  type: 'PactBladeMaterialFocusProjected';
  commandId: string;
  revision: number;
  worldRevision: number;
  rulesetContentHash: string;
  actorId: string;
  sourceEntityId: string;
  actionId: string;
  weaponObjectId: string;
  weaponCardId: string;
  focusHand: PactBladeHand;
  components: { verbal: boolean; somatic: boolean; material: true };
  replacesMaterialComponent: true;
  preservesCostlyAndConsumedMaterials: true;
  replacesVerbalComponent: false;
  replacesSomaticComponent: false;
}

export type PactBladeWorldAdapterFailureCode =
  | 'ActorNotFound'
  | 'FeatureNotGranted'
  | 'CatalogCardResolverUnavailable'
  | 'InvalidCatalogAction'
  | 'InvalidCatalogCard'
  | 'InvalidWorldState'
  | 'InvalidTurnState'
  | 'InvalidTouchFacts'
  | 'MaterialComponentRequired'
  | 'WeaponNotHeld'
  | PactBladeRuntimeRejectionCode;

export interface RejectedPactBladeWorldPlan {
  status: 'rejected';
  code: PactBladeWorldAdapterFailureCode;
  message: string;
}

export interface AppliedPactBladeWorldBondPlan {
  status: 'applied';
  transition: RecordedPactBladeRuntimeTransition;
  event: PactBladeWorldBondedEvent;
}

export interface AppliedPactBladeWorldAttackPlan {
  status: 'applied';
  transition: RecordedPactBladeRuntimeTransition;
  event: PactBladeAttackProjectedEvent;
}

export interface AppliedPactBladeWorldDistancePlan {
  status: 'applied';
  transition: RecordedPactBladeRuntimeTransition;
  event: PactBladeWorldDistanceAdvancedEvent;
}

export interface AppliedPactBladeWorldOwnerDeathPlan {
  status: 'applied';
  transition: RecordedPactBladeRuntimeTransition;
  event: PactBladeWorldEndedOnOwnerDeathEvent;
}

export interface AppliedPactBladeMaterialFocusPlan {
  status: 'applied';
  event: PactBladeMaterialFocusProjection;
}

export type PactBladeWorldBondPlan =
  | AppliedPactBladeWorldBondPlan
  | RejectedPactBladeWorldPlan;
export type PactBladeWorldAttackPlan =
  | AppliedPactBladeWorldAttackPlan
  | RejectedPactBladeWorldPlan;
export type PactBladeWorldDistancePlan =
  | AppliedPactBladeWorldDistancePlan
  | RejectedPactBladeWorldPlan;
export type PactBladeWorldOwnerDeathPlan =
  | AppliedPactBladeWorldOwnerDeathPlan
  | RejectedPactBladeWorldPlan;
export type PactBladeMaterialFocusPlan =
  | AppliedPactBladeMaterialFocusPlan
  | RejectedPactBladeWorldPlan;

interface CardCatalogPreview extends RulesCatalog {
  getCard?(id: string): Card | undefined;
}

type PactBladeBondPreview = PactBladeBondState & {
  weaponCardId?: string;
  lastDistanceBoardRevision?: number | null;
};

interface ActorPactPreview extends ActorState {
  warlockPacts?: ActorState['warlockPacts'] & {
    blade?: Omit<PactBladeInvocationState, 'activeBond'> & {
      activeBond: PactBladeBondPreview | null;
    };
  };
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

function normalized(values: unknown): string[] | null {
  if (values == null) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) return null;
  return values.map((value) => value.trim().toLowerCase().replace(/[ -]+/g, '_'));
}

function rejected(
  code: PactBladeWorldAdapterFailureCode,
  message: string,
): RejectedPactBladeWorldPlan {
  return { status: 'rejected', code, message };
}

function cardResolver(catalog: RulesCatalog): ((id: string) => Card | undefined) | null {
  const resolver = (catalog as CardCatalogPreview).getCard;
  return typeof resolver === 'function' ? resolver.bind(catalog) : null;
}

function catalogCard(
  catalog: RulesCatalog,
  cardId: string,
): { card?: Card; snapshot?: PactBladeImmutableWeaponCardSnapshot; issue?: RejectedPactBladeWorldPlan } {
  const resolver = cardResolver(catalog);
  if (!resolver) {
    return { issue: rejected(
      'CatalogCardResolverUnavailable',
      'The authoritative RulesCatalog does not expose getCard',
    ) };
  }
  const card = resolver(cardId);
  if (!card || card.id !== cardId) {
    return { issue: rejected('InvalidCatalogCard', `Unknown immutable weapon Card ${cardId}`) };
  }
  const snapshot = pactBladeWeaponCardSnapshot(card);
  if (typeof snapshot === 'string') {
    return { issue: rejected('InvalidCatalogCard', snapshot) };
  }
  return { card: cloneJson(card), snapshot };
}

function itemObject(world: WorldState, objectId: string): PactBladeItemWorldObject | undefined {
  return world.objects[objectId] as PactBladeItemWorldObject | undefined;
}

function canonicalBond(
  invocation: PactBladeBondPreview | null,
): PactBladeCanonicalBondState | string {
  if (!invocation || !nonBlank(invocation.weaponCardId)) {
    return 'Active Pact Blade bond has no immutable weaponCardId';
  }
  const lastDistanceBoardRevision = invocation.lastDistanceBoardRevision ?? null;
  if (lastDistanceBoardRevision !== null
    && (!Number.isInteger(lastDistanceBoardRevision) || lastDistanceBoardRevision < 0)) {
    return 'Active Pact Blade bond has an invalid lastDistanceBoardRevision';
  }
  return {
    ...cloneJson(invocation),
    weaponCardId: invocation.weaponCardId,
    lastDistanceBoardRevision,
  };
}

function actorInvocation(actor: ActorState): PactBladeCanonicalInvocationState | string {
  const preview = actor as ActorPactPreview;
  const invocation = preview.warlockPacts?.blade;
  if (!invocation) return 'Actor Pact Blade invocation state is missing';
  const bond = invocation.activeBond ? canonicalBond(invocation.activeBond) : null;
  if (typeof bond === 'string') return bond;
  return {
    kind: invocation.kind,
    sourceEntityId: invocation.sourceEntityId,
    ownerActorId: invocation.ownerActorId,
    bondActionId: invocation.bondActionId,
    lifecyclePolicy: cloneJson(invocation.lifecyclePolicy),
    activeBond: bond,
  };
}

function capabilityContext(actor: ActorState): {
  invocation?: PactBladeCanonicalInvocationState;
  capabilitySources?: string[];
  issue?: RejectedPactBladeWorldPlan;
} {
  const sources = actor.capabilities.featureSources?.[PACT_BLADE_STATE_CAPABILITY];
  if (!Array.isArray(sources)) {
    return { issue: rejected('FeatureNotGranted', `${actor.id} does not own Pact of the Blade`) };
  }
  if (sources.some((sourceId) => !nonBlank(sourceId))) {
    return { issue: rejected('InvalidWorldState', 'Pact Blade capability sources must be non-blank') };
  }
  const invocation = actorInvocation(actor);
  if (typeof invocation === 'string') {
    return { issue: rejected('InvalidWorldState', invocation) };
  }
  if (invocation.kind !== 'blade' || invocation.ownerActorId !== actor.id
    || !sources.includes(invocation.sourceEntityId)
    || !actor.capabilities.actionIds.includes(invocation.bondActionId)) {
    return {
      issue: rejected(
        'InvalidWorldState',
        'Pact Blade invocation owner, source, or bond action diverges from actor capabilities',
      ),
    };
  }
  return {
    invocation,
    capabilitySources: sortedUnique(sources),
  };
}

function bondActionIssue(
  actor: ActorState,
  invocation: PactBladeCanonicalInvocationState,
  catalog: RulesCatalog,
): string | null {
  const action = catalog.getAction(invocation.bondActionId);
  if (!action || action.kind !== 'nonSpell') {
    return 'Pact Blade bond action is absent from the immutable catalog';
  }
  if (!action.sourceEntityIds.includes(invocation.sourceEntityId)
    || !actor.capabilities.actionIds.includes(action.id)) {
    return 'Pact Blade bond action is not scoped to the actor-owned invocation';
  }
  const declaration = bindWarlockPactDeclaration(action.mechanics);
  if (declaration?.kind !== 'blade'
    || canonicalStringify(declaration.lifecyclePolicy)
      !== canonicalStringify(invocation.lifecyclePolicy)) {
    return 'Pact Blade lifecycle state diverges from its immutable mechanics declaration';
  }
  return null;
}

function bondedWarlocks(world: WorldState, objectId: string): string[] {
  return Object.values(world.actors).flatMap((candidate) => {
    const invocation = (candidate as ActorPactPreview).warlockPacts?.blade;
    return invocation?.activeBond?.weaponObjectId === objectId ? [candidate.id] : [];
  }).sort((left, right) => left.localeCompare(right));
}

function objectRecord(
  world: WorldState,
  objectId: string,
  touchedByActorId?: string,
): PactBladeWeaponObjectAuthority | string {
  const object = itemObject(world, objectId);
  if (!object || object.kind !== 'item' || !nonBlank(object.itemCardId)) {
    return `Pact Blade object ${objectId} is not an item with an immutable itemCardId bridge`;
  }
  const warlocks = bondedWarlocks(world, objectId);
  if (warlocks.length > 1) return `Pact Blade object ${objectId} is bonded by multiple Warlocks`;
  return {
    object: cloneJson(object),
    weaponCardId: object.itemCardId,
    touchedByActorIds: touchedByActorId ? [touchedByActorId] : [],
    ...(object.attunedToActorId ? { attunedToActorId: object.attunedToActorId } : {}),
    ...(warlocks[0] ? { bondedWarlockActorId: warlocks[0] } : {}),
  };
}

function worldAuthority(
  world: WorldState,
  objectIds: readonly string[],
  touchedObjectId?: string,
  touchedByActorId?: string,
): PactBladeWorldAuthority | string {
  const records: PactBladeWeaponObjectAuthority[] = [];
  for (const objectId of sortedUnique(objectIds)) {
    const record = objectRecord(
      world,
      objectId,
      objectId === touchedObjectId ? touchedByActorId : undefined,
    );
    if (typeof record === 'string') return record;
    records.push(record);
  }
  return {
    provenance: PACT_BLADE_WORLD_PROVENANCE,
    rulesetContentHash: world.ruleset.contentHash,
    worldRevision: world.revision,
    weaponObjects: records,
  };
}

function activeState(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actor: ActorState;
  invocation: PactBladeCanonicalInvocationState;
}): ActivePactBladeRuntimeState | null | string {
  const bond = input.invocation.activeBond;
  if (!bond) return null;
  const object = itemObject(input.world, bond.weaponObjectId);
  if (!object || object.kind !== 'item') return 'Active Pact Blade WorldObject is missing or not an item';
  if (!nonBlank(object.itemCardId) || object.itemCardId !== bond.weaponCardId) {
    return 'Active Pact Blade Card and WorldObject itemCardId bridge diverged';
  }
  const derived = catalogCard(input.catalog, bond.weaponCardId);
  if (derived.issue) return derived.issue.message;
  if (bond.weaponType !== derived.snapshot!.weaponType
    || bond.normalDamageType !== derived.snapshot!.normalDamageType) {
    return 'Active Pact Blade bond diverges from its immutable weapon Card';
  }
  const warlocks = bondedWarlocks(input.world, object.id);
  if (warlocks.length !== 1 || warlocks[0] !== input.actor.id) {
    return 'Active Pact Blade WorldObject has an invalid Warlock bond owner';
  }
  if (object.attunedToActorId && object.attunedToActorId !== input.actor.id) {
    return 'Active pact weapon is attuned to another creature';
  }
  if ((object.heldByActorId === undefined) !== (object.heldInHand === undefined)
    || (object.heldByActorId !== undefined && object.carriedByActorId !== object.heldByActorId)) {
    return 'Pact Blade held-item identity is incomplete or diverges from its carrier';
  }
  if (bond.conjured && (object.ownerActorId !== input.actor.id
    || object.carriedByActorId !== input.actor.id
    || object.sourceActorId !== input.actor.id
    || object.sourceActionId !== input.invocation.sourceEntityId
    || !normalized(object.tags)?.includes('pact_weapon'))) {
    return 'Conjured Pact Blade object is not source-owned';
  }
  return {
    invocation: cloneJson(input.invocation),
    weaponCardId: bond.weaponCardId,
    weaponCard: cloneJson(derived.snapshot!),
    weaponObject: cloneJson(object),
    boundAtRulesetContentHash: input.world.ruleset.contentHash,
    lastBoardRevision: bond.lastDistanceBoardRevision,
  };
}

function componentState(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actor: ActorState;
  invocation: PactBladeCanonicalInvocationState;
  capabilitySources: readonly string[];
}): PactBladeRuntimeState | string {
  let state: PactBladeRuntimeState;
  try {
    state = createPactBladeRuntimeState({
      ownerActorId: input.actor.id,
      sourceEntityId: input.invocation.sourceEntityId,
      bondActionId: input.invocation.bondActionId,
      capabilitySourceEntityIds: input.capabilitySources,
      rulesetContentHash: input.world.ruleset.contentHash,
      lifecyclePolicy: input.invocation.lifecyclePolicy,
      observedWorldRevision: input.world.revision,
    });
  } catch (error) {
    return String(error).replace(/^Error: /, '');
  }
  const active = activeState(input);
  if (typeof active === 'string') return active;
  state.revision = input.world.revision;
  state.activeBlade = active;
  return state;
}

function context(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
}): {
  actor?: ActorState;
  invocation?: PactBladeCanonicalInvocationState;
  capabilitySources?: string[];
  state?: PactBladeRuntimeState;
  issue?: RejectedPactBladeWorldPlan;
} {
  const actor = input.world.actors[input.actorId];
  if (!actor) return { issue: rejected('ActorNotFound', `Unknown actor ${input.actorId}`) };
  const capability = capabilityContext(actor);
  if (capability.issue) return { issue: capability.issue };
  const actionIssue = bondActionIssue(actor, capability.invocation!, input.catalog);
  if (actionIssue) return { issue: rejected('InvalidCatalogAction', actionIssue) };
  const state = componentState({
    world: input.world,
    catalog: input.catalog,
    actor,
    invocation: capability.invocation!,
    capabilitySources: capability.capabilitySources!,
  });
  if (typeof state === 'string') return { issue: rejected('InvalidWorldState', state) };
  return {
    actor,
    invocation: capability.invocation,
    capabilitySources: capability.capabilitySources,
    state,
  };
}

function touchFactsIssue(facts: PactBladeTouchFacts | undefined): string | null {
  if (!facts || !['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)
    || !Number.isInteger(facts.boardRevision) || facts.boardRevision < 0
    || !Number.isFinite(facts.distanceFt) || facts.distanceFt < 0
    || typeof facts.lineOfSight !== 'boolean' || typeof facts.touched !== 'boolean') {
    return 'Pact Blade touch requires authoritative, well-formed object facts';
  }
  if (facts.touched !== true) return 'Pact Blade existing-weapon bond requires an explicit touch fact';
  return null;
}

function turnAuthority(world: WorldState, actor: ActorState): {
  turn?: {
    provenance: typeof PACT_BLADE_TURN_PROVENANCE;
    turnRevision: number;
    turnId: string;
    activeActorId: string;
    bonusActionsRemaining: number;
  };
  issue?: string;
} {
  if (world.scene.mode === 'encounter') {
    const activeActorId = world.scene.initiative[world.scene.activeIndex];
    if (!world.scene.turnStarted || activeActorId !== actor.id) {
      return { issue: 'Pact Blade Bonus Action requires the actor\'s started encounter turn' };
    }
    return {
      turn: {
        provenance: PACT_BLADE_TURN_PROVENANCE,
        turnRevision: world.revision,
        turnId: `encounter:${world.scene.round}:${world.scene.activeIndex}:${actor.id}`,
        activeActorId,
        bonusActionsRemaining: actor.runtime.resources.bonus_action ?? 0,
      },
    };
  }
  return {
    turn: {
      provenance: PACT_BLADE_TURN_PROVENANCE,
      turnRevision: world.revision,
      turnId: `exploration:${world.revision}:${actor.id}`,
      activeActorId: actor.id,
      bonusActionsRemaining: actor.runtime.resources.bonus_action ?? 0,
    },
  };
}

function boundObject(
  object: WorldObjectState,
  weaponCardId: string,
  held?: { actorId: string; hand: PactBladeHand },
): PactBladeBoundItemWorldObject {
  return {
    ...cloneJson(object),
    itemCardId: weaponCardId,
    ...(held ? { heldByActorId: held.actorId, heldInHand: held.hand } : {}),
  };
}

function canonicalActive(
  active: ActivePactBladeRuntimeState,
  lastDistanceBoardRevision: number | null,
  held?: { actorId: string; hand: PactBladeHand },
): PactBladeCanonicalActiveState {
  const bond = active.invocation.activeBond!;
  return {
    ...cloneJson(active),
    invocation: {
      ...cloneJson(active.invocation),
      activeBond: {
        ...cloneJson(bond),
        weaponCardId: active.weaponCardId,
        lastDistanceBoardRevision,
      },
    },
    weaponObject: boundObject(active.weaponObject, active.weaponCardId, held),
  };
}

function canonicalBondEvent(
  event: PactBladeBondedEvent,
  selection: PactBladeBondSelection,
): PactBladeWorldBondedEvent {
  const cloned = cloneJson(event);
  const {
    activeBlade: _runtimeActive,
    endedPreviousBond: _runtimePrevious,
    upsertWorldObjects: _runtimeObjects,
    ...base
  } = cloned;
  const held = selection.mode === 'conjure'
    ? { actorId: event.actorId, hand: selection.conjureHand! }
    : undefined;
  const activeBlade = canonicalActive(event.activeBlade, null, held);
  const previous = event.endedPreviousBond as PactBladeCanonicalBondState | undefined;
  return {
    ...base,
    mode: selection.mode,
    ...(selection.conjureHand ? { conjureHand: selection.conjureHand } : {}),
    ...(selection.touchFacts ? { touchFacts: cloneJson(selection.touchFacts) } : {}),
    activeBlade,
    ...(previous ? { endedPreviousBond: cloneJson(previous) } : {}),
    upsertWorldObjects: event.upsertWorldObjects.map((object) => (
      boundObject(object, event.activeBlade.weaponCardId, held)
    )),
  };
}

function canonicalDistanceEvent(
  event: PactBladeDistanceAdvancedEvent,
): PactBladeWorldDistanceAdvancedEvent {
  const previous = event.previousBond as PactBladeCanonicalBondState;
  const activeBlade = event.activeBlade
    ? canonicalActive(event.activeBlade, event.facts.boardRevision)
    : null;
  return {
    ...cloneJson(event),
    previousBond: cloneJson(previous),
    activeBlade,
    pactState: activeBlade
      ? cloneJson(activeBlade.invocation)
      : {
        ...cloneJson(event.pactState),
        activeBond: null,
      },
  };
}

function canonicalOwnerDeathEvent(
  event: PactBladeEndedOnOwnerDeathEvent,
): PactBladeWorldEndedOnOwnerDeathEvent {
  return {
    ...cloneJson(event),
    previousBond: cloneJson(event.previousBond as PactBladeCanonicalBondState),
    pactState: {
      ...cloneJson(event.pactState),
      activeBond: null,
    },
  };
}

export function planPactBladeBondTransition(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  selection: PactBladeBondSelection;
}): PactBladeWorldBondPlan {
  const resolved = context(input);
  if (resolved.issue) return resolved.issue;
  if (!input.selection || typeof input.selection !== 'object'
    || !['conjure', 'touch_existing'].includes(input.selection.mode)
    || !nonBlank(input.selection.weaponCardId)
    || !nonBlank(input.selection.weaponObjectId)) {
    return rejected('InvalidWorldState', 'Pact Blade bond selection is malformed');
  }
  if (input.selection.mode === 'conjure'
    && !['main_hand', 'off_hand'].includes(input.selection.conjureHand ?? '')) {
    return rejected('InvalidWorldState', 'A conjured Pact Blade requires an explicit hand');
  }
  if (input.selection.mode === 'touch_existing' && input.selection.conjureHand !== undefined) {
    return rejected('InvalidWorldState', 'An existing touched weapon does not accept a conjured hand');
  }
  const derived = catalogCard(input.catalog, input.selection.weaponCardId);
  if (derived.issue) return derived.issue;
  if (input.selection.mode === 'conjure' && input.selection.touchFacts !== undefined) {
    return rejected('InvalidTouchFacts', 'Conjuring a Pact Blade does not accept touch facts');
  }
  if (input.selection.mode === 'touch_existing') {
    const issue = touchFactsIssue(input.selection.touchFacts);
    if (issue) return rejected('InvalidTouchFacts', issue);
  }
  if (input.selection.mode === 'conjure') {
    const replaceableObjectId = resolved.invocation!.activeBond?.conjured
      ? resolved.invocation!.activeBond.weaponObjectId
      : undefined;
    const occupant = Object.values(input.world.objects).find((object) => (
      object.id !== replaceableObjectId
      && object.heldByActorId === input.actorId
      && object.heldInHand === input.selection.conjureHand
    ));
    if (occupant) {
      return rejected(
        'InvalidWorldState',
        `Cannot conjure Pact Blade into occupied ${input.selection.conjureHand}`,
      );
    }
  }
  const turn = turnAuthority(input.world, resolved.actor!);
  if (turn.issue) return rejected('InvalidTurnState', turn.issue);
  const objectIds = [
    ...(resolved.invocation!.activeBond
      ? [resolved.invocation!.activeBond.weaponObjectId]
      : []),
    ...(input.selection.mode === 'touch_existing'
      ? [input.selection.weaponObjectId]
      : []),
  ];
  const authority = worldAuthority(
    input.world,
    objectIds,
    input.selection.mode === 'touch_existing' ? input.selection.weaponObjectId : undefined,
    input.selection.mode === 'touch_existing' ? input.actorId : undefined,
  );
  if (typeof authority === 'string') return rejected('InvalidWorldState', authority);
  const result = transitionPactBladeRuntime(resolved.state!, {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'BondPactBlade',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: input.actorId,
    sourceEntityId: resolved.invocation!.sourceEntityId,
    mode: input.selection.mode,
    weaponCardId: input.selection.weaponCardId,
    weaponObjectId: input.selection.weaponObjectId,
    catalog: {
      provenance: PACT_BLADE_CATALOG_PROVENANCE,
      rulesetContentHash: input.world.ruleset.contentHash,
      cards: [derived.card!],
    },
    world: authority,
    turn: turn.turn!,
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  const runtimeEvent = result.transition.event as PactBladeBondedEvent;
  return {
    status: 'applied',
    transition: result.transition,
    event: canonicalBondEvent(runtimeEvent, input.selection),
  };
}

export function planPactBladeAttackProjection(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  selection: PactBladeAttackSelection;
}): PactBladeWorldAttackPlan {
  const resolved = context(input);
  if (resolved.issue) return resolved.issue;
  const active = resolved.invocation!.activeBond;
  if (!active) return rejected('BladeUnavailable', 'No active Pact Blade bond exists');
  if (!input.selection || typeof input.selection !== 'object'
    || !nonBlank(input.selection.weaponObjectId)
    || !['main_hand', 'off_hand'].includes(input.selection.hand)
    || !['str', 'dex', 'cha'].includes(input.selection.abilityChoice)
    || !PACT_BLADE_DAMAGE_TYPES.includes(input.selection.damageType)) {
    return rejected('IllegalAttackChoice', 'Pact Blade attack selection is malformed');
  }
  const object = itemObject(input.world, active.weaponObjectId);
  if (object?.carriedByActorId !== input.actorId
    || object.heldByActorId !== input.actorId
    || object.heldInHand !== input.selection.hand) {
    return rejected(
      'WeaponNotHeld',
      'The active Pact Blade object and Card must be held in the declared hand',
    );
  }
  const derived = catalogCard(input.catalog, active.weaponCardId);
  if (derived.issue) return derived.issue;
  // context() already proved the active object bridge; this lookup cannot
  // produce the string branch unless canonical state changes mid-command.
  const authority = worldAuthority(
    input.world,
    [active.weaponObjectId],
  ) as PactBladeWorldAuthority;
  const result = transitionPactBladeRuntime(resolved.state!, {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'ProjectPactBladeAttack',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: input.actorId,
    sourceEntityId: resolved.invocation!.sourceEntityId,
    weaponCardId: active.weaponCardId,
    weaponObjectId: input.selection.weaponObjectId,
    abilityChoice: input.selection.abilityChoice === 'cha' ? 'charisma' : 'ordinary',
    ordinaryAbility: input.selection.abilityChoice === 'dex' ? 'dex' : 'str',
    damageType: input.selection.damageType,
    catalog: {
      provenance: PACT_BLADE_CATALOG_PROVENANCE,
      rulesetContentHash: input.world.ruleset.contentHash,
      cards: [derived.card!],
    },
    world: authority,
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  return {
    status: 'applied',
    transition: result.transition,
    event: cloneJson(result.transition.event as PactBladeAttackProjectedEvent),
  };
}

function distanceFactsIssue(facts: PactBladeDistanceFacts): string | null {
  if (!facts || typeof facts !== 'object'
    || !['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)
    || !Number.isInteger(facts.boardRevision) || facts.boardRevision < 0
    || !Number.isFinite(facts.distanceFt) || facts.distanceFt < 0
    || !Number.isFinite(facts.elapsedSeconds) || facts.elapsedSeconds < 0) {
    return 'Pact Blade distance requires authoritative, non-negative explicit facts';
  }
  return null;
}

export function planPactBladeDistanceTransition(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  weaponObjectId: string;
  facts: PactBladeDistanceFacts;
}): PactBladeWorldDistancePlan {
  const resolved = context(input);
  if (resolved.issue) return resolved.issue;
  const active = resolved.invocation!.activeBond;
  if (!active) return rejected('BladeUnavailable', 'No active Pact Blade bond exists');
  const issue = distanceFactsIssue(input.facts);
  if (issue) return rejected('InvalidDistanceFacts', issue);
  const authority = worldAuthority(
    input.world,
    [active.weaponObjectId],
  ) as PactBladeWorldAuthority;
  const result = transitionPactBladeRuntime(resolved.state!, {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'AdvancePactBladeDistance',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: input.actorId,
    sourceEntityId: resolved.invocation!.sourceEntityId,
    world: authority,
    facts: {
      ...cloneJson(input.facts),
      actorId: input.actorId,
      weaponObjectId: input.weaponObjectId,
    },
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  return {
    status: 'applied',
    transition: result.transition,
    event: canonicalDistanceEvent(result.transition.event as PactBladeDistanceAdvancedEvent),
  };
}

function ownerDeathFactsIssue(facts: PactBladeOwnerDeathFacts): string | null {
  if (!facts || typeof facts !== 'object'
    || facts.type !== 'ActorDeathAdjudicated'
    || facts.provenance !== 'canonical_actor_lifecycle'
    || !nonBlank(facts.factId) || !nonBlank(facts.adjudicatedBy)
    || !Number.isInteger(facts.observedAtWorldRevision)) {
    return 'Pact Blade requires an authoritative explicit owner-death lifecycle fact';
  }
  return null;
}

export function planPactBladeOwnerDeathTransition(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  deathFact: PactBladeOwnerDeathFacts;
}): PactBladeWorldOwnerDeathPlan {
  const resolved = context(input);
  if (resolved.issue) return resolved.issue;
  const active = resolved.invocation!.activeBond;
  if (!active) return rejected('BladeUnavailable', 'No active Pact Blade bond exists');
  const issue = ownerDeathFactsIssue(input.deathFact);
  if (issue) return rejected('InvalidDeathFacts', issue);
  const authority = worldAuthority(
    input.world,
    [active.weaponObjectId],
  ) as PactBladeWorldAuthority;
  const result = transitionPactBladeRuntime(resolved.state!, {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    type: 'EndPactBladeOnOwnerDeath',
    commandId: input.commandId,
    expectedRevision: input.world.revision,
    rulesetContentHash: input.world.ruleset.contentHash,
    actorId: input.actorId,
    sourceEntityId: resolved.invocation!.sourceEntityId,
    world: authority,
    deathFact: cloneJson(input.deathFact),
  });
  if (result.status === 'rejected') return rejected(result.code, result.message);
  return {
    status: 'applied',
    transition: result.transition,
    event: canonicalOwnerDeathEvent(
      result.transition.event as PactBladeEndedOnOwnerDeathEvent,
    ),
  };
}

function spellComponents(action: RuleActionDefinition): {
  components?: { verbal: boolean; somatic: boolean; material: boolean };
  issue?: string;
} {
  if (action.kind !== 'spell') return { issue: `${action.id} is not an immutable spell action` };
  const components = action.spell.components;
  if (!components || typeof components.verbal !== 'boolean'
    || typeof components.somatic !== 'boolean' || typeof components.material !== 'boolean') {
    return { issue: `${action.id} lacks canonical V/S/M component metadata` };
  }
  return { components };
}

export function planPactBladeMaterialFocus(input: {
  world: WorldState;
  catalog: RulesCatalog;
  actorId: string;
  commandId: string;
  actionId: string;
  weaponObjectId: string;
  hand: PactBladeHand;
}): PactBladeMaterialFocusPlan {
  const resolved = context(input);
  if (resolved.issue) return resolved.issue;
  const active = resolved.invocation!.activeBond;
  if (!active) return rejected('BladeUnavailable', 'No active Pact Blade bond exists');
  if (input.weaponObjectId !== active.weaponObjectId) {
    return rejected('WeaponMismatch', 'Spell focus is not the active Pact Blade object');
  }
  const object = itemObject(input.world, active.weaponObjectId);
  if (object?.carriedByActorId !== input.actorId
    || object.heldByActorId !== input.actorId || object.heldInHand !== input.hand) {
    return rejected('WeaponNotHeld', 'The active Pact Blade must be held in the declared hand to use it as a focus');
  }
  const action = input.catalog.getAction(input.actionId);
  if (!action) return rejected('InvalidCatalogAction', `Unknown immutable action ${input.actionId}`);
  const derived = spellComponents(action);
  if (derived.issue) return rejected('InvalidCatalogAction', derived.issue);
  if (derived.components!.material !== true) {
    return rejected(
      'MaterialComponentRequired',
      'A Pact Blade substitutes only an eligible Material spell component',
    );
  }
  return {
    status: 'applied',
    event: {
      type: 'PactBladeMaterialFocusProjected',
      commandId: input.commandId,
      revision: input.world.revision + 1,
      worldRevision: input.world.revision,
      rulesetContentHash: input.world.ruleset.contentHash,
      actorId: input.actorId,
      sourceEntityId: resolved.invocation!.sourceEntityId,
      actionId: action.id,
      weaponObjectId: active.weaponObjectId,
      weaponCardId: active.weaponCardId,
      focusHand: input.hand,
      components: { ...derived.components!, material: true },
      replacesMaterialComponent: true,
      preservesCostlyAndConsumedMaterials: true,
      replacesVerbalComponent: false,
      replacesSomaticComponent: false,
    },
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

function committedInvocation(
  actor: ActorState,
  invocation: PactBladeCanonicalInvocationState,
): ActorState {
  return {
    ...actor,
    warlockPacts: {
      ...actor.warlockPacts,
      blade: cloneJson(invocation),
    },
  };
}

function authorizedEventActor(
  world: WorldState,
  event: {
    actorId: string;
    sourceEntityId: string;
    revision: number;
    worldRevision: number;
    rulesetContentHash: string;
  },
): { actor: ActorState; invocation: PactBladeCanonicalInvocationState } {
  const actor = world.actors[event.actorId];
  if (!actor) throw new Error(`Cannot evolve Pact Blade for unknown actor ${event.actorId}`);
  if (event.revision !== world.revision + 1
    || event.worldRevision !== world.revision
    || event.rulesetContentHash !== world.ruleset.contentHash) {
    throw new Error('Pact Blade event revision or ruleset provenance diverged');
  }
  const invocation = actorInvocation(actor);
  if (typeof invocation === 'string'
    || invocation.sourceEntityId !== event.sourceEntityId
    || !actor.capabilities.featureSources?.[PACT_BLADE_STATE_CAPABILITY]
      ?.includes(event.sourceEntityId)) {
    throw new Error('Pact Blade event does not belong to an actor-owned invocation');
  }
  return { actor, invocation };
}

/** Apply a handler-authorized bond event without requiring a process-local catalog. */
export function applyAuthorizedPactBladeBonded(
  world: WorldState,
  event: PactBladeWorldBondedEvent,
): WorldState {
  const { actor, invocation } = authorizedEventActor(world, event);
  const previous = invocation.activeBond;
  if ((previous === null) !== (event.endedPreviousBond === undefined)
    || (previous !== null && !same(previous, event.endedPreviousBond))) {
    throw new Error('Pact Blade bond event does not replace exactly the active bond');
  }
  if (event.activeBlade.invocation.activeBond === null
    || event.activeBlade.invocation.sourceEntityId !== invocation.sourceEntityId
    || event.activeBlade.invocation.ownerActorId !== actor.id
    || event.activeBlade.weaponCardId !== event.activeBlade.invocation.activeBond.weaponCardId
    || event.activeBlade.weaponObject.id !== event.activeBlade.invocation.activeBond.weaponObjectId
    || event.activeBlade.weaponObject.itemCardId !== event.activeBlade.weaponCardId
    || event.setPactBondObjectId !== event.activeBlade.weaponObject.id) {
    throw new Error('Pact Blade bond event has an inconsistent active Card/Object bridge');
  }
  const expectedRemoved = previous?.conjured ? [previous.weaponObjectId] : [];
  const expectedCleared = previous ? [previous.weaponObjectId] : [];
  if (!same([...event.removedWorldObjectIds].sort(), expectedRemoved.sort())
    || !same([...event.clearPactBondObjectIds].sort(), expectedCleared.sort())
    || event.actionCost.kind !== 'bonus_action' || event.actionCost.amount !== 1
    || (actor.runtime.resources.bonus_action ?? 0) < 1) {
    throw new Error('Pact Blade bond event has invalid replacement or Bonus Action effects');
  }
  const activeObject = event.activeBlade.weaponObject;
  if (event.mode === 'conjure') {
    const survivingOccupant = Object.values(world.objects).find((object) => (
      !expectedRemoved.includes(object.id)
      && object.heldByActorId === actor.id
      && object.heldInHand === event.conjureHand
    ));
    if (world.objects[activeObject.id]
      || !event.conjureHand
      || survivingOccupant !== undefined
      || event.upsertWorldObjects.length !== 1
      || !same(event.upsertWorldObjects[0], activeObject)
      || activeObject.heldByActorId !== actor.id
      || activeObject.heldInHand !== event.conjureHand
      || activeObject.carriedByActorId !== actor.id
      || !event.activeBlade.invocation.activeBond.conjured) {
      throw new Error('Pact Blade conjure event has invalid held-item authority');
    }
  } else {
    if (event.conjureHand !== undefined
      || event.upsertWorldObjects.length !== 0
      || event.touchFacts?.touched !== true
      || event.activeBlade.invocation.activeBond.conjured
      || !same(world.objects[activeObject.id], activeObject)) {
      throw new Error('Pact Blade touch event does not preserve the existing item instance');
    }
  }
  const objects = { ...world.objects };
  for (const objectId of expectedRemoved) delete objects[objectId];
  if (event.mode === 'conjure') objects[activeObject.id] = cloneJson(activeObject);
  const nextActor = committedInvocation(actor, event.activeBlade.invocation);
  nextActor.runtime = {
    ...actor.runtime,
    resources: {
      ...actor.runtime.resources,
      bonus_action: actor.runtime.resources.bonus_action! - 1,
    },
  };
  return {
    ...world,
    actors: { ...world.actors, [actor.id]: nextActor },
    objects,
  };
}

/** Apply a handler-authorized distance observation using only persisted facts. */
export function applyAuthorizedPactBladeDistanceAdvanced(
  world: WorldState,
  event: PactBladeWorldDistanceAdvancedEvent,
): WorldState {
  const { actor, invocation } = authorizedEventActor(world, event);
  const previous = invocation.activeBond;
  if (!previous || !same(previous, event.previousBond)
    || event.facts.actorId !== actor.id
    || event.facts.weaponObjectId !== previous.weaponObjectId) {
    throw new Error('Pact Blade distance event does not observe the active bond');
  }
  const expected = advancePactBladeDistance(
    previous,
    invocation.lifecyclePolicy,
    event.facts.distanceFt,
    event.facts.elapsedSeconds,
    event.facts.boardRevision,
  );
  const expectedRemoved = expected === null && previous.conjured ? [previous.weaponObjectId] : [];
  if (event.bondEnded !== (expected === null)
    || !same(event.pactState.activeBond, expected)
    || !same([...event.removedWorldObjectIds].sort(), expectedRemoved.sort())
    || (expected === null) !== (event.activeBlade === null)) {
    throw new Error('Pact Blade distance event diverges from its persisted threshold facts');
  }
  if (event.activeBlade
    && (!same(event.activeBlade.invocation.activeBond, expected)
      || event.activeBlade.weaponObject.id !== previous.weaponObjectId
      || event.activeBlade.weaponObject.itemCardId !== previous.weaponCardId)) {
    throw new Error('Pact Blade distance event has an inconsistent active Card/Object bridge');
  }
  const objects = { ...world.objects };
  for (const objectId of expectedRemoved) delete objects[objectId];
  return {
    ...world,
    actors: {
      ...world.actors,
      [actor.id]: committedInvocation(actor, event.pactState),
    },
    objects,
  };
}

/** Apply a handler-authorized explicit owner-death consequence. */
export function applyAuthorizedPactBladeEndedOnOwnerDeath(
  world: WorldState,
  event: PactBladeWorldEndedOnOwnerDeathEvent,
): WorldState {
  const { actor, invocation } = authorizedEventActor(world, event);
  const previous = invocation.activeBond;
  const factIssue = ownerDeathFactsIssue(event.deathFact);
  if (!previous || factIssue
    || event.deathFact.actorId !== actor.id
    || event.deathFact.observedAtWorldRevision !== world.revision
    || event.deathFact.rulesetContentHash !== world.ruleset.contentHash
    || !same(previous, event.previousBond)
    || event.pactState.activeBond !== null) {
    throw new Error('Pact Blade owner-death event does not dismiss the exact active bond');
  }
  const expectedRemoved = previous.conjured ? [previous.weaponObjectId] : [];
  if (!same([...event.removedWorldObjectIds].sort(), expectedRemoved.sort())) {
    throw new Error('Pact Blade owner-death event removes foreign world objects');
  }
  const objects = { ...world.objects };
  for (const objectId of expectedRemoved) delete objects[objectId];
  return {
    ...world,
    actors: {
      ...world.actors,
      [actor.id]: committedInvocation(actor, event.pactState),
    },
    objects,
  };
}

/**
 * Reducer-side preview. The caller still owns the generic world revision,
 * processed-command ledger, and event envelope commit.
 */
export function evolvePactBladeBonded(
  world: WorldState,
  catalog: RulesCatalog,
  event: PactBladeWorldBondedEvent,
): WorldState {
  const replanned = planPactBladeBondTransition({
    world,
    catalog,
    actorId: event.actorId,
    commandId: event.commandId,
    selection: {
      mode: event.mode,
      weaponCardId: event.activeBlade.weaponCardId,
      weaponObjectId: event.activeBlade.weaponObject.id,
      ...(event.conjureHand ? { conjureHand: event.conjureHand } : {}),
      ...(event.touchFacts ? { touchFacts: event.touchFacts } : {}),
    },
  });
  if (replanned.status === 'rejected') {
    throw new Error(`Invalid Pact Blade bond event: ${replanned.code}: ${replanned.message}`);
  }
  if (!same(replanned.event, event)) throw new Error('Pact Blade bond event diverges from canonical planning');
  return applyAuthorizedPactBladeBonded(world, event);
}

export function evolvePactBladeDistanceAdvanced(
  world: WorldState,
  catalog: RulesCatalog,
  event: PactBladeWorldDistanceAdvancedEvent,
): WorldState {
  const replanned = planPactBladeDistanceTransition({
    world,
    catalog,
    actorId: event.actorId,
    commandId: event.commandId,
    weaponObjectId: event.facts.weaponObjectId,
    facts: {
      factsSource: event.facts.factsSource,
      boardRevision: event.facts.boardRevision,
      distanceFt: event.facts.distanceFt,
      elapsedSeconds: event.facts.elapsedSeconds,
    },
  });
  if (replanned.status === 'rejected') {
    throw new Error(`Invalid Pact Blade distance event: ${replanned.code}: ${replanned.message}`);
  }
  if (!same(replanned.event, event)) {
    throw new Error('Pact Blade distance event diverges from canonical planning');
  }
  return applyAuthorizedPactBladeDistanceAdvanced(world, event);
}

export function evolvePactBladeEndedOnOwnerDeath(
  world: WorldState,
  catalog: RulesCatalog,
  event: PactBladeWorldEndedOnOwnerDeathEvent,
): WorldState {
  const replanned = planPactBladeOwnerDeathTransition({
    world,
    catalog,
    actorId: event.actorId,
    commandId: event.commandId,
    deathFact: cloneJson(event.deathFact),
  });
  if (replanned.status === 'rejected') {
    throw new Error(`Invalid Pact Blade owner-death event: ${replanned.code}: ${replanned.message}`);
  }
  if (!same(replanned.event, event)) {
    throw new Error('Pact Blade owner-death event diverges from canonical planning');
  }
  return applyAuthorizedPactBladeEndedOnOwnerDeath(world, event);
}

/**
 * The Card bridge is fixed at WorldObjectCreated. Generic patches may update
 * location, carrier, aura, and similar state, but can never install, replace,
 * or remove itemCardId after object creation.
 */
export function pactBladeItemCardPatchIssue(input: {
  current: PactBladeItemWorldObject;
  patch: Partial<PactBladeItemWorldObject>;
  unset?: readonly (keyof PactBladeItemWorldObject)[];
}): string | null {
  if (Object.hasOwn(input.patch, 'itemCardId')
    && input.patch.itemCardId !== input.current.itemCardId) {
    return 'WorldObject itemCardId is immutable after creation';
  }
  if (input.unset?.includes('itemCardId')) {
    return 'WorldObject itemCardId cannot be unset after creation';
  }
  return null;
}

/** Catalog-aware structural guard for migration and reload checks. */
export function pactBladeActorWorldIssue(
  world: WorldState,
  catalog: RulesCatalog,
  actorId: string,
): string | null {
  const actor = world.actors[actorId];
  if (!actor) return `Unknown actor ${actorId}`;
  const sources = actor.capabilities.featureSources?.[PACT_BLADE_STATE_CAPABILITY];
  const preview = actor as ActorPactPreview;
  const invocation = preview.warlockPacts?.blade;
  if (!invocation) return sources ? 'Actor Pact Blade invocation state is missing' : null;
  const resolved = context({ world, catalog, actorId });
  return resolved.issue?.message ?? null;
}

export function pactBladeBondIntegrationFixture(plan: AppliedPactBladeWorldBondPlan) {
  return createPactBladeCanonicalWorldIntegrationFixture(plan.transition);
}

export function pactBladeDistanceIntegrationFixture(plan: AppliedPactBladeWorldDistancePlan) {
  return createPactBladeCanonicalWorldIntegrationFixture(plan.transition);
}

export function pactBladeOwnerDeathIntegrationFixture(plan: AppliedPactBladeWorldOwnerDeathPlan) {
  return createPactBladeCanonicalWorldIntegrationFixture(plan.transition);
}

export function pactBladeAttackIntegrationFixture(plan: AppliedPactBladeWorldAttackPlan) {
  return createPactBladeCanonicalAttackIntegrationFixture(plan.transition);
}
