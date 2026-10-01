import {useEffect, useMemo, useState} from 'react';
import {CanvasTexture, SRGBColorSpace, Texture, TextureLoader, Vector2} from 'three';
import {terrainMaterial} from './terrain/materials';
import {lostHealthFraction} from './tokenHealth';
import {coinAppearanceColor,fallenPortraitFragment} from './coinAppearance';

export type CoinFinish = 'stone' | 'bronze' | 'silver' | 'obsidian';

const FINISHES = {
  stone:{body:'#4b5250',edge:'#282f2e',inlay:'#9e8c69',roughness:.96,metalness:.02},
  bronze:{body:'#94704e',edge:'#493a30',inlay:'#e0b976',roughness:.57,metalness:.58},
  silver:{body:'#a8b1b0',edge:'#4e5a5c',inlay:'#e6e7dc',roughness:.38,metalness:.72},
  obsidian:{body:'#333b40',edge:'#161d22',inlay:'#9fa9b0',roughness:.28,metalness:.16},
} satisfies Record<CoinFinish,{body:string;edge:string;inlay:string;roughness:number;metalness:number}>;

function canvasTexture(draw:(ctx:CanvasRenderingContext2D)=>void) {
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=256;
  const context=canvas.getContext('2d');
  if(!context)return null;
  draw(context);
  const texture=new CanvasTexture(canvas);
  texture.colorSpace=SRGBColorSpace;
  return texture;
}

function usePortrait(url:string|undefined,name:string) {
  const fallback=useMemo(()=>canvasTexture(ctx=>{
    const gradient=ctx.createRadialGradient(100,70,4,128,128,170);
    gradient.addColorStop(0,'#5c645e');gradient.addColorStop(1,'#252d2d');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
    ctx.strokeStyle='#c2ac8066';ctx.lineWidth=5;
    ctx.beginPath();ctx.arc(128,128,113,0,Math.PI*2);ctx.stroke();
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 130px Georgia,serif';
    ctx.fillStyle='#ecdfc2';ctx.fillText(name.trim().slice(0,1).toUpperCase()||'?',128,132);
  }),[name]);
  const [portrait,setPortrait]=useState<Texture|null>(null);
  useEffect(()=>()=>{fallback?.dispose();},[fallback]);
  useEffect(()=>{
    setPortrait(null);
    if(!url)return;
    let live=true;
    const texture=new TextureLoader().load(url,loaded=>{
      if(!live)return;
      const image=loaded.image as HTMLImageElement;
      const aspect=image.naturalWidth/Math.max(1,image.naturalHeight);
      if(aspect>1){loaded.repeat.x=1/aspect;loaded.offset.x=(1-loaded.repeat.x)/2;}
      else {loaded.repeat.y=aspect;loaded.offset.y=(1-aspect)/2;}
      loaded.colorSpace=SRGBColorSpace;
      loaded.anisotropy=8;
      setPortrait(loaded);
    },undefined,()=>{if(live)setPortrait(null);});
    return()=>{live=false;texture.dispose();};
  },[url]);
  return portrait??fallback;
}

function useLostHealthMask(hp:number,maxHp:number,fallen:boolean) {
  const lost = lostHealthFraction(hp,maxHp);
  const texture=useMemo(()=>canvasTexture(ctx=>{
    ctx.fillStyle=fallen?'#777777':'#ae1923';
    ctx.fillRect(0,256*(1-lost),256,256*lost);
  }),[lost,fallen]);
  useEffect(()=>()=>{texture?.dispose();},[texture]);
  return texture;
}

/** A portrait set into a carved coin. Only the read-only combat projection supplies its appearance. */
export default function CoinToken({portraitUrl,name,hp,maxHp,accent,finish='stone',fallen=hp<=0}: {
  portraitUrl?:string;name:string;hp:number;maxHp:number;accent:string;finish?:CoinFinish;fallen?:boolean;
}) {
  const portrait=usePortrait(portraitUrl,name);
  const lostHealth=useLostHealthMask(hp,maxHp,fallen);
  const material={...FINISHES[finish],body:coinAppearanceColor(FINISHES[finish].body,fallen),edge:coinAppearanceColor(FINISHES[finish].edge,fallen),inlay:coinAppearanceColor(FINISHES[finish].inlay,fallen)};
  const stone=terrainMaterial('stone');
  const appearanceShader=(shader:{fragmentShader:string})=>{if(fallen)shader.fragmentShader=fallenPortraitFragment(shader.fragmentShader);};
  const appearanceKey=()=>fallen?'battle-fallen-coin':'battle-living-coin';
  const profile=useMemo(()=>[
    new Vector2(0,0),new Vector2(.445,0),new Vector2(.46,.012),
    new Vector2(.46,.165),new Vector2(.448,.178),new Vector2(0,.178),
  ],[]);
  return <group name={`coin:${name}`}>
    <mesh castShadow receiveShadow><latheGeometry args={[profile,48]}/><meshStandardMaterial key={fallen?'fallen':'living'} color={material.body} map={finish==='stone'?stone.map:null} bumpMap={finish==='stone'?stone.bumpMap:null} roughnessMap={finish==='stone'?stone.roughnessMap:null} bumpScale={.03} roughness={material.roughness} metalness={material.metalness} onBeforeCompile={appearanceShader} customProgramCacheKey={appearanceKey}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.09,0]} castShadow><torusGeometry args={[.454,.01,4,48]}/><meshStandardMaterial key={fallen?'fallen':'living'} color={material.edge} map={finish==='stone'?stone.map:null} roughness={material.roughness} metalness={material.metalness} onBeforeCompile={appearanceShader} customProgramCacheKey={appearanceKey}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.181,0]}><ringGeometry args={[.416,.438,48]}/><meshStandardMaterial color={material.inlay} roughness={.72} metalness={.24}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.187,0]}><circleGeometry args={[.383,64]}/><meshBasicMaterial color={coinAppearanceColor('#252a27',fallen)}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.191,0]}><circleGeometry args={[.378,64]}/><meshBasicMaterial key={fallen?'fallen':'living'} map={portrait} color="#ffffff" onBeforeCompile={shader=>{if(fallen)shader.fragmentShader=fallenPortraitFragment(shader.fragmentShader);}} customProgramCacheKey={()=>fallen?'battle-fallen-portrait':'battle-living-portrait'}/></mesh>
    {lostHealth&&<mesh name="lost-health-shading" rotation={[-Math.PI/2,0,0]} position={[0,.194,0]}><circleGeometry args={[.378,64]}/><meshBasicMaterial map={lostHealth} transparent opacity={.36} depthWrite={false} toneMapped={false}/></mesh>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.196,0]}><ringGeometry args={[.387,.411,64]}/><meshBasicMaterial color={coinAppearanceColor('#26302d',fallen)}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.203,0]}><ringGeometry args={[.378,.384,64]}/><meshBasicMaterial color={coinAppearanceColor(accent,fallen)} transparent opacity={.8}/></mesh>
  </group>;
}
