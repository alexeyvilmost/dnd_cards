import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sha256Canonical} from './certification-hash.mjs';
import {repairSpellGrantReferences,spellGrantRepairManifest} from './repair-spell-grant-refs-20261001.mjs';
import {reviewSpellGrantAbilities} from './repair-spell-grant-abilities-20261001.mjs';

/** Undo only the reviewed, unshipped resource annotations. The original form
 * (boolean, number, formula or object) remains the generic free-use contract. */
export function restoreGenericSpellFreeuses(mechanics,original) {
 const result=structuredClone(mechanics),changes=[];
 const visit=(node,before,path=[])=>{
  if(Array.isArray(node)){node.forEach((child,index)=>visit(child,before?.[index],[...path,index]));return;}
  if(!node||typeof node!=='object')return;
  if(node.kind==='grant_spell'&&node.freeuse&&typeof node.freeuse==='object'
    &&('resource_id' in node.freeuse||'resource_id_prefix' in node.freeuse)){
   if(before?.kind!=='grant_spell'||!before.freeuse)throw Error('Missing reviewed free-use preimage: '+path.join('.'));
   if(typeof before.freeuse==='object'&&('resource_id' in before.freeuse||'resource_id_prefix' in before.freeuse)){
    throw Error('An authored resource binding must not be removed: '+path.join('.'));
   }
   const generic={...node.freeuse};delete generic.resource_id;delete generic.resource_id_prefix;
   const expected=typeof before.freeuse==='object'?before.freeuse:{count:before.freeuse===true?1:before.freeuse,recharge:'long_rest'};
   if(sha256Canonical(generic)!==sha256Canonical(expected))throw Error('Free-use gameplay values changed: '+path.join('.'));
   node.freeuse=structuredClone(before.freeuse);changes.push(path);
  }
  Object.entries(node).forEach(([key,child])=>visit(child,before?.[key],[...path,key]));
 };visit(result,original);return {mechanics:result,changes};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const load=async path=>JSON.parse(await readFile(path,'utf8'));
 const original=await load('outputs/resource-migration-20261001/entities.json');
 const byID=new Map(original.map(row=>[row.id,row]));
 const planned=await load('outputs/resource-migration-20261001/planned-entities.json');
 const generic294=planned.map(row=>({...row,mechanics:restoreGenericSpellFreeuses(row.mechanics,byID.get(row.id)?.mechanics).mechanics}));
 const reviews=await load('scripts/content/data/spell-grant-ref-reviews-20261001.json');
 const refs=repairSpellGrantReferences(generic294,reviews),manifest295=spellGrantRepairManifest(generic294,refs);
 if(manifest295.entities.length!==26)throw Error('Reviewed 295 source set changed');
 const repaired=new Map(manifest295.entities.map(row=>[row.id,row.mechanics]));
 const effects=(await load('outputs/resource-migration-20261001/effects-before296.json')).map(row=>({...row,
  mechanics:repaired.get(row.id)??restoreGenericSpellFreeuses(row.mechanics,byID.get(row.id)?.mechanics).mechanics}));
 const classes=await load('outputs/resource-migration-20261001/classes-caster296.json');
 const directReviews=await load('scripts/content/data/spell-grant-ability-direct-reviews-20261001.json');
 const abilities=reviewSpellGrantAbilities({sources:manifest295.entities,effects,classes,directReviews});
 const manifest296={schema_version:1,migration_version:'296_explicit_spell_grant_abilities',
  entities:abilities.reviews.filter(row=>row.changes.length).map(({changes,ability,owner_id,parent_id,...row})=>row),
  evidence:abilities.evidence,targets:manifest295.targets};
 if(manifest296.entities.length!==25)throw Error('Reviewed 296 source set changed');
 await mkdir('outputs/generic-freeuse-20261001',{recursive:true});
 await writeFile('outputs/generic-freeuse-20261001/planned-entities294.json',JSON.stringify(generic294));
 await writeFile('outputs/generic-freeuse-20261001/manifest-rebase-summary.json',JSON.stringify({sources295:26,sources296:25,
  grants:refs.audited.length,changedRefs:refs.repairs.reduce((sum,row)=>sum+row.changes.filter(change=>change.spell_id).length,0)},null,2));
 for(const [name,manifest] of [['refs',manifest295],['abilities',manifest296]]){
  const raw=JSON.stringify(manifest,null,2)+'\n',version=name==='refs'?'295':'296';
  await writeFile(`scripts/content/data/spell-grant-${name}-20261001.json`,raw);
  await writeFile(`backend/migrations/spell_grant_${name}_${version}_manifest.json`,raw);
 }
 console.log('Unshipped 295/296 manifests rebased; original snapshots and applied receipts untouched');
}
