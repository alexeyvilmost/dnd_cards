// Keep generated application files separate from the unchanged public media layer.
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';

export function createCompileLayer({dist,publicDirectory,output}) {
  dist=path.resolve(dist);publicDirectory=path.resolve(publicDirectory);output=path.resolve(output);
  for(const root of [dist,publicDirectory])if(!lstatSync(root).isDirectory()||realpathSync(root)!==root)throw Error('Exact build directories required');
  if(dist===publicDirectory||existsSync(output)||path.dirname(output)!==path.dirname(dist)||output===publicDirectory)throw Error('New sibling compile layer required');
  mkdirSync(output);const omitted=[],copied=[];
  function walk(directory,relative='') {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const name=relative?relative+'/'+entry.name:entry.name,source=path.join(directory,entry.name);
      if(entry.isSymbolicLink())throw Error('Build symlink is not a compile-layer input');
      if(entry.isDirectory()){walk(source,name);continue;}
      if(!entry.isFile())throw Error('Only regular build files are supported');
      const bytes=readFileSync(source),sha256='sha256:'+createHash('sha256').update(bytes).digest('hex'),record={path:name,bytes:bytes.length,sha256};
      const media=path.join(publicDirectory,name);
      if(existsSync(media)) {
        const stat=lstatSync(media);if(!stat.isFile()||realpathSync(media)!==media)throw Error('Exact public file required');
        if(stat.size===bytes.length&&readFileSync(media).equals(bytes)){omitted.push(record);continue;}
      }
      const target=path.join(output,name);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(source,target);copied.push(record);
    }
  }
  walk(dist);
  return{schemaVersion:1,kind:'frontend-compile-layer',omitted,copied,omittedBytes:omitted.reduce((n,r)=>n+r.bytes,0),copiedBytes:copied.reduce((n,r)=>n+r.bytes,0),originalFilesChanged:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [dist,publicDirectory,output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Expected dist, build public and new compile-layer directories');
  console.log(JSON.stringify(createCompileLayer({dist,publicDirectory,output})));
}
