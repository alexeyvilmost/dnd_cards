import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spellReviewNotes } from './data/spell-review-notes-20260929.mjs';
import { level3ReviewNotes } from './data/spell-review-notes-level3-20260929.mjs';
import { level4ReviewNotes } from './data/spell-review-notes-level4-20260929.mjs';
import { level5ReviewNotes } from './data/spell-review-notes-level5-20260929.mjs';
import { highReviewNotes } from './data/spell-review-notes-high-20260929.mjs';

// This is a one-time, guarded migration builder. Stable catalogue references
// here identify reviewed rows; none are consulted by the runtime engine.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'outputs/mechanics-20260929');
const all = JSON.parse(fs.readFileSync(path.join(source, 'spells.json'), 'utf8'));
const spells = all.filter(row => row.deleted_at === null);
const notes = new Map([...spellReviewNotes, ...level3ReviewNotes, ...level4ReviewNotes, ...level5ReviewNotes, ...highReviewNotes].map(([ref, coverage, gap]) => [ref, {coverage, gap}]));
if (spells.length !== 394 || notes.size !== 394 || spells.some(row => !notes.has(row.card_number))) throw Error('The audit must cover exactly the 394 active snapshot spells');
const copy = value => structuredClone(value);
const rows = new Map(spells.map(row => [row.card_number, {...copy(row), changes: []}]));
const additions = [];
const digest = row => crypto.createHash('sha256').update(JSON.stringify([row.description??null,row.detailed_description??null])).digest('hex');
const stableId = reference => {
 const bytes=crypto.createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex')).update(`bagofholding/catalog-audit-20260929/${reference}`).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
 const value=bytes.toString('hex'); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
};
const insert = (type, reference, name, description, mechanics) => {
 const row={id:stableId(reference),card_number:reference,name,description,detailed_description:null,rarity:'common',author:'Admin',source:'Bag Of Holding',image_url:'',mechanics,
  ...(type==='action'?{action_type:'base_action',resource:mechanics.activation.cost[0]?.resource??'action'}:{effect_type:'spell_effect'})};
 additions.push({entity_type:type,id:row.id,card_number:reference,name,description_sha256:digest(row),preimage:null,patch:row,
 review:{status:'not_verified',summary:'Каноничное временное действие или эффект заклинания.',implemented:['Предоставляется данными заклинания и проверяется по активному эффекту.'],tested:[],limitations:[],evidence:[]}});
 return reference;
};
const edited = (ref, reason, fn) => {
  const row = rows.get(ref); if (!row) throw Error(`Unknown active spell ${ref}`);
  fn(row.mechanics, row);
  row.changes.push(reason);
};
const walk = (value, visit) => { if (Array.isArray(value)) value.forEach(item => walk(item, visit)); else if (value && typeof value === 'object') { visit(value); Object.values(value).forEach(item => walk(item, visit)); } };
const refs = text => text.trim().split(/\s+/);
const auto = (result, who = 'target') => ({resolution: 'auto', who, result});
const duration = (rounds, concentration = false) => ({type: 'rounds', amount: rounds, ...(concentration ? {concentration: true} : {})});
const mod = (roll, op, value, rounds, concentration = false, filter, scope) => ({kind: 'modifier', applies_to: {roll, ...(filter ? {filter} : {})}, op, ...(value === undefined ? {} : {value}), duration: duration(rounds, concentration), ...(scope ? {scope} : {})});
const condition = (value, rounds, concentration = false, saveAbility) => ({kind: 'condition', value, op: 'apply', ...(rounds ? {duration: duration(rounds, concentration)} : {}), ...(saveAbility ? {save_ends: {ability: saveAbility, dc: '8 + prof + spellcasting', timing: 'end_of_turn'}} : {})});
const resistance = (type, rounds, concentration = false, value = 'resistance') => ({kind: 'resistance', damage_type: type, value, duration: duration(rounds, concentration)});
const choice = (id, prompt, options, who = 'target') => ({kind:'choice', id, context:'in_play', count:1, who, prompt, options:{source:'explicit', items:options}});
const actor = (range, max = 1, area, willing = false) => ({domain:'actor', actor_targets:true, shape: area ? 'area' : 'single', min_targets:1, max_targets:max, range_ft:range, requires_line_of_sight:range > 5, allowed_relations:['self','ally','enemy','neutral'], ...(range===5 ? {requires_touch:true} : {}), ...(willing ? {requires_willing:true} : {}), ...(area ? {area} : {})});
const self = {domain:'actor', actor_targets:false, shape:'self', min_targets:0, max_targets:1, range_ft:0, requires_line_of_sight:false, allowed_relations:['self']};
const world = range => ({domain:'world', actor_targets:false, shape:'single', min_targets:0, max_targets:0, range_ft:range, requires_line_of_sight:true, allowed_relations:[]});
const range = row => row.range === 'Касание' ? 5 : row.range === 'На себя' ? 0 : row.range === '1 миля' ? 5280 : row.range === '500 миль' ? 2640000 : ['Неограниченная','Обзор','Особая'].includes(row.range) ? 2147483647 : Number.parseInt(row.range,10);

