import {MINI_MVP_MANIFEST, flattenMiniMvpSpeciesVariants} from './mini-mvp-manifest.mjs';
import {LEVEL5_MINI_MVP_MANIFEST} from './level5-mini-mvp-manifest.mjs';

// Reviewed union across legal single-class Fighter builds, not the choices of
// one character and not a claim that every entity has passed mechanical QA.
// Reuse the PHB denominator; never infer required coverage from database counts.
const freeze = value => Object.freeze(value);
const row = (cardNumber, label) => freeze({key: cardNumber, label, selector: freeze({cardNumber})});
const mini = MINI_MVP_MANIFEST.collections;
const level5 = LEVEL5_MINI_MVP_MANIFEST.collections;

export const ROGUELIKE_UNREACHABLE_SPELLS = freeze({
  cantrips: freeze(['SPELL-0205', 'SPELL-0226', 'SPELL-0315']),
  firstLevelSpells: freeze(['SPELL-0164', 'SPELL-0165', 'SPELL-0185', 'SPELL-0186',
    'SPELL-0189', 'SPELL-0247', 'SPELL-0254', 'SPELL-0283']),
});
// Cantrips: Cleric/Druid/Wizard via Magic Initiate; Wizard via Eldritch Knight.
// First circle additionally includes Fey/Shadow Touched choices and species
// grants. Thus Hex, Hunter's Mark, Wrathful Smite and Hellish Rebuke are required,
// while unrestricted Warlock/Paladin/Ranger lists are not.
const secondCircle = freeze(['misty_step', 'pass_without_trace', 'darkness', 'hold_person',
  'ray_of_enfeeblement', 'SPELL-0231', 'SPELL-0239']);

const maneuvers = freeze([
  ['ACT-bm-ambush', 'Засада'], ['ACT-bm-bait-switch', 'Приманка и подмена'],
  ['ACT-bm-commanders-strike', 'Удар командующего'], ['ACT-bm-commanding-presence', 'Командное присутствие'],
  ['ACT-bm-disarming-attack', 'Обезоруживающая атака'], ['ACT-bm-distracting-strike', 'Отвлекающий удар'],
  ['ACT-bm-evasive-footwork', 'Уклоняющийся шаг'], ['ACT-bm-feinting-attack', 'Обманная атака'],
  ['ACT-bm-goading-attack', 'Провоцирующая атака'], ['ACT-bm-lunging', 'Атака с выпадом'],
  ['ACT-bm-maneuvering-attack', 'Маневрирующая атака'], ['ACT-bm-menacing-attack', 'Устрашающая атака'],
  ['ACT-bm-parry', 'Парирование'], ['ACT-bm-precision', 'Точная атака'],
  ['ACT-bm-pushing-attack', 'Толкающая атака'], ['ACT-bm-rally', 'Сплочение'],
  ['ACT-bm-riposte', 'Ответный удар'], ['ACT-bm-sweeping', 'Размашистая атака'],
  ['ACT-bm-tactical-assessment', 'Тактическая оценка'], ['ACT-bm-trip-attack', 'Опрокидывающая атака'],
].map(([card, label]) => row(card, label)));

export const ROGUELIKE_FIGHTER_COLLECTION_SIZES = freeze({
  classes: 1, subclasses: 4, fightingStyles: 10, maneuvers: 20, masteries: 8,
  species: 10, speciesVariants: 24, backgrounds: 16, originFeats: 10, generalFeats: 43,
  cantrips: 31, firstLevelSpells: 56, secondLevelSpells: 7,
});
export const ROGUELIKE_FIGHTER_ENTITY_TYPES = freeze({
  classes: 'class', subclasses: 'class', fightingStyles: 'feat', maneuvers: 'action',
  species: 'race', speciesVariants: 'race', backgrounds: 'background', originFeats: 'feat', generalFeats: 'feat',
  cantrips: 'spell', firstLevelSpells: 'spell', secondLevelSpells: 'spell',
});

