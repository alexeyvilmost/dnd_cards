#!/usr/bin/env node
/**
 * G2: классы 1–4 (Воин, Волшебник, Плут, Жрец) × уровни 1–2.
 * Запуск: node scripts/content/batches/g2-classes-1-4.mjs
 * DRY_RUN=1 — без записи. После: node scripts/coverage-report.mjs
 */
import { createSeeder } from '../seed-framework.mjs';

const SNEAK_ATTACK = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{
      kind: 'narrative',
      description: 'Раз в ход добавляйте к урону атаки d6 при преимуществе или союзнике в 5 фт от цели.',
    }],
  }],
};

const ROGUE_EXPERTISE = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'rogue_expertise_l1',
    prompt: 'Выберите 2 навыка для экспертизы',
    count: 2,
    options: { source: 'skill', filter: 'proficient' },
    grant: { kind: 'grant_proficiency', prof: 'skill', expert: true },
    resolution: 'on_acquire',
  }],
};

const CLERIC_SPELLCASTING = {
  activation: { mode: 'passive' },
  effects: [
    { resolution: 'auto', result: [{ kind: 'narrative', description: 'Подготовка заклинаний жреца. МДР — характеристика заклинаний.' }] },
    {
      kind: 'choice',
      id: 'cleric_cantrips',
      prompt: 'Выберите 3 заговора жреца',
      count: 3,
      options: { source: 'spell', filter: { classes: ['cleric'], levels: [0] } },
      grant: { kind: 'grant_spell', label: 'cantrip' },
      resolution: 'on_acquire',
    },
    {
      kind: 'choice',
      id: 'cleric_spells_l1',
      prompt: 'Выберите 4 заклинания 1 уровня для подготовки',
      count: 4,
      options: { source: 'spell', filter: { classes: ['cleric'], levels: [1] } },
      grant: { kind: 'grant_spell', label: 'prepared' },
      resolution: 'on_acquire',
    },
  ],
};

const DIVINE_ORDER = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'cleric_divine_order',
    prompt: 'Божественный порядок',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        { id: 'protector', name: 'Защитник', grants: [{ kind: 'narrative', description: 'Владение тяжёлыми доспехами и военным оружием.' }] },
        { id: 'thaumaturge', name: 'Тaumaturge', grants: [{ kind: 'narrative', description: 'Дополнительный заговор и бонус к магическому урону/лечению.' }] },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const ACTION_SURGE = {
  activation: { mode: 'active', cost: [{ resource: 'action_surge', amount: 1 }] },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Получите одно дополнительное действие в этот ход.' }],
  }],
};

const TACTICAL_MIND = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Потратьте кость второго дыхания, чтобы добавить 1d10 к проваленной проверке с владением.' }],
  }],
};

const SCHOLAR = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Выберите навык: экспертиза или владение инструментом каллиграфа.' }],
  }],
};

const CUNNING_ACTION = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Бонусным действием: Рывок, Отступление или Засada.' }],
  }],
};

const CHANNEL_DIVINITY = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Канал божественности (1/короткий отдых): эффект божественного домена.' }],
  }],
};

async function main() {
  const seeder = await createSeeder();
  console.log(`G2 batch (dryRun=${seeder.dryRun})`);

  const sneakId = (await seeder.upsertEffect({
    cardNumber: 'EFF-sneak-attack',
    name: 'Скрытая атака',
    description: 'Дополнительный урон при условиях.',
    mechanics: SNEAK_ATTACK,
  })).id;

  const expertiseId = (await seeder.upsertEffect({
    cardNumber: 'EFF-rogue-expertise',
    name: 'Экспертиза',
    description: 'Экспертиза в двух навыках.',
    mechanics: ROGUE_EXPERTISE,
  })).id;

  const clericSpellId = (await seeder.upsertEffect({
    cardNumber: 'EFF-cleric-spellcasting',
    name: 'Использование заклинаний (жрец)',
    description: 'Заговоры и подготовленные заклинания.',
    mechanics: CLERIC_SPELLCASTING,
  })).id;

  const divineOrderId = (await seeder.upsertEffect({
    cardNumber: 'EFF-divine-order',
    name: 'Божественный порядок',
    description: 'Защитник или Тaumaturge.',
    mechanics: DIVINE_ORDER,
  })).id;

  const actionSurgeId = (await seeder.upsertAction({
    cardNumber: 'ACT-action-surge',
    name: 'Всплеск действий',
    description: 'Дополнительное действие (1/длинный отдых).',
    resource: 'action',
    resources: ['action'],
    mechanics: ACTION_SURGE,
  })).id;

  const tacticalMindId = (await seeder.upsertEffect({
    cardNumber: 'EFF-tactical-mind',
    name: 'Тактический ум',
    description: 'Перераспределение второго дыхания на проверки.',
    mechanics: TACTICAL_MIND,
  })).id;

  const scholarId = (await seeder.upsertEffect({
    cardNumber: 'EFF-wizard-scholar',
    name: 'Учёный',
    description: 'Экспертиза или каллиграфия на 2 уровне.',
    mechanics: SCHOLAR,
  })).id;

  const cunningId = (await seeder.upsertEffect({
    cardNumber: 'EFF-cunning-action',
    name: 'Хитрое действие',
    description: 'Рывок, Отступление или Засada бонусным действием.',
    mechanics: CUNNING_ACTION,
  })).id;

  const channelId = (await seeder.upsertEffect({
    cardNumber: 'EFF-channel-divinity',
    name: 'Канал божественности',
    description: 'Божественная сила жреца.',
    mechanics: CHANNEL_DIVINITY,
  })).id;

  await seeder.upsertClass({
    cardNumber: 'CLASS-rogue',
    name: 'Плут',
    description: 'Мастер скрытности и точных ударов.',
    hit_die: 'd8',
    primary_abilities: ['dex'],
    saving_throws: ['dex', 'int'],
    skill_choices: {
      count: 4,
      options: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'],
    },
    level_progression: {
      1: { effects: [sneakId, expertiseId], actions: [] },
      2: { effects: [cunningId], actions: [] },
    },
  });

  await seeder.upsertClass({
    cardNumber: 'CLASS-cleric',
    name: 'Жрец',
    description: 'Посредник между смертными и божественным.',
    hit_die: 'd8',
    primary_abilities: ['wis'],
    saving_throws: ['wis', 'cha'],
    skill_choices: {
      count: 2,
      options: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
    },
    level_progression: {
      1: { effects: [clericSpellId, divineOrderId], actions: [] },
      2: { effects: [channelId], actions: [] },
    },
  });

  const warrior = seeder.find('CLASS-warrior');
  if (warrior) {
    const prog = { ...(warrior.level_progression || {}) };
    prog['2'] = {
      effects: [tacticalMindId],
      actions: [actionSurgeId],
    };
    await seeder.patchClass('CLASS-warrior', {
      resources: {
        second_wind: { count: 2, per: 'short_rest' },
        action_surge: { count: 1, per: 'long_rest' },
      },
      level_progression: prog,
    });
  }

  const wizard = seeder.find('CLASS-wizard');
  if (wizard) {
    const prog = { ...(wizard.level_progression || {}) };
    prog['2'] = { effects: [scholarId], actions: [] };
    await seeder.patchClass('CLASS-wizard', { level_progression: prog });
  }

  console.log('Готово:', seeder.stats);
  console.log('Проверка: node scripts/coverage-report.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