// Explicit semantic classification of world-only and self-only high-level
// declarations. Existing rich target contracts are otherwise preserved.
const worldOnly = new Set(refs(`summon_construct summon_elemental arcane_eye guardian_of_faith stone_shape giant_insect control_water leomunds_secret_chest locate_creature mordenkainens_private_sanctum mordenkainens_faithful_hound hallucinatory_terrain fabricate summon_aberration animate_objects legend_lore dream wall_of_stone teleportation_circle hallow passwall summon_celestial reincarnate wall_of_force conjure_elemental creation awaken scrying commune_with_nature summon_dragon drawmijs_instant_summons magic_jar transport_via_plants planar_ally move_earth programmed_illusion summon_fiend find_the_path heroes_feast forbiddance arcane_gate tashas_bubbling_cauldron guards_and_wards create_undead contingency delayed_blast_fireball teleport plane_shift magnificent_mansion forcecage symbol reverse_gravity mirage_arcane project_image simulacrum clone control_weather demiplane animal_shapes antimagic_field antipathy_sympathy imprisonment wish shapechange time_stop gate astral_projection true_resurrection prismatic_wall`));
const selfOnly = new Set(refs(`fount_of_moonlight divination fire_shield dimension_door conjure_minor_elementals aura_of_life aura_of_purity contact_other_plane commune dispel_evil_and_good antilife_shell circle_of_power swift_quiver mislead tree_stride globe_of_invulnerability wind_walk word_of_recall etherealness holy_aura telepathy glibness storm_of_vengeance`));
const classIds = { 'бард':'CLASS-bard','жрец':'CLASS-cleric','друид':'CLASS-druid','паладин':'CLASS-paladin','следопыт':'CLASS-ranger','чародей':'CLASS-sorcerer','колдун':'CLASS-warlock','волшебник':'CLASS-wizard' };
for (const row of rows.values()) {
  if (!row.mechanics) continue;
  const mechanics = row.mechanics;
  if (!mechanics.spell_class_list_ids && row.classes?.length) {
    mechanics.spell_class_list_ids = row.classes.map(value => classIds[value]);
    if (mechanics.spell_class_list_ids.some(id => !id)) throw Error(`Unknown class on ${row.card_number}`);
    row.changes.push('Добавлены каноничные ID классов из исходного списка классов.');
  }
  if (!mechanics.targeting) {
    const distance = range(row); if (!Number.isFinite(distance)) throw Error(`Unreviewed range ${row.card_number}`);
    mechanics.targeting = worldOnly.has(row.card_number) ? world(distance) : selfOnly.has(row.card_number) ? copy(self) : actor(distance);
    row.changes.push('Явно задан контракт выбора цели из прочитанного описания и дистанции.');
  }
  const time = /^(\d+)\s+(минут|час)/u.exec(row.casting_time ?? '');
  if (time && !mechanics.activation.cast_time) {
    mechanics.activation.cast_time = {unit:time[2]==='час' ? 'hour':'minute', amount:Number(time[1])};
    mechanics.activation.cost = mechanics.activation.cost.filter(cost => !['action','bonus_action','reaction'].includes(cost.resource));
    row.changes.push('Сохранена длительность долгого сотворения вместо мгновенной активации.');
  }
}

