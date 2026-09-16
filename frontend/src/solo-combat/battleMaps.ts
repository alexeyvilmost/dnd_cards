import rawMaps from './data/battleMaps.json';
import type {ActorState} from '../rules-core/domain';
import type {CombatAreaState, SoloCombatState} from './types';
import {actorFootprint, footprintCells} from './footprint';
import {boardCells, boardObstacles, featureCells, terrainFits, terrainStepFits, type BattleMapDefinition} from './boardGeometry';

export const BATTLE_MAPS = rawMaps as unknown as readonly BattleMapDefinition[];

/** Flood the anchor-space of this footprint, not the one-cell navigation mesh. */
export function mapConnectedPositions(map:BattleMapDefinition,size:number,containing?:{x:number;y:number}) {
  const board={battleMap:map};
  const remaining=new Set(boardCells(board).filter(p=>terrainFits(board,p,size)).map(p=>`${p.x}:${p.y}`));
  let largest: {x:number;y:number}[]=[];
  while(remaining.size){
    const [x,y]=remaining.values().next().value!.split(':').map(Number);
    const connected=[{x,y}];remaining.delete(`${x}:${y}`);
    for(let i=0;i<connected.length;i++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const p={x:connected[i].x+dx,y:connected[i].y+dy},key=`${p.x}:${p.y}`;
      if(remaining.has(key)&&terrainStepFits(board,connected[i],p,size)){remaining.delete(key);connected.push(p);}
    }
    if(containing&&connected.some(p=>p.x===containing.x&&p.y===containing.y))return connected;
    if(!containing&&connected.length>largest.length)largest=connected;
  }
  return largest;
}

/** A roster only fits if every actor can spawn in connected navigable space. */
export function packBattleMap(map:BattleMapDefinition,actors:readonly ActorState[],partyIds:readonly string[]) {
  if(actors.length>map.maxActors||actors.some(a=>actorFootprint(a)>map.maxFootprint))return null;
  const occupied=new Set(boardObstacles({battleMap:map}));
  const positions:Record<string,{x:number;y:number}>={};
  const spaces=new Map<number,{x:number;y:number}[]>();
  const zones=map.features.filter(f=>f.zone).map(f=>({cells:new Set(featureCells(f).map(c=>`${c.x}:${c.y}`)),score:f.zone!.hazard?100:f.zone!.difficultTerrain?1:0}));
  const ordered=[...actors].sort((a,b)=>actorFootprint(b)-actorFootprint(a)||a.id.localeCompare(b.id));
  for(const actor of ordered){
    const size=actorFootprint(actor);
    if(!spaces.has(size))spaces.set(size,mapConnectedPositions(map,size,Object.values(positions)[0]));
    const candidates=[...spaces.get(size)!];
    const party=partyIds.includes(actor.id);
    const zoneScore=(p:{x:number;y:number})=>zones.reduce((score,z)=>score+(footprintCells(p,size).some(c=>z.cells.has(`${c.x}:${c.y}`))?z.score:0),0);
    const scores=new Map(candidates.map(p=>[p,zoneScore(p)]));
    candidates.sort((a,b)=>scores.get(a)!-scores.get(b)!||(party?b.y-a.y:a.y-b.y)||Math.abs(a.x-map.width/2)-Math.abs(b.x-map.width/2)||a.x-b.x);
    const position=candidates.find(p=>scores.get(p)!<100&&footprintCells(p,size).every(c=>!occupied.has(`${c.x}:${c.y}`)));
    if(!position)return null;
    positions[actor.id]=position;
    for(const p of footprintCells(position,size))occupied.add(`${p.x}:${p.y}`);
  }
  return positions;
}

/** Separate seeded stream: scenery never consumes attack/initiative entropy. The
 * complete generated map is frozen in the combat envelope, not rebuilt on load. */
