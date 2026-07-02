#!/usr/bin/env node
/**
 * G5: lineages для 12 видов + контент warforged/tabaxi + оружие дыхания.
 * Запуск: node scripts/content/batches/g5-races-lineages.mjs
 */
import { createSeeder } from '../seed-framework.mjs';
import { fetchAll } from '../api.mjs';

/** Извлечь подвиды из choice options.source=subfeature в эффекте. */
function lineagesFromEffect(effect) {
  const effects = effect?.mechanics?.effects;
  if (!Array.isArray(effects)) return null;
  for (const block of effects) {
    const results = block.result ?? block.results;
    const choices = block.kind === 'choice' ? [block] : (Array.isArray(results) ? results : []);
    for (const ch of choices) {
      if (ch?.kind !== 'choice') continue;
      const items = ch.options?.items;
      if (!Array.isArray(items) || ch.options?.source !== 'subfeature') continue;
      return items.map((it) => ({
        name: String(it.name || it.id),
        description: (it.grants?.[0]?.description || it.grants?.[0]?.kind || '').toString().slice(0, 200)
          || `Подвид: ${it.name || it.id}`,
      }));
    }
  }
  return null;
}

/** Статические lineages (fallback / дополнение). */
const STATIC_LINEAGES = {
  'RACE-0004': [
    { name: 'Дроу', description: 'Тёмные эльфы Подземья: тёмное зрение 120 фт, заговоры и заклинания drow.' },
    { name: 'Высший эльф', description: 'Магически одарённые эльфы с заговорами и заклинаниями high elf.' },
    { name: 'Лесной эльф', description: 'Быстрые стражи лесов: скорость 35 фт, druidcraft и следопытские заклинания.' },
  ],
  'RACE-0005': [
    { name: 'Лесной гном', description: 'Говорят с мелкими зверями, знают minor illusion.' },
    { name: 'Скальный гном', description: 'Выносливые ремесленники, знают mending.' },
  ],
  'RACE-0003': [
    { name: 'Горный дворф', description: 'Мастера камня и стали, владение доспехами.' },
    { name: 'Холмовой дворф', description: 'Выносливые и мудрые, бонус к хитам.' },
  ],
  'RACE-0006': [
    { name: 'Легконогий', description: 'Скрытные путешественники, скрытность среди существ крупнее.' },
    { name: 'Крепкий', description: 'Устойчивые к яду и страху, повышенная стойкость.' },
  ],
  'RACE-0002': [
    { name: 'Человек', description: 'Универсальный вид: +1 к двум характеристикам, черта происхождения, навык.' },
  ],
  'RACE-0008': [
    { name: 'Чёрный', description: 'Кислотное дыхание и сопротивление кислоте.' },
    { name: 'Латунный', description: 'Огненное дыхание и сопротивление огню.' },
    { name: 'Бронзовый', description: 'Электрическое дыхание и сопротивление молнии.' },
    { name: 'Медный', description: 'Кислотное дыхание и сопротивление кислоте.' },
    { name: 'Золотой', description: 'Огненное дыхание и сопротивление огню.' },
    { name: 'Зелёный', description: 'Ядовитое дыхание и сопротивление яду.' },
    { name: 'Красный', description: 'Огненное дыхание и сопротивление огню.' },
    { name: 'Серебряный', description: 'Холодное дыхание и сопротивление холоду.' },
    { name: 'Белый', description: 'Холодное дыхание и сопротивление холоду.' },
    { name: 'Синий', description: 'Электрическое дыхание и сопротивление молнии.' },
  ],
  'RACE-0009': [
    { name: 'Бездонный', description: 'Сопр. яд, poison spray и ray of sickness.' },
    { name: 'Хтонический', description: 'Сопр. некротика, chill touch и false life.' },
    { name: 'Инфернальный', description: 'Сопр. огню, fire bolt и hellish rebuke.' },
  ],
  'RACE-0010': [
    { name: 'Защитник', description: 'Небесная душа, исцеляющие руки и светоч.' },
    { name: 'Карающий', description: 'Небесный гнев, урон излучением при трансформации.' },
    { name: 'Падший', description: 'Некrotic урон при небесном откровении.' },
  ],
  'RACE-0011': [
    { name: 'Облачный великан', description: 'Телекинез и перемещение союзников.' },
    { name: 'Огненный великан', description: 'Урон огнём и сопротивление огню.' },
    { name: 'Морозный великан', description: 'Урон холодом и сопротивление холоду.' },
    { name: 'Холмовой великан', description: 'Устойчивость и скрытность среди камней.' },
    { name: 'Каменный великан', description: 'Перенос груза и стойкость.' },
  ],
  'RACE-0007': [
    { name: 'Орк', description: 'Адреналиновый рывок и неумолимая стойкость.' },
  ],
  warforged: [
    { name: 'Кованый', description: 'Живой конструкт: встроенная защита, отдых без сна.' },
  ],
  tabaxi: [
    { name: 'Табакси', description: 'Кошачьи искатели приключений: ловкость, когти, всплеск скорости.' },
  ],
};

