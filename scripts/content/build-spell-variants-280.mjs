import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=JSON.parse(fs.readFileSync(path.join(root,'outputs/catalog-completion-20260929/spells.json'),'utf8'))
  .filter(row=>row.deleted_at===null);
const clone=value=>JSON.parse(JSON.stringify(value));
const fixedSpellChoices=new Set([
  'protection_from_energy','SPELL-0182','fire_shield','SPELL-0309','SPELL-0296','SPELL-0272',
  'SPELL-0197','thaumaturgy','SPELL-0315','SPELL-0288','SPELL-0287','SPELL-0298',
  'SPELL-0295','SPELL-0310','SPELL-0221','SPELL-0314','SPELL-0224','SPELL-0230',
]);
const upcastExtraTargets=new Set(['SPELL-0182','SPELL-0309','SPELL-0272']);
const optionsIn=value=>{
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
function fixedVariant(value,choiceId,option,parentKey=''){
  if(Array.isArray(value))return value.flatMap(entry=>{
    if(entry?.kind==='choice'&&entry.id===choiceId){
      const grants=clone(option.grants??[]);
      return parentKey==='effects'?[{resolution:'auto',result:grants}]:grants;
    }
    return [fixedVariant(entry,choiceId,option)];
  });
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,fixedVariant(child,choiceId,option,key)]));
}
const uuidFor=(parent,choice,option)=>{
  const digest=createHash('sha256').update(`spell-variant-280:${parent}:${choice}:${option}`).digest('hex');
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
};
const refFor=(parent,optionId)=>{
  const base=parent.card_number.replace(/[^A-Za-z0-9]/g,'-');
  const option=String(optionId).replace(/[^A-Za-z0-9]/g,'-');
  const readable=`SPELL-VAR-${base}-${option}`;
  if(readable.length<=50)return readable;
  return `SPELL-VAR-${createHash('sha256').update(`${parent.id}:${optionId}`).digest('hex').slice(0,24)}`;
};
const manifest=[];
for(const parent of source.filter(row=>fixedSpellChoices.has(row.card_number))){
  const choices=optionsIn(parent.mechanics);
  if(choices.length!==1)throw Error(`${parent.card_number}: expected one fixed choice, got ${choices.length}`);
  const choice=choices[0],children=[];
  for(const option of choice.options.items){
    if(typeof option.id!=='string'||!option.id||!Array.isArray(option.grants)||!option.grants.length)
      throw Error(`${parent.card_number}: invalid option`);
    const id=uuidFor(parent.id,choice.id,option.id),card_number=refFor(parent,option.id);
    const mechanics=fixedVariant(clone(parent.mechanics),choice.id,option);
    if(upcastExtraTargets.has(parent.card_number)){
      mechanics.targeting={...mechanics.targeting,additional_target_slots_per_spell_slot_above_base:1};
    }
    mechanics.variant_of_spell_id=parent.id;
    const patch={...clone(parent),id,card_number,name:`${parent.name} — ${option.name}`,
      description:`${parent.description}\n\nВариант: ${option.name}.`,mechanics,
      author:'System',source:'Catalog spell variants 2026-09-29',deleted_at:null};
    delete patch.created_at;delete patch.updated_at;
    patch.support={audit_id:'spell-variants-20260929',status:'not_verified',review:{status:'not_verified',
      summary:`Фиксированный вариант «${option.name}» заклинания «${parent.name}».`,tested:[],implemented:[],limitations:[],
      evidence:['frontend/src/character/spellVariantsData.test.ts']}};
    manifest.push({entity_type:'spell',id,card_number,name:patch.name,preimage:null,patch,
      review:{status:'not_verified',summary:`Исполнимый вариант «${option.name}» родительского заклинания «${parent.name}».`,
        implemented:[],tested:[],limitations:[],evidence:['frontend/src/character/spellVariantsData.test.ts']}});
    children.push(id);
  }
  const mechanics={...clone(parent.mechanics),spell_variant_ids:children};
  if(upcastExtraTargets.has(parent.card_number))mechanics.targeting={...mechanics.targeting,additional_target_slots_per_spell_slot_above_base:1};
  manifest.push({entity_type:'spell',id:parent.id,card_number:parent.card_number,name:parent.name,
    preimage:{mechanics:parent.mechanics},patch:{mechanics},
    review:{status:'not_verified',summary:`Родительское заклинание выбирает один из ${children.length} вариантов до каста.`,
      implemented:[],tested:[],limitations:[],evidence:['frontend/src/character/spellVariantsData.test.ts']}});
}
const textualChoices={
  greater_restoration:{
    limitation:'Проклятие, снижение характеристик и максимума Хитов требуют выбора конкретного активного эффекта; автоматическое снятие этих ветвей пока не реализовано.',
    options:[
      {id:'exhaustion',name:'Снять один уровень Истощения',result:[{kind:'condition',op:'remove',value:'exhaustion',max_removals:1}]},
      {id:'charmed',name:'Снять Очарование',result:[{kind:'condition',op:'remove',value:'charmed'}]},
      {id:'petrified',name:'Снять Окаменение',result:[{kind:'condition',op:'remove',value:'petrified'}]},
      {id:'curse',name:'Снять проклятие',result:[{kind:'narrative',description:'Снимите одно выбранное проклятие, включая настройку на проклятый предмет.'}]},
      {id:'ability_reduction',name:'Восстановить характеристику',result:[{kind:'narrative',description:'Снимите одно выбранное уменьшение характеристики цели.'}]},
      {id:'max_hp_reduction',name:'Восстановить максимум Хитов',result:[{kind:'narrative',description:'Снимите один выбранный эффект, уменьшающий максимум Хитов цели.'}]},
    ],
    apply:(mech,option)=>{mech.effects=[{resolution:'auto',who:'target',result:clone(option.result)}];},
  },
  contagion:{
    limitation:'Повторные спасброски до трёх успехов/провалов и семидневная болезнь остаются нарративными; выбранная характеристика получает исполнимую Помеху только пока цель Отравлена.',
    options:[['str','Сила'],['dex','Ловкость'],['con','Телосложение'],['int','Интеллект'],['wis','Мудрость'],['cha','Харизма']]
      .map(([id,name])=>({id,name})),
    apply:(mech,option)=>{
      const onFail=mech.effects[0].on_fail;
      onFail.push({kind:'modifier',op:'disadvantage',duration:{type:'hours',amount:168},
        applies_to:{roll:'saving_throw',filter:{ability:option.id}},when:[{kind:'you_have_condition',value:'poisoned'}]});
      const narrative=onFail.find(payload=>payload.kind==='narrative');
      if(narrative)narrative.description=`Пока цель Отравлена, Помеха к спасброскам ${option.name}. Повторные спасброски до трёх успехов/провалов и болезнь остаются на решении ведущего.`;
    },
  },
  plant_growth:{
    limitation:'Чрезмерный рост создаёт постоянную зону с ценой движения 4:1; исключение отдельных участков и сельскохозяйственный эффект 8-часового варианта требуют решения ведущего.',
    options:[{id:'overgrowth',name:'Чрезмерный рост'},{id:'enrichment',name:'Урожайность'}],
    apply:(mech,option)=>{
      if(option.id==='overgrowth')mech.effects=[{resolution:'auto',result:[{kind:'world_zone',zone_type:'plant_growth',
        geometry:{shape:'sphere',radius_ft:100},tactical:{movement_cost_multiplier:4}}]}];
      else{
        mech.activation={...mech.activation,cast_time:{unit:'hour',amount:8},
          cost:mech.activation.cost.filter(cost=>cost.resource!=='action')};
        mech.targeting={...mech.targeting,area:{kind:'sphere',radius_ft:2640}};
        mech.effects=[{resolution:'auto',result:[{kind:'narrative',
          description:'Растения в области радиусом полмили становятся плодороднее на год; урожай удваивается.'}]}];
      }
    },
  },
  elemental_weapon:{
    limitation:'Исполнимые бонус атаки и урон привязаны к одному выбранному удерживаемому оружию; определение немагического оружия и превращение его в магическое для других правил пока требуют подтверждения ведущего.',
    options:[['thunder','Звук'],['acid','Кислота'],['fire','Огонь'],['cold','Холод'],['lightning','Электричество']]
      .map(([id,name])=>({id,name})),
    apply:(mech,option)=>{
      mech.effects=[
        {kind:'choice',id:'elemental_weapon_weapon',context:'in_play',count:1,
          prompt:'Выберите удерживаемое оружие цели',options:{source:'target_equipped_weapon'}},
        {resolution:'auto',who:'target',result:[{kind:'weapon_attack_buff',
          weapon_choice_id:'elemental_weapon_weapon',damage_type:option.id,
          scaling:[{min_spell_level:3,attack_bonus:1,damage_dice:'1d4'},
            {min_spell_level:5,attack_bonus:2,damage_dice:'2d4'},
            {min_spell_level:7,attack_bonus:3,damage_dice:'3d4'}],
          duration:{type:'hours',amount:1,concentration:true},
          stack_id:'spell:elemental-weapon',stack_type:'overwrite'}]},
      ];
    },
  },
};
for(const parent of source.filter(row=>textualChoices[row.card_number])){
  const spec=textualChoices[parent.card_number],children=[];
  for(const option of spec.options){
    const id=uuidFor(parent.id,'textual_fixed_variant',option.id),card_number=refFor(parent,option.id);
    const mechanics=clone(parent.mechanics);
    spec.apply(mechanics,option);
    mechanics.variant_of_spell_id=parent.id;
    const patch={...clone(parent),id,card_number,name:`${parent.name} — ${option.name}`,
      description:`${parent.description}\n\nВариант: ${option.name}.`,mechanics,
      author:'System',source:'Catalog spell variants 2026-09-29',deleted_at:null};
    delete patch.created_at;delete patch.updated_at;
    const review={status:'partial_narrative_not_verified',summary:`Вариант «${option.name}» заклинания «${parent.name}».`,
      implemented:[],tested:[],limitations:[spec.limitation],evidence:['frontend/src/character/spellVariantsData.test.ts']};
    patch.support={audit_id:'spell-variants-20260929',status:review.status,review};
    manifest.push({entity_type:'spell',id,card_number,name:patch.name,preimage:null,patch,review});
    children.push(id);
  }
  manifest.push({entity_type:'spell',id:parent.id,card_number:parent.card_number,name:parent.name,
    preimage:{mechanics:parent.mechanics},patch:{mechanics:{...clone(parent.mechanics),spell_variant_ids:children}},
    review:{status:'partial_narrative_not_verified',summary:`Выбор варианта заклинания «${parent.name}» до каста.`,
      implemented:[],tested:[],limitations:[spec.limitation],evidence:['frontend/src/character/spellVariantsData.test.ts']}});
}
const auditedNarrative={
  summon_construct:'У источника нет исполнимого блока статистики форм Глина/Металл/Камень; отдельный вариант без этих параметров был бы фиктивным.',
  summon_elemental:'У источника нет исполнимых блоков стихий Воздух/Земля/Огонь/Вода и их атак; форма остаётся решением ведущего.',
  'SPELL-0178':'Общий owned_summon создаёт духа, но формы среды обитания не имеют отдельных статблоков, скорости и атак.',
  summon_fiend:'У форм Демон/Дьявол/Юголот нет исполнимых статблоков и атак.',
  summon_fey:'Общий owned_summon создаёт духа, но настроения Феи не имеют отдельных действий и статблоков.',
  summon_undead:'Общий owned_summon создаёт духа, но Призрачная/Скелетная/Гнилостная формы не имеют отдельных атак и статблоков.',
  summon_aberration:'У форм Бехолдер/Слаад/Свежеватель разума нет исполнимых статблоков и атак.',
  magic_circle:'Выбор защищаемых типов существ, обратной ориентации и проверка входа/атаки пока не имеют data-owned исполнения.',
  hallow:'Комбинация выбранных типов существ и одного из дополнительных эффектов не имеет data-owned проверки границ, входа и выхода.',
};
for(const parent of source.filter(row=>auditedNarrative[row.card_number])){
  manifest.push({entity_type:'spell',id:parent.id,card_number:parent.card_number,name:parent.name,
    preimage:{mechanics:parent.mechanics},patch:{mechanics:clone(parent.mechanics)},
    review:{status:'partial_narrative_not_verified',summary:`Аудит выбора вариантов заклинания «${parent.name}».`,
      implemented:[],tested:[],limitations:[auditedNarrative[parent.card_number]],
      evidence:['frontend/src/character/spellVariantsData.test.ts']}});
}
const out=path.join(root,'scripts/content/data/spell-variants-280.json');
fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({parents:fixedSpellChoices.size+Object.keys(textualChoices).length,
  children:manifest.length-fixedSpellChoices.size-Object.keys(textualChoices).length-Object.keys(auditedNarrative).length,
  audited: Object.keys(auditedNarrative).length,output:out}));
