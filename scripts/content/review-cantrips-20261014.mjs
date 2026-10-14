#!/usr/bin/env node
// Offline editorial builder. Its input is a retained, read-only production API
// export; this script has no HTTP client, DSN, or production write path.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {reviews, damageLabels, elementalVariants, thaumaturgyVariants, spellcastingModifier} from './data/cantrip-editorial-review-20261014.mjs';

const fields = ['description','detailed_description','upcast_description'];
const stable = value => Array.isArray(value) ? value.map(stable) : value&&typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const sha = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const pick = row => Object.fromEntries(fields.map(field => [field,row[field]??null]));
const damage = type => `[${type}]:${type}:${damageLabels[type]}[/${type}]`;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const conditionAliases = {unconscious:'unconscious',frightened:'frightened',exhaustion:'exhaustion',invisible:'invisible',incapacitated:'incapacitated',deafened:'deafened',petrified:'petrified',prone:'prone',restrained:'restrained',blinded_condition:'blinded',poisoned:'poisoned',charmed:'charmed',stunned:'stunned',paralyzed:'paralyzed',grappled:'grappled'};

export function editorialFormatter(concepts, effects) {
  const ids = new Set(concepts.map(c => c.concept_id));
  const conditions = new Map(effects.filter(e=>e.effect_type==='condition').map(e=>[e.card_number,e]));
  const lexicon = [
    ['МЗ','concept','spellcasting_modifier'],
    ['модификатору заклинательной характеристики','concept','spellcasting_modifier'],
    ['заклинательную характеристику','concept','ability_score_and_modifier'],
    ['проверке характеристики','concept','ability_check'],['проверки характеристики','concept','ability_check'],
    ['бросков атаки','concept','attack_roll'],['бросок атаки','concept','attack_roll'],
    ['бросков урона','concept','damage'],['бросок урона','concept','damage'],
    ['атаку заклинанием','concept','spell_attack'],['атака заклинанием','concept','spell_attack'],
    ['спасброске','concept','saving_throw_'],['спасброску','concept','saving_throw_'],['спасбросок','concept','saving_throw_'],
    ['Яркий свет','concept','bright_light'],['Тусклый свет','concept','dim_light'],
    ['Провоцированные атаки','concept','opportunity_attacks'],
    ['Стабилизированным','concept','stable'],['Скорость','concept','speed'],
    ['Хитов','concept','hit_points'],['Хиты','concept','hit_points'],
    ['Преимуществом','concept','advantage'],['Преимущество','concept','advantage'],
    ['Помехой','concept','disadvantage'],['СЛ','concept','difficulty_class'],
    ['Сфере','concept','sphere'],['Сферой','concept','sphere'],['Сфера','concept','sphere'],
    ['Кубе','concept','cube'],['Куба','concept','cube'],['Куб','concept','cube'],
    ['Эманации','concept','emanation'],['Эманацией','concept','emanation'],
    ['Магия','concept','magic'],['Изучение','concept','study'],
    ['Бонусным действием','concept','bonus_action'],['действием','concept','action'],
    ['укрытия','concept','cover'],['навык','concept','skill'],
    ['концентрации','concept','concentration'],
    ['Очаровано','effect',conditions.get('COND-charmed')?.id],
  ].filter(([,type,id])=>id&&(type==='effect'||id==='spellcasting_modifier'||ids.has(id)));
  // Descending length plus one alternation prevents a second pass from editing
  // generated markup. Existing canonical links/colors stay intact.
  lexicon.sort((a,b)=>b[0].length-a[0].length);
  const matches = new Map(lexicon.map(([label,type,id])=>[label.toLocaleLowerCase('ru'),{type,id}]));
  const terms = new RegExp(`(?<![\\p{L}])(${lexicon.map(([label])=>escape(label)).join('|')})(?![\\p{L}])`,'giu');
  const colorTerms = new RegExp(`(?<![\\p{L}])(${Object.values(damageLabels).sort((a,b)=>b.length-a.length).map(escape).join('|')})(?![\\p{L}])`,'giu');
  const damageTypes = new Map(Object.entries(damageLabels).map(([type,label])=>[label.toLocaleLowerCase('ru'),type]));
  return text => {
    if (text==null) return null;
    const seen = new Set();
    // Remap the retained concept reference using stable condition identity.
    const remapped=text.replace(/\[\[([^|]+)\|concept:([^\]]+)\]\]/g,(all,label,id)=>{
      const condition = conditions.get(`COND-${conditionAliases[id]}`);
      return condition ? `[[${label}|effect:${condition.id}]]` : all;
    }).replace(/модификатору заклинательной характеристики/giu,'МЗ');
    const parts = remapped.split(/(\[\[[^\]]+\]\]|\[(?:acid|bludgeoning|cold|fire|lightning|necrotic|piercing|poison|radiant|slashing|thunder|force|psychic)\][\s\S]*?\[\/(?:acid|bludgeoning|cold|fire|lightning|necrotic|piercing|poison|radiant|slashing|thunder|force|psychic)\]|:[a-z_]+:)/g);
    return parts.map(part=>{
      if(part.startsWith('[[')) {
        const match=/^\[\[([^|]+)\|([^\]]+)\]\]$/.exec(part);
        if (!match) return part;
        if(seen.has(match[2]))return match[1];
        seen.add(match[2]);return part;
      }
      if(part.startsWith('[')||/^:[a-z_]+:$/.test(part)) {
        // Color every typed damage mention and always include its icon.
        const type=/^\[([a-z]+)\]/.exec(part)?.[1];
        return type && !part.includes(`:${type}:`) ? part.replace(`[${type}]`,`[${type}]:${type}:`) : part;
      }
      return part.replace(terms,(label)=>{
        const {type,id}=matches.get(label.toLocaleLowerCase('ru'));
        const key=`${type}:${id}`;
        if(seen.has(key))return label;
        seen.add(key);return `[[${label}|${key}]]`;
      }).replace(colorTerms,label=>{
        const type=damageTypes.get(label.toLocaleLowerCase('ru'));
        return `[${type}]:${type}:${label}[/${type}]`;
      });
    }).join('').replace(/\[\/radiant\]или/g,'[/radiant] или');
  };
}

