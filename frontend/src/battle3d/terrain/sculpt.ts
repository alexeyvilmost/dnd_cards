import {BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, Euler, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, Vector3} from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {TerrainPaint} from './materials';

export type Point=[number,number,number];
export type TerrainPart={paint:TerrainPaint;geometry:BufferGeometry};
const matrix=new Matrix4(),quaternion=new Quaternion(),translation=new Vector3(),scaling=new Vector3();

export class TerrainSculpt {
  private groups=new Map<TerrainPaint,BufferGeometry[]>();
  add(geometry:BufferGeometry,paint:TerrainPaint,color:string,position:Point=[0,0,0],scale:Point=[1,1,1],rotation:Point=[0,0,0]) {
    const shape=geometry.index?geometry.toNonIndexed():geometry;
    if(shape!==geometry)geometry.dispose();
    if(!shape.getAttribute('uv'))shape.setAttribute('uv',new Float32BufferAttribute(new Float32Array(shape.getAttribute('position').count*2),2));
    const tint=new Color(color),colors=new Float32Array(shape.getAttribute('position').count*3);
    const positions=shape.getAttribute('position');
    for(let i=0;i<positions.count;i++){
      const variation=.94+.06*Math.sin(positions.getX(i)*31.7+positions.getY(i)*24.1+positions.getZ(i)*19.3);
      colors[i*3]=tint.r*variation;colors[i*3+1]=tint.g*variation;colors[i*3+2]=tint.b*variation;
    }
    shape.setAttribute('color',new Float32BufferAttribute(colors,3));
    matrix.compose(translation.set(...position),quaternion.setFromEuler(new Euler(...rotation)),scaling.set(...scale));shape.applyMatrix4(matrix);
    const group=this.groups.get(paint)??[];group.push(shape);this.groups.set(paint,group);
  }
  block(position:Point,size:Point,color:string,paint:TerrainPaint='stone',rotation:Point=[0,0,0],weather=.014) {
    const bevel=Math.min(...size)*.13;
    const geometry=new RoundedBoxGeometry(...size,1,bevel);
    const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
      const noise=Math.sin(x*23.13+y*17.31+z*13.23)*Math.sin(x*51.7-y*41.1+z*37.3)*weather;
      positions.setXYZ(i,x+normals.getX(i)*noise,y+normals.getY(i)*noise,z+normals.getZ(i)*noise);
    }
    geometry.computeVertexNormals();this.add(geometry,paint,color,position,[1,1,1],rotation);
  }
  rock(position:Point,size:Point,color:string,phase:number,detail=1) {
    const geometry=new IcosahedronGeometry(1,detail),positions=geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),r=1+Math.sin(x*7.2+y*3.7+phase)*.13+Math.sin(z*8.1-x*4.7+phase)*.08;
      positions.setXYZ(i,x*r,y*r,z*r);
    }
    geometry.computeVertexNormals();this.add(geometry,'stone',color,position,size,[phase*.31,phase,phase*.17]);
  }
  rod(from:Point,to:Point,radius:number,paint:TerrainPaint,color:string,endRadius=radius,segments=8) {
    const direction=new Vector3(...to).sub(new Vector3(...from)),geometry=new CylinderGeometry(endRadius,radius,direction.length(),segments);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()));
    this.add(geometry,paint,color,[(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2]);
  }
  root(points:Point[],radius:number,color:string) {
    const geometry=new TubeGeometry(new CatmullRomCurve3(points.map(point=>new Vector3(...point))),9,radius,5,false);
    this.add(geometry,'bark',color);
  }
  ring(position:Point,radius:number,tube:number,color:string,paint:TerrainPaint='stone',rotation:Point=[Math.PI/2,0,0],segments=36) {
    this.add(new TorusGeometry(radius,tube,5,segments),paint,color,position,[1,1,1],rotation);
  }
  leaf(position:Point,height:number,width:number,angle:number,color:string) {
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute([-.5*width,0,0, .5*width,0,0, 0,height*.65,width*.4, 0,height*.65,width*.4,.5*width,0,0,width*.12,height,width*.65],3));
    geometry.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,.5,.7,.5,.7,1,0,.5,1],2));geometry.computeVertexNormals();
    this.add(geometry,'moss',color,position,[1,1,1],[0,angle,0]);
  }
  pebble(position:Point,scale:Point,color:string) {this.add(new SphereGeometry(1,7,4),'earth',color,position,scale);}
  finish():TerrainPart[] {
    return [...this.groups].map(([paint,pieces])=>{
      const geometry=mergeGeometries(pieces,false)!;for(const piece of pieces)piece.dispose();geometry.computeBoundingBox();return {paint,geometry};
    });
  }
}
