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
  useEffect(()=>()=>{for(const part of parts)part.geometry.dispose();},[parts]);
  return <group name="sculpted-battle-terrain">
    {parts.map(part=><mesh key={part.paint} geometry={part.geometry} material={terrainMaterial(part.paint)} dispose={null} castShadow={part.paint!=='web'&&part.paint!=='water'} receiveShadow/>)}
    <BoardArtwork url={map?.background} width={width} height={height}/>
    <BoardGrid width={width} height={height}/>
    <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[width/2,-.55,height/2]}><planeGeometry args={[500,500]}/><meshStandardMaterial color="#101712" roughness={.96}/></mesh>
  </group>;
}
