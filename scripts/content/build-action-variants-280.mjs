import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=JSON.parse(fs.readFileSync(path.join(root,'outputs/catalog-completion-20260929/actions.json'),'utf8'))
  .filter(row=>row.deleted_at===null);
const clone=value=>JSON.parse(JSON.stringify(value));
const fixedChoices=new Set([
  'ACT-metamagic-transmuted','ACT-bm-bait-switch','ACT-bm-pushing-attack',
  'ACT-wild-shape','action_help','ACT-aasimar-revelation',
]);
const findChoices=value=>{
  const found=[];
  const visit=node=>{
    if(Array.isArray(node)){node.forEach(visit);return;}
    if(!node||typeof node!=='object')return;
    if(node.kind==='choice'&&node.options?.source==='explicit'&&Array.isArray(node.options.items))found.push(node);
    Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
};
function fixChoice(value,choiceId,grants,parentKey=''){
  if(Array.isArray(value))return value.flatMap(entry=>{
    if(entry?.kind==='choice'&&entry.id===choiceId){
      const result=clone(grants);
      return parentKey==='effects'?[{resolution:'auto',result}]:result;
    }
    return [fixChoice(entry,choiceId,grants)];
  });
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,fixChoice(child,choiceId,grants,key)]));
}
const uuidFor=(parent,choice,option)=>{
  const digest=createHash('sha256').update(`action-variant-280:${parent}:${choice}:${option}`).digest('hex');
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
};
const refFor=(parent,optionId)=>{
  const base=parent.card_number.replace(/[^A-Za-z0-9]/g,'-');
  const option=String(optionId).replace(/[^A-Za-z0-9]/g,'-');
  const readable=`ACT-VAR-${base}-${option}`;
  if(readable.length<=50)return readable;
  return `ACT-VAR-${createHash('sha256').update(`${parent.id}:${optionId}`).digest('hex').slice(0,24)}`;
};
const manifest=[];
for(const parent of source.filter(row=>fixedChoices.has(row.card_number))){
  const choices=findChoices(parent.mechanics);
  if(choices.length!==1)throw Error(`${parent.card_number}: expected one explicit choice, got ${choices.length}`);
  const choice=choices[0],children=[];
  for(const option of choice.options.items){
    if(typeof option.id!=='string'||!option.id||!Array.isArray(option.grants)||!option.grants.length)
      throw Error(`${parent.card_number}: invalid option`);
    const id=uuidFor(parent.id,choice.id,option.id),card_number=refFor(parent,option.id);
    const mechanics=fixChoice(clone(parent.mechanics),choice.id,option.grants);
    if(parent.card_number==='ACT-bm-bait-switch'){
      const recipient=mechanics.effects?.find(effect=>effect.who_choice_id===choice.id);
      if(!recipient)throw Error('Bait and Switch recipient effect missing');
      recipient.who=option.id;
      delete recipient.who_choice_id;
    }
    if(parent.card_number==='action_help'&&option.id==='stabilize'){
      mechanics.pre_action_check={ability:'wis',skill:'medicine',dc:10};
      mechanics.effects[0].result=[{kind:'stabilize',who:'target'}];
    }
    mechanics.variant_of_action_id=parent.id;
    const patch={...clone(parent),id,card_number,name:`${parent.name} — ${option.name}`,
      description:`${parent.description}\n\nВариант: ${option.name}.`,mechanics,
      author:'System',source:'Catalog action variants 2026-09-29',deleted_at:null};
    delete patch.created_at;delete patch.updated_at;
    patch.support={audit_id:'action-variants-20260929',status:'not_verified',review:{status:'not_verified',
      summary:`Фиксированный вариант «${option.name}» действия «${parent.name}».`,tested:[],implemented:[],limitations:[],
      evidence:['frontend/src/character/actionVariantsData.test.ts']}};
    manifest.push({entity_type:'action',id,card_number,name:patch.name,preimage:null,patch,
      review:{status:'not_verified',summary:`Исполнимый вариант «${option.name}» родительского действия «${parent.name}».`,
        implemented:[],tested:[],limitations:[],evidence:['frontend/src/character/actionVariantsData.test.ts']}});
    children.push(id);
  }
  manifest.push({entity_type:'action',id:parent.id,card_number:parent.card_number,name:parent.name,
    preimage:{mechanics:parent.mechanics},patch:{mechanics:{...clone(parent.mechanics),action_variant_ids:children}},
    review:{status:'not_verified',summary:`Родительское действие выбирает один из ${children.length} вариантов до исполнения.`,
      implemented:[],tested:[],limitations:[],evidence:['frontend/src/character/actionVariantsData.test.ts']}});
}
const out=path.join(root,'scripts/content/data/action-variants-280.json');
fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({parents:fixedChoices.size,children:manifest.length-fixedChoices.size,output:out}));
