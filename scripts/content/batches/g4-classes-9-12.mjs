#!/usr/bin/env node
/**
 * G4: классы 9–12 (Бард, Друид, Чародей, Колдун) × уровни 1–2.
 * Запуск: node scripts/content/batches/g4-classes-9-12.mjs
 */
import { createSeeder } from '../seed-framework.mjs';

const BARD_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Подготовка заклинаний барда. ХАР — характеристика заклинаний.' }] },
    {
      kind: 'choice',
      id: 'bard_cantrips',
      prompt: 'Выберите 2 заговора барда',
      count: 2,
      options: { source: 'spell', filter: { classes: ['bard'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'bard_spells_l1',
      prompt: 'Выберите 4 заклинания 1 уровня для подготовки',
      count: 4,
      options: { source: 'spell', filter: { classes: ['bard'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'prepared' },
      resolution: 'on_acquire',
    },
  ],
};

const BARDIC_INSPIRATION = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'bardic_inspiration', amount: 1 }] },
  uses: { count: 'prof_bonus', per: 'long_rest' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Союзник в 60 фт получает кость вдохновения (d6) для одного d20 броска в течение 1 часа.' }],
  }],
  targeting: { filter: 'ally', range: '60 feet', shape: 'single' },
};

const BARD_EXPERTISE = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'bard_expertise_l2',
    prompt: 'Выберите 2 навыка для экспертизы',
    count: 2,
    options: { source: 'skill', filter: 'proficient' },
    grant: { kind: 'grant_proficiency', prof: 'skill', expert: true },
    resolution: 'on_acquire',
  }],
};

const JACK_OF_ALL_TRADES = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Добавляйте половину бонуса мастерства (округляя вниз) к проверкам без владения.' }],
  }],
};

const DRUID_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Подготовка заклинаний druidа. МДР — характеристика заклинаний.' }] },
    {
      kind: 'choice',
      id: 'druid_cantrips',
      prompt: 'Выберите 2 заговора druid',
      count: 2,
      options: { source: 'spell', filter: { classes: ['druid'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'druid_spells_l1',
      prompt: 'Выберите 4 заклинания 1 уровня для подготовки',
      count: 4,
      options: { source: 'spell', filter: { classes: ['druid'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'prepared' },
      resolution: 'on_acquire',
    },
  ],
};

const PRIMAL_ORDER = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'druid_primal_order',
    prompt: 'Первобытный порядок',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'magician', name: 'Маг', grants: [{ kind: 'narrative', description: 'Дополнительный заговор и бонус к заклинаниям druid.' }] },
        { id: 'warden', name: 'Страж', grants: [{ kind: 'narrative', description: 'Владение военным оружием и тренировка в средних доспехах.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const WILD_SHAPE = {
  activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'wild_shape', amount: 1 }] },
  uses: { count: 2, per: 'long_rest' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Превращение в зверя с КО ≤ 1/4 (без летающей/плавающей скорости) на 1 час.' }],
  }],
  targeting: { shape: 'self' },
};

const WILD_COMPANION = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Призыв духа зверя-комpanьona на службу.' }],
  }],
};

const SORCERER_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Заклинания чародея известны (не готовятся). ХАР — характеристика.' }] },
    {
      kind: 'choice',
      id: 'sorcerer_cantrips',
      prompt: 'Выберите 4 заговора чародея',
      count: 4,
      options: { source: 'spell', filter: { classes: ['sorcerer'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'sorcerer_spells_known',
      prompt: 'Выберите 2 заклинания 1 уровня',
      count: 2,
      options: { source: 'spell', filter: { classes: ['sorcerer'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'known' },
      resolution: 'on_acquire',
    },
  ],
};

const INNATE_SORCERY = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Раз в длинный отдых: 1 минута Innate Sorcery — бонус к урону/СЛ заклинаний.' }],
  }],
};

