// Explicit owned-local export/verify/restore; no external storage or entity update.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ownedRetentionDatabase} from './retention-plan.mjs';
import {assertRealOwnedPath} from '../testing/guards.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=value=>`convert_from(decode('${Buffer.from(value).toString('hex')}','hex'),'UTF8')`;
const allowed={cards:['image_url','image_url_spent'],characters_v3:['avatar_url'],paper_documents:['document']};
function referenceInput(reference,owner) {
  if(!allowed[reference?.table]?.includes(reference.column)||typeof reference.id!=='string'||!/^(?:[1-9]\d{0,17}|[a-f0-9-]{36})$/.test(reference.id)
    ||!Array.isArray(reference.jsonPath)||reference.jsonPath.length>12||reference.jsonPath.some(s=>typeof s!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s))
    ||reference.column!=='document'&&reference.jsonPath.length||!['user_id','owner_id'].includes(owner?.column)||typeof owner.value!=='string'||!owner.value||owner.value.length>100)throw Error('Explicit owned image reference/access descriptor required');
}
export function decodeInlineImage(value) {
  if(typeof value!=='string'||value.length>2*1024*1024)throw Error('Bounded data URL required');
  const match=value.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw Error('Unsupported inline image format');const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.toString('base64')!==match[2])throw Error('Noncanonical inline base64');
  return {mime:match[1],bytes,sha256:sha(bytes),referenceHash:sha(value)};
}
async function readSource(database,reference,owner) {
  referenceInput(reference,owner);
  const column=`"${reference.column}"`,value=reference.column==='document'?`${column} #>> ARRAY[${reference.jsonPath.map(literal).join(',')}]::text[]`:column;
  const response=JSON.parse(await database.query(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='250ms';
    SELECT json_build_object('rows',count(*),'value',max(value)) FROM (
      SELECT ${value} AS value FROM public."${reference.table}" WHERE id::text=${literal(reference.id)} AND "${owner.column}"::text=${literal(owner.value)} LIMIT 2
    ) selected WHERE octet_length(value)<=2097152;ROLLBACK;`));
  if(response.rows!==1)throw Error('Owned image reference is missing, inaccessible or oversized');return response.value;
}
async function writeExact(file,bytes,root) {
  try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;await assertRealOwnedPath(root,file);if(!(await readFile(file)).equals(Buffer.from(bytes)))throw Error('Existing owned export differs');}
}
export async function exportInlineImage({dsn,registry,reference,owner}) {
  const database=await ownedRetentionDatabase({dsn,registry}),value=await readSource(database,reference,owner),image=decodeInlineImage(value);
  const parent=path.join(registry.directory,'inline-exports');await mkdir(parent,{recursive:true,mode:0o700});await assertRealOwnedPath(registry.directory,parent);
  const directory=path.join(parent,sha(JSON.stringify({reference,owner,referenceHash:image.referenceHash})));
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await assertRealOwnedPath(parent,directory);
  const body={schemaVersion:1,kind:'owned-inline-export',runId:registry.runId,reference,owner,mime:image.mime,bytes:image.bytes.length,sha256:image.sha256,referenceHash:image.referenceHash,blob:`${image.sha256}.bin`};
  const manifest={...body,manifestHash:sha(JSON.stringify(body))};
  await writeExact(path.join(directory,body.blob),image.bytes,directory);
  const manifestPath=path.join(directory,'manifest.json');await writeExact(manifestPath,JSON.stringify(manifest,null,2)+'\n',directory);
  await verifyInlineExport({dsn,registry,manifestPath});return {status:'exported',manifestPath,bytes:body.bytes,sha256:body.sha256,sourceUnchanged:true};
}
export async function verifyInlineExport({dsn,registry,manifestPath}) {
  const database=await ownedRetentionDatabase({dsn,registry});await assertRealOwnedPath(registry.directory,manifestPath);
  const {manifestHash,...body}=JSON.parse(await readFile(manifestPath,'utf8'));
  if(body.schemaVersion!==1||body.kind!=='owned-inline-export'||body.runId!==registry.runId||manifestHash!==sha(JSON.stringify(body))||!/^[a-f0-9]{64}$/.test(body.sha256)||body.blob!==`${body.sha256}.bin`)throw Error('Owned inline export identity changed');
  const file=path.join(path.dirname(manifestPath),body.blob);await assertRealOwnedPath(path.dirname(manifestPath),file);const bytes=await readFile(file);
  if(bytes.length!==body.bytes||sha(bytes)!==body.sha256)throw Error('Inline export blob corrupted');
  const value=await readSource(database,body.reference,body.owner);
  if(sha(value)!==body.referenceHash)throw Error('Inline source preimage changed');
  const restored=`data:${body.mime};base64,${bytes.toString('base64')}`;
  if(restored!==value)throw Error('Inline export cannot restore exact reference bytes');
  return {body,restored};
}
export async function restoreInlineExport({dsn,registry,manifestPath}) {
  const {body,restored}=await verifyInlineExport({dsn,registry,manifestPath});
  const output=path.join(path.dirname(manifestPath),'restored-reference.txt');await writeExact(output,restored,path.dirname(manifestPath));
  return {status:'restored-local-copy',output,bytes:body.bytes,sha256:body.sha256,referenceHash:body.referenceHash,sourceUnchanged:true};
}