// Every row below was compared against its text: a successful save must apply
// exactly the damage instances (including scaling), with none of the failure
// conditions, movement or ongoing effects.
const halfSaveRefs = refs(`hellish_rebuke SPELL-0187 SPELL-0228 SPELL-0283 wall_of_fire vitriolic_sphere blight phantasmal_killer ice_storm insect_plague conjure_volley cone_of_cold jallarzis_storm_of_radiance yolandes_regal_presence cloudkill flame_strike otilukes_freezing_sphere wall_of_thorns circle_of_death chain_lightning sunbeam harm blade_barrier wall_of_ice finger_of_death fire_storm conjure_celestial tsunami incendiary_cloud sunburst befuddlement meteor_swarm weird`);
for (const ref of halfSaveRefs) edited(ref, 'Успешный спасбросок наносит половину положенного урона, без последствий провала.', mechanics => {
  for (const effect of mechanics.effects) if (effect.resolution === 'save') {
    const damage = effect.on_fail.filter(payload => payload.kind === 'damage');
    if (damage.length) effect.on_success = damage.map(payload => ({...copy(payload), on_success:'half'}));
  }
});
edited('SPELL-0273','Успех WIS наносит половину3к8; оба исхода растут1к8 за ячейку.', mechanics => {
  const effect=mechanics.effects.find(effect=>effect.resolution==='save');
  effect.on_fail.find(payload=>payload.kind==='damage').scaling={per:'spell_slot_above',dice:'1d8'};
  effect.on_success=effect.on_fail.filter(payload=>payload.kind==='damage').map(payload=>({...copy(payload),on_success:'half'}));
});
for (const [ref,dice] of [['SPELL-0191','1d8'],['SPELL-0227','1d8']]) edited(ref,`Добавлен указанный рост ${dice} за ячейку.`, mechanics=>walk(mechanics,node=>{if(['damage','healing'].includes(node.kind)) node.scaling={per:'spell_slot_above',dice};}));
edited('false_life','Временные хиты растут на5 за каждый круг выше первого.', mechanics=>walk(mechanics,node=>{if(node.kind==='temp_hp')node.amount='2d4 + 4 + 5 * spell_slot_above';}));

const targetPatches = [
 ['SPELL-0280',actor(5,64,{kind:'emanation',radius_ft:5})], ['SPELL-0291',actor(5,64,{kind:'emanation',radius_ft:5})],
 ['wall_of_fire',actor(120,64,{kind:'line',size_ft:60,width_ft:1})], ['evards_black_tentacles',actor(90,64,{kind:'cube',size_ft:20})],
 ['vitriolic_sphere',actor(150,64,{kind:'sphere',radius_ft:20})], ['ice_storm',actor(300,64,{kind:'cylinder',radius_ft:20})],
 ['insect_plague',actor(300,64,{kind:'sphere',radius_ft:20})], ['conjure_volley',actor(150,64,{kind:'cylinder',radius_ft:40})],
 ['cone_of_cold',actor(60,64,{kind:'cone',size_ft:60})], ['mass_cure_wounds',actor(60,6,{kind:'sphere',radius_ft:30})],
 ['cloudkill',actor(120,64,{kind:'sphere',radius_ft:20})], ['flame_strike',actor(60,64,{kind:'cylinder',radius_ft:10})],
 ['steel_wind_strike',actor(30,5)], ['otilukes_freezing_sphere',actor(300,64,{kind:'sphere',radius_ft:60})],
 ['circle_of_death',actor(150,64,{kind:'sphere',radius_ft:60})], ['chain_lightning',actor(150,4)],
 ['sunbeam',actor(60,64,{kind:'line',size_ft:60,width_ft:5})], ['wall_of_thorns',actor(120,64,{kind:'line',size_ft:60,width_ft:5})],
 ['blade_barrier',actor(90,64,{kind:'line',size_ft:100,width_ft:5})], ['wall_of_ice',actor(120,64,{kind:'line',size_ft:100,width_ft:1})],
 ['mass_suggestion',actor(60,12)], ['fire_storm',actor(150,64)], ['divine_word',actor(30,64)],
 ['earthquake',actor(500,64,{kind:'sphere',radius_ft:100})], ['meteor_swarm',actor(5280,64)],
 ['tsunami',actor(2147483647,64,{kind:'line',size_ft:300,width_ft:50})], ['greater_invisibility',actor(5)],
 ['power_word_heal',actor(60)], ['foresight',actor(5,1,undefined,true)], ['mind_blank',actor(5,1,undefined,true)],
];
for (const [ref,targeting] of targetPatches) edited(ref,'Исправлены адресат, дистанция и число/область целей.', mechanics=>{mechanics.targeting=targeting;});