const METAMAGIC = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'sorcerer_metamagic',
    prompt: 'Выберите 2 опции метамагии',
    count: 2,
    options: {
      source: 'explicit',
      items: [
        { id: 'careful', name: 'Аккуратное', grants: [{ kind: 'narrative', description: 'Союзники автоматически успешны на спасброске.' }] },
        { id: 'distant', name: 'Дальнее', grants: [{ kind: 'narrative', description: 'Удвоение дистанции или touch→30 фт.' }] },
        { id: 'empowered', name: 'Усиленное', grants: [{ kind: 'narrative', description: 'Переброс костей урона/лечения.' }] },
        { id: 'extended', name: 'Продлённое', grants: [{ kind: 'narrative', description: 'Удвоение длительности ≥ 1 мин.' }] },
        { id: 'heightened', name: 'Повышенное', grants: [{ kind: 'narrative', description: 'Помеха на спасбросок цели.' }] },
        { id: 'quickened', name: 'Ускоренное', grants: [{ kind: 'narrative', description: 'Заклинание 1–2 ур. бонусным действием.' }] },
        { id: 'seeking', name: 'Ищущее', grants: [{ kind: 'narrative', description: 'Переброс костей урона с помехой.' }] },
        { id: 'subtle', name: 'Тонкое', grants: [{ kind: 'narrative', description: 'Сотворение без компонентов.' }] },
        { id: 'transmuted', name: 'Преобразованное', grants: [{ kind: 'narrative', description: 'Смена типа урона.' }] },
        { id: 'twinned', name: 'Двойное', grants: [{ kind: 'narrative', description: 'Две цели для одной цели.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const FONT_OF_MAGIC = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Очки чародейства = уровень. Конвертация очков ↔ ячейки.' }],
  }],
};

