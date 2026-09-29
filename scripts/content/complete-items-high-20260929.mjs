import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'outputs/catalog-completion-20260929/cards.json'), 'utf8')).filter(card => card.deleted_at === null);
const high = cards.filter(card => {
  const numeric = /^(?:CARD-|RL-SHOP-)([0-9]+)$/.exec(card.card_number);
  return !numeric || Number(numeric[1]) >= 700;
}).sort((left, right) => left.card_number.localeCompare(right.card_number));
const clone = value => JSON.parse(JSON.stringify(value));
const number = n => typeof n === 'number' ? `CARD-${String(n).padStart(4, '0')}` : n;
const byNumber = new Map(high.map(card => [card.card_number, card]));
const changes = new Map();
const completed = new Map();
const missingDefinitions = new Map();
const related = [];
const evidence = {
  passive: ['frontend/src/engine/itemCatalogAudit.test.ts'],
  life: ['frontend/src/engine/itemLifePolicies.test.ts', 'frontend/src/solo-combat/itemLifePolicies.integration.test.ts', 'frontend/src/solo-combat/deathSaves.test.ts'],
  aura: ['frontend/src/solo-combat/combatAuras.test.ts'],
  influence: ['frontend/src/engine/itemBookInfluences.test.ts'],
  event: ['frontend/src/engine/itemCompletionEvents.test.ts'],
};
function record(numbers, implementation, tests = evidence.passive, classification = 'mechanical') {
  for (const id of [].concat(numbers).map(number)) {
    if (!byNumber.has(id)) throw Error(`Missing item ${id}`);
    completed.set(id, { implementation, evidence: tests, classification });
  }
}
function patch(n, mechanics, implementation, tests) {
  const id = number(n); changes.set(id, { mechanics }); record(id, implementation, tests);
}
function withPayloads(n, payloads, whileActive = 'equipped') {
  const original = changes.get(number(n))?.mechanics ?? byNumber.get(number(n)).mechanics ?? {};
  return { ...clone(original), activation: { mode: 'passive', while: whileActive },
    effects: [...clone(original.effects ?? []), { resolution: 'auto', result: payloads }] };
}
const modifier = (roll, op, value, filter) => ({ kind: 'modifier', op, ...(value === undefined ? {} : { value }),
  applies_to: { roll, ...(filter ? { filter } : {}) } });

const alchemicalFire = clone(byNumber.get(number(714)).mechanics);
alchemicalFire.targeting.requires_sight = true;
alchemicalFire.attack_replacement = {
  replacement_key: 'item-completion:714:throw',
  replaces_attacks: 1,
  total_attacks: 'actor',
  once_per_attack_action: false,
};
patch(714, alchemicalFire,
  'Фляжка заменяет ровно одну атаку в действии Атака; доступное число атак берётся из текущего профиля персонажа. Видимая цель-существо после объявления и расхода одной фляжки совершает спасбросок Ловкости СЛ 8+ЛОВ+БВ, затем применяются огонь и горение. Повтор команды не расходует предмет повторно.',
  ['frontend/src/rules-core/itemAttackReplacement.integration.test.ts']);
missingDefinitions.set(number(714),['Мировой объект пока не имеет универсальных хитов и спасброска Ловкости в авторитетной боевой модели: метание в объект и последующее горение объекта этим действием не исполняются.']);

// This map is also an honest progress ledger: incomplete clauses below remain
// explicit and are never promoted to coverage by their previous support status.
record([711,752,754,775,776,977], 'В тексте отсутствует правило или числовой эффект; внешний вид предмета остаётся описанием.', [], 'narrative');
record([709,717], 'Описана физическая вместимость листа для рукописного текста без правила броска, проверки или изменения состояния персонажа.', [], 'narrative');
record(731,'Указана вместимость палатки для сна двух существ; преимуществ, условий отдыха и изменений ресурсов предмет не задаёт.', [], 'narrative');
record(812,'Перечислена обычная еда на день без правила голода, расхода или изменения ресурсов персонажа.', [], 'narrative');
record(830,'Вместимость флакона для письма не изменяет броски и состояние персонажа; отдельные правила переписывания магии не указаны.', [], 'narrative');
record(867,'Исследование и утрата воспоминания — сюжетное событие без броска, изменения характеристик или условия для игровой сущности.', [], 'narrative');
for(const [n,why]of [
  [902,'В каталоге нет базовой сущности «Грантер», её носителей и правил установления связи. Радиус одной мили известен, но авторитетно выбрать отправителя/получателя мыслей, зрения и слуха нельзя.'],
  [903,'В каталоге нет базовой сущности «Грантер» или признака её носителя: множество участников общего броска инициативы не определено.'],
  [904,'В каталоге нет базовой сущности «Грантер» и определения услуги, которую предоставляет бесплатный заряд; известно только количество 1 и долгий отдых.'],
  [905,'В каталоге нет базовой сущности «Грантер», правил выбора получателя ячейки и уровня передаваемой ячейки; одна стоимость реакции не определяет перевод.'],
]){
  record(n,why,[],'source_undefined');missingDefinitions.set(number(n),[why]);
}
const mentalConditionGap='Источник разрешает реакцией снять «ментальное состояние», но не определяет перечень таких состояний; в каталоге нет стабильного тега или справочника этой категории. Также не определено, как установить постоянность снимаемого эффекта. Без этих данных нельзя авторитетно выбрать цель снятия или минутного иммунитета; известные стоимость реакции и лимит1/день не расходуются на действие без результата.';
record(981,mentalConditionGap,[],'source_undefined');missingDefinitions.set(number(981),[mentalConditionGap]);
const randomSacrificeGap='Источник не определяет пул и веса для «случайной жертвы»; в каталоге 28 различных карточек «Жертва», среди них «Пустота» без эффекта. Выдача выбранному существу «Пустоты» определена, но без авторитетного случайного выбора нельзя атомарно исполнить всю карточку, поэтому фиктивный бросок и неполная выдача не создаются.';
record(930,randomSacrificeGap,[],'source_undefined');missingDefinitions.set(number(930),[randomSacrificeGap]);
const ropeBindingGap='Описание верёвки даёт длину 50фт и возможность связывания, но не задаёт условия связывания, стоимость действия, СЛ или способ освобождения. Эти параметры нельзя вывести из одной длины.';
record(706,ropeBindingGap,[],'source_undefined');missingDefinitions.set(number(706),[ropeBindingGap]);
for(const [n,why]of [
  [723,'Масло можно применять как топливо или розжиг, но текст не задаёт объём расхода, длительность горения или цель поджигания. Светильники уже ссылаются на эту карточку как источник масла; списание неуказанной порции не выдумывается.'],
  [772,'Поля каталога задают 1к4 колющего урона, но описание не задаёт владение, тип атаки, достижимость и взаимодействие с занятыми руками для наручей-клинка. Произвольный профиль оружия не создаётся.'],
  [975,'Книга вмещает 100 страниц и содержит известные заклинания волшебника 1+ уровня; источник не задаёт число страниц на заклинание, цену и время копирования или правило утраты подготовки при потере книги. Классовая книга заклинаний остаётся отдельным каноничным источником знаний.'],
]){record(n,why,[],'source_undefined');missingDefinitions.set(number(n),[why]);}
record([777,778,836,837,838,851,857,939,940,941,980,'RL-SHOP-0851'],
  'Сохранён каноничный профиль оружия/доспеха: урон, дальность, свойства, зачарование, КД и требование владения. Дополнительных правил в описании нет.');
record([760,762,764,887,891,892,895,896,898,906,910,925,926,927,954,982,'RL-SHOP-0764'],
  'Все указанные в описании числовые изменения, преимущества/помехи, запреты и фильтры исполняются сохранёнными универсальными правилами; профиль предмета сохранён.');
record([890], 'Ёмкость настройки уменьшается на один слот через общий attunement_capacity; источник действует из инвентаря.');
record([756], 'Природа +1 и дополнительная максимальная ёмкость Дикого облика проходят общий сбор модификаторов и ресурсов.');
record([765,774,854], 'Заклинания предоставлены каноничными ссылками; at_will либо один бесплатный расход до долгого отдыха задаётся грантом и проверяется на исполнении.');
record([766,770], 'Триггер исполняется в соответствующей фазе spell_cast/encounter_start, с фильтрами школы/уровня, лимитом отдыха и конечной длительностью.', evidence.event);
record([888], 'Первый спасбросок смерти получает успешный исход, натуральная20 сохраняет восстановление1HP; последующие спасброски обычные. Уют — описание.', evidence.life);
record([897], 'На encounter_start current_hp устанавливается в ceil(current_hp/2) один раз; это потеря хитов, не типизированный урон.', evidence.event);
record([914,915], 'Каноничный грант заговора и +2 к урону указанного типа только из заклинания.', evidence.passive);
record([934], 'Дополнительный максимум ячеек2 уровня — ресурс; выбор внешнего вида заклинаний остаётся оформлением без изменения исхода.');
record([942,943,944,945,946,947], 'Каноничный armor_profile сохраняет формулу КД и прямо указанную помеху Скрытности.');
record([839,840,841,842,882,884,'RL-SHOP-0840','RL-SHOP-0841','RL-SHOP-0842'],
  'Существующие расход предмета/бонусного действия, формула лечения либо конечный эффект и его длительность сохранены; исполнение проходит общий движок.', evidence.passive);
for (const [n, skill] of [[708,'history'],[724,'insight'],[726,'religion']]) {
  const card = byNumber.get(number(n));
  patch(n, { requires_item_source: card.id, activation: { mode: 'triggered', while: 'carried', cost: [] },
    effects: [{ resolution: 'auto', result: [{ kind: 'roll_influence', operation: 'add_modifier', value: 5,
      timing: 'before_roll', eligible_rolls: ['check'], skill }] }] },
  `Отдельное влияние до выбранной проверки ${skill}: +5; доступно только владельцу книги, для других навыков скрыто. Решение и источник бонуса проходят общий диалог и исполнение.`, evidence.influence);
}
patch(757, withPayloads(757, [{ id: 'item-kill-healing', kind: 'triggered_effect', event: 'kill', subject: 'self',
  duration: { type: 'while_active' }, effects: [{ resolution: 'auto', who: 'self', result: [{ kind: 'healing', amount: '1d6' }] }] }]),
  'Окончательное уничтожение существа в бою запускает лечение1d6; падение персонажа до0 не считается убийством.', evidence.event);
