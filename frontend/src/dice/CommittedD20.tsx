import type { CSSProperties } from 'react';

type V = [number, number, number];
const add = (a: V,b: V): V => a.map((n,i) => n+b[i]) as V;
const sub = (a: V,b: V): V => a.map((n,i) => n-b[i]) as V;
const scale = (a: V,k: number): V => a.map(n => n*k) as V;
const dot = (a: V,b: V) => a.reduce((s,n,i) => s+n*b[i],0);
const cross = (a: V,b: V): V => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (a: V) => scale(a,1/Math.hypot(...a));
const phi = (1+Math.sqrt(5))/2;
const vertices: V[] = [];
for (const a of [-1,1]) for (const b of [-phi,phi]) vertices.push([0,a,b],[a,b,0],[b,0,a]);
const points = vertices.map(v => scale(unit(v),48));
const edge = Math.min(...points.flatMap((a,i) => points.slice(i+1).map(b => Math.hypot(...sub(a,b)))));
const faces: {u:V;v:V;n:V;origin:V;width:number;height:number}[] = [];
for (let i=0;i<12;i++) for(let j=i+1;j<12;j++) for(let k=j+1;k<12;k++) {
  let [a,b,c]=[points[i],points[j],points[k]];
  if ([sub(a,b),sub(a,c),sub(b,c)].some(v => Math.abs(Math.hypot(...v)-edge)>0.01)) continue;
  let u=unit(sub(b,a)),v=unit(sub(scale(add(a,b),.5),c)),n=cross(u,v);
  if(dot(n,c)<0){[a,b]=[b,a];u=unit(sub(b,a));v=unit(sub(scale(add(a,b),.5),c));n=cross(u,v);}
  faces.push({u,v,n,origin:sub(c,scale(u,edge/2)),width:edge,height:edge*Math.sqrt(3)/2});
}
const matrix = (u:V,v:V,n:V,p:V) => `matrix3d(${[...u,0,...v,0,...n,0,...p,1].join(',')})`;

/** A real twenty-faced CSS solid, oriented to the already committed result.
 * Presentation never draws another random value or changes the combat roll. */
export default function CommittedD20({value, rolling, discarded=false}: {value:number;rolling:boolean;discarded?:boolean}) {
  const face=faces[Math.max(0,Math.min(19,value-1))];
  const orientation=matrix([face.u[0],face.v[0],face.n[0]],[face.u[1],face.v[1],face.n[1]],[face.u[2],face.v[2],face.n[2]],[0,0,0]);
  return <div className={`committed-die${rolling?' is-rolling':''}${discarded?' is-discarded':''}`}
    role="img" aria-label={rolling?'Бросок к20':`к20: ${value}${discarded?' — отброшено':''}`}>
    <div className="committed-die-tumble" aria-hidden="true"><div className="committed-die-solid" style={{transform:orientation}}>
      {faces.map((f,index) => <span key={index} className="committed-die-face" style={{width:f.width,height:f.height,
        transform:matrix(f.u,f.v,f.n,f.origin),'--face-shade':`${26+index%5*4}%`} as CSSProperties}>
        <b>{index+1}</b>
      </span>)}
    </div></div>
  </div>;
}
