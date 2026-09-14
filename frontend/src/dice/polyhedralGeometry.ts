import {cross, d20Faces, d20Mesh, d20Rotation, dot, multiply3, unit, type Mat3, type Vec3} from './d20Geometry';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scale = (a: Vec3, n: number): Vec3 => [a[0]*n, a[1]*n, a[2]*n];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const supportedDieSides = [4, 6, 8, 10, 12, 20] as const;
export type DieFace = {corners: Vec3[]; center: Vec3; normal: Vec3; up: Vec3; right: Vec3; value: number};

/** Merge coplanar hull triangles into real polygonal faces (including d10 kites). */
function hull(vertices: Vec3[]): DieFace[] {
  const faces: DieFace[] = [], seen = new Set<string>();
  for (let a=0; a<vertices.length; a++) for (let b=a+1; b<vertices.length; b++) for (let c=b+1; c<vertices.length; c++) {
    const product = cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
    if (Math.hypot(...product)<1e-7) continue;
    let normal=unit(product), distance=dot(normal,vertices[a]);
    if (distance<0) { normal=scale(normal,-1); distance=-distance; }
    if (vertices.some(v=>dot(v,normal)>distance+1e-6)) continue;
    const ids=vertices.flatMap((v,i)=>Math.abs(dot(v,normal)-distance)<1e-6?[i]:[]);
    const key=ids.join(':'); if (seen.has(key)) continue; seen.add(key);
    const center=scale(ids.reduce((sum,i)=>add(sum,vertices[i]),[0,0,0] as Vec3),1/ids.length);
    const up=unit(sub(vertices[ids[0]],center)), right=unit(cross(up,normal));
    const corners=ids.map(i=>vertices[i]).sort((p,q)=>
      Math.atan2(dot(sub(p,center),up),dot(sub(p,center),right))-Math.atan2(dot(sub(q,center),up),dot(sub(q,center),right)));
    faces.push({corners,center,normal,up,right,value:0});
  }
  return faces;
}

const cache=new Map<number,DieFace[]>();
export function dieFaces(sides: number): DieFace[] {
  if (sides===20) return d20Faces;
  const cached=cache.get(sides); if (cached) return cached;
  let vertices: Vec3[];
  switch (sides) {
    case 4: vertices=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]]; break;
    case 6: vertices=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[x,y,z] as Vec3))); break;
    case 8: vertices=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]; break;
    case 12: vertices=d20Faces.map(face=>face.center); break;
    case 10: {
      // Broad physical d10: two poles and a shallow zigzag equator. The
      // coplanarity constraint gives ten kite faces, not a narrow spindle.
      const pole=1.1, cosine=Math.cos(Math.PI/5);
      const belt=pole*(1-cosine)/(1+cosine);
      vertices=[[0,0,pole],[0,0,-pole],...Array.from({length:10},(_,i):Vec3=>
        [Math.cos(i*Math.PI/5),Math.sin(i*Math.PI/5),i%2 ? -belt : belt])];
      break;
    }
    default: throw new Error(`Unsupported die: d${sides}`);
  }
  const radius=Math.max(...vertices.map(v=>Math.hypot(...v)));
  const faces=hull(vertices.map(v=>scale(v,1/radius)));
  if (sides===6) for (const face of faces) {
    // A cube's top edge is horizontal; aiming a corner upward makes it a diamond.
    face.up=unit(sub(scale(add(face.corners[0],face.corners[1]),.5),face.center));
    face.right=unit(cross(face.up,face.normal));
  }
  let value=1;
  for (const face of faces) {
    if (face.value) continue;
    face.value=value;
    const opposite=faces.find(other=>dot(face.normal,other.normal)<-.99999);
    if (opposite) opposite.value=sides+1-value;
    value++;
  }
  cache.set(sides,faces); return faces;
}

export function dieRotation(sides: number, value: number, progress: number): Mat3 {
  if (sides===20) return d20Rotation(value,progress);
  const face=dieFaces(sides).find(f=>f.value===value)??dieFaces(sides)[0];
  const settled=[face.right[0],face.up[0],face.normal[0],face.right[1],face.up[1],face.normal[1],face.right[2],face.up[2],face.normal[2]];
  const left=(1-Math.min(1,Math.max(0,progress)))**3;
  const x=left*Math.PI*5.4, y=left*Math.PI*7.2;
  // Retain visible side faces at rest, particularly on the cube and tetrahedron.
  const pitch=sides===4?.45:.3, yaw=sides===4?.55:-.36;
  const tilt=multiply3([1,0,0,0,Math.cos(pitch),Math.sin(pitch),0,-Math.sin(pitch),Math.cos(pitch)],
    [Math.cos(yaw),0,-Math.sin(yaw),0,1,0,Math.sin(yaw),0,Math.cos(yaw)]);
  return multiply3(multiply3([1,0,0,0,Math.cos(x),Math.sin(x),0,-Math.sin(x),Math.cos(x)],
    [Math.cos(y),0,-Math.sin(y),0,1,0,Math.sin(y),0,Math.cos(y)]),multiply3(tilt,settled));
}

export function dieMesh(sides: number): Float32Array {
  if (sides===20) return d20Mesh();
  const data:number[]=[];
  for (const face of dieFaces(sides)) {
    const inner=face.corners.map(v=>add(add(face.center,scale(sub(v,face.center),.945)),scale(face.normal,.012)));
    const extent=Math.max(...face.corners.map(v=>Math.hypot(...sub(v,face.center))))*2.15;
    const triangle=(points:Vec3[],metal:number)=>{
      const normal=unit(cross(sub(points[1],points[0]),sub(points[2],points[0])));
      for (const p of points) {
        const delta=sub(p,face.center), index=face.value-1;
        data.push(...p,...normal,(index%5+.5+dot(delta,face.right)/extent)/5,(Math.floor(index/5)+.5+dot(delta,face.up)/extent)/4,metal);
      }
    };
    for (let i=1;i<inner.length-1;i++) triangle([inner[0],inner[i],inner[i+1]],0);
    for (let i=0;i<inner.length;i++) {
      const j=(i+1)%inner.length;
      triangle([face.corners[i],face.corners[j],inner[j]],1);
      triangle([face.corners[i],inner[j],inner[i]],1);
    }
  }
  return new Float32Array(data);
}
