import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry, Euler, Float32BufferAttribute,
  Matrix4, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MiniaturePalette } from './recipes';

export type Point = [number, number, number];
export type Paint = keyof MiniaturePalette | 'dark' | 'bone' | 'fur' | 'scale';
export interface MiniatureGeometry { paint: Paint; geometry: BufferGeometry }
export type BodyRing = [y: number, radiusX: number, radiusZ: number, centerZ?: number];

/** Sculpt primitives preserve analytic smooth normals; only actual edges remain sharp. */
export class Sculpt {
  private parts = new Map<Paint, BufferGeometry[]>();
  add(geometry: BufferGeometry, paint: Paint, position: Point = [0, 0, 0], scale: Point = [1, 1, 1], rotation = new Quaternion()) {
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    part.applyMatrix4(new Matrix4().compose(new Vector3(...position), rotation, new Vector3(...scale)));
    const positions=part.getAttribute('position'),normals=part.getAttribute('normal');
    const uv=new Float32Array(positions.count*2);
    for(let n=0;n<positions.count;n+=1){
      const nx=Math.abs(normals.getX(n)),ny=Math.abs(normals.getY(n)),nz=Math.abs(normals.getZ(n));
      uv[n*2]=(nx>ny&&nx>nz?positions.getZ(n):positions.getX(n))*8;
      uv[n*2+1]=(ny>nx&&ny>nz?positions.getZ(n):positions.getY(n))*8;
    }
    part.setAttribute('uv',new Float32BufferAttribute(uv,2));
    const rows = this.parts.get(paint) ?? [];
    rows.push(part);
    this.parts.set(paint, rows);
  }
  oval(paint: Paint, position: Point, scale: Point, segments = 24) {
    this.add(new SphereGeometry(1, segments, Math.max(8, Math.round(segments * .68))), paint, position, scale);
  }
  box(paint: Paint, position: Point, scale: Point, angle = 0) {
    this.add(new BoxGeometry(1, 1, 1), paint, position, scale, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle));
  }
  rod(paint: Paint, start: Point, end: Point, radius: number, endRadius = radius, segments = 16) {
    const a = new Vector3(...start), b = new Vector3(...end);
    this.add(new CylinderGeometry(endRadius, radius, a.distanceTo(b), segments, 2), paint,
      a.clone().add(b).multiplyScalar(.5).toArray() as Point, [1, 1, 1],
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.sub(a).normalize()));
  }
  tip(paint: Paint, start: Point, end: Point, radius: number) { this.rod(paint, start, end, radius, 0, 10); }
  curve(paint: Paint, points: Point[], radius: number, segments = 20, radialSegments = 8) {
    this.add(new TubeGeometry(new CatmullRomCurve3(points.map(point => new Vector3(...point))), segments, radius, radialSegments, false), paint);
  }
  torus(paint: Paint, position: Point, radius: number, tube: number, rotation: Point = [0, 0, 0], arc = Math.PI * 2, segments = 14) {
    this.add(new TorusGeometry(radius, tube, 6, segments, arc), paint, position, [1, 1, 1], new Quaternion().setFromEuler(new Euler(...rotation)));
  }
  /** Elliptical ring sculpture: chest, waists and armor taper continuously, without stacked balls. */
  profile(paint: Paint, rings: BodyRing[], segments = 32, x = 0) {
    const positions: number[] = [], indices: number[] = [];
    for (const [y, rx, rz, z = 0] of rings) for (let n = 0; n <= segments; n += 1) {
      const angle = n / segments * Math.PI * 2;
      positions.push(x + Math.cos(angle) * rx, y, z + Math.sin(angle) * rz);
    }
    for (let row = 0; row < rings.length - 1; row += 1) for (let n = 0; n < segments; n += 1) {
      const a = row * (segments + 1) + n, b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.add(geometry, paint);
  }
  /** Double sided thick fabric with flowing folds and an uneven sewn hem. */
  fabric(paint: Paint, width: number, top: number, bottom: number, back: number, folds = 4) {
    const across = 32, down = 22;
    for (const side of [-1, 1]) {
      const positions: number[] = [], indices: number[] = [];
      for (let row = 0; row <= down; row += 1) for (let col = 0; col <= across; col += 1) {
        const t = row / down, u = col / across;
        const phase=u*folds*Math.PI*2+t*.83+Math.sin(u*7.3+t)*.5;
        const hem=.011*Math.sin(u*17.2+.5)+.012*Math.sin(u*6.5+1.4);
        const flowingFold=Math.sin(phase)*(.006+.011*t)+Math.sin(u*11.5-t*2.5)*.007*t;
        const lean=.031*t*t*Math.sin(u*3.8+.1);
        positions.push((u-.5)*width*(.56+t*.44)+lean,
          top+(bottom-top)*t+hem*t*t-.019*Math.sin(u*2.8)*t,
          back-.093*Math.sin(t*1.5)+flowingFold+side*.003);
      }
      for (let row = 0; row < down; row += 1) for (let col = 0; col < across; col += 1) {
        const a = row * (across + 1) + col, b = a + across + 1;
        if (side === 1) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices); geometry.computeVertexNormals(); this.add(geometry, paint);
    }
  }
  finish(height = 1, floor = .097): MiniatureGeometry[] {
    const result = [...this.parts].map(([paint, parts]) => {
      const geometry = mergeGeometries(parts)!;
      parts.forEach(part => part.dispose());
      geometry.scale(height, height, height); geometry.computeBoundingBox();
      return {paint, geometry};
    });
    const lowest = Math.min(...result.map(part => part.geometry.boundingBox!.min.y));
    for (const part of result) {
      part.geometry.translate(0, floor - lowest, 0);
      part.geometry.computeBoundingBox(); part.geometry.computeBoundingSphere();
    }
    return result;
  }
}