patch(761, withPayloads(761, [modifier('ability_check','advantage',undefined,{skill:'perception',sense:'hearing'})]),
  'Преимущество ограничено Восприятием со слухом; визуальные проверки его не получают.');
patch(900, withPayloads(900, [modifier('d20','deny_advantage')], 'carried'),
  'Общий запрет преимущества отключает все его источники, сохраняя возможную помеху.', ['frontend/src/engine/itemCompletionRolls.test.ts']);
patch(715,withPayloads(715,[modifier('lift_capacity','multiply',4)],'carried'),
  'Предел подъёма/толкания/волочения рассчитывается от Силы и размера и умножается на4, пока блок и лебёдка доступны. Переносимый вес инвентаря не меняется.',
  ['frontend/src/engine/physicalCapacity.test.ts']);
const bearings=clone(byNumber.get(number(799)).mechanics);
bearings.activation={...bearings.activation,cost:[...(bearings.activation?.cost??[]),{resource:'self_item'}]};
patch(799,bearings,'Действие необратимо расходует один мешочек шариков и создаёт сохраняемую зону10×10фт. Существо, вошедшее в неё, совершает спасбросок Ловкости СЛ10 и при провале падает Ничком.',
  ['frontend/src/solo-combat/combatAreas.test.ts','frontend/src/engine/itemScatteredHazards.test.ts']);
const caltrops=clone(byNumber.get(number(790)).mechanics);
caltrops.activation={...caltrops.activation,cost:[...(caltrops.activation?.cost??[]),{resource:'self_item',amount:1}]};
patch(790,caltrops,'Рассыпание расходует один мешочек колючек и оставляет постоянную зону5×5фт. Вход запускает DEX15; провал наносит1колющего урона и даёт Скорость0 до следующего хода.',
  ['frontend/src/engine/itemScatteredHazards.test.ts','frontend/src/solo-combat/combatAreas.test.ts']);
missingDefinitions.set(number(790),['Сбор колючек за10минут остаётся ручным действием вне боя: текущая модель зон не связывает рассыпанные объекты с обратным переносом в инвентарь. Зона не удаляется автоматически.']);
const magnifier=byNumber.get(number(822));
patch(822,{requires_item_source:magnifier.id,activation:{mode:'triggered',while:'carried',cost:[]},effects:[{resolution:'auto',result:[
  {kind:'roll_influence',operation:'advantage',timing:'before_roll',eligible_rolls:['check']}
]}]},'Перед проверкой характеристики, в которой персонаж использует стекло для изучения мелких деталей, игрок может выбрать универсальное влияние «Преимущество». Оно не ограничено только Расследованием.',
  ['frontend/src/engine/itemMagnifierInfluence.test.ts']);
missingDefinitions.set(number(822),['Разжигание огня при ярком солнце остаётся ручным взаимодействием с окружением; источник не задаёт время или дальность для этого варианта.']);
const poisonWeaponTypes=[...new Set(cards.filter(card=>card.type==='weapon'&&card.mechanics?.weapon_profile?.attack_modes?.some(mode=>mode.kind==='melee'))
  .map(card=>card.mechanics.weapon_profile.weapon_type))].sort();
patch(832,{requires_item_source:byNumber.get(number(832)).id,activation:{mode:'active',while:'carried',cost:[{resource:'bonus_action'},{resource:'self_item',amount:1}]},
 effects:[{resolution:'auto',who:'self',result:[{kind:'choice',id:'poisoned-weapon',count:1,context:'in_play',prompt:'Выберите оружие для покрытия ядом',
  options:{source:'equipped_weapon',filter:poisonWeaponTypes},grant:{kind:'damage_rider',trigger:'hit_by_attack_roll',dice:'1d4',type:'poison',
   filter:{attackKind:'weapon'},value_into:'bound_weapon_id',target_save:{ability:'con',dc:10},requires_damage_dealt:true,consume:'next',duration:{type:'minutes',amount:1}}}]}]},
  'Бонусное действие расходует флакон и привязывает покрытие к одному выбранному экипированному оружию. Следующее попадание, нанёсшее урон до высыхания через1минуту, вызывает спасбросок ТЕЛ СЛ10; только провал наносит1к4 ядом.',
  ['frontend/src/engine/itemPoisonCoating.test.ts']);
missingDefinitions.set(number(832),['Покрытие до трёх отдельных боеприпасов пока не представлено в инвентаре как адресуемые экземпляры; это ограничение отдельно от полностью исполнимого покрытия одного оружия.']);
patch(932, withPayloads(932, [{ kind: 'life_policy', max_death_failures: 1, immediate_death_save: true }], 'carried'),
  'Преимущество сохранено; предел смерти1провал и дополнительный спасбросок при потере сознания исполняются через общий durable death-save flow.', evidence.life);
for (const [n, penalty] of [[956,-1],[958,-2]]) patch(n, withPayloads(n, [{ kind:'aura',radius_ft:5,recipients:'enemies',effects:[modifier('ac','add',penalty)] }]),
  `КД врагов в5фт изменяется на${penalty}; положение, сторона, выход из радиуса и удаление источника пересчитываются до каждой команды.`, evidence.aura);
patch(964, withPayloads(964, [{ kind: 'life_policy', remain_conscious_at_zero: true,
  on_damage_at_zero: [{ kind:'condition',op:'apply',value:'exhaustion' }],
  on_turn_start_at_zero: [{ kind:'condition',op:'apply',value:'exhaustion' }] }]),
  'При0HP сохраняются сознание, действия, движение и занятая клетка; обычные спасброски смерти остаются. Урон при уже0HP и начало хода дают степень истощения через общий condition executor.', evidence.life);
patch(966, { ...clone(byNumber.get(number(966)).mechanics ?? {}), uses: undefined,
  activation:{mode:'passive',while:'equipped'}, effects:[{resolution:'auto',result:[{kind:'triggered_effect',id:'item-turn-temporary-hp',event:'turn_start',subject:'self',
    duration:{type:'while_active'},effects:[{resolution:'auto',who:'self',result:[{kind:'temp_hp',amount:'1d4'}]}]}]}] },
  'Временные хиты1d4 выдаются автоматически на turn_start, не отдельной кнопкой; применяется общий выбор максимума текущих и новых временных хитов.', evidence.event);

for (const [n, amount] of [[959,1],[960,2]]) patch(n, withPayloads(n, [{kind:'reduce_damage',amount,
  filter:{source_actor:'self',source_kinds:['item','spell','ability']}}]),
  `Входящий урон от собственной способности, предмета или заклинания снижается на ${amount}; источник берётся из исполнения, чужой урон не затрагивается.`,
  ['frontend/src/character/itemDamageOrigin.test.ts','frontend/src/engine/itemExecutionCompletion.test.ts']);
patch(967, withPayloads(967, [modifier('damage_received','multiply',0.5,{source_actor:'self',source_kinds:['item','spell']})]),
  'Собственный предметный и заклинательный урон уменьшается вдвое с округлением вниз; способности и чужие источники остаются без изменения.',
  ['frontend/src/character/itemDamageOrigin.test.ts','frontend/src/engine/itemExecutionCompletion.test.ts']);
patch(957, withPayloads(957, [{kind:'action_target_limit',spell_level:0,add:1}]),
  'Максимум целей заговора увеличивается на одну в каноничном сборщике и проверке команды; обычные заклинания не изменяются.',
  ['frontend/src/engine/itemExecutionCapabilities.test.ts']);
const storm = clone(byNumber.get(number(769)).mechanics);
storm.effects = [{resolution:'auto',result:[{kind:'condition_immunity',condition:'blinded'},{kind:'condition_immunity',condition:'deafened'}]}];
patch(769, storm, 'Иммунитеты используют каноничные состояния по ссылкам описания: Ослеплённый и Оглохший. Ссылка второго состояния разрешается в deafened, несмотря на старую подпись «Оглушены».', ['frontend/src/engine/itemCatalogAudit.test.ts']);
for (const n of [854,855,862,863,864,866]) {
  const mechanics = clone(changes.get(number(n))?.mechanics ?? byNumber.get(number(n)).mechanics);
  mechanics.weapon_profile.enchantment.attack_bonus = 2;
  mechanics.weapon_profile.enchantment.damage_bonus = 2;
  changes.set(number(n),{mechanics});
}
const reachSword = changes.get(number(864)).mechanics;
reachSword.weapon_profile.properties.push('reach');
reachSword.weapon_profile.attack_modes[0].reach_ft = 10;
record(864,'Зачарование +2 и досягаемость 10 футов применяются каноничным профилем оружия. Свободное изменение длины — описание реализации досягаемости, отдельной стоимости не требует.');
changes.set(number(983),{mechanics:withPayloads(983,[{kind:'grant_spell',value:'SPELL-0214',label:'cantrip',
  casting_override:{spell_level:0,remove_cost_resources:['spell_slot'],replace_cost_resources:{action:'bonus_action'}}}])});
record(983,'Грант каноничного Лечения ран имеет собственный уровень0 и стоимость bonus_action без ячейки. Заклинательная характеристика наследуется от владельца; без неё используется фиксированный модификатор0. Базовая карточка заклинания и обычные способы применения сохраняются.', ['frontend/src/character/itemSpellGrants.test.ts']);
record(920,'Сообщение предоставлено как каноничный заговор с одним использованием до долгого отдыха. Ограниченные гранты заговоров расходуют отдельный пул; переодевание и перезагрузка его не восстанавливают.', ['frontend/src/character/itemSpellGrants.test.ts']);
record([950,951,952],'Влияние выбирается до броска: две штрафные кости указанного размера входят в единый бросок, попадание становится критическим, промах остаётся промахом.', ['frontend/src/engine/itemRollInfluences.test.ts']);
record(811,'Бонусное действие и один флакон расходуются атомарно; преимущество действует один час только на спасброски, избегающие состояния Отравленный.');
record(885,'Расход зелья даёт три дыхания, отдельное действие с дальностью30ft и DEX13/4d6fire/половина; эффект заканчивается через час или после третьего дыхания. Заряды сохраняются между загрузками.', ['frontend/src/character/itemResourceCapacity.test.ts','frontend/src/character/effectGrantedActions.test.ts']);
record([728,749,785,786,787],'Боеприпас указан каноничной ссылкой в weapon_profile подходящего оружия. Каждая дальнобойная атака проверяет и списывает единицу из инвентаря.', ['frontend/src/engine/weaponProfile.test.ts']);
record([700,705,707,710,740,797,798,809,810,817,843,844,845,846,848,849,901,916,931,933,976,979],
  'Описание задаёт назначение, внешний вид или физические свойства предмета; не задаёт изменения броска, состояния, ресурса или боевого исхода. Текст и инвентарная сущность сохраняются.', [], 'narrative');
