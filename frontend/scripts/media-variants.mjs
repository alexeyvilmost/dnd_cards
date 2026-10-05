// Build-time adapter has no encoder dependency. Disabled builds never read a bundle.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function safeRead(root,relative) {
  if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(relative))throw Error('Unsafe media path');
  let filename=path.resolve(root);
  if(lstatSync(filename).isSymbolicLink())throw Error('Media bundle/source root cannot be a symlink');
  for(const segment of relative.split('/')){filename=path.join(filename,segment);if(lstatSync(filename).isSymbolicLink())throw Error('Media inputs cannot be symlinks');}
  if(!lstatSync(filename).isFile())throw Error('Media input must be a file');
  return readFileSync(filename);
}
const sourceURL=relative=>'/'+relative.split('/').map(encodeURIComponent).join('/');
function PNGPaths(root,prefix='') {
  const paths=[];
  for(const entry of readdirSync(root,{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw Error('Public originals cannot contain symlinks');
    if(entry.isDirectory())paths.push(...PNGPaths(path.join(root,entry.name),prefix+entry.name+'/'));
    else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.png'))paths.push(prefix+entry.name);
  }
  return paths;
}
export function prepareMediaVariants({enabled=false,bundleDirectory,publicDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public'),inspectionOnly=false}={}) {
  if(!enabled)return {runtimeManifest:null,plugin:null,summary:{enabled:false,originals:true}};
  if(!bundleDirectory)throw Error('VITE_MEDIA_VARIANTS=1 requires MEDIA_VARIANTS_BUNDLE with verified files');
  const bytes=safeRead(bundleDirectory,'manifest.json');if(bytes.length>2*1024*1024)throw Error('Media manifest exceeds bound');
  const manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==1||manifest.kind!=='pixel_verified_lossless_webp'||!Array.isArray(manifest.entries)||manifest.entries.length>512||manifest.encoder?.versions?.sharp!=='0.35.4'||manifest.encoder?.versions?.webp!=='1.6.0'||manifest.encoder?.options?.lossless!==true||manifest.encoder?.options?.exact!==true)throw Error('Invalid media manifest/encoder contract');
  const runtimeEntries={},files=new Map(),seen=new Set();
  for(const row of manifest.entries) {
    if(!plain(row)||!digest(row.sourceSha256)||!Number.isSafeInteger(row.sourceBytes)||row.sourceBytes<1||typeof row.sourcePath!=='string'||!row.sourcePath.toLowerCase().endsWith('.png')||row.sourceURL!==sourceURL(row.sourcePath)||seen.has(row.sourcePath))throw Error('Invalid media source record');
    const source=safeRead(publicDirectory,row.sourcePath);if(source.length!==row.sourceBytes||hash(source)!==row.sourceSha256)throw Error('Media original no longer matches proof');
    seen.add(row.sourcePath);
    if(row.status==='original')continue;
    const proof=row.proof;
    if(row.status!=='variant'||!digest(row.variantSha256)||row.variantURL!==`/media/variants/${row.variantSha256}.webp`||!Number.isSafeInteger(row.variantBytes)||row.variantBytes<1||row.variantBytes>=row.sourceBytes||!plain(proof)||!Number.isSafeInteger(proof.width)||!Number.isSafeInteger(proof.height)||proof.width<1||proof.height<1||proof.width*proof.height>268402689||proof.channels!==4||proof.depth!=='uchar'||proof.rgbaBytes!==proof.width*proof.height*4||!digest(proof.rgbaSha256)||proof.transparentRGB!=='exact_compared'||(!inspectionOnly&&proof.alphaPolicy!=='opaque_or_binary_alpha_only')||!Number.isSafeInteger(proof.iccBytes)||proof.iccBytes<0||(proof.iccBytes>0?!digest(proof.iccSha256):proof.iccSha256!==null))throw Error('Invalid pixel proof or variant URL');
    const fileName=`media/variants/${row.variantSha256}.webp`,sourceBytes=safeRead(bundleDirectory,`files/${row.variantSha256}.webp`);
    if(sourceBytes.length!==row.variantBytes||hash(sourceBytes)!==row.variantSha256)throw Error('Media variant hash mismatch');
    files.set(fileName,sourceBytes);
    runtimeEntries[row.sourceURL]={url:row.variantURL,sha256:row.variantSha256,sourceSha256:row.sourceSha256,width:proof.width,height:proof.height};
  }
  const actual=PNGPaths(publicDirectory);if(actual.length!==seen.size||actual.some(p=>!seen.has(p)))throw Error('Media proof omits a current PNG original');
  const runtimeManifest={schemaVersion:1,entries:runtimeEntries};
  const plugin={name:'verified-lossless-media',apply:'build',generateBundle(){for(const [fileName,source] of files)this.emitFile({type:'asset',fileName,source});}};
  // Explicit diagnostics may inspect an old native-only candidate. They never
  // return a runtime mapping or emit plugin, so it cannot become a UI build.
  return {runtimeManifest:inspectionOnly?null:runtimeManifest,plugin:inspectionOnly?null:plugin,summary:{enabled:!inspectionOnly,inspectionOnly,variants:Object.keys(runtimeEntries).length,uniqueFiles:files.size,variantBytes:[...files.values()].reduce((n,b)=>n+b.length,0),originals:true}};
}
export function prepareMediaVariantsFromEnvironment(env=process.env) {
  return prepareMediaVariants({enabled:env.VITE_MEDIA_VARIANTS==='1',bundleDirectory:env.MEDIA_VARIANTS_BUNDLE});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(prepareMediaVariantsFromEnvironment().summary));