function variantText(row, parent) {
  const ref=row.card_number;
  if(ref.startsWith('SPELL-VAR-SPELL-0230-')) {
    const skill=row.name.split(' — ')[1];
    return {full:`Вы касаетесь согласного существа. Пока заклинание активно, оно добавляет 1к4 к любой проверке характеристики с навыком «${skill}». Требуется концентрация, вплоть до 1 минуты.`};
  }
  if(ref.startsWith('SPELL-VAR-SPELL-0295-')) {
    const type=ref.slice('SPELL-VAR-SPELL-0295-'.length);
    return {full:`Вы касаетесь согласного существа. До окончания концентрации, вплоть до 1 минуты, когда оно получает урон типа «${damage(type)}», оно уменьшает общий полученный урон на 1к4. Существо может воспользоваться этим уменьшением только один раз за ход.`};
  }
  if(ref.startsWith('SPELL-VAR-SPELL-0315-')) {
    const type=ref.slice('SPELL-VAR-SPELL-0315-'.length);
    return {full:`Вы направляете чародейскую энергию на одно существо или объект в пределах дистанции. Совершите дальнобойный бросок атаки по цели. При попадании она получает 1к8 урона типа «${damage(type)}».\n\nЕсли на к8 этого заклинания выпадает 8, вы можете бросить ещё одну к8 и добавить результат к урону. Это относится и к дополнительным костям. За одно сотворение максимальное число дополнительных к8 равно МЗ.`};
  }
  if(ref.startsWith('SPELL-VAR-SPELL-0224-')) {
    const radiant=ref.endsWith('-radiant');
    return {full:`Руководствуясь магической проницательностью, вы совершаете одну атаку оружием, использованным как материальный компонент заклинания. Для бросков атаки и урона используется ваша заклинательная характеристика вместо Силы или Ловкости.\n\nПри попадании атака наносит ${radiant?`урон типа «${damage('radiant')}»`:'урон обычного типа этого оружия'}. Начиная с 5-го уровня к нему добавляется урон типа «${damage('radiant')}», указанный в усилении заговора.`,up:parent.upcast_description.replace(/^Независимо[\s\S]+?атака наносит /,'Атака наносит ')};
  }
  if(ref.startsWith('SPELL-VAR-SPELL-0298-')) {
    return {full:elementalVariants[ref.slice('SPELL-VAR-SPELL-0298-'.length)]};
  }
  if(ref.startsWith('SPELL-VAR-thaumaturgy-')) {
    const option=ref.slice('SPELL-VAR-thaumaturgy-'.length);
    const limit='При повторном сотворении Чудотворства одновременно могут действовать до трёх его эффектов с длительностью 1 минута.';
    return {full:`${thaumaturgyVariants[option]}\n\n${limit}`};
  }
  throw Error(`Unreviewed variant ${ref}`);
}

