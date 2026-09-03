import { LEVEL3_MINI_MVP_MANIFEST } from './level3-mini-mvp-manifest.mjs';

/**
 * Reviewed PHB 2024 mini-MVP denominator through character level 5.
 *
 * This manifest is intentionally independent from database row counts. The
 * imported level-3 list is the reviewed PHB catalog; the two known homebrew
 * spells (SPELL-0483 and SPELL-0485) are deliberately outside this scope.
 */

const frozen = (value) => Object.freeze(value);

const catalogEntity = (cardNumber, label, expected = {}) => frozen({
  key: cardNumber.toLowerCase(),
  label,
  selector: frozen({ cardNumber }),
  expected: frozen({ source: 'PHB 2024', ...expected }),
});

const featureGate = (parentCardNumber, level, featureKey, label, expected = {}) => frozen({
  key: `${parentCardNumber}:${level}:${featureKey}`.toLowerCase(),
  label,
  selector: frozen({ parentCardNumber, level, featureKey }),
  expected: frozen({ source: 'SRD 5.2.1', parentCardNumber, level, ...expected }),
});

const rows = (values, expected = {}) => frozen(values.map(([cardNumber, label, extra]) => (
  catalogEntity(cardNumber, label, { ...expected, ...(extra ?? {}) })
)));

export const LEVEL5_MINI_MVP_MANIFEST_SCHEMA_VERSION = 1;

export const LEVEL5_MINI_MVP_COLLECTION_SIZES = frozen({
  baseClasses: 12,
  baseClassFeatureGates: 33,
  subclasses: 48,
  speciesUnlocks: 15,
  generalFeats: 43,
  secondLevelSpells: 63,
  thirdLevelSpells: 52,
});

const baseClasses = frozen(LEVEL3_MINI_MVP_MANIFEST.collections.baseClasses.map((entry) => frozen({
  ...entry,
  expected: frozen({ ...entry.expected, throughLevel: 5 }),
})));

const subclasses = frozen(LEVEL3_MINI_MVP_MANIFEST.collections.subclasses.map((entry) => frozen({
  ...entry,
  expected: frozen({
    ...entry.expected,
    unlockLevel: 3,
    throughLevel: 5,
    // No PHB subclass receives another named feature before class level 6;
    // level-5 always-prepared subclass spells still belong to this row.
    namedFeatureLevels: frozen([3]),
    auditPreparedSpellGrantLevels: frozen([3, 5]),
  }),
})));

const asi = (parentCardNumber, label) => featureGate(
  parentCardNumber,
  4,
  'ability-score-improvement',
  `${label}: Увеличение характеристик`,
  { choice: 'ability-scores-or-eligible-general-feat' },
);

