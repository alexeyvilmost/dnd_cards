import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import {
  createWorld,
  type ActorState,
  type DecisionResponse,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type UncommittedRuleEvent,
  type WorldState,
} from '../rules-core/domain';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
} from '../rules-core/determinism';
import { InMemoryRulesSession } from '../rules-core/session';
import { migrateWorldState } from '../rules-core/worldMigration';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import type {
  CharacterRuntimeCommandEvent,
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import { runtimeInventoryPayload, writeRulesEngineRuntimeTurnState } from './runtime';
import {
  projectSheetCanonicalPersistence,
  type SheetCanonicalResourceBindings,
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import {
  buildSheetCanonicalCommand,
  stageSheetScenarioObjects,
  type SheetCanonicalCommandInput,
} from './sheetCanonicalCommand';
import type { ForgeCharacter } from './types';
import { acceptedRuntimeCommandReceipt } from './sheetRuntimeCommand';
import {
  actionBelongsToSheetCombatSlice,
  assertCertifiedSheetCombatActorAccess,
  assertCertifiedSheetCombatActorAction,
  assertCertifiedSheetCombatAction,
  loadCertifiedSheetCombatCatalog,
  type CertifiedSheetCombatCatalog,
} from './sheetCombatCertifiedCatalog';

export const SHEET_COMBAT_SESSION_KEY = 'canonical_pending_combat_v1' as const;
export const SHEET_COMBAT_SESSION_SCHEMA_VERSION = 1 as const;

const COMBAT_PRIMITIVES = new Set([
  'burning_hands_objects',
  'area_object_push',
  'magic_missile',
  WEAPON_ATTACK_PRIMITIVE,
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
]);

export interface SheetCombatSessionEnvelope {
  schemaVersion: typeof SHEET_COMBAT_SESSION_SCHEMA_VERSION;
  /** Authority marker shared by the atomic participant mirrors. */
  continuationOwnerCharacterId: string;
  sourceCharacterId: string;
  participantRevisions: Record<string, number>;
  catalogActions: RuleActionDefinition[];
  certifiedActionIdsByActor: Record<string, string[]>;
  resourceBindingsByActor: Record<string, SheetCanonicalResourceBindings>;
  world: WorldState;
}

export interface SheetCombatSession {
  sourceCharacterId: string;
  participantRevisions: Record<string, number>;
  catalogActions: readonly RuleActionDefinition[];
  certifiedActionIdsByActor: Readonly<Record<string, readonly string[]>>;
  resourceBindingsByActor: Readonly<Record<string, SheetCanonicalResourceBindings>>;
  world: WorldState;
  catalog: RulesCatalog;
}

export interface SheetCombatParticipantSeed {
  character: ForgeCharacter;
  canonical: SheetCanonicalRuntime;
}

export interface SheetCombatTransition {
  commandId: string;
  /** Present for rules-core transitions; omitted only by the legacy-genesis projection bridge. */
  command?: GameCommand;
  /** Exact ordered intents for transitions composed from several domain commands. */
  commands?: readonly GameCommand[];
  base: SheetCombatSession;
  nextWorld: WorldState;
  events: readonly UncommittedRuleEvent[];
}

export interface PreparedSheetCombatCommit {
  request: CharacterRuntimeCommandRequest;
  committedSession: SheetCombatSession;
}

export interface SheetRuntimeCommandStore {
  commit(request: CharacterRuntimeCommandRequest): Promise<CharacterRuntimeCommandResponse>;
}

export class SheetCombatSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetCombatSessionError';
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneActorActionIds(
  value: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value).map(([actorId, actionIds]) => [
    actorId,
    [...actionIds],
  ]));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primitiveType(action: RuleActionDefinition): string {
  const primitive = object(action.mechanics.primitive);
  const type = primitive?.type;
  if (typeof type !== 'string' || !COMBAT_PRIMITIVES.has(type)) {
    throw new SheetCombatSessionError(
      `${action.id} is not an approved pending-combat primitive`,
    );
  }
  return type;
}

function canonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function newSheetRuntimeCommandId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function requireRuntimeRevision(character: ForgeCharacter): number {
  const revision = character.runtime_revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
    throw new SheetCombatSessionError(
      `${character.id} has no server-owned runtime_revision`,
    );
  }
  return Number(revision);
}

