const own=(v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const unsafe=k=>['__proto__','constructor','prototype'].includes(k);
export function equal(a,b) {
 if(a===b)return true;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&Array.from({length:a.length},(_,i)=>i).every(i=>own(a,i)&&own(b,i)&&equal(a[i],b[i]));
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>own(b,k)&&equal(a[k],b[k]));
}

// Transport-only compaction. Equality is proven against a complete exact base;
// this module does not assume that presentation/catalog fields are immutable.
export function compactState(next,before,baseHash) {
 const metadata={baseHash,references:[],arrayPrefixes:[]};
 function visit(next,before,parent) {
  const result={};
  for(const [key,value] of Object.entries(next)) {
   const path=[...parent,key],old=before[key];
   if(!own(before,key)||path.length>8||unsafe(key)){Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});continue;}
   const map=object(value),array=Array.isArray(value);
   if(metadata.references.length<1024&&((map&&Object.keys(value).length>=4)||(array&&value.length>=4)||(typeof value==='string'&&value.length>=256))&&equal(value,old)){metadata.references.push(path);continue;}
   if(array&&Array.isArray(old)&&old.length>=8&&metadata.arrayPrefixes.length<128) {
    let found=false;
    for(let offset=0;offset<=64&&offset<=old.length-8;offset++) {
     const length=Math.min(old.length-offset,value.length);
     if(length>=8&&value.slice(0,length).every((v,i)=>equal(v,old[offset+i]))) {
      metadata.arrayPrefixes.push({path,length,offset});result[key]=value.slice(length);found=true;break;
     }
    }
    if(found)continue;
   }
   result[key]=map&&object(old)?visit(value,old,path):value;
  }
  return result;
 }
 return {state:visit(next,before,[]),metadata};
}

export function expandState(state,before,metadata,expectedHash) {
 if(typeof expectedHash!=='string'||!/^sha256:[a-f0-9]{64}$/.test(expectedHash)||!object(state)||!object(before)||!object(metadata)||metadata.baseHash!==expectedHash||Object.keys(metadata).some(k=>!['baseHash','references','arrayPrefixes'].includes(k))||!Array.isArray(metadata.references)||metadata.references.length>1024||!Array.isArray(metadata.arrayPrefixes)||metadata.arrayPrefixes.length>128)throw Error('Invalid exact state base');
 const target=structuredClone(state),seen=[];
 function parent(root,path) {
  if(!Array.isArray(path)||!path.length||path.length>8||path.some(k=>typeof k!=='string'||unsafe(k)))throw Error('Invalid state path');
  for(const key of path.slice(0,-1)){if(!own(root,key)||!object(root[key]))throw Error('Missing state parent');root=root[key];}
  return {root,key:path.at(-1)};
 }
 function claim(path) {
  if(seen.some(old=>old.slice(0,Math.min(old.length,path.length)).every((key,i)=>key===path[i])))throw Error('Overlapping state references');seen.push(path);
 }
 for(const path of metadata.references) {
  const from=parent(before,path),to=parent(target,path);claim(path);
  if(!own(from.root,from.key)||own(to.root,to.key))throw Error('Invalid state reference');
  to.root[to.key]=structuredClone(from.root[from.key]);
 }
 for(const row of metadata.arrayPrefixes) {
  if(!object(row)||Object.keys(row).some(k=>!['path','length','offset'].includes(k)))throw Error('Invalid prefix metadata');
  const from=parent(before,row.path),to=parent(target,row.path);claim(row.path);
  const old=from.root[from.key],tail=to.root[to.key],offset=row.offset??0;
  if(!Array.isArray(old)||!Array.isArray(tail)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(row.length)||row.length<0||offset+row.length>old.length||row.length+tail.length>100000)throw Error('Invalid state prefix');
  to.root[to.key]=[...structuredClone(old.slice(offset,offset+row.length)),...tail];
 }
 return target;
}
