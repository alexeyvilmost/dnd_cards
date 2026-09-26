import {useEffect, useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import {Object3D, PMREMGenerator} from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Broad studio reflections make sculpted metal, leather and stone read as different materials. */
export default function BattleLighting({width, height}: {width:number; height:number}) {
  const {gl, scene, invalidate}=useThree();
  const target=useMemo(()=>{
    const object=new Object3D();
    object.position.set(width/2,0,height/2);
    return object;
  },[width,height]);
  useEffect(()=>{
    const room=new RoomEnvironment();
    const generator=new PMREMGenerator(gl);
    const environment=generator.fromScene(room,.06);
    const previous=scene.environment;
    const previousIntensity=scene.environmentIntensity;
    scene.environment=environment.texture;
    scene.environmentIntensity=.38;
    room.dispose();
    generator.dispose();
    invalidate();
    return ()=>{
      scene.environment=previous;
      scene.environmentIntensity=previousIntensity;
      environment.dispose();
    };
  },[gl,scene,invalidate]);
  const span=Math.max(width,height)*.78;
  return <>
    <color attach="background" args={['#131b19']}/>
    <fog attach="fog" args={['#131b19',110,230]}/>
    <hemisphereLight args={['#cdd8dc','#554731',.75]}/>
    <primitive object={target}/>
    <directionalLight position={[width/2-7,16,height/2+5]} target={target}
      color="#fff0d8" intensity={3.1} castShadow
      shadow-mapSize-width={2048} shadow-mapSize-height={2048}
      shadow-camera-left={-span} shadow-camera-right={span}
      shadow-camera-top={span} shadow-camera-bottom={-span}
      shadow-camera-near={.5} shadow-camera-far={55}
      shadow-normalBias={.014} shadow-bias={-.00008} shadow-radius={2.5}/>
    <directionalLight position={[width+4,9,-5]} target={target} intensity={1.05} color="#c9dfe8"/>
  </>;
}
