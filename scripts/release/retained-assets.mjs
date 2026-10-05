import {constants,copyFileSync,existsSync,lstatSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {checksum} from './backup-manifest.mjs';

// Keep this URL eligibility in sync with the immutable nginx routes. Authored
// assets and HTML/service-worker entry points are mutable and are not copied.
export function isRetainableAsset(relative) {
  if(typeof relative!=='string'||relative.includes('\\')||/[?#%:\x00-\x1f]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))return false;
  return /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2|png|svg|jpg|jpeg|webp|avif)$/.test(relative)
    || /^workbox-[a-f0-9]+\.js$/.test(relative)
    || /^media\/variants\/[a-f0-9]{64}\.webp$/.test(relative);
}
function directory(absolute,{create=false}={}) {
  const resolved=path.resolve(absolute),parsed=path.parse(resolved);let current=parsed.root;
  for(const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    if(!existsSync(current)){if(!create)throw Error('Retained asset directory missing');mkdirSync(current);}
    const info=lstatSync(current);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Retained asset directory must not traverse symlinks');
  }
  return resolved;
}
export async function retainImmutableAssets(sourceDirectory,destinationDirectory) {
  const source=directory(sourceDirectory),destination=path.resolve(destinationDirectory);
  if(source===destination||source.startsWith(destination+path.sep)||destination.startsWith(source+path.sep))throw Error('Retained asset roots must be separate');
  const candidates=[];
  for(const relativeDirectory of ['', 'assets', 'media/variants']) {
    const root=path.join(source,relativeDirectory);if(!existsSync(root))continue;directory(root);
    for(const entry of readdirSync(root,{withFileTypes:true})) {
      if(entry.isSymbolicLink())throw Error('Retained public asset symlink rejected');
      const relative=relativeDirectory?relativeDirectory+'/'+entry.name:entry.name;
      if(!isRetainableAsset(relative))continue;
      if(!entry.isFile())throw Error('Retained asset must be a regular file');
      const from=path.join(source,relative),to=path.join(destination,relative),hash=await checksum(from);
      if(relative.startsWith('media/variants/')&&hash!==`sha256:${entry.name.slice(0,64)}`)throw Error('Media variant filename hash mismatch');
      candidates.push({relative,from,to,hash});
    }
  }
  // Preflight the entire batch before copying. Existing retained files are
  // never overwritten or pruned, including legacy ineligible files.
  directory(destination,{create:true});
  for(const row of candidates) {
    directory(path.dirname(row.to),{create:true});
    if(existsSync(row.to)) {
      if(lstatSync(row.to).isSymbolicLink()||!lstatSync(row.to).isFile())throw Error('Retained target must be a regular file');
      if(await checksum(row.to)!==row.hash)throw Error('Retained immutable asset name collision');
    }
  }
  let copied=0,reused=0;
  for(const row of candidates) {
    if(existsSync(row.to)){if(lstatSync(row.to).isSymbolicLink()||await checksum(row.to)!==row.hash)throw Error('Retained immutable asset changed after preflight');reused++;continue;}
    copyFileSync(row.from,row.to,constants.COPYFILE_EXCL);copied++;
    if(await checksum(row.to)!==row.hash)throw Error('Retained asset changed during copy');
  }
  return {copied,reused,paths:candidates.map(row=>row.relative)};
}