for (const n of [703,792,808,831,847]) {
  changes.set(number(n),{mechanics:null});
  record(n,'Удалено прежнее неподтверждённое правило, отсутствующее в описании (защита от холода, дальность звука или бонус к проверке). Сохранено описанное бытовое назначение предмета.', [], 'narrative');
}
record([701,802,804,805,806,807], 'Каноничная распаковка контейнера выдаёт именно перечисленные предметы и количества; выбор набора разрешён только из его contents и тратит исходный контейнер.', ['frontend/src/character/actionSheetContainer.test.ts']);
const toolBag = byNumber.get(number(747));
changes.set(number(747),{contents:toolBag.contents.filter(entry=>entry.card_id!==toolBag.id)});
record(747,'Выбор ремесленного инструмента использует каноничный container_mode:choice; из contents удалена ошибочная ссылка мешка на себя.', ['frontend/src/character/actionSheetContainer.test.ts']);
const lineId='7885f62d-835f-5e5f-8b44-fbf8d4efc39f';
const lineCard = {id:lineId,card_number:'CARD-FISH-LINE-10FT',name:'Леска, 10 футов',description:'Леска длиной 10 футов из набора взломщика.',detailed_description:null,
  type:'item',rarity:'common',author:'System',source:'Catalog completion 2026-09-29',weight:null,price:null,mechanics:null,requires_attunement:false};
related.push({entity_type:'card',id:lineId,card_number:lineCard.card_number,name:lineCard.name,
  description_sha256:createHash('sha256').update(JSON.stringify([lineCard.description,null])).digest('hex'),preimage:null,patch:lineCard,
  review:{status:'not_verified',summary:'Точный компонент набора взломщика: 10ft вместо карточки50ft.',implemented:['Длина и отдельная каноничная инвентарная сущность.'],tested:[],limitations:[],evidence:['frontend/src/character/actionSheetContainer.test.ts']}});
const pack803=byNumber.get(number(803)),longLine=byNumber.get(number(797));
changes.set(number(803),{contents:pack803.contents.map(entry=>entry.card_id===longLine.id?{...entry,card_id:lineId}:entry)});
record(803,'Распаковка выдаёт точный состав, включая новую каноничную карточку10ft лески; прежняя50ft карточка не выдаётся.', ['frontend/src/character/actionSheetContainer.test.ts']);

function missing(n, details, implemented='Существующие числовые профили и определённые правила сохранены; неопределённым параметрам не назначены выдуманные значения.') {
  record(n,implemented,[]);missingDefinitions.set(number(n),[].concat(details));
}
for (const n of [961,962,965,968,970,971,972,973,974]) missing(n,
  'В свежем каталоге переменных, концептов, черт, эффектов, действий и заклинаний отсутствуют определение 🌢 и правило Жатвы (размер кости/стоимость/момент оплаты). Без этого нельзя вычислить цену или исход указанного применения.');
const bloodRapier=clone(byNumber.get(number(972)).mechanics);bloodRapier.weapon_profile.enchantment.attack_bonus=1;bloodRapier.weapon_profile.enchantment.damage_bonus=1;
changes.set(number(972),{mechanics:bloodRapier});
missing(917,'Текст не задаёт частоту «иногда», пул негативных эффектов и распределение вероятностей. Случайные состояния без этих данных не применяются.');
missing(748,'Описание обрывается на «преуспев в проверке»: не указаны характеристика, СЛ, требования к цели и точное состояние/условия освобождения.');
changes.set(number(748),{mechanics:null});
missing(850,'Состояние Синегниль и его правила отсутствуют во всех справочниках snapshot; описанием не задано число необходимых вечеров курса. Известны только6доз и приём вечером.');
missing(779,'Текст требует урона самому себе при промахе, но не задаёт его величину и тип. Базовый профиль меча +3 сохранён.');
missing(865,'Для непроходимой области не заданы размер, форма, размещение, длительность и стоимость создания. Превращение критического попадания в обычное может исполняться независимо.');
missing(868,'Для повторных применений не задана вероятность попадания в Астрал; текст определяет только гарантированно безопасное первое применение за день.');
missing(969,'Не задан тариф оплачиваемой связи (сумма, валюта, период списания); в каталоге нет определения Бладена как сцены и реестра знакомства владельца.');
missing(984,'В actions/effects/spells/feats snapshot отсутствуют определения «Подчинение существа», «Впитывание силы», «Поднятие нежити» и ссылки на них; нельзя исполнить или посчитать применение неизвестных способностей. Известное правило невозможности умереть при удержании реализовано отдельно.');
changes.set(number(984),{mechanics:withPayloads(984,[{kind:'life_policy',cannot_die:true,requires_held_item:byNumber.get(number(984)).id}])});
for (const n of [712,732,733,734,735,736,737,738,739,741,742,743,744,745,746]) missing(n,
  'Указан перечень возможных изделий, но отсутствуют рецепты: входные материалы/количества, время изготовления, стоимость и требования к проверке. Предмет не создаёт изделия бесплатно по одному нажатию.',
  'Перечень изделий сохранён в описании инструмента; доступная из текста информация о назначении инструмента не заменена случайными бонусами.');

for (const [n, profile] of [[704,{max_weight_lb:6,max_volume_cubic_ft:0.2}],[716,{max_liquid_oz:5120,max_volume_cubic_ft:4}],
  [718,{max_liquid_oz:64}],[719,{max_volume_cubic_ft:0.5}],[721,{max_liquid_oz:128}],[788,{max_liquid_oz:24}],
  [794,{max_weight_lb:40,max_volume_cubic_ft:2}],[796,{max_liquid_oz:128}],[800,{max_weight_lb:30,max_volume_cubic_ft:1}],
  [813,{max_weight_lb:30,max_volume_cubic_ft:1}],[818,{max_weight_lb:300,max_volume_cubic_ft:12}],[824,{max_liquid_oz:4}],[825,{max_liquid_oz:16}],
  [729,{max_units:20,item_units:{'CARD-0728':1}}],[828,{max_units:20,item_units:{'CARD-0749':1}}],
  [821,{max_units:10,item_units:{'CARD-0717':1,'CARD-0709':2}}]]) {
  changes.set(number(n),{type:'container',mechanics:{activation:{mode:'passive',while:'carried'},storage_profile:profile}});
  record(n,'Вместимость задаётся storage_profile и проверяется до изменения инвентаря. Штучные контейнеры принимают только указанные типы; смешанный тубус считает пергамент за2листа бумаги. Неизвестные размеры не считаются нулевыми.', ['frontend/src/character/containerCapacity.test.ts']);
  if (!profile.max_units) missingDefinitions.set(number(n),['В исходном каталоге большинства вкладываемых предметов не задан внешний объём (physical_profile.volume_cubic_ft) или объём жидкости (physical_profile.liquid_oz). Перемещение с неизвестной необходимой мерой отклоняется с точным сообщением; значения должны быть заданы данными предметов.']);
}
patch(852,withPayloads(852,[{kind:'grant_spell',value:'SPELL-0255',label:'known',freeuse:{count:1,recharge:'long_rest'}}]),
  'Палящий луч предоставлен ссылкой на каноничное заклинание; отдельный бесплатный расход восстанавливается только долгим отдыхом.', ['frontend/src/character/itemSpellGrants.test.ts']);
patch(763,withPayloads(763,[{kind:'grant_spell',value:'SPELL-0205',label:'cantrip'}]),
  'Язвительная насмешка разрешена в каноничную карточку «Злая насмешка»/Vicious Mockery и предоставлена как заговор без ограничения применений.', ['frontend/src/character/itemSpellGrants.test.ts']);
patch(924,withPayloads(924,[modifier('prof_bonus','add',-1)],'carried'),
  'Бонус мастерства снижается на1 в общей проекции характеристик: изменение используется проверками, атаками, спасбросками и формулами БМ.');
patch(978,withPayloads(978,[{kind:'movement_policy',forced_movement:'immune'},{kind:'equipment_policy',cannot_be_disarmed:true}]),
  'Авторитетные проверки блокируют внешнее перемещение/телепортацию и обезоруживание; добровольное перемещение остаётся доступным.', ['frontend/src/engine/itemDefensePolicies.test.ts']);
const trig = (n,event,effects,extra={}) => ({kind:'triggered_effect',id:`item-completion:${number(n)}:${event}`,event,subject:'self',duration:{type:'while_active'},effects,...extra});
patch(913,withPayloads(913,[trig(913,'damage_dealt',[{resolution:'auto',who:'self',result:[{kind:'damage',amount:'1d6',type:'psychic'}]}])],'carried'),
  'После окончательного нанесённого урона владелец получает1d6психического урона; это предметный урон, поэтому проходит обычные сопротивления и собственные защитные правила.', evidence.event);
changes.set(number(758),{mechanics:withPayloads(758,['lightning','thunder'].map(type=>trig(758,`damage_dealt`,[{resolution:'auto',result:[
  {kind:'area_damage',amount:2,type,radius_ft:5,recipients:'all',origin:'target',include_center:true}]}],{
  id:`item-completion:758:${type}`,circumstances:[{kind:'event_data_equals',key:'damageType',value:type},{kind:'event_data_equals',key:'secondary_source',value:false}]})))});
changes.set(number(863),{mechanics:withPayloads(863,[trig(863,'attack_roll_made',[{resolution:'auto',result:[{kind:'area_damage',amount:'1d6',type:'bludgeoning',radius_ft:5,recipients:'all',origin:'self',include_center:true}]}],{
  circumstances:[{kind:'event_data_equals',key:'hit',value:false}]})])});