const baseClassFeatureGates = frozen([
  featureGate('CLASS-barbarian', 3, 'primal-knowledge', 'Варвар: Первобытное знание'),
  asi('CLASS-barbarian', 'Варвар'),
  featureGate('CLASS-barbarian', 5, 'extra-attack', 'Варвар: Дополнительная атака', { attacksPerAttackAction: 2 }),
  featureGate('CLASS-barbarian', 5, 'fast-movement', 'Варвар: Быстрое передвижение', { speedBonusFt: 10, forbiddenArmor: 'heavy' }),

  asi('CLASS-bard', 'Бард'),
  featureGate('CLASS-bard', 5, 'font-of-inspiration', 'Бард: Источник вдохновения', { bardicDie: 'd8', recovery: 'short-or-long-rest', slotConversion: true }),

  asi('CLASS-cleric', 'Жрец'),
  featureGate('CLASS-cleric', 5, 'sear-undead', 'Жрец: Испепеление нежити', { damage: 'wisdom-modifier-d8s' }),

  asi('CLASS-druid', 'Друид'),
  featureGate('CLASS-druid', 5, 'wild-resurgence', 'Друид: Дикое возрождение', { converts: ['spell-slot-to-wild-shape', 'wild-shape-to-level-1-slot'] }),

  asi('CLASS-warrior', 'Воин'),
  featureGate('CLASS-warrior', 5, 'extra-attack', 'Воин: Дополнительная атака', { attacksPerAttackAction: 2 }),
  featureGate('CLASS-warrior', 5, 'tactical-shift', 'Воин: Тактическое перемещение', { trigger: 'second-wind', movement: 'half-speed-no-opportunity-attacks' }),

  featureGate('CLASS-monk', 3, 'deflect-attacks', 'Монах: Отражение атак'),
  asi('CLASS-monk', 'Монах'),
  featureGate('CLASS-monk', 4, 'slow-fall', 'Монах: Медленное падение', { trigger: 'reaction-when-falling' }),
  featureGate('CLASS-monk', 5, 'extra-attack', 'Монах: Дополнительная атака', { attacksPerAttackAction: 2, martialArtsDie: 'd8' }),
  featureGate('CLASS-monk', 5, 'stunning-strike', 'Монах: Оглушающий удар', { limit: 'once-per-turn', cost: '1-focus-point' }),

  featureGate('CLASS-paladin', 3, 'channel-divinity', 'Паладин: Божественный канал', { uses: 2 }),
  asi('CLASS-paladin', 'Паладин'),
  featureGate('CLASS-paladin', 5, 'extra-attack', 'Паладин: Дополнительная атака', { attacksPerAttackAction: 2 }),
  featureGate('CLASS-paladin', 5, 'faithful-steed', 'Паладин: Верный скакун', { alwaysPreparedSpell: 'find_steed', freeCast: 'once-per-long-rest' }),

  asi('CLASS-ranger', 'Следопыт'),
  featureGate('CLASS-ranger', 5, 'extra-attack', 'Следопыт: Дополнительная атака', { attacksPerAttackAction: 2, favoredEnemyUses: 3 }),

  featureGate('CLASS-rogue', 3, 'steady-aim', 'Плут: Верный прицел'),
  asi('CLASS-rogue', 'Плут'),
  featureGate('CLASS-rogue', 5, 'cunning-strike', 'Плут: Хитрый удар', { sneakAttack: '3d6', options: ['poison', 'trip', 'withdraw'] }),
  featureGate('CLASS-rogue', 5, 'uncanny-dodge', 'Плут: Невероятное уклонение', { trigger: 'reaction-on-visible-attacker-hit' }),

  asi('CLASS-sorcerer', 'Чародей'),
  featureGate('CLASS-sorcerer', 5, 'sorcerous-restoration', 'Чародей: Чародейское восстановление', { sorceryPoints: 5, recovery: 'short-rest-or-initiative-when-empty' }),

  asi('CLASS-warlock', 'Колдун'),

  asi('CLASS-wizard', 'Волшебник'),
  featureGate('CLASS-wizard', 5, 'memorize-spell', 'Волшебник: Запоминание заклинания', { activation: 'bonus-action', recovery: 'short-or-long-rest' }),
]);

const levelThreeSpeciesUnlocks = LEVEL3_MINI_MVP_MANIFEST.collections.speciesUnlocks;
const levelFiveSpeciesUnlocks = rows([
  ['RACE-0008', 'Драконорождённый: Драконьи крылья', { featureKey: 'draconic-flight' }],
  ['RACE-0011', 'Голиаф: Крупная форма', { featureKey: 'large-form' }],
  ['sub-drow', 'Дроу: Тьма', { spellCardNumber: 'darkness' }],
  ['sub-high_elf', 'Высший эльф: Туманный шаг', { spellCardNumber: 'misty_step' }],
  ['sub-wood_elf', 'Лесной эльф: Бесследное передвижение', { spellCardNumber: 'pass_without_trace' }],
  ['sub-abyssal', 'Тифлинг Бездны: Удержание личности', { spellCardNumber: 'hold_person' }],
  ['sub-chthonic', 'Хтонический тифлинг: Луч слабости', { spellCardNumber: 'ray_of_enfeeblement' }],
  ['sub-infernal', 'Инфернальный тифлинг: Тьма', { spellCardNumber: 'darkness' }],
], { level: 5 });

