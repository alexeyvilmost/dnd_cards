import type { Ability, ActorAttackProfile, JsonObject } from './domain';
import {
  familiarStateIssue,
  type FamiliarState,
  type FindFamiliarBaseForm,
  type PactChainSpecialFamiliarForm,
} from './findFamiliar';

export type FamiliarCatalogForm = FindFamiliarBaseForm | PactChainSpecialFamiliarForm;
export type CreatureSize = 'tiny' | 'small' | 'medium';
export type SpeedMode = 'walk' | 'climb' | 'fly' | 'swim' | 'burrow';
export type DamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'lightning' | 'necrotic'
  | 'piercing' | 'poison' | 'psychic' | 'radiant' | 'slashing' | 'thunder';

export interface FamiliarDamagePart {
  average: number;
  formula?: string;
  type: DamageType;
}

export interface FamiliarActionDefinition {
  id: string;
  name: string;
  economy: 'action' | 'reaction';
  kind: 'attack' | 'save' | 'spell' | 'utility' | 'multiattack';
  offensive: boolean;
  attack?: {
    mode: 'melee' | 'ranged';
    bonus: number;
    reachFt?: number;
    normalRangeFt?: number;
    longRangeFt?: number;
    damage: readonly FamiliarDamagePart[];
  };
  save?: {
    ability: Ability;
    dc: number;
    rangeFt: number;
    damage?: readonly FamiliarDamagePart[];
    effects: readonly JsonObject[];
    automaticFailureCreatureTypes?: readonly string[];
  };
  spell?: { spellId: string; ability: Ability; componentsRequired: false; target: 'self' };
  mechanics?: JsonObject;
  uses?: { count: number; recharge: 'day' };
}

export interface FamiliarStatTemplate {
  formId: FamiliarCatalogForm;
  name: string;
  eligibility: 'base_standard' | 'pact_chain_special';
  /** Stable ruleset id of the current post-errata stat block. */
  statBlockId: string;
  /** Id currently persisted by Find Familiar; retained as an explicit migration join. */
  selectionStatBlockId: string;
  sourceEntityId: string;
  sourceLocator: string;
  size: CreatureSize;
  nativeCreatureType: string;
  ac: number;
  hp: { max: number; formula: string };
  abilityScores: Record<Ability, number>;
  abilityMods: Record<Ability, number>;
  saves: Record<Ability, number>;
  initiativeModifier: number;
  proficiencyBonus: 2;
  speeds: Partial<Record<SpeedMode, number>> & { walk: number };
  skills: Readonly<Record<string, number>>;
  senses: {
    passivePerception: number;
    blindsightFt?: number;
    darkvisionFt?: number;
    magicalDarknessDoesNotImpede?: true;
  };
  languages: readonly string[];
  understandsButCannotSpeak?: readonly string[];
  resistances: readonly DamageType[];
  vulnerabilities: readonly DamageType[];
  damageImmunities: readonly DamageType[];
  conditionImmunities: readonly string[];
  gear: readonly string[];
  traits: readonly { id: string; mechanics: JsonObject }[];
  actions: readonly FamiliarActionDefinition[];
}

export interface FamiliarActorCatalog {
  schemaVersion: 1;
  catalogId: 'dnd2024.familiar-stat-blocks.mm2025.v1';
  /** PHB errata v1 replaces Appendix B with Monster Manual (2025) versions. */
  sourceVersion: 'phb2024-errata-v1.mm2025.dndbeyond-live-2026-08-04';
  sourceLocator: 'https://www.dndbeyond.com/sources/dnd/br-2024/creature-stat-blocks';
  forms: readonly FamiliarStatTemplate[];
  contentHash: string;
}

