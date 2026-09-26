// Development-only inspection of the same models/materials used by real combat.
import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {ACESFilmicToneMapping, PCFShadowMap} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import BattleLighting from '../../src/battle3d/BattleLighting';
import {getMiniatureHeight, MiniatureModel, MINIATURE_RECIPES} from '../../src/battle3d/miniatures';

function StudioCamera({height}: {height:number}) {
  const {camera,gl,invalidate}=useThree();
  const [controls]=useState(()=>new OrbitControls(camera,gl.domElement));
  useEffect(()=>{
    camera.position.set(5.1,2.6,6.3);
    controls.target.set(3,height*.48,2);
    controls.minDistance=1.7;
    controls.maxDistance=8;
    controls.minPolarAngle=.2;
    controls.maxPolarAngle=Math.PI*.48;
    controls.enableDamping=true;
    const redraw=()=>invalidate();
    controls.addEventListener('change',redraw);
    controls.update();
    invalidate();
    return ()=>{controls.removeEventListener('change',redraw);};
  },[camera,controls,height,invalidate]);
  useEffect(()=>()=>controls.dispose(),[controls]);
  useFrame(()=>controls.update());
  return null;
}

function Studio() {
  const [selected,setSelected]=useState<keyof typeof MINIATURE_RECIPES>('guard');
  const recipe=MINIATURE_RECIPES[selected];
  return <main style={{minHeight:'100vh',background:'#131b19',color:'#e1d7bf',fontFamily:'Georgia,serif'}}>
    <header style={{padding:'20px 28px',display:'flex',gap:18,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #97856344'}}>
      <div><h1 style={{fontSize:24,margin:'0 0 5px'}}>Мастерская миниатюр</h1><p style={{margin:0,fontSize:13,color:'#afa892'}}>Та же фигурка, что на поле боя · перетаскивайте для осмотра, колесо меняет масштаб</p></div>
      <select aria-label="Миниатюра" value={selected} onChange={event=>setSelected(event.target.value as keyof typeof MINIATURE_RECIPES)} style={{marginLeft:'auto',padding:10,border:'1px solid #a4947255',borderRadius:6,color:'#e1d7bf',background:'#252b25'}}>
        {Object.entries(MINIATURE_RECIPES).map(([id,model])=><option key={id} value={id}>{model.label}</option>)}
      </select>
    </header>
    <div style={{height:'calc(100vh - 100px)',minHeight:400}}>
      <Canvas shadows={{type:PCFShadowMap}} frameloop="demand" dpr={[1,1.75]} camera={{fov:32,near:.1,far:50,position:[5.1,2.6,6.3]}} gl={{antialias:true,toneMapping:ACESFilmicToneMapping,toneMappingExposure:1.05}}>
        <BattleLighting width={6} height={4}/>
        <StudioCamera height={getMiniatureHeight(recipe)}/>
        <group position={[3,0,2]}><MiniatureModel recipe={recipe} pedestalColor="#59635e"/></group>
        <mesh rotation={[-Math.PI/2,0,0]} position={[3,-.006,2]} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#343a33" roughness={.94}/></mesh>
      </Canvas>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Studio/>);
