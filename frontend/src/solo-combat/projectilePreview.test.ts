import {describe,it,expect} from 'vitest';
import {projectileTrajectory} from './projectilePreview';
import {terrainSight,type BattleMapDefinition,type BattleMapFeature} from './boardGeometry';
const board=(features:BattleMapFeature[])=>({battleMap:{width:12,height:10,features} as BattleMapDefinition});
const low:BattleMapFeature={id:'table',name:'Стол',sprite:'table',x:3,y:2,width:2,height:2,cover:'half'};
describe('read-only projectile geometry',()=>{
 it('uses centers and a straight ray with no obstacles',()=>{
  expect(projectileTrajectory({}, {x:0,y:3},{x:7,y:3})).toEqual({from:{x:.5,y:3.5},to:{x:7.5,y:3.5},blocked:false,covered:[]});
 });
 it.each(['half','three_quarters'] as const)('marks only the intersected %s cover section',cover=>{
  const state=board([{...low,cover}]),before=JSON.stringify(state);
  const ray=projectileTrajectory(state,{x:0,y:3},{x:7,y:3});
  expect(ray.covered).toHaveLength(1);expect(ray.covered[0].from.x).toBeCloseTo(3.001);expect(ray.covered[0].to.x).toBeCloseTo(4.999);
  expect(ray.blocked).toBe(false);expect(JSON.stringify(state)).toBe(before);
 });
 it('uses actual irregular feature cells and merges overlapping intervals',()=>{
  const state=board([{...low,width:4,cells:[{x:0,y:1},{x:2,y:1}]},{...low,id:'duplicate',width:1}]);
  expect(projectileTrajectory(state,{x:0,y:3},{x:9,y:3}).covered).toHaveLength(2);
 });
 it('never animates a shot through a fully opaque wall',()=>{
  const state=board([{...low,x:3,y:0,width:1,height:10,blocksSight:true}]);
  expect(terrainSight(state,{x:0,y:3},{x:7,y:3}).cover).toBe('total');
  const ray=projectileTrajectory(state,{x:0,y:3},{x:7,y:3});
  expect(ray.blocked).toBe(true);expect(ray.to.x).toBeCloseTo(3.001);
 });
 it('does not bypass a blocked center ray using a clear footprint corner',()=>{
  const state=board([{...low,x:3,y:3,width:1,height:1,blocksSight:true}]);
  const ray=projectileTrajectory(state,{x:1,y:2},{x:5,y:3});
  expect(ray.blocked).toBe(true);
  expect(terrainSight(state,{x:1,y:2},{x:5,y:3}).cover).toBe('total');
 });
 it('does not count barrels and an ally outside the center ray (reported goblin encounter)',()=>{
  const state=board([{...low,x:16,y:2,width:2,height:1}]);
  const bodies=[{x:7,y:5,width:1,height:1,blocksSight:true}];
  for(const [from,to] of [[{x:6,y:7},{x:17,y:0}],[{x:17,y:0},{x:6,y:7}]]){
   expect(terrainSight(state,from,to,1,1,bodies)).toEqual({blocked:false,cover:'none'});
   expect(projectileTrajectory(state,from,to,1,1,bodies)).toMatchObject({blocked:false,covered:[]});
  }
 });
 it('centers large and huge footprints and reverses the covered section',()=>{
  const state=board([low]);
  const forward=projectileTrajectory(state,{x:0,y:2},{x:7,y:2},2,3);
  const reverse=projectileTrajectory(state,{x:7,y:2},{x:0,y:2},3,2);
  expect(forward.from).toEqual({x:1,y:3});expect(forward.to).toEqual({x:8.5,y:3.5});
  expect(reverse.from).toEqual(forward.to);expect(reverse.covered[0].to.x).toBeCloseTo(forward.covered[0].from.x);
 });
});
