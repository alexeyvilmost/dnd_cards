import type { Card } from '../../types';
import {
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
} from '../../canon/microMvpL1Overlay';
import { withDeclaredTestWeaponProfile } from '../../testing/weaponProfileFixtures';
import type {
  ActorState,
  RuleActionDefinition,
  RuleHazardDefinition,
  RulesCatalog,
  RulesetReference,
  SpatialFacts,
} from '../domain';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from '../determinism';
import type { DieTapeEntry } from '../determinism';
import { runScenario } from './scenario';
import type {
  RequiredScenarioTrace,
  ScenarioFixtureProvider,
  ScenarioRun,
  ScenarioSpec,
} from './scenario';
import { managedWorldSpellMechanics } from './worldSpellPolicyFixtures';

type ActionKind = 'spell' | 'nonSpell';
type IdSource = 'snapshot_card_number' | 'snapshot_entity_id' | 'project_rule';

export const MICRO_MVP_SCENARIO_RULESET: RulesetReference = {
  systemId: 'dnd5e-2024',
  releaseId: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  errataVersion: 'phb-2024-errata-v1',
};

export const MICRO_MVP_SCENARIO_ACTION_IDS = {
  weaponAttack: 'action_basic_weapon',
  shove: 'action_shove',
  help: 'action_help',
  secondWind: '1cd19d26-3011-4859-9430-c8787fe99ba7',
  magicMissile: 'SPELL-0174',
  shield: 'SPELL-0317',
  thunderwave: 'SPELL-0171',
  burningHands: 'SPELL-0242',
  light: 'light',
  minorIllusion: 'minor_illusion',
  detectMagic: 'detect_magic',
  bless: 'SPELL-0163',
  cureWounds: 'SPELL-0214',
  sacredFlame: 'SPELL-0286',
  guidance: 'SPELL-0230',
  fireBolt: 'fire_bolt',
  acidSplash: 'SPELL-0166',
  entangle: 'SPELL-0246',
  armsOfHadar: 'SPELL-0283',
  rogueNickAttack: 'project-rule:sc-02.rogue-nick-attack',
  innateSorcery: 'project-rule:sc-03.innate-sorcery-runtime-slice',
} as const;

export const MICRO_MVP_SCENARIO_HAZARD_IDS = {
  unstableRubble: 'hazard.micro-mvp.unstable-rubble',
} as const;

export const MICRO_MVP_PROJECT_RULE_CAPABILITY_IDS = [
  MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack,
  MICRO_MVP_SCENARIO_ACTION_IDS.innateSorcery,
] as const;

const TOPPLE_MASTERY_ID = 'project-rule:mastery.topple-l1-overlay';
const SECOND_WIND_2024_RESOURCE_KEY = 'uses_ACT-second-wind';
const SNEAK_ATTACK_ID = 'EFF-sneak-attack';
const PRIMAL_ORDER_ID = 'EFF-primal-order';
const PRIMAL_ORDER_ENTITY_ID = 'ccaf0064-4564-4e2c-9f57-1d3efb8b47c2';
const DRUID_CLASS_ENTITY_ID = '932a15ad-a7c5-4062-b13a-899933b94231';
export interface CertifiedScenarioAction {
  action: RuleActionDefinition;
  actionKind: ActionKind;
  idSource: IdSource;
  sourceEntityId: string;
  certification: 'scenario_slice';
}

const enemy = (distanceFt: number): SpatialFacts => ({
  factsSource: 'scenario',
  boardRevision: 1,
  distanceFt,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
});

const ally = (distanceFt: number): SpatialFacts => ({
  ...enemy(distanceFt),
  relation: 'ally',
});

const self = (): SpatialFacts => ({
  ...enemy(0),
  relation: 'self',
});

const target = (
  rangeFt: number,
  allowedRelations: Array<SpatialFacts['relation']> = ['enemy'],
): NonNullable<RuleActionDefinition['targeting']> => ({
  minTargets: 1,
  maxTargets: 1,
  rangeFt,
  requiresLineOfSight: true,
  allowedRelations,
});

const TOPPLE_MASTERY = {
  name: 'Опрокидывающее',
  mechanics: {
    activation: { mode: 'triggered', trigger: { event: 'hit' } },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'con',
      dc: '8 + prof + weapon_mod',
      on_fail: [{ kind: 'condition', value: 'prone', op: 'apply' }],
      on_success: [],
    }],
  },
};

const LONGSWORD = withDeclaredTestWeaponProfile({
  id: 'project-rule:item.longsword-scenario',
  card_number: 'ITEM-longsword',
  name: 'Длинный меч',
  type: 'weapon',
  weapon_type: 'longsword',
  bonus_value: '1d8',
  damage_type: 'slashing',
  mastery: TOPPLE_MASTERY_ID,
} as unknown as Card, {
  weaponType: 'longsword',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '1d8', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: [],
  masteryEffectId: TOPPLE_MASTERY_ID,
});

const DAGGER = withDeclaredTestWeaponProfile({
  id: 'project-rule:item.dagger-scenario',
  card_number: 'ITEM-dagger',
  name: 'Кинжал',
  type: 'weapon',
  weapon_type: 'dagger',
  bonus_value: '1d4',
  damage_type: 'piercing',
  properties: ['finesse', 'light'],
} as unknown as Card, {
  weaponType: 'dagger',
  proficiencyCategory: 'simple',
  attackAbility: 'finesse',
  damageLines: [{ dice: '1d4', type: 'piercing' }],
  defaultAttackMode: 'melee',
  attackModes: [
    { kind: 'melee', reach_ft: 5 },
    { kind: 'ranged', normal_ft: 20, long_ft: 60 },
  ],
  properties: ['finesse', 'light', 'thrown'],
  masteryEffectId: 'project-rule:mastery.nick-l1-overlay',
});

function certified(
  action: Pick<RuleActionDefinition, 'id' | 'name' | 'mechanics' | 'targeting' | 'concentration'>,
  actionKind: ActionKind,
  idSource: IdSource,
  spell?: { level: number; sourceClass?: string },
  additionalSourceEntityIds: string[] = [],
): CertifiedScenarioAction {
  const definition: RuleActionDefinition = actionKind === 'spell'
    ? {
        ...action,
        kind: 'spell',
        sourceEntityIds: [action.id, ...additionalSourceEntityIds],
        spell: spell ?? { level: 0 },
      }
    : {
        ...action,
        kind: 'nonSpell',
        sourceEntityIds: [action.id, ...additionalSourceEntityIds],
      };
  return {
    action: definition,
    actionKind,
    idSource,
    sourceEntityId: action.id,
    certification: 'scenario_slice',
  };
}