for (const [n,resource] of [[907,'reaction'],[908,'bonus_action']]) changes.set(number(n),{mechanics:withPayloads(n,[trig(n,'resource_spent',[
  {resolution:'auto',result:[{kind:'cancel_execution'}]}],{occurrence:{every:2,per:'lifetime'},circumstances:[{kind:'event_data_equals',key:'resource',value:resource}]})],'carried')});
patch(923,{activation:{mode:'active',while:'carried',cost:[{resource:'action'},{resource:'self_uses'}]},uses:{count:3,per:'never'},
  effects:[{resolution:'auto',who:'self',result:[{kind:'modifier',op:'advantage',applies_to:{roll:'ability_check',filter:{skill:'athletics'}},duration:{type:'until_removed'},consume:'next'}]}]},
  'Действие расходует одну из3невозобновляемых бусин; преимущество действует на следующую проверку Атлетики и снимается после неё, не после любого броска.', ['frontend/src/engine/itemRollInfluences.test.ts','frontend/src/engine/itemTemporaryActions.test.ts']);

function relatedAction(n,suffix,mechanics,label,temporary=false) {
  const owner=byNumber.get(number(n)),ref=n==='CARD-B24-BULLSEYE'&&suffix==='extinguish'
    ? 'ACT-item-high-b24-bullseye-out' : `ACT-item-completion-high-${n}-${suffix}`;
  const hash=createHash('sha256').update(ref).digest('hex');
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const entity={id,card_number:ref,name:`${owner.name} — ${label}`,description:owner.description,detailed_description:null,
    rarity:owner.rarity??'common',type:'other',action_type:'base_action',resource:mechanics.activation?.cost?.find(row=>['action','bonus_action','reaction'].includes(row.resource))?.resource??'action',author:'System',source:'Catalog completion 2026-09-29',
    mechanics:{...mechanics,...(!mechanics.targeting?{targeting:{domain:'world',shape:'single',actor_targets:false,min_targets:0,max_targets:0,range_ft:0,requires_line_of_sight:false,allowed_relations:[]}}:{}),damage_source_kind:'item',...temporary?{requires_runtime_action_grant:[ref]}:{requires_item_source:owner.id}},deleted_at:null};
  related.push({entity_type:'action',id,card_number:ref,name:entity.name,description_sha256:createHash('sha256').update(JSON.stringify([entity.description,null])).digest('hex'),preimage:null,patch:entity,
    review:{status:'not_verified',summary:`Каноничное предметное действие: ${label}.`,implemented:[],tested:[],limitations:[],evidence:[]}});
  return {kind:'grant_action',value:ref};
}
function relatedEffect(n,suffix,payloads,label){
  const owner=byNumber.get(number(n)),ref=`EFFECT-item-completion-high-${n}-${suffix}`;
  const hash=createHash('sha256').update(ref).digest('hex');
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const entity={id,card_number:ref,name:`${owner.name} — ${label}`,description:owner.description,detailed_description:null,
    rarity:owner.rarity??'common',effect_type:'item_effect',author:'System',source:'Catalog completion 2026-09-29',
    mechanics:{activation:{mode:'passive'},duration:{type:'until_removed'},effects:[{resolution:'auto',result:payloads}]},deleted_at:null};
  related.push({entity_type:'effect',id,card_number:ref,name:entity.name,description_sha256:createHash('sha256').update(JSON.stringify([entity.description,null])).digest('hex'),preimage:null,patch:entity,
    review:{status:'not_verified',summary:`Эффект предмета: ${label}.`,implemented:[],tested:[],limitations:[],evidence:[]}});
  return {kind:'grant_effect',value:ref};
}
	const swordTeleportResource='item_completion_889_teleport';
	const swordTeleportItem=byNumber.get(number(889));
	const swordTeleportGrant=relatedAction(889,'hit-teleport',{
	  activation:{mode:'reaction',trigger:{event:'hit',timing:'after',subject:'self',
	    circumstances:[{kind:'event_data_equals',key:'weaponId',value:swordTeleportItem.id}]},
	    cost:[{resource:swordTeleportResource,amount:1}]},
	  targeting:{domain:'actor',shape:'single',actor_targets:true,min_targets:1,max_targets:1,range_ft:10,
	    requires_line_of_sight:true,allowed_relations:['ally','enemy','neutral']},
	  teleport_destination:{relative_to:'target',max_distance_ft:10,requires_visible:true},
	  effects:[{resolution:'auto',who:'target',result:[{kind:'movement',value:'teleport',distance:10}]}],
	},'Телепортировать поражённую цель');
	patch(889,{...clone(swordTeleportItem.mechanics),activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[
	  {kind:'resource',op:'grant',id:swordTeleportResource,amount:3,recharge:'short_rest'},swordTeleportGrant
	]}]},'После окончательно подтверждённого попадания именно этим оружием предлагается выбор: оставить цель на месте или потратить один из трёх зарядов до короткого отдыха. При выборе свободной видимой клетки не дальше10фт от цели каноничное движение переносит цель, а не атакующего; заряд и перенос сохраняются вместе.',
	  ['frontend/src/rules-core/itemHitTargetTeleport.test.ts','frontend/src/solo-combat/itemHitTargetTeleport.integration.test.ts']);
	const caduceus=byNumber.get(number(937)),caduceusBondGroup='item-completion:937:vitality';
	const caduceusEffect=relatedEffect(937,'vitality',[modifier('max_hp','add',10)],'Жизненная сила');
	const caduceusEffectRow=related.find(row=>row.card_number===caduceusEffect.value);
	caduceusEffectRow.patch.mechanics.max_hp_delta=10;
	caduceusEffectRow.patch.mechanics.bond_policy={group:caduceusBondGroup,source_item_id:caduceus.id};
	const blessCaduceus=relatedAction(937,'bless-six',{
	  activation:{mode:'active',cost:[]},beneficiary_policy:{group:caduceusBondGroup,max_targets:6},
	  targeting:{domain:'actor',shape:'single',actor_targets:true,min_targets:1,max_targets:6,range_ft:100000,
	    requires_line_of_sight:false,allowed_relations:['ally','enemy','neutral']},
	  effects:[{resolution:'auto',who:'target',result:[caduceusEffect]}],
	},'Благословить до шести существ');
	const breakCaduceus=relatedAction(937,'break-resurrect',{
	  activation:{mode:'active',cost:[{resource:'action',amount:1},{resource:'item',card_id:caduceus.id,amount:1,bound_self_item:true}]},
	  resurrection_policy:{max_dead_days:365,restore_full_hp:true},
	  targeting:{domain:'actor',shape:'single',actor_targets:true,min_targets:1,max_targets:1,range_ft:5,
	    requires_line_of_sight:true,allowed_relations:['ally','enemy','neutral']},effects:[],
	},'Сломать посох и воскресить существо');
	patch(937,{...clone(caduceus.mechanics),activation:{mode:'passive',while:'attuned'},effects:[{resolution:'auto',result:[
	  modifier('max_hp','add',10),modifier('healing','multiply',2),blessCaduceus,breakCaduceus
	]}]},'Настроенный владелец получает +10 к максимуму хитов и удваивает исходящее исцеление. Отдельное действие выбирает до шести других существ; +10 сохраняется на каждой цели и автоматически снимается при утрате источника или настройки. Разрушение посоха после подтверждения давности/причины смерти, типа существа и согласия свободной души атомарно расходует предмет и возвращает умершую цель с полными хитами.',
	  ['frontend/src/rules-core/itemCaduceus.integration.test.ts']);
	missingDefinitions.set(number(937),['Давность смерти и свобода/согласие души не выводятся из боевого состояния: сценарий или ведущий должны передать подтверждённые факты. Пассивное +10 владельца проходит через стандартный расчёт максимум хитов листа; назначение шести других существ выполняется явным выбором.']);
patch(795,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[relatedAction(795,'anchor',{
  activation:{mode:'active',cost:[]},primitive:{type:'item_tool',policy:{operation:'anchor',max_load_lb:500}},
  targeting:{domain:'world',shape:'single',actor_targets:false,min_targets:0,max_targets:0,range_ft:5,requires_line_of_sight:true,allowed_relations:[]},
  effects:[{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}]
},'Закрепить крюк')]}]},
  'Крюк закрепляется на выбранном объекте каноничным item_tool.anchor; объект хранит предел500фунтов. При известной нагрузке действие отклоняет превышение до изменения мира.',
  ['frontend/src/rules-core/itemToolLoadLimits.test.ts']);
missingDefinitions.set(number(795),['Описание не задаёт дальность броска, проверку закрепления и её СЛ; доступно закрепление соседнего объекта без выдуманного броска. Нагрузка проверяется, когда сценарий или поле передаёт её авторитетное значение.']);
const hornId=byNumber.get(number(922)).id,hornEarStack='item-completion:922:ear';
patch(922,{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[
  relatedAction(922,'raise',{requires_held_item:hornId,activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'self',result:[
    {kind:'condition_immunity',condition:'deafened',duration:{type:'manual'},stack_id:hornEarStack,stack_type:'overwrite',
     suppress_existing:true,requires_equipped_item_id:hornId}
  ]}]},'Поднести к уху'),
  relatedAction(922,'lower',{requires_held_item:hornId,activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'self',result:[
    {kind:'remove_effect',stack_id:hornEarStack}
  ]}]},'Опустить от уха')
]}]},'Поднесённый к уху удерживаемый рог временно подавляет уже действующее состояние Оглохший, не удаляя его источник и длительность, и не допускает новых наложений. Опускание или утрата рога возвращает действие исходного состояния.',
  ['frontend/src/engine/itemHearingHorn.test.ts']);
patch(918,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[relatedAction(918,'accept-scar',{
  activation:{mode:'active',cost:[{resource:'self_item',amount:1}]},effects:[{resolution:'auto',who:'self',result:[
    {kind:'modifier',op:'add',value:'-3d6',value_timing:'on_apply',applies_to:{roll:'max_hp'},duration:{type:'manual'}}
  ]}]
},'Принять шрам')]}]},
  'Принятие жертвы расходует её карточку, один раз бросает3к6 и сохраняет конкретный отрицательный модификатор максимума хитов. Текущее здоровье ограничивается новым максимумом; повтор расхода невозможен.',
  ['frontend/src/engine/itemSacrificeScar.test.ts']);