const generalFeats = rows([
  ['FEAT-0011', 'Амбидекстр'], ['FEAT-0012', 'Артистичный'],
  ['FEAT-0013', 'Атлетичный'], ['FEAT-0014', 'Боевой заклинатель'],
  ['FEAT-0015', 'Борец'], ['FEAT-0016', 'Быстрый'],
  ['FEAT-0017', 'Верховой боец'], ['FEAT-0018', 'Внимательный'],
  ['FEAT-0019', 'Воинская подготовка'], ['FEAT-0020', 'Воодушевляющий лидер'],
  ['FEAT-0021', 'Затронутый тенью'], ['FEAT-0022', 'Затронутый феями'],
  ['FEAT-0023', 'Знаток лёгких доспехов'], ['FEAT-0024', 'Знаток средних доспехов'],
  ['FEAT-0025', 'Знаток тяжёлых доспехов'], ['FEAT-0026', 'Крушитель'],
  ['FEAT-0027', 'Мастер большого оружия'], ['FEAT-0028', 'Мастер древкового оружия'],
  ['FEAT-0029', 'Мастер оружия'], ['FEAT-0030', 'Мастер средних доспехов'],
  ['FEAT-0031', 'Мастер тяжёлых доспехов'], ['FEAT-0032', 'Мастер щитов'],
  ['FEAT-0033', 'Меткий заклинатель'], ['FEAT-0034', 'Меткий стрелок'],
  ['FEAT-0035', 'Налётчик'], ['FEAT-0036', 'Обороняющийся дуэлянт'],
  ['FEAT-0037', 'Острый ум'], ['FEAT-0038', 'Отравитель'],
  ['FEAT-0039', 'Пронзатель'], ['FEAT-0040', 'Проныра'],
  ['FEAT-0041', 'Ритуальный заклинатель'], ['FEAT-0042', 'Рубака'],
  ['FEAT-0043', 'Стихийный адепт'], ['FEAT-0044', 'Стойкий'],
  ['FEAT-0045', 'Страж'], ['FEAT-0046', 'Телекинетик'],
  ['FEAT-0047', 'Телепат'], ['FEAT-0048', 'Убийца магов'],
  ['FEAT-0049', 'Увеличение характеристик'], ['FEAT-0050', 'Устойчивый'],
  ['FEAT-0051', 'Шеф-повар'], ['FEAT-0052', 'Эксперт в арбалетах'],
  ['FEAT-0053', 'Эксперт в навыке'],
], { category: 'general', unlockLevel: 4 });

const secondLevelSpells = frozen(LEVEL3_MINI_MVP_MANIFEST.collections.secondLevelSpells
  .filter((entry) => entry.selector.cardNumber !== 'SPELL-0483'));

