import {describe,expect,it} from 'vitest';
import maps from '../../solo-combat/data/battleMaps.json';
import type {BattleMapDefinition} from '../../solo-combat/boardGeometry';
import {buildTerrain} from './buildTerrain';

describe('detailed terrain geometry',()=>{
  it.each(maps as BattleMapDefinition[])('$id produces finite merged surfaces within the browser mesh budget',map=>{
    const parts=buildTerrain(map,map.width,map.height);
    try{
      expect(parts.length).toBeLessThanOrEqual(11);
      let triangles=0;
      for(const part of parts){
        const positions=part.geometry.getAttribute('position');triangles+=positions.count/3;
        expect(part.geometry.getAttribute('normal').count).toBe(positions.count);
        expect(part.geometry.getAttribute('uv').count).toBe(positions.count);
        expect(part.geometry.getAttribute('color').count).toBe(positions.count);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        expect(part.geometry.boundingBox?.min.x).toBeGreaterThan(-.4);
        expect(part.geometry.boundingBox?.max.x).toBeLessThan(map.width+.4);
        expect(part.geometry.boundingBox?.min.z).toBeGreaterThan(-.4);
        expect(part.geometry.boundingBox?.max.z).toBeLessThan(map.height+.4);
      }
      expect(triangles).toBeLessThan(100_000);
    }finally{for(const part of parts)part.geometry.dispose();}
  });

  it('rebuilds identical scenery after reload from the same authored map',()=>{
    const map=maps.find(map=>map.id==='sanctuary-v1') as BattleMapDefinition;
    const first=buildTerrain(map,map.width,map.height),second=buildTerrain(structuredClone(map),map.width,map.height);
    try{
      expect(second.map(part=>part.paint)).toEqual(first.map(part=>part.paint));
      for(let i=0;i<first.length;i++){
        const a=first[i].geometry.getAttribute('position').array,b=second[i].geometry.getAttribute('position').array;
        expect(a.byteLength).toBe(b.byteLength);
        expect(Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength))).toBe(true);
      }
    }finally{for(const part of [...first,...second])part.geometry.dispose();}
  });

  it('keeps water inside an irregular authored mask without filling its missing corner',()=>{
    const map:BattleMapDefinition={id:'masked-stream',name:'Stream',description:'',width:4,height:4,background:'',maxFootprint:1,maxActors:1,
      features:[{id:'stream',name:'Stream',sprite:'water',x:1,y:1,width:2,height:2,cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}]};
    const parts=buildTerrain(map,4,4);
    try{
      const water=parts.find(part=>part.paint==='water')!.geometry.getAttribute('position'),occupied=new Set<string>();
      for(let i=0;i<water.count;i+=3){
        const x=(water.getX(i)+water.getX(i+1)+water.getX(i+2))/3,z=(water.getZ(i)+water.getZ(i+1)+water.getZ(i+2))/3;
        occupied.add(`${Math.floor(x)}:${Math.floor(z)}`);
      }
      expect([...occupied].sort()).toEqual(['1:1','1:2','2:1']);
      expect(water.count).toBe(18);
    }finally{for(const part of parts)part.geometry.dispose();}
  });
});
