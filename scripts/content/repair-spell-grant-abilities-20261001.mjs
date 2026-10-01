import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {sha256Canonical} from './certification-hash.mjs';

const abilities=new Set(['str','dex','con','int','wis','cha']);
const values=value=>value&&typeof value==='object'?Object.values(value).flatMap(values):[value];
const projection=(row,table)=>Object.fromEntries((table==='classes'
 ?['id','card_number','name','description','parent_class_id','level_progression']
 :['id','card_number','name','description','detailed_description','mechanics']).map(key=>[key,row[key]??null]));

/** Migration-time inspection of source ownership. No runtime class/name fallback. */
export function reviewSpellGrantAbilities({sources,effects,classes,directReviews=[]}) {
 const evidence=new Map(),reviews=[];
 const addEvidence=(row,table)=>{
  const fields=projection(row,table);evidence.set(table+':'+row.id,{table,id:row.id,card_number:row.card_number,
   expected_hash:sha256Canonical(fields),fields});
 };
 for(const source of sources){
  const row=effects.find(effect=>effect.id===source.id);
  if(!row||row.card_number!==source.card_number)throw Error('Missing reviewed spell source '+source.card_number);
  const owners=classes.filter(klass=>values(klass.level_progression).includes(row.id)||values(klass.related_effects).includes(row.id));
  if(owners.length!==1)throw Error('Spell source requires unique declared owner '+row.card_number);
  const owner=owners[0],parent=classes.find(klass=>klass.id===owner.parent_class_id)??owner;
  addEvidence(owner,'classes');addEvidence(parent,'classes');
  const refs=new Set([...values(parent.level_progression),...values(owner.level_progression)]);
  const declarations=effects.filter(effect=>refs.has(effect.id)).flatMap(effect=>{
   const found=[];const visit=node=>{if(!node||typeof node!=='object')return;
    if(node.kind==='spellcasting_ability'&&node.role==='primary')found.push({effect,ability:node.ability??node.value});
    Object.values(node).forEach(visit);
   };visit(effect.mechanics);return found;
  });
  const declared=new Set(declarations.map(entry=>entry.ability));
  let ability;
  if(declared.size===1&&abilities.has([...declared][0])){
   ability=[...declared][0];declarations.forEach(entry=>addEvidence(entry.effect,'effects'));
  }else{
   const review=directReviews.find(review=>review.id===row.id);
   if(!review||!abilities.has(review.ability)||review.description_hash!==sha256Canonical({description:row.description,detailed_description:row.detailed_description??null})){
    throw Error('Spell source has no reviewed casting ability '+row.card_number);
   }
   ability=review.ability;
  }
  const mechanics=structuredClone(row.mechanics),changes=[];
  const visit=(node,path=[])=>{if(!node||typeof node!=='object')return;
   if(node.kind==='grant_spell'){
    if(node.ability!==undefined&&!abilities.has(node.ability))throw Error('Invalid existing grant ability '+row.card_number);
    if(node.ability!==undefined&&node.ability!==ability)throw Error('Conflicting existing grant ability '+row.card_number);
    if(node.ability===undefined){node.ability=ability;changes.push(path);}
   }
   Object.entries(node).forEach(([key,child])=>visit(child,[...path,key]));
  };visit(mechanics);
  reviews.push({id:row.id,card_number:row.card_number,name:row.name,ability,owner_id:owner.id,parent_id:parent.id,
   expected_description_hash:sha256Canonical(row.description),expected_details_hash:sha256Canonical(row.detailed_description??null),
   expected_before:sha256Canonical(row.mechanics),expected_after:sha256Canonical(mechanics),mechanics,changes});
 }
 return {reviews,evidence:[...evidence.values()].sort((a,b)=>(a.table+a.id).localeCompare(b.table+b.id))};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const previous=JSON.parse(await readFile('scripts/content/data/spell-grant-refs-20261001.json','utf8'));
 const sources=previous.entities;
 const post295=new Map(previous.entities.map(row=>[row.id,row.mechanics]));
 // Compose the reviewed predecessor postimages with the immutable descriptive
 // snapshot; it may contain annotations from an earlier unshipped 294 plan.
 const effects=JSON.parse(await readFile('outputs/resource-migration-20261001/effects-before296.json','utf8'))
  .map(row=>({...row,mechanics:post295.get(row.id)??row.mechanics}));
 const classes=JSON.parse(await readFile('outputs/resource-migration-20261001/classes-caster296.json','utf8'));
 const directReviews=JSON.parse(await readFile('scripts/content/data/spell-grant-ability-direct-reviews-20261001.json','utf8'));
 const result=reviewSpellGrantAbilities({sources,effects,classes,directReviews});
 if(result.reviews.filter(row=>row.changes.length).length!==25)throw Error('Expected the reviewed pre-296 snapshot; do not regenerate an applied migration from postimages');
 await writeFile('outputs/resource-migration-20261001/spell-grant-ability-audit.json',JSON.stringify(result,null,2));
 const manifest={schema_version:1,migration_version:'296_explicit_spell_grant_abilities',
  entities:result.reviews.filter(row=>row.changes.length).map(({changes,ability,owner_id,parent_id,...row})=>row),evidence:result.evidence,targets:previous.targets};
 const raw=JSON.stringify(manifest,null,2)+'\n';
 await writeFile('scripts/content/data/spell-grant-abilities-20261001.json',raw);
 await writeFile('backend/migrations/spell_grant_abilities_296_manifest.json',raw);
 console.log(JSON.stringify({audited:result.reviews.length,changedSources:manifest.entities.length,changedGrants:result.reviews.reduce((sum,row)=>sum+row.changes.length,0)}));
}