export const ROGUELIKE_FIGHTER_MANIFEST = freeze({
  schemaVersion: 1,
  manifestVersion: '1.0.0',
  release: 'roguelike-fighter-l1-5',
  systemId: 'dnd5e-2024',
  minCharacterLevel: 1,
  maxCharacterLevel: 5,
  multiclass: false,
  victoryXp: 14000,
  evidencePolicy: freeze({
    rootPresenceIsCertification: false,
    includeTransitiveDependencies: true,
    respectChoicePrerequisites: true,
    requiredLayers: freeze(['rules', 'saved-decisions', 'replay', 'browser']),
  }),
  collections: freeze({
    classes: freeze(mini.classes.filter(entry => entry.selector.cardNumber === 'CLASS-warrior')),
    subclasses: freeze(level5.subclasses.filter(entry => entry.expected.parentCardNumber === 'CLASS-warrior')),
    fightingStyles: mini.fightingStyles,
    maneuvers,
    masteries: freeze(['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex']
      .map(mastery => freeze({key: mastery, label: mastery, selector: freeze({mastery})}))),
    species: mini.species,
    speciesVariants: freeze(flattenMiniMvpSpeciesVariants().map(entry => freeze(entry))),
    backgrounds: mini.backgrounds,
    originFeats: mini.originFeats,
    generalFeats: level5.generalFeats,
    cantrips: freeze(mini.cantrips.filter(entry => !ROGUELIKE_UNREACHABLE_SPELLS.cantrips.includes(entry.selector.cardNumber))),
    firstLevelSpells: freeze(mini.firstLevelSpells.filter(entry => !ROGUELIKE_UNREACHABLE_SPELLS.firstLevelSpells.includes(entry.selector.cardNumber))),
    secondLevelSpells: freeze(level5.secondLevelSpells.filter(entry => secondCircle.includes(entry.selector.cardNumber))),
  }),
  sources: freeze([
    'officials/kb/phb-2024-ru/pages/page-070.txt', 'officials/kb/phb-2024-ru/pages/page-071.txt',
    'officials/kb/phb-2024-ru/pages/page-072.txt', 'officials/kb/phb-2024-ru/pages/page-073.txt',
    'officials/kb/phb-2024-ru/pages/page-074.txt', 'officials/kb/phb-2024-ru/pages/page-076.txt',
    'officials/kb/phb-2024-ru/pages/page-077.txt', 'officials/kb/phb-2024-ru/pages/page-078.txt',
    'officials/kb/phb-2024-ru/pages/page-202.txt', 'officials/kb/phb-2024-ru/pages/page-204.txt',
    'officials/kb/phb-2024-ru/pages/page-205.txt', 'officials/kb/phb-2024-ru/pages/page-208.txt',
    'officials/kb/phb-2024-ru/pages/page-209.txt',
  ]),
});

export function flattenRoguelikeFighterManifest(manifest = ROGUELIKE_FIGHTER_MANIFEST) {
  return Object.entries(manifest.collections).flatMap(([collection, entries]) =>
    entries.map(entry => ({...entry, collection, entityType: ROGUELIKE_FIGHTER_ENTITY_TYPES[collection] ?? 'rule'})));
}

export function validateRoguelikeFighterManifest(manifest = ROGUELIKE_FIGHTER_MANIFEST) {
  const issues = [];
  if (manifest.release !== 'roguelike-fighter-l1-5' || manifest.systemId !== 'dnd5e-2024'
    || manifest.minCharacterLevel !== 1 || manifest.maxCharacterLevel !== 5 || manifest.multiclass !== false) issues.push('scope');
  for (const [collection, expected] of Object.entries(ROGUELIKE_FIGHTER_COLLECTION_SIZES)) {
    if (manifest.collections?.[collection]?.length !== expected) issues.push(`${collection}: expected ${expected}`);
  }
  const identities = flattenRoguelikeFighterManifest(manifest).map(entry => `${entry.entityType}:${entry.selector.cardNumber ?? entry.selector.mastery}`);
  if (new Set(identities).size !== identities.length) issues.push('duplicate identity');
  return issues;
}
