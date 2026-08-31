#!/usr/bin/env node
/**
 * Исправления по ручной приёмке micro-micro-MVP от 2026-07-30.
 *
 * Dry-run:
 *   node scripts/content/fix-micro-micro-qa-2026-07-30.mjs
 * Запись в API:
 *   node scripts/content/fix-micro-micro-qa-2026-07-30.mjs --apply
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const dryRun = !process.argv.includes('--apply');

const SKILLS = [
  ['athletics', 'Атлетика'], ['acrobatics', 'Акробатика'],
  ['sleight_of_hand', 'Ловкость рук'], ['stealth', 'Скрытность'],
  ['arcana', 'Тайная магия'], ['history', 'История'],
  ['investigation', 'Расследование'], ['nature', 'Природа'],
  ['religion', 'Религия'], ['animal_handling', 'Уход за животными'],
  ['insight', 'Проницательность'], ['medicine', 'Медицина'],
  ['perception', 'Восприятие'], ['survival', 'Выживание'],
  ['deception', 'Обман'], ['intimidation', 'Запугивание'],
  ['performance', 'Выступление'], ['persuasion', 'Убеждение'],
];

const DRAGON_LINEAGES = [
  ['Чёрный', 'кислота'], ['Синий', 'молния'], ['Латунный', 'огонь'],
  ['Бронзовый', 'молния'], ['Медный', 'кислота'], ['Золотой', 'огонь'],
  ['Зелёный', 'яд'], ['Красный', 'огонь'], ['Серебряный', 'холод'],
  ['Белый', 'холод'],
].map(([name, damage]) => ({
  name,
  description: `Сопротивление и оружие дыхания: ${damage}.`,
}));

const divineOrder = {
  activation: { mode: 'passive' },
  effects: [{
    kind: 'choice',
    id: 'cleric_divine_order',
    prompt: 'Божественный порядок',
    count: 1,
    options: {
      source: 'explicit',
      items: [
        {
          id: 'protector',
          name: 'Защитник',
          grants: [
            { kind: 'grant_proficiency', prof: 'armor', value: 'heavy' },
            { kind: 'grant_proficiency', prof: 'weapon', value: 'martial' },
          ],
        },
        {
          id: 'thaumaturge',
          name: 'Чудотворец',
          grants: [
            {
              kind: 'choice',
              id: 'cleric_thaumaturge_cantrip',
              prompt: 'Дополнительный заговор жреца',
              count: 1,
              options: { source: 'spell', filter: { classes: ['жрец'], levels: [0] } },
              grant: { kind: 'grant_spell', label: 'cantrip' },
              resolution: 'on_acquire',
            },
            {
              kind: 'modifier',
              applies_to: { roll: 'ability_check', filter: { skill: 'arcana' } },
              op: 'add',
              value: 'max(1,wis)',
              source: 'Чудотворец',
            },
            {
              kind: 'modifier',
              applies_to: { roll: 'ability_check', filter: { skill: 'religion' } },
              op: 'add',
              value: 'max(1,wis)',
              source: 'Чудотворец',
            },
          ],
        },
      ],
    },
    resolution: 'on_acquire',
  }],
};

const guidance = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    kind: 'choice',
    id: 'guidance_skill',
    context: 'in_play',
    prompt: 'Выберите навык для Наставления',
    count: 1,
    who: 'target',
    options: {
      source: 'explicit',
      items: SKILLS.map(([id, name]) => ({
        id,
        name,
        grants: [{
          kind: 'modifier',
          applies_to: { roll: 'ability_check', filter: { skill: id } },
          op: 'bonus_die',
          faces: 4,
          source: 'Наставление',
          duration: { type: 'rounds', amount: 10, concentration: true },
        }],
      })),
    },
    resolution: 'immediate',
  }],
  targeting: { shape: 'single', range: 'Касание', filter: 'creature' },
};

const bless = {
  activation: {
    mode: 'active',
    cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }],
  },
  effects: [{
    resolution: 'auto',
    who: 'target',
    result: [
      {
        kind: 'modifier',
        applies_to: { roll: 'attack' },
        op: 'bonus_die',
        faces: 4,
        source: 'Благословение',
        duration: { type: 'rounds', amount: 10, concentration: true },
      },
      {
        kind: 'modifier',
        applies_to: { roll: 'saving_throw' },
        op: 'bonus_die',
        faces: 4,
        source: 'Благословение',
        duration: { type: 'rounds', amount: 10, concentration: true },
      },
    ],
  }],
  targeting: { shape: 'single', range: '30 футов', filter: 'creature' },
};

const sleep = {
  activation: {
    mode: 'active',
    cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }],
  },
  effects: [{
    resolution: 'save',
    ability: 'wis',
    dc: '8+prof+spellcasting',
    who: 'target',
    automatic_success: {
      if_sleep_not_required: true,
      if_condition_immunity: 'exhaustion',
    },
    on_fail: [{
      kind: 'condition',
      value: 'incapacitated',
      op: 'apply',
      duration: { type: 'rounds', amount: 10, concentration: true },
      causeTags: ['spell', 'magical', 'sleep'],
      end_triggers: ['actor_takes_damage', 'wake_action_within_5_ft'],
      save_ends: {
        timing: 'end_of_turn',
        ability: 'wis',
        dc: '8+prof+spellcasting',
        on_failure_condition: 'unconscious',
      },
    }],
    on_success: [],
  }],
  targeting: {
    shape: 'area',
    area: { kind: 'sphere', size: 5 },
    range: '60 футов',
    filter: 'creature',
  },
};

const alert = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [
      {
        kind: 'modifier',
        applies_to: { roll: 'initiative' },
        op: 'add',
        value: 'prof_bonus',
        source: 'Бонус мастерства',
        modifier_kind: 'proficiency',
      },
      {
        kind: 'narrative',
        description: 'После броска инициативы вы можете поменяться инициативой с согласным союзником.',
      },
    ],
  }],
};

function halfDamage(mechanics, dice, type) {
  const next = structuredClone(mechanics || {});
  const resolution = (next.effects || []).find((item) => item.resolution === 'save')
    || (next.effects || [])[0];
  if (!resolution) throw new Error(`Не найден save-resolution для ${type}`);
  const failDamage = (resolution.on_fail || []).find((payload) => payload.kind === 'damage');
  const damage = failDamage
    ? { ...structuredClone(failDamage), on_success: 'half' }
    : { kind: 'damage', dice, type, on_success: 'half' };
  resolution.on_success = [damage];
  return next;
}

async function main() {
  console.log(`${dryRun ? 'DRY-RUN' : 'APPLY'} micro-micro QA`);
  const [effects, spells, races] = await Promise.all([
    fetchAll('/api/effects', 'effects', { limit: 1000 }),
    fetchAll('/api/spells', 'spells', { limit: 1000 }),
    fetchAll('/api/races', 'races', { limit: 1000 }),
  ]);
  const find = (items, card, label) => {
    const entity = items.find((item) => item.card_number === card);
    if (!entity) throw new Error(`${label} не найден: ${card}`);
    return entity;
  };
  const effect = (card) => find(effects, card, 'Эффект');
  const spell = (card) => find(spells, card, 'Заклинание');
  const race = (card) => find(races, card, 'Вид');
  const token = dryRun ? null : await login();
  const put = async (endpoint, entity, body, label) => {
    console.log(`- ${label}`);
    await apiRequest(token, 'PUT', `/api/${endpoint}/${entity.id}`, body, { dryRun });
  };

  await put('effects', effect('fs_defense'), {
    mechanics: {
      activation: { mode: 'passive' },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'ac' },
          op: 'add',
          value: '+1',
          source: 'Боевой стиль: Оборона',
          when: [{ kind: 'wearing_armor' }],
        }],
      }],
    },
  }, 'Оборона: +1 КЗ только в доспехе');

  await put('effects', effect('EFF-divine-order'), { mechanics: divineOrder }, 'Божественный порядок');
  await put('effects', effect('EFF-alert'), { mechanics: alert }, 'Бдительный: Бонус мастерства');
  await put('spells', spell('SPELL-0230'), { mechanics: guidance }, 'Наставление');
  await put('spells', spell('SPELL-0163'), { mechanics: bless }, 'Благословение');
  await put('spells', spell('SPELL-0311'), { mechanics: sleep }, 'Усыпление');

  const burningHands = spell('SPELL-0242');
  await put('spells', burningHands, {
    mechanics: halfDamage(burningHands.mechanics, '3d6', 'fire'),
  }, 'Огненные ладони: половина урона при успехе');
  const thunderwave = spell('SPELL-0171');
  await put('spells', thunderwave, {
    mechanics: halfDamage(thunderwave.mechanics, '2d8', 'thunder'),
  }, 'Волна грома: половина урона при успехе');

  const dragonborn = race('RACE-0008');
  const flight = effect('RE-dragonborn-4');
  const relatedEffects = (dragonborn.related_effects || []).filter((id) => id !== flight.id);
  const levelProgression = structuredClone(dragonborn.level_progression || {});
  levelProgression['5'] = {
    ...(levelProgression['5'] || {}),
    effects: Array.from(new Set([...(levelProgression['5']?.effects || []), flight.id])),
    actions: levelProgression['5']?.actions || [],
  };
  await put('effects', flight, {
    mechanics: {
      ...flight.mechanics,
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'grant_speed', mode: 'fly', value: 'character_speed' }],
      }],
    },
  }, 'Драконий полёт: скорость равна скорости ходьбы');
  await put('races', dragonborn, {
    related_effects: relatedEffects,
    level_progression: levelProgression,
    lineages: DRAGON_LINEAGES,
  }, 'Драконорождённый: наследия и Полёт с 5 уровня');

  console.log('Готово. Подвиды драконорождённого и эльфа уже содержат механические эффекты; после тестов им требуется обновить сертификацию.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