// These are explicit, small payload corrections rather than generated combat
// replacements: all unrelated effects/choices remain exactly as in snapshot.
edited('SPELL-0482','Удалён ошибочный урон самому заклинателю и отсутствующий в тексте рост.',mechanics=>{for(const effect of mechanics.effects??[])if(effect.result)effect.result=effect.result.filter(payload=>payload.kind!=='damage');});
edited('SPELL-0318','Бонус КД ограничен10минутами концентрации.',mechanics=>walk(mechanics,node=>{if(node.kind==='modifier')node.duration=duration(100,true);}));
edited('longstrider','Скорость+10 сохраняется как часовой модификатор.',mechanics=>{mechanics.effects=[auto([mod('speed','add',10,600)])];});
edited('hold_person','Паралич ограничен минутой и заканчивается успешным WIS конца хода.',mechanics=>{
 const fail=mechanics.effects.find(effect=>effect.resolution==='save').on_fail;
 for(let index=0;index<fail.length;index++)if(fail[index].kind==='grant_effect'&&fail[index].value==='COND-paralyzed')fail[index]=condition('paralyzed',10,true,'wis');
});
edited('hold_monster','Реализован паралич со спасброском WIS конца хода.',mechanics=>{mechanics.effects.find(effect=>effect.resolution==='save').on_fail.unshift(condition('paralyzed',10,true,'wis'));});
edited('SPELL-0182','Повторные CON снимают выбранную слепоту/глухоту.',mechanics=>walk(mechanics,node=>{if(node.kind==='grant_effect'&&['COND-blinded','COND-deafened'].includes(node.value))node.save_ends={ability:'con',dc:'8 + prof + spellcasting',timing:'end_of_turn'};}));
edited('blinding_smite','Повторный CON конца хода снимает слепоту.',mechanics=>walk(mechanics,node=>{if(node.kind==='grant_effect'&&node.value==='COND-blinded')node.save_ends={ability:'con',dc:'8 + prof + spellcasting',timing:'end_of_turn'};}));
edited('sunburst','Слепота заканчивается успешным CON конца хода.',mechanics=>walk(mechanics,node=>{if(node.kind==='condition'&&node.value==='blinded')node.save_ends={ability:'con',dc:'8 + prof + spellcasting',timing:'end_of_turn'};}));
for (const [ref,state,which] of [['sunbeam','blinded','until_start_of_source_next_turn'],['conjure_fey','frightened','until_start_of_source_next_turn'],['staggering_smite','stunned','until_end_of_source_next_turn'],['telekinesis','restrained','until_end_of_source_next_turn']]) edited(ref,'Срок состояния отсчитывается от нужного хода источника.',mechanics=>walk(mechanics,node=>{if(node.kind==='condition'&&node.value===state)node.duration={type:which};}));
for (const [ref,rounds,conc] of [['SPELL-0231',600,true],['greater_invisibility',10,true],['banishment',10,true],['compulsion',10,true],['charm_monster',600,false],['dominate_beast',10,true],['dominate_person',10,true],['dominate_monster',600,true],['modify_memory',10,true],['mass_suggestion',14400,false],['mislead',600,true],['weird',10,true],['storm_of_vengeance',10,true]]) edited(ref,'Состояния имеют конечный срок и принадлежность концентрации.',mechanics=>walk(mechanics,node=>{if(node.kind==='condition'&&node.op!=='remove'||node.kind==='grant_effect'&&String(node.value).startsWith('COND-'))node.duration=duration(rounds,conc);}));