function buildCatalog(actions: readonly RuleActionDefinition[]): RulesCatalog {
  const byId = new Map<string, RuleActionDefinition>();
  for (const raw of actions) {
    const action = clone(raw);
    const previous = byId.get(action.id);
    if (previous && canonicalStringify(previous) !== canonicalStringify(action)) {
      throw new SheetCombatSessionError(`Conflicting combat action ${action.id}`);
    }
    byId.set(action.id, action);
  }
  const stable = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    getAction: (id) => byId.get(id),
    listActions: () => stable,
  };
}

function actorReferencesForObject(value: WorldState['objects'][string]): string[] {
  return [...new Set([
    value.ownerActorId,
    value.carriedByActorId,
    value.sourceActorId,
    value.heldByActorId,
    value.attunedToActorId,
    value.illumination?.sourceActorId,
    ...(value.prestidigitation ?? []).map((entry) => entry.sourceActorId),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0))];
}

function participantActorClosure(world: WorldState, participantId: string): Set<string> {
  if (!world.actors[participantId]) {
    throw new SheetCombatSessionError(`Canonical world misses participant ${participantId}`);
  }
  const closure = new Set([participantId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const actor of Object.values(world.actors)) {
      const ownerId = actor.familiarState?.ownerActorId;
      const referencedByChain = [...closure].some((ownerActorId) => (
        world.actors[ownerActorId]?.warlockPacts?.chain?.activeFamiliar?.actorId === actor.id
      ));
      if (!closure.has(actor.id) && ((ownerId && closure.has(ownerId)) || referencedByChain)) {
        if (actor.kind !== 'summonedActor') {
          throw new SheetCombatSessionError(
            `${actor.id} is owned by ${participantId} but is not a summonedActor`,
          );
        }
        closure.add(actor.id);
        changed = true;
      }
    }
  }
  const unowned = Object.values(world.actors).filter((actor) => !closure.has(actor.id));
  if (unowned.length) {
    throw new SheetCombatSessionError(
      `${participantId} canonical world contains actors outside its ownership closure: ${unowned.map((actor) => actor.id).join(', ')}`,
    );
  }
  return closure;
}

function insertExact<T>(
  target: Record<string, T>,
  id: string,
  value: T,
  label: string,
): void {
  const previous = target[id];
  if (previous !== undefined && canonicalStringify(previous) !== canonicalStringify(value)) {
    throw new SheetCombatSessionError(`Conflicting ${label} ${id} across participant worlds`);
  }
  if (previous === undefined) target[id] = clone(value);
}

/**
 * Merge every participant-owned lifecycle closure. This deliberately carries
 * summoned familiars, Pact objects, concentrations and durable ledgers; a
 * fresh two-sheet encounter must not erase facts that existed before it.
 */