const A = (id: string, name: string, bonus: number, damage: readonly FamiliarDamagePart[], mode: 'melee' | 'ranged' = 'melee', range: [number, number?] = [5]): FamiliarActionDefinition => ({
  id, name, economy: 'action', kind: 'attack', offensive: true,
  attack: mode === 'melee'
    ? { mode, bonus, reachFt: range[0], damage }
    : { mode, bonus, normalRangeFt: range[0], longRangeFt: range[1]!, damage },
});
const D = (average: number, type: DamageType, formula?: string): FamiliarDamagePart => ({ average, ...(formula ? { formula } : {}), type });
const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const stats = (scores: readonly number[], mods: readonly number[], saves: readonly number[]) => ({
  abilityScores: Object.fromEntries(ABILITIES.map((key, index) => [key, scores[index]])) as Record<Ability, number>,
  abilityMods: Object.fromEntries(ABILITIES.map((key, index) => [key, mods[index]])) as Record<Ability, number>,
  saves: Object.fromEntries(ABILITIES.map((key, index) => [key, saves[index]])) as Record<Ability, number>,
});
const trait = (id: string, mechanics: JsonObject = {}) => ({ id, mechanics });
const base = (
  formId: FindFamiliarBaseForm,
  name: string,
  data: Omit<FamiliarStatTemplate, 'formId' | 'name' | 'eligibility' | 'statBlockId' | 'selectionStatBlockId' | 'sourceEntityId' | 'sourceLocator' | 'proficiencyBonus'>,
): FamiliarStatTemplate => ({
  formId, name, eligibility: 'base_standard', statBlockId: `mm2025.creature.${formId}`,
  selectionStatBlockId: `phb2024.beast.${formId}`,
  sourceEntityId: `official.dnd2024.mm2025.${formId}`,
  sourceLocator: `https://www.dndbeyond.com/sources/dnd/br-2024/creature-stat-blocks#${formId}`,
  proficiencyBonus: 2, ...data,
});
const chain = (
  formId: PactChainSpecialFamiliarForm,
  name: string,
  data: Omit<FamiliarStatTemplate, 'formId' | 'name' | 'eligibility' | 'statBlockId' | 'selectionStatBlockId' | 'sourceEntityId' | 'sourceLocator' | 'proficiencyBonus'>,
  sourceLocator?: string,
): FamiliarStatTemplate => ({
  formId, name, eligibility: 'pact_chain_special', statBlockId: `mm2025.creature.${formId}`,
  selectionStatBlockId: `phb2024.pact_chain.${formId}`,
  sourceEntityId: `official.dnd2024.mm2025.${formId}`,
  sourceLocator: sourceLocator ?? `https://www.dndbeyond.com/sources/dnd/br-2024/creature-stat-blocks#${formId}`,
  proficiencyBonus: 2, ...data,
});
const emptyDefenses = {
  resistances: [] as DamageType[], vulnerabilities: [] as DamageType[],
  damageImmunities: [] as DamageType[], conditionImmunities: [] as string[], gear: [] as string[],
};

