import type { SnapshotCatalogs } from './prodSnapshotL1Fixtures';
import { assertClassEquipmentReferenceClosure } from './classEquipmentReferenceIntegrity';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';

type JsonRecord = Record<string, unknown>;
type StableCollection = 'cards' | 'classes' | 'races' | 'effects' | 'actions' | 'spells';

/**
 * TEST-FIXTURE ONLY. Production runtime/compiler code must never import this
 * module; deployed authority remains the database migrations and declarative
 * content release.
 *
 * The checked-in production snapshot is intentionally immutable and predates
 * these database migrations. Browser fixtures consume this projection so they
 * exercise the same post-migration catalog shape as production without
 * rewriting the historical snapshot or teaching a test fixture game rules.
 * Migration 116 is deliberately not listed here: its half-caster mechanics are
 * owned by content patch 1.8.0, which the browser fixture materializes before
 * calling this structural projector.
 */
export const POST_SNAPSHOT_CATALOG_PROJECTION = {
  schemaVersion: 2,
  projectionId: 'prod-snapshot-structural-migrations-107-115-v2',
  migrations: [
    '107_normalize_live_happy_path_content',
    '108_split_weapon_actions_and_unlock_metadata',
    '109_normalize_goliath_ancestry',
    '110_deduplicate_goliath_ancestry',
    '111_align_ranged_weapon_action_declaration',
    '112_inherit_lineage_source',
    '113_repair_goliath_reaction_authority',
    '114_repair_class_starting_equipment_references',
    '115_repair_goliath_stone_targeting_contract',
  ],
} as const;