missingDefinitions.set(number(918),['Применение жертвы требует явного выбора игрока «Принять шрам»: получение карточки само по себе не запускает необратимый бросок.']);
const singleTarget={shape:'single',domain:'actor',range_ft:600,min_targets:1,max_targets:1,actor_targets:true,allowed_relations:['ally','enemy','neutral'],requires_line_of_sight:true};
const reactionActivation=(event,circumstances=[])=>({mode:'reaction',cost:[{resource:'reaction'}],optional:true,trigger:{event,subject:'self',timing:'after',circumstances}});
patch(948,withPayloads(948,[relatedAction(948,'gamble-damage',{
  activation:{mode:'reaction',cost:[{resource:'reaction'}],optional:true,trigger:{event:'damage_taken',subject:'self',timing:'before'}},
  effects:[{resolution:'auto',who:'self',result:[{kind:'chance',chance:{die:4,equals:[1,2]},
    on_success:[{kind:'incoming_damage_multiplier',factor:0}],on_fail:[{kind:'incoming_damage_multiplier',factor:2}]}]}]
},'Бросить кость алчности')]),
  'Перед входящим уроном реакция бросает один к4: на1–2 весь пакет урона становится нулём, на3–4 удваивается до сопротивлений. Исход и расход реакции сохраняются в том же решении.',
  ['frontend/src/rules-core/damageReaction.integration.test.ts']);
changes.set(number(768),{mechanics:withPayloads(768,[relatedAction(768,'retaliate-fire',{
  activation:reactionActivation('attacked'),targeting:singleTarget,effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:'1d6',type:'fire'}]}]},'Огненный ответ')])});
changes.set(number(773),{mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[relatedAction(773,'lightning',{
  activation:reactionActivation('damage_dealt',[{kind:'event_data_equals',key:'attackRange',value:'melee'},{kind:'event_data_equals',key:'secondary_source',value:false}]),targeting:singleTarget,
  effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:'1d4',type:'lightning'}]}]},'Добавить молнию')]}]}});
changes.set(number(767),{mechanics:withPayloads(767,['main','off'].flatMap(hand=>['melee','ranged'].map(mode=>relatedAction(767,`counter-${hand}-${mode}`,{
  activation:{...reactionActivation('attacked',[{kind:'event_data_equals',key:'critical',value:true}]),cost:[{resource:'reaction'},...(mode==='ranged'?[{resource:'equipped_weapon_ammo',amount:1}]:[])]},
  primitive:{type:'weapon_attack'},targeting:singleTarget,effects:[{resolution:'attack_roll',ability:'auto',attack_kind:`weapon_${mode}`,vs:'ac',
    ...(hand==='off'?{tags:['off_hand']}:{}),on_hit:[{kind:'damage',dice:'weapon',type:'weapon',ability:'auto'}]}]},`${mode==='melee'?'Ответ оружием вблизи':'Дальнобойный ответ'} — ${hand==='main'?'основная':'вторая'} рука`))))});
patch(893,withPayloads(893,[{kind:'choice',id:'weakened-abilities',prompt:'Выберите две ослабленные характеристики',count:2,context:'in_play',options:{source:'ability',items:['str','dex','con','int','wis','cha'].map(id=>({id,name:({str:'Сила',dex:'Ловкость',con:'Телосложение',int:'Интеллект',wis:'Мудрость',cha:'Харизма'})[id],grants:[{kind:'value_method',target:id,formula:6,mode:'set'}]}))}}],'carried'),
  'Две характеристики выбираются общим предметным выбором. Значения устанавливаются в6, выбор сохраняется в turn_state и повторно проверяется по объявленным вариантам.', ['frontend/src/character/itemChoices.test.ts','frontend/src/engine/itemDefensePolicies.test.ts']);
record('CARD-B24-MORNINGSTAR','Каноничный профиль: воинское рукопашное оружие,1d8колющего,STR,мастерствоОслабляющее. Ссылка мастерства разрешается общим каталогом.', ['frontend/src/engine/weaponProfile.test.ts']);
record(955,'КД каждого участника уже показывается каноничным боевым представлением и превью; дополнительный расчёт или изменение КД не требуется.', []);
for (const n of [791,815]) missing(n,'Описание задаёт спасбросок, но не задаёт формулу урона; существующая формула сохранена как неподтверждённая, она не считается доказанной текстом.',
  'Стоимость предмета/действия,DEXиСЛ8+ЛВК+БМ сохранены; у святой воды проверяется тип цели Исчадие/Нежить. Неопределённая формула отдельно отмечена.');
record([758,863],'Общий area_damage выбирает существ из текущей карты вокруг цели/владельца, бросает общую кость один раз и проводит каждого через сопротивления и реакции. Вторичный урон не зацикливает триггер.', ['frontend/src/rules-core/itemEventReactions.integration.test.ts']);
record([907,908],'Каждый второй оплаченный ресурс соответствующего вида отменяет исполнение после расхода. Счётчик lifetime сохраняется и применяется также к заранее оплачиваемым атакам и реакциям.', ['frontend/src/rules-core/itemEventReactions.integration.test.ts']);
record([767,768,773],'После окончательного события появляется необязательная каноничная реакция. Очередь, владелец, цель и бросок сохраняются; стоимость и предмет повторно проверяются. Шлем ответа использует текущее оружие каждой руки и его боеприпасы.', ['frontend/src/rules-core/itemEventReactions.integration.test.ts']);
for (const entry of related.filter(row=>row.entity_type==='action'&&/high-(767|768|773)-/.test(row.card_number))) entry.review={status:'not_verified',summary:'Каноничная реакция после предметного события.',implemented:['Текущая цель события, предмет, стоимость, необязательный выбор и сохранённое продолжение.'],tested:['Две независимые сущности; reload/replay; порядок владельцев; обычная защита и ответ оружием.'],limitations:[],evidence:['frontend/src/rules-core/itemEventReactions.integration.test.ts']};
patch(929,withPayloads(929,[{kind:'rest_policy',rests:['short','long'],failure_chance:{die:2,equals:[1]}}],'carried'),
  '50% отказа проверяются только на подтверждённом отдыхе. Время и длительности проходят, но лечение, восстановление ресурсов и выборы отдыха не применяются. Результат и журнал сохраняются одной командой, повтор использует тот же receipt.', ['frontend/src/engine/itemRestPolicies.test.ts','frontend/src/roguelike/campRest.test.ts']);