export function mergeSheetCombatParticipantWorlds(input: {
  seeds: readonly SheetCombatParticipantSeed[];
  ruleset: WorldState['ruleset'];
  worldId: string;
  sceneMode: 'exploration' | 'encounter';
}): WorldState {
  const participantIds = input.seeds.map(({ character }) => character.id);
  const participantSet = new Set(participantIds);
  const actors: Record<string, ActorState> = {};
  const objects: WorldState['objects'] = {};
  const concentrations: WorldState['concentrations'] = {};
  const attackActions: WorldState['attackActions'] = {};
  const grapples: WorldState['grapples'] = {};
  const processedCommandIds = new Set<string>();
  let revision = 0;
  let logicalClock = 0;

  for (const { character, canonical } of input.seeds) {
    const sourceWorld = migrateWorldState(clone(canonical.world));
    if (sourceWorld.pendingResolution) {
      throw new SheetCombatSessionError(
        `${character.id} has an unresolved canonical decision; resolve it before opening a new combat`,
      );
    }
    const closure = participantActorClosure(sourceWorld, character.id);
    revision = Math.max(revision, sourceWorld.revision);
    logicalClock = Math.max(logicalClock, sourceWorld.logicalClock);
    sourceWorld.processedCommandIds.forEach((id) => processedCommandIds.add(id));

    for (const actorId of closure) {
      insertExact(actors, actorId, sourceWorld.actors[actorId], 'actor');
    }
    for (const object of Object.values(sourceWorld.objects)) {
      const references = actorReferencesForObject(object);
      if (!references.length) {
        throw new SheetCombatSessionError(
          `${character.id} canonical object ${object.id} has no participant ownership/source reference`,
        );
      }
      if (!references.some((actorId) => closure.has(actorId))
        || references.some((actorId) => !closure.has(actorId))) {
        throw new SheetCombatSessionError(
          `${character.id} canonical object ${object.id} crosses its participant ownership closure`,
        );
      }
      insertExact(objects, object.id, object, 'world object');
    }
    for (const [sourceActorId, concentration] of Object.entries(sourceWorld.concentrations)) {
      if (sourceActorId !== concentration.sourceActorId || !closure.has(sourceActorId)
        || concentration.effectLinks.some((link) => !closure.has(link.actorId))) {
        throw new SheetCombatSessionError(
          `${character.id} concentration ${concentration.id} crosses its participant ownership closure`,
        );
      }
      insertExact(concentrations, sourceActorId, concentration, 'concentration');
    }
    for (const [id, attackAction] of Object.entries(sourceWorld.attackActions)) {
      if (!closure.has(attackAction.actorId)) {
        throw new SheetCombatSessionError(
          `${character.id} Attack action ${id} crosses its participant ownership closure`,
        );
      }
      insertExact(attackActions, id, attackAction, 'Attack action');
    }
    for (const [id, grapple] of Object.entries(sourceWorld.grapples)) {
      if (!closure.has(grapple.grapplerActorId) || !closure.has(grapple.targetActorId)) {
        throw new SheetCombatSessionError(
          `${character.id} grapple ${id} crosses its participant ownership closure`,
        );
      }
      insertExact(grapples, id, grapple, 'grapple');
    }
  }

  for (const actorId of participantSet) {
    if (!actors[actorId]) throw new SheetCombatSessionError(`Merged world misses ${actorId}`);
  }
  for (const object of Object.values(objects)) {
    const missing = actorReferencesForObject(object).filter((actorId) => !actors[actorId]);
    if (missing.length) {
      throw new SheetCombatSessionError(
        `Merged object ${object.id} references missing actors: ${missing.join(', ')}`,
      );
    }
  }

  const base = createWorld({
    id: input.worldId,
    ruleset: clone(input.ruleset),
    actors: Object.values(actors).map(clone),
    objects: Object.values(objects).map(clone),
  });
  const world: WorldState = {
    ...base,
    revision,
    logicalClock,
    processedCommandIds: [...processedCommandIds].sort(),
    concentrations: clone(concentrations),
    attackActions: clone(attackActions),
    grapples: clone(grapples),
  };
  if (input.sceneMode === 'encounter') {
    world.scene = {
      mode: 'encounter',
      initiative: [...participantIds],
      activeIndex: 0,
      round: 1,
      turnStarted: true,
    };
  }
  return migrateWorldState(world);
}

function sessionFromEnvelope(envelope: SheetCombatSessionEnvelope): SheetCombatSession {
  const catalogActions = clone(envelope.catalogActions)
    .sort((left, right) => left.id.localeCompare(right.id));
  const world = migrateWorldState(clone(envelope.world));
  const participantIds = Object.keys(envelope.participantRevisions).sort();
  const certifiedActorIds = Object.keys(envelope.certifiedActionIdsByActor).sort();
  const resourceBindingActorIds = Object.keys(envelope.resourceBindingsByActor).sort();
  if (envelope.continuationOwnerCharacterId !== envelope.sourceCharacterId
    || !world.actors[envelope.continuationOwnerCharacterId]
    || !world.actors[envelope.sourceCharacterId]
    || participantIds.some((actorId) => !world.actors[actorId])
    || canonicalStringify(certifiedActorIds) !== canonicalStringify(participantIds)
    || canonicalStringify(resourceBindingActorIds) !== canonicalStringify(participantIds)) {
    throw new SheetCombatSessionError('Combat continuation participants do not match its world');
  }
  for (const [actorId, revision] of Object.entries(envelope.participantRevisions)) {
    if (!Number.isSafeInteger(revision) || revision < 0 || !world.actors[actorId]) {
      throw new SheetCombatSessionError('Combat continuation has an invalid runtime revision');
    }
  }
  const catalog = buildCatalog(catalogActions);
  for (const [actorId, actionIds] of Object.entries(envelope.certifiedActionIdsByActor)) {
    if (!Array.isArray(actionIds)
      || actionIds.some((actionId) => typeof actionId !== 'string' || !catalog.getAction(actionId))
      || new Set(actionIds).size !== actionIds.length) {
      throw new SheetCombatSessionError(
        `Combat continuation has an invalid certified action set for ${actorId}`,
      );
    }
  }
  if (world.ruleset.contentHash !== envelope.world.ruleset.contentHash) {
    throw new SheetCombatSessionError('Combat continuation ruleset is inconsistent');
  }
  return {
    sourceCharacterId: envelope.sourceCharacterId,
    participantRevisions: clone(envelope.participantRevisions),
    catalogActions,
    certifiedActionIdsByActor: clone(envelope.certifiedActionIdsByActor),
    resourceBindingsByActor: clone(envelope.resourceBindingsByActor),
    world,
    catalog,
  };
}