const types = [['acid','Кислота'],['cold','Холод'],['fire','Огонь'],['lightning','Электричество'],['thunder','Звук']];
edited('protection_from_energy','Выбранное сопротивление реально применяется на1час концентрации.',mechanics=>{mechanics.effects=[choice('energy_type','Выберите тип урона',types.map(([id,name])=>({id,name,grants:[resistance(id,600,true)]})))];mechanics.targeting.requires_willing=true;});
edited('stoneskin','Три физических сопротивления реально применяются на1час концентрации.',mechanics=>{mechanics.effects=[auto(['bludgeoning','piercing','slashing'].map(type=>resistance(type,600,true)))];mechanics.targeting=actor(5,1,undefined,true);});
edited('fire_shield','Выбор тёплого/холодного щита предоставляет нужное сопротивление10минут.',mechanics=>{mechanics.effects.unshift(choice('shield_temperature','Выберите щит',[{id:'warm',name:'Тёплый',grants:[resistance('cold',100)]},{id:'cold',name:'Холодный',grants:[resistance('fire',100)]}],'self'));});
edited('mind_blank','Иммунитет psychic и charmed сохраняется 24 часа.',mechanics=>{mechanics.effects.unshift(auto([resistance('psychic',14400,false,'immunity'),{kind:'condition_immunity',condition:'charmed',duration:duration(14400)}]));});
edited('foresight','Преимущества трёх видовк20 и помеха входящихатак сохраняются8часов.',mechanics=>{mechanics.effects.unshift(auto(['attack','ability_check','saving_throw'].map(roll=>mod(roll,'advantage',undefined,4800)).concat([mod('attack','disadvantage',undefined,4800,false,undefined,'target')])));});
edited('beacon_of_hope','Реализованы преимущество WIS/спасбросков смерти и максимизация входящего лечения.',mechanics=>{mechanics.effects.unshift(auto([mod('saving_throw','advantage',undefined,10,true,{ability:'wis'}),mod('saving_throw','advantage',undefined,10,true,{kind:'death'}),mod('healing_received','maximize_dice',undefined,10,true)]));});
edited('SPELL-0309','Преимущество выбранной проверки характеристики заменяет неверные владения.',mechanics=>{mechanics.effects=[choice('enhanced_ability','Выберите характеристику',[['str','Сила'],['dex','Ловкость'],['int','Интеллект'],['wis','Мудрость'],['cha','Харизма']].map(([id,name])=>({id,name,grants:[mod('ability_check','advantage',undefined,600,true,{ability:id})]})))];mechanics.targeting=actor(5,1,undefined,true);});
edited('circle_of_power','Преимущество ограничено магическими спасбросками и сроком концентрации.',mechanics=>walk(mechanics,node=>{if(node.kind==='modifier'){node.applies_to.filter={saveSource:'spell'};node.duration=duration(100,true);}}));
for(const [ref,sense,feet,rounds] of [['true_seeing','truesight',120,600],['SPELL-0169','truesight',0,600]]) if(feet) edited(ref,'Каноничное чувство и дальность сохраняются у цели на1час.',mechanics=>{mechanics.effects.unshift(auto([{kind:'grant_sense',sense,range:feet,duration:duration(rounds)}]));mechanics.targeting=actor(5,1,undefined,true);});