changes.set(number(862),{mechanics:withPayloads(862,[{kind:'weapon_attack_policy',weapon_id:byNumber.get(number(862)).id,separate_d20_modes:['advantage','disadvantage']},relatedAction(862,'second-arrow',{
  activation:{mode:'triggered',optional:true,cost:[{resource:'equipped_weapon_ammo',amount:1}],trigger:{event:'attack_dice_followup',subject:'self',timing:'after',circumstances:[{kind:'event_data_equals',key:'weaponId',value:byNumber.get(number(862)).id}]}},
  primitive:{type:'weapon_attack'},targeting:singleTarget,effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_ranged',attack_dice_child:true,vs:'ac',on_hit:[{kind:'damage',dice:'weapon',type:'weapon',ability:'auto'}]}]},'Вторая стрела')])});
for (const [n,bright,dim,duration] of [[713,15,30],[722,30,30],[814,0,5,600],[823,20,20,600],['CARD-B24-BULLSEYE',60,60]]) {
  const owner=byNumber.get(number(n));
  const cone=typeof n==='string';
  const policy={item_card_id:owner.id,bright_radius_ft:bright,dim_additional_radius_ft:dim,...(duration?{duration_rounds:duration,consumes_source:true}:{requires_fuel_card_id:byNumber.get(number(723)).id}),...(cone?{shape:'cone',facing:'n'}:{})};
  const grants=[relatedAction(n,'light',{activation:{mode:'active',cost:[{resource:'action',amount:1},...(duration?[{resource:'item',card_id:owner.id,amount:1,bound_self_item:true}]:[])]},primitive:{type:'item_light',policy},effects:[]},'Зажечь'),
    relatedAction(n,'extinguish',{activation:{mode:'active',cost:[{resource:'action',amount:1}]},primitive:{type:'item_light',policy:{...policy,mode:'extinguish'}},effects:[]},'Погасить')];
  if(cone) for(const [facing,label]of[['n','север'],['ne','северо-восток'],['e','восток'],['se','юго-восток'],['s','юг'],['sw','юго-запад'],['w','запад'],['nw','северо-запад']]) grants.push(relatedAction(n,`aim-${facing}`,{
    activation:{mode:'active',cost:[]},primitive:{type:'item_light',policy:{...policy,mode:'aim',facing}},effects:[]},`Направить на ${label}`));
  const lightActions=grants.map(grant=>related.find(entry=>entry.card_number===grant.value));
  for(const entry of lightActions)entry.patch.mechanics.primitive.policy.granted_action_refs=lightActions.map(row=>row.id);
  changes.set(number(n),{mechanics:{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:grants}]}});
  record(n,'Освещение принадлежит сохраняемому объекту предмета и реально изменяет видимость карты. Радиусы/конус и длительность берутся из текста, затухание и направление переживают загрузку.', ['frontend/src/rules-core/itemLight.integration.test.ts']);
  if(!duration)missingDefinitions.set(number(n),['Текст требует масло, но не задаёт объём расхода и время горения одной заправки. Радиусы и направление работают, списание неизвестной величины топлива не выдумывается.']);
}
patch(899,withPayloads(899,[{...modifier('healing_received','deny'),when:[{kind:'in_encounter'}]}],'carried'),
  'Восстановление хитов блокируется только в текущем бою; временные хиты и лечение после окончательного завершения боя не затрагиваются. Признак боя принадлежит каноничному жизненному циклу и сохраняется.', ['frontend/src/engine/itemEncounterRestrictions.test.ts']);
patch(911,withPayloads(911,[{...modifier('attack','deny_critical'),when:[{kind:'in_encounter'}]}],'carried'),
  'В бою критический исход становится обычным попаданием; за пределами боя обычные правила критического попадания сохранены.', ['frontend/src/engine/itemEncounterRestrictions.test.ts']);
patch(912,withPayloads(912,[trig(912,'encounter_start',[{resolution:'auto',who:'self',result:['movement','action','bonus_action','reaction'].map(roll=>({...modifier(roll,'deny',1),duration:{type:'until_end_of_turn'}}))}])],'carried'),
  'В начале каждого боя движение, действия и реакции заблокированы до конца первого собственного хода. Завершение хода снимает ограничения, следующие ходы обычные.', ['frontend/src/engine/itemEncounterRestrictions.test.ts']);
record(862,'Преимущество/помеха заменены двумя обычными атаками, каждая расходует свою стрелу и проходит обычные окна защиты. Второй выстрел предложен каноничным действием и не повторно порождает себя.', ['frontend/src/rules-core/itemEventReactions.integration.test.ts']);
const hasteRef='EFFECT-item-completion-high-883-haste',hasteId='a886aa58-5b68-57a8-af8b-86b830815bc0';
const lethargyDuration={type:'until_end_of_source_next_turn'};
const hasteMechanics={activation:{mode:'passive'},duration:{type:'rounds',amount:3},damage_source_kind:'item',effects:[{resolution:'auto',result:[
  modifier('ac','add',2),modifier('saving_throw','advantage',undefined,{ability:'dex'}),modifier('speed','multiply',2),
  {kind:'resource',op:'grant',id:'haste_action',amount:1,recharge:'turn'},
  {kind:'action_cost_policy',id:'item-completion:haste',optional:true,match:{action_categories:['attack','dash','disengage','hide','utilize']},replace:{action:'haste_action'},max_attacks:1},
]}],on_end:{effects:[{resolution:'auto',who:'self',result:[{kind:'condition',value:'incapacitated',op:'apply',duration:lethargyDuration},
  {...modifier('speed','set',0),duration:lethargyDuration}]}]}};
const hasteEffect={id:hasteId,card_number:hasteRef,name:'Ускорение зелья',description:'На3хода: КД+2,преимущество спасбросков Ловкости,удвоенная скорость и дополнительное действие: одна атака,Рывок,Отход,Засада или Использование. После окончания — Недееспособность и Скорость0 до конца следующего хода.',detailed_description:null,rarity:'rare',type:null,effect_type:'item_effect',repeatable:false,author:'System',source:'Catalog completion 2026-09-29',mechanics:hasteMechanics,deleted_at:null};
related.push({entity_type:'effect',id:hasteId,card_number:hasteRef,name:hasteEffect.name,description_sha256:createHash('sha256').update(JSON.stringify([hasteEffect.description,null])).digest('hex'),preimage:null,patch:hasteEffect,
  review:{status:'not_verified',summary:'Полный временный эффект зелья с дополнительным ограниченным действием и последствиями окончания.',implemented:['Временный ресурс, пять категорий действия, максимумоднаатака, конечнаядлительность, Летаргия.'],tested:[],limitations:[],evidence:['frontend/src/engine/itemEffectLifecycle.test.ts','frontend/src/rules-core/restrictedAdditionalActions.test.ts']}});
patch(883,{activation:{mode:'active',while:'carried',cost:[{resource:'bonus_action',amount:1},{resource:'self_item',amount:1}]},effects:[{resolution:'auto',who:'self',result:[{kind:'grant_effect',value:hasteRef,bind_action_context:true}]}]},
  'Зелье выдаёт эффект Ускорения на3хода: КД+2,двойнаяскорость,DEXпреимущество, ограниченное дополнительное действие. Истечение или снятие вызывает Летаргию до конца следующего собственного хода.', ['frontend/src/engine/itemEffectLifecycle.test.ts','frontend/src/rules-core/restrictedAdditionalActions.test.ts']);

patch(963,{...clone(byNumber.get(number(963)).mechanics),requires_item_source:byNumber.get(number(963)).id,
  activation:{mode:'triggered',while:'equipped',cost:[]},effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_kept_d20',timing:'after_roll_before_outcome',eligible_rolls:['attack'],eligible_outcomes:['miss'],self_damage:{amount:2,type:'force'}}]}]},
  'Перед объявлением промаха предлагается перебросить атаку за 2 урона силой. Урон проходит сопротивления и сохранённый спасбросок концентрации; при повторе команды не наносится повторно.', ['frontend/src/solo-combat/d20Interrupt.integration.test.ts']);
for(const n of [949,953])patch(n,withPayloads(n,[modifier('damage_received','multiply',0,{attack_total_equals_ac:true})]),
  'Если окончательный бросок атаки равен КД после защиты, весь урон этой атаки становится 0. Попадание и неуронные эффекты попадания сохраняются; сравнение использует сохранённые итоговые числа.', ['frontend/src/engine/itemArmorEquality.test.ts','frontend/src/engine/incomingDamagePolicies.test.ts']);
changes.set(number(865),{mechanics:withPayloads(865,[{...modifier('attack','deny_critical'),scope:'target'}])});
patch(759,withPayloads(759,[{kind:'action_cost_policy',id:'item-completion:759:hide',optional:true,
  when:[{kind:'in_dim_light_or_darkness'}],match:{action_categories:['hide']},replace:{action:'bonus_action'}}]),
  'Засада может использовать бонусное действие только при текущем тусклом освещении или темноте. Освещение берётся из авторитетной карты, стоимость повторно проверяется перед исполнением.', ['frontend/src/rules-core/actionCostPolicy.integration.test.ts','frontend/src/rules-core/itemLight.integration.test.ts']);
patch(936,withPayloads(936,[['reduced_to_0_hp','losesConsciousness',true],['condition_received','condition','unconscious']].map(([event,key,value])=>({
  ...trig(936,event,[{resolution:'auto',who:'self',result:[{kind:'healing',amount:1}]}],{uses:{count:1,per:'long_rest'},circumstances:[{kind:'event_data_equals',key,value}]}),id:'item-completion:936:first-unconscious'}))),
  'Первая фактическая потеря сознания до долгого отдыха лечит1HP. Состояние получателя и падение до0 используют единый сохраняемый лимит; сохранение сознания при0 не расходует его.', ['frontend/src/engine/itemConsciousnessRecovery.test.ts']);

const toolTargeting={domain:'world',actor_targets:false,shape:'single',range_ft:5,min_targets:0,max_targets:0,allowed_relations:[],requires_line_of_sight:true};
const toolAction=(n,key,label,policy,check)=>relatedAction(n,key,{activation:{mode:'active',cost:[{resource:'action',amount:1}],
  ...(policy.duration_seconds?{cast_time:{unit:'minute',amount:policy.duration_seconds/60}}:{})},primitive:{type:'item_tool',policy},targeting:toolTargeting,
  effects:[check?{resolution:'ability_check',...check,on_success:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}
    :{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}]},label);
	const wandererKeyId=byNumber.get(number(869)).id;
	const keyBind=relatedAction(869,'bind-door',{activation:{mode:'active',cost:[]},
	  primitive:{type:'item_tool',policy:{operation:'key_bind',key_item_card_id:wandererKeyId}},
	  targeting:{...toolTargeting,range_ft:100000,requires_line_of_sight:false},
	  effects:[{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}]},'Запомнить дверь');
	const keyUnlock=relatedAction(869,'open-bound-door',{activation:{mode:'active',cost:[{resource:'action',amount:1},
	  {resource:'item',card_id:wandererKeyId,amount:1,bound_self_item:true}]},
	  primitive:{type:'item_tool',policy:{operation:'key_unlock',key_item_card_id:wandererKeyId}},targeting:toolTargeting,
	  effects:[{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}]},'Открыть запомненную дверь');
	patch(869,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[keyBind,keyUnlock]}]},
	  'При выборе двери предмет сохраняет её стабильный ID в состоянии объекта; перепривязать ключ к другой двери нельзя. Действие открывает только эту дверь, атомарно расходует ключ и помечает привязку использованной. Решение, о какой двери персонаж подумал при первом взятии ключа, игрок объявляет выбором действия «Запомнить дверь».',
	  ['frontend/src/rules-core/itemWandererKey.integration.test.ts']);
	missingDefinitions.set(number(869),['Исходный текст не определяет автоматического способа прочесть мысль при первом взятии ключа. Выбор двери фиксируется явным действием игрока; физические копии одинаковой карточки не различаются, поэтому одновременно у одного сценария поддерживается одна привязка этого типа ключа.']);
const holeOwner=byNumber.get(number(856));
const holeRefs=['open','close','enter','exit','store','retrieve'].map(key=>`ACT-item-completion-high-856-${key}`);
const holePolicy={item_card_id:holeOwner.id};
const holeOpen=relatedAction(856,'open',{
  activation:{mode:'active',cost:[{resource:'action',amount:1},{resource:'item',card_id:holeOwner.id,amount:1,bound_self_item:true}]},
  world_item_reuse:true,primitive:{type:'item_tool',policy:{operation:'portable_open',...holePolicy,diameter_ft:6,depth_ft:10,exit_distance_ft:5,
    granted_action_refs:holeRefs,entry_action_ref:holeRefs[2],exit_action_ref:holeRefs[3]}},targeting:toolTargeting,
  effects:[{resolution:'auto',result:[{kind:'world_interaction',operation:'item_tool',parameters:{}}]}],
},'Развернуть переносную дыру');
const holeClose=toolAction(856,'close','Свернуть переносную дыру',{operation:'portable_close',...holePolicy});
const holeEnter=toolAction(856,'enter','Войти в переносную дыру',{operation:'portable_enter',...holePolicy});
const holeExit=relatedAction(856,'exit',{
  activation:{mode:'active',cost:[{resource:'action',amount:1}]},primitive:{type:'item_tool',policy:{operation:'portable_exit',...holePolicy}},targeting:toolTargeting,
  effects:[{resolution:'ability_check',ability:'str',skill:'athletics',dc:10,
    on_success:[{kind:'world_interaction',operation:'item_tool',parameters:{}}],on_fail:[]}],
},'Выбраться из переносной дыры');
const holeStore=toolAction(856,'store','Поместить объект в переносную дыру',{operation:'portable_store',...holePolicy});
const holeRetrieve=toolAction(856,'retrieve','Достать объект из переносной дыры',{operation:'portable_retrieve',...holePolicy});
const holeActionIds=holeRefs.map(ref=>related.find(row=>row.card_number===ref).patch.id);
const holeOpenRow=related.find(row=>row.card_number===holeRefs[0]);
holeOpenRow.patch.mechanics.primitive.policy.granted_action_refs=holeActionIds;
holeOpenRow.patch.mechanics.primitive.policy.entry_action_ref=holeActionIds[2];
holeOpenRow.patch.mechanics.primitive.policy.exit_action_ref=holeActionIds[3];
patch(856,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[holeOpen,holeClose,holeEnter,holeExit,holeStore,holeRetrieve]}]},
  'Действием физический экземпляр разворачивается в круглое пространство диаметром 6 и глубиной 10 футов. Вход и выход сохраняют положение существа на отдельной плоскости; закрытие сохраняет находящихся внутри. Из закрытого пространства можно выбраться действием, проверкой Атлетики СЛ 10; при успехе выход на расстоянии 5 футов. Физические объекты можно положить внутрь и достать с сохранением связи с конкретным экземпляром. Повторное открытие использует уже развернутый экземпляр без второго расхода предмета.',
  ['frontend/src/rules-core/itemPortableSpace.integration.test.ts','frontend/src/solo-combat/itemPortableSpace.integration.test.ts']);
