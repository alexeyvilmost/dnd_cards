import {useEffect, useRef} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {MathUtils, PerspectiveCamera, Vector3} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {GridPosition} from '../solo-combat/types';

export type CameraCommand = {id:number; kind:'in'|'out'|'left'|'right'|'reset'|'hero'};

export function frameBattleCamera(camera: PerspectiveCamera, width:number, height:number, maxHeight=2.4) {
  const vertical=MathUtils.degToRad(camera.fov);
  const horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
  const center=new Vector3(width/2,.35,height/2);
  const direction=new Vector3(.28,1.05,1.18).normalize();
  const right=new Vector3().crossVectors(new Vector3(0,1,0),direction).normalize();
  const up=new Vector3().crossVectors(direction,right).normalize();
  let distance=0;
  // Fit all projected box corners; a bounding sphere leaves wide boards tiny.
  for(const x of [-width/2-.3,width/2+.3])for(const z of [-height/2-.3,height/2+.3])for(const y of [-.9,maxHeight-.35]){
    const offset=new Vector3(x,y,z);
    distance=Math.max(distance,offset.dot(direction)+Math.max(Math.abs(offset.dot(right))/Math.tan(horizontal/2),Math.abs(offset.dot(up))/Math.tan(vertical/2)));
  }
  camera.position.copy(direction.multiplyScalar(distance*1.1).add(center));
  camera.lookAt(center);
  return center;
}

export default function BattleCamera({width,height,maxHeight,command,hero,onUnavailable}: {
  width:number; height:number; maxHeight:number; command:CameraCommand|null; hero?:GridPosition; onUnavailable:(reason:string)=>void;
}) {
  const {camera,gl,size,invalidate}=useThree();
  const controlsRef=useRef<OrbitControls|null>(null);
  const lastCommand=useRef(0);
  useEffect(()=>{
    const controls=new OrbitControls(camera,gl.domElement);
    controlsRef.current=controls;
    controls.enableDamping=true;
    controls.dampingFactor=.13;
    controls.minDistance=3.5;
    controls.maxDistance=Math.max(width,height)*5;
    controls.minPolarAngle=.16;
    controls.maxPolarAngle=Math.PI/2-.12;
    controls.enablePan=true;
    controls.screenSpacePanning=false;
    controls.rotateSpeed=.65;
    controls.zoomSpeed=.75;
    const redraw=()=>invalidate();
    controls.addEventListener('change',redraw);
    return ()=>{controls.removeEventListener('change',redraw);controls.dispose();controlsRef.current=null;};
  },[camera,gl.domElement,width,height,invalidate]);
  useEffect(()=>{
    const controls=controlsRef.current;
    if(!controls)return;
    if(camera instanceof PerspectiveCamera){
      camera.aspect=size.width/Math.max(size.height,1);
      camera.updateProjectionMatrix();
      controls.target.copy(frameBattleCamera(camera,width,height,maxHeight));
      controls.update();
    }
  },[camera,gl.domElement,width,height,maxHeight,size.width,size.height]);
  useEffect(()=>{
    const canvas=gl.domElement;
    const lost=(event:Event)=>{event.preventDefault();onUnavailable('3D-поле отключено: графический контекст недоступен.');};
    canvas.addEventListener('webglcontextlost',lost);
    return ()=>canvas.removeEventListener('webglcontextlost',lost);
  },[gl,onUnavailable]);
  useEffect(()=>{
    const controls=controlsRef.current;
    if(!controls)return;
    if(!command||command.id===lastCommand.current)return;
    lastCommand.current=command.id;
    if(command.kind==='reset'&&camera instanceof PerspectiveCamera)controls.target.copy(frameBattleCamera(camera,width,height,maxHeight));
    else if(command.kind==='hero'&&hero){
      const offset=camera.position.clone().sub(controls.target);
      offset.setLength(Math.min(offset.length(),7));
      controls.target.set(hero.x,.55,hero.y);
      camera.position.copy(controls.target).add(offset);
    }else{
      const offset=camera.position.clone().sub(controls.target);
      if(command.kind==='in'||command.kind==='out')offset.multiplyScalar(command.kind==='in'?.8:1.25).clampLength(controls.minDistance,controls.maxDistance);
      if(command.kind==='left'||command.kind==='right')offset.applyAxisAngle(new Vector3(0,1,0),(command.kind==='left'?-1:1)*Math.PI/8);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
  },[command,camera,width,height,maxHeight,hero]);
  useFrame(()=>{
    const controls=controlsRef.current;
    if(!controls)return;
    controls.update();
    controls.target.x=MathUtils.clamp(controls.target.x,-width*.25,width*1.25);
    controls.target.z=MathUtils.clamp(controls.target.z,-height*.25,height*1.25);
  });
  return null;
}