const ACTIONS: CertifiedScenarioAction[] = [
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack,
    name: 'Атака оружием',
    targeting: target(5),
    mechanics: {
      name: 'Атака оружием',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll',
        ability: 'str',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
      }],
    },
  }, 'nonSpell', 'snapshot_card_number'),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.shove,
    name: 'Толчок',
    targeting: target(5),
    mechanics: {
      name: 'Толчок',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'save',
        who: 'target',
        ability: 'str',
        dc: '8 + prof + str',
        on_fail: [{ kind: 'condition', value: 'prone', op: 'apply' }],
        on_success: [],
      }],
    },
  }, 'nonSpell', 'snapshot_card_number'),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.help,
    name: 'Помощь',
    targeting: target(5, ['ally']),
    mechanics: {
      name: 'Помощь',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'ability_check' },
          op: 'advantage',
          consume: 'next',
          duration: { type: 'rounds', amount: 1 },
        }],
      }],
    },
  }, 'nonSpell', 'snapshot_card_number'),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.secondWind,
    name: 'Второе дыхание',
    targeting: { ...target(0, ['self']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Второе дыхание',
      activation: {
        mode: 'active',
        cost: [
          { resource: 'bonus_action' },
          { resource: SECOND_WIND_2024_RESOURCE_KEY },
        ],
      },
      uses: { count: 2, per: 'short_rest' },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'healing', amount: '1d10 + self_level' }],
      }],
    },
  }, 'nonSpell', 'snapshot_entity_id', undefined, ['2705eb12-1556-40c8-bdae-671e8f5c67eb']),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.magicMissile,
    name: 'Волшебная стрела',
    targeting: {
      minTargets: 1,
      maxTargets: 3,
      rangeFt: 120,
      requiresLineOfSight: true,
      allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
    },
    mechanics: {
      name: 'Волшебная стрела',
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }],
      },
      ...managedWorldSpellMechanics('magic_missile'),
      effects: [],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.shield,
    name: 'Щит',
    mechanics: {
      name: 'Щит',
      activation: {
        mode: 'reaction',
        trigger: {
          event: 'hit_by_attack',
          events: ['hit_by_attack', 'targeted_by_magic_missile'],
        },
        cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
      },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'ac' },
          op: 'add',
          value: '+5',
          duration: { type: 'until_start_of_next_turn' },
          magic_missile_immunity: true,
        }],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.thunderwave,
    name: 'Волна грома',
    targeting: target(15),
    mechanics: {
      name: 'Волна грома',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      primitive: {
        type: 'area_object_push',
        object_push_distance_ft: 10,
        object_max_distance_ft: 15,
        object_area_requirement: 'entirely_in_area',
        exclude_secured_objects: true,
        exclude_carried_objects: true,
      },
      effects: [{
        resolution: 'save',
        who: 'target',
        ability: 'con',
        dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '2d8', type: 'thunder' }],
        on_success: [],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.burningHands,
    name: 'Пылающие ладони',
    targeting: target(15),
    mechanics: {
      name: 'Пылающие ладони',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      ...managedWorldSpellMechanics('burning_hands_objects'),
      effects: [{
        resolution: 'save',
        who: 'target',
        ability: 'dex',
        dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '3d6', type: 'fire' }],
        on_success: [{ kind: 'damage', dice: '3d6', type: 'fire', on_success: 'half' }],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.light,
    name: 'Свет',
    targeting: { ...target(0, ['self', 'ally', 'enemy', 'neutral']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Свет',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...managedWorldSpellMechanics('light_world_object'),
      effects: [],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.minorIllusion,
    name: 'Малая иллюзия',
    targeting: { ...target(30, ['self', 'ally', 'enemy', 'neutral']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Малая иллюзия',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...managedWorldSpellMechanics('minor_illusion_world_object'),
      effects: [],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic,
    name: 'Обнаружение магии',
    concentration: true,
    targeting: { ...target(0, ['self']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Обнаружение магии',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      ...managedWorldSpellMechanics('detect_magic_world_sensing'),
      effects: [],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-wizard' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.bless,
    name: 'Благословение',
    concentration: true,
    targeting: target(30, ['ally']),
    mechanics: {
      name: 'Благословение',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [
          {
            kind: 'modifier', op: 'bonus_die', faces: 4, source: 'Благословение',
            applies_to: { roll: 'attack' },
            duration: { type: 'rounds', amount: 10, concentration: true },
          },
          {
            kind: 'modifier', op: 'bonus_die', faces: 4, source: 'Благословение',
            applies_to: { roll: 'saving_throw' },
            duration: { type: 'rounds', amount: 10, concentration: true },
          },
        ],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-cleric' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.cureWounds,
    name: 'Лечение ран',
    targeting: { ...target(5, ['self']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Лечение ран',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'healing', amount: '2d8 + spellcasting' }],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-cleric' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.sacredFlame,
    name: 'Священное пламя',
    targeting: target(60),
    mechanics: {
      name: 'Священное пламя',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '1d8', type: 'radiant' }],
        on_success: [],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-cleric' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.guidance,
    name: 'Наставление',
    concentration: true,
    targeting: target(5, ['ally']),
    mechanics: {
      name: 'Наставление',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'modifier', op: 'bonus_die', faces: 4, source: 'Наставление',
          applies_to: { roll: 'ability_check' },
          duration: { type: 'rounds', amount: 10, concentration: true },
        }],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-cleric' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.fireBolt,
    name: 'Огненный снаряд',
    targeting: target(120),
    mechanics: {
      name: 'Огненный снаряд',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', ability: 'spellcasting',
        on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire' }],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-sorcerer' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.acidSplash,
    name: 'Брызги кислоты',
    targeting: target(60),
    mechanics: {
      name: 'Брызги кислоты',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '1d6', type: 'acid' }],
        on_success: [],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 0, sourceClass: 'CLASS-sorcerer' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.entangle,
    name: 'Опутывание',
    concentration: true,
    targeting: target(90),
    mechanics: {
      name: 'Опутывание',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'str', dc: '8 + prof + spellcasting',
        on_fail: [{
          kind: 'condition', value: 'restrained', op: 'apply',
          duration: { type: 'rounds', amount: 10, concentration: true },
        }],
        on_success: [],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-druid' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.armsOfHadar,
    name: 'Руки Хадара',
    targeting: target(10),
    mechanics: {
      name: 'Руки Хадара',
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'pact_slot_1' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'str', dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '2d6', type: 'necrotic' }],
        on_success: [],
      }],
    },
  }, 'spell', 'snapshot_card_number', { level: 1, sourceClass: 'CLASS-warlock' }),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack,
    name: 'Атака лёгким оружием (Nick slice)',
    targeting: target(5),
    mechanics: {
      name: 'Атака лёгким оружием (Nick slice)',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [
        { resolution: 'attack_roll', ability: 'dex', on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }] },
        { resolution: 'attack_roll', ability: 'dex', on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }] },
      ],
    },
  }, 'nonSpell', 'project_rule'),
  certified({
    id: MICRO_MVP_SCENARIO_ACTION_IDS.innateSorcery,
    name: 'Врождённое чародейство (runtime slice)',
    targeting: { ...target(0, ['self']), minTargets: 0, maxTargets: 0 },
    mechanics: {
      name: 'Врождённое чародейство (runtime slice)',
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      effects: [{
        resolution: 'auto',
        result: [
          {
            kind: 'modifier',
            applies_to: { roll: 'spell_save_dc', filter: { spellClass: 'CLASS-sorcerer' } },
            op: 'add', value: '1', source: 'Врождённое чародейство',
            duration: { type: 'rounds', amount: 10 },
          },
          {
            kind: 'modifier',
            applies_to: { roll: 'attack', filter: { spellClass: 'CLASS-sorcerer' } },
            op: 'advantage', source: 'Врождённое чародейство',
            duration: { type: 'rounds', amount: 10 },
          },
        ],
      }],
    },
  }, 'nonSpell', 'project_rule'),
];

export const MICRO_MVP_SCENARIO_CATALOG_ENTRIES = Object.freeze(
  Object.fromEntries(ACTIONS.map((entry) => [entry.action.id, entry])) as Record<string, CertifiedScenarioAction>,
);

const MICRO_MVP_SCENARIO_HAZARDS: readonly RuleHazardDefinition[] = [{
  id: MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble,
  name: 'Неустойчивые обломки',
  sourceKind: 'environment',
  sourceEntityIds: ['DMG-2024:environment:unstable-rubble'],
  save: { ability: 'dex', dc: 14 },
  onFailure: [{
    kind: 'condition', value: 'prone', op: 'apply',
    duration: { type: 'rounds', amount: 1 },
  }],
  onSuccess: [],
}];

export const MICRO_MVP_SCENARIO_CATALOG: RulesCatalog = {
  getAction: (id) => MICRO_MVP_SCENARIO_CATALOG_ENTRIES[id]?.action,
  getHazard: (id) => MICRO_MVP_SCENARIO_HAZARDS.find((hazard) => hazard.id === id),
};

interface ActorOptions {
  ac?: number;
  hp?: number;
  abilityMods?: Partial<ActorState['character']['abilityMods']>;
  resources?: Record<string, number>;
  actionIds: string[];
  skillProficiencies?: string[];
  skillExpertise?: string[];
  saveProficiencies?: string[];
  spellcastingAbility?: 'int' | 'wis' | 'cha';
  passives?: ActorState['passives'];
  activeEffects?: ActorState['runtime']['activeEffects'];
  weapon?: Card;
  weaponMasteries?: string[];
  masteryEffects?: ActorState['masteryEffects'];
  resourceRecharge?: Record<string, string>;
}

function actorFixture(id: string, name: string, options: ActorOptions): ActorState {
  const resources = {
    action: 1,
    bonus_action: 1,
    reaction: 1,
    ...(options.resources ?? {}),
  };
  const baseMods = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 };
  const weapon = options.weapon;
  return {
    id,
    name,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: options.ac ?? 13,
    capabilities: { actionIds: [...options.actionIds] },
    character: {
      abilityMods: { ...baseMods, ...(options.abilityMods ?? {}) },
      profBonus: 2,
      level: 1,
      skillProficiencies: options.skillProficiencies ?? [],
      skillExpertise: options.skillExpertise ?? [],
      saveProficiencies: options.saveProficiencies ?? [],
      ...(options.spellcastingAbility ? {
        spellcastingAbility: options.spellcastingAbility,
        spellcastingMod: { int: 3, wis: 3, cha: 3 }[options.spellcastingAbility],
      } : {}),
      ...(weapon ? { equippedCards: [weapon], knownCards: [weapon] } : {}),
      ...(options.weaponMasteries ? { weaponMasteries: options.weaponMasteries } : {}),
      ...(options.resourceRecharge ? { resourceRecharge: options.resourceRecharge } : {}),
    },
    runtime: {
      hp: { current: options.hp ?? 20, max: options.hp ?? 20, temp: 0 },
      resources: { ...resources },
      maxResources: { ...resources },
      equipment: weapon ? { main_hand: weapon.id } : {},
      inventory: weapon ? [{ cardId: weapon.id, qty: 1 }] : [],
      activeEffects: options.activeEffects ? [...options.activeEffects] : [],
    },
    ...(options.passives ? { passives: options.passives } : {}),
    ...(options.masteryEffects ? { masteryEffects: options.masteryEffects } : {}),
  };
}

export const MICRO_MVP_SCENARIO_FIXTURE_IDS = {
  sc01Fighter: 'micro-mvp:SC-01:CLASS-warrior:l1',
  sc01Wizard: 'micro-mvp:SC-01:CLASS-wizard:l1',
  sc02Rogue: 'micro-mvp:SC-02:CLASS-rogue:l1',
  sc02Cleric: 'micro-mvp:SC-02:CLASS-cleric:l1',
  sc03Sorcerer: 'micro-mvp:SC-03:CLASS-sorcerer:l1',
  sc03Druid: 'micro-mvp:SC-03:CLASS-druid:l1',
  sc04Warlock: 'micro-mvp:SC-04:CLASS-warlock:l1',
  sc04Fighter: 'micro-mvp:SC-04:CLASS-warrior:l1',
  sc05Cleric: 'micro-mvp:SC-05:CLASS-cleric:l1',
  sc05Rogue: 'micro-mvp:SC-05:CLASS-rogue:l1',
  sc06Caster: 'micro-mvp:SC-06:CLASS-wizard:caster:l1',
  sc06Defender: 'micro-mvp:SC-06:CLASS-wizard:defender:l1',
  sc07Wizard: 'micro-mvp:SC-07:CLASS-wizard:l1',
  sc07Fighter: 'micro-mvp:SC-07:CLASS-warrior:l1',
} as const;

const SNEAK_ATTACK = {
  id: SNEAK_ATTACK_ID,
  name: 'Скрытая атака (L1 executable overlay)',
  activation: {
    mode: 'triggered',
    trigger: {
      event: 'hit',
      timing: 'during',
      circumstances: [{
        kind: 'all_of',
        of: [
          { kind: 'any_of', of: [
            { kind: 'attack_weapon_property', value: 'finesse' },
            { kind: 'attack_range', value: 'ranged' },
          ] },
          { kind: 'any_of', of: [
            { kind: 'attack_advantage_state', value: 'advantage' },
            { kind: 'all_of', of: [
              { kind: 'nearby_eligible_ally_to_target' },
              { kind: 'not', of: { kind: 'attack_advantage_state', value: 'disadvantage' } },
            ] },
          ] },
        ],
      }],
    },
  },
  uses: { count: 1, per: 'turn' },
  effects: [{
    resolution: 'auto', who: 'target',
    result: [{ kind: 'damage', dice: '1d6', type: 'weapon' }],
  }],
};

const PRIMAL_ORDER_MAGICIAN = {
  id: PRIMAL_ORDER_ENTITY_ID,
  card_number: PRIMAL_ORDER_ID,
  name: 'Первородный порядок: Маг (compiled Arcana slice)',
  sourceEntityIds: [PRIMAL_ORDER_ENTITY_ID, DRUID_CLASS_ENTITY_ID],
  sourceChoice: { id: 'druid_primal_order', optionId: 'magician' },
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{
      kind: 'modifier', op: 'add', value: 'max(1,wis)', source: 'Маг',
      applies_to: { roll: 'ability_check', filter: { skill: 'arcana' } },
    }],
  }],
};