const WARFORGED_CONSTRUCTED = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [
      { kind: 'narrative', description: 'Конструкт: иммунитет к болезням, не нужен воздух/еда/сон, сопр. яду (с помехой на спасброски).' },
      { kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: 1 },
    ],
  }],
};

const WARFORGED_SENTRY = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Отдых: 6 часов бодрствования = длинный отдых (часть часов — лёгкая активность).' }],
  }],
};

const TABAXI_DARKVISION = {
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{ kind: 'grant_sense', sense: 'darkvision', range: 60 }] }],
};

const TABAXI_FELINE = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Лазание 20 фт, ваша скорость лазания равна скорости ходьбы.' }],
  }],
};

const TABAXI_CLAWS = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'narrative', description: 'Безоружный удар когтями: 1d6 + СИЛ рубящий урон.' }],
  }],
};

const TABAXI_AGILITY = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
  uses: { count: 'prof_bonus', per: 'long_rest' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'movement', mode: 'walk', value: 'double', duration: { type: 'until_end_of_turn' } }],
  }],
  targeting: { shape: 'self' },
};

async function resolveLineagesForRace(race, effectIndex) {
  for (const eid of race.related_effects || []) {
    const eff = effectIndex.get(eid);
    const fromMech = eff ? lineagesFromEffect(eff) : null;
    if (fromMech?.length) return fromMech;
  }
  return STATIC_LINEAGES[race.card_number] || [{ name: race.name, description: race.description?.slice(0, 160) || race.name }];
}

async function main() {
  const seeder = await createSeeder();
  console.log(`G5 batch (dryRun=${seeder.dryRun})`);

  const allEffects = await fetchAll('/api/effects', 'effects');
  const effectIndex = new Map();
  for (const e of allEffects) {
    if (e.id) effectIndex.set(e.id, e);
    if (e.card_number) effectIndex.set(e.card_number, e);
  }

  // warforged + tabaxi контент
  const wf1 = (await seeder.upsertEffect({
    cardNumber: 'EFF-warforged-constructed',
    name: 'Конструкт',
    description: 'Особенности конструкта.',
    mechanics: WARFORGED_CONSTRUCTED,
  })).id;

  const wf2 = (await seeder.upsertEffect({
    cardNumber: 'EFF-warforged-sentry-rest',
    name: 'Часовой отдых',
    description: 'Отдых без сна.',
    mechanics: WARFORGED_SENTRY,
  })).id;

  const tb1 = (await seeder.upsertEffect({
    cardNumber: 'EFF-tabaxi-darkvision',
    name: 'Тёмное зрение (табакси)',
    description: '60 фт.',
    mechanics: TABAXI_DARKVISION,
  })).id;

  const tb2 = (await seeder.upsertEffect({
    cardNumber: 'EFF-tabaxi-feline',
    name: 'Кошачья ловкость',
    description: 'Лазание.',
    mechanics: TABAXI_FELINE,
  })).id;

  const tb3 = (await seeder.upsertEffect({
    cardNumber: 'EFF-tabaxi-claws',
    name: 'Кошачьи когти',
    description: 'Безоружный удар 1d6.',
    mechanics: TABAXI_CLAWS,
  })).id;

  const tb4 = (await seeder.upsertEffect({
    cardNumber: 'EFF-tabaxi-agility',
    name: 'Кошачья проворность',
    description: 'Удвоение скорости бонусным действием.',
    mechanics: TABAXI_AGILITY,
  })).id;

  await seeder.mergeRaceRefs('warforged', { effects: [wf1, wf2] });
  await seeder.mergeRaceRefs('tabaxi', { effects: [tb1, tb2, tb3, tb4] });

  // Оружие дыхания — дублируем как action для related_actions (F1)
  const breathEffect = effectIndex.get('RE-dragonborn-3');
  if (breathEffect?.mechanics) {
    const breathAct = await seeder.upsertAction({
      cardNumber: 'ACT-breath-weapon',
      name: 'Оружие дыхания',
      description: breathEffect.description || 'Конусное дыхание, спасбросок Ловкости.',
      resource: 'action',
      resources: ['action'],
      mechanics: breathEffect.mechanics,
    });
    await seeder.mergeRaceRefs('RACE-0008', { actions: [breathAct.id] });
  }

  // lineages для всех видов
  for (const race of seeder.races) {
    const lineages = await resolveLineagesForRace(race, effectIndex);
    await seeder.patchRace(race.card_number, { lineages });
    console.log(`  ${race.card_number}: ${lineages.length} lineages`);
  }

  console.log('Готово:', seeder.stats);
  console.log('Проверка: node scripts/coverage-report.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
