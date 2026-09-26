import type {CombatBeat} from '../solo-combat/presentation';
import type {CombatAreaState, GridPosition, SoloCombatState} from '../solo-combat/types';
import type {projectileTrajectory} from '../solo-combat/projectilePreview';

/** Read-only cell projection shared by the 2D and 3D renderers. Rules stay in
 * the existing tactical helpers; the scene only displays these facts. */
export interface BattleCellView {
  position: GridPosition;
  label: string;
  terrainLabel: string;
  areaLabel: string;
  actorId?: string;
  tokenAnchor: boolean;
  footprint: number;
  blocked: boolean;
  reachable: boolean;
  areaPreview: boolean;
  route: boolean;
  unavailable: boolean;
  active: boolean;
  inspected: boolean;
  highlighted: boolean;
  dead: boolean;
  light?: {label: string; radiusFt: number};
  illusion?: {id: string; label: string; description: string; form: 'sound' | 'image'};
  groundItems: {id: string; name: string; imageUrl?: string}[];
  areas: CombatAreaState[];
}

export interface BattleSceneProps {
  state: SoloCombatState;
  actorId: string;
  activeId: string;
  feedback: CombatBeat | null;
  cells: BattleCellView[];
  hovered: GridPosition | null;
  ghost: {position: GridPosition; footprint: number; available: boolean} | null;
  route: {points: GridPosition[]; footprint: number; available: boolean} | null;
  trajectory: ReturnType<typeof projectileTrajectory> | null;
  onHover: (position: GridPosition | null, anchor?: {x: number; y: number}) => void;
  onCell: (position: GridPosition) => void;
  onInspectActor?: (actorId: string) => void;
  onUnavailable: (reason: string) => void;
  onDeclineAdditionalMovement?: () => void;
}
