import {Sculpt,type MiniatureGeometry} from './sculpt';
import {buildHumanoid} from './humanoids';
import {buildDummy,buildQuadruped,buildSpider} from './creatures';
import type {MiniatureRecipe} from './recipes';
export type {MiniatureGeometry} from './sculpt';

const geometryCache=new Map<MiniatureRecipe,readonly MiniatureGeometry[]>();

/** Immutable sculpt assets shared by every instance; combat never changes their geometry. */
export function getMiniatureGeometry(recipe:MiniatureRecipe):readonly MiniatureGeometry[]{
  const cached=geometryCache.get(recipe);if(cached)return cached;
  const sculpt=new Sculpt();
  switch(recipe.body){
    case 'humanoid':buildHumanoid(sculpt,recipe);break;
    case 'wolf':case 'rat':buildQuadruped(sculpt,recipe);break;
    case 'spider':buildSpider(sculpt);break;
    case 'dummy':buildDummy(sculpt);break;
  }
  const result=sculpt.finish(recipe.height*(recipe.body==='humanoid'?1.15:1));
  geometryCache.set(recipe,result);return result;
}

export function miniaturePaintColor(recipe:MiniatureRecipe,paint:MiniatureGeometry['paint']):string{
  return paint==='dark'?'#171b1e':paint==='bone'?'#bdb29a':paint==='fur'?recipe.palette.armor:paint==='scale'?recipe.palette.skin:recipe.palette[paint];
}

/** Exact sculpt top for projecting labels above low animals and tall weapons. */
export function getMiniatureHeight(recipe:MiniatureRecipe):number{
  return Math.max(...getMiniatureGeometry(recipe).map(part=>part.geometry.boundingBox!.max.y))+.005;
}
