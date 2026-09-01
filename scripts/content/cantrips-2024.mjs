const action = (resource = 'action') => ({
  activation: { mode: 'active', cost: [{ resource }] },
});

const target = (range, filter = 'any') => ({
  shape: 'single',
  ...(range ? { range } : {}),
  filter,
});

const area = (range, kind, size, filter = 'any') => ({
  shape: 'area',
  range,
  area: { kind, size },
  filter,
});

const scalingDamage = (dice, type, extra = {}) => ({
  kind: 'damage',
  dice,
  type,
  scaling: { dice, per: 'character_level' },
  ...extra,
});

const attack = (onHit, {
  kind = 'spell_ranged',
  ability = 'spellcasting',
  extra = {},
} = {}) => ({
  resolution: 'attack_roll',
  ...(kind ? { attack_kind: kind } : {}),
  ability,
  vs: 'ac',
  on_hit: onHit,
  ...extra,
});

const save = (ability, onFail, onSuccess = []) => ({
  resolution: 'save',
  who: 'target',
  ability,
  dc: '8 + prof + spellcasting',
  on_fail: onFail,
  on_success: onSuccess,
});

const automatic = (...result) => ({ resolution: 'auto', result });
const narrative = (description) => ({ kind: 'narrative', description });
const duration = (amount = 10, concentration = false) => ({
  type: 'rounds',
  amount,
  ...(concentration ? { concentration: true } : {}),
});

const mechanics = (effects, targeting, resource = 'action') => ({
  ...action(resource),
  effects,
  targeting,
});

const inPlayChoice = (id, prompt, items) => ({
  kind: 'choice',
  id,
  context: 'in_play',
  count: 1,
  prompt,
  options: { source: 'explicit', items },
});

const damageTypes = [
  ['acid', 'Кислота'],
  ['cold', 'Холод'],
  ['fire', 'Огонь'],
  ['lightning', 'Электричество'],
  ['poison', 'Яд'],
  ['psychic', 'Психическая энергия'],
  ['thunder', 'Звук'],
];

const guidanceSkills = [
  ['athletics', 'Атлетика'],
  ['acrobatics', 'Акробатика'],
  ['sleight_of_hand', 'Ловкость рук'],
  ['stealth', 'Скрытность'],
  ['arcana', 'Магия'],
  ['history', 'История'],
  ['investigation', 'Расследование'],
  ['nature', 'Природа'],
  ['religion', 'Религия'],
  ['animal_handling', 'Уход за животными'],
  ['insight', 'Проницательность'],
  ['medicine', 'Медицина'],
  ['perception', 'Восприятие'],
  ['survival', 'Выживание'],
  ['deception', 'Обман'],
  ['intimidation', 'Запугивание'],
  ['performance', 'Выступление'],
  ['persuasion', 'Убеждение'],
];

const partial = (...limitations) => ({ status: 'verified_partial', limitations });
const mechanical = { status: 'verified_mechanical', limitations: [] };
const narrativeOnly = (...limitations) => ({ status: 'verified_narrative', limitations });

/**
 * Полный каталог заговоров D&D 2024, присутствующий в продукте.
 *
 * verified_mechanical означает, что вся механическая часть карточки выполняется
 * движком. verified_partial честно перечисляет остаток, который требует карты,
 * нескольких целей, объектов или отсутствующего runtime-состояния.
 */
