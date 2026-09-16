import type {CombatAreaState, GridPosition, SoloCombatState} from './types';
import type {SpatialFacts, RuleSavingHazardDefinition, RuleAutomaticHazardDefinition} from '../rules-core/domain';
import {footprintCells, footprintFits} from './footprint';

export interface BattleMapFeature extends GridPosition {
  id: string; name: string; width: number; height: number;
  sprite: 'trunk'|'wall'|'table'|'mud'|'web'|'water'|'fire'|'barrel'|'stone'|'rock'|'counter'|'rubble';
  /** Authored occupied cells, relative to the feature rectangle (e.g. river bends). */
  cells?: GridPosition[];
  /** Baked scenery has mechanics but no second floating sprite over the background. */
  baked?: boolean;
  blocksMovement?: boolean; blocksSight?: boolean; cover?: 'half'|'three_quarters';
  zone?: {zoneType: string; triggers: CombatAreaState['triggers']; difficultTerrain?: boolean;
    lightlyObscured?: boolean; hazard?: Omit<RuleSavingHazardDefinition, 'id'|'name'|'sourceKind'|'sourceEntityIds'> | Omit<RuleAutomaticHazardDefinition, 'id'|'name'|'sourceKind'|'sourceEntityIds'>};
}
export interface BattleMapDefinition {
  id: string; name: string; description: string; width: number; height: number;
  background: string; maxFootprint: number; maxActors: number; features: BattleMapFeature[];
  artVersion?: 2;
  procedural?: {movable: string[]};
  generation?: {version: 'scatter-v1'; seed: number; attempt: number; templateId: string};
}
export type BoardState = {battleMap?: BattleMapDefinition};
export function boardDimensions(state: BoardState = {}) {return {width:state.battleMap?.width ?? 12,height:state.battleMap?.height ?? 10};}
export function boardCells(state: BoardState = {}): GridPosition[] {
  const {width,height}=boardDimensions(state);
  return Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width)}));
}
export function featureCells(feature: Pick<BattleMapFeature,'x'|'y'|'width'|'height'|'cells'>): GridPosition[] {
  if(feature.cells)return feature.cells.map(p=>({x:feature.x+p.x,y:feature.y+p.y}));
  return Array.from({length:feature.width*feature.height},(_,i)=>({x:feature.x+i%feature.width,y:feature.y+Math.floor(i/feature.width)}));
}
const obstacleCache=new WeakMap<BattleMapDefinition, ReadonlySet<string>>();
export function boardObstacles(state: BoardState): ReadonlySet<string> {
  const map=state.battleMap;
  if (!map) return new Set();
  let cells=obstacleCache.get(map);
  if (!cells) {cells=new Set(map.features.filter(f=>f.blocksMovement).flatMap(featureCells).map(p=>`${p.x}:${p.y}`));obstacleCache.set(map,cells);}
  return cells;
}
export function terrainFits(state: BoardState, position: GridPosition, size=1): boolean {
  const {width,height}=boardDimensions(state);
  return footprintFits(position,size,boardObstacles(state),width,height);
}
/** No corner cutting through a wall, including the full footprint of a giant. */
export function terrainStepFits(state: BoardState, from: GridPosition, to: GridPosition, size=1): boolean {
  if(!terrainFits(state,to,size))return false;
  if(from.x!==to.x&&from.y!==to.y) return terrainFits(state,{x:from.x,y:to.y},size)&&terrainFits(state,{x:to.x,y:from.y},size);
  return true;
}

function crosses(from: GridPosition,to: GridPosition,rect: BattleMapFeature): boolean {
  let lo=0,hi=1;
  for(const [a,d,min,max] of [[from.x,to.x-from.x,rect.x+.001,rect.x+rect.width-.001],[from.y,to.y-from.y,rect.y+.001,rect.y+rect.height-.001]]){
    if(Math.abs(d)<1e-9){if(a<min||a>max)return false;continue;}
    const l=(min-a)/d,r=(max-a)/d;lo=Math.max(lo,Math.min(l,r));hi=Math.min(hi,Math.max(l,r));if(lo>hi)return false;
  }
  return hi>0&&lo<1;
}
function corners(p:GridPosition,size:number):GridPosition[]{return [.05,size-.05].flatMap(x=>[.05,size-.05].map(y=>({x:p.x+x,y:p.y+y})));}

/** Best source corner to four target corners: no ray goes through a wall.
 * Low obstacles supply their declared cover but never erase sight. */
export function terrainSight(state:BoardState,from:GridPosition,to:GridPosition,sourceSize=1,targetSize=1): {blocked:boolean;cover:SpatialFacts['cover']} {
  const features=state.battleMap?.features.filter(f=>f.blocksSight||f.cover)??[];
  if(!features.length)return {blocked:false,cover:'none'};
  let best=6;
  for(const origin of corners(from,sourceSize)){
    let blocked=0,low=0;
    for(const target of corners(to,targetSize)){
      const crossed=features.filter(f=>f.cells?featureCells(f).some(p=>crosses(origin,target,{...f,...p,width:1,height:1})):crosses(origin,target,f));
      if(crossed.some(f=>f.blocksSight))blocked++;
      low=Math.max(low,...crossed.map(f=>f.cover==='three_quarters'?5:f.cover==='half'?2:0));
    }
    best=Math.min(best,Math.max(blocked===4?6:blocked===3?5:blocked>=2?2:0,low));
  }
  return {blocked:best===6,cover:best===6?'total':best===5?'three_quarters':best===2?'half':'none'};
}

/** All footprint cells, never only the NW anchor, participate in fog/terrain. */
export function actorTerrainCells(state:Pick<SoloCombatState,'tokens'>,actorId:string,size:number) {return footprintCells(state.tokens[actorId].position,size);}