const forms: FamiliarStatTemplate[] = [
  base('bat', 'Bat', { size: 'tiny', nativeCreatureType: 'beast', ac: 12, hp: { max: 1, formula: '1d4-1' }, ...stats([2, 15, 8, 2, 12, 4], [-4, 2, -1, -4, 1, -3], [-4, 2, -1, -4, 1, -3]), initiativeModifier: 2, speeds: { walk: 5, fly: 30 }, skills: {}, senses: { passivePerception: 11, blindsightFt: 60 }, languages: [], ...emptyDefenses, traits: [], actions: [A('mm2025.bat.bite', 'Bite', 4, [D(1, 'piercing')])] }),
  base('cat', 'Cat', { size: 'tiny', nativeCreatureType: 'beast', ac: 12, hp: { max: 2, formula: '1d4' }, ...stats([3, 15, 10, 3, 12, 7], [-4, 2, 0, -4, 1, -2], [-4, 4, 0, -4, 1, -2]), initiativeModifier: 2, speeds: { walk: 40, climb: 40 }, skills: { perception: 3, stealth: 4 }, senses: { passivePerception: 13, darkvisionFt: 60 }, languages: [], ...emptyDefenses, traits: [trait('jumper', { jumpAbility: 'dex' })], actions: [A('mm2025.cat.scratch', 'Scratch', 4, [D(1, 'slashing')])] }),
  base('frog', 'Frog', { size: 'tiny', nativeCreatureType: 'beast', ac: 11, hp: { max: 1, formula: '1d4-1' }, ...stats([1, 13, 8, 1, 8, 3], [-5, 1, -1, -5, -1, -4], [-5, 1, -1, -5, -1, -4]), initiativeModifier: 1, speeds: { walk: 20, swim: 20 }, skills: { perception: 1, stealth: 3 }, senses: { passivePerception: 11, darkvisionFt: 30 }, languages: [], ...emptyDefenses, traits: [trait('amphibious'), trait('standing_leap', { longJumpFt: 10, highJumpFt: 5, runningStartRequired: false })], actions: [A('mm2025.frog.bite', 'Bite', 3, [D(1, 'piercing')])] }),
  base('hawk', 'Hawk', { size: 'tiny', nativeCreatureType: 'beast', ac: 13, hp: { max: 1, formula: '1d4-1' }, ...stats([5, 16, 8, 2, 14, 6], [-3, 3, -1, -4, 2, -2], [-3, 3, -1, -4, 2, -2]), initiativeModifier: 3, speeds: { walk: 10, fly: 60 }, skills: { perception: 6 }, senses: { passivePerception: 16 }, languages: [], ...emptyDefenses, traits: [], actions: [A('mm2025.hawk.talons', 'Talons', 5, [D(1, 'slashing')])] }),
  base('lizard', 'Lizard', { size: 'tiny', nativeCreatureType: 'beast', ac: 10, hp: { max: 2, formula: '1d4' }, ...stats([2, 11, 10, 1, 8, 3], [-4, 0, 0, -5, -1, -4], [-4, 0, 0, -5, -1, -4]), initiativeModifier: 0, speeds: { walk: 20, climb: 20 }, skills: {}, senses: { passivePerception: 9, darkvisionFt: 30 }, languages: [], ...emptyDefenses, traits: [trait('spider_climb')], actions: [A('mm2025.lizard.bite', 'Bite', 2, [D(1, 'piercing')])] }),
  base('octopus', 'Octopus', { size: 'small', nativeCreatureType: 'beast', ac: 12, hp: { max: 3, formula: '1d6' }, ...stats([4, 15, 11, 3, 10, 4], [-3, 2, 0, -4, 0, -3], [-3, 2, 0, -4, 0, -3]), initiativeModifier: 2, speeds: { walk: 5, swim: 30 }, skills: { perception: 2, stealth: 6 }, senses: { passivePerception: 12, darkvisionFt: 30 }, languages: [], ...emptyDefenses, traits: [trait('compression', { minimumGapInches: 1 }), trait('water_breathing', { onlyUnderwater: true })], actions: [A('mm2025.octopus.tentacles', 'Tentacles', 4, [D(1, 'bludgeoning')]), { id: 'mm2025.octopus.ink-cloud', name: 'Ink Cloud', economy: 'reaction', kind: 'utility', offensive: false, uses: { count: 1, recharge: 'day' }, mechanics: { trigger: 'creature_ends_turn_within_5ft_underwater', cubeSideFt: 5, heavilyObscuredMinutes: 1, moveUpToSwimSpeed: true } }] }),
  base('owl', 'Owl', { size: 'tiny', nativeCreatureType: 'beast', ac: 11, hp: { max: 1, formula: '1d4-1' }, ...stats([3, 13, 8, 2, 12, 7], [-4, 1, -1, -4, 1, -2], [-4, 1, -1, -4, 1, -2]), initiativeModifier: 1, speeds: { walk: 5, fly: 60 }, skills: { perception: 5, stealth: 5 }, senses: { passivePerception: 15, darkvisionFt: 120 }, languages: [], ...emptyDefenses, traits: [trait('flyby', { avoidsOpportunityAttackOnFlyOut: true })], actions: [A('mm2025.owl.talons', 'Talons', 3, [D(1, 'slashing')])] }),
  base('rat', 'Rat', { size: 'tiny', nativeCreatureType: 'beast', ac: 10, hp: { max: 1, formula: '1d4-1' }, ...stats([2, 11, 9, 2, 10, 4], [-4, 0, -1, -4, 0, -3], [-4, 0, -1, -4, 0, -3]), initiativeModifier: 0, speeds: { walk: 20, climb: 20 }, skills: { perception: 2 }, senses: { passivePerception: 12, darkvisionFt: 30 }, languages: [], ...emptyDefenses, traits: [trait('agile', { avoidsOpportunityAttackOnReachExit: true })], actions: [A('mm2025.rat.bite', 'Bite', 2, [D(1, 'piercing')])] }),
  base('raven', 'Raven', { size: 'tiny', nativeCreatureType: 'beast', ac: 12, hp: { max: 2, formula: '1d4' }, ...stats([2, 14, 10, 5, 13, 6], [-4, 2, 0, -3, 1, -2], [-4, 2, 0, -3, 1, -2]), initiativeModifier: 2, speeds: { walk: 10, fly: 50 }, skills: { perception: 3 }, senses: { passivePerception: 13 }, languages: [], ...emptyDefenses, traits: [trait('mimicry', { discernCheck: 'wisdom_insight', dc: 10 })], actions: [A('mm2025.raven.beak', 'Beak', 4, [D(1, 'piercing')])] }),
  base('spider', 'Spider', { size: 'tiny', nativeCreatureType: 'beast', ac: 12, hp: { max: 1, formula: '1d4-1' }, ...stats([2, 14, 8, 1, 10, 2], [-4, 2, -1, -5, 0, -4], [-4, 2, -1, -5, 0, -4]), initiativeModifier: 2, speeds: { walk: 20, climb: 20 }, skills: { stealth: 4 }, senses: { passivePerception: 10, darkvisionFt: 30 }, languages: [], ...emptyDefenses, traits: [trait('spider_climb'), trait('web_walker', { ignoresWebMovementRestrictions: true, locatesCreaturesOnSameWeb: true })], actions: [A('mm2025.spider.bite', 'Bite', 4, [D(1, 'piercing'), D(2, 'poison', '1d4')])] }),
  base('weasel', 'Weasel', { size: 'tiny', nativeCreatureType: 'beast', ac: 13, hp: { max: 1, formula: '1d4-1' }, ...stats([3, 16, 8, 2, 12, 3], [-4, 3, -1, -4, 1, -4], [-4, 3, -1, -4, 1, -4]), initiativeModifier: 3, speeds: { walk: 30, climb: 30 }, skills: { acrobatics: 5, perception: 3, stealth: 5 }, senses: { passivePerception: 13, darkvisionFt: 60 }, languages: [], ...emptyDefenses, traits: [], actions: [A('mm2025.weasel.bite', 'Bite', 5, [D(1, 'piercing')])] }),

  chain('imp', 'Imp', { size: 'tiny', nativeCreatureType: 'fiend:devil', ac: 13, hp: { max: 21, formula: '6d4+6' }, ...stats([6, 17, 13, 11, 12, 14], [-2, 3, 1, 0, 1, 2], [-2, 3, 1, 0, 1, 2]), initiativeModifier: 3, speeds: { walk: 20, fly: 40 }, skills: { deception: 4, insight: 3, stealth: 5 }, senses: { passivePerception: 11, darkvisionFt: 120, magicalDarknessDoesNotImpede: true }, languages: ['common', 'infernal'], resistances: ['cold'], vulnerabilities: [], damageImmunities: ['fire', 'poison'], conditionImmunities: ['poisoned'], gear: [], traits: [trait('magic_resistance')], actions: [A('mm2025.imp.sting', 'Sting', 5, [D(6, 'piercing', '1d6+3'), D(7, 'poison', '2d6')]), { id: 'mm2025.imp.invisibility', name: 'Invisibility', economy: 'action', kind: 'spell', offensive: false, spell: { spellId: 'invisibility', ability: 'cha', componentsRequired: false, target: 'self' } }, { id: 'mm2025.imp.shape-shift', name: 'Shape-Shift', economy: 'action', kind: 'utility', offensive: false, mechanics: { forms: [{ id: 'rat', speeds: { walk: 20 } }, { id: 'raven', speeds: { walk: 20, fly: 60 } }, { id: 'spider', speeds: { walk: 20, climb: 20 } }], changesOnlySpeed: true, equipmentTransforms: false } }] }),
  chain('pseudodragon', 'Pseudodragon', { size: 'tiny', nativeCreatureType: 'dragon', ac: 14, hp: { max: 10, formula: '3d4+3' }, ...stats([6, 15, 13, 10, 12, 10], [-2, 2, 1, 0, 1, 0], [-2, 2, 1, 0, 1, 0]), initiativeModifier: 2, speeds: { walk: 15, fly: 60 }, skills: { perception: 5, stealth: 4 }, senses: { passivePerception: 15, blindsightFt: 10, darkvisionFt: 60 }, languages: [], understandsButCannotSpeak: ['common', 'draconic'], ...emptyDefenses, traits: [trait('magic_resistance')], actions: [{ id: 'mm2025.pseudodragon.multiattack', name: 'Multiattack', economy: 'action', kind: 'multiattack', offensive: true, mechanics: { attacks: [{ actionId: 'mm2025.pseudodragon.bite', count: 2 }] } }, A('mm2025.pseudodragon.bite', 'Bite', 4, [D(4, 'piercing', '1d4+2')]), { id: 'mm2025.pseudodragon.sting', name: 'Sting', economy: 'action', kind: 'save', offensive: true, save: { ability: 'con', dc: 12, rangeFt: 5, damage: [D(5, 'poison', '2d4')], effects: [{ condition: 'poisoned', durationMinutes: 60 }, { condition: 'unconscious', whileCondition: 'poisoned', endsOnDamageOrWakeActionWithinFt: 5 }] } }] }),
  chain('quasit', 'Quasit', { size: 'tiny', nativeCreatureType: 'fiend:demon', ac: 13, hp: { max: 25, formula: '10d4' }, ...stats([5, 17, 10, 7, 10, 10], [-3, 3, 0, -2, 0, 0], [-3, 3, 0, -2, 0, 0]), initiativeModifier: 3, speeds: { walk: 40 }, skills: { stealth: 5 }, senses: { passivePerception: 10, darkvisionFt: 120 }, languages: ['abyssal', 'common'], resistances: ['cold', 'fire', 'lightning'], vulnerabilities: [], damageImmunities: ['poison'], conditionImmunities: ['poisoned'], gear: [], traits: [trait('magic_resistance')], actions: [A('mm2025.quasit.rend', 'Rend', 5, [D(5, 'slashing', '1d4+3')]), { id: 'mm2025.quasit.invisibility', name: 'Invisibility', economy: 'action', kind: 'spell', offensive: false, spell: { spellId: 'invisibility', ability: 'cha', componentsRequired: false, target: 'self' } }, { id: 'mm2025.quasit.scare', name: 'Scare', economy: 'action', kind: 'save', offensive: true, uses: { count: 1, recharge: 'day' }, save: { ability: 'wis', dc: 10, rangeFt: 20, effects: [{ condition: 'frightened', repeatAt: 'end_of_each_target_turn', maximumDurationMinutes: 1 }] } }, { id: 'mm2025.quasit.shape-shift', name: 'Shape-Shift', economy: 'action', kind: 'utility', offensive: false, mechanics: { forms: [{ id: 'bat', speeds: { walk: 10, fly: 40 } }, { id: 'centipede', speeds: { walk: 40, climb: 40 } }, { id: 'toad', speeds: { walk: 40, swim: 40 } }], changesOnlySpeed: true, equipmentTransforms: false } }] }),
  chain('skeleton', 'Skeleton', { size: 'medium', nativeCreatureType: 'undead', ac: 14, hp: { max: 13, formula: '2d8+4' }, ...stats([10, 16, 15, 6, 8, 5], [0, 3, 2, -2, -1, -3], [0, 3, 2, -2, -1, -3]), initiativeModifier: 3, speeds: { walk: 30 }, skills: {}, senses: { passivePerception: 9, darkvisionFt: 60 }, languages: [], understandsButCannotSpeak: ['common', 'one_other_language'], resistances: [], vulnerabilities: ['bludgeoning'], damageImmunities: ['poison'], conditionImmunities: ['exhaustion', 'poisoned'], gear: ['shortbow', 'shortsword'], traits: [], actions: [A('mm2025.skeleton.shortsword', 'Shortsword', 5, [D(6, 'piercing', '1d6+3')]), A('mm2025.skeleton.shortbow', 'Shortbow', 5, [D(6, 'piercing', '1d6+3')], 'ranged', [80, 320])] }),
  chain('slaad_tadpole', 'Slaad Tadpole', { size: 'tiny', nativeCreatureType: 'aberration', ac: 12, hp: { max: 7, formula: '3d4' }, ...stats([7, 15, 10, 3, 5, 3], [-2, 2, 0, -4, -3, -4], [-2, 2, 0, -4, -3, -4]), initiativeModifier: 2, speeds: { walk: 30, burrow: 10 }, skills: { stealth: 4 }, senses: { passivePerception: 7, darkvisionFt: 60 }, languages: [], understandsButCannotSpeak: ['slaad'], resistances: ['acid', 'cold', 'fire', 'lightning', 'thunder'], vulnerabilities: [], damageImmunities: [], conditionImmunities: [], gear: [], traits: [trait('magic_resistance')], actions: [A('mm2025.slaad-tadpole.bite', 'Bite', 4, [D(5, 'piercing', '1d6+2')])] }, 'https://www.dndbeyond.com/monsters/4775842-slaad-tadpole'),
  chain('sphinx_of_wonder', 'Sphinx of Wonder', { size: 'tiny', nativeCreatureType: 'celestial', ac: 13, hp: { max: 24, formula: '7d4+7' }, ...stats([6, 17, 13, 15, 12, 11], [-2, 3, 1, 2, 1, 0], [-2, 3, 1, 2, 1, 0]), initiativeModifier: 3, speeds: { walk: 20, fly: 40 }, skills: { arcana: 4, religion: 4, stealth: 5 }, senses: { passivePerception: 11, darkvisionFt: 60 }, languages: ['celestial', 'common'], resistances: ['necrotic', 'psychic', 'radiant'], vulnerabilities: [], damageImmunities: [], conditionImmunities: [], gear: [], traits: [trait('magic_resistance')], actions: [A('mm2025.sphinx-of-wonder.rend', 'Rend', 5, [D(5, 'slashing', '1d4+3'), D(7, 'radiant', '2d6')]), { id: 'mm2025.sphinx-of-wonder.burst-of-ingenuity', name: 'Burst of Ingenuity', economy: 'reaction', kind: 'utility', offensive: false, uses: { count: 2, recharge: 'day' }, mechanics: { trigger: 'creature_within_30ft_makes_ability_check_or_save', modifier: 2, rangeFt: 30 } }] }),
  chain('sprite', 'Sprite', { size: 'tiny', nativeCreatureType: 'fey', ac: 15, hp: { max: 10, formula: '4d4' }, ...stats([3, 18, 10, 14, 13, 11], [-4, 4, 0, 2, 1, 0], [-4, 4, 0, 2, 1, 0]), initiativeModifier: 4, speeds: { walk: 10, fly: 40 }, skills: { perception: 3, stealth: 8 }, senses: { passivePerception: 13 }, languages: ['common', 'elvish', 'sylvan'], ...emptyDefenses, traits: [], actions: [A('mm2025.sprite.needle-sword', 'Needle Sword', 6, [D(6, 'piercing', '1d4+4')]), { ...A('mm2025.sprite.enchanting-bow', 'Enchanting Bow', 6, [D(1, 'piercing')], 'ranged', [40, 160]), mechanics: { onHitCondition: 'charmed', expiresAt: 'start_of_source_next_turn' } }, { id: 'mm2025.sprite.heart-sight', name: 'Heart Sight', economy: 'action', kind: 'save', offensive: false, save: { ability: 'cha', dc: 10, rangeFt: 5, effects: [{ reveals: ['emotions', 'alignment'] }], automaticFailureCreatureTypes: ['celestial', 'fiend', 'undead'] } }, { id: 'mm2025.sprite.invisibility', name: 'Invisibility', economy: 'action', kind: 'spell', offensive: false, spell: { spellId: 'invisibility', ability: 'cha', componentsRequired: false, target: 'self' } }] }),
  chain('venomous_snake', 'Venomous Snake', { size: 'tiny', nativeCreatureType: 'beast', ac: 12, hp: { max: 5, formula: '2d4' }, ...stats([2, 15, 11, 1, 10, 3], [-4, 2, 0, -5, 0, -4], [-4, 2, 0, -5, 0, -4]), initiativeModifier: 2, speeds: { walk: 30, swim: 30 }, skills: {}, senses: { passivePerception: 10, blindsightFt: 10 }, languages: [], ...emptyDefenses, traits: [], actions: [A('mm2025.venomous-snake.bite', 'Bite', 4, [D(4, 'piercing', '1d4+2'), D(3, 'poison', '1d6')])] }),
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function canonicalFamiliarCatalogJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Deterministic FNV-1a-32 audit hash; not a cryptographic trust primitive. */
export function familiarCatalogContentHash(value: unknown): string {
  const text = canonicalFamiliarCatalogJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

const catalogWithoutHash = {
  schemaVersion: 1,
  catalogId: 'dnd2024.familiar-stat-blocks.mm2025.v1',
  sourceVersion: 'phb2024-errata-v1.mm2025.dndbeyond-live-2026-08-04',
  sourceLocator: 'https://www.dndbeyond.com/sources/dnd/br-2024/creature-stat-blocks',
  forms,
} as const;

export const FAMILIAR_ACTOR_CATALOG: Readonly<FamiliarActorCatalog> = deepFreeze({
  ...catalogWithoutHash,
  contentHash: familiarCatalogContentHash(catalogWithoutHash),
});

export function familiarActorCatalogIssue(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'Familiar actor catalog must be an object';
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || candidate.catalogId !== FAMILIAR_ACTOR_CATALOG.catalogId) return 'Familiar actor catalog identity is not supported';
  if (!Array.isArray(candidate.forms) || candidate.forms.length !== FAMILIAR_ACTOR_CATALOG.forms.length) return 'Familiar actor catalog must contain exactly 19 canonical forms';
  if (candidate.contentHash !== FAMILIAR_ACTOR_CATALOG.contentHash) return 'Familiar actor catalog content hash does not match the pinned ruleset';
  return canonicalFamiliarCatalogJson(candidate) === canonicalFamiliarCatalogJson(FAMILIAR_ACTOR_CATALOG)
    ? null : 'Familiar actor catalog content is forged or noncanonical';
}

export function familiarActorTemplateIssue(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'Familiar actor template must be an object';
  const formId = (value as { formId?: unknown }).formId;
  if (typeof formId !== 'string') return 'Familiar actor template requires a stable form id';
  const expected = FAMILIAR_ACTOR_CATALOG.forms.find((entry) => entry.formId === formId);
  if (!expected) return 'Familiar actor template form is not in the pinned catalog';
  return canonicalFamiliarCatalogJson(value) === canonicalFamiliarCatalogJson(expected)
    ? null : 'Familiar actor template is forged or noncanonical';
}

export function getFamiliarActorTemplate(formId: string, catalog: unknown = FAMILIAR_ACTOR_CATALOG): FamiliarStatTemplate {
  const catalogIssue = familiarActorCatalogIssue(catalog);
  if (catalogIssue) throw new Error(catalogIssue);
  if (!formId || formId !== formId.trim()) throw new Error('Familiar form requires a canonical stable id');
  const template = (catalog as FamiliarActorCatalog).forms.find((entry) => entry.formId === formId);
  if (!template) throw new Error(`Familiar form ${formId} is outside the pinned catalog boundary`);
  return template;
}

export interface FamiliarActorDraft {
  id: string;
  name: string;
  kind: 'summonedActor';
  controllerId: string;
  ac: number;
  capabilities: {
    actionIds: string[];
    featureSources: Record<string, readonly [string, ...string[]]>;
  };
  character: {
    abilityScores: Record<Ability, number>;
    abilityMods: Record<Ability, number>;
    profBonus: 2;
    level: 0;
    characterSpeed: number;
    baseSpeed: number;
    saveProficiencies: string[];
    skillProficiencies: string[];
  };
  runtime: {
    hp: { current: number; max: number; temp: 0 };
    resources: Record<string, number>;
    maxResources: Record<string, number>;
    equipment: Record<string, string | null>;
    inventory: Array<{ cardId: string; qty: number }>;
    activeEffects: [];
  };
  passives: JsonObject[];
  attackProfile: ActorAttackProfile;
  familiarMetadata: {
    ownerActorId: string;
    spiritType: FamiliarState['spiritType'];
    nativeCreatureType: string;
    effectiveCreatureType: FamiliarState['spiritType'];
    formId: FamiliarCatalogForm;
    statBlockId: string;
    sourceEntityId: string;
    size: CreatureSize;
    initiativeModifier: number;
    speeds: FamiliarStatTemplate['speeds'];
    saves: FamiliarStatTemplate['saves'];
    skills: FamiliarStatTemplate['skills'];
    senses: FamiliarStatTemplate['senses'];
    languages: readonly string[];
    understandsButCannotSpeak: readonly string[];
    resistances: readonly DamageType[];
    vulnerabilities: readonly DamageType[];
    damageImmunities: readonly DamageType[];
    conditionImmunities: readonly string[];
    gear: readonly string[];
    actions: readonly FamiliarActionDefinition[];
    canInitiateAttackAction: false;
    attackAuthorization: 'forbidden' | 'owner_attack_replacement_only';
  };
}

export function materializeFamiliarActor(input: {
  familiar: FamiliarState;
  template: FamiliarStatTemplate;
  ownerControllerId: string;
}): FamiliarActorDraft {
  const familiarIssue = familiarStateIssue(input.familiar);
  if (familiarIssue) throw new Error(familiarIssue);
  const templateIssue = familiarActorTemplateIssue(input.template);
  if (templateIssue) throw new Error(templateIssue);
  if (!input.ownerControllerId || input.ownerControllerId !== input.ownerControllerId.trim()) throw new Error('Familiar owner controller requires a canonical stable id');
  if (input.familiar.presence !== 'present') throw new Error('Only a present familiar can be materialized as an actor');
  if (input.familiar.form.id !== input.template.formId || input.familiar.form.statBlockId !== input.template.selectionStatBlockId) throw new Error('Familiar state does not match the pinned stat template');
  const sourceIds = [input.familiar.sourceEntityId, input.template.sourceEntityId] as [string, ...string[]];
  const actionSources = Object.fromEntries(input.template.actions.map((action) => [action.id, sourceIds]));
  const size = input.template.size === 'tiny' ? 0 : input.template.size === 'small' ? 1 : 2;
  const attackAuthorization = input.familiar.extension === 'pact_chain'
    ? 'owner_attack_replacement_only' as const : 'forbidden' as const;
  return {
    id: input.familiar.actorId,
    name: input.template.name,
    kind: 'summonedActor',
    controllerId: input.ownerControllerId,
    ac: input.template.ac,
    // Stat-block actions remain discoverable below, but no ordinary UseAction/Attack capability is minted.
    capabilities: { actionIds: [], featureSources: actionSources },
    character: {
      abilityScores: { ...input.template.abilityScores }, abilityMods: { ...input.template.abilityMods },
      profBonus: 2, level: 0, characterSpeed: input.template.speeds.walk,
      baseSpeed: input.template.speeds.walk, saveProficiencies: [],
      skillProficiencies: Object.keys(input.template.skills),
    },
    runtime: {
      hp: { current: input.template.hp.max, max: input.template.hp.max, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: input.familiar.reactionAvailable ? 1 : 0 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
    passives: input.template.traits.map((entry) => ({ id: entry.id, mechanics: entry.mechanics, sourceEntityId: input.template.sourceEntityId })),
    attackProfile: { attacksPerAction: 1, size, reachFt: 5, graspingParts: [], sourceEntityIds: sourceIds },
    familiarMetadata: {
      ownerActorId: input.familiar.ownerActorId, spiritType: input.familiar.spiritType,
      nativeCreatureType: input.template.nativeCreatureType, effectiveCreatureType: input.familiar.spiritType,
      formId: input.template.formId, statBlockId: input.template.statBlockId,
      sourceEntityId: input.template.sourceEntityId, size: input.template.size,
      initiativeModifier: input.template.initiativeModifier, speeds: input.template.speeds,
      saves: input.template.saves, skills: input.template.skills, senses: input.template.senses,
      languages: input.template.languages,
      understandsButCannotSpeak: input.template.understandsButCannotSpeak ?? [],
      resistances: input.template.resistances, vulnerabilities: input.template.vulnerabilities,
      damageImmunities: input.template.damageImmunities,
      conditionImmunities: input.template.conditionImmunities, gear: input.template.gear,
      actions: input.template.actions, canInitiateAttackAction: false, attackAuthorization,
    },
  };
}
