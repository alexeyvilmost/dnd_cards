import type { EngineEvent } from '../mvp/contracts';
import type {
  RuleActionDefinition,
  RuleHazardDefinition,
  SpatialFacts,
  WorldState,
} from '../rules-core/domain';
import type { SheetCanonicalResourceBindings } from '../character/sheetCanonicalWorld';
import type { Action, Spell } from '../types';

export const SOLO_COMBAT_KEY = 'solo_combat_v1' as const;
export const SOLO_COMBAT_SCHEMA_VERSION = 1 as const;
export const TACTICAL_CELL_FT = 5;
export const TACTICAL_WIDTH = 12;
export const TACTICAL_HEIGHT = 10;

export interface GridPosition { x: number; y: number }

export interface TacticalToken {
  actorId: string;
  templateId?: string;
  tokenUrl?: string;
  color: string;
  position: GridPosition;
}

export interface InitiativeEntry {
  actorId: string;
  die: number;
  bonus: number;
  total: number;
}

export type CombatLogTone =
  | 'neutral'
  | 'enemy-damage'
  | 'ally-damage'
  | 'ally-death'
  | 'ally-healing'
  | 'ally-critical'
  | 'hostile-critical';

/**
 * Replayable log projection retaining the rules event's authoritative actor and
 * target envelope. Bare EngineEvent arrays from early schema-v1 saves are
 * migrated into this shape by persistence.ts.
 */
export interface CombatLogEventRecord {
  kind: 'engine' | 'death';
  ordinal: number;
  sourceActorId: string;
  actorId: string;
  targetIds: string[];
  event?: EngineEvent;
  facts?: Record<string, unknown>;
}

export interface CombatLogEntry {
  id: string;
  round: number;
  actorId: string;
  /** Names as they were when the entry was created (summons can reuse an id in a new form). */
  actorNames?: Record<string, string>;
  text: string;
  records?: CombatLogEventRecord[];
  /** Legacy schema-v1 representation. New entries use `records`. */
  events?: EngineEvent[];
}

export interface CombatActionPresentation {
  imageUrl?: string | null;
  description?: string;
  sourceLabel?: string;
  entityType?: 'action' | 'spell';
  entityId?: string;
  /** Exact content entities used by SheetActionLine previews on the character sheet. */
  actionRef?: Action;
  spellRef?: Spell;
}

export interface CombatActorTraitPresentation {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  mechanics: Record<string, unknown>;
}

/** Immutable content snapshot used to present a persisted encounter actor. */
export interface CombatActorPresentation {
  templateId?: string;
  description?: string;
  size?: string;
  creatureType?: string;
  alignment?: string;
  challengeRating?: string;
  source?: string;
  actionIds: string[];
  traits: CombatActorTraitPresentation[];
}

export type CombatAreaEvent = 'created' | 'enter' | 'exit' | 'start_turn' | 'end_turn';

/** A board-owned persistent area. Creature conditions remain ordinary catalog
 * effects; this record only owns geometry, lifecycle and hazard provenance. */
export interface CombatAreaState {
  id: string;
  name: string;
  zoneType: string;
  sourceActorId: string;
  sourceActionId: string;
  sourceEntityIds: [string, ...string[]];
  origin: GridPosition;
  cells: GridPosition[];
  duration:
    | { type: 'permanent' }
    | { type: 'rounds'; roundsLeft: number }
    | { type: 'concentration' };
  triggers: CombatAreaEvent[];
  hazard?: RuleHazardDefinition;
  difficultTerrain?: boolean;
  heavilyObscured?: boolean;
  insideCondition?: string;
  notice?: string;
  triggeredTurnKeys?: string[];
}

export interface PendingCombatAreaTrigger {
  areaId: string;
  actorId: string;
  event: CombatAreaEvent;
  turnKey: string;
}

/**
 * Board-owned continuation for optional source-side abilities which become
 * legal only after an observable combat event (for example a Goliath's
 * post-hit Giant Ancestry rider). Keeping this in the persisted combat state
 * makes refresh/retry deterministic and prevents triggered actions from being
 * exposed as proactive hotbar buttons.
 */
export interface PendingTriggeredAction {
  event: 'hit' | 'miss';
  sourceActorId: string;
  sourceActionId: string;
  targetIds: string[];
  optionActionIds: string[];
}

/** Persisted player choice which must be answered before StartTurn can commit. */
export interface PendingTurnStartGrappleDamage {
  actorId: string;
  capabilityId: string;
  targetActorIds: string[];
}

export interface PendingInterception {
  sourceActorId: string;
  targetActorId: string;
  interceptorActorIds: string[];
  incomingDamage: number;
  targetHpBefore: { current: number; max: number; temp: number };
}

export interface PendingInterceptionTrigger {
  sourceActorId: string;
  sourceActionId: string;
  targetActorId: string;
  targetHpBefore: { current: number; max: number; temp: number };
  logIndex: number;
}

