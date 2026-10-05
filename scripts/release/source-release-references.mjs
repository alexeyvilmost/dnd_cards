// Canonical session rules_artifact_hash is a semantic source.release hash.
// Roguelike envelopes and equipment receipts instead pin executable CJS bytes.
import {evidenceHash} from './validate-manifest.mjs';
import path from 'node:path';
export const canonicalReleaseTables=Object.freeze(['ruleset_releases','game_sessions','game_session_actors','game_commands','game_events','session_snapshots','decision_requests']);
export const isCanonicalReleaseColumn=column=>column.column==='rules_artifact_hash'&&canonicalReleaseTables.includes(column.table);
const validHash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
export async function canonicalSourceReleaseReferences(database,columns,referenced){
  if(!referenced.size)return [];
  const present=new Set(columns.filter(row=>row.table==='ruleset_releases').map(row=>row.column));
  for(const field of ['id','rules_artifact_hash','content_hash','manifest_hash','manifest_canonical_bytes','manifest','artifact_version','serializer_version'])if(!present.has(field))throw Error('Semantic source release has no complete canonical identity');
  const query=sql=>database.query(sql,undefined,{sensitive:true});
  const rows=JSON.parse((await query(`SELECT coalesce(json_agg(json_build_object('rulesetReleaseId',id::text,'releaseHash',rules_artifact_hash,'contentHash',content_hash,'manifestHash',manifest_hash,'manifestBytesHash','sha256:'||encode(sha256(manifest_canonical_bytes),'hex'),'manifest',manifest,'artifactVersion',artifact_version,'serializerVersion',serializer_version) ORDER BY id),'[]'::json) FROM public.ruleset_releases;`)).trim());
  if(!Array.isArray(rows)||rows.some(row=>![row.releaseHash,row.contentHash,row.manifestHash,row.manifestBytesHash].every(validHash)||row.manifestHash!==row.manifestBytesHash))throw Error('Canonical source-release manifest bytes do not match retained identity');
  for(const value of referenced)if(!rows.some(row=>row.releaseHash===value))throw Error('Canonical reference has no retained source release');
  for(const table of canonicalReleaseTables.filter(table=>table!=='ruleset_releases'&&columns.some(row=>row.table===table&&row.column==='rules_artifact_hash'))){
    if(!columns.some(row=>row.table===table&&row.column==='ruleset_release_id'))throw Error('Canonical reference lacks release ID binding');
    const count=(await query(`SELECT count(*) FROM public."${table}" c LEFT JOIN public.ruleset_releases r ON r.id=c.ruleset_release_id AND r.rules_artifact_hash=c.rules_artifact_hash WHERE r.id IS NULL;`)).trim();
    if(count!=='0')throw Error('Canonical source-release reference binding differs');
  }
  return rows.filter(row=>referenced.has(row.releaseHash)).sort((a,b)=>a.rulesetReleaseId.localeCompare(b.rulesetReleaseId));
}
export function assertSourceReleaseCoverage(references,provenance){
  if(!Array.isArray(references)||!Array.isArray(provenance))throw Error('Typed source-release coverage required');
  for(const row of references){
    const proof=provenance.find(item=>item.releaseHash===row.releaseHash),binding=proof?.databaseBinding;
    if(proof?.kind!=='historical-source-release'||proof.executable!==false||!binding||proof.contentHash!==row.contentHash||proof.releaseId!==row.artifactVersion
      ||binding.rulesetReleaseId!==row.rulesetReleaseId||binding.manifestHash!==row.manifestHash||binding.manifestCanonicalBytesSha256!==row.manifestBytesHash
      ||binding.serializerVersion!==row.serializerVersion||evidenceHash(binding.manifest)!==evidenceHash(row.manifest))throw Error('Retained canonical source release lacks exact verified certification/database provenance');
  }
  return {status:'verified',sourceReleases:references.length,referenceHash:evidenceHash(references)};
}
export async function verifyBackupSourceReleases(directory,references=[],descriptors=[],files=[]){
  if(!Array.isArray(descriptors)||new Set(descriptors.map(row=>row.releaseHash)).size!==descriptors.length)throw Error('Unique typed certification descriptors required');
  const verified=[];
  for(const descriptor of descriptors){
    if(!validHash(descriptor.releaseHash)||descriptor.path!==`source-releases/${descriptor.releaseHash.slice(7)}`||!validHash(descriptor.descriptorHash))throw Error('Owned certification backup path required');
    const {verifyHistoricalSourceCertification}=await import('./historical-source-certification.mjs');
    const proof=await verifyHistoricalSourceCertification(path.join(directory,descriptor.path));
    if(proof.descriptorHash!==descriptor.descriptorHash||proof.releaseHash!==descriptor.releaseHash)throw Error('Captured source certification changed');
    for(const file of proof.files)if(!files.some(row=>row.path===descriptor.path+'/'+file.path&&row.category==='historical-source-certification'&&row.sha256===file.sha256&&row.bytes===file.bytes))throw Error('Verified certification file omitted from backup checksum closure');
    verified.push(proof);
  }
  return assertSourceReleaseCoverage(references,verified);
}