export const CANTRIP_UPGRADES = {
  'Астральный рывок': {
    support: partial(
      'Движок регистрирует телепортацию и урон выбранной цели, но без карты не находит автоматически всех существ на линии.',
    ),
    mechanics: mechanics([
      automatic(
        { kind: 'movement', value: 'teleport', distance: '15' },
        scalingDamage('1d8', 'radiant'),
        narrative('Выберите незанятое видимое пространство в 15 футах; урон получают существа на линии телепортации.'),
      ),
    ], { shape: 'self' }),
  },
  'Брызги кислоты': {
    support: partial('До появления карты каждую цель 5-футовой сферы нужно выбрать и обработать отдельно.'),
    mechanics: mechanics([
      save('dex', [scalingDamage('1d6', 'acid')]),
    ], area('60 футов', 'sphere', 5)),
  },
  'Волшебная рука': {
    support: narrativeOnly('У листа пока нет состояния отдельной руки, объектов, дверей и контейнеров игрового мира.'),
    mechanics: mechanics([
      automatic(narrative('Создаёт на 1 минуту управляемую призрачную руку; ограничения и действия описаны в карточке.')),
    ], target('30 футов')),
  },
  'Дружба': {
    support: partial(
      'Спасбросок, концентрация и Очарование автоматизированы; тип цели, повторное применение за 24 часа и досрочное окончание проверяет ведущий.',
    ),
    mechanics: mechanics([
      save('wis', [{
        kind: 'condition',
        op: 'apply',
        value: 'charmed',
        duration: duration(10, true),
      }]),
    ], target('10 футов', 'enemy')),
  },
  'Дубинка': {
    support: narrativeOnly('Движок ещё не умеет временно заменять кость, характеристику атаки и тип урона конкретного экипированного оружия.'),
    mechanics: mechanics([
      automatic(narrative('Дубинка или боевой посох на 1 минуту использует характеристику заклинаний и новую кость урона; см. карточку.')),
    ], { shape: 'self' }, 'bonus_action'),
  },
  'Защита от оружия': {
    support: mechanical,
    mechanics: mechanics([
      automatic({
        kind: 'modifier',
        applies_to: { roll: 'attack' },
        scope: 'target',
        op: 'bonus_die',
        faces: 4,
        sign: -1,
        source: 'Защита от оружия',
        duration: duration(10, true),
      }),
    ], { shape: 'self' }),
  },
  'Звёздный светлячок': {
    support: partial('Урон автоматизирован; свет и запрет преимуществ Невидимости требуют модели освещения карты.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d8', 'radiant'),
        narrative('До конца следующего хода цель излучает тусклый свет и не получает преимуществ от Невидимости.'),
      ]),
    ], target('60 футов')),
  },
  'Злая насмешка': {
    support: mechanical,
    mechanics: mechanics([
      save('wis', [
        scalingDamage('1d6', 'psychic'),
        {
          kind: 'modifier',
          applies_to: { roll: 'attack' },
          op: 'disadvantage',
          consume: 'next',
          source: 'Злая насмешка',
          duration: { type: 'until_end_of_turn' },
        },
      ]),
    ], target('60 футов', 'enemy')),
  },
  'Искусство друидов': {
    support: narrativeOnly('Эффекты управляют погодными знаками, растениями, огнём и окружением, которых пока нет в runtime листа.'),
    mechanics: mechanics([
      automatic(narrative('Выберите один природный эффект из описания карточки.')),
    ], target('30 футов')),
  },
  'Леденящее прикосновение': {
    support: partial('Урон и запрет лечения работают; эффект истекает по ходу цели, пока бой не хранит владельца длительности «до конца вашего следующего хода».'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d10', 'necrotic'),
        {
          kind: 'modifier',
          applies_to: { roll: 'healing' },
          op: 'deny',
          source: 'Леденящее прикосновение',
          duration: { type: 'until_end_of_turn' },
        },
      ], { kind: 'spell_melee' }),
    ], target('Касание')),
  },
  'Луч холода': {
    support: partial('Урон автоматизирован; уменьшение Скорости хранится эффектом, но без карты не ограничивает перемещение токена.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d8', 'cold'),
        {
          kind: 'modifier',
          applies_to: { stat: 'speed' },
          op: 'add',
          value: -10,
          source: 'Луч холода',
          duration: { type: 'until_start_of_next_turn' },
        },
      ]),
    ], target('60 футов')),
  },
  'Малая иллюзия': {
    support: narrativeOnly('Создание и распознавание иллюзии требуют объектов сцены и решений ведущего.'),
    mechanics: mechanics([
      automatic(narrative('Создаёт звук или неподвижное изображение на 1 минуту; параметры указаны в карточке.')),
    ], target('30 футов')),
  },
  'Меткий удар': {
    support: mechanical,
    mechanics: mechanics([
      attack([
        inPlayChoice('true_strike_damage_type', 'Выберите тип урона оружия', [
          {
            id: 'weapon',
            name: 'Обычный тип оружия',
            grants: [
              { kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'spellcasting' },
              {
                kind: 'damage', dice: '0', type: 'radiant',
                scaling: { dice: '1d6', per: 'character_level' },
                suppress_damage_modifiers: true,
                omit_if_zero: true,
              },
            ],
          },
          {
            id: 'radiant',
            name: 'Излучение',
            grants: [
              { kind: 'damage', dice: 'weapon', type: 'radiant', ability: 'spellcasting' },
              {
                kind: 'damage', dice: '0', type: 'radiant',
                scaling: { dice: '1d6', per: 'character_level' },
                suppress_damage_modifiers: true,
                omit_if_zero: true,
              },
            ],
          },
        ]),
      ], { kind: null, ability: 'spellcasting' }),
    ], target(null, 'enemy')),
  },
  'Мистический заряд': {
    support: partial('На 5+ уровнях правила создают несколько отдельных лучей и атак, а текущий движок пока объединяет масштабирование в один бросок урона.'),
    mechanics: mechanics([
      attack([scalingDamage('1d10', 'force')]),
    ], target('120 футов')),
  },
  'Наставление': {
    support: mechanical,
    mechanics: mechanics([
      inPlayChoice('guidance_skill', 'Выберите навык для Наставления', guidanceSkills.map(([id, name]) => ({
        id,
        name,
        grants: [{
          kind: 'modifier',
          applies_to: { roll: 'ability_check', filter: { skill: id } },
          op: 'bonus_die',
          faces: 4,
          source: 'Наставление',
          duration: duration(10, true),
        }],
      }))),
    ], target('Касание', 'ally_and_self')),
  },
  'Огненный снаряд': {
    support: partial('Атака и урон работают; воспламенение свободного горючего объекта требует модели объектов сцены.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d10', 'fire'),
        narrative('Незакреплённый горючий объект, который никто не носит, воспламеняется.'),
      ]),
    ], target('120 футов')),
  },
  'Пляшущие огоньки': {
    support: narrativeOnly('Светильники, их взаимная дистанция и перемещение бонусным действием требуют карты и модели света.'),
    mechanics: mechanics([
      automatic(narrative('Создаёт до четырёх управляемых огоньков на 1 минуту с концентрацией; см. карточку.')),
    ], target('120 футов')),
  },
  'Погребальный звон': {
    support: partial('Спасбросок и урон работают; до encounter состояние «цель уже ранена» выбирает игрок.'),
    mechanics: mechanics([
      save('wis', [
        inPlayChoice('toll_the_dead_die', 'Есть ли у цели потерянные Хиты?', [
          { id: 'unhurt', name: 'Нет — к8', grants: [scalingDamage('1d8', 'necrotic')] },
          { id: 'hurt', name: 'Да — к12', grants: [scalingDamage('1d12', 'necrotic')] },
        ]),
      ]),
    ], target('60 футов', 'enemy')),
  },
  'Починка': {
    support: narrativeOnly('Ремонт повреждённых объектов требует модели предметов и решений ведущего.'),
    mechanics: mechanics([
      automatic(narrative('Чинит один разрыв или поломку объекта согласно описанию карточки.')),
    ], target('Касание')),
  },
  'Раскат грома': {
    support: partial('Спасбросок и урон выбранной цели работают; все цели 5-футовой эманации без карты не определяются автоматически.'),
    mechanics: mechanics([
      save('con', [
        scalingDamage('1d6', 'thunder'),
        narrative('Звук слышен на расстоянии до 100 футов.'),
      ]),
    ], area('На себя', 'emanation', 5, 'enemy')),
  },
  'Расщепление разума': {
    support: partial('Урон и штраф −к4 к следующему спасброску работают; точное окно «до конца вашего следующего хода» пока привязано к ходу цели.'),
    mechanics: mechanics([
      save('int', [
        scalingDamage('1d6', 'psychic'),
        {
          kind: 'modifier',
          applies_to: { roll: 'saving_throw' },
          op: 'bonus_die',
          faces: 4,
          sign: -1,
          consume: 'next',
          source: 'Расщепление разума',
          duration: duration(1),
        },
      ]),
    ], target('60 футов', 'enemy')),
  },
  'Свет': {
    support: narrativeOnly('Источник света, покрытие объекта и конкуренция заклинаний требуют модели объектов и освещения карты.'),
    mechanics: mechanics([
      automatic(narrative('Объект излучает яркий и тусклый свет в радиусах 20/40 футов в течение 1 часа.')),
    ], target('Касание')),
  },
  'Священное пламя': {
    support: partial('Спасбросок и урон работают; игнорирование половинного и трёхчетвертного укрытия станет автоматическим вместе с картой.'),
    mechanics: mechanics([
      save('dex', [scalingDamage('1d8', 'radiant')]),
    ], target('60 футов', 'enemy')),
  },
  'Слово сияния': {
    support: partial('Спасбросок и урон выбранной цели работают; видимые выбранные существа эманации без карты обрабатываются по одной.'),
    mechanics: mechanics([
      save('con', [scalingDamage('1d6', 'radiant')]),
    ], area('На себя', 'emanation', 5, 'enemy')),
  },
  'Сообщение': {
    support: narrativeOnly('Передача сообщений, знакомство с целью и препятствия относятся к состоянию мира, а не листа.'),
    mechanics: mechanics([
      automatic(narrative('Передаёт цели приватное короткое сообщение и позволяет ответить; ограничения указаны в карточке.')),
    ], target('120 футов')),
  },
  'Сопротивление': {
    support: narrativeOnly('Движок пока не поддерживает реактивное уменьшение выбранного типа урона на к4 не чаще одного раза за ход.'),
    mechanics: mechanics([
      automatic(narrative('Выберите тип урона: первое подходящее получение урона за ход уменьшается на 1к4 в течение 1 минуты с концентрацией.')),
    ], target('Касание', 'ally_and_self')),
  },
  'Сотворение пламени': {
    support: partial('Бросок огня и урон работают; создание, свет и последующий отдельный бросок требуют длительного объекта-действия.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d8', 'fire'),
        narrative('Пламя также может оставаться в руке до 10 минут и излучать свет; метание завершает заклинание.'),
      ]),
    ], target('60 футов'), 'bonus_action'),
  },
  'Стихийность': {
    support: narrativeOnly('Все варианты меняют небольшие объекты и окружение, которых пока нет в runtime листа.'),
    mechanics: mechanics([
      automatic(narrative('Выберите один из малых эффектов воздуха, земли, огня или воды из карточки.')),
    ], target('30 футов')),
  },
  'Терновый кнут': {
    support: partial('Атака и урон работают; притягивание регистрируется, но без карты не перемещает токен и не проверяет размер цели.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d6', 'piercing'),
        { kind: 'movement', value: 'pull', distance: '10' },
        narrative('Притянуть можно цель Большого размера или меньше.'),
      ], { kind: 'spell_melee' }),
    ], target('30 футов', 'enemy')),
  },
  'Уход за умирающим': {
    support: narrativeOnly('В runtime листа пока нет отдельного состояния смерти и стабилизации существа с 0 Хитов.'),
    mechanics: mechanics([
      automatic(narrative('Живое существо с 0 Хитов в пределах дистанции становится Стабилизированным.')),
    ], target('15 футов', 'ally_and_self')),
  },
  'Фокусы': {
    support: narrativeOnly('Малые сенсорные эффекты и изменения объектов требуют модели окружения.'),
    mechanics: mechanics([
      automatic(narrative('Создаёт один малый магический эффект из вариантов карточки.')),
    ], target('10 футов')),
  },
  'Чародейский выброс': {
    support: mechanical,
    mechanics: mechanics([
      attack([
        inPlayChoice('sorcerous_burst_damage_type', 'Выберите тип урона', damageTypes.map(([id, name]) => ({
          id,
          name,
          grants: [{
            ...scalingDamage('1d8', id),
            explode: { limit: 'spellcasting' },
          }],
        }))),
      ]),
    ], target('120 футов')),
  },
  'Чудотворство': {
    support: partial('Преимущество на Запугивание автоматизировано; остальные пять вариантов меняют окружение и остаются нарративными.'),
    mechanics: mechanics([
      inPlayChoice('thaumaturgy_effect', 'Выберите чудо', [
        {
          id: 'booming_voice',
          name: 'Раскатистый голос',
          grants: [{
            kind: 'modifier',
            applies_to: { roll: 'ability_check', filter: { skill: 'intimidation' } },
            op: 'advantage',
            source: 'Чудотворство: раскатистый голос',
            duration: duration(10),
          }],
        },
        { id: 'eyes', name: 'Изменённые глаза', grants: [narrative('Изменяет внешний вид глаз на 1 минуту.')] },
        { id: 'flame', name: 'Игра с огнём', grants: [narrative('Меняет вид пламени на 1 минуту.')] },
        { id: 'door', name: 'Невидимая рука', grants: [narrative('Открывает или закрывает незапертую дверь либо окно.')] },
        { id: 'sound', name: 'Фантомный звук', grants: [narrative('Создаёт мгновенный звук в выбранной точке.')] },
        { id: 'tremor', name: 'Дрожь', grants: [narrative('Создаёт безвредную дрожь земли на 1 минуту.')] },
      ]),
    ], target('30 футов')),
  },
  'Электрошок': {
    support: partial('Атака и урон работают; запрет только Провоцированных атак требует модели реакций и перемещения на карте.'),
    mechanics: mechanics([
      attack([
        scalingDamage('1d8', 'lightning'),
        narrative('До начала следующего хода цель не может совершать Провоцированные атаки.'),
      ], { kind: 'spell_melee' }),
    ], target('Касание', 'enemy')),
  },
  'Ядовитые брызги': {
    support: mechanical,
    mechanics: mechanics([
      attack([scalingDamage('1d12', 'poison')]),
    ], target('30 футов', 'enemy')),
  },
};

export const EXPECTED_CANTRIP_NAMES = Object.freeze(Object.keys(CANTRIP_UPGRADES));

export function cantripUpgradeFor(name) {
  return CANTRIP_UPGRADES[name] ?? null;
}