export function readSheetCombatSession(
  turnState: Record<string, unknown> | null | undefined,
  viewingCharacterId: string,
): SheetCombatSession | null {
  const raw = turnState?.[SHEET_COMBAT_SESSION_KEY];
  if (raw == null) return null;
  const value = object(raw);
  if (value?.schemaVersion !== SHEET_COMBAT_SESSION_SCHEMA_VERSION
    || typeof value.continuationOwnerCharacterId !== 'string'
    || typeof value.sourceCharacterId !== 'string'
    || !object(value.participantRevisions)
    || !Array.isArray(value.catalogActions)
    || !object(value.certifiedActionIdsByActor)
    || !object(value.resourceBindingsByActor)
    || !object(value.world)) {
    throw new SheetCombatSessionError('Persisted combat continuation is malformed');
  }
  const session = sessionFromEnvelope(value as unknown as SheetCombatSessionEnvelope);
  if (!(viewingCharacterId in session.participantRevisions)) {
    throw new SheetCombatSessionError('This sheet is not a combat-continuation participant');
  }
  return session;
}

export function writeSheetCombatSession(
  turnState: Record<string, unknown> | null | undefined,
  session: SheetCombatSession,
): Record<string, unknown> {
  const envelope: SheetCombatSessionEnvelope = {
    schemaVersion: SHEET_COMBAT_SESSION_SCHEMA_VERSION,
    continuationOwnerCharacterId: session.sourceCharacterId,
    sourceCharacterId: session.sourceCharacterId,
    participantRevisions: clone(session.participantRevisions),
    catalogActions: clone([...session.catalogActions]),
    certifiedActionIdsByActor: cloneActorActionIds(session.certifiedActionIdsByActor),
    resourceBindingsByActor: clone(session.resourceBindingsByActor),
    world: migrateWorldState(clone(session.world)),
  };
  return { ...(turnState ?? {}), [SHEET_COMBAT_SESSION_KEY]: envelope };
}

export function assertCertifiedSheetCombatSession(
  session: SheetCombatSession,
  certified: CertifiedSheetCombatCatalog,
): void {
  if (canonicalStringify(session.world.ruleset) !== canonicalStringify(certified.ruleset)) {
    throw new SheetCombatSessionError('Combat continuation belongs to another certified release');
  }
  for (const action of session.catalogActions) {
    assertCertifiedSheetCombatAction(action, certified);
  }
  for (const actorId of Object.keys(session.participantRevisions)) {
    const actor = session.world.actors[actorId];
    const relevantActionIds = session.certifiedActionIdsByActor[actorId];
    if (!actor) {
      throw new SheetCombatSessionError(`Combat continuation misses participant actor ${actorId}`);
    }
    if (!relevantActionIds) {
      throw new SheetCombatSessionError(`Combat continuation misses actor access for ${actor.id}`);
    }
    assertCertifiedSheetCombatActorAccess(actor, relevantActionIds, certified);
  }
}