const thirdLevelSpells = rows([
  ['animate_dead', 'Поднятие мертвеца'], ['aura_of_vitality', 'Аура живучести'],
  ['beacon_of_hope', 'Маяк надежды'], ['bestow_curse', 'Проклятие'],
  ['blinding_smite', 'Ослепляющая кара'], ['blink', 'Мерцание'],
  ['call_lightning', 'Призыв молнии'], ['clairvoyance', 'Подсматривание'],
  ['conjure_animals', 'Призыв животных'], ['conjure_barrage', 'Призыв шквала снарядов'],
  ['counterspell', 'Контрзаклинание'], ['create_food_and_water', 'Сотворение пищи и воды'],
  ['crusaders_mantle', 'Мантия крестоносца'], ['daylight', 'Дневной свет'],
  ['dispel_magic', 'Рассеивание магии'], ['elemental_weapon', 'Стихийное оружие'],
  ['fear', 'Страх'], ['feign_death', 'Притворная смерть'],
  ['fireball', 'Огненный шар'], ['fly', 'Полёт'],
  ['gaseous_form', 'Газообразная форма'], ['glyph_of_warding', 'Охранная руна'],
  ['haste', 'Ускорение'], ['hunger_of_hadar', 'Голод Хадара'],
  ['hypnotic_pattern', 'Гипнотический узор'], ['leomunds_tiny_hut', 'Хижина Леомунда'],
  ['lightning_arrow', 'Молниевая стрела'], ['lightning_bolt', 'Молния'],
  ['magic_circle', 'Магический круг'], ['major_image', 'Образ'],
  ['mass_healing_word', 'Множественное лечащее слово'], ['meld_into_stone', 'Слияние с камнем'],
  ['nondetection', 'Необнаружимость'], ['phantom_steed', 'Призрачный скакун'],
  ['plant_growth', 'Рост растений'], ['protection_from_energy', 'Защита от энергии'],
  ['remove_curse', 'Снятие проклятья'], ['revivify', 'Возрождение'],
  ['sending', 'Послание'], ['sleet_storm', 'Метель'],
  ['slow', 'Замедление'], ['speak_with_dead', 'Разговор с мёртвыми'],
  ['speak_with_plants', 'Разговор с растениями'], ['spirit_guardians', 'Духовные стражи'],
  ['stinking_cloud', 'Зловонное облако'], ['summon_fey', 'Вызов феи'],
  ['summon_undead', 'Вызов нежити'], ['tongues', 'Языки'],
  ['vampiric_touch', 'Прикосновение вампира'], ['water_breathing', 'Подводное дыхание'],
  ['water_walk', 'Хождение по воде'], ['wind_wall', 'Стена ветров'],
], { level: 3 });

export const LEVEL5_MINI_MVP_MANIFEST = frozen({
  schemaVersion: LEVEL5_MINI_MVP_MANIFEST_SCHEMA_VERSION,
  manifestVersion: 'level5-mini-mvp-v1',
  release: 'mini-mvp-level5',
  systemId: 'dnd5e-2024',
  characterLevel: 5,
  collections: frozen({
    baseClasses,
    baseClassFeatureGates,
    subclasses,
    speciesUnlocks: frozen([...levelThreeSpeciesUnlocks, ...levelFiveSpeciesUnlocks]),
    generalFeats,
    secondLevelSpells,
    thirdLevelSpells,
  }),
});

export function flattenLevel5MiniMvpManifest(manifest = LEVEL5_MINI_MVP_MANIFEST) {
  return Object.entries(manifest.collections).flatMap(([collection, values]) => (
    values.map((value) => ({ ...value, collection }))
  ));
}

export function validateLevel5MiniMvpManifest(manifest = LEVEL5_MINI_MVP_MANIFEST) {
  const issues = [];
  if (manifest.schemaVersion !== LEVEL5_MINI_MVP_MANIFEST_SCHEMA_VERSION) issues.push('schemaVersion');
  if (manifest.release !== 'mini-mvp-level5') issues.push('release');
  if (manifest.systemId !== 'dnd5e-2024') issues.push('systemId');
  if (manifest.characterLevel !== 5) issues.push('characterLevel');
  for (const [collection, size] of Object.entries(LEVEL5_MINI_MVP_COLLECTION_SIZES)) {
    if (manifest.collections?.[collection]?.length !== size) {
      issues.push(`${collection}: expected ${size}, got ${manifest.collections?.[collection]?.length ?? 0}`);
    }
  }
  const entries = flattenLevel5MiniMvpManifest(manifest);
  const identities = entries.map((value) => [
    value.collection,
    value.key,
    value.expected?.level ?? '',
    value.expected?.featureKey ?? value.expected?.spellCardNumber ?? '',
  ].join(':'));
  if (new Set(identities).size !== identities.length) issues.push('duplicate collection identity');
  for (const collection of ['secondLevelSpells', 'thirdLevelSpells']) {
    const cards = manifest.collections[collection].map((entry) => entry.selector.cardNumber);
    if (new Set(cards).size !== cards.length) issues.push(`duplicate ${collection} card number`);
  }
  if (entries.some((entry) => ['SPELL-0483', 'SPELL-0485'].includes(entry.selector?.cardNumber))) {
    issues.push('homebrew spell leaked into PHB scope');
  }
  return issues;
}
