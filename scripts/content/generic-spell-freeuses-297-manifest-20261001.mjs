import {readFile,writeFile} from 'node:fs/promises';
import {sha256Canonical} from './certification-hash.mjs';
import {restoreGenericSpellFreeuses} from './generic-spell-freeuses-20261001.mjs';
const load=async name=>JSON.parse(await readFile('outputs/resource-migration-20261001/'+name,'utf8'));
const originals=await load('entities.json'),before=await load('entities-before-generic297.json');
const originalsByID=new Map(originals.map(row=>[row.id,row]));
const entities=[];
for(const row of before){
 const restored=restoreGenericSpellFreeuses(row.mechanics,originalsByID.get(row.id)?.mechanics);
 if(restored.changes.length)entities.push({table:row.table,id:row.id,card_number:row.card_number,name:row.name,
  expected_before:sha256Canonical(row.mechanics),expected_after:sha256Canonical(restored.mechanics),mechanics:restored.mechanics});
}
entities.sort((a,b)=>(a.table+a.id).localeCompare(b.table+b.id));
const originalResources=new Set((await load('resources-before-full.json')).map(row=>row.resource_id));
const plannedResources=new Set([...(await load('planned-resources-before-image-fix.json')),
 ...(await load('post295-plan/planned-resources.json'))].map(row=>row.resource_id));
const actualResources=await load('resources-before-generic297.json');
const resources=actualResources.filter(row=>!originalResources.has(row.resource_id)&&plannedResources.has(row.resource_id)
 &&row.resource_id.startsWith('freeuse-')&&row.resource_id!=='freeuse-spells'&&!row.deleted_at).map(row=>({resource_id:row.resource_id,
 expected_hash:sha256Canonical(Object.fromEntries(Object.entries(row).filter(([key])=>!['updated_at','deleted_at'].includes(key))))}));
resources.sort((a,b)=>a.resource_id.localeCompare(b.resource_id));
if(entities.length!==42||resources.length!==1156)throw Error(`Reviewed cleanup set changed: ${entities.length} sources, ${resources.length} resources`);
const manifest={schema_version:1,migration_version:'297_retain_generic_spell_free_uses',entities,resources};
await writeFile('backend/migrations/generic_spell_freeuses_297_manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('outputs/generic-freeuse-20261001/cleanup297-manifest-summary.json',JSON.stringify({sourceEntities:entities.length,generatedResources:resources.length,
 preservedOriginalResources:originalResources.size},null,2));
console.log(JSON.stringify({sourceEntities:entities.length,generatedResources:resources.length,preservedOriginalResources:originalResources.size}));
