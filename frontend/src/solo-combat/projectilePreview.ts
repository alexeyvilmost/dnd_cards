import {centerCoverTrace,type BoardState,type CoverObstacle} from './boardGeometry';
import type {GridPosition} from './types';

/** Cover/AC and this visual trace use the same center-to-center ray.
 * Opaque terrain stops an impossible shot instead of drawing it through a wall. */
export function projectileTrajectory(state:BoardState,from:GridPosition,to:GridPosition,sourceSize=1,targetSize=1,extraObstacles:CoverObstacle[]=[]){
 const {origin,target,hits}=centerCoverTrace(state,from,to,sourceSize,targetSize,extraObstacles);
 const blocked=hits.some(h=>h.opaque);
 const stop=blocked?Math.min(...hits.filter(h=>h.opaque).map(h=>h.start)):1;
 const point=(t:number)=>({x:origin.x+(target.x-origin.x)*t,y:origin.y+(target.y-origin.y)*t});
 const intervals=hits.map(h=>({start:h.start,end:Math.min(h.end,stop)})).filter(h=>h.end>h.start).sort((a,b)=>a.start-b.start);
 const merged:typeof intervals=[];
 for(const interval of intervals){const last=merged.at(-1);if(last&&interval.start<=last.end)last.end=Math.max(last.end,interval.end);else merged.push({...interval});}
 return {from:origin,to:point(stop),blocked,covered:merged.map(h=>({from:point(h.start),to:point(h.end)}))};
}
