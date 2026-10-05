import {createHash} from 'node:crypto';
// Inline bytes live in the database dump. Its inventory carries their exact
// fingerprint, avoiding a second unbounded copy in query output/manifests.
export function normalizeMediaReference(value){
  if(typeof value==='string'){
    if(!value.startsWith('data:')&&Buffer.byteLength(value,'utf8')<=8192)return value;
    return {kind:value.startsWith('data:')?'inline-reference':'long-reference',sha256:'sha256:'+createHash('sha256').update(value,'utf8').digest('hex'),bytes:Buffer.byteLength(value,'utf8')};
  }
  if(!value||Object.keys(value).sort().join(',')!=='bytes,kind,sha256'||!['inline-reference','long-reference'].includes(value.kind)||!/^sha256:[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<1)throw Error('Invalid media reference fingerprint');
  return {kind:value.kind,sha256:value.sha256,bytes:value.bytes};
}
export function normalizeMediaReferences(values){
  return [...new Set(values.map(value=>JSON.stringify(normalizeMediaReference(value))))].sort().map(value=>JSON.parse(value));
}
export const mediaReferenceSQL=value=>`CASE WHEN ${value} LIKE 'data:%' OR octet_length(${value})>8192 THEN jsonb_build_object('kind',CASE WHEN ${value} LIKE 'data:%' THEN 'inline-reference' ELSE 'long-reference' END,'sha256','sha256:'||encode(sha256(convert_to(${value},'UTF8')),'hex'),'bytes',octet_length(${value})) ELSE to_jsonb(${value}) END`;
