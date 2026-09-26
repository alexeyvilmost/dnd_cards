import {DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType} from 'three';

export type TerrainPaint = 'stone'|'earth'|'wood'|'bark'|'endgrain'|'metal'|'moss'|'water'|'charcoal'|'flame'|'web';
type TextureKind = 'stone'|'earth'|'wood'|'bark'|'endgrain'|'water';

/** Stable noise keeps scenery identical after reload and across visual instances. */
export function randomSource(key:string) {
  let state=2166136261;
  for(const char of key)state=Math.imul(state^char.charCodeAt(0),16777619)>>>0;
  return ()=>{state+=0x6D2B79F5;let value=Math.imul(state^(state>>>15),1|state);value^=value+Math.imul(value^(value>>>7),61|value);return((value^(value>>>14))>>>0)/4294967296;};
}

function hash(x:number,y:number) {return Math.sin(x*127.1+y*311.7)*43758.5453123%1;}
function noise(x:number,y:number) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const value=(a:number,b:number)=>{const h=hash(a,b);return h-Math.floor(h);};
  const a=value(ix,iy)*(1-sx)+value(ix+1,iy)*sx,b=value(ix,iy+1)*(1-sx)+value(ix+1,iy+1)*sx;
  return a*(1-sy)+b*sy;
}
function layers(x:number,y:number) {return noise(x,y)*.52+noise(x*2.07,y*2.07)*.26+noise(x*4.11,y*4.11)*.14+noise(x*8.3,y*8.3)*.08;}

const textureCache=new Map<TextureKind,{albedo:DataTexture;bump:DataTexture;roughness:DataTexture}>();
function surfaceTextures(kind:TextureKind) {
  const cached=textureCache.get(kind);if(cached)return cached;
  const size=256,albedo=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4),rough=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,n=layers(u*8,v*8),fine=noise(u*120,v*120);
    let height=n*.72+fine*.28,brightness=.65+n*.29,roughness=.82;
    if(kind==='stone'){
      const vein=Math.abs(Math.sin(u*22+v*10+layers(u*6,v*6)*7));
      const pores=fine<.22?.16:0;
      height=Math.max(0,height-pores-(vein<.055?.22:0));brightness=.68+n*.24-pores*.45;roughness=.77+fine*.2;
    }else if(kind==='earth'){
      height=n*.44+fine*.56;brightness=.55+n*.25+fine*.08;roughness=.89;
    }else if(kind==='wood'||kind==='bark'){
      const wave=u*(kind==='bark'?19:45)+layers(u*4,v*2)*2.4+Math.sin(v*8)*.19;
      const grain=Math.pow(.5+.5*Math.sin(wave*Math.PI*2),kind==='bark'?5:12);
      const split=noise(u*64,v*5)>.72?.19:0;
      height=(kind==='bark'?n*.35+grain*.5:n*.45+grain*.18)+fine*.12-split;
      brightness=(kind==='bark'?.49:.63)+n*.22-grain*.18-split;roughness=.79+fine*.17;
    }else if(kind==='endgrain'){
      const dx=u-.48,dy=v-.51,r=Math.hypot(dx,dy),ring=.5+.5*Math.sin(r*180+layers(u*6,v*6)*3);
      height=ring*.37+n*.4+fine*.12;brightness=.66+ring*.12+n*.15;roughness=.86;
    }else{
      height=.5+Math.sin(u*35+v*9+n*3)*.18+Math.sin(u*13-v*31)*.07;brightness=.78+height*.13;roughness=.19;
    }
    const index=(y*size+x)*4;
    for(let channel=0;channel<3;channel++){albedo[index+channel]=Math.max(0,Math.min(255,brightness*255));bump[index+channel]=Math.max(0,Math.min(255,height*255));rough[index+channel]=roughness*255;}
    albedo[index+3]=bump[index+3]=rough[index+3]=255;
  }
  const make=(data:Uint8Array)=>{const texture=new DataTexture(data,size,size,RGBAFormat,UnsignedByteType);texture.wrapS=texture.wrapT=RepeatWrapping;texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;texture.anisotropy=4;return texture;};
  const result={albedo:make(albedo),bump:make(bump),roughness:make(rough)};result.albedo.colorSpace=SRGBColorSpace;textureCache.set(kind,result);return result;
}

const materials=new Map<TerrainPaint,MeshStandardMaterial>();
/** Shared procedural PBR surfaces; vertex paint varies individual stones without extra draws. */
export function terrainMaterial(paint:TerrainPaint) {
  const cached=materials.get(paint);if(cached)return cached;
  const material=new MeshStandardMaterial({vertexColors:true,roughness:.88,metalness:0});
  const kind:TextureKind|null=['stone','earth','wood','bark','endgrain','water'].includes(paint)?paint as TextureKind:paint==='charcoal'?'bark':null;
  if(kind){const textures=surfaceTextures(kind);material.map=textures.albedo;material.bumpMap=textures.bump;material.roughnessMap=textures.roughness;material.bumpScale=paint==='bark'?.09:paint==='water'?.07:paint==='stone'?.045:.025;}
  if(paint==='metal'){material.roughness=.68;material.metalness=.72;}
  if(paint==='moss'){material.roughness=.96;material.side=DoubleSide;}
  if(paint==='water'){material.roughness=.26;material.metalness=.22;}
  if(paint==='flame'){material.emissive.set('#ec671b');material.emissiveIntensity=.65;material.roughness=.4;}
  if(paint==='web'){material.transparent=true;material.opacity=.63;material.depthWrite=false;material.roughness=.62;}
  materials.set(paint,material);return material;
}
