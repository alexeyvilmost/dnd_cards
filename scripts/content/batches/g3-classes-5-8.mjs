#!/usr/bin/env node
/**
 * G3: классы 5–8 (Варвар, Монах, Паладин, Следопыт) × уровни 1–2.
 * Запуск: node scripts/content/batches/g3-classes-5-8.mjs
 */
import { createSeeder } from '../seed-framework.mjs';

const RAGE = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'rage_charge', amount: 1 }] },
  uses: { count: 2, per: 'long_rest' },
  effects: [{
    resolution: 'auto',
    result: [{
      kind: 'narrative',
      description: 'Ярость: +2 к урону атаками СИЛ/метания, сопр. дроб./руб./кол., преимущество на проверки и спасброски СИЛ.',
    }],
  }],
  targeting: { shape: 'self' },
};

const BARBARIAN_UNARMORED = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Без доспеха: КД = 10 + ЛВК + ТЕЛ.' }],
  }],
};

const PRIMAL_KNOWLEDGE = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'barbarian_primal_skill',
    prompt: 'Выберите навык (Природа или Проницательность)',
    count: 1,
    options: { source: 'explicit', items: [
      { id: 'nature', name: 'Природа' },
      { id: 'insight', name: 'Проницательность' },
    ] },
    grant: { kind: 'grant_proficiency', prof: 'skill' },
    resolution: 'on_acquire',
  }],
};

const RECKLESS_ATTACK = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'При первой атаке в ход: преимущество, атаки по вам — с преимуществом до вашего следующего хода.' }],
  }],
};

const DANGER_SENSE = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Преимущество на спасброски ЛВК против эффектов, которые вы видите.' }],
  }],
};

const MARTIAL_ARTS = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Без доспеха/щита: безоружный удар d6, бонусным действием — ещё один безоружный удар.' }],
  }],
};

const MONK_UNARMORED = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Без доспеха и щита: КД = 10 + ЛВК + МДР.' }],
  }],
};

const MONK_FOCUS = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Очки фокуса = уровень монаха. Тратятся на техники (Flurry, Patient Defense, Step of the Wind).' }],
  }],
};

const UNARMORED_MOVEMENT = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Скорость +10 фт, пока не носите доспех и щит.' }],
  }],
};

const UNCANNY_METABOLISM = {
  activation: { mode: 'triggered', trigger: { event: 'short_rest', timing: 'during' } },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Раз за короткий отдых: восстановите все очки фокуса и получите временные HP = 2×уровень.' }],
  }],
};

const LAY_ON_HANDS = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'healing', amount: '5' }],
  }],
  targeting: { shape: 'self' },
};

const DIVINE_SENSE = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Действием: обнаружение исадов, небожителей и нежити в 60 фт.' }],
  }],
};

