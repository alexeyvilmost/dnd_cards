#!/usr/bin/env node
// Additive, full-resolution PNG -> WebP conversion. Sources are never written.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {walkFiles,localURL} from './media-inventory.mjs';
import {repositoryRoot} from '../testing/runtime.mjs';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const encoderOptions=Object.freeze({lossless:true,exact:true,effort:6});
export function pngPolicy(bytes) {
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'invalid_png';
  if(bytes[24]!==8)return 'only_8_bit_PNG_supported';
  const standardChrm=[31270,32900,64000,33000,30000,60000,15000,6000];
  let offset=8,ended=false;
  while(offset+12<=bytes.length) {
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
    if(length>bytes.length-offset-12)return 'invalid_png_chunk';
    const data=bytes.subarray(offset+8,offset+8+length);
    if(type==='acTL')return 'animated_original_preserved';
    if(type==='gAMA'&&(length!==4||data.readUInt32BE(0)!==45455))return 'nonstandard_gamma_original_preserved';
    if(type==='cHRM'&&(length!==32||standardChrm.some((n,i)=>data.readUInt32BE(i*4)!==n)))return 'nonstandard_chromaticity_original_preserved';
    if(type==='sRGB'&&(length!==1||data[0]>3))return 'invalid_sRGB';
    if(['cICP','mDCV','cLLI','eXIf'].includes(type))return 'unsupported_color_or_orientation_metadata';
    if(type==='sBIT'&&[...data].some(n=>n!==8))return 'unsupported_significant_bits';
    offset+=length+12;
    if(type==='IEND'){ended=true;break;}
  }
  return ended&&offset===bytes.length?null:'invalid_png_ending';
}
export function loadEncoder(moduleName='sharp') {
  const require=createRequire(import.meta.url),sharp=require(moduleName);
  if(sharp.versions?.sharp!=='0.35.4'||sharp.versions?.webp!=='1.6.0')throw Error('Encoder must be pinned to Sharp 0.35.4 / libwebp 1.6.0; review pixel proof before changing it');
  sharp.concurrency(1);
  const entry=require.resolve(moduleName);
  return {sharp,provenance:{name:'sharp',versions:sharp.versions,moduleEntrySha256:sha256(readFileSync(entry)),options:encoderOptions}};
}
export async function encodeVerifiedPNG(bytes,sharp) {
  const reason=pngPolicy(bytes);if(reason)return {status:'original',reason};
  const metadata=await sharp(bytes,{failOn:'warning'}).metadata();
  if(metadata.format!=='png'||metadata.depth!=='uchar'||metadata.space!=='srgb'||(metadata.pages??1)!==1||metadata.orientation)return {status:'original',reason:'unsupported_metadata'};
  const decode=input=>sharp(input,{failOn:'warning'}).toColourspace('srgb').ensureAlpha().raw({depth:'uchar'}).toBuffer({resolveWithObject:true});
  const original=await decode(bytes);
  // Chrome's PNG and WebP decoders round premultiplied colour differently for
  // partial alpha. Preserve these originals even when the native raw pixels
  // match. This property gate also excludes the few partial-alpha examples
  // that happened to match in one browser run.
  let partialAlphaPixels=0;
  for(let i=3;i<original.data.length;i+=4)if(original.data[i]!==0&&original.data[i]!==255)partialAlphaPixels++;
  if(partialAlphaPixels)return {status:'original',reason:'partial_alpha_browser_rounding_original_preserved',partialAlphaPixels};
  const output=await sharp(bytes,{failOn:'warning'}).keepIccProfile().webp(encoderOptions).toBuffer();
  const encodedMetadata=await sharp(output,{failOn:'warning'}).metadata();
  const icc=metadata.icc??Buffer.alloc(0),encodedIcc=encodedMetadata.icc??Buffer.alloc(0);
  if(!icc.equals(encodedIcc))return {status:'original',reason:'ICC_not_preserved_byte_for_byte'};
  const variant=await decode(output);
  if(original.info.width!==variant.info.width||original.info.height!==variant.info.height||original.info.channels!==4||variant.info.channels!==4||!original.data.equals(variant.data))return {status:'original',reason:'decoded_RGBA_mismatch'};
  const proof={width:original.info.width,height:original.info.height,channels:4,depth:'uchar',rgbaSha256:sha256(original.data),rgbaBytes:original.data.length,iccSha256:icc.length?sha256(icc):null,iccBytes:icc.length,transparentRGB:'exact_compared',alphaPolicy:'opaque_or_binary_alpha_only',colorPolicy:'sRGB_or_byte_identical_ICC; standard_PNG_gamma_chromaticity_only'};
  if(output.length>=bytes.length)return {status:'original',reason:'variant_not_smaller',candidateBytes:output.length,proof};
  return {status:'variant',output,proof};
}
export async function buildMediaVariants({publicDirectory=path.join(repositoryRoot,'frontend/public'),outputDirectory,sharpModule='sharp',onProgress=()=>{}}) {
  if(!outputDirectory||existsSync(outputDirectory))throw Error('Output directory must be new; existing data is never overwritten');
  const sourceRoot=path.resolve(publicDirectory),destination=path.resolve(outputDirectory);
  if(destination===sourceRoot||destination.startsWith(sourceRoot+path.sep))throw Error('Variants must be generated outside public originals');
  const {sharp,provenance}=loadEncoder(sharpModule),sources=walkFiles(sourceRoot).filter(row=>path.extname(row.relative).toLowerCase()==='.png');
  mkdirSync(destination,{recursive:true});mkdirSync(path.join(destination,'files'));
  const entries=[],startedAt=new Date().toISOString();
  for(const [index,file] of sources.entries()) {
    const bytes=readFileSync(file.absolute),result=await encodeVerifiedPNG(bytes,sharp);
    const row={sourcePath:file.relative,sourceURL:localURL(file.relative),sourceSha256:sha256(bytes),sourceBytes:bytes.length,status:result.status};
    if(result.status==='variant') {
      const hash=sha256(result.output),name=hash+'.webp',target=path.join(destination,'files',name);
      if(!existsSync(target))writeFileSync(target,result.output,{flag:'wx'});
      Object.assign(row,{variantURL:'/media/variants/'+name,variantSha256:hash,variantBytes:result.output.length,proof:result.proof});
    } else Object.assign(row,{reason:result.reason,...(result.partialAlphaPixels?{partialAlphaPixels:result.partialAlphaPixels}:{}),...(result.candidateBytes?{candidateBytes:result.candidateBytes}:{}),...(result.proof?{proof:result.proof}:{})});
    if(sha256(readFileSync(file.absolute))!==row.sourceSha256)throw Error('Original changed during encoding; discard this incomplete bundle');
    entries.push(row);onProgress({completed:index+1,total:sources.length,status:row.status});
  }
  const selected=entries.filter(row=>row.status==='variant'),sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);
  const manifest={schemaVersion:1,kind:'pixel_verified_lossless_webp',startedAt,completedAt:new Date().toISOString(),encoder:provenance,entries,summary:{PNGFiles:entries.length,variants:selected.length,originalOnly:entries.length-selected.length,allSourcePNGBytes:sum(entries,'sourceBytes'),selectedSourceBytes:sum(selected,'sourceBytes'),selectedVariantBytes:sum(selected,'variantBytes'),requestBytesSaved:sum(selected,'sourceBytes')-sum(selected,'variantBytes'),originalsRetained:true,gitBytesRemoved:0,HTTPTransfer:'not_measured',visualPrintAcceptance:'pending_default_OFF'}};
  writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){const key={'--public':'publicDirectory','--output':'outputDirectory','--sharp-module':'sharpModule'}[args[i]];if(!key||!args[i+1])throw Error('Usage: build-media-variants.mjs --output NEW_DIR [--public DIR] [--sharp-module PATH]');options[key]=args[i+1];}
  const report=await buildMediaVariants({...options,onProgress:p=>{if(p.completed%10===0||p.completed===p.total)console.error(`Verified ${p.completed}/${p.total} PNG inputs`);}});
  console.log(JSON.stringify(report.summary,null,2));
}