export interface SoloCombatState {
  schemaVersion: typeof SOLO_COMBAT_SCHEMA_VERSION;
  characterId: string;
  runtimeRevision: number;
  world: WorldState;
  catalogActions: RuleActionDefinition[];
  /** Persisted UI projection from the same data-driven entities as the sheet. */
  actionPresentation?: Record<string, CombatActionPresentation>;
  /** Board-owned allegiance. Equal side ids are allies; different ids are enemies. */
  sideByActorId: Record<string, string>;
  /** Persisted content presentation for actors whose source rows are not re-fetched. */
  actorPresentation: Record<string, CombatActorPresentation>;
  /** Character-sheet actors controlled by the current user in this encounter. */
  controlledCharacterIds?: string[];
  /** Per-character hotbar capabilities. `playerActionIds` remains the schema-v1 owner alias. */
  playerActionIdsByActor?: Record<string, string[]>;
  playerActionIds: string[];
  certifiedPlayerActionIdsByActor?: Record<string, string[]>;
  certifiedPlayerActionIds: string[];
  monsterActionIds: Record<string, string[]>;
  opportunityActionIds: Record<string, string>;
  dashActionId?: string;
  participantRuntimeRevisions?: Record<string, number>;
  resourceBindingsByActor?: Record<string, SheetCanonicalResourceBindings>;
  resourceBindings: SheetCanonicalResourceBindings;
  tokens: Record<string, TacticalToken>;
  /** Board-owned positions for durable world objects which have a tactical token. */
  worldObjectPositions?: Record<string, GridPosition>;
  /** Persistent tactical areas, separate from creature-owned runtime effects. */
  combatAreas?: Record<string, CombatAreaState>;
  pendingCombatAreaTriggers?: PendingCombatAreaTrigger[];
  /** EndTurn is split only when a controlled creature must answer an area save. */
  pendingCombatAreaTurnContinuation?: { endingActorId: string; startingActorId: string };
  boardRevision: number;
  movementRemainingFt: Record<string, number>;
  initiativeBonuses: Record<string, number>;
  initiative: InitiativeEntry[];
  log: CombatLogEntry[];
  pendingTriggeredAction?: PendingTriggeredAction;
  pendingTurnStartGrappleDamage?: PendingTurnStartGrappleDamage;
  pendingInterception?: PendingInterception;
  pendingInterceptionTrigger?: PendingInterceptionTrigger;
  /** Alert owners waiting to accept or decline their post-Initiative swap before turn one starts. */
  pendingAlertSwapActorIds?: string[];
  outcome: 'active' | 'victory' | 'defeat';
}

export function controlledCharacterIds(state: Pick<SoloCombatState, 'characterId' | 'controlledCharacterIds'>): string[] {
  return state.controlledCharacterIds?.length
    ? [...new Set(state.controlledCharacterIds)]
    : [state.characterId];
}

export function isControlledCharacter(
  state: Pick<SoloCombatState, 'characterId' | 'controlledCharacterIds'>,
  actorId: string,
): boolean {
  return controlledCharacterIds(state).includes(actorId);
}

/** Player-turn authority also covers an owned, present familiar without
 * pretending that the familiar is a persisted character-sheet participant. */
export function isPlayerControlledCombatActor(
  state: Pick<SoloCombatState, 'characterId' | 'controlledCharacterIds' | 'world'>,
  actorId: string,
): boolean {
  if (isControlledCharacter(state, actorId)) return true;
  const actor = state.world.actors[actorId];
  const ownerActorId = actor?.kind === 'summonedActor'
    && actor.familiarState?.presence === 'present'
    ? actor.familiarState.ownerActorId
    : null;
  return ownerActorId !== null && controlledCharacterIds(state).includes(ownerActorId);
}

export function playerActionIdsFor(
  state: Pick<SoloCombatState, 'characterId' | 'playerActionIds' | 'playerActionIdsByActor'>,
  actorId: string,
): string[] {
  return state.playerActionIdsByActor?.[actorId]
    ?? (actorId === state.characterId ? state.playerActionIds : []);
}

export interface TacticalActionSelection {
  actionId: string;
  mode: 'single' | 'area';
}

export function combatRelation(
  state: { sideByActorId?: Record<string, string> },
  sourceActorId: string,
  targetActorId: string,
): SpatialFacts['relation'] {
  if (sourceActorId === targetActorId) return 'self';
  const sourceSide = state.sideByActorId?.[sourceActorId];
  const targetSide = state.sideByActorId?.[targetActorId];
  if (!sourceSide || !targetSide) return 'neutral';
  return sourceSide === targetSide ? 'ally' : 'enemy';
}

export function spatialFacts(
  state: Pick<SoloCombatState, 'tokens' | 'boardRevision' | 'sideByActorId' | 'combatAreas'>,
  sourceActorId: string,
  targetActorId: string,
): SpatialFacts {
  const source = state.tokens[sourceActorId]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!source || !target) throw new Error('На поле отсутствует участник действия');
  const obscured = Object.values(state.combatAreas ?? {}).some((area) => {
    if (!area.heavilyObscured) return false;
    const cells = new Set(area.cells.map((cell) => `${cell.x}:${cell.y}`));
    const steps = Math.max(Math.abs(target.x - source.x), Math.abs(target.y - source.y));
    for (let index = 0; index <= steps; index += 1) {
      const ratio = steps === 0 ? 0 : index / steps;
      const cell = `${Math.round(source.x + (target.x - source.x) * ratio)}:${Math.round(source.y + (target.y - source.y) * ratio)}`;
      if (cells.has(cell)) return true;
    }
    return false;
  });
  return {
    factsSource: 'board',
    boardRevision: state.boardRevision,
    distanceFt: Math.max(Math.abs(source.x - target.x), Math.abs(source.y - target.y)) * TACTICAL_CELL_FT,
    lineOfSight: !obscured,
    cover: 'none',
    relation: combatRelation(state, sourceActorId, targetActorId),
    canSeeTarget: !obscured,
    targetCanSeeSource: !obscured,
  };
}
