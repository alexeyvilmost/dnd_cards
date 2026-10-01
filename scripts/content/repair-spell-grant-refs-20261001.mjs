import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sha256Canonical} from './certification-hash.mjs';

/** Exact English-name slug contract of the canonical backend resolver, with
 * typographic apostrophes normalized to the same possessive spelling.
 * This migration-time lookup is never a spell-name branch in the UI/engine. */
export function spellGrantAlias(name) {
  return String(name??'').replace(/['’]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').toLowerCase().replace(/^_+|_+$/g,'');
}
export function repairSpellGrantReferences(entities, reviews=[]) {
  const spells=entities.filter(entity=>entity.table==='spells');
  const exact=new Map(),aliases=new Map();
  for(const spell of spells){
    for(const reference of [spell.id,spell.card_number]){
      if(!reference)continue;
      exact.set(reference,[...(exact.get(reference)??[]),spell]);
    }
    const alias=spellGrantAlias(spell.name_en);
    if(alias&&!spell.mechanics?.variant_of_spell_id)aliases.set(alias,[...(aliases.get(alias)??[]),spell]);
  }
  const unresolved=[],repairs=[],audited=[];
  const reviewedSources=new Map(reviews.map(review=>[review.id,review]));
  for(const entity of entities){
    const mechanics=structuredClone(entity.mechanics),changes=[];
    const visit=(node,path=[])=>{
      if(Array.isArray(node)){node.forEach((child,index)=>visit(child,[...path,index]));return;}
      if(!node||typeof node!=='object')return;
      if(node.kind==='grant_spell'&&typeof node.value==='string'&&node.value.trim()){
        const reference=node.value,matches=exact.get(reference)??aliases.get(reference.trim().toLowerCase())??[];
        const unique=[...new Map(matches.map(spell=>[spell.id,spell])).values()];
        audited.push({table:entity.table,id:entity.id,card_number:entity.card_number,path,reference});
        if(unique.length!==1){unresolved.push({table:entity.table,id:entity.id,card_number:entity.card_number,path,reference,matches:unique.map(spell=>spell.id)});}
        else if(!exact.has(reference)){
          const target=unique[0];
          if(target.mechanics?.variant_of_spell_id)throw Error('A grant alias points to a spell variant: '+reference);
          // Card numbers preserve the canonical auto-grant hydration path;
          // the manifest additionally guards the exact UUID behind this ref.
          // Generic free-use alias binding belongs to the runtime; reference
          // repair must not turn it into an authored resource declaration.
          node.value=target.card_number;
          changes.push({path,previous_ref:reference,spell_id:target.id,spell_card_number:target.card_number,
            spell_name_en:target.name_en});
        }
        const review=reviewedSources.get(entity.id);
        if(review&&!node.label){
          if(review.table!==entity.table||review.card_number!==entity.card_number||review.description_hash!==sha256Canonical(entity.description)){
            throw Error('Reviewed spell grant source changed: '+entity.id);
          }
          if(!['always_prepared','prepared','known','cantrip'].includes(review.access_label))throw Error('Invalid reviewed source access label');
          node.label=review.access_label;
          changes.push({path,access_label:review.access_label,source_description_hash:review.description_hash});
        }
      }
      Object.entries(node).forEach(([key,child])=>visit(child,[...path,key]));
    };
    visit(mechanics);
    if(changes.length)repairs.push({table:entity.table,id:entity.id,card_number:entity.card_number,name:entity.name,
      expected_description_hash:sha256Canonical(entity.description),
      expected_before:sha256Canonical(entity.mechanics),expected_after:sha256Canonical(mechanics),mechanics,changes});
  }
  return {repairs,unresolved,audited};
}

export function spellGrantRepairManifest(entities,result) {
  if(result.unresolved.length)throw Error('Unresolved grant references remain');
  const spells=entities.filter(entity=>entity.table==='spells'),targets=new Map();
  for(const repair of result.repairs){
    if(repair.table!=='effects')throw Error('This reviewed repair contains an unexpected source table');
    const visit=value=>{
      if(Array.isArray(value)){value.forEach(visit);return;}
      if(!value||typeof value!=='object')return;
      if(value.kind==='grant_spell'&&typeof value.value==='string'){
        const matches=spells.filter(spell=>spell.id===value.value||spell.card_number===value.value);
        if(matches.length!==1||matches[0].mechanics?.variant_of_spell_id)throw Error('Invalid postimage grant target '+value.value);
        const target=matches[0];targets.set(target.id,{id:target.id,card_number:target.card_number,name_en:target.name_en});
      }
      Object.values(value).forEach(visit);
    };visit(repair.mechanics);
  }
  return {schema_version:1,migration_version:'295_stable_spell_grant_references',entities:result.repairs.map(({table,changes,...repair})=>repair),
    targets:[...targets.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const source=process.argv[2]??'outputs/resource-migration-20261001/entities.json';
  const entities=JSON.parse(await readFile(source,'utf8'));
  const reviews=JSON.parse(await readFile('scripts/content/data/spell-grant-ref-reviews-20261001.json','utf8'));
  const result=repairSpellGrantReferences(entities,reviews);
  await writeFile('outputs/resource-migration-20261001/spell-grant-refs-audit.json',JSON.stringify(result,null,2));
  if(process.argv.includes('--manifest')){
    const manifest=spellGrantRepairManifest(entities,result);
    const raw=JSON.stringify(manifest,null,2)+'\n';
    await writeFile('scripts/content/data/spell-grant-refs-20261001.json',raw);
    await writeFile('backend/migrations/spell_grant_refs_295_manifest.json',raw);
  }
  console.log(JSON.stringify({auditedGrants:result.audited.length,repairEntities:result.repairs.length,
    changedRefs:result.repairs.reduce((sum,entity)=>sum+entity.changes.filter(change=>change.spell_id).length,0),
    accessLabels:result.repairs.reduce((sum,entity)=>sum+entity.changes.filter(change=>change.access_label).length,0),unresolved:result.unresolved}));
}
