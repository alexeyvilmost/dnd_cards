import type { EngineEvent } from '../mvp/contracts';
import type {
  RuleActionDefinition,
  SpatialFacts,
  WorldState,
} from '../rules-core/domain';
import type { SheetCanonicalResourceBindings } from '../character/sheetCanonicalWorld';

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

export interface CombatLogEntry {
  id: string;
  round: number;
  actorId: string;
  text: string;
  events?: EngineEvent[];
}

export interface SoloCombatState {
  schemaVersion: typeof SOLO_COMBAT_SCHEMA_VERSION;
  characterId: string;
  runtimeRevision: number;
  world: WorldState;
  catalogActions: RuleActionDefinition[];
  playerActionIds: string[];
  certifiedPlayerActionIds: string[];
  monsterActionIds: Record<string, string[]>;
  opportunityActionIds: Record<string, string>;
  dashActionId?: string;
  resourceBindings: SheetCanonicalResourceBindings;
  tokens: Record<string, TacticalToken>;
  boardRevision: number;
  movementRemainingFt: Record<string, number>;
  initiativeBonuses: Record<string, number>;
  initiative: InitiativeEntry[];
  log: CombatLogEntry[];
  outcome: 'active' | 'victory' | 'defeat';
}

export interface TacticalActionSelection {
  actionId: string;
  mode: 'single' | 'area';
}

export function spatialFacts(
  state: Pick<SoloCombatState, 'tokens' | 'boardRevision'>,
  sourceActorId: string,
  targetActorId: string,
): SpatialFacts {
  const source = state.tokens[sourceActorId]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!source || !target) throw new Error('На поле отсутствует участник действия');
  return {
    factsSource: 'board',
    boardRevision: state.boardRevision,
    distanceFt: Math.max(Math.abs(source.x - target.x), Math.abs(source.y - target.y)) * TACTICAL_CELL_FT,
    lineOfSight: true,
    cover: 'none',
    relation: sourceActorId === targetActorId ? 'self' : 'enemy',
    canSeeTarget: true,
    targetCanSeeSource: true,
  };
}