const WARLOCK_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Пact Magic: ячейки восстанавливаются на коротком отдыхе. ХАР — характеристика.' }] },
    {
      kind: 'choice',
      id: 'warlock_cantrips',
      prompt: 'Выберите 2 заговора колдуна',
      count: 2,
      options: { source: 'spell', filter: { classes: ['warlock'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'warlock_spells_known',
      prompt: 'Выберите 2 заклинания 1 уровня',
      count: 2,
      options: { source: 'spell', filter: { classes: ['warlock'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'known' },
      resolution: 'on_acquire',
    },
  ],
};

const PACT_BOON = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'warlock_pact_boon',
    prompt: 'Дар договора',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'blade', name: 'Клинок', grants: [{ kind: 'narrative', description: 'Владение военным оружием и призыв pact weapon.' }] },
        { id: 'chain', name: 'Цепь', grants: [{ kind: 'narrative', description: 'Призыв familiar с особенностями.' }] },
        { id: 'tome', name: 'Тome', grants: [{ kind: 'narrative', description: 'Grimorio с ритуалами и бонусом к проверкам.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const ELDRITCH_INVOCATIONS = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'warlock_invocations_l2',
    prompt: 'Выберите 2 мистических воззвания',
    count: 2,
    options: {
      source: 'explicit',
      items: [
        { id: 'agonizing_blast', name: 'Мучительный залп', grants: [{ kind: 'narrative', description: 'Eldritch Blast + мод. ХАР урона.' }] },
        { id: 'devils_sight', name: 'Зрение исчадия', grants: [{ kind: 'narrative', description: 'Тёмное зрение 120 фт, видит в магической тьме.' }] },
        { id: 'fiendish_vigor', name: 'Бодрость исчадия', grants: [{ kind: 'narrative', description: 'False Life без ячейки 1/длинный отдых.' }] },
        { id: 'mask_of_many_faces', name: 'Маска многих лиц', grants: [{ kind: 'narrative', description: 'Disguise Self без ячейки.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

async function main() {
  const seeder = await createSeeder();
  console.log(`G4 batch (dryRun=${seeder.dryRun})`);

  const bardSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-bard-spellcasting',
    name: 'Использование заклинаний (бард)',
    description: 'Заговоры и подготовленные заклинания.',
    mechanics: BARD_SPELLCASTING,
  })).id;

  const inspirationId = (await seeder.upsertAction({
    cardNumber: 'ACT-bardic-inspiration',
    name: 'Вдохновение барда',
    description: 'Кость вдохновения союзнику (БМ/длинный отдых).',
    resource: 'bonus_action',
    resources: ['bonus_action'],
    mechanics: BARDIC_INSPIRATION,
  })).id;

  const bardExpertiseId = (await seeder.upsertEffect({
    cardNumber: 'EFF-bard-expertise',
    name: 'Экспертиза (бард)',
    description: 'Удвоенный бонус мастерства в двух навыках.',
    mechanics: BARD_EXPERTISE,
  })).id;

  const jackId = (await seeder.upsertEffect({
    cardNumber: 'EFF-jack-of-all-trades',
    name: 'Мастер на все руки',
    description: 'Половина БМ к проверкам без владения.',
    mechanics: JACK_OF_ALL_TRADES,
  })).id;

  const druidSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-druid-spellcasting',
    name: 'Использование заклинаний (друид)',
    description: 'Заговоры и подготовленные заклинания.',
    mechanics: DRUID_SPELLCASTING,
  })).id;

  const primalOrderId = (await seeder.upsertEffect({
    cardNumber: 'EFF-primal-order',
    name: 'Первобытный порядок',
    description: 'Маг или Страж.',
    mechanics: PRIMAL_ORDER,
  })).id;

  const wildShapeId = (await seeder.upsertAction({
    cardNumber: 'ACT-wild-shape',
    name: 'Дикая форма',
    description: 'Превращение в зверя (2/длинный отдых).',
    resource: 'action',
    resources: ['action'],
    mechanics: WILD_SHAPE,
  })).id;

  const wildCompanionId = (await seeder.upsertEffect({
    cardNumber: 'EFF-wild-companion',
    name: 'Дикий спутник',
    description: 'Дух зверя-комpanьona.',
    mechanics: WILD_COMPANION,
  })).id;

  const sorcererSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-sorcerer-spellcasting',
    name: 'Использование заклинаний (чародей)',
    description: 'Известные заклинания чародея.',
    mechanics: SORCERER_SPELLCASTING,
  })).id;

  const innateId = (await seeder.upsertEffect({
    cardNumber: 'EFF-innate-sorcery',
    name: 'Врождённое колдовство',
    description: 'Краткий буст магии.',
    mechanics: INNATE_SORCERY,
  })).id;

  const metamagicId = (await seeder.upsertEffect({
    cardNumber: 'EFF-metamagic',
    name: 'Метamагия',
    description: 'Модификация заклинаний за очки чародейства.',
    mechanics: METAMAGIC,
  })).id;

  const fontId = (await seeder.upsertEffect({
    cardNumber: 'EFF-font-of-magic',
    name: 'Источник магии',
    description: 'Очки чародейства и конвертация ячеек.',
    mechanics: FONT_OF_MAGIC,
  })).id;

  const warlockSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-warlock-spellcasting',
    name: 'Использование заклинаний (колдун)',
    description: 'Pact Magic.',
    mechanics: WARLOCK_SPELLCASTING,
  })).id;

  const pactBoonId = (await seeder.upsertEffect({
    cardNumber: 'EFF-pact-boon',
    name: 'Дар договора',
    description: 'Клинок, Цепь или Тome.',
    mechanics: PACT_BOON,
  })).id;

  const invocationsId = (await seeder.upsertEffect({
    cardNumber: 'EFF-eldritch-invocations',
    name: 'Мистические воззвания',
    description: 'Особые способности колдуна.',
    mechanics: ELDRITCH_INVOCATIONS,
  })).id;

  await seeder.upsertClass({
    cardNumber: 'CLASS-bard',
    name: 'Бард',
    description: 'Мастер песни, речи и магии.',
    hit_die: 'd8',
    primary_abilities: ['cha'],
    saving_throws: ['dex', 'cha'],
    skill_choices: {
      count: 3,
      options: ['acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight_of_hand', 'stealth', 'survival'],
    },
    resources: {
      bardic_inspiration: { count: 'prof_bonus', per: 'long_rest' },
    },
    level_progression: {
      1: { effects: [bardSpellId], actions: [inspirationId] },
      2: { effects: [bardExpertiseId, jackId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-druid',
    name: 'Друид',
    description: 'Хранитель природы и первобытных сил.',
    hit_die: 'd8',
    primary_abilities: ['wis'],
    saving_throws: ['int', 'wis'],
    skill_choices: {
      count: 2,
      options: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'],
    },
    resources: {
      wild_shape: { count: 2, per: 'long_rest' },
    },
    level_progression: {
      1: { effects: [druidSpellId, primalOrderId], actions: [] },
      2: { effects: [wildCompanionId], actions: [wildShapeId] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-sorcerer',
    name: 'Чародей',
    description: 'Носитель врождённой магии.',
    hit_die: 'd6',
    primary_abilities: ['cha'],
    saving_throws: ['con', 'cha'],
    skill_choices: {
      count: 2,
      options: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
    },
    resources: {
      sorcery_points: { count: 'self_level', per: 'long_rest' },
    },
    level_progression: {
      1: { effects: [sorcererSpellId, innateId], actions: [] },
      2: { effects: [metamagicId, fontId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-warlock',
    name: 'Колдун',
    description: 'Заключивший договор с потусторонней сущностью.',
    hit_die: 'd8',
    primary_abilities: ['cha'],
    saving_throws: ['wis', 'cha'],
    skill_choices: {
      count: 2,
      options: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
    },
    level_progression: {
      1: { effects: [warlockSpellId, pactBoonId], actions: [] },
      2: { effects: [invocationsId], actions: [] },
    },
  });

  console.log('Готово:', seeder.stats);
  console.log('Проверка: node scripts/coverage-report.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