export function generateBattleMap(template:BattleMapDefinition,seed:number,attempt=0):BattleMapDefinition|null {
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Некорректное зерно карты');
  let cursor=(seed+Math.imul(attempt+1,0x9e3779b9))>>>0;
  const random=(max:number)=>{cursor=(cursor+0x6d2b79f5)>>>0;let t=cursor;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)%max;};
  const map=structuredClone(template);
  const movable=new Set(template.procedural?.movable??[]);
  const used=new Set(map.features.filter(f=>!movable.has(f.id)).flatMap(featureCells).map(p=>`${p.x}:${p.y}`));
  for(const feature of map.features.filter(f=>movable.has(f.id))){
    if(feature.baked)throw Error('Нельзя перемещать встроенный в фон объект');
    const candidates=boardCells({battleMap:map}).filter(p=>p.x>=1&&p.y>=2&&p.x+feature.width<map.width&&p.y+feature.height<=map.height-2);
    const offset=random(Math.max(1,candidates.length));
    let placed=false;
    for(let n=0;n<candidates.length;n++){
      const p=candidates[(n+offset)%candidates.length];
      const cells=featureCells({...feature,...p});
      if(cells.some(c=>used.has(`${c.x}:${c.y}`)))continue;
      feature.x=p.x;feature.y=p.y;placed=true;break;
    }
    if(!placed)return null;
    for(const c of featureCells(feature))used.add(`${c.x}:${c.y}`);
  }
  map.id=`${template.id}:scatter-v1:${seed}:${attempt}`;
  map.generation={version:'scatter-v1',seed,attempt,templateId:template.id};
  return map;
}

export function selectBattleMap(actors:readonly ActorState[],partyIds:readonly string[],index:number,seed?:number) {
  if(!Number.isSafeInteger(index)||index<0)throw Error('Некорректный выбор карты');
  if(seed!==undefined&&(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))throw Error('Некорректное зерно карты');
  for(let n=0;n<BATTLE_MAPS.length;n++){
    const map=BATTLE_MAPS[(index+n)%BATTLE_MAPS.length];
    if(actors.length>map.maxActors||actors.some(a=>actorFootprint(a)>map.maxFootprint))continue;
    if(seed!==undefined&&map.procedural?.movable.length){
      const size=Math.max(...actors.map(a=>actorFootprint(a)),1);
      for(let attempt=0;attempt<8;attempt++){
        const generated=generateBattleMap(map,seed,attempt);
        if(!generated)continue;
        // Reject bottlenecks/islands for the largest participant, not just heroes.
        const connected=mapConnectedPositions(generated,size);
        if(connected.length!==boardCells({battleMap:generated}).filter(p=>terrainFits({battleMap:generated},p,size)).length)continue;
        const positions=packBattleMap(generated,actors,partyIds);
        if(positions)return {map:generated,positions};
      }
    }
    const positions=packBattleMap(map,actors,partyIds);
    if(positions)return {map:structuredClone(map),positions};
  }
  throw Error('Нет карты, вмещающей всех участников и их размеры');
}

export function materializeMapAreas(map:BattleMapDefinition):Record<string,CombatAreaState>{
  return Object.fromEntries(map.features.flatMap(f=>{
    if(!f.zone)return [];
    const id=`map:${map.id}:${f.id}`;
    const {hazard,...zone}=f.zone;
    const area:CombatAreaState={...zone,id,name:f.name,sceneryFeatureId:f.id,sourceActorId:`environment:${map.id}`,sourceActionId:id,
      sourceEntityIds:[map.id],origin:{x:f.x,y:f.y},cells:featureCells(f),duration:{type:'permanent'},
      ...(hazard?{hazard:{...hazard,id:`hazard:${id}`,name:f.name,sourceKind:'environment',sourceEntityIds:[map.id]} as CombatAreaState['hazard']}:{}),
    };
    return [[id,area]];
  }));
}

export function installBattleMap(state:SoloCombatState,index:number,seed?:number):SoloCombatState{
  const {map,positions}=selectBattleMap(Object.values(state.world.actors),state.controlledCharacterIds??[state.characterId],index,seed);
  return {...state,battleMap:map,combatAreas:{...Object.fromEntries(Object.entries(state.combatAreas??{}).filter(([,a])=>!a.sceneryFeatureId)),...materializeMapAreas(map)},
    tokens:Object.fromEntries(Object.entries(state.tokens).map(([id,token])=>[id,{...token,position:positions[id]}]))};
}