const MASTERY_MAP = { [TOPPLE_MASTERY_ID]: TOPPLE_MASTERY };

const ACTOR_FIXTURES = new Map<string, ActorState>([
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Fighter, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Fighter, 'Воин SC-01', {
      ac: 16, hp: 14, abilityMods: { str: 3, con: 2, int: 0 },
      resources: { [SECOND_WIND_2024_RESOURCE_KEY]: 2 },
      actionIds: [
        MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack,
        MICRO_MVP_SCENARIO_ACTION_IDS.secondWind,
      ],
      skillProficiencies: ['investigation'], saveProficiencies: ['con'],
      weapon: LONGSWORD, weaponMasteries: ['longsword'], masteryEffects: MASTERY_MAP,
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Wizard, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Wizard, 'Волшебник SC-01', {
      ac: 14, hp: 12, abilityMods: { int: 3, con: 1 }, spellcastingAbility: 'int',
      resources: { spell_slot_1: 2 },
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.shield, MICRO_MVP_SCENARIO_ACTION_IDS.thunderwave],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Rogue, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Rogue, 'Плут SC-02', {
      ac: 14, hp: 16, abilityMods: { dex: 3, wis: 1 },
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack, MICRO_MVP_SCENARIO_ACTION_IDS.shove],
      skillProficiencies: ['stealth'], skillExpertise: ['stealth'], saveProficiencies: ['dex'],
      weapon: DAGGER, passives: [SNEAK_ATTACK],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Cleric, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Cleric, 'Жрец SC-02', {
      ac: 13, hp: 20, abilityMods: { wis: 3, str: 1 }, spellcastingAbility: 'wis',
      resources: { spell_slot_1: 3 }, saveProficiencies: ['wis'],
      actionIds: [
        MICRO_MVP_SCENARIO_ACTION_IDS.bless,
        MICRO_MVP_SCENARIO_ACTION_IDS.cureWounds,
        MICRO_MVP_SCENARIO_ACTION_IDS.sacredFlame,
      ],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Sorcerer, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Sorcerer, 'Чародей SC-03', {
      ac: 13, hp: 12, abilityMods: { cha: 3, str: 0, con: 2 }, spellcastingAbility: 'cha',
      resources: { spell_slot_1: 2 }, saveProficiencies: ['con'],
      actionIds: [
        MICRO_MVP_SCENARIO_ACTION_IDS.innateSorcery,
        MICRO_MVP_SCENARIO_ACTION_IDS.fireBolt,
        MICRO_MVP_SCENARIO_ACTION_IDS.acidSplash,
      ],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid, 'Друид SC-03', {
      ac: 13, hp: 12, abilityMods: { wis: 3, int: 0, con: 2 }, spellcastingAbility: 'wis',
      resources: { spell_slot_1: 2 }, saveProficiencies: ['wis'], passives: [PRIMAL_ORDER_MAGICIAN],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.entangle],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Warlock, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Warlock, 'Колдун SC-04', {
      ac: 13, hp: 14, abilityMods: { cha: 3, con: 1, str: 0 }, spellcastingAbility: 'cha',
      resources: { pact_slot_1: 1 }, resourceRecharge: { pact_slot_1: 'short_rest' },
      skillProficiencies: ['deception'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.armsOfHadar],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Fighter, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Fighter, 'Воин SC-04', {
      ac: 15, hp: 18, abilityMods: { str: 3, con: 2 }, saveProficiencies: ['con'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack],
      weapon: LONGSWORD, weaponMasteries: ['longsword'], masteryEffects: MASTERY_MAP,
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Cleric, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Cleric, 'Жрец SC-05', {
      ac: 14, hp: 18, abilityMods: { wis: 3, int: 1, str: 1 }, spellcastingAbility: 'wis',
      resources: { spell_slot_1: 1 }, skillProficiencies: ['investigation'], saveProficiencies: ['wis'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.guidance, MICRO_MVP_SCENARIO_ACTION_IDS.sacredFlame],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Rogue, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Rogue, 'Плут SC-05', {
      ac: 14, hp: 16, abilityMods: { dex: 3, wis: 1, str: 1 },
      skillProficiencies: ['perception'], saveProficiencies: ['dex'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.help, MICRO_MVP_SCENARIO_ACTION_IDS.shove],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Caster, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Caster, 'Волшебник-атакующий SC-06', {
      ac: 13, hp: 20, abilityMods: { int: 3, str: 0, con: 1 }, spellcastingAbility: 'int',
      resources: { spell_slot_1: 2 }, skillProficiencies: ['arcana'], saveProficiencies: ['int'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.magicMissile, MICRO_MVP_SCENARIO_ACTION_IDS.shield],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Defender, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Defender, 'Волшебник-защитник SC-06', {
      ac: 12, hp: 20, abilityMods: { int: 3, str: 2, con: 1 }, spellcastingAbility: 'int',
      resources: { spell_slot_1: 2 }, saveProficiencies: ['int'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.shove],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Wizard, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Wizard, 'Волшебник SC-07', {
      ac: 13, hp: 24, abilityMods: { int: 3, dex: 1, str: 0 }, spellcastingAbility: 'int',
      resources: { spell_slot_1: 3 }, saveProficiencies: ['int'],
      actionIds: [
        MICRO_MVP_SCENARIO_ACTION_IDS.minorIllusion,
        MICRO_MVP_SCENARIO_ACTION_IDS.burningHands,
        MICRO_MVP_SCENARIO_ACTION_IDS.light,
        MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic,
      ],
    },
  )],
  [MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Fighter, actorFixture(
    MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Fighter, 'Воин SC-07', {
      ac: 15, hp: 30, abilityMods: { int: 1, str: 3, dex: 1 },
      skillProficiencies: ['investigation'], saveProficiencies: ['str'],
      actionIds: [MICRO_MVP_SCENARIO_ACTION_IDS.shove],
    },
  )],
]);

function cloneActor(actor: ActorState): ActorState {
  return JSON.parse(JSON.stringify(actor)) as ActorState;
}

export function instantiateMicroMvpScenarioActor(fixtureId: string, actorId?: string): ActorState {
  const actor = ACTOR_FIXTURES.get(fixtureId);
  if (!actor) throw new Error(`Unknown micro-MVP scenario fixture ${fixtureId}`);
  const clone = cloneActor(actor);
  return actorId ? { ...clone, id: actorId } : clone;
}

export const MICRO_MVP_SCENARIO_FIXTURES: ScenarioFixtureProvider = {
  getActor: (fixtureId) => {
    const actor = ACTOR_FIXTURES.get(fixtureId);
    return actor ? cloneActor(actor) : undefined;
  },
  catalog: MICRO_MVP_SCENARIO_CATALOG,
};

const COMMON_TRACE = [
  'nonSpellAction',
  'castSpell',
  'applyCondition',
  'savingThrow',
  'abilityCheck',
] as const;

const SC_01_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-01 Study check', sides: 20, value: 12 },
  { label: 'SC-01 attack before Shield', sides: 20, value: 10 },
  { label: 'SC-01 Thunderwave damage 1', sides: 8, value: 3 },
  { label: 'SC-01 Thunderwave damage 2', sides: 8, value: 4 },
  { label: 'SC-01 Second Wind healing', sides: 10, value: 4 },
  { label: 'SC-01 mastery attack', sides: 20, value: 15 },
  { label: 'SC-01 longsword damage', sides: 8, value: 5 },
];

const SC_02_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-02 Hide check', sides: 20, value: 12 },
  { label: 'SC-02 Nick attack advantage high', sides: 20, value: 14 },
  { label: 'SC-02 Nick attack advantage low', sides: 20, value: 4 },
  { label: 'SC-02 first dagger damage', sides: 4, value: 3 },
  { label: 'SC-02 Sneak Attack damage', sides: 6, value: 4 },
  { label: 'SC-02 second Nick attack after Hide ends', sides: 20, value: 13 },
  { label: 'SC-02 second dagger damage', sides: 4, value: 2 },
  { label: 'SC-02 Cure Wounds die 1', sides: 8, value: 3 },
  { label: 'SC-02 Cure Wounds die 2', sides: 8, value: 4 },
  { label: 'SC-02 Sacred Flame damage', sides: 8, value: 5 },
];

const SC_03_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-03 Fire Bolt 1 advantage high', sides: 20, value: 12 },
  { label: 'SC-03 Fire Bolt 1 advantage low', sides: 20, value: 8 },
  { label: 'SC-03 Fire Bolt 1 damage', sides: 10, value: 4 },
  { label: 'SC-03 Primal Order Arcana check', sides: 20, value: 10 },
  { label: 'SC-03 Fire Bolt 2 advantage high', sides: 20, value: 11 },
  { label: 'SC-03 Fire Bolt 2 damage', sides: 10, value: 4 },
  { label: 'SC-03 concentration save', sides: 20, value: 2 },
];

const SC_04_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-04 Arms of Hadar damage 1', sides: 6, value: 3 },
  { label: 'SC-04 Arms of Hadar damage 2', sides: 6, value: 4 },
  { label: 'SC-04 Deception check', sides: 20, value: 10 },
  { label: 'SC-04 fighter attack', sides: 20, value: 14 },
  { label: 'SC-04 fighter damage', sides: 8, value: 6 },
];

const SC_05_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-05 helped Study high', sides: 20, value: 13 },
  { label: 'SC-05 helped Study low', sides: 20, value: 5 },
  { label: 'SC-05 guided Search', sides: 20, value: 10 },
  { label: 'SC-05 Guidance bonus', sides: 4, value: 2 },
  { label: 'SC-05 external hazard save', sides: 20, value: 4 },
  { label: 'SC-05 Sacred Flame damage', sides: 8, value: 6 },
];

const SC_06_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-06 Arcana check', sides: 20, value: 12 },
  { label: 'SC-06 defender Magic Missile dart 1', sides: 4, value: 2 },
  { label: 'SC-06 defender Magic Missile dart 2', sides: 4, value: 3 },
];

const SC_07_ROLL_TAPE: readonly DieTapeEntry[] = [
  { label: 'SC-07 Study Minor Illusion', sides: 20, value: 10 },
  { label: 'SC-07 Burning Hands damage 1', sides: 6, value: 3 },
  { label: 'SC-07 Burning Hands damage 2', sides: 6, value: 4 },
  { label: 'SC-07 Burning Hands damage 3', sides: 6, value: 5 },
  { label: 'SC-07 fighter Investigation check', sides: 20, value: 11 },
];

const SC_01: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-01',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_01_ROLL_TAPE],
  actors: {
    fighter: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Fighter },
    wizard: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Wizard },
  },
  objects: [{
    id: 'sc01-crate', name: 'Unsecured crate', kind: 'environment', size: 'medium',
    secured: false,
  }],
  initiative: ['fighter', 'wizard'],
  steps: [
    { do: 'startTurn', actor: 'fighter', assertions: [{ id: 'SC-01-TURN-FIGHTER-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'abilityCheck', actor: 'fighter', ability: 'int', skill: 'investigation', dc: 10, assertions: [{ id: 'SC-01-STUDY-CHECK', type: 'event', eventType: 'roll' }] },
    { do: 'use', actor: 'fighter', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack, actionKind: 'nonSpell', targets: ['wizard'], factsByTarget: { wizard: enemy(5) }, assertions: [
      { id: 'SC-01-SHIELD-WINDOW-BEFORE-DAMAGE', type: 'pending', pendingType: 'attack_reaction' },
      { id: 'SC-01-WIZARD-HP-UNTOUCHED-BEFORE-REACTION', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 12 },
    ] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-01-SHIELD-WINDOW-RELOAD', type: 'pending', pendingType: 'attack_reaction' }] },
    { do: 'resolveReaction', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shield, assertions: [
      { id: 'SC-01-SHIELD-CLOSES-WINDOW', type: 'pending', pendingType: null },
      { id: 'SC-01-SHIELD-TURNS-HIT-INTO-MISS', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 12 },
      { id: 'SC-01-SHIELD-COSTS-REACTION', type: 'equals', path: 'actors.wizard.runtime.resources.reaction', value: 0 },
      { id: 'SC-01-SHIELD-COSTS-SLOT', type: 'equals', path: 'actors.wizard.runtime.resources.spell_slot_1', value: 1 },
      { id: 'SC-01-SHIELD-POST-REACTION-ROLL', type: 'event', eventType: 'roll' },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [{ id: 'SC-01-TURN-FIGHTER-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-01-TURN-WIZARD-1', type: 'event', eventType: 'turn_started' },
      { id: 'SC-01-SHIELD-DURATION-EXPIRES', type: 'event', eventType: 'effect_expired' },
      { id: 'SC-01-SHIELD-EFFECT-REMOVED', type: 'equals', path: 'actors.wizard.runtime.activeEffects', value: [] },
    ] },
    { do: 'use', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.thunderwave, actionKind: 'spell', targets: ['fighter'], factsByTarget: { fighter: enemy(10) }, spell: { baseLevel: 1 }, worldInput: {
      type: 'area_objects',
      factsByObject: {
        'sc01-crate': {
          factsSource: 'scenario', boardRevision: 2, distanceFt: 10,
          lineOfSight: true, entirelyInArea: true,
        },
      },
    }, assertions: [
      { id: 'SC-01-THUNDERWAVE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' },
      { id: 'SC-01-THUNDERWAVE-SLOT-COST', type: 'equals', path: 'actors.wizard.runtime.resources.spell_slot_1', value: 0 },
      { id: 'SC-01-THUNDERWAVE-OBJECT-PUSH', type: 'equals', path: 'objects.sc01-crate.displacementFt', value: 10 },
    ] },
    { do: 'resolveDecision', actor: 'fighter', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] }, assertions: [
      { id: 'SC-01-THUNDERWAVE-SAVE-ROLL', type: 'event', eventType: 'roll' },
      { id: 'SC-01-THUNDERWAVE-DAMAGE', type: 'equals', path: 'actors.fighter.runtime.hp.current', value: 7 },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [{ id: 'SC-01-TURN-WIZARD-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'fighter', assertions: [{ id: 'SC-01-ROUND-2', type: 'equals', path: 'scene.round', value: 2 }] },
    { do: 'use', actor: 'fighter', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.secondWind, actionKind: 'nonSpell', targets: [], factsByTarget: {}, assertions: [
      { id: 'SC-01-SECOND-WIND-HEALS', type: 'equals', path: 'actors.fighter.runtime.hp.current', value: 12 },
      { id: 'SC-01-SECOND-WIND-HEAL-EVENT', type: 'event', match: {
        engineEventType: 'healing', sourceActorId: 'fighter', targetIds: [],
        payloadSubset: { event: { amount: 5 } },
      }, exactly: 1 },
      { id: 'SC-01-SECOND-WIND-COSTS-BONUS-ACTION', type: 'equals', path: 'actors.fighter.runtime.resources.bonus_action', value: 0 },
      { id: 'SC-01-SECOND-WIND-COSTS-ONE-USE', type: 'equals', path: `actors.fighter.runtime.resources.${SECOND_WIND_2024_RESOURCE_KEY}`, value: 1 },
    ] },
    { do: 'use', actor: 'fighter', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack, actionKind: 'nonSpell', targets: ['wizard'], factsByTarget: { wizard: enemy(5) }, assertions: [
      { id: 'SC-01-MASTERY-SAVE-WINDOW', type: 'pending', pendingType: 'mastery_save' },
      { id: 'SC-01-MASTERY-NOT-APPLIED-BEFORE-SAVE', type: 'condition', actor: 'wizard', condition: 'prone', present: false },
      { id: 'SC-01-WEAPON-HIT-DAMAGE', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 4 },
    ] },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-01-MASTERY-SAVE-RELOAD', type: 'pending', pendingType: 'mastery_save' },
      { id: 'SC-01-MASTERY-DAMAGE-NOT-REPEATED', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 4 },
      { id: 'SC-01-THUNDERWAVE-OBJECT-RELOAD', type: 'equals', path: 'objects.sc01-crate.displacementFt', value: 10 },
    ] },
    { do: 'resolveDecision', actor: 'wizard', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] }, assertions: [
      { id: 'SC-01-MASTERY-SAVE-CLOSED', type: 'pending', pendingType: null },
      { id: 'SC-01-MASTERY-PRONE-STATE', type: 'condition', actor: 'wizard', condition: 'prone', present: true },
      { id: 'SC-01-MASTERY-CONDITION-EVENT', type: 'event', match: {
        engineEventType: 'condition_applied', sourceActorId: 'fighter', targetIds: ['wizard'],
        includesObligationIds: [`entity:${TOPPLE_MASTERY_ID}`, 'system:weapon-mastery', 'system:target-save'],
      } },
      { id: 'SC-01-MASTERY-DOES-NOT-REPEAT-DAMAGE', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 4 },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [{ id: 'SC-01-TURN-FIGHTER-END-2', type: 'event', eventType: 'turn_ended' }] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_02: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-02',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_02_ROLL_TAPE],
  actors: {
    rogue: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Rogue },
    cleric: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Cleric },
  },
  initiative: ['rogue', 'cleric'],
  autoStartEncounter: false,
  steps: [
    { do: 'hide', actor: 'rogue', eligibility: {
      factsSource: 'scenario', boardRevision: 1, heavilyObscured: false,
      cover: 'half', visibleToAnyEnemy: true,
    }, expectedResult: { status: 'rejected', code: 'HideNotEligible' }, assertions: [
      { id: 'SC-02-HIDE-INELIGIBLE-FAILS-CLOSED', type: 'equals', path: 'actors.rogue.runtime.resources.action', value: 1 },
    ] },
    { do: 'hide', actor: 'rogue', eligibility: {
      factsSource: 'scenario', boardRevision: 1, heavilyObscured: false,
      cover: 'three_quarters', visibleToAnyEnemy: false,
    }, assertions: [
      { id: 'SC-02-HIDE-INVISIBLE', type: 'condition', actor: 'rogue', condition: 'invisible', present: true },
      { id: 'SC-02-HIDE-CHECK', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'rogue', roll: { kind: 'check', outcome: 'success' },
        includesObligationIds: ['entity:core:dnd5e-2024:action:hide', 'system:hide-action'],
      } },
      { id: 'SC-02-HIDE-FACT-PROVENANCE', type: 'event', match: {
        payloadType: 'ActionDeclared', sourceActorId: 'rogue',
        payloadSubset: { actionId: 'core.action.hide', facts: { dc: 15 } },
      } },
    ] },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-02-HIDE-RELOAD', type: 'condition', actor: 'rogue', condition: 'invisible', present: true },
    ] },
    { do: 'startEncounter', actor: 'rogue', assertions: [
      { id: 'SC-02-EXPLICIT-ENCOUNTER', type: 'equals', path: 'scene.mode', value: 'encounter' },
    ] },
    { do: 'startTurn', actor: 'rogue', assertions: [{ id: 'SC-02-TURN-ROGUE-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'rogue', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack, actionKind: 'nonSpell', targets: ['cleric'], factsByTarget: { cleric: { ...enemy(5), targetCanSeeSource: false } }, assertions: [
      { id: 'SC-02-SNEAK-POSITIVE-DAMAGE', type: 'equals', path: 'actors.cleric.runtime.hp.current', value: 5 },
      { id: 'SC-02-SNEAK-ONCE-TURN-LEDGER', type: 'equals', path: 'actors.rogue.runtime.firedThisTurn', value: [SNEAK_ATTACK_ID] },
      { id: 'SC-02-HIDE-ENDS-AFTER-FIRST-ATTACK', type: 'condition', actor: 'rogue', condition: 'invisible', present: false },
      { id: 'SC-02-HIDE-EXPIRY-EVENT', type: 'event', eventType: 'effect_expired', exactly: 1 },
    ] },
    { do: 'endTurn', actor: 'rogue', assertions: [{ id: 'SC-02-TURN-ROGUE-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'cleric', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.bless, actionKind: 'spell', targets: ['rogue'], factsByTarget: { rogue: ally(30) }, spell: { baseLevel: 1 }, assertions: [
      { id: 'SC-02-BLESS-TARGET-EFFECT', type: 'equals', path: 'actors.rogue.runtime.activeEffects.0.name', value: 'Благословение' },
      { id: 'SC-02-BLESS-CONCENTRATION', type: 'equals', path: 'concentrations.cleric.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.bless },
    ] },
    { do: 'endTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'rogue', assertions: [{ id: 'SC-02-ROUND-2', type: 'equals', path: 'scene.round', value: 2 }] },
    { do: 'use', actor: 'rogue', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shove, actionKind: 'nonSpell', targets: ['cleric'], factsByTarget: { cleric: enemy(5) }, assertions: [{ id: 'SC-02-SHOVE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'cleric', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-02-SHOVE-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-02-SHOVE-PRONE', type: 'condition', actor: 'cleric', condition: 'prone', present: true },
    ] },
    { do: 'endTurn', actor: 'rogue', assertions: [{ id: 'SC-02-TURN-ROGUE-END-2', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-2', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'cleric', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.cureWounds, actionKind: 'spell', targets: [], factsByTarget: {}, spell: { baseLevel: 1 }, assertions: [
      { id: 'SC-02-CURE-WOUNDS-HEAL', type: 'equals', path: 'actors.cleric.runtime.hp.current', value: 15 },
      { id: 'SC-02-CURE-WOUNDS-EVENT', type: 'event', eventType: 'healing' },
      { id: 'SC-02-CURE-WOUNDS-SLOT-COST', type: 'equals', path: 'actors.cleric.runtime.resources.spell_slot_1', value: 1 },
    ] },
    { do: 'endTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-END-2', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'rogue', assertions: [{ id: 'SC-02-ROUND-3', type: 'equals', path: 'scene.round', value: 3 }] },
    { do: 'endTurn', actor: 'rogue', assertions: [{ id: 'SC-02-TURN-ROGUE-END-3', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-3', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'cleric', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.sacredFlame, actionKind: 'spell', targets: ['rogue'], factsByTarget: { rogue: enemy(60) }, assertions: [{ id: 'SC-02-SACRED-FLAME-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' }] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-02-SACRED-FLAME-RELOAD', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'rogue', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }, { sides: 4, value: 1 }] }, assertions: [
      { id: 'SC-02-SACRED-FLAME-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-02-SACRED-FLAME-DAMAGE', type: 'equals', path: 'actors.rogue.runtime.hp.current', value: 11 },
    ] },
    { do: 'endTurn', actor: 'cleric', assertions: [{ id: 'SC-02-TURN-CLERIC-END-3', type: 'event', eventType: 'turn_ended' }] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_03: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-03',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_03_ROLL_TAPE],
  actors: {
    sorcerer: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Sorcerer },
    druid: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid },
  },
  initiative: ['sorcerer', 'druid'],
  steps: [
    { do: 'startTurn', actor: 'sorcerer', assertions: [{ id: 'SC-03-TURN-SORCERER-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'sorcerer', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.innateSorcery, actionKind: 'nonSpell', targets: [], factsByTarget: {}, assertions: [
      { id: 'SC-03-INNATE-COSTS-BONUS', type: 'equals', path: 'actors.sorcerer.runtime.resources.bonus_action', value: 0 },
      { id: 'SC-03-INNATE-EXECUTABLE-EFFECT', type: 'equals', path: 'actors.sorcerer.runtime.activeEffects.0.name', value: 'Врождённое чародейство (runtime slice)' },
    ] },
    { do: 'use', actor: 'sorcerer', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.fireBolt, actionKind: 'spell', targets: ['druid'], factsByTarget: { druid: enemy(60) }, spell: { baseLevel: 0 }, assertions: [{ id: 'SC-03-FIRE-BOLT-1-DAMAGE', type: 'equals', path: 'actors.druid.runtime.hp.current', value: 8 }] },
    { do: 'endTurn', actor: 'sorcerer', assertions: [{ id: 'SC-03-TURN-SORCERER-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'druid', assertions: [{ id: 'SC-03-TURN-DRUID-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'abilityCheck', actor: 'druid', ability: 'int', skill: 'arcana', dc: 12, assertions: [{ id: 'SC-03-PRIMAL-ORDER-ARCANA-CHECK', type: 'event', eventType: 'roll' }] },
    { do: 'use', actor: 'druid', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.entangle, actionKind: 'spell', targets: ['sorcerer'], factsByTarget: { sorcerer: enemy(60) }, spell: { baseLevel: 1 }, assertions: [{ id: 'SC-03-ENTANGLE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' }] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-03-ENTANGLE-RELOAD', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'sorcerer', roll: { mode: 'manual', dice: [{ sides: 20, value: 5 }] }, assertions: [
      { id: 'SC-03-ENTANGLE-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-03-ENTANGLE-RESTRAINED', type: 'condition', actor: 'sorcerer', condition: 'restrained', present: true },
      { id: 'SC-03-ENTANGLE-CONCENTRATION', type: 'equals', path: 'concentrations.druid.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.entangle },
    ] },
    { do: 'endTurn', actor: 'druid', assertions: [{ id: 'SC-03-TURN-DRUID-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'sorcerer', assertions: [{ id: 'SC-03-ROUND-2', type: 'equals', path: 'scene.round', value: 2 }] },
    { do: 'use', actor: 'sorcerer', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.fireBolt, actionKind: 'spell', targets: ['druid'], factsByTarget: { druid: enemy(60) }, spell: { baseLevel: 0 }, assertions: [
      { id: 'SC-03-FIRE-BOLT-2-DAMAGE', type: 'equals', path: 'actors.druid.runtime.hp.current', value: 4 },
      { id: 'SC-03-CONCENTRATION-SAVE-WINDOW', type: 'pending', pendingType: 'concentration_save' },
    ] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-03-CONCENTRATION-RELOAD', type: 'pending', pendingType: 'concentration_save' }] },
    { do: 'resolveDecision', actor: 'druid', roll: { mode: 'system' }, assertions: [
      { id: 'SC-03-CONCENTRATION-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-03-CONCENTRATION-CLEARED', type: 'equals', path: 'concentrations', value: {} },
      { id: 'SC-03-RESTRAINED-REMOVED', type: 'condition', actor: 'sorcerer', condition: 'restrained', present: false },
    ] },
    { do: 'endTurn', actor: 'sorcerer', assertions: [{ id: 'SC-03-TURN-SORCERER-END-2', type: 'event', eventType: 'turn_ended' }] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_04: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-04',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_04_ROLL_TAPE],
  actors: {
    warlock: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Warlock },
    fighter: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Fighter },
  },
  initiative: ['warlock', 'fighter'],
  autoStartEncounter: false,
  steps: [
    { do: 'use', actor: 'warlock', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.armsOfHadar, actionKind: 'spell', targets: ['fighter'], factsByTarget: { fighter: enemy(5) }, spell: { baseLevel: 1 }, assertions: [
      { id: 'SC-04-PACT-SLOT-SPENT', type: 'equals', path: 'actors.warlock.runtime.resources.pact_slot_1', value: 0 },
      { id: 'SC-04-ARMS-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' },
    ] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-04-ARMS-RELOAD', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'fighter', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-04-ARMS-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-04-ARMS-DAMAGE', type: 'equals', path: 'actors.fighter.runtime.hp.current', value: 11 },
    ] },
    { do: 'shortRest', actor: 'warlock', assertions: [
      { id: 'SC-04-SHORT-REST-EVENT', type: 'event', eventType: 'short_rest' },
      { id: 'SC-04-PACT-SLOT-RESTORED', type: 'equals', path: 'actors.warlock.runtime.resources.pact_slot_1', value: 1 },
    ] },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-04-BEFORE-ENCOUNTER-IS-EXPLORATION', type: 'equals', path: 'scene.mode', value: 'exploration' },
      { id: 'SC-04-PACT-SLOT-PERSISTS-RELOAD', type: 'equals', path: 'actors.warlock.runtime.resources.pact_slot_1', value: 1 },
    ] },
    { do: 'startEncounter', actor: 'warlock', assertions: [{ id: 'SC-04-EXPLICIT-ENCOUNTER', type: 'equals', path: 'scene.mode', value: 'encounter' }] },
    { do: 'startTurn', actor: 'warlock', assertions: [{ id: 'SC-04-TURN-WARLOCK-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'abilityCheck', actor: 'warlock', ability: 'cha', skill: 'deception', dc: 12, assertions: [{ id: 'SC-04-WARLOCK-CHECK', type: 'event', eventType: 'roll' }] },
    { do: 'endTurn', actor: 'warlock', assertions: [{ id: 'SC-04-TURN-WARLOCK-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'fighter', assertions: [{ id: 'SC-04-TURN-FIGHTER-1', type: 'event', eventType: 'turn_started' }] },
    { do: 'use', actor: 'fighter', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack, actionKind: 'nonSpell', targets: ['warlock'], factsByTarget: { warlock: enemy(5) }, assertions: [
      { id: 'SC-04-MASTERY-SAVE-WINDOW', type: 'pending', pendingType: 'mastery_save' },
      { id: 'SC-04-MASTERY-NOT-APPLIED-BEFORE-SAVE', type: 'condition', actor: 'warlock', condition: 'prone', present: false },
      { id: 'SC-04-FIGHTER-DAMAGE', type: 'equals', path: 'actors.warlock.runtime.hp.current', value: 5 },
    ] },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-04-MASTERY-SAVE-RELOAD', type: 'pending', pendingType: 'mastery_save' },
      { id: 'SC-04-MASTERY-DAMAGE-NOT-REPEATED', type: 'equals', path: 'actors.warlock.runtime.hp.current', value: 5 },
    ] },
    { do: 'resolveDecision', actor: 'warlock', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-04-MASTERY-SAVE-CLOSED', type: 'pending', pendingType: null },
      { id: 'SC-04-MASTERY-CONDITION', type: 'condition', actor: 'warlock', condition: 'prone', present: true },
      { id: 'SC-04-MASTERY-CONDITION-EVENT', type: 'event', match: {
        engineEventType: 'condition_applied', sourceActorId: 'fighter', targetIds: ['warlock'],
        includesObligationIds: [`entity:${TOPPLE_MASTERY_ID}`, 'system:weapon-mastery', 'system:target-save'],
      } },
      { id: 'SC-04-MASTERY-DOES-NOT-REPEAT-DAMAGE', type: 'equals', path: 'actors.warlock.runtime.hp.current', value: 5 },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [{ id: 'SC-04-TURN-FIGHTER-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'warlock', assertions: [
      { id: 'SC-04-ROUND-2', type: 'equals', path: 'scene.round', value: 2 },
    ] },
    { do: 'endTurn', actor: 'warlock', assertions: [{ id: 'SC-04-TURN-WARLOCK-END-2', type: 'event', eventType: 'turn_ended' }] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_05: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-05',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_05_ROLL_TAPE],
  actors: {
    cleric: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Cleric },
    rogue: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc05Rogue },
  },
  initiative: ['cleric', 'rogue'],
  autoStartEncounter: false,
  steps: [
    { do: 'use', actor: 'rogue', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.help, actionKind: 'nonSpell', targets: ['cleric'], factsByTarget: { cleric: ally(5) }, assertions: [
      { id: 'SC-05-HELP-EFFECT-ON-CLERIC', type: 'equals', path: 'actors.cleric.runtime.activeEffects.0.name', value: 'Помощь' },
    ] },
    { do: 'use', actor: 'cleric', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.guidance, actionKind: 'spell', targets: ['rogue'], factsByTarget: { rogue: ally(5) }, spell: { baseLevel: 0 }, assertions: [
      { id: 'SC-05-GUIDANCE-EFFECT-ON-ROGUE', type: 'equals', path: 'actors.rogue.runtime.activeEffects.0.name', value: 'Наставление' },
      { id: 'SC-05-GUIDANCE-CONCENTRATION', type: 'equals', path: 'concentrations.cleric.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.guidance },
    ] },
    { do: 'abilityCheck', actor: 'cleric', ability: 'int', skill: 'investigation', dc: 12, assertions: [{ id: 'SC-05-HELPED-STUDY-CHECK', type: 'event', eventType: 'roll' }] },
    { do: 'abilityCheck', actor: 'rogue', ability: 'wis', skill: 'perception', dc: 12, assertions: [
      { id: 'SC-05-GUIDED-SEARCH-CHECK', type: 'event', eventType: 'roll' },
      { id: 'SC-05-GUIDANCE-REMAINS-UNTIL-DURATION', type: 'equals', path: 'actors.rogue.runtime.activeEffects.0.name', value: 'Наставление' },
      { id: 'SC-05-GUIDANCE-CONCENTRATION-REMAINS', type: 'equals', path: 'concentrations.cleric.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.guidance },
    ] },
    { do: 'triggerHazard', actor: 'rogue', targetActor: 'rogue', hazardId: MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble, assertions: [
      { id: 'SC-05-HAZARD-SAVE-WINDOW', type: 'pending', pendingType: 'hazard_save' },
      { id: 'SC-05-HAZARD-PROVENANCE', type: 'event', match: {
        payloadType: 'ResolutionOpened', sourceActorId: `environment:${MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble}`,
        includesObligationIds: [
          `hazard:${MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble}`,
          'entity:DMG-2024:environment:unstable-rubble',
          'system:pending-resolution',
        ],
      } },
    ] },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-05-EXPLORATION-CHECKPOINT', type: 'equals', path: 'scene.mode', value: 'exploration' },
      { id: 'SC-05-HAZARD-RELOAD', type: 'pending', pendingType: 'hazard_save' },
    ] },
    { do: 'resolveDecision', actor: 'rogue', roll: { mode: 'system' }, assertions: [
      { id: 'SC-05-HAZARD-SAVE', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'rogue', roll: { kind: 'save', outcome: 'fail' },
        includesObligationIds: [`hazard:${MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble}`],
      } },
      { id: 'SC-05-HAZARD-CONSEQUENCE', type: 'condition', actor: 'rogue', condition: 'prone', present: true },
    ] },
    { do: 'startEncounter', actor: 'cleric', assertions: [
      { id: 'SC-05-EXPLICIT-ENCOUNTER', type: 'equals', path: 'scene.mode', value: 'encounter' },
      { id: 'SC-05-HAZARD-CONDITION-CROSSES-BOUNDARY', type: 'condition', actor: 'rogue', condition: 'prone', present: true },
    ] },
    { do: 'startTurn', actor: 'cleric', assertions: [
      { id: 'SC-05-TURN-CLERIC-1', type: 'event', eventType: 'turn_started' },
      { id: 'SC-05-CLERIC-ACTION-RESET', type: 'equals', path: 'actors.cleric.runtime.resources.action', value: 1 },
    ] },
    { do: 'use', actor: 'cleric', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.sacredFlame, actionKind: 'spell', targets: ['rogue'], factsByTarget: { rogue: enemy(60) }, assertions: [{ id: 'SC-05-SACRED-FLAME-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'rogue', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] }, assertions: [
      { id: 'SC-05-SACRED-FLAME-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-05-SACRED-FLAME-DAMAGE', type: 'equals', path: 'actors.rogue.runtime.hp.current', value: 10 },
    ] },
    { do: 'endTurn', actor: 'cleric', assertions: [{ id: 'SC-05-TURN-CLERIC-END-1', type: 'event', eventType: 'turn_ended' }] },
    { do: 'startTurn', actor: 'rogue', assertions: [
      { id: 'SC-05-TURN-ROGUE-1', type: 'event', eventType: 'turn_started' },
      { id: 'SC-05-ROGUE-ACTION-RESET', type: 'equals', path: 'actors.rogue.runtime.resources.action', value: 1 },
    ] },
    { do: 'use', actor: 'rogue', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shove, actionKind: 'nonSpell', targets: ['cleric'], factsByTarget: { cleric: enemy(5) }, assertions: [{ id: 'SC-05-SHOVE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' }] },
    { do: 'checkpointReload', assertions: [{ id: 'SC-05-SHOVE-RELOAD', type: 'pending', pendingType: 'target_save' }] },
    { do: 'resolveDecision', actor: 'cleric', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-05-SHOVE-SAVE', type: 'event', eventType: 'roll' },
      { id: 'SC-05-PRONE-CONDITION', type: 'condition', actor: 'cleric', condition: 'prone', present: true },
    ] },
    { do: 'endTurn', actor: 'rogue', assertions: [{ id: 'SC-05-TURN-ROGUE-END-1', type: 'event', eventType: 'turn_ended' }] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_06: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-06',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_06_ROLL_TAPE],
  actors: {
    caster: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Caster },
    defender: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc06Defender },
  },
  initiative: ['caster', 'defender'],
  steps: [
    { do: 'startTurn', actor: 'caster', assertions: [
      { id: 'SC-06-TURN-CASTER-1', type: 'event', eventType: 'turn_started' },
    ] },
    { do: 'abilityCheck', actor: 'caster', ability: 'int', skill: 'arcana', dc: 15, assertions: [
      { id: 'SC-06-ARCANA-CHECK', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'caster', roll: { kind: 'check', outcome: 'success' },
      } },
    ] },
    {
      do: 'use',
      actor: 'caster',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.magicMissile,
      actionKind: 'spell',
      targets: ['caster', 'defender'],
      factsByTarget: { caster: self(), defender: enemy(60) },
      choices: {
        magic_missile_dart_targets: ['caster', 'defender', 'defender'],
      },
      spell: { baseLevel: 1, castLevel: 1 },
      assertions: [
        { id: 'SC-06-MISSILE-REACTION-WINDOW', type: 'pending', pendingType: 'magic_missile_reaction' },
        { id: 'SC-06-MISSILE-NO-DAMAGE-BEFORE-REACTION', type: 'event', eventType: 'damage', exactly: 0 },
        { id: 'SC-06-DEFENDER-HP-BEFORE-REACTION', type: 'equals', path: 'actors.defender.runtime.hp.current', value: 20 },
        { id: 'SC-06-CASTER-HP-BEFORE-REACTION', type: 'equals', path: 'actors.caster.runtime.hp.current', value: 20 },
        { id: 'SC-06-MISSILE-COSTS-ONE-ACTION', type: 'event', match: {
          engineEventType: 'resource_spent', actorId: 'caster',
          payloadSubset: { event: { resource: 'action', amount: 1 } },
        }, exactly: 1 },
        { id: 'SC-06-MISSILE-COSTS-ONE-SLOT', type: 'event', match: {
          engineEventType: 'resource_spent', actorId: 'caster',
          payloadSubset: { event: { resource: 'spell_slot_1', amount: 1 } },
        }, exactly: 1 },
        { id: 'SC-06-MISSILE-ALLOCATION-PROVENANCE', type: 'event', match: {
          payloadType: 'ActionDeclared', sourceActorId: 'caster', actorId: 'caster',
          payloadSubset: {
            actionId: MICRO_MVP_SCENARIO_ACTION_IDS.magicMissile,
            targetIds: ['caster', 'defender'],
            facts: {
              magicMissileDartTargetIds: ['caster', 'defender', 'defender'],
              simultaneous: true,
            },
          },
        }, exactly: 1 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-06-MISSILE-WINDOW-RELOAD', type: 'pending', pendingType: 'magic_missile_reaction' },
      { id: 'SC-06-MISSILE-COSTS-PERSIST-RELOAD', type: 'equals', path: 'actors.caster.runtime.resources.spell_slot_1', value: 1 },
    ] },
    {
      do: 'resolveReaction',
      actor: 'caster',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shield,
      assertions: [
        { id: 'SC-06-SHIELD-CLOSES-WINDOW', type: 'pending', pendingType: null },
        { id: 'SC-06-SHIELD-BLOCKS-CASTER-DART', type: 'equals', path: 'actors.caster.runtime.hp.current', value: 20 },
        { id: 'SC-06-MISSILE-OTHER-TARGET-DAMAGED', type: 'equals', path: 'actors.defender.runtime.hp.current', value: 13 },
        { id: 'SC-06-SHIELD-COSTS-ONE-REACTION', type: 'event', match: {
          engineEventType: 'resource_spent', actorId: 'caster',
          payloadSubset: { event: { resource: 'reaction', amount: 1 } },
        }, exactly: 1 },
        { id: 'SC-06-SHIELD-COSTS-ONE-SLOT', type: 'event', match: {
          engineEventType: 'resource_spent', actorId: 'caster',
          payloadSubset: { event: { resource: 'spell_slot_1', amount: 1 } },
        }, exactly: 1 },
        { id: 'SC-06-SHIELD-REACTION-DECLARED', type: 'event', match: {
          payloadType: 'ActionDeclared', sourceActorId: 'caster', actorId: 'caster',
          payloadSubset: {
            actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shield,
            timing: 'reaction',
            facts: { trigger: 'targeted_by_magic_missile', dartCount: 1 },
          },
        }, exactly: 1 },
        { id: 'SC-06-SHIELD-IMMUNITY-MARKER', type: 'equals', path: 'actors.caster.runtime.activeEffects.0.mechanics.magic_missile_immunity', value: true },
        { id: 'SC-06-SHIELD-PLUS-FIVE-MARKER', type: 'equals', path: 'actors.caster.runtime.activeEffects.0.mechanics.value', value: '+5' },
        { id: 'SC-06-SHIELD-BLOCKS-ONE-DART-EVENT', type: 'event', match: {
          engineEventType: 'narrative', targetIds: ['caster'],
          payloadSubset: { facts: { magicMissile: { simultaneous: true, shielded: true } } },
        }, exactly: 1 },
        { id: 'SC-06-MISSILE-FIRST-SEPARATE-D4-PLUS-ONE', type: 'event', match: {
          engineEventType: 'damage', targetIds: ['defender'],
          payloadSubset: {
            event: {
              amount: 3,
              damageType: 'force',
              roll: { dice: [{ sides: 4, result: 2 }], total: 3 },
            },
            facts: {
              magicMissile: { dartOrdinal: 2, simultaneous: true, shielded: false },
            },
          },
        }, exactly: 1 },
        { id: 'SC-06-MISSILE-SECOND-SEPARATE-D4-PLUS-ONE', type: 'event', match: {
          engineEventType: 'damage', targetIds: ['defender'],
          payloadSubset: {
            event: {
              amount: 4,
              damageType: 'force',
              roll: { dice: [{ sides: 4, result: 3 }], total: 4 },
            },
            facts: {
              magicMissile: { dartOrdinal: 3, simultaneous: true, shielded: false },
            },
          },
        }, exactly: 1 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-06-SHIELD-STATE-RELOAD', type: 'equals', path: 'actors.caster.runtime.activeEffects.0.mechanics.magic_missile_immunity', value: true },
      { id: 'SC-06-MISSILE-HP-RELOAD', type: 'equals', path: 'actors.defender.runtime.hp.current', value: 13 },
    ] },
    { do: 'endTurn', actor: 'caster', assertions: [
      { id: 'SC-06-TURN-CASTER-END-1', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'defender', assertions: [
      { id: 'SC-06-TURN-DEFENDER-1', type: 'event', eventType: 'turn_started' },
      { id: 'SC-06-SHIELD-REMAINS-THROUGH-OTHER-TURN', type: 'equals', path: 'actors.caster.runtime.activeEffects.0.mechanics.magic_missile_immunity', value: true },
    ] },
    {
      do: 'use',
      actor: 'defender',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shove,
      actionKind: 'nonSpell',
      targets: ['caster'],
      factsByTarget: { caster: enemy(5) },
      assertions: [
        { id: 'SC-06-SHOVE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' },
        { id: 'SC-06-SHOVE-NOT-APPLIED-BEFORE-SAVE', type: 'condition', actor: 'caster', condition: 'prone', present: false },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-06-SHOVE-WINDOW-RELOAD', type: 'pending', pendingType: 'target_save' },
    ] },
    { do: 'resolveDecision', actor: 'caster', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-06-SHOVE-SAVE-ROLL', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'caster', roll: { kind: 'save', outcome: 'fail' },
      } },
      { id: 'SC-06-SHOVE-PRONE', type: 'condition', actor: 'caster', condition: 'prone', present: true },
      { id: 'SC-06-SHOVE-CONDITION-EVENT', type: 'event', match: {
        engineEventType: 'condition_applied', sourceActorId: 'defender', targetIds: ['caster'],
      } },
    ] },
    { do: 'endTurn', actor: 'defender', assertions: [
      { id: 'SC-06-TURN-DEFENDER-END-1', type: 'event', eventType: 'turn_ended' },
      { id: 'SC-06-FULL-ROUND-COMPLETE', type: 'equals', path: 'scene.round', value: 2 },
    ] },
    { do: 'startTurn', actor: 'caster', assertions: [
      { id: 'SC-06-TURN-CASTER-2', type: 'event', eventType: 'turn_started' },
      { id: 'SC-06-SHIELD-EXPIRES-AT-CASTER-START', type: 'event', eventType: 'effect_expired', exactly: 1 },
      { id: 'SC-06-SHIELD-STATE-REMOVED', type: 'equals', path: 'actors.caster.runtime.activeEffects.length', value: 1 },
      { id: 'SC-06-SHOVE-PRONE-SURVIVES-SHIELD-EXPIRY', type: 'condition', actor: 'caster', condition: 'prone', present: true },
    ] },
    { do: 'endTurn', actor: 'caster', assertions: [
      { id: 'SC-06-TURN-CASTER-END-2', type: 'event', eventType: 'turn_ended' },
    ] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

const SC_07_ILLUSION_ID = 'SC-07:step:2:id:1';

const SC_07: ScenarioSpec = {
  schemaVersion: 1,
  id: 'SC-07',
  ruleset: MICRO_MVP_SCENARIO_RULESET,
  rollTape: [...SC_07_ROLL_TAPE],
  actors: {
    wizard: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Wizard },
    fighter: { fixtureId: MICRO_MVP_SCENARIO_FIXTURE_IDS.sc07Fighter },
  },
  objects: [
    {
      id: 'curtain', name: 'Curtain', kind: 'environment', size: 'large',
      flammable: true, unattended: true,
    },
    { id: 'torch', name: 'Torch', kind: 'item', size: 'tiny', flammable: true },
    {
      id: 'rune', name: 'Abjuration rune', kind: 'spell_effect', size: 'small',
      magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
    },
  ],
  initiative: ['wizard', 'fighter'],
  steps: [
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-1', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'use', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.minorIllusion,
      actionKind: 'spell', targets: [], factsByTarget: {}, spell: { baseLevel: 0 },
      worldInput: {
        type: 'minor_illusion', form: 'image', description: 'Closed iron door', imageCubeSideFt: 5,
        facts: { factsSource: 'scenario', boardRevision: 1, distanceFt: 30, lineOfSight: true },
      },
      assertions: [
        { id: 'SC-07-MINOR-ILLUSION-CREATED', type: 'event', match: {
          payloadType: 'WorldObjectMutationRecorded', sourceActorId: 'wizard',
          includesObligationIds: ['system:minor-illusion', 'system:world-object'],
          payloadSubset: {
            event: {
              type: 'WorldObjectCreated',
              object: {
                id: SC_07_ILLUSION_ID,
                roundsLeft: 10,
                illusion: {
                  form: 'image', description: 'Closed iron door', spellSaveDc: 13,
                  imageCubeSideFt: 5, discernedByActorIds: [], physicallyRevealedToActorIds: [],
                },
              },
            },
          },
        }, exactly: 1 },
        { id: 'SC-07-MINOR-ILLUSION-COST', type: 'equals', path: 'actors.wizard.runtime.resources.action', value: 0 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-07-MINOR-ILLUSION-RELOAD', type: 'equals', path: `objects.${SC_07_ILLUSION_ID}.roundsLeft`, value: 10 },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-END-1', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-TURN-FIGHTER-1', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'studyWorldObject', actor: 'fighter', objectId: SC_07_ILLUSION_ID,
      facts: { factsSource: 'scenario', boardRevision: 1, distanceFt: 5, lineOfSight: true },
      assertions: [
        { id: 'SC-07-MINOR-ILLUSION-STUDY-ROLL', type: 'event', match: {
          engineEventType: 'roll', sourceActorId: 'fighter', roll: { kind: 'check', outcome: 'success' },
        }, exactly: 1 },
        { id: 'SC-07-MINOR-ILLUSION-DISCERNED', type: 'equals', path: `objects.${SC_07_ILLUSION_ID}.illusion.discernedByActorIds.0`, value: 'fighter' },
        { id: 'SC-07-STUDY-COSTS-ACTION', type: 'equals', path: 'actors.fighter.runtime.resources.action', value: 0 },
      ],
    },
    {
      do: 'physicalInteractWorldObject', actor: 'fighter', objectId: SC_07_ILLUSION_ID,
      facts: {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
        lineOfSight: true, touched: true,
      },
      assertions: [
        { id: 'SC-07-MINOR-ILLUSION-PHYSICALLY-REVEALED', type: 'equals', path: `objects.${SC_07_ILLUSION_ID}.illusion.physicallyRevealedToActorIds.0`, value: 'fighter' },
        { id: 'SC-07-PHYSICAL-INTERACTION-DECLARED', type: 'event', match: {
          payloadType: 'ActionDeclared', sourceActorId: 'fighter',
          payloadSubset: { actionId: 'core.interaction.physical-world-object' },
        }, exactly: 1 },
      ],
    },
    { do: 'endTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-ROUND-2', type: 'equals', path: 'scene.round', value: 2 },
      { id: 'SC-07-ILLUSION-DURATION-ADVANCED', type: 'equals', path: `objects.${SC_07_ILLUSION_ID}.roundsLeft`, value: 9 },
    ] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-2', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'use', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.burningHands,
      actionKind: 'spell', targets: ['fighter'], factsByTarget: { fighter: enemy(10) },
      spell: { baseLevel: 1 },
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          curtain: {
            factsSource: 'scenario', boardRevision: 2, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
          torch: {
            factsSource: 'scenario', boardRevision: 2, distanceFt: 20,
            lineOfSight: true, inArea: false,
          },
        },
      },
      assertions: [
        { id: 'SC-07-BURNING-HANDS-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' },
        { id: 'SC-07-BURNING-HANDS-IGNITES-CURTAIN', type: 'equals', path: 'objects.curtain.ignited', value: true },
        { id: 'SC-07-BURNING-HANDS-DOES-NOT-IGNITE-OUTSIDE', type: 'event', match: {
          payloadType: 'WorldObjectMutationRecorded',
          payloadSubset: { event: { objectId: 'torch', type: 'WorldObjectIgnited' } },
        }, exactly: 0 },
        { id: 'SC-07-BURNING-HANDS-SLOT-COST', type: 'equals', path: 'actors.wizard.runtime.resources.spell_slot_1', value: 2 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-07-BURNING-HANDS-WINDOW-RELOAD', type: 'pending', pendingType: 'target_save' },
      { id: 'SC-07-BURNING-HANDS-OBJECT-RELOAD', type: 'equals', path: 'objects.curtain.ignited', value: true },
    ] },
    { do: 'resolveDecision', actor: 'fighter', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-07-BURNING-HANDS-SAVE-ROLL', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'fighter', roll: { kind: 'save', outcome: 'fail' },
      }, exactly: 1 },
      { id: 'SC-07-BURNING-HANDS-DAMAGE', type: 'equals', path: 'actors.fighter.runtime.hp.current', value: 18 },
      { id: 'SC-07-BURNING-HANDS-THREE-D6', type: 'event', match: {
        engineEventType: 'damage', targetIds: ['fighter'],
        payloadSubset: { event: { amount: 12, damageType: 'fire' } },
      }, exactly: 1 },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-END-2', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-TURN-FIGHTER-2', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'use', actor: 'fighter', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.shove,
      actionKind: 'nonSpell', targets: ['wizard'], factsByTarget: { wizard: enemy(5) },
      assertions: [
        { id: 'SC-07-SHOVE-SAVE-WINDOW', type: 'pending', pendingType: 'target_save' },
        { id: 'SC-07-WIZARD-NOT-PRONE-BEFORE-SAVE', type: 'condition', actor: 'wizard', condition: 'prone', present: false },
      ],
    },
    { do: 'resolveDecision', actor: 'wizard', roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }] }, assertions: [
      { id: 'SC-07-SHOVE-SAVE', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'wizard', roll: { kind: 'save', outcome: 'fail' },
      }, exactly: 1 },
      { id: 'SC-07-WIZARD-PRONE', type: 'condition', actor: 'wizard', condition: 'prone', present: true },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-ROUND-3', type: 'equals', path: 'scene.round', value: 3 },
    ] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-3', type: 'event', eventType: 'turn_started' },
      { id: 'SC-07-WIZARD-PRONE-PERSISTS', type: 'condition', actor: 'wizard', condition: 'prone', present: true },
    ] },
    {
      do: 'use', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.light,
      actionKind: 'spell', targets: [], factsByTarget: {}, spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'torch',
        facts: {
          factsSource: 'scenario', boardRevision: 3, distanceFt: 0,
          lineOfSight: true, touched: true,
        },
      },
      assertions: [
        { id: 'SC-07-LIGHT-BRIGHT-RADIUS', type: 'equals', path: 'objects.torch.illumination.brightRadiusFt', value: 20 },
        { id: 'SC-07-LIGHT-DIM-RADIUS', type: 'equals', path: 'objects.torch.illumination.dimAdditionalRadiusFt', value: 20 },
        { id: 'SC-07-LIGHT-DURATION', type: 'equals', path: 'objects.torch.illumination.roundsLeft', value: 600 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-07-LIGHT-RELOAD', type: 'equals', path: 'objects.torch.illumination.roundsLeft', value: 600 },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-END-3', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-TURN-FIGHTER-3', type: 'event', eventType: 'turn_started' },
    ] },
    { do: 'abilityCheck', actor: 'fighter', ability: 'int', skill: 'investigation', dc: 12, assertions: [
      { id: 'SC-07-FIGHTER-EXPLICIT-CHECK', type: 'event', match: {
        engineEventType: 'roll', sourceActorId: 'fighter', roll: { kind: 'check', outcome: 'success' },
      }, exactly: 1 },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-ROUND-4', type: 'equals', path: 'scene.round', value: 4 },
      { id: 'SC-07-LIGHT-ONE-ROUND-ELAPSED', type: 'equals', path: 'objects.torch.illumination.roundsLeft', value: 599 },
    ] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-4', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'use', actor: 'wizard', actionId: MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic,
      actionKind: 'spell', targets: [], factsByTarget: {}, spell: { baseLevel: 1 },
      assertions: [
        { id: 'SC-07-DETECT-MAGIC-CONCENTRATION', type: 'equals', path: 'concentrations.wizard.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic },
        { id: 'SC-07-DETECT-MAGIC-SLOT-COST', type: 'equals', path: 'actors.wizard.runtime.resources.spell_slot_1', value: 1 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-07-DETECT-MAGIC-CONCENTRATION-RELOAD', type: 'equals', path: 'concentrations.wizard.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-END-4', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-TURN-FIGHTER-4', type: 'event', eventType: 'turn_started' },
    ] },
    { do: 'endTurn', actor: 'fighter', assertions: [
      { id: 'SC-07-ROUND-5', type: 'equals', path: 'scene.round', value: 5 },
    ] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-5', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'revealMagicAura', actor: 'wizard',
      observations: {
        rune: {
          facts: { factsSource: 'scenario', boardRevision: 5, distanceFt: 30, lineOfSight: true },
          blockingLayers: [],
        },
      },
      assertions: [
        { id: 'SC-07-DETECT-MAGIC-AURA', type: 'event', match: {
          payloadType: 'WorldObjectMutationRecorded', sourceActorId: 'wizard',
          includesObligationIds: ['system:detect-magic', 'system:magic-action'],
          payloadSubset: {
            event: {
              type: 'WorldObjectObserved', objectId: 'rune', actorId: 'wizard',
              observation: 'detect_magic_aura',
              details: { sensed: true, auraVisible: true, school: 'abjuration' },
            },
          },
        }, exactly: 1 },
        { id: 'SC-07-DETECT-MAGIC-ACTION-COST', type: 'equals', path: 'actors.wizard.runtime.resources.action', value: 0 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-07-DETECT-MAGIC-FINAL-RELOAD', type: 'equals', path: 'concentrations.wizard.actionId', value: MICRO_MVP_SCENARIO_ACTION_IDS.detectMagic },
      { id: 'SC-07-FINAL-FIGHTER-HP', type: 'equals', path: 'actors.fighter.runtime.hp.current', value: 18 },
    ] },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-07-TURN-WIZARD-END-5', type: 'event', eventType: 'turn_ended' },
    ] },
  ],
  requiredTrace: [...COMMON_TRACE],
};

export type MicroMvpScenarioId =
  | 'SC-01'
  | 'SC-02'
  | 'SC-03'
  | 'SC-04'
  | 'SC-05'
  | 'SC-06'
  | 'SC-07';

export interface MicroMvpScenarioCase {
  id: MicroMvpScenarioId;
  spec: ScenarioSpec;
  rngTape: readonly DieTapeEntry[];
}

export const MICRO_MVP_SCENARIO_CORPUS: Record<MicroMvpScenarioId, MicroMvpScenarioCase> = {
  'SC-01': { id: 'SC-01', spec: SC_01, rngTape: SC_01_ROLL_TAPE },
  'SC-02': { id: 'SC-02', spec: SC_02, rngTape: SC_02_ROLL_TAPE },
  'SC-03': { id: 'SC-03', spec: SC_03, rngTape: SC_03_ROLL_TAPE },
  'SC-04': { id: 'SC-04', spec: SC_04, rngTape: SC_04_ROLL_TAPE },
  'SC-05': { id: 'SC-05', spec: SC_05, rngTape: SC_05_ROLL_TAPE },
  'SC-06': { id: 'SC-06', spec: SC_06, rngTape: SC_06_ROLL_TAPE },
  'SC-07': { id: 'SC-07', spec: SC_07, rngTape: SC_07_ROLL_TAPE },
};

export type MicroMvpScenarioGapId = never;

export interface MicroMvpScenarioCapabilityGap {
  id: MicroMvpScenarioGapId;
  scenarios: readonly MicroMvpScenarioId[];
  requiredCoreChange: string;
  observedBaseline: string;
}

export const MICRO_MVP_SCENARIO_CAPABILITY_GAPS: readonly MicroMvpScenarioCapabilityGap[] = [];

export class MicroMvpScenarioCapabilityError extends Error {
  constructor(public readonly gaps: readonly MicroMvpScenarioCapabilityGap[]) {
    super(`micro-MVP scenario corpus is not acceptance-ready: ${gaps.map((gap) => gap.id).join(', ')}`);
    this.name = 'MicroMvpScenarioCapabilityError';
  }
}

export function assertMicroMvpScenarioCorpusReady(): void {
  if (MICRO_MVP_SCENARIO_CAPABILITY_GAPS.length) {
    throw new MicroMvpScenarioCapabilityError(MICRO_MVP_SCENARIO_CAPABILITY_GAPS);
  }
}

export function validateMicroMvpScenarioActionKinds(spec: ScenarioSpec): void {
  for (const [index, step] of spec.steps.entries()) {
    if (step.do !== 'use') continue;
    const entry = MICRO_MVP_SCENARIO_CATALOG_ENTRIES[step.actionId];
    if (!entry) throw new Error(`${spec.id}: step ${index + 1} uses uncertified action ${step.actionId}`);
    if (entry.actionKind !== step.actionKind) {
      throw new Error(
        `${spec.id}: step ${index + 1} declares ${step.actionKind} for ${step.actionId}; catalog says ${entry.actionKind}`,
      );
    }
  }
}

export interface MicroMvpScenarioExecution extends ScenarioRun {
  rngConsumed: number;
}

function authoritativeObservedTrace(
  events: readonly ScenarioRun['events'][number][],
): RequiredScenarioTrace[] {
  const observed = new Set<RequiredScenarioTrace>();
  for (const entry of events) {
    if (entry.payload.type === 'ActionDeclared') {
      observed.add(entry.payload.actionKind === 'spell' ? 'castSpell' : 'nonSpellAction');
      continue;
    }
    if (entry.payload.type !== 'EngineEventRecorded') continue;
    const event = entry.payload.event;
    if (event.type === 'condition_applied') observed.add('applyCondition');
    if (event.type === 'roll' && event.roll.kind === 'check') observed.add('abilityCheck');
    if (event.type === 'roll' && event.roll.kind === 'save') observed.add('savingThrow');
  }
  return [...observed].sort();
}

export function runMicroMvpScenarioCase(
  scenario: MicroMvpScenarioCase,
  tapeEntries: readonly DieTapeEntry[] = scenario.rngTape,
): MicroMvpScenarioExecution {
  validateMicroMvpScenarioActionKinds(scenario.spec);
  const spec: ScenarioSpec = { ...scenario.spec, rollTape: [...tapeEntries] };
  const run = runScenario(spec, MICRO_MVP_SCENARIO_FIXTURES, {
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory(`unused-${scenario.id}`),
  });
  const observedTrace = authoritativeObservedTrace(run.events);
  const missing = scenario.spec.requiredTrace.filter((trace) => !observedTrace.includes(trace));
  if (missing.length) {
    throw new Error(`${scenario.id}: authoritative ActionDeclared trace misses ${missing.join(', ')}`);
  }
  if (run.rngConsumed == null) throw new Error(`${scenario.id}: inline roll tape was not consumed`);
  return { ...run, observedTrace, rngConsumed: run.rngConsumed };
}

export const MICRO_MVP_SCENARIO_FACTS = { enemy, ally, self } as const;
