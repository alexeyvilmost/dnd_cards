import rawMaps from './data/battleMaps.json';
import urvinMaps from './data/urvinMaps.json';
import type {ActorState} from '../rules-core/domain';
import type {CombatAreaState, SoloCombatState} from './types';
import {actorFootprint, footprintCells} from './footprint';
import {boardCells, boardObstacles, featureCells, terrainFits, terrainStepFits, type BattleMapDefinition, type BattleMapSpawnZone} from './boardGeometry';

function legacySpawnZones(map:BattleMapDefinition):BattleMapSpawnZone[]{
  // Existing arenas predate authored spawn zones. Give them two compact,
  // adjacent staging areas around mid-field instead of opposite map edges.
  const width=Math.max(1,Math.floor(map.width*.22));
  const y=1,height=Math.max(1,map.height-2);
  return [
    {side:'heroes',x:Math.max(0,Math.floor(map.width*.30)),y,width,height},
    {side:'monsters',x:Math.max(0,Math.floor(map.width*.48)),y,width,height},
  ];
}
export const BATTLE_MAPS = ([...rawMaps,...urvinMaps] as unknown as readonly BattleMapDefinition[]).map(map=>
  map.spawnZones?.length?map:{...map,spawnZones:legacySpawnZones(map)},
);

function stableSeed(value:string){let seed=0x811c9dc5;for(let i=0;i<value.length;i++)seed=Math.imul(seed^value.charCodeAt(i),0x01000193);return seed>>>0;}
function makeRandom(seed:number){let cursor=seed>>>0;return ()=>{cursor=(cursor+0x6d2b79f5)>>>0;let t=cursor;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/0x100000000;};}
function inSpawnZone(position:{x:number;y:number},zones:readonly BattleMapSpawnZone[]){return zones.some(zone=>position.x>=zone.x&&position.y>=zone.y&&position.x<zone.x+zone.width&&position.y<zone.y+zone.height);}

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
export function packBattleMap(map:BattleMapDefinition,actors:readonly ActorState[],partyIds:readonly string[],seed=stableSeed(`${map.id}|${actors.map(actor=>actor.id).sort().join('|')}`),retry=0):Record<string,{x:number;y:number}>|null {
  if(actors.length>map.maxActors||actors.some(a=>actorFootprint(a)>map.maxFootprint))return null;
  const occupied=new Set(boardObstacles({battleMap:map}));
  const positions:Record<string,{x:number;y:number}>={};
  const spaces=new Map<number,{x:number;y:number}[]>();
  const zones=map.features.filter(f=>f.zone).map(f=>({cells:new Set(featureCells(f).map(c=>`${c.x}:${c.y}`)),score:f.zone!.hazard?100:f.zone!.difficultTerrain?1:0}));
  const ordered=[...actors].sort((a,b)=>actorFootprint(b)-actorFootprint(a)||a.id.localeCompare(b.id));
  const random=makeRandom(seed);
  for(const actor of ordered){
    const size=actorFootprint(actor);
    if(!spaces.has(size))spaces.set(size,mapConnectedPositions(map,size,Object.values(positions)[0]));
    const party=partyIds.includes(actor.id);
    const sideZones=(map.spawnZones??[]).filter(zone=>zone.side===(party?'heroes':'monsters'));
    const available=spaces.get(size)!;
    const preferred=sideZones.length?available.filter(p=>inSpawnZone(p,sideZones)):[];
    // If a side's preferred room cannot fit the full roster/footprints, keep
    // placement valid by spilling into nearby navigable space.
    let candidates=preferred.length?preferred:[...available];
    const zoneScore=(p:{x:number;y:number})=>zones.reduce((score,z)=>score+(footprintCells(p,size).some(c=>z.cells.has(`${c.x}:${c.y}`))?z.score:0),0);
    const canPlace=(p:{x:number;y:number})=>zoneScore(p)<100&&footprintCells(p,size).every(c=>!occupied.has(`${c.x}:${c.y}`));
    const chooseRandom=(pool:{x:number;y:number}[])=>{
      const shuffled=[...pool];
      // Seeded shuffle makes spawn cells vary between encounters while keeping
      // the result reproducible for a saved seed.
      for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
      return shuffled.find(canPlace);
    };
    let position=chooseRandom(candidates);
    // A packed preferred zone can fill before every actor is placed. Spill to
    // the nearest general pool rather than rejecting a map that otherwise fits.
    if(!position&&preferred.length)position=chooseRandom(available);
    if(!position){
      // Randomized large footprints can occasionally form an inefficient
      // packing. Retry a different seeded arrangement before rejecting a map.
      return retry<12?packBattleMap(map,actors,partyIds,(seed+Math.imul(retry+1,0x9e3779b9))>>>0,retry+1):null;
    }
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
        const positions=packBattleMap(generated,actors,partyIds,seed^Math.imul(attempt+1,0x9e3779b9));
        if(positions)return {map:generated,positions};
      }
    }
    const positions=packBattleMap(map,actors,partyIds,seed===undefined?undefined:seed^Math.imul(n+1,0x9e3779b9));
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
