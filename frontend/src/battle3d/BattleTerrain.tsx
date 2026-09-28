import {useEffect, useMemo, useState} from 'react';
import {SRGBColorSpace, TextureLoader, type Texture} from 'three';
import type {BattleMapDefinition} from '../solo-combat/boardGeometry';
import {buildTerrain} from './terrain/buildTerrain';
import {terrainMaterial} from './terrain/materials';

function BoardArtwork({url,width,height}: {url?:string;width:number;height:number}) {
  const [texture,setTexture]=useState<Texture|null>(null);
  useEffect(()=>{
    if(!url){setTexture(null);return;}
    let alive=true;
    const loaded=new TextureLoader().load(url,value=>{
      if(!alive)return;
      value.colorSpace=SRGBColorSpace;value.anisotropy=8;setTexture(value);
    },undefined,()=>{if(alive)setTexture(null);});
    return()=>{alive=false;loaded.dispose();};
  },[url]);
  const surface=terrainMaterial('earth');
  return <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[width/2,.005,height/2]}>
    <planeGeometry args={[width,height]}/>
    <meshStandardMaterial key={texture?.uuid??'loading'} map={texture} color={texture?'#e8e4d9':'#8a8878'} roughness={.94} bumpMap={surface.bumpMap} bumpScale={.018}/>
  </mesh>;
}

function BoardGrid({width,height}:{width:number;height:number}) {
  const vertices=useMemo(()=>{
    const values:number[]=[];
    for(let x=0;x<=width;x++)values.push(x,.042,0,x,.042,height);
    for(let z=0;z<=height;z++)values.push(0,.042,z,width,.042,z);
    return new Float32Array(values);
  },[width,height]);
  return <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[vertices,3]}/></bufferGeometry><lineBasicMaterial color="#c3bda8" transparent opacity={.15} depthWrite={false}/></lineSegments>;
}

/** Detailed scenery remains a read-only projection of the board's authored features. */
export default function BattleTerrain({map,width,height}:{map?:BattleMapDefinition;width:number;height:number}) {
  const signature=JSON.stringify([width,height,map?.id,map?.features]);
  const parts=useMemo(()=>buildTerrain(map,width,height),[signature]);
  const wood=terrainMaterial('wood');
  useEffect(()=>()=>{for(const part of parts)part.geometry.dispose();},[parts]);
  return <group name="sculpted-battle-terrain">
    <group name="carved-board-frame">
      <mesh position={[width/2,-.25,height/2]} receiveShadow castShadow><boxGeometry args={[width+.72,.43,height+.72]}/><meshStandardMaterial color="#72533b" map={wood.map} bumpMap={wood.bumpMap} bumpScale={.025} roughness={.76} metalness={.03}/></mesh>
      {[-.27,width+.27].map(x=><mesh key={`rail-x-${x}`} position={[x,.035,height/2]} castShadow receiveShadow><boxGeometry args={[.28,.25,height+.82]}/><meshStandardMaterial color="#af8053" map={wood.map} bumpMap={wood.bumpMap} bumpScale={.02} roughness={.7}/></mesh>)}
      {[-.27,height+.27].map(z=><mesh key={`rail-z-${z}`} position={[width/2,.035,z]} castShadow receiveShadow><boxGeometry args={[width+.82,.25,.28]}/><meshStandardMaterial color="#af8053" map={wood.map} bumpMap={wood.bumpMap} bumpScale={.02} roughness={.7}/></mesh>)}
      {[-.08,width+.08].map(x=><mesh key={`inlay-x-${x}`} position={[x,.165,height/2]}><boxGeometry args={[.018,.008,height+.18]}/><meshStandardMaterial color="#ac8c57" metalness={.63} roughness={.38}/></mesh>)}
      {[-.08,height+.08].map(z=><mesh key={`inlay-z-${z}`} position={[width/2,.165,z]}><boxGeometry args={[width+.18,.008,.018]}/><meshStandardMaterial color="#ac8c57" metalness={.63} roughness={.38}/></mesh>)}
      {[-.27,width+.27].flatMap(x=>[-.27,height+.27].map(z=><mesh key={`stud-${x}-${z}`} position={[x,.178,z]}><cylinderGeometry args={[.08,.08,.026,16]}/><meshStandardMaterial color="#b69a62" metalness={.68} roughness={.34}/></mesh>))}
    </group>
    {parts.map(part=><mesh key={part.paint} geometry={part.geometry} material={terrainMaterial(part.paint)} dispose={null} castShadow={part.paint!=='web'&&part.paint!=='water'} receiveShadow/>)}
    <BoardArtwork url={map?.background} width={width} height={height}/>
    <BoardGrid width={width} height={height}/>
    <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[width/2,-.55,height/2]}><planeGeometry args={[500,500]}/><meshStandardMaterial color="#171b1c" roughness={.96}/></mesh>
  </group>;
}