export async function createSheetCombatSession(input: {
  source: SheetCombatParticipantSeed;
  targets: readonly SheetCombatParticipantSeed[];
  /** The local two-sheet canary models a real ordered encounter without using online encounter state. */
  sceneMode?: 'exploration' | 'encounter';
}): Promise<SheetCombatSession> {
  const seeds = [input.source, ...input.targets];
  if (new Set(seeds.map(({ character }) => character.id)).size !== seeds.length) {
    throw new SheetCombatSessionError('Combat participants must be unique');
  }
  if (seeds.some(({ character }) => character.current_encounter_id)) {
    throw new SheetCombatSessionError(
      'Linked online-encounter characters require encounter authority',
    );
  }
  for (const { character, canonical } of seeds) {
    if (canonical.actorId !== character.id || !canonical.world.actors[character.id]) {
      throw new SheetCombatSessionError(`Canonical actor does not match ${character.id}`);
    }
    requireRuntimeRevision(character);
  }

  const certified = await loadCertifiedSheetCombatCatalog();
  const systemIds = new Set(seeds.map(({ character }) => character.system_id));
  if (systemIds.size !== 1 || !systemIds.has(certified.ruleset.systemId)) {
    throw new SheetCombatSessionError('Combat participants use incompatible rulesets');
  }
  const certifiedActionsByActor = Object.fromEntries(seeds.map(({ character, canonical }) => [
    character.id,
    canonical.actions
      .filter(actionBelongsToSheetCombatSlice)
      .map((action) => assertCertifiedSheetCombatActorAction(
        action,
        canonical.world.actors[character.id],
        certified,
      )),
  ]));
  const actions = Object.values(certifiedActionsByActor).flat();
  for (const { character, canonical } of seeds) {
    const actor = canonical.world.actors[character.id];
    const relevantActionIds = certifiedActionsByActor[character.id].map((action) => action.id);
    assertCertifiedSheetCombatActorAccess(actor, relevantActionIds, certified);
  }
  const catalog = buildCatalog(actions);
  const catalogActions = [...(catalog.listActions?.() ?? [])];
  const ruleset = clone(certified.ruleset);
  const world = mergeSheetCombatParticipantWorlds({
    seeds,
    ruleset,
    worldId: `sheet-combat:${input.source.character.id}`,
    sceneMode: input.sceneMode ?? 'encounter',
  });
  const session = {
    sourceCharacterId: input.source.character.id,
    participantRevisions: Object.fromEntries(seeds.map(({ character }) => [
      character.id,
      requireRuntimeRevision(character),
    ])),
    catalogActions: clone(catalogActions),
    certifiedActionIdsByActor: Object.fromEntries(Object.entries(certifiedActionsByActor).map(
      ([actorId, actorActions]) => [actorId, actorActions.map((action) => action.id).sort()],
    )),
    resourceBindingsByActor: Object.fromEntries(seeds.map(({ character, canonical }) => [
      character.id,
      clone(canonical.resourceBindings),
    ])),
    world,
    catalog,
  };
  assertCertifiedSheetCombatSession(session, certified);
  return session;
}

function acceptedTransition(
  base: SheetCombatSession,
  command: GameCommand,
  rng: () => number,
): SheetCombatTransition {
  if (!canonicalUuid(command.commandId)) {
    throw new SheetCombatSessionError('Runtime command id must be a canonical UUID');
  }
  const session = new InMemoryRulesSession(base.world, base.catalog, {
    rng,
    clock: createLogicalClock(base.world.logicalClock),
    nextId: createSequentialIdFactory(`sheet-combat:${command.commandId}`),
  });
  const result = session.dispatch(command);
  if (result.status === 'rejected') {
    throw new SheetCombatSessionError(`${result.code}: ${result.message}`);
  }
  return {
    commandId: command.commandId,
    command: clone(command),
    commands: [clone(command)],
    base,
    nextWorld: session.getState(),
    events: session.getEvents(),
  };
}

function requireSingleWeaponTarget(input: {
  world: WorldState;
  actorId: string;
  action: RuleActionDefinition;
  primitive: typeof WEAPON_ATTACK_PRIMITIVE | typeof LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE;
  declaration: SheetCanonicalCommandInput;
}): { targetActorId: string; facts: NonNullable<SheetCanonicalCommandInput['factsByTarget']>[string] } {
  const validated = buildSheetCanonicalCommand({
    world: input.world,
    actorId: input.actorId,
    action: input.action,
    primitiveType: input.primitive,
    commandId: 'validation',
    declaration: input.declaration,
  });
  if (validated.type !== 'UseAction'
    || input.declaration.targetIds.length !== 1
    || input.declaration.spell
    || input.declaration.pactBlade
    || input.declaration.worldInput
    || input.declaration.scenarioObjects?.length) {
    throw new SheetCombatSessionError(
      `${input.action.id} requires exactly one actor target and no spell/world declaration`,
    );
  }
  if (input.primitive === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE
    && Object.keys(input.declaration.choices ?? {}).length) {
    throw new SheetCombatSessionError('The Light extra attack accepts no user-authored choices');
  }
  const targetActorId = input.declaration.targetIds[0];
  const facts = input.declaration.factsByTarget?.[targetActorId];
  if (!facts) throw new SheetCombatSessionError(`Missing explicit weapon facts for ${targetActorId}`);
  return { targetActorId, facts: clone(facts) };
}

