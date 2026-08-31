import { migrateWorldState } from '../rules-core/worldMigration';
import {
  SOLO_COMBAT_KEY,
  SOLO_COMBAT_SCHEMA_VERSION,
  controlledCharacterIds,
  type SoloCombatState,
} from './types';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function presentationEntityImage(
  value: NonNullable<SoloCombatState['actionPresentation']>[string],
): string | undefined {
  return value.actionRef?.image_url || value.spellRef?.image_url || undefined;
}

/**
 * Action rows can carry large base64 images. The combat projection historically
 * stored the same image both as `imageUrl` and inside the exact entity used by
 * the hover card, doubling every image on each persisted turn. Keep the exact
 * entity snapshot and omit only a byte-for-byte duplicate top-level copy.
 */
function compactActionPresentation(
  current: SoloCombatState['actionPresentation'],
): SoloCombatState['actionPresentation'] {
  if (!current) return current;
  return Object.fromEntries(Object.entries(current).map(([actionId, raw]) => {
    const value = clone(raw);
    const entityImage = presentationEntityImage(value);
    if (value.imageUrl && entityImage === value.imageUrl) delete value.imageUrl;
    return [actionId, value];
  }));
}

function restoreActionPresentationImages(value: SoloCombatState): SoloCombatState {
  const current = value.actionPresentation;
  if (!current) return value;
  let migrated: SoloCombatState['actionPresentation'] | undefined;
  for (const [actionId, raw] of Object.entries(current)) {
    if (raw.imageUrl != null) continue;
    const entityImage = presentationEntityImage(raw);
    if (!entityImage) continue;
    migrated ??= { ...current };
    migrated[actionId] = { ...raw, imageUrl: entityImage };
  }
  return migrated ? { ...value, actionPresentation: migrated } : value;
}

function restoreScopedActionPresentation(value: SoloCombatState): SoloCombatState {
  const current = value.actionPresentation;
  if (!current) return value;
  let migrated: SoloCombatState['actionPresentation'] | undefined;

  const actionIds = [...new Set([
    ...value.playerActionIds,
    ...Object.values(value.playerActionIdsByActor ?? {}).flat(),
  ])];
  for (const actionId of actionIds) {
    if (current[actionId]) continue;
    const separator = actionId.indexOf('@');
    if (separator <= 0) continue;
    const entityId = actionId.slice(0, separator);
    const legacy = current[entityId]
      ?? Object.values(current).find((entry) => entry.entityId === entityId);
    if (!legacy) continue;
    migrated ??= { ...current };
    migrated[actionId] = legacy;
  }

  return migrated ? { ...value, actionPresentation: migrated } : value;
}

/** Fill additive schema-v1 combat fields without invalidating an in-progress fight. */
function migrateCombatPresentation(value: SoloCombatState): SoloCombatState {
  const controlledIds = controlledCharacterIds(value);
  const controlledSet = new Set(controlledIds);
  const savedSides = value.sideByActorId ?? {};
  const partySide = savedSides[value.characterId] ?? 'side:party';
  const sideByActorId = Object.fromEntries(Object.keys(value.world.actors).map((actorId) => [
    actorId,
    savedSides[actorId] ?? (controlledSet.has(actorId) ? partySide : 'side:opposition'),
  ]));
  const savedPresentation = value.actorPresentation ?? {};
  const actorPresentation = Object.fromEntries(Object.values(value.world.actors).map((actor) => {
    const existing = savedPresentation[actor.id];
    if (existing) return [actor.id, existing];
    return [actor.id, {
      templateId: value.tokens[actor.id]?.templateId,
      creatureType: actor.character.creatureType,
      actionIds: [...actor.capabilities.actionIds],
      traits: (actor.passives ?? []).map((mechanics, index) => ({
        id: `legacy:${actor.id}:${index}`,
        name: `Особенность ${index + 1}`,
        mechanics: clone(mechanics),
      })),
    }];
  }));
  const log = (Array.isArray(value.log) ? value.log : []).map((entry) => {
    if (entry.records?.length || !entry.events?.length) return entry;
    return {
      ...entry,
      records: entry.events.map((event, ordinal) => ({
        kind: 'engine' as const,
        ordinal,
        sourceActorId: entry.actorId,
        actorId: entry.actorId,
        targetIds: [],
        event,
      })),
    };
  });
  return {
    ...value,
    controlledCharacterIds: controlledIds,
    playerActionIdsByActor: value.playerActionIdsByActor ?? { [value.characterId]: [...value.playerActionIds] },
    certifiedPlayerActionIdsByActor: value.certifiedPlayerActionIdsByActor
      ?? { [value.characterId]: [...value.certifiedPlayerActionIds] },
    participantRuntimeRevisions: value.participantRuntimeRevisions
      ?? { [value.characterId]: value.runtimeRevision },
    resourceBindingsByActor: value.resourceBindingsByActor
      ?? { [value.characterId]: clone(value.resourceBindings) },
    worldObjectPositions: value.worldObjectPositions ?? {},
    sideByActorId,
    actorPresentation,
    log,
  };
}

export function readSoloCombatState(
  turnState: Record<string, unknown> | null | undefined,
  characterId: string,
  runtimeRevision: number,
): SoloCombatState | null {
  const raw = turnState?.[SOLO_COMBAT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = clone(raw as SoloCombatState);
  if (value.schemaVersion !== SOLO_COMBAT_SCHEMA_VERSION
    || value.characterId !== characterId
    || !value.world || !Array.isArray(value.catalogActions)
    || !value.tokens || !Array.isArray(value.initiative)) return null;
  return restoreActionPresentationImages(restoreScopedActionPresentation(migrateCombatPresentation({
    ...value,
    runtimeRevision,
    world: migrateWorldState(value.world),
  })));
}

/**
 * A retained combat can outlive non-combat character updates (for example,
 * adding an action from the sheet). Keep the encounter snapshot, but rebase
 * optimistic-lock revisions to the freshly loaded participant rows before the
 * next combat command is persisted.
 */
export function rebaseSoloCombatParticipantRuntimeRevisions(
  state: SoloCombatState,
  runtimeRevisions: Readonly<Record<string, number>>,
): SoloCombatState {
  const participantRuntimeRevisions = { ...(state.participantRuntimeRevisions ?? {}) };
  for (const actorId of controlledCharacterIds(state)) {
    const revision = runtimeRevisions[actorId];
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(`Runtime revision for combat participant ${actorId} is unavailable`);
    }
    participantRuntimeRevisions[actorId] = revision;
  }
  return {
    ...state,
    runtimeRevision: participantRuntimeRevisions[state.characterId],
    participantRuntimeRevisions,
  };
}

export function writeSoloCombatState(
  turnState: Record<string, unknown> | null | undefined,
  state: SoloCombatState | null,
): Record<string, unknown> {
  const next = { ...(turnState ?? {}) };
  if (state) next[SOLO_COMBAT_KEY] = clone({
    ...state,
    actionPresentation: compactActionPresentation(state.actionPresentation),
  });
  else delete next[SOLO_COMBAT_KEY];
  return next;
}