export class PostSnapshotCatalogProjectionError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Post-snapshot catalog projection failed:\n${problems.join('\n')}`);
    this.name = 'PostSnapshotCatalogProjectionError';
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rows(
  catalogs: SnapshotCatalogs,
  collection: StableCollection,
): JsonRecord[] {
  return catalogs[collection] as unknown as JsonRecord[];
}

function exactByCardNumber(
  catalogs: SnapshotCatalogs,
  collection: StableCollection,
  cardNumber: string,
): JsonRecord {
  const matches = rows(catalogs, collection).filter((row) => row.card_number === cardNumber);
  if (matches.length !== 1) {
    throw new PostSnapshotCatalogProjectionError([
      `${collection}:${cardNumber}: expected one stable identity, got ${matches.length}`,
    ]);
  }
  return matches[0];
}

function optionalByCardNumber(
  catalogs: SnapshotCatalogs,
  collection: StableCollection,
  cardNumber: string,
): JsonRecord | undefined {
  const matches = rows(catalogs, collection).filter((row) => row.card_number === cardNumber);
  if (matches.length > 1) {
    throw new PostSnapshotCatalogProjectionError([
      `${collection}:${cardNumber}: stable identity is duplicated`,
    ]);
  }
  return matches[0];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const GOLIATH_LINEAGES = [
  {
    id: 'b262a4c9-e303-472b-b347-e3fcb2fe93f1',
    cardNumber: 'RACE-0011-cloud', legacyCardNumber: 'sub-cloud',
    name: 'Наследие облачного великана', nameEn: "Cloud's Jaunt",
    description: 'Наследие великанов: облачный великан.',
    effectCardNumber: 'RE-sub-cloud', actionCardNumber: 'ACT-goliath-cloud',
  },
  {
    id: '1fc68a11-99de-4870-85ad-1cedf6e844e9',
    cardNumber: 'RACE-0011-fire', legacyCardNumber: 'sub-fire',
    name: 'Наследие огненного великана', nameEn: "Fire's Burn",
    description: 'Наследие великанов: огненный великан.',
    effectCardNumber: 'RE-sub-fire', actionCardNumber: 'ACT-goliath-fire',
  },
  {
    id: '6e28e3b3-9049-44ff-9458-6efedfaa3013',
    cardNumber: 'RACE-0011-frost', legacyCardNumber: 'sub-frost',
    name: 'Наследие ледяного великана', nameEn: "Frost's Chill",
    description: 'Наследие великанов: ледяной великан.',
    effectCardNumber: 'RE-sub-frost', actionCardNumber: 'ACT-goliath-frost',
  },
  {
    id: '593f8c23-6ca8-49ab-8f71-ff88c39e95c7',
    cardNumber: 'RACE-0011-hill', legacyCardNumber: 'sub-hill',
    name: 'Наследие холмового великана', nameEn: "Hill's Tumble",
    description: 'Наследие великанов: холмовой великан.',
    effectCardNumber: 'RE-sub-hill', actionCardNumber: 'ACT-goliath-hill',
  },
  {
    id: '0fc14aae-e914-46d4-9143-b71758494983',
    cardNumber: 'RACE-0011-stone', legacyCardNumber: 'sub-stone',
    name: 'Наследие каменного великана', nameEn: "Stone's Endurance",
    description: 'Наследие великанов: каменный великан.',
    effectCardNumber: 'RE-sub-stone', actionCardNumber: 'ACT-goliath-stone',
  },
  {
    id: '5f4be1d6-792c-4473-a7fa-3473528dea03',
    cardNumber: 'RACE-0011-storm', legacyCardNumber: 'sub-storm',
    name: 'Наследие штормового великана', nameEn: "Storm's Thunder",
    description: 'Наследие великанов: штормовой великан.',
    effectCardNumber: 'RE-sub-storm', actionCardNumber: 'ACT-goliath-storm',
  },
] as const;

const LEGACY_GOLIATH_CARD_NUMBERS = new Set(GOLIATH_LINEAGES.flatMap((lineage) => [
  lineage.legacyCardNumber,
  `RACE-GOLIATH-${lineage.cardNumber.split('-').at(-1)!.toUpperCase()}`,
]));

const selfTargeting = {
  domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0,
  max_targets: 1, range_ft: 0, requires_line_of_sight: false,
  allowed_relations: ['self'],
};

const hostileTargeting = (rangeFt = 600) => ({
  domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
  max_targets: 1, range_ft: rangeFt, requires_line_of_sight: true,
  allowed_relations: ['enemy', 'neutral'],
});

const GOLIATH_ACTION_MECHANICS: Readonly<Record<string, JsonRecord>> = {
  'ACT-goliath-cloud': {
    activation: {
      mode: 'active',
      cost: [{ resource: 'bonus_action', amount: 1 }, { resource: 'giant_legacy', amount: 1 }],
    },
    targeting: { ...selfTargeting, actor_targets: false },
    effects: [{ resolution: 'auto', result: [{ kind: 'movement', mode: 'teleport', distance: 30 }] }],
  },
  'ACT-goliath-fire': {
    activation: {
      mode: 'triggered', optional: true, trigger: { event: 'hit', timing: 'during' },
      cost: [{ resource: 'giant_legacy', amount: 1 }],
    },
    targeting: hostileTargeting(),
    effects: [{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', dice: '1d10', type: 'fire', ability: 'none' }],
    }],
  },
  'ACT-goliath-frost': {
    activation: {
      mode: 'triggered', optional: true, trigger: { event: 'hit', timing: 'during' },
      cost: [{ resource: 'giant_legacy', amount: 1 }],
    },
    targeting: hostileTargeting(),
    effects: [{
      resolution: 'auto', who: 'target',
      result: [
        { kind: 'damage', dice: '1d6', type: 'cold', ability: 'none' },
        {
          kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '-10',
          duration: { type: 'until_start_of_source_next_turn' },
        },
      ],
    }],
  },
  'ACT-goliath-hill': {
    activation: {
      mode: 'triggered', optional: true, trigger: { event: 'hit', timing: 'during' },
      cost: [{ resource: 'giant_legacy', amount: 1 }],
    },
    targeting: hostileTargeting(),
    effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'condition', value: 'prone' }] }],
  },
  'ACT-goliath-stone': {
    activation: {
      mode: 'reaction', trigger: { event: 'damage_taken', timing: 'before' },
      cost: [{ resource: 'reaction', amount: 1 }, { resource: 'giant_legacy', amount: 1 }],
    },
    targeting: selfTargeting,
    effects: [{ resolution: 'auto', result: [{ kind: 'reduce_damage', amount: '1d12+con' }] }],
  },
  'ACT-goliath-storm': {
    activation: {
      mode: 'reaction', trigger: { event: 'damage_taken' },
      cost: [{ resource: 'reaction', amount: 1 }, { resource: 'giant_legacy', amount: 1 }],
    },
    targeting: hostileTargeting(60),
    effects: [{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', dice: '1d8', type: 'thunder', ability: 'none' }],
    }],
  },
};

const CLASS_STARTING_EQUIPMENT = {
  'CLASS-warrior': {
    option_a: { items: [['CARD-0283', 1], ['CARD-0317', 1], ['CARD-0309', 1], ['CARD-0301', 8], ['CARD-0805', 1]], gold: 4 },
    option_b: { items: [['CARD-0276', 1], ['CARD-0311', 1], ['CARD-0294', 1], ['CARD-0327', 1], ['CARD-0728', 20], ['CARD-0729', 1], ['CARD-0805', 1]], gold: 11 },
    option_c: { items: [], gold: 155 },
  },
  'CLASS-cleric': {
    option_a: { items: [['CARD-0278', 1], ['CARD-0200', 1], ['CARD-0298', 1], ['CARD-0816', 1], ['CARD-0409', 1]], gold: 7 },
    option_b: { items: [], gold: 110 },
  },
  'CLASS-druid': {
    option_a: { items: [['CARD-0275', 1], ['CARD-0200', 1], ['CARD-0299', 1], ['CARD-0827', 1], ['CARD-0806', 1], ['CARD-0712', 1]], gold: 9 },
    option_b: { items: [], gold: 50 },
  },
  'CLASS-paladin': {
    option_a: { items: [['CARD-0283', 1], ['CARD-0200', 1], ['CARD-0319', 1], ['CARD-0301', 6], ['CARD-0816', 1], ['CARD-0409', 1]], gold: 9 },
    option_b: { items: [], gold: 150 },
  },
  'CLASS-ranger': {
    option_a: { items: [['CARD-0276', 1], ['CARD-0311', 1], ['CARD-0294', 1], ['CARD-0327', 1], ['CARD-0728', 20], ['CARD-0729', 1], ['CARD-0827', 1], ['CARD-0806', 1]], gold: 7 },
    option_b: { items: [], gold: 150 },
  },
} as const;

function upsertAction(
  catalogs: SnapshotCatalogs,
  cardNumber: string,
  createId: string,
  fields: JsonRecord,
): JsonRecord {
  const actions = rows(catalogs, 'actions');
  const existing = optionalByCardNumber(catalogs, 'actions', cardNumber);
  if (existing) {
    Object.assign(existing, cloneJson(fields));
    return existing;
  }
  const template = exactByCardNumber(catalogs, 'actions', 'action_basic_weapon');
  const created = {
    ...cloneJson(template),
    id: createId,
    card_number: cardNumber,
    ...cloneJson(fields),
  };
  actions.push(created);
  return created;
}

function hasPayloadKind(mechanics: unknown, kind: string): boolean {
  return array(record(mechanics).effects).some((effect) => {
    const interaction = record(effect);
    return array(interaction.result ?? interaction.results).some((payload) => (
      record(payload).kind === kind
    ));
  });
}

const MIGRATION_107_WEAPON_PROFILES = [
  {
    cardNumber: 'CARD-0485', weaponType: 'greatsword', category: 'martial', ability: 'str',
    dice: '2d6', damageType: 'slashing', defaultMode: 'melee', masteryCardNumber: 'EFFECT-0255',
    modes: [{ kind: 'melee', reach_ft: 5 }], properties: ['heavy', 'two_handed'],
    heavy: true,
  },
  {
    cardNumber: 'CARD-0490', weaponType: 'shortbow', category: 'simple', ability: 'dex',
    dice: '1d6', damageType: 'piercing', defaultMode: 'ranged', masteryCardNumber: 'EFFECT-0252',
    modes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
    properties: ['ammunition', 'two_handed'], ammoCardNumber: 'CARD-0728', ammoName: 'Стрелы',
  },
  {
    cardNumber: 'CARD-0492', weaponType: 'dagger', category: 'simple', ability: 'finesse',
    dice: '1d4', damageType: 'piercing', defaultMode: 'melee', masteryCardNumber: 'EFFECT-0251',
    modes: [{ kind: 'melee', reach_ft: 5 }, { kind: 'ranged', normal_ft: 20, long_ft: 60 }],
    properties: ['finesse', 'light', 'thrown'],
  },
  {
    cardNumber: 'CARD-0564', weaponType: 'handaxe', category: 'simple', ability: 'str',
    dice: '1d6', damageType: 'slashing', defaultMode: 'melee', masteryCardNumber: 'EFFECT-0252',
    modes: [{ kind: 'melee', reach_ft: 5 }, { kind: 'ranged', normal_ft: 20, long_ft: 60 }],
    properties: ['light', 'thrown'],
  },
  {
    cardNumber: 'CARD-0567', weaponType: 'sickle', category: 'simple', ability: 'str',
    dice: '1d4', damageType: 'slashing', defaultMode: 'melee', masteryCardNumber: 'EFFECT-0251',
    modes: [{ kind: 'melee', reach_ft: 5 }], properties: ['light'],
  },
  {
    cardNumber: 'CARD-0570', weaponType: 'light_crossbow', category: 'simple', ability: 'dex',
    dice: '1d8', damageType: 'piercing', defaultMode: 'ranged', masteryCardNumber: 'EFFECT-0250',
    modes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
    properties: ['ammunition', 'two_handed'], ammoCardNumber: 'CARD-0749', ammoName: 'Болты',
  },
] as const;

function projectMigration107WeaponProfiles(catalogs: SnapshotCatalogs): void {
  for (const declaration of MIGRATION_107_WEAPON_PROFILES) {
    const card = exactByCardNumber(catalogs, 'cards', declaration.cardNumber);
    const mastery = exactByCardNumber(catalogs, 'effects', declaration.masteryCardNumber);
    const mechanics = record(card.mechanics);
    const profile: JsonRecord = {
      weapon_type: declaration.weaponType,
      proficiency_category: declaration.category,
      attack_ability: declaration.ability,
      damage_lines: [{ dice: declaration.dice, type: declaration.damageType }],
      default_attack_mode: declaration.defaultMode,
      attack_modes: cloneJson(declaration.modes),
      properties: [...declaration.properties],
      mastery_effect_id: mastery.id,
      ammo: 'ammoCardNumber' in declaration
        ? {
            card_id: exactByCardNumber(catalogs, 'cards', declaration.ammoCardNumber).id,
            name: declaration.ammoName,
          }
        : null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    };
    if ('heavy' in declaration && declaration.heavy) {
      profile.heavy = {
        minimum_ability_score: 13,
        ability_by_mode: { melee: 'str', ranged: 'dex' },
        consequence: 'attack_disadvantage',
      };
    }
    mechanics.weapon_profile = profile;
    card.mechanics = mechanics;
  }
}

function projectSplitWeaponActions(catalogs: SnapshotCatalogs): void {
  const melee = exactByCardNumber(catalogs, 'actions', 'action_basic_weapon');
  Object.assign(melee, {
    name: 'Рукопашная атака оружием',
    description: 'Атака надетым оружием в рукопашном режиме. Боеприпасы не требуются и не расходуются.',
    mechanics: {
      primitive: { type: 'weapon_attack' },
      name: 'Рукопашная атака оружием',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
      }],
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 600, requires_line_of_sight: true,
        allowed_relations: ['ally', 'enemy', 'neutral'],
      },
    },
    support: null,
  });

  const offhand = optionalByCardNumber(catalogs, 'actions', 'action_basic_offhand');
  if (offhand) {
    const mechanics = record(offhand.mechanics);
    const activation = record(mechanics.activation);
    activation.cost = array(activation.cost).filter((entry) => (
      record(entry).resource !== 'equipped_weapon_ammo'
    ));
    mechanics.activation = activation;
    offhand.mechanics = mechanics;
    offhand.support = null;
  }

  upsertAction(catalogs, 'action_basic_weapon_ranged', '10800000-0000-4000-8000-000000000001', {
    name: 'Дальнобойная атака оружием',
    name_en: 'Ranged Weapon Attack',
    description: 'Атака надетым оружием в дальнобойном режиме. Боеприпас расходуется только если он объявлен профилем оружия.',
    image_url: '/icons/actions/ranged_weapon_attack.png',
    rarity: 'common', action_type: 'base_action', type: 'basic', resource: 'action',
    source: 'PHB 2024; micro-MVP L1 overlay canonical entity v1', author: 'System',
    mechanics: {
      primitive: { type: 'weapon_attack' },
      name: 'Дальнобойная атака оружием',
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }, { resource: 'equipped_weapon_ammo', amount: 1 }],
      },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_ranged', ability: 'auto', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
      }],
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 600, requires_line_of_sight: true,
        allowed_relations: ['ally', 'enemy', 'neutral'],
      },
    },
    support: null,
  });
}

function projectGoliathCatalog(catalogs: SnapshotCatalogs): void {
  const resourceEffect = exactByCardNumber(catalogs, 'effects', 'RE-goliath-1');
  resourceEffect.mechanics = {
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result: [
      { kind: 'resource', op: 'grant', id: 'giant_legacy', amount: 'prof_bonus' },
      {
        kind: 'narrative',
        description: 'Наследие великанов: число применений равно бонусу мастерства; восстанавливается после продолжительного отдыха.',
      },
    ] }],
  };
  resourceEffect.support = null;

  for (const lineage of GOLIATH_LINEAGES) {
    const actionFields: JsonRecord = {
      mechanics: GOLIATH_ACTION_MECHANICS[lineage.actionCardNumber],
      support: null,
    };
    if (lineage.actionCardNumber === 'ACT-goliath-stone') {
      Object.assign(actionFields, {
        name: 'Каменная стойкость',
        description: 'Получив урон, используйте реакцию и заряд Наследия великанов, чтобы уменьшить полученный урон на 1к12 + модификатор Телосложения.',
        image_url: '', rarity: 'common', action_type: 'class_feature', type: 'species',
        resource: 'reaction,giant_legacy', author: 'System', source: 'PHB 2024',
      });
    } else if (lineage.actionCardNumber === 'ACT-goliath-cloud') {
      actionFields.resource = 'bonus_action,giant_legacy';
    } else if (lineage.actionCardNumber === 'ACT-goliath-fire'
      || lineage.actionCardNumber === 'ACT-goliath-frost'
      || lineage.actionCardNumber === 'ACT-goliath-hill') {
      actionFields.resource = 'giant_legacy';
    } else {
      actionFields.resource = 'reaction,giant_legacy';
    }
    if (lineage.actionCardNumber === 'ACT-goliath-stone') {
      upsertAction(
        catalogs,
        lineage.actionCardNumber,
        '10900000-0000-4000-8000-000000000001',
        actionFields,
      );
    } else {
      Object.assign(
        exactByCardNumber(catalogs, 'actions', lineage.actionCardNumber),
        cloneJson(actionFields),
      );
    }
  }

  const parent = exactByCardNumber(catalogs, 'races', 'RACE-0011');
  const raceRows = rows(catalogs, 'races');
  for (const lineage of GOLIATH_LINEAGES) {
    const existing = optionalByCardNumber(catalogs, 'races', lineage.cardNumber);
    const legacy = optionalByCardNumber(catalogs, 'races', lineage.legacyCardNumber);
    const base = cloneJson(existing ?? legacy ?? parent);
    const effect = exactByCardNumber(catalogs, 'effects', lineage.effectCardNumber);
    const action = exactByCardNumber(catalogs, 'actions', lineage.actionCardNumber);
    const relatedEffects = lineage.cardNumber === 'RACE-0011-stone'
      ? [effect].filter((candidate) => !hasPayloadKind(candidate.mechanics, 'reduce_damage'))
        .map((candidate) => String(candidate.id))
      : [String(effect.id)];
    const projected = {
      ...base,
      id: existing?.id ?? lineage.id,
      card_number: lineage.cardNumber,
      name: lineage.name,
      name_en: lineage.nameEn,
      description: lineage.description,
      is_subrace: true,
      parent_race_id: parent.id,
      subrace_level: 1,
      related_effects: relatedEffects,
      related_actions: [String(action.id)],
      source: typeof base.source === 'string' && base.source.trim() ? base.source : parent.source,
    };
    if (existing) Object.assign(existing, projected);
    else raceRows.push(projected);
  }
  catalogs.races = catalogs.races.filter((race) => (
    !LEGACY_GOLIATH_CARD_NUMBERS.has(race.card_number)
  ));
}

function projectLineageSourceInheritance(catalogs: SnapshotCatalogs): void {
  const parentsById = new Map(catalogs.races.map((race) => [race.id, race]));
  for (const child of catalogs.races) {
    if (!child.parent_race_id || (typeof child.source === 'string' && child.source.trim())) continue;
    const parent = parentsById.get(child.parent_race_id);
    if (typeof parent?.source === 'string' && parent.source.trim()) child.source = parent.source;
  }
}

type StableEquipmentOption = {
  readonly items: readonly (readonly [cardNumber: string, quantity: number])[];
  readonly gold: number;
};

function materializeEquipmentOption(
  catalogs: SnapshotCatalogs,
  option: StableEquipmentOption,
): JsonRecord {
  return {
    items: option.items.map(([cardNumber, quantity]) => ({
      card_id: exactByCardNumber(catalogs, 'cards', cardNumber).id,
      quantity,
    })),
    gold: option.gold,
  };
}

function projectClassEquipment(catalogs: SnapshotCatalogs): void {
  for (const [classCardNumber, declarations] of Object.entries(CLASS_STARTING_EQUIPMENT)) {
    const klass = optionalByCardNumber(catalogs, 'classes', classCardNumber);
    if (!klass) continue;
    klass.equipment_options = Object.fromEntries(
      Object.entries(declarations).map(([key, option]) => [
        key,
        materializeEquipmentOption(catalogs, option),
      ]),
    );
  }

  const longbow = exactByCardNumber(catalogs, 'cards', 'CARD-0327');
  const ammunition = exactByCardNumber(catalogs, 'cards', 'CARD-0728');
  const mastery = exactByCardNumber(catalogs, 'effects', 'EFFECT-0250');
  const mechanics = record(longbow.mechanics);
  mechanics.weapon_profile = {
    weapon_type: 'longbow', proficiency_category: 'martial', attack_ability: 'dex',
    damage_lines: [{ dice: '1d8', type: 'piercing' }],
    default_attack_mode: 'ranged',
    attack_modes: [{ kind: 'ranged', normal_ft: 150, long_ft: 600 }],
    properties: ['ammunition', 'two_handed', 'heavy'],
    mastery_effect_id: mastery.id,
    ammo: { card_id: ammunition.id, name: 'Стрела' },
    enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
    attunement: { required: false },
    heavy: {
      minimum_ability_score: 13,
      ability_by_mode: { melee: 'str', ranged: 'dex' },
      consequence: 'attack_disadvantage',
    },
  };
  Object.assign(longbow, {
    weapon_type: 'longbow', mastery: mastery.id, range: '150/600', mechanics,
  });
}

function projectPotionConsumption(catalogs: SnapshotCatalogs): void {
  for (const cardNumber of ['CARD-0839', 'CARD-0840', 'CARD-0841', 'CARD-0842']) {
    const potion = optionalByCardNumber(catalogs, 'cards', cardNumber);
    if (!potion) continue;
    const mechanics = record(potion.mechanics);
    delete mechanics.uses;
    const activation = record(mechanics.activation);
    delete activation.consumes_self;
    const cost = array(activation.cost).map((entry) => cloneJson(entry));
    if (!cost.some((entry) => record(entry).resource === 'self_item')) {
      cost.push({ resource: 'self_item', amount: 1 });
    }
    activation.cost = cost;
    mechanics.activation = activation;
    potion.mechanics = mechanics;
  }
}

function projectSpellClassIdentities(catalogs: SnapshotCatalogs): void {
  const baseClasses = rows(catalogs, 'classes').filter((klass) => klass.is_subclass !== true);
  for (const spell of rows(catalogs, 'spells')) {
    if (!spell.mechanics || typeof spell.mechanics !== 'object' || Array.isArray(spell.mechanics)) continue;
    const mechanics = spell.mechanics as JsonRecord;
    if (Object.hasOwn(mechanics, 'spell_class_list_ids')) continue;
    const support = record(spell.support);
    if (String(support.mechanics_locked ?? 'false') === 'true') continue;
    const labels = [...new Set(array(spell.classes)
      .filter((value): value is string => typeof value === 'string')
      .map((label) => label.trim().toLocaleLowerCase('ru'))
      .filter(Boolean))];
    if (labels.length === 0) continue;
    const resolved = new Set<string>();
    for (const label of labels) {
      for (const klass of baseClasses) {
        const names = [klass.name, klass.name_en]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLocaleLowerCase('ru'));
        if (names.includes(label)) resolved.add(String(klass.card_number));
      }
    }
    if (labels.length !== resolved.size) continue;
    mechanics.spell_class_list_ids = [...resolved].sort();
    spell.mechanics = mechanics;
    for (const key of ['content_hash', 'dependency_hash', 'certified_at', 'certification_version']) {
      delete support[key];
    }
    spell.support = {
      ...support,
      status: typeof support.status === 'string' ? support.status : 'verified_partial',
      mechanics_locked: false,
      note: 'Legacy localized class lists normalized to stable class ids; certification must be refreshed.',
    };
  }
}

export function assertPostSnapshotCatalogProjection(catalogs: SnapshotCatalogs): void {
  const problems: string[] = [];
  const parent = exactByCardNumber(catalogs, 'races', 'RACE-0011');
  for (const lineage of GOLIATH_LINEAGES) {
    const rowsForLineage = catalogs.races.filter((race) => race.card_number === lineage.cardNumber);
    if (rowsForLineage.length !== 1) {
      problems.push(`races:${lineage.cardNumber}: expected one canonical lineage`);
      continue;
    }
    const candidate = rowsForLineage[0];
    const action = catalogs.actions.find((item) => item.card_number === lineage.actionCardNumber);
    if (candidate.parent_race_id !== parent.id || candidate.is_subrace !== true) {
      problems.push(`races:${lineage.cardNumber}: canonical parent/subrace shape is invalid`);
    }
    if (!action || JSON.stringify(candidate.related_actions ?? []) !== JSON.stringify([action.id])) {
      problems.push(`races:${lineage.cardNumber}: action authority is not exact`);
    }
  }
  for (const legacyCardNumber of LEGACY_GOLIATH_CARD_NUMBERS) {
    if (catalogs.races.some((race) => race.card_number === legacyCardNumber)) {
      problems.push(`races:${legacyCardNumber}: legacy alias remains active`);
    }
  }

  const stone = exactByCardNumber(catalogs, 'races', 'RACE-0011-stone');
  const stoneAction = exactByCardNumber(catalogs, 'actions', 'ACT-goliath-stone');
  if (!hasPayloadKind(stoneAction.mechanics, 'reduce_damage')) {
    problems.push('actions:ACT-goliath-stone: reduce_damage authority is absent');
  }
  try {
    compileDeclaredMechanicsTargeting(record(stoneAction.mechanics));
  } catch (error) {
    problems.push(
      `actions:ACT-goliath-stone: strict targeting compilation failed: `
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const duplicateStoneAuthorities = array(stone.related_effects).filter((reference) => {
    if (typeof reference !== 'string') return false;
    const effect = catalogs.effects.find((candidate) => (
      candidate.id === reference || candidate.card_number === reference
    ));
    return effect ? hasPayloadKind(effect.mechanics, 'reduce_damage') : false;
  });
  if (duplicateStoneAuthorities.length > 0) {
    problems.push('races:RACE-0011-stone: duplicate reduce_damage effect authority remains');
  }

  const rangedActions = catalogs.actions.filter((action) => (
    record(record(action.mechanics).primitive).type === 'weapon_attack'
    && array(record(record(action.mechanics).activation).cost)
      .some((entry) => record(entry).resource === 'equipped_weapon_ammo')
  ));
  if (rangedActions.length !== 1 || rangedActions[0].card_number !== 'action_basic_weapon_ranged') {
    problems.push('actions: split weapon attack authority is invalid');
  }

  for (const declaration of MIGRATION_107_WEAPON_PROFILES) {
    const card = exactByCardNumber(catalogs, 'cards', declaration.cardNumber);
    const profile = record(record(card.mechanics).weapon_profile);
    const mastery = exactByCardNumber(catalogs, 'effects', declaration.masteryCardNumber);
    if (profile.weapon_type !== declaration.weaponType
      || profile.mastery_effect_id !== mastery.id) {
      problems.push(`cards:${declaration.cardNumber}: migration 107 weapon profile is invalid`);
    }
  }

  const racesById = new Map(catalogs.races.map((race) => [race.id, race]));
  for (const child of catalogs.races) {
    if (!child.parent_race_id) continue;
    const inheritedFrom = racesById.get(child.parent_race_id)?.source;
    if ((child.source === null || child.source === undefined || !String(child.source).trim())
      && typeof inheritedFrom === 'string' && inheritedFrom.trim()) {
      problems.push(`races:${child.card_number}: parent source was not inherited`);
    }
  }

  try {
    assertClassEquipmentReferenceClosure(catalogs.classes, catalogs.cards);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (problems.length > 0) throw new PostSnapshotCatalogProjectionError(problems);
}

/**
 * Projects the immutable snapshot through the catalog-shaping parts of backend
 * migrations 107–115. The function is deterministic, idempotent, and fails
 * closed when a stable card_number is missing or duplicated. Callers must
 * materialize the active declarative content patch first; mechanics-only
 * migrations such as 116 remain owned and verified there.
 */
export function projectPostSnapshotCatalogsThrough115(source: SnapshotCatalogs): SnapshotCatalogs {
  const catalogs = cloneJson(source);
  projectPotionConsumption(catalogs);
  projectSpellClassIdentities(catalogs);
  projectMigration107WeaponProfiles(catalogs);
  projectSplitWeaponActions(catalogs);
  projectGoliathCatalog(catalogs);
  projectLineageSourceInheritance(catalogs);
  projectClassEquipment(catalogs);
  assertPostSnapshotCatalogProjection(catalogs);
  return catalogs;
}
