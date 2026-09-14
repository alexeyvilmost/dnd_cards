import {describe,expect,it} from 'vitest';
import {dieFaces,dieMesh,dieRotation,supportedDieSides} from './polyhedralGeometry';
import {cross,dot,type Vec3} from './d20Geometry';

describe('committed polyhedral damage dice',()=>{
  it('keeps the d10 broad with ten real kite faces and twelve vertices',()=>{
    const vertices=[...new Map(dieFaces(10).flatMap(face=>face.corners).map(v=>[v.join(','),v])).values()];
    expect(vertices).toHaveLength(12);
    const height=Math.max(...vertices.map(v=>v[2]))-Math.min(...vertices.map(v=>v[2]));
    const diameter=2*Math.max(...vertices.map(v=>Math.hypot(v[0],v[1])));
    expect(height/diameter).toBeCloseTo(1.1,6);
  });
  for (const sides of supportedDieSides) it(`has ${sides} planar, outward faces with unique numbers and a correct settled result`,()=>{
    const faces=dieFaces(sides);
    expect(faces).toHaveLength(sides);
    expect(faces.map(f=>f.value).sort((a,b)=>a-b)).toEqual(Array.from({length:sides},(_,i)=>i+1));
    const vertices=faces.flatMap(f=>f.corners);
    for (const face of faces) {
      const plane=dot(face.center,face.normal);
      for (const v of face.corners) expect(dot(v,face.normal)).toBeCloseTo(plane,6);
      for (const v of vertices) expect(dot(v,face.normal)).toBeLessThanOrEqual(plane+1e-6);
      const delta=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
      expect(dot(cross(delta(face.corners[1],face.corners[0]),delta(face.corners[2],face.corners[0])),face.normal)).toBeGreaterThan(0);
      const rotation=dieRotation(sides,face.value,1);
      const transform=(v:Vec3)=>[0,1,2].map(i=>rotation[i]*v[0]+rotation[i+3]*v[1]+rotation[i+6]*v[2]);
      expect(transform(face.normal)[2]).toBeGreaterThan(.75);
      expect(transform(face.up)[1]).toBeGreaterThan(.85);
      for (const other of faces.filter(f=>f!==face)) expect(transform(other.normal)[2]).toBeLessThan(transform(face.normal)[2]);
      if (sides!==4) expect(faces.find(other=>dot(face.normal,other.normal)<-.99999)?.value).toBe(sides+1-face.value);
    }
    const mesh=dieMesh(sides); expect(mesh.length%27).toBe(0); expect([...mesh].every(Number.isFinite)).toBe(true);
    expect(faces.every(f=>f.corners.length===({4:3,6:4,8:3,10:4,12:5,20:3}[sides]))).toBe(true);
  });
});
