import {useEffect, useRef} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {MathUtils, MOUSE, PerspectiveCamera, TOUCH, Vector3} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {GridPosition} from '../solo-combat/types';

export type CameraCommand = {id:number; kind:'in'|'out'|'reset'|'hero'};

export function frameBattleCamera(camera: PerspectiveCamera, width:number, height:number, maxHeight=2.4) {
  const vertical=MathUtils.degToRad(camera.fov);
  const horizontal=2*Math.atan(Math.tan(vertical/2)*camera.aspect);
  const center=new Vector3(width/2,0,height/2);
  const distance=Math.max((width+.8)/(2*Math.tan(horizontal/2)),(height+.8)/(2*Math.tan(vertical/2)))+maxHeight;
  camera.up.set(0,0,-1);
  camera.position.set(center.x,distance,center.z);
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
    controls.enableRotate=false;
    controls.enablePan=true;
    controls.screenSpacePanning=true;
    controls.mouseButtons.LEFT=MOUSE.PAN;
    controls.touches.ONE=TOUCH.PAN;
    controls.touches.TWO=TOUCH.DOLLY_PAN;
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
    const lost=(event:Event)=>{event.preventDefault();onUnavailable('Поле с монетками отключено: графический контекст недоступен.');};
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
      controls.target.set(hero.x,0,hero.y);
      camera.position.copy(controls.target).add(offset);
    }else{
      const offset=camera.position.clone().sub(controls.target);
      if(command.kind==='in'||command.kind==='out')offset.multiplyScalar(command.kind==='in'?.8:1.25).clampLength(controls.minDistance,controls.maxDistance);
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