export function buildEditorialReview({spells,concepts,effects,source}) {
  const all=spells.filter(s=>s.level===0), bases=all.filter(s=>!s.mechanics?.variant_of_spell_id);
  const format=editorialFormatter(concepts,effects);
  const byID=new Map(all.map(s=>[s.id,s]));
  const prepared=new Map();
  const entries=[];
  for(const row of bases) {
    const review=reviews[row.card_number];
    if(!review)throw Error(`Unreviewed cantrip ${row.card_number}`);
    if(review.blocked)continue;
    const full=review.full??row.detailed_description??row.description;
    const short=review.short??(review.shortFromFull||review.full&&full.length<580?full:row.description);
    const after={...pick(row),description:format(short),detailed_description:format(full),upcast_description:format(review.up??row.upcast_description)};
    prepared.set(row.id,after);
  }
  for(const row of all) {
    const parentID=row.mechanics?.variant_of_spell_id;
    const review=parentID?reviews[byID.get(parentID)?.card_number]:reviews[row.card_number];
    if(!review)throw Error(`Unknown parent of ${row.card_number}`);
    let after=prepared.get(row.id);
    if(parentID) {
      const parent=prepared.get(parentID);
      if(!parent)throw Error(`No reviewed parent for ${row.card_number}`);
      const selected=variantText(row,parent);
      if(!selected.full)throw Error(`Missing variant text ${row.card_number}`);
      after={...pick(row),description:format(selected.full),detailed_description:format(selected.full),upcast_description:format(selected.up??parent.upcast_description)};
    }
    const before=pick(row);
    entries.push({id:row.id,card_number:row.card_number,name:row.name,parent_id:parentID??null,source:row.source,book_page:review.page,
      status:review.blocked?'source_unverified':'reviewed',issues:[...review.issues,...(!row.detailed_description?['Полное описание отсутствует.']:[]),...(parentID?['Текст варианта повторяет общий выбор родителя; заменён описанием конкретного выбранного эффекта.']:[])],before,after:after??null,expected_mechanics:row.mechanics,mechanics_sha256:sha(row.mechanics),support_sha256:sha(row.support)});
  }
  const remaps=Object.entries(conditionAliases).flatMap(([conceptID,condition])=>{
    const c=concepts.find(c=>c.concept_id===conceptID),e=effects.find(e=>e.card_number===`COND-${condition}`);
    return c&&e?[{concept_id:conceptID,concept_uuid:c.id,effect_id:e.id,effect_card_number:e.card_number,concept_name:c.name,effect_name:e.name}]:[];
  });
  return {schema_version:1,application_id:'cantrip-editorial-20261014',source,concept:spellcastingModifier,counts:{total:all.length,bases:bases.length,variants:all.length-bases.length,book_verified:bases.filter(s=>!reviews[s.card_number].blocked).length,prepared:entries.filter(e=>e.after).length,missing_detailed:all.filter(s=>!s.detailed_description).length},reference_ids:{concept:[...concepts.flatMap(c=>[c.id,c.concept_id]),'spellcasting_modifier'],effect:effects.flatMap(e=>[e.id,e.card_number])},entries,condition_concept_remaps:remaps,
    metadata_proposals:bases.filter(s=>reviews[s.card_number].area||reviews[s.card_number].material_text).map(s=>({id:s.id,card_number:s.card_number,area:reviews[s.card_number].area,material_text:reviews[s.card_number].material_text}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const input=resolve(process.argv[2]??'outputs/cantrip-audit-20261014');
  const out=resolve(process.argv[3]??input);
  const read=name=>JSON.parse(readFileSync(resolve(input,`${name}.json`),'utf8'));
  const result=buildEditorialReview({spells:read('spells'),concepts:read('concepts'),effects:read('effects'),source:read('source')});
  mkdirSync(out,{recursive:true});
  writeFileSync(resolve(out,'editorial-review.json'),JSON.stringify(result,null,2)+'\n');
  const updates=new Map(result.entries.filter(e=>e.after).map(e=>[e.id,e.after]));
  writeFileSync(resolve(out,'reviewed-cantrips.json'),JSON.stringify(read('spells').filter(s=>s.level===0).map(s=>({...s,...updates.get(s.id)})),null,2)+'\n');
  console.log(JSON.stringify(result.counts));
}
