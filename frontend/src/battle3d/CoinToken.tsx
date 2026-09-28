import {useEffect, useMemo, useState} from 'react';
import {CanvasTexture, Color, SRGBColorSpace, Texture, TextureLoader, Vector2} from 'three';
import {terrainMaterial} from './terrain/materials';

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

function useHealthNumber(hp:number) {
  const texture=useMemo(()=>canvasTexture(ctx=>{
    ctx.fillStyle='#202622';ctx.beginPath();ctx.arc(128,128,117,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#d8c397';ctx.lineWidth=12;ctx.stroke();
    ctx.fillStyle='#f7ead0';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='#000';ctx.shadowBlur=8;
    ctx.font=`bold ${hp>99?102:hp>9?132:158}px Georgia,serif`;
    ctx.fillText(String(Math.max(0,hp)),128,137);
  }),[hp]);
  useEffect(()=>()=>{texture?.dispose();},[texture]);
  return texture;
}

/** A portrait set into a carved coin. Only the read-only combat projection supplies its appearance. */
export default function CoinToken({portraitUrl,name,hp,maxHp,accent,finish='stone'}: {
  portraitUrl?:string;name:string;hp:number;maxHp:number;accent:string;finish?:CoinFinish;
}) {
  const portrait=usePortrait(portraitUrl,name);
  const number=useHealthNumber(hp);
  const material=FINISHES[finish];
  const stone=terrainMaterial('stone');
  const profile=useMemo(()=>[
    new Vector2(0,0),new Vector2(.445,0),new Vector2(.46,.012),
    new Vector2(.46,.165),new Vector2(.448,.178),new Vector2(0,.178),
  ],[]);
  const ratio=Math.max(0,Math.min(1,hp/Math.max(1,maxHp)));
  const healthColor=useMemo(()=>ratio>.5
    ? new Color('#d4aa65').lerp(new Color('#69c18c'),(ratio-.5)*2)
    : new Color('#c96859').lerp(new Color('#d4aa65'),ratio*2),[ratio]);
  return <group name={`coin:${name}`}>
    <mesh castShadow receiveShadow><latheGeometry args={[profile,48]}/><meshStandardMaterial color={material.body} map={finish==='stone'?stone.map:null} bumpMap={finish==='stone'?stone.bumpMap:null} roughnessMap={finish==='stone'?stone.roughnessMap:null} bumpScale={.03} roughness={material.roughness} metalness={material.metalness}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.09,0]} castShadow><torusGeometry args={[.454,.01,4,48]}/><meshStandardMaterial color={material.edge} map={finish==='stone'?stone.map:null} roughness={material.roughness} metalness={material.metalness}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.181,0]}><ringGeometry args={[.416,.438,48]}/><meshStandardMaterial color={material.inlay} roughness={.72} metalness={.24}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.187,0]}><circleGeometry args={[.383,64]}/><meshBasicMaterial color="#252a27"/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.191,0]}><circleGeometry args={[.378,64]}/><meshBasicMaterial map={portrait} color={hp<=0?'#797c79':'#ffffff'}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.196,0]}><ringGeometry args={[.387,.411,64]}/><meshBasicMaterial color="#26302d"/></mesh>
    {ratio>0&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.2,0]}><ringGeometry args={[.387,.411,64,1,Math.PI/2,Math.PI*2*ratio]}/><meshBasicMaterial color={healthColor} toneMapped={false}/></mesh>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.203,0]}><ringGeometry args={[.378,.384,64]}/><meshBasicMaterial color={accent} transparent opacity={.8}/></mesh>
    {number&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.21,.29]}><circleGeometry args={[.082,32]}/><meshBasicMaterial map={number} transparent depthWrite={false}/></mesh>}
  </group>;
}