missingDefinitions.set(number(856),['У объектов сцены есть категория размера, но нет физических габаритов и объёма; вместимость дыры диаметром 6 и глубиной 10 футов для произвольного предмета авторитетно не рассчитывается. Помещение в неё разрешено только выбранным физическим предметам, без утверждения об их геометрической вместимости.']);
patch(820,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[
  toolAction(820,'ignite-easy','Зажечь открытое топливо',{operation:'ignite',ignition:'easy'}),
  toolAction(820,'ignite-slow','Развести огонь за минуту',{operation:'ignite',ignition:'slow',duration_seconds:60}),
]}]},'Два предметных действия поджигают горючий объект сцены: при обильном открытом топливе требуется одно действие, иначе работа занимает 60 секунд. Движок сохраняет возгорание объекта, а время уменьшает длительность действующих эффектов.',
  ['frontend/src/rules-core/itemTools.integration.test.ts']);
const chainRef='EFFECT-item-completion-high-829-chained';
const chainEscape=relatedAction(829,'escape',{
  activation:{mode:'active',cost:[{resource:'action'}]},
  targeting:{domain:'actor',shape:'self',actor_targets:false,range_ft:0,min_targets:0,max_targets:1,allowed_relations:['self'],requires_line_of_sight:false},
  effects:[{resolution:'ability_check',ability:'str',skill:'athletics',dc:18,on_success:[
    {kind:'remove_effect',card_number:chainRef},
    {kind:'condition',op:'remove',value:'restrained'},
    {kind:'world_interaction',operation:'release_deployed_item',parameters:{card_id:byNumber.get(number(829)).id,source_effect_ref:chainRef}},
  ],on_fail:[]}],
},'Вырваться из цепи',true);
const chainEffect=relatedEffect(829,'chained',[
  {kind:'condition',value:'restrained',duration:{type:'until_removed'}},chainEscape,
],'Скован цепью');
const bindChain=relatedAction(829,'bind',{
  activation:{mode:'active',cost:[{resource:'action'}]},
  targeting:{domain:'actor',shape:'single',actor_targets:true,range_ft:5,min_targets:1,max_targets:1,
    allowed_relations:['enemy','neutral','ally'],requires_line_of_sight:true,
    requires_target_conditions_any:['grappled','incapacitated','restrained']},
  effects:[{resolution:'auto',who:'target',result:[
    {kind:'world_interaction',operation:'deploy_item',parameters:{card_id:byNumber.get(number(829)).id,at:'target'}},chainEffect,
  ]}],
},'Сковать цепью');
patch(829,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[
  bindChain,toolAction(829,'anchor','Закрепить цепь',{operation:'anchor',max_load_lb:4000}),
]}]},'Цепь удерживает до 4000 фунтов на авторитетном объекте сцены. Действием можно сковать схваченную, недееспособную либо опутанную цель; физический экземпляр переносится к ней. Скованный получает действие высвобождения проверкой Атлетики СЛ 18; при успехе эффект снимается, а цепь остаётся объектом сцены.',
  ['frontend/src/rules-core/itemChain.integration.test.ts','frontend/src/rules-core/itemTools.integration.test.ts']);
for(const [n,actions]of [
  [730,[toolAction(730,'draw-map','Начертить карту',{operation:'map'},{ability:'wis',dc:15})]],
  [751,[toolAction(751,'forge-writing','Подделать надпись',{operation:'forge_text',max_words:10}),toolAction(751,'forge-seal','Воспроизвести печать',{operation:'forge_seal'})]],
  [720,[toolAction(720,'anchor','Закрепить шип',{operation:'anchor'}),toolAction(720,'jam','Заклинить механизм',{operation:'jam'}),toolAction(720,'attach-rope','Привязать верёвку',{operation:'attach_rope'})]],
  [750,[toolAction(750,'dig','Выкопать яму',{operation:'dig',cube_side_ft:5,duration_seconds:3600})]],
  [793,[toolAction(793,'anchor','Закрепиться',{operation:'anchor'})]],
])patch(n,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:actions}]},
  'Каноничное действие выбирает объект сцены и сохраняет результат в нём. Проверки, предел слов, размер и время берутся из данных. Работа не выдаёт отдых: время эффектов проходит, ресурсы отдыха не восстанавливаются.', ['frontend/src/rules-core/itemTools.integration.test.ts']);
for(const n of [789,921])patch(n,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[
  toolAction(n,'lock','Запереть',{operation:'lock',...(n===789?{lock_dc:15}:{lock_disadvantage:true})}),
  toolAction(n,'unlock','Вскрыть',{operation:'unlock',check_from_object:true,...(n===789?{lock_dc:15}:{lock_disadvantage:true})},
    {ability:'dex',...(n===789?{tool:'thieves_tools'}:{skill:'sleight_of_hand'}),dc:'tool_object_dc'}),
]}]},'Замок представлен сохраняемым объектом сцены. СЛ15 обычного замка задана данными; необычный замок накладывает помеху проверке вскрытия. Проверка, исход и открытие сохраняются вместе.', ['frontend/src/rules-core/itemTools.integration.test.ts']);
const picks=byNumber.get(number(702));
const pickingAction=toolAction(702,'unlock','Вскрыть инструментами',{operation:'unlock',check_from_object:true},{ability:'dex',tool:'thieves_tools',dc:'tool_object_dc'});
const pickingEntry=related.find(entry=>entry.card_number===pickingAction.value);
pickingEntry.patch.mechanics.effects[0].on_fail=[{kind:'spend_cost',cause:'tool_failure',cost:[{resource:'item',card_id:picks.id,amount:1,bound_self_item:true}]}];
patch(702,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[pickingAction]}]},
  'Проверка использования инструментов берёт СЛ объекта. После окончательного провала набор ломается: списывается один экземпляр; влияние на неудачный бросок сначала завершается, reload/replay не повторяют расход.', ['frontend/src/rules-core/itemTools.integration.test.ts']);
patch(855,withPayloads(855,[{kind:'grant_feat',value:'731ae77a-63c5-4470-b937-d052ec7cc808'}]),
  'Пока выполнены условия предмета, предоставляется полная каноничная черта Страж. Сборка использует текущие определения черты и их зависимости, при утрате источника возможности отзываются.', ['frontend/src/character/itemFeatGrants.test.ts']);
patch(771,withPayloads(771,[{kind:'weapon_return',any_thrown_weapon:true,after_throw:true}]),
  'После окончательного метательного броска тот же физический экземпляр оружия остаётся в исходной руке. Предмет не дублируется; каноничный журнал и повтор команды сохраняют единственный экземпляр.', ['frontend/src/rules-core/itemWeaponLifecycle.integration.test.ts']);
const classes=JSON.parse(fs.readFileSync(path.join(root,'outputs/catalog-completion-20260929/classes.json'),'utf8'));
const classRefs=keys=>keys.flatMap(key=>{const row=classes.find(row=>row.card_number===`CLASS-${key}`&&!row.deleted_at);if(!row)throw Error(`Missing class ${key}`);return [row.id,row.card_number,key];});
for(const [n,keys]of [[727,['cleric','paladin']],[816,['cleric','paladin']],[826,['wizard','sorcerer','warlock']],[827,['druid','ranger']],[801,[]],[919,['warlock']]]){
  const mechanics=withPayloads(n,[],'carried');mechanics.spell_focus={costless_materials:true,...(keys.length?{class_ids:classRefs(keys)}:{})};
  changes.set(number(n),{mechanics});
  if(n!==919)record(n,'Доступный источник заменяет материальные компоненты без стоимости только у подходящего класса. Каноничный cast журналирует конкретную фокусировку; словесные, соматические и дорогие/расходуемые компоненты сохраняются.', ['frontend/src/rules-core/itemMaterialFocus.integration.test.ts']);
}
const activeSpells=JSON.parse(fs.readFileSync(path.join(root,'outputs/catalog-completion-20260929/spells.json'),'utf8')).filter(spell=>!spell.deleted_at);
const fireball=activeSpells.find(spell=>spell.id==='6da6b18d-7609-4fcd-8078-8f979c4ffdeb');
if(!fireball)throw Error('Missing canonical Fireball');
const unstableWand=byNumber.get(number(886));
patch(886,{activation:{mode:'passive',while:'carried'},magical:true,effects:[{resolution:'auto',result:[{
  kind:'grant_spell',value:fireball.id,label:'at_will',casting_override:{
    remove_cost_resources:['spell_slot'],replace_cost_resources:{action:'bonus_action'},
    add_costs:[{resource:'item',card_id:unstableWand.id,amount:1,bound_self_item:true}],
    targeting:{...clone(fireball.mechanics.targeting),range_ft:0,requires_line_of_sight:false}
  }
}]}]},'Каноничный Огненный шар предоставлен как отдельный путь каста: бонусное действие, без ячейки, с атомарным расходом одной палочки. Центр области совпадает с владельцем.',
  ['frontend/src/character/itemWandFireball.test.ts']);