function currentEncounterTurnKey(world: WorldState, actorId: string): string | null {
  return world.scene.mode === 'encounter'
    ? `encounter:${world.scene.round}:${world.scene.activeIndex}:${actorId}`
    : null;
}

function qualifyingLightAttackActionId(world: WorldState, actorId: string): string {
  const turnKey = currentEncounterTurnKey(world, actorId);
  if (!turnKey) {
    throw new SheetCombatSessionError(
      'The sheet Light-extra-attack bridge requires an ordered encounter turn',
    );
  }
  const candidates = Object.values(world.attackActions).filter((entry) => (
    entry.actorId === actorId
    && entry.turnKey === turnKey
    && entry.status === 'completed'
    && !entry.blockedByResolutionId
    && entry.sequence.attacksRemaining === 0
    && entry.sequence.entries.some((attack) => attack.kind === 'weapon_attack')
  ));
  if (candidates.length !== 1) {
    throw new SheetCombatSessionError(
      `Light extra attack requires exactly one completed qualifying Attack ledger; got ${candidates.length}`,
    );
  }
  return candidates[0].id;
}

function acceptedWeaponTransition(input: {
  base: SheetCombatSession;
  actorId: string;
  action: RuleActionDefinition;
  primitive: typeof WEAPON_ATTACK_PRIMITIVE | typeof LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE;
  declaration: SheetCanonicalCommandInput;
  commandId: string;
  rng: () => number;
}): SheetCombatTransition {
  if (!canonicalUuid(input.commandId)) {
    throw new SheetCombatSessionError('Runtime command id must be a canonical UUID');
  }
  const { targetActorId, facts } = requireSingleWeaponTarget({
    ...input,
    world: input.base.world,
  });
  const actor = input.base.world.actors[input.actorId];
  const handSlot = input.primitive === WEAPON_ATTACK_PRIMITIVE ? 'main_hand' : 'off_hand';
  const weaponCardId = actor.runtime.equipment[handSlot];
  if (!weaponCardId) {
    throw new SheetCombatSessionError(`${input.action.id} requires a weapon in ${handSlot}`);
  }
  const session = new InMemoryRulesSession(input.base.world, input.base.catalog, {
    rng: input.rng,
    clock: createLogicalClock(input.base.world.logicalClock),
    nextId: createSequentialIdFactory(`sheet-combat:${input.commandId}`),
  });
  const commands: GameCommand[] = [];
  const dispatch = (command: GameCommand): void => {
    const result = session.dispatch(command);
    if (result.status === 'rejected') {
      throw new SheetCombatSessionError(`${result.code}: ${result.message}`);
    }
    commands.push(clone(command));
  };

  if (input.primitive === WEAPON_ATTACK_PRIMITIVE) {
    let open = Object.values(session.getState().attackActions).filter((entry) => (
      entry.actorId === input.actorId && entry.status === 'open'
    ));
    if (!open.length) {
      const current = session.getState();
      dispatch({
        schemaVersion: 1,
        type: 'BeginAttackAction',
        commandId: derivedSheetCombatCommandId(input.commandId),
        expectedRevision: current.revision,
        rulesetContentHash: current.ruleset.contentHash,
        actorId: input.actorId,
        declaredActionId: input.action.id,
      });
      open = Object.values(session.getState().attackActions).filter((entry) => (
        entry.actorId === input.actorId && entry.status === 'open'
      ));
    }
    if (open.length !== 1) {
      throw new SheetCombatSessionError(
        `Weapon attack requires exactly one open Attack ledger; got ${open.length}`,
      );
    }
    const current = session.getState();
    dispatch({
      schemaVersion: 1,
      type: 'PerformWeaponAttack',
      commandId: input.commandId,
      expectedRevision: current.revision,
      rulesetContentHash: current.ruleset.contentHash,
      actorId: input.actorId,
      attackActionId: open[0].id,
      declaredActionId: input.action.id,
      weaponCardId,
      targetActorId,
      facts,
      ...(input.declaration.choices ? { choices: clone(input.declaration.choices) } : {}),
    });
  } else {
    const current = session.getState();
    dispatch({
      schemaVersion: 1,
      type: 'PerformLightWeaponExtraAttack',
      commandId: input.commandId,
      expectedRevision: current.revision,
      rulesetContentHash: current.ruleset.contentHash,
      actorId: input.actorId,
      attackActionId: qualifyingLightAttackActionId(current, input.actorId),
      declaredActionId: input.action.id,
      weaponCardId,
      targetActorId,
      facts,
    });
  }
  return {
    commandId: input.commandId,
    command: commands[commands.length - 1],
    commands,
    base: input.base,
    nextWorld: session.getState(),
    events: session.getEvents(),
  };
}