for(const ref of ['SPELL-0221','SPELL-0203']) edited(ref,'Состояния удаляются по семантике, включая все источники.',mechanics=>walk(mechanics,node=>{if(node.kind==='remove_effect'&&String(node.card_number).startsWith('COND-')){node.kind='condition';node.op='remove';node.value=node.card_number.slice(5);delete node.card_number;}}));
edited('heal','Лечение70+10/круг и снятие трёх состояний направлены цели.',mechanics=>{mechanics.effects=[auto([{kind:'healing',amount:'70 + 10 * spell_slot_above'},...['blinded','deafened','poisoned'].map(value=>({kind:'condition',value,op:'remove'}))])];});
edited('power_word_heal','Полное лечение фактического максимума и снятие пяти состояний.',mechanics=>{mechanics.effects.unshift(auto([{kind:'healing',restore_all:true},...['charmed','frightened','paralyzed','poisoned','stunned'].map(value=>({kind:'condition',value,op:'remove'}))]));});
edited('contact_other_plane','INT15 заклинателя,6к6psychic и недееспособность доотдыха при провале.',mechanics=>{mechanics.effects=[{resolution:'save',who:'self',ability:'int',dc:'15',on_fail:[{kind:'damage',type:'psychic',dice:'6d6'},{kind:'condition',value:'incapacitated',op:'apply',duration:{type:'until_long_rest'}}],on_success:[]}];});
edited('conjure_fey','К урону добавляется заклинательная характеристика.',mechanics=>walk(mechanics,node=>{if(node.kind==='damage')node.dice='3d12 + spellcasting';}));

function followup(key, name, description, targeting, effects, rounds, concentration, cost='action') {
 const actionRef=`ACT-spell-audit-${key}`, effectRef=`EFFECT-spell-audit-${key}`;
 insert('action',actionRef,name,description,{requires_runtime_action_grant:[actionRef],activation:{mode:'active',cost:[{resource:cost}]},targeting,effects});
 insert('effect',effectRef,name,description,{activation:{mode:'passive'},duration:duration(rounds,concentration),effects:[auto([{kind:'grant_action',value:actionRef}],'self')]});
 return {kind:'grant_effect',value:effectRef,duration:duration(rounds,concentration),bind_action_context:true};
}
const spellAttack=(dice,type,scaling,kind='spell_ranged')=>({resolution:'attack_roll',attack_kind:kind,ability:'spellcasting',vs:'ac',on_hit:[{kind:'damage',dice,type,...(scaling?{scaling}:{})}]});
const saveDamage=(dice,type,scaling)=>({resolution:'save',who:'target',ability:'dex',dc:'8 + prof + spellcasting',on_fail:[{kind:'damage',dice,type,scaling}],on_success:[{kind:'damage',dice,type,scaling,on_success:'half'}]});
edited('SPELL-0297','Сотворение бонусным действием даёт отдельный бросок пламени действием на 10 минут.',mechanics=>{
 const grant=followup('produce-flame','Метнуть сотворённое пламя','Дальнобойная атака заклинанием в пределах 60 футов, 1к8 огнём с ростом за уровень персонажа.',actor(60),[spellAttack('1d8','fire',{per:'character_level',dice:'1d8'})],100,false);
 mechanics.targeting=copy(self);mechanics.effects=[auto([grant],'self')];
});
edited('SPELL-0184','Горящий клинок предоставляет отдельную атаку с исходной характеристикой и ростом ячейки.',mechanics=>{
 const grant=followup('flame-blade','Атаковать горящим клинком','Рукопашная атака заклинанием: 3к6 + заклинательная характеристика огнём, +1к6 за круг выше второго.',actor(5),[spellAttack('3d6 + spellcasting','fire',{per:'spell_slot_above',dice:'1d6'},'spell_melee')],100,true);
 mechanics.effects=[auto([grant],'self')];
});
edited('SPELL-0269','Каст немедленно предоставляет Рывок и дальнейший Рывок бонусным действием.',mechanics=>{
 const dash={kind:'movement',value:'additional',speed_fraction:1};
 const grant=followup('expeditious-retreat','Рывок поспешного отступления','Рывок бонусным действием, пока действует концентрация.',copy(self),[auto([dash],'self')],100,true,'bonus_action');
 mechanics.targeting=copy(self);mechanics.effects=[auto([dash,grant],'self')];
});
edited('call_lightning','Повторная молния предоставляется отдельным действием с исходной ячейкой и СЛ.',mechanics=>{
 const grant=followup('call-lightning','Вызвать повторную молнию','Молния в точку в пределах 120 футов: DEX, 3к10 электричеством, половина при успехе. +1к10 за круг выше третьего.',actor(120,64,{kind:'sphere',radius_ft:5}),[saveDamage('3d10','lightning',{per:'spell_slot_above',dice:'1d10'})],100,true);
 mechanics.effects.push(auto([grant],'self'));
});
edited('SPELL-0167','Убран лишний мгновенный 1к12; повторный разряд связан с исходной целью и доступен после промаха.',mechanics=>{
 const grant=followup('witch-bolt','Поддержать ведьмин разряд','Бонусным действием нанести первоначальной цели 1к12 электричеством в пределах 60 футов.',actor(60),[auto([{kind:'damage',dice:'1d12',type:'lightning'}])],10,true,'bonus_action');
 grant.bind_action_target=true;mechanics.targeting=actor(60);
 mechanics.effects=[spellAttack('2d12','lightning',{per:'spell_slot_above',dice:'1d12'}),auto([grant],'self')];
});
edited('SPELL-0197','Согласный получатель получает дыхание выбранного типа с исходной ячейкой/СЛ заклинателя.',mechanics=>{
 mechanics.targeting=actor(5,1,undefined,true);
 mechanics.effects=[choice('dragon_breath_type','Выберите тип дыхания',[...types.filter(([type])=>type!=='thunder'),['poison','Яд']].map(([type,name])=>({id:type,name,
  grants:[followup(`dragon-breath-${type}`,`Дыхание дракона: ${name.toLowerCase()}`,'Действием выдохнуть 15-футовый конус: DEX, 3к6 выбранным типом, половина при успехе. +1к6 за круг выше второго.',actor(15,64,{kind:'cone',size_ft:15}),[saveDamage('3d6',type,{per:'spell_slot_above',dice:'1d6'})],10,true)]})))];
});

