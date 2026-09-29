import type {GridPosition} from './types';
export const FACING_DIRECTIONS={n:[0,-1],ne:[1,-1],e:[1,0],se:[1,1],s:[0,1],sw:[-1,1],w:[-1,0],nw:[-1,-1]} as const;
export type CombatFacing=keyof typeof FACING_DIRECTIONS;
export const FACING_LABELS:Record<CombatFacing,string>={n:'Север ↑',ne:'Северо-восток ↗',e:'Восток →',se:'Юго-восток ↘',s:'Юг ↓',sw:'Юго-запад ↙',w:'Запад ←',nw:'Северо-запад ↖'};
export function facingToward(from:GridPosition,to:GridPosition):CombatFacing|undefined{
 const dx=Math.sign(to.x-from.x),dy=Math.sign(to.y-from.y);
 return (Object.keys(FACING_DIRECTIONS) as CombatFacing[]).find(key=>FACING_DIRECTIONS[key][0]===dx&&FACING_DIRECTIONS[key][1]===dy);
}
export function isBehindFacing(source:GridPosition,target:GridPosition,facing:CombatFacing|undefined):boolean{
 if(!facing||!Object.hasOwn(FACING_DIRECTIONS,facing))return false;
 const [dx,dy]=FACING_DIRECTIONS[facing];
 return (source.x-target.x)*dx+(source.y-target.y)*dy<0;
}