function derivedSheetCombatCommandId(commandId: string): string {
  const replacement = commandId.endsWith('0') ? '1' : '0';
  return `${commandId.slice(0, -1)}${replacement}`;
}

export function executeSheetCombatAction(input: {
  session: SheetCombatSession;
  actorId?: string;
  actionId: string;
  declaration: SheetCanonicalCommandInput;
  commandId: string;
  rng: () => number;
}): SheetCombatTransition {
  if (input.session.world.pendingResolution) {
    throw new SheetCombatSessionError('The pending combat decision must be resolved first');
  }
  const action = input.session.catalog.getAction(input.actionId);
  if (!action) throw new SheetCombatSessionError(`Combat catalog misses ${input.actionId}`);
  const actorId = input.actorId ?? input.session.sourceCharacterId;
  if (!input.session.world.actors[actorId]) {
    throw new SheetCombatSessionError(`Combat world misses acting participant ${actorId}`);
  }
  if (!input.session.certifiedActionIdsByActor[actorId]?.includes(input.actionId)) {
    throw new SheetCombatSessionError(
      `${actorId} is not certified to execute combat action ${input.actionId}`,
    );
  }
  const primitive = primitiveType(action);
  const staged = stageSheetScenarioObjects(
    input.session.world,
    input.declaration.scenarioObjects,
  );
  const stagedSession: SheetCombatSession = { ...input.session, world: staged };
  if (primitive === WEAPON_ATTACK_PRIMITIVE
    || primitive === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE) {
    return acceptedWeaponTransition({
      base: stagedSession,
      actorId,
      action,
      primitive,
      declaration: input.declaration,
      commandId: input.commandId,
      rng: input.rng,
    });
  }
  const command = buildSheetCanonicalCommand({
    world: staged,
    actorId,
    action,
    primitiveType: primitive,
    commandId: input.commandId,
    declaration: input.declaration,
  });
  return acceptedTransition(stagedSession, command, input.rng);
}

export function resolveSheetCombatDecision(input: {
  session: SheetCombatSession;
  commandId: string;
  response: DecisionResponse;
  rng: () => number;
}): SheetCombatTransition {
  const pending = input.session.world.pendingResolution;
  if (!pending) throw new SheetCombatSessionError('There is no pending combat decision');
  const actorId = pending.type === 'concentration_save'
    || pending.type === 'escape_grapple'
    ? pending.actorId
    : pending.targetActorId;
  const command: GameCommand = {
    schemaVersion: 1,
    type: 'ResolveDecision',
    commandId: input.commandId,
    expectedRevision: input.session.world.revision,
    rulesetContentHash: input.session.world.ruleset.contentHash,
    actorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: clone(input.response),
  };
  return acceptedTransition(input.session, command, input.rng);
}

export function advanceSheetCombatTurn(input: {
  session: SheetCombatSession;
  commandId: string;
  type: 'EndTurn' | 'StartTurn';
  actorId: string;
}): SheetCombatTransition {
  const command: GameCommand = {
    schemaVersion: 1,
    type: input.type,
    commandId: input.commandId,
    expectedRevision: input.session.world.revision,
    rulesetContentHash: input.session.world.ruleset.contentHash,
    actorId: input.actorId,
  };
  return acceptedTransition(input.session, command, () => {
    throw new SheetCombatSessionError('Turn transitions cannot consume RNG');
  });
}

function runtimeEvents(
  events: readonly UncommittedRuleEvent[],
  participantIds: ReadonlySet<string>,
): CharacterRuntimeCommandEvent[] {
  const rows: CharacterRuntimeCommandEvent[] = [];
  for (const envelope of events) {
    if (envelope.payload.type !== 'EngineEventRecorded') continue;
    const recipients = new Set([
      envelope.payload.actorId,
      ...envelope.payload.targetIds,
    ]);
    for (const characterId of [...recipients].sort()) {
      if (!participantIds.has(characterId)) continue;
      const payload = clone(envelope.payload.event) as EngineEvent;
      rows.push({ character_id: characterId, type: payload.type, payload });
    }
  }
  return rows;
}

