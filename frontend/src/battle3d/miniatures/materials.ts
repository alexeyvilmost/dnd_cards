import {DataTexture,LinearFilter,LinearMipmapLinearFilter,MeshStandardMaterial,RepeatWrapping,RGBAFormat,SRGBColorSpace} from 'three';
import type {Paint} from './sculpt';

type SurfaceKind='metal'|'armor'|'accent'|'cloth'|'leather'|'skin'|'bone'|'dark'|'eyes'|'fur'|'scale';
const finishes:Record<SurfaceKind,{roughness:number;metalness:number;bumpScale:number}>={
  metal:{roughness:.34,metalness:.83,bumpScale:.0002},armor:{roughness:.46,metalness:.66,bumpScale:.0003},accent:{roughness:.44,metalness:.63,bumpScale:.0002},
  cloth:{roughness:.94,metalness:0,bumpScale:.0011},leather:{roughness:.79,metalness:0,bumpScale:.0009},skin:{roughness:.73,metalness:0,bumpScale:.00035},
  bone:{roughness:.83,metalness:0,bumpScale:.0006},dark:{roughness:.86,metalness:0,bumpScale:.0004},eyes:{roughness:.27,metalness:.015,bumpScale:0},
  fur:{roughness:.98,metalness:0,bumpScale:.001},scale:{roughness:.75,metalness:.015,bumpScale:.0006},
};

function hash(x:number,y:number){const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);}
function detailTexture(kind:SurfaceKind,mode:'color'|'bump'|'roughness'){
  const size=128,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y+=1)for(let x=0;x<size;x+=1){
    const noise=hash(x,y),coarse=hash(Math.floor(x/8),Math.floor(y/8));
    const weave=kind==='cloth'?(Math.sin(x*Math.PI*.5)*Math.cos(y*Math.PI*.5))*.16:
      kind==='fur'?Math.sin(x*.8+Math.sin(y*.2))*.11:kind==='leather'?Math.sin(x*.31+y*.61)*.05:0;
    const height=.52+(noise-.5)*.24+(coarse-.5)*.13+weave;
    const value=mode==='color'?Math.round(228+height*23):mode==='roughness'?Math.round(218+height*36):Math.round(Math.max(0,Math.min(1,height))*255);
    const index=(y*size+x)*4;pixels[index]=pixels[index+1]=pixels[index+2]=value;pixels[index+3]=255;
  }
  const texture=new DataTexture(pixels,size,size,RGBAFormat);texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.generateMipmaps=true;texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=4;
  if(mode==='color')texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

const textures=new Map<SurfaceKind,{color:DataTexture;surface:DataTexture;roughness:DataTexture}>();
const materials=new Map<string,MeshStandardMaterial>();

/** Shared deterministic surface detail. No downloads, canvas assets or per-frame texture work. */
export function miniatureMaterial(color:string,paint:Paint):MeshStandardMaterial{
  const key=`${color}:${paint}`,cached=materials.get(key);if(cached)return cached;
  let detail=textures.get(paint);
  if(!detail){detail={color:detailTexture(paint,'color'),surface:detailTexture(paint,'bump'),roughness:detailTexture(paint,'roughness')};textures.set(paint,detail);}
  const finish=finishes[paint];
  const material=new MeshStandardMaterial({color,roughness:finish.roughness,metalness:finish.metalness,
    map:detail.color,bumpMap:finish.bumpScale?detail.surface:null,bumpScale:finish.bumpScale,roughnessMap:detail.roughness,
    flatShading:false});
  materials.set(key,material);return material;
}