const PALADIN_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Подготовка заклинаний паладина. ХАР — характеристика заклинаний.' }] },
    {
      kind: 'choice',
      id: 'paladin_cantrips',
      prompt: 'Выберите 2 заговора паладина',
      count: 2,
      options: { source: 'spell', filter: { classes: ['paladin'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'paladin_spells_l1',
      prompt: 'Выберите 2 заклинания 1 уровня для подготовки',
      count: 2,
      options: { source: 'spell', filter: { classes: ['paladin'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'prepared' },
      resolution: 'on_acquire',
    },
  ],
};

const PALADIN_FIGHTING_STYLE = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'paladin_fighting_style',
    prompt: 'Выберите боевой стиль',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'defense', name: 'Защита', grants: [{ kind: 'narrative', description: '+1 КД в доспехе.' }] },
        { id: 'dueling', name: 'Дуэль', grants: [{ kind: 'narrative', description: '+2 урона одноручным оружием.' }] },
        { id: 'great_weapon', name: 'Большое оружие', grants: [{ kind: 'narrative', description: 'Переброс 1–2 на уроне двуручным.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const PALADIN_SMITE = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'При попадании оружием ближнего боя можно потратить ячейку для доп. урона излучением.' }],
  }],
};

const RANGER_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Подготовка заклинаний следопыта. МДР — характеристика заклинаний.' }] },
    {
      kind: 'choice',
      id: 'ranger_cantrips',
      prompt: 'Выберите 2 заговора следопыта',
      count: 2,
      options: { source: 'spell', filter: { classes: ['ranger'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'ranger_spells_l1',
      prompt: 'Выберите 2 заклинания 1 уровня для подготовки',
      count: 2,
      options: { source: 'spell', filter: { classes: ['ranger'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'prepared' },
      resolution: 'on_acquire',
    },
  ],
};

const FAVORED_ENEMY = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'ranger_favored_enemy',
    prompt: 'Избранный враг',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'beasts', name: 'Звери', grants: [{ kind: 'narrative', description: 'Преимущество на проверки для выслеживания и знаний о зверях.' }] },
        { id: 'humanoids', name: 'Гуманоиды', grants: [{ kind: 'narrative', description: 'Преимущество на проверки для выслеживания и знаний о гуманоидах.' }] },
        { id: 'monsters', name: 'Монстры', grants: [{ kind: 'narrative', description: 'Преимущество на проверки для выслеживания и знаний о монстрах.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const DEFT_EXPLORER = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'ranger_deft_explorer',
    prompt: 'Ловкий исследователь: язык или инструмент',
    count: 1,
    options: { source: 'skill', filter: 'all' },
    grant: { kind: 'grant_proficiency', prof: 'language' },
    resolution: 'on_acquire',
  }],
};

const RANGER_FIGHTING_STYLE = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'ranger_fighting_style',
    prompt: 'Выберите боевой стиль',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'archery', name: 'Стрельба', grants: [{ kind: 'narrative', description: '+2 к атакам дальним оружием.' }] },
        { id: 'defense', name: 'Защита', grants: [{ kind: 'narrative', description: '+1 КД в доспехе.' }] },
        { id: 'two_weapon', name: 'Два оружия', grants: [{ kind: 'narrative', description: 'Модификатор к урону второй рукой.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const DRUIDIC_WARRIOR = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Выучите заклинание «Метка охотника»; без ячеек — 1/длинный отдых.' }],
  }],
};

async function main() {
  const seeder = await createSeeder();
  console.log(`G3 batch (dryRun=${seeder.dryRun})`);

  const rageId = (await seeder.upsertAction({
    cardNumber: 'ACT-rage',
    name: 'Ярость',
    description: 'Бонусным действием войти в ярость (2/длинный отдых).',
    resource: 'bonus_action',
    resources: ['bonus_action'],
    mechanics: RAGE,
  })).id;

  const barbUnarmoredId = (await seeder.upsertEffect({
    cardNumber: 'EFF-barbarian-unarmored',
    name: 'Защита без доспехов',
    description: 'КД без доспеха.',
    mechanics: BARBARIAN_UNARMORED,
  })).id;

  const primalId = (await seeder.upsertEffect({
    cardNumber: 'EFF-primal-knowledge',
    name: 'Первобытные знания',
    description: 'Дополнительное владение навыком.',
    mechanics: PRIMAL_KNOWLEDGE,
  })).id;

  const recklessId = (await seeder.upsertEffect({
    cardNumber: 'EFF-reckless-attack',
    name: 'Безрассудная атака',
    description: 'Преимущество в обмен на уязвимость.',
    mechanics: RECKLESS_ATTACK,
  })).id;

  const dangerId = (await seeder.upsertEffect({
    cardNumber: 'EFF-danger-sense',
    name: 'Чувство опасности',
    description: 'Преимущество на спасброски ЛВК.',
    mechanics: DANGER_SENSE,
  })).id;

  const martialId = (await seeder.upsertEffect({
    cardNumber: 'EFF-martial-arts',
    name: 'Боевые искусства',
    description: 'Безоружные удары и бонусная атака.',
    mechanics: MARTIAL_ARTS,
  })).id;

  const monkUnarmoredId = (await seeder.upsertEffect({
    cardNumber: 'EFF-monk-unarmored',
    name: 'Защита без доспехов (монах)',
    description: 'КД монаха.',
    mechanics: MONK_UNARMORED,
  })).id;

  const monkFocusId = (await seeder.upsertEffect({
    cardNumber: 'EFF-monk-focus',
    name: 'Фокус монаха',
    description: 'Очки фокуса и техники.',
    mechanics: MONK_FOCUS,
  })).id;

  const unarmoredMoveId = (await seeder.upsertEffect({
    cardNumber: 'EFF-unarmored-movement',
    name: 'Быстрое передвижение',
    description: '+10 фт без доспеха.',
    mechanics: UNARMORED_MOVEMENT,
  })).id;

  const uncannyId = (await seeder.upsertEffect({
    cardNumber: 'EFF-uncanny-metabolism',
    name: 'Необычный метаболизм',
    description: 'Восстановление фокуса на коротком отдыхе.',
    effectType: 'triggered',
    mechanics: UNCANNY_METABOLISM,
  })).id;

  const layOnHandsId = (await seeder.upsertAction({
    cardNumber: 'ACT-lay-on-hands',
    name: 'Прикосновение целителя',
    description: 'Исцеление из запаса (5 HP за использование в MVP).',
    resource: 'action',
    resources: ['action'],
    mechanics: LAY_ON_HANDS,
  })).id;

  const divineSenseId = (await seeder.upsertEffect({
    cardNumber: 'EFF-divine-sense',
    name: 'Божественное чувство',
    description: 'Обнаружение необычных существ.',
    mechanics: DIVINE_SENSE,
  })).id;

  const paladinSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-paladin-spellcasting',
    name: 'Использование заклинаний (паладин)',
    description: 'Заговоры и подготовленные заклинания.',
    mechanics: PALADIN_SPELLCASTING,
  })).id;

  const paladinStyleId = (await seeder.upsertEffect({
    cardNumber: 'EFF-paladin-fighting-style',
    name: 'Боевой стиль (паладин)',
    description: 'Специализация владения.',
    mechanics: PALADIN_FIGHTING_STYLE,
  })).id;

  const paladinSmiteId = (await seeder.upsertEffect({
    cardNumber: 'EFF-paladin-smite',
    name: 'Божественная кара',
    description: 'Дополнительный урон излучением.',
    mechanics: PALADIN_SMITE,
  })).id;

  const rangerSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-ranger-spellcasting',
    name: 'Использование заклинаний (следопыт)',
    description: 'Заговоры и подготовленные заклинания.',
    mechanics: RANGER_SPELLCASTING,
  })).id;

  const favoredId = (await seeder.upsertEffect({
    cardNumber: 'EFF-favored-enemy',
    name: 'Избранный враг',
    description: 'Специализация на типе существ.',
    mechanics: FAVORED_ENEMY,
  })).id;

  const deftId = (await seeder.upsertEffect({
    cardNumber: 'EFF-deft-explorer',
    name: 'Ловкий исследователь',
    description: 'Язык или инструмент.',
    mechanics: DEFT_EXPLORER,
  })).id;

  const rangerStyleId = (await seeder.upsertEffect({
    cardNumber: 'EFF-ranger-fighting-style',
    name: 'Боевой стиль (следопыт)',
    description: 'Специализация владения.',
    mechanics: RANGER_FIGHTING_STYLE,
  })).id;

  const druidicWarriorId = (await seeder.upsertEffect({
    cardNumber: 'EFF-druidic-warrior',
    name: 'Друидический воин',
    description: 'Метка охотника без ячеек.',
    mechanics: DRUIDIC_WARRIOR,
  })).id;

  await seeder.upsertClass({
    cardNumber: 'CLASS-barbarian',
    name: 'Варвар',
    description: 'Яростный воин первобытной мощи.',
    hit_die: 'd12',
    primary_abilities: ['str'],
    saving_throws: ['str', 'con'],
    skill_choices: {
      count: 2,
      options: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
    },
    resources: {
      rage_charge: { count: 2, per: 'long_rest' },
    },
    level_progression: {
      1: { effects: [barbUnarmoredId, primalId], actions: [rageId] },
      2: { effects: [recklessId, dangerId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-monk',
    name: 'Монах',
    description: 'Мастер боевых искусств и внутренней энергии.',
    hit_die: 'd8',
    primary_abilities: ['dex', 'wis'],
    saving_throws: ['str', 'dex'],
    skill_choices: {
      count: 2,
      options: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
    },
    resources: {
      focus: { count: 'self_level', per: 'long_rest' },
    },
    level_progression: {
      1: { effects: [martialId, monkUnarmoredId, monkFocusId], actions: [] },
      2: { effects: [unarmoredMoveId, uncannyId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-paladin',
    name: 'Паладин',
    description: 'Святой воин, связанный клятвой.',
    hit_die: 'd10',
    primary_abilities: ['str', 'cha'],
    saving_throws: ['wis', 'cha'],
    skill_choices: {
      count: 2,
      options: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
    },
    level_progression: {
      1: { effects: [divineSenseId, paladinSpellId], actions: [layOnHandsId] },
      2: { effects: [paladinStyleId, paladinSmiteId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-ranger',
    name: 'Следопыт',
    description: 'Охотник и проводник диких земель.',
    hit_die: 'd10',
    primary_abilities: ['dex', 'wis'],
    saving_throws: ['str', 'dex'],
    skill_choices: {
      count: 3,
      options: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
    },
    level_progression: {
      1: { effects: [rangerSpellId, favoredId, deftId], actions: [] },
      2: { effects: [rangerStyleId, druidicWarriorId], actions: [] },
    },
  });

  console.log('Готово:', seeder.stats);
  console.log('Проверка: node scripts/coverage-report.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