export function sheetCombatEngineEvents(
  events: readonly UncommittedRuleEvent[],
): EngineEvent[] {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded'
      ? [clone(event.payload.event) as EngineEvent]
      : []
  ));
}

function runtimePatch(input: {
  character: ForgeCharacter;
  runtime: RuntimeState;
  committedSession: SheetCombatSession;
  resourceBindings: SheetCanonicalResourceBindings;
}) {
  const projection = projectSheetCanonicalPersistence({
    runtime: input.runtime,
    currency: input.character.currency,
    resourceBindings: input.resourceBindings,
  });
  const turnState = writeSheetCombatSession(writeRulesEngineRuntimeTurnState(
    input.character.turn_state,
    projection.runtime,
  ), input.committedSession);
  const inventoryItems = runtimeInventoryPayload(projection.runtime);
  const persistedInventory = input.character.inventory_items ?? [];
  const inventoryChanged = canonicalStringify(inventoryItems)
    !== canonicalStringify(persistedInventory);
  return {
    current_hp: projection.runtime.hp.current,
    ...(inventoryChanged ? { inventory_items: inventoryItems } : {}),
    resources: clone(projection.runtime.resources),
    max_resources: clone(projection.runtime.maxResources),
    active_effects: clone(projection.runtime.activeEffects),
    turn_state: turnState,
    ...(projection.currency ? { currency: projection.currency } : {}),
  };
}

export function prepareSheetCombatCommit(input: {
  transition: SheetCombatTransition;
  characters: Readonly<Record<string, ForgeCharacter>>;
}): PreparedSheetCombatCommit {
  const ids = Object.keys(input.transition.base.participantRevisions).sort();
  const nextRevisions = Object.fromEntries(ids.map((id) => [
    id,
    input.transition.base.participantRevisions[id] + 1,
  ]));
  const committedSession = sessionFromEnvelope({
    schemaVersion: SHEET_COMBAT_SESSION_SCHEMA_VERSION,
    continuationOwnerCharacterId: input.transition.base.sourceCharacterId,
    sourceCharacterId: input.transition.base.sourceCharacterId,
    participantRevisions: nextRevisions,
    catalogActions: clone([...input.transition.base.catalogActions]),
    certifiedActionIdsByActor: cloneActorActionIds(
      input.transition.base.certifiedActionIdsByActor,
    ),
    resourceBindingsByActor: clone(input.transition.base.resourceBindingsByActor),
    world: clone(input.transition.nextWorld),
  });
  const participants = ids.map((characterId) => {
    const character = input.characters[characterId];
    const actor = input.transition.nextWorld.actors[characterId];
    if (!character || !actor) {
      throw new SheetCombatSessionError(`Combat commit misses participant ${characterId}`);
    }
    const expected = input.transition.base.participantRevisions[characterId];
    if (requireRuntimeRevision(character) !== expected) {
      throw new SheetCombatSessionError(
        `${characterId} runtime revision changed; rebuild the command from fresh sheets`,
      );
    }
    return {
      character_id: characterId,
      expected_runtime_revision: expected,
      patch: runtimePatch({
        character,
        runtime: actor.runtime,
        committedSession,
        resourceBindings: input.transition.base.resourceBindingsByActor[characterId] ?? {},
      }),
    };
  });
  const ruleset = input.transition.nextWorld.ruleset;
  return {
    committedSession,
    request: {
      command_id: input.transition.commandId,
      ruleset_ref: {
        system_id: ruleset.systemId,
        release_id: ruleset.releaseId,
        content_hash: ruleset.contentHash,
        errata_version: ruleset.errataVersion,
      },
      participants,
      events: runtimeEvents(input.transition.events, new Set(ids)),
    },
  };
}

export async function commitPreparedSheetCombat(
  store: SheetRuntimeCommandStore,
  prepared: PreparedSheetCombatCommit,
): Promise<CharacterRuntimeCommandResponse> {
  return store.commit(clone(prepared.request));
}

/** Receipt proof only. A replay caller must refetch current participants before updating UI. */
export function acceptedSheetCombatCharacters(
  prepared: PreparedSheetCombatCommit,
  response: CharacterRuntimeCommandResponse,
): Record<string, ForgeCharacter> {
  try {
    return acceptedRuntimeCommandReceipt(prepared.request, response);
  } catch (cause) {
    throw new SheetCombatSessionError(
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