missingDefinitions.set(number(886),['Текст не задаёт характеристику заклинания или фиксированную СЛ палочки; применяется общий item-grant: характеристика владельца при её наличии, иначе модификатор0. Это системное допущение, не подтверждённое исходным описанием.']);
const anyCantripResource='item_completion_866_cantrip';
const anyCantripChoice={kind:'choice',id:'known-existence-cantrip',context:'in_play',count:1,prompt:'Выберите заговор, о существовании которого знает персонаж',options:{source:'spell',level:0,items:activeSpells.filter(spell=>spell.level===0).map(spell=>({id:spell.id,name:spell.name,
  grants:[{kind:'grant_spell',value:spell.id,label:'known',freeuse:{count:1,recharge:'long_rest'},casting_override:{free_use_resource:anyCantripResource}}]}))}};
patch(866,{...clone(byNumber.get(number(866)).mechanics),activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[modifier('ability_check','add',2,{skill:'arcana'}),
  {kind:'resource',op:'grant',id:anyCantripResource,amount:1,recharge:'long_rest'},anyCantripChoice]}]},
  'Волшебство получает+2. Выбранный через каноничный каталог заговор использует единый дневной ресурс посоха; смена выбора не создаёт новый расход. Проверка знаний о существовании заговора остаётся заявленным фактом персонажа.', ['frontend/src/character/itemChoices.test.ts','frontend/src/character/itemSpellGrants.test.ts']);
	const unknownCantripResource='item_completion_919_unknown_cantrip';
	const warlockActionCantrips=activeSpells.filter(spell=>spell.level===0
	  &&spell.mechanics?.spell_class_list_ids?.includes('CLASS-warlock')
	  &&spell.mechanics?.activation?.cost?.some(cost=>cost.resource==='action'));
	patch(919,{...clone(changes.get(number(919)).mechanics),effects:[{resolution:'auto',result:[
	  {kind:'resource',op:'grant',id:unknownCantripResource,amount:1,recharge:'long_rest'},
	  {kind:'choice',id:'unknown-warlock-cantrip',context:'in_play',count:1,prompt:'Выберите неизвестный заговор Колдуна, творимый действием Магия',
	    options:{source:'spell',level:0,items:warlockActionCantrips.map(spell=>({id:spell.id,name:spell.name,grants:[{
	      kind:'grant_spell',value:spell.id,label:'known',freeuse:{count:1,recharge:'long_rest'},
	      casting_override:{free_use_resource:unknownCantripResource,pre_action_check:{ability:'int',skill:'arcana',dc:10},requires_unknown_spell:true}
	    }]}))}},
	]}]},'Выбранный заговор Колдуна с кастом в действие получает отдельный источник. Авторитетный движок отклоняет уже известный заговор; при использовании сначала оплачивает единый дневной ресурс, затем проверяет Интеллект (Магия) СЛ10, и только при успехе применяет каноничную механику заговора. Фокусировка Колдуна сохранена.',
	  ['frontend/src/character/itemSpellGrants.test.ts']);

for(const [n,rule]of [[725,{advantage:true}],[819,{check_bonus:4}]])patch(n,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[
  toolAction(n,'force-open','Выломать с рычагом',{operation:'force_open',check_from_object:true},{ability:'str',dc:'tool_object_dc',...rule}),
]}]},n===725?'Проверка Силы с ломиком получает преимущество; объект задаёт СЛ, окончательный успех открывает и освобождает закреплённый объект.':'Таран даёт+4 к проверке Силы против двери. Помощь предоставляется обычным действием Помощь и даёт общее преимущество; итог сохраняет открытие двери.', ['frontend/src/rules-core/itemTools.integration.test.ts']);
patch(938,withPayloads(938,[{kind:'equipment_policy',change_duration_seconds:60}]),
  'Надеть или снять доспех можно каноничной командой экипировки за60секунд; время действующих эффектов проходит без восстановления ресурсов отдыха.', ['frontend/src/rules-core/equipmentLifecycle.integration.test.ts']);

patch(928,withPayloads(928,[{kind:'recovery_policy',kinds:['healing','temp_hp'],chance:{die:2,equals:[1]},replace_with:'damage',damage_type:'untyped'}],'carried'),
  'Каждое восстановление использует один исходный бросок объёма и одну честную проверку50%. При замене этот объём наносится владельцу через общий входящий урон, включая временные хиты и концентрацию. Перезагрузка/повтор команды не перебрасывают результат.', ['frontend/src/rules-core/itemRecoveryReplacement.integration.test.ts']);
missingDefinitions.set(number(928),['Исходник не задаёт тип урона; применяется нетипизированный урон с общими защитами, без выдуманной стихии.']);
patch(909,withPayloads(909,[{kind:'resource_restriction',spell_slots:'highest'}],'carried'),
  'Ячейки максимального доступного уровня исключены из способов сотворения и запрещены для любого расхода в авторитетном исполнении. Максимум определяется по ёмкости, а не оставшемуся числу: пустой старший пул не блокирует следующий уровень. Удаление источника не создаёт новых ячеек.', ['frontend/src/engine/itemResourceRestrictions.test.ts']);
patch(935,withPayloads(935,[{kind:'spell_teleport_range',bonus_ft:15}],'carried'),
  'Предметный модификатор увеличивает на15фт дальность исполнимых перемещений-телепортаций заклинаний; для направленных заклинаний также увеличивается дальность выбора цели. Дополнительная ячейка2 уровня сохранена.',
  ['frontend/src/rules-core/itemTeleportRange.test.ts']);

// A shape is a canonical plain-weapon profile. Never copy enchantments or
// exceptional effects from another physical item in the library.
const shapes=new Map();
for(const card of cards.filter(row=>row.type==='weapon'&&row.mechanics?.weapon_profile).sort((a,b)=>a.card_number.localeCompare(b.card_number))){
  const profile=card.mechanics.weapon_profile,kind=profile.weapon_type;
  if(shapes.has(kind))continue;
  if(profile.enchantment.attack_bonus||profile.enchantment.damage_bonus||profile.enchantment.extra_damage_lines?.length)continue;
  shapes.set(kind,{name:card.name,profile});
}
const sphere=byNumber.get(number(853));
const forms=[...shapes].sort(([a],[b])=>a.localeCompare(b)).map(([kind,base])=>relatedAction(853,`form-${kind}`,{
  activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'self',result:[{kind:'weapon_form',item_id:sphere.id,
    name:`${sphere.name}: ${base.name}`,profile:{...clone(base.profile),enchantment:{attack_bonus:2,damage_bonus:2,extra_damage_lines:[]}},grants_mastery:true}]}]
},`Принять форму: ${base.name}`));
patch(853,{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:forms}],magical:true},
  `Выбор одной из ${forms.length} каноничных физических форм оружия. Собственный экземпляр сферы получает+2 к атаке и урону, свойства и искусность выбранного типа. Смена формы доступна раз за ход; другая форма не копирует чужие зачарования.`,
  ['frontend/src/engine/itemWeaponForms.test.ts']);
changes.set(number(853),{...changes.get(number(853)),type:'weapon',slot:'one_hand'});

const hasSpellGrant=value=>!!value&&typeof value==='object'&&(value.kind==='grant_spell'||Object.values(value).some(hasSpellGrant));
const explicitlyMagical=card=>/магич|волшеб|чарован|заклинани|телепорт|астрал|воскреш|омут/i.test([card.description,card.detailed_description].filter(Boolean).join(' '))
  || Number(card.enchant_bonus)>0 || Number(card.mechanics?.weapon_profile?.enchantment?.attack_bonus)>0 || hasSpellGrant(card.mechanics);
for(const card of high){
  const patchFields=changes.get(card.card_number)??{};
  const mechanics=Object.hasOwn(patchFields,'mechanics')?patchFields.mechanics:card.mechanics;
  if(mechanics&&explicitlyMagical(card))changes.set(card.card_number,{...patchFields,mechanics:{...mechanics,magical:true}});
}
for(const entry of related){
  const source=high.find(card=>card.description===entry.patch.description);
  if(entry.patch.mechanics&&(source?explicitlyMagical(source):hasSpellGrant(entry.patch.mechanics)))entry.patch.mechanics.magical=true;
  if(source){const done=completed.get(source.card_number);entry.review.evidence=[...(done?.evidence??[])];entry.review.implemented=done?[done.implementation]:[];}
}

const output = Object.fromEntries(high.map(card => {
  const declaration = changes.get(card.card_number) ?? {};
  const done = completed.get(card.card_number);
  const text = [card.description,card.detailed_description].filter(Boolean).join('\n\n').trim();
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const clauses = (paragraphs.length ? paragraphs : ['Дополнительное описание механики отсутствует.']).map(text => ({ text,
    classification: done?.classification ?? 'mechanical', implementation: done?.implementation ?? 'ОЖИДАЕТ РЕАЛИЗАЦИИ: предложение ещё не закрыто исполняемым сценарием.',
    evidence: done?.evidence ?? [] }));
  const mechanics = Object.hasOwn(declaration,'mechanics') ? declaration.mechanics : card.mechanics;
  return [card.card_number, { mechanics, patch: declaration, clauses,
    limitations: missingDefinitions.get(card.card_number) ?? (done ? [] : clauses.map(clause => `Незавершённое предложение: ${clause.text}`)) }];
}));
const outputPath = path.join(root,'scripts/content/data/item-completion-high-20260929.json');
fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');
fs.writeFileSync(path.join(root,'scripts/content/data/item-completion-high-related-20260929.json'),JSON.stringify({schema_version:1,audit_id:'item-completion-high-20260929',source_snapshot_sha256:'e31510bab0db19721390633ef9e87fabf14ab233a07d5066315cd7a9ff0ba2e6',entities:related},null,2)+'\n');
console.log(JSON.stringify({total:high.length,completed:completed.size,pending:high.length-completed.size,missing_definition:missingDefinitions.size,patched:changes.size,output:outputPath}));