const entities = spells.map(original => {
 const row=rows.get(original.card_number), note=notes.get(original.card_number);
 const changed=JSON.stringify(row.mechanics)!==JSON.stringify(original.mechanics);
 const preimage=Object.fromEntries(['description','detailed_description','mechanics','level','range','duration','casting_time','classes','school','concentration','upcast_description','deleted_at'].map(key=>[key,original[key]??null]));
 return {entity_type:'spell',id:original.id,card_number:original.card_number,name:original.name,
   description_sha256:crypto.createHash('sha256').update(JSON.stringify([original.description??null,original.detailed_description??null])).digest('hex'),
   preimage,patch:changed?{mechanics:row.mechanics}:{},
   review:{status:'not_verified',summary:`Сопоставлены описание, подробный текст и рост: ${note.coverage}`,implemented:row.changes,tested:[],limitations:[note.gap],evidence:['Свежий production snapshot 2026-09-29; поштучный семантический аудит, прежние сертификаты не использованы.']}};
});
entities.push(...additions);
const actualDamageTests=new Set(refs('vitriolic_sphere ice_storm cone_of_cold flame_strike circle_of_death chain_lightning fire_storm incendiary_cloud meteor_swarm'));
const actualSpecialTests=new Set(refs('mind_blank beacon_of_hope SPELL-0297 SPELL-0184 SPELL-0167 SPELL-0197'));
const updatedGaps={
 'SPELL-0297':'Свет в руке и атака мирового объекта требуют адаптера сцены; атаки существ и длительность проверены.',
 'SPELL-0184':'Свободная рука, выпускание/возврат клинка бонусным действием и освещение пока не моделируются.',
 'SPELL-0269':'Рывок использует общий механизм дополнительного движения; сложные взаимодействия маршрута с реакциями отдельно не проверялись.',
 'SPELL-0167':'Нет автоматического разрыва при выходе цели из дистанции/полном укрытии и запрета повторного разряда в ход первоначального каста. При использовании повторного действия цель, дистанция и видимость проверяются.',
 'call_lightning':'Положение грозового облака, условие помещения и дополнительный 1к10 естественной грозы требуют фактов сцены. Повторные действия используют исходную ячейку и характеристику.',
 'SPELL-0197':'Не проверено наличие рта. В контексте повторного действия сохраняются базовые параметры исходного заклинателя; произвольные временные модификаторы его атак/СЛ не замораживаются.',
 'mind_blank':'Блокировка чтения мыслей, прорицания и Wish требует мирового адаптера; psychic immunity и charmed immunity проверены.',
 'beacon_of_hope':'Проверены WIS, спасбросок смерти и максимизация входящего лечения. Геометрия группового выбора и все источники лечения отдельно не проверялись.',
};
for(const row of entities){
 if(row.entity_type==='spell'){
   row.review.summary=`Поштучно сопоставлены описание, подробный текст, рост и декларация заклинания «${row.name}». ${notes.get(row.card_number).coverage}`;
   row.review.tested=['Сохранённая декларация проходит каноничную схему (при наличии механики); проверены ссылки на зависимости.'];
   row.review.evidence.push('frontend/src/engine/spellCatalogAudit.test.ts');
   if(updatedGaps[row.card_number])row.review.limitations=[updatedGaps[row.card_number]];
   if(actualDamageTests.has(row.card_number)){
     row.review.status='partial_narrative_verified_partial';
     row.review.tested.push('Фактическая декларация: одинаковые кости при провале/успехе, половина урона с округлением вниз, HP получателя и расход действия.');
   }
   if(actualSpecialTests.has(row.card_number)){
     row.review.status='partial_narrative_verified_partial';
     row.review.tested.push('Проверены фактические данные в адресном исполнении; сохранение/повторные действия и ограничения проверены в соответствующем тесте каталога.');
   }
 }else{
   row.review.tested=['Каноничная схема; разрешимость ссылок и запрет исполнения без активного предоставляющего эффекта.'];
   row.review.evidence=['frontend/src/engine/spellCatalogAudit.test.ts','frontend/src/character/effectGrantedActions.test.ts'];
   if(/produce-flame|flame-blade|witch-bolt|dragon-breath-(fire|cold)/.test(row.card_number)){
     row.review.status='verified_partial';
     row.review.tested.push('Сохранение контекста, оплата, исполнение после загрузки и отзыв полномочия проверены на фактической механике.');
   }
 }
}
const dependencies=new Map();
for(const [type,file] of [['effect','effects'],['action','actions'],['spell','spells']]) {
 for(const row of JSON.parse(fs.readFileSync(path.join(source,`${file}.json`),'utf8'))) {
   for(const key of [row.id,row.card_number]) if(key) dependencies.set(`${type}:${key}`,row);
 }
}
const owned=new Set(entities.flatMap(row=>[`${row.entity_type}:${row.id}`,`${row.entity_type}:${row.card_number}`]));
const guards=new Map(), unresolved=[];
const inspectDependencies=(mechanics,sourceRef)=>walk(mechanics,node=>{
 const type=({grant_effect:'effect',grant_action:'action',grant_spell:'spell'})[node.kind];
 if(!type)return;
 const references=[...(typeof node.value==='string'?[node.value]:[]),...(Array.isArray(node.values)?node.values:[])];
 for(const reference of references) {
   const key=`${type}:${reference}`; if(owned.has(key))continue;
   const row=dependencies.get(key);
   if(!row){unresolved.push(`${sourceRef} -> ${key}`);continue;}
   if(guards.has(`${type}:${row.id}`))continue;
   const preimage=Object.fromEntries(['description','detailed_description','mechanics','deleted_at',...(type==='effect'?['repeatable','effect_type']:type==='action'?['action_type']:['level','school','concentration'])].map(key=>[key,row[key]??null]));
   guards.set(`${type}:${row.id}`,{entity_type:type,id:row.id,card_number:row.card_number,name:row.name,description_sha256:digest(row),preimage});
   inspectDependencies(row.mechanics,row.card_number);
 }
});
for(const row of entities)inspectDependencies(row.patch.mechanics??row.preimage?.mechanics,row.card_number);
if(unresolved.length)throw Error(`Unresolved dependencies: ${unresolved.join('; ')}`);
const manifest={schema_version:1,audit_id:'spell-catalog-20260929',source_snapshot_sha256:'079b69c5cdcbff81d9346a97a3717ef2abf48c54306d62778824bcbc96a3f291',entities,guards:[...guards.values()]};
const output=path.join(root,'backend/migrations/data/catalog-audit-20260929/spells.json');
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,entities:entities.length,patched:entities.filter(row=>Object.keys(row.patch).length).length}));
