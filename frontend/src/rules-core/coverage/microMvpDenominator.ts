import {
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from '../../canon/microMvpL1Overlay';
import type { MicroMvpSnapshotManifest } from '../../canon/prodSnapshotL1Fixtures';
import { aspectId } from './aspectId';
import type {
  CapabilityEvidenceMatrix,
  CapabilityTarget,
} from './capabilityEvidenceMatrix';
import type {
  CoverageReleasePin,
  RuleObligation,
  RuleSourceReference,
} from './ruleObligation';

export const MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY = 49;
export const MICRO_MVP_PRODUCT_RULE_ID = 'free_origin_feat_choice_v1' as const;
export const MICRO_MVP_SEMANTIC_ASPECT = aspectId('semantic.acceptance');
/**
 * Independent oracle pin for the locally reviewed PHB 2024 text corpus.
 * This must never be derived from the overlay or executable implementation:
 * otherwise a rules edit could silently rewrite both the code and its source.
 */
export const PINNED_PHB_2024_CORPUS_HASH =
  'sha256:221362184900f3b7a72a8adb50072954f6f4759b566fc3d2308200e2864125c2' as const;
/** Product policy is independently pinned; it is not PHB source text. */
export const PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH =
  'sha256:e30b6ed28bdb44b7a84dda59547d1c11b68921295a650a16eea9d0f7d11f77ff' as const;

export const MICRO_MVP_COVERAGE_RELEASE: CoverageReleasePin = {
  systemId: 'dnd5e-2024',
  releaseId: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  errataVersion: 'phb-2024-errata-v1',
  rulesHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
  contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
};

const COLLECTIONS = [
  'classes',
  'species',
  'backgrounds',
  'originFeats',
  'cantrips',
  'firstLevelSpells',
  'fightingStyles',
] as const;

export type MicroMvpCoverageCollection = typeof COLLECTIONS[number];

export interface MicroMvpCoverageEntity {
  id: string;
  collection: MicroMvpCoverageCollection;
  label: string;
  cardNumber: string;
}

export type MicroMvpDerivedObligationKind =
  | 'choice'
  | 'invocation'
  | 'lineage'
  | 'mastery'
  | 'runtime';

export interface MicroMvpDerivedObligationSpec {
  id: string;
  title: string;
  statement: string;
  kind: MicroMvpDerivedObligationKind;
  targetEntityIds: readonly string[];
  locator: string;
}

export interface MicroMvpCoverageDenominator {
  currentRelease: CoverageReleasePin;
  entities: readonly MicroMvpCoverageEntity[];
  currentEntityIds: readonly string[];
  obligations: readonly RuleObligation[];
  matrix: CapabilityEvidenceMatrix;
  entityObligationIds: Readonly<Record<string, string>>;
  derivedObligations: readonly MicroMvpDerivedObligationSpec[];
}

/**
 * These statements are deliberately authored independently of mechanics JSON.
 * A content edit therefore cannot silently redefine its own acceptance oracle.
 */
const ENTITY_RULE_STATEMENTS: Readonly<Record<string, string>> = Object.freeze({
  'class.fighter': 'A level-1 Fighter build exposes Fighting Style, Second Wind, and three legal Weapon Mastery selections, with no feature from level 2 or higher.',
  'class.wizard': 'A level-1 Wizard build exposes level-1 Spellcasting, Ritual Adept, and Arcane Recovery, and distinguishes its spellbook from its prepared spell subset.',
  'class.rogue': 'A level-1 Rogue build exposes Expertise, Sneak Attack, Thieves’ Cant, and two legal Weapon Mastery selections, with Sneak Attack constrained to its 2024 trigger and once-per-turn use.',
  'class.cleric': 'A level-1 Cleric build resolves one Divine Order branch and its legal cantrip and prepared-spell choices without leaking higher-level features.',
  'class.sorcerer': 'A level-1 Sorcerer build exposes Spellcasting and Innate Sorcery; Innate Sorcery affects only Sorcerer spell attacks and Sorcerer spell save DC.',
  'class.warlock': 'A level-1 Warlock build exposes Pact Magic and exactly one legal no-prerequisite level-1 Eldritch Invocation, and pact slots recover on a Short Rest.',
  'class.druid': 'A level-1 Druid build resolves one Primal Order branch and its legal cantrip and prepared-spell choices without exposing Wild Shape or another level-2 feature.',

  'species.human': 'A level-1 Human build exposes Resourceful, Skillful, and one Versatile species-granted Origin feat that remains distinct from the product Origin-feat slot.',
  'species.elf': 'A level-1 Elf build exposes Darkvision, Fey Ancestry, Keen Senses, Trance, and exactly one legal level-1 lineage package without level-3 or level-5 spell leakage.',
  'species.dwarf': 'A level-1 Dwarf build exposes Darkvision, Dwarven Resilience, Dwarven Toughness, and an executable Stonecunning action with its legal uses.',
  'species.dragonborn': 'A level-1 Dragonborn build resolves one Draconic Ancestry, its matching resistance and Breath Weapon, and excludes the level-5 Draconic Flight feature.',

  'background.soldier': 'The Soldier background contributes its stable ability, skill, tool, and equipment grants while its official Origin feat is replaced by the independent product choice.',
  'background.sage': 'The Sage background contributes its stable ability, skill, tool, and equipment grants while its official Origin feat is replaced by the independent product choice.',
  'background.criminal': 'The Criminal background contributes its stable ability, skill, tool, and equipment grants while its official Origin feat is replaced by the independent product choice.',
  'background.acolyte': 'The Acolyte background contributes its stable ability, skill, tool, and equipment grants while its official Origin feat is replaced by the independent product choice.',

  'feat.alert': 'Alert adds Proficiency Bonus to Initiative and, immediately after Initiative, permits a legal swap with one willing non-Incapacitated ally.',
  'feat.magic-initiate': 'Magic Initiate resolves two cantrips, one level-1 spell, and a spellcasting ability; the level-1 spell has its free Long-Rest use and remains castable with slots.',
  'feat.skilled': 'Skilled resolves exactly three legal, non-duplicated skill or tool proficiency choices and projects every selected proficiency into the character build.',
  'feat.tough': 'Tough increases Hit Point Maximum by twice character level and remains correct when level-derived values are rebuilt.',

  'spell.fire-bolt': 'Fire Bolt resolves a ranged spell attack and deals 1d10 Fire damage on a hit at character level 1, with no damage on a miss.',
  'spell.sacred-flame': 'Sacred Flame resolves a Dexterity saving throw, ignores cover for that save, and deals 1d8 Radiant damage only on a failed save at character level 1.',
  'spell.guidance': 'Guidance requires Concentration, records the chosen skill, and adds 1d4 to every matching ability check for the spell’s duration without consuming the benefit.',
  'spell.minor-illusion': 'Minor Illusion creates one bounded sound or image illusion and allows each observer to discern it with a Study action against the caster’s spell save DC.',
  'spell.ray-of-frost': 'Ray of Frost resolves a ranged spell attack, deals 1d8 Cold damage on a hit, and reduces the target’s Speed by 10 feet until the start of the caster’s next turn.',
  'spell.chill-touch': 'Chill Touch resolves a melee spell attack, deals 1d10 Necrotic damage on a hit, and prevents the target from regaining Hit Points until the end of the caster’s next turn.',
  'spell.light': 'Light illuminates one touched object with bright and dim radii, respects opaque cover, and ends the caster’s previous Light when cast again.',
  'spell.dancing-lights': 'Dancing Lights requires Concentration, creates one to four linked dim-light sources in range, permits their legal Bonus Action movement, and removes lights that leave range.',
  'spell.druidcraft': 'Druidcraft executes exactly one legal Weather Sensor, Bloom, bounded Sensory Effect, or Fire Play option with the option’s correct target and duration.',
  'spell.mending': 'Mending takes one minute and repairs one touched object break or tear no larger than 1 foot without restoring lost magic.',
  'spell.poison-spray': 'Poison Spray resolves a ranged spell attack and deals 1d12 Poison damage on a hit at character level 1, with no damage on a miss.',
  'spell.prestidigitation': 'Prestidigitation executes one of its six legal bounded effects and enforces at most three simultaneous non-instantaneous effects owned by the caster.',

  'spell.magic-missile': 'Magic Missile creates three simultaneous auto-hitting darts, lets the caster distribute them among legal targets, deals 1d4+1 Force damage per dart, and is negated by Shield.',
  'spell.burning-hands': 'Burning Hands affects every legal target in its 15-foot cone, deals 3d6 Fire damage on a failed Dexterity save or half on success, and ignites unattended flammable objects.',
  'spell.cure-wounds': 'Cure Wounds heals a touched creature for 2d8 plus the caster’s spellcasting modifier at level 1 and consumes exactly one legal spell slot.',
  'spell.shield': 'Shield opens only for its legal Reaction trigger, spends one Reaction and one slot, adds 5 AC through the start of the caster’s next turn, and negates Magic Missile.',
  'spell.mage-armor': 'Mage Armor targets a willing unarmored creature and supplies an AC method of 13 plus Dexterity for 8 hours without stacking as a flat AC bonus.',
  'spell.thunderwave': 'Thunderwave affects every legal target in its 15-foot cube, deals 2d8 Thunder damage on a failed Constitution save or half on success, pushes failed targets, and moves unsecured objects.',
  'spell.false-life': 'False Life grants the caster 2d4+4 Temporary Hit Points at level 1 without changing current or maximum Hit Points.',
  'spell.detect-magic': 'Detect Magic uses Concentration, senses magic within 30 feet subject to material blocking, and its Magic action reveals a visible aura and school when applicable.',
  'spell.bless': 'Bless applies to up to three legal creatures, requires Concentration, and adds 1d4 to each affected target’s attack rolls and saving throws for the duration.',
  'spell.guiding-bolt': 'Guiding Bolt resolves a ranged spell attack, deals 4d6 Radiant damage on a hit, and grants Advantage to the next attack against that target before the proper expiry.',
  'spell.armor-of-agathys': 'Armor of Agathys spends a Bonus Action and a legal slot, grants 5 Temporary Hit Points per slot level, deals the same Cold damage to each melee attacker that hits, and ends when those Temporary Hit Points are gone or after 1 hour.',
  'spell.detect-poison-and-disease': 'Detect Poison and Disease can be cast normally or as a Ritual, requires Concentration, and reveals the location and kind of poisons, poisonous or venomous creatures, and magical contagions within 30 feet subject to material blocking.',
  'spell.find-familiar': 'Find Familiar consumes its material cost and creates or changes exactly one independently acting Celestial, Fey, or Fiend familiar with legal form, Initiative, telepathy, shared senses, touch-spell delivery, dismissal, reappearance, and zero-HP lifecycle.',
  'spell.purify-food-and-drink': 'Purify Food and Drink can be cast normally or as a Ritual and removes poison and rot only from nonmagical food and drink inside the declared 5-foot-radius sphere.',

  'fighting-style.archery': 'Archery adds 2 to attack rolls made with ranged weapons and does not modify damage rolls or non-ranged attacks.',
  'fighting-style.defense': 'Defense adds 1 AC only while the character is wearing light, medium, or heavy armor.',
  'fighting-style.two-weapon-fighting': 'Two-Weapon Fighting permits adding the attack ability modifier to the extra attack made through the Light property.',
  'fighting-style.protection': 'Protection uses a Reaction while a Shield is equipped to impose Disadvantage on a qualifying attack against another creature within 5 feet.',
});

const CHOICE_OBLIGATIONS: readonly MicroMvpDerivedObligationSpec[] = [
  ['cleric_cantrips', 'class.cleric', 'Cleric cantrips', 'The level-1 Cleric cantrip choice resolves its exact count from the legal Cleric cantrip pool.'],
  ['cleric_divine_order', 'class.cleric', 'Divine Order', 'Protector and Thaumaturge each compile as distinct legal level-1 Divine Order branches with their structured grants.'],
  ['cleric_spells_l1', 'class.cleric', 'Cleric prepared spells', 'The level-1 Cleric prepared-spell choice resolves its exact count from legal level-1 Cleric spells.'],
  ['druid_cantrips', 'class.druid', 'Druid cantrips', 'The level-1 Druid cantrip choice resolves its exact count from the legal Druid cantrip pool.'],
  ['druid_primal_order', 'class.druid', 'Primal Order', 'Magician and Warden each compile as distinct legal level-1 Primal Order branches with their structured grants.'],
  ['druid_spells_l1', 'class.druid', 'Druid prepared spells', 'The level-1 Druid prepared-spell choice resolves its exact count from legal level-1 Druid spells.'],
  ['elf_skill', 'species.elf', 'Elf Keen Senses skill', 'The Elf Keen Senses choice resolves exactly one legal proficiency from Insight, Perception, or Survival.'],
  ['feat_skilled', 'feat.skilled', 'Skilled selections', 'The Skilled feat resolves exactly three distinct legal skill or tool proficiency selections.'],
  ['fighter_fighting_style', 'class.fighter', 'Fighter Fighting Style', 'The Fighter can select and materialize each of the four fighting styles declared by the micro-MVP manifest.'],
  ['human_feat', 'species.human', 'Human Versatile feat', 'The Human Versatile choice resolves one legal Origin feat independently from the product Origin-feat slot.'],
  ['human_skill', 'species.human', 'Human Skillful proficiency', 'The Human Skillful choice resolves exactly one legal skill proficiency.'],
  ['magic_initiate_wizard_cantrips', 'feat.magic-initiate', 'Magic Initiate cantrips', 'Magic Initiate (Wizard) resolves exactly two distinct legal Wizard cantrips.'],
  ['magic_initiate_wizard_level_1', 'feat.magic-initiate', 'Magic Initiate level-1 spell', 'Magic Initiate (Wizard) resolves exactly one legal level-1 Wizard spell with its free-use provenance.'],
  ['rogue_expertise_l1', 'class.rogue', 'Rogue Expertise', 'The level-1 Rogue Expertise choice resolves exactly two eligible proficiencies without duplication.'],
  ['sorcerer_cantrips', 'class.sorcerer', 'Sorcerer cantrips', 'The level-1 Sorcerer cantrip choice resolves its exact count from the legal Sorcerer cantrip pool.'],
  ['sorcerer_spells_known', 'class.sorcerer', 'Sorcerer known spells', 'The level-1 Sorcerer spell choice resolves its exact count from legal level-1 Sorcerer spells.'],
  ['warlock_cantrips', 'class.warlock', 'Warlock cantrips', 'The level-1 Warlock cantrip choice resolves its exact count from the legal Warlock cantrip pool.'],
  ['warlock_invocation_l1', 'class.warlock', 'Warlock invocation', 'The level-1 Warlock invocation choice offers exactly the five legal no-prerequisite options and resolves exactly one.'],
  ['warlock_spells_known', 'class.warlock', 'Warlock known spells', 'The level-1 Warlock spell choice resolves its exact count from legal level-1 Warlock spells.'],
  ['weapon-mastery', 'class.fighter', 'Fighter Weapon Mastery', 'The level-1 Fighter Weapon Mastery choice resolves three distinct qualified weapons and binds their mastery effects.'],
  ['weapon-mastery', 'class.rogue', 'Rogue Weapon Mastery', 'The level-1 Rogue Weapon Mastery choice resolves two distinct qualified weapons and binds their mastery effects.'],
  ['wizard_cantrips', 'class.wizard', 'Wizard cantrips', 'The level-1 Wizard cantrip choice resolves its exact count from the legal Wizard cantrip pool.'],
  ['wizard_spellbook_level_1', 'class.wizard', 'Wizard spellbook', 'The level-1 Wizard spellbook choice resolves six distinct legal level-1 Wizard spells and preserves a separate prepared subset.'],
].map(([suffix, entityId, title, statement]) => ({
  id: microMvpChoiceObligationId(suffix, entityId),
  title,
  statement,
  kind: 'choice' as const,
  targetEntityIds: [entityId],
  locator: `choice:${suffix}`,
}));

const DRAGONBORN_LINEAGES = [
  'black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white',
] as const;
const ELF_LINEAGES = ['drow', 'high-elf', 'wood-elf'] as const;

const LINEAGE_OBLIGATIONS: readonly MicroMvpDerivedObligationSpec[] = [
  ...DRAGONBORN_LINEAGES.map((lineage) => ({
    id: `derived.lineage.dragonborn.${lineage}`,
    title: `Dragonborn lineage: ${lineage}`,
    statement: `The ${lineage} Draconic Ancestry branch materializes its referenced level-1 Breath Weapon action and resistance effect without Draconic Flight.`,
    kind: 'lineage' as const,
    targetEntityIds: ['species.dragonborn'],
    locator: `lineage:dragonborn:${lineage}`,
  })),
  ...ELF_LINEAGES.map((lineage) => ({
    id: `derived.lineage.elf.${lineage}`,
    title: `Elf lineage: ${lineage}`,
    statement: `The ${lineage} Elf lineage branch materializes its level-1 grants without granting its level-3 or level-5 spells.`,
    kind: 'lineage' as const,
    targetEntityIds: ['species.elf'],
    locator: `lineage:elf:${lineage}`,
  })),
];

const INVOCATION_OBLIGATIONS: readonly MicroMvpDerivedObligationSpec[] = [
  ['armor-of-shadows', 'Armor of Shadows', 'Armor of Shadows grants self-only at-will Mage Armor without spending a spell slot and retains Warlock invocation provenance.'],
  ['eldritch-mind', 'Eldritch Mind', 'Eldritch Mind grants Advantage only on Constitution saving throws made to maintain Concentration.'],
  ['pact-blade', 'Pact of the Blade', 'Pact of the Blade creates and replaces durable Card-backed weapon bond state only through its canonical Bonus Action command, never through generic marker effects.'],
  ['pact-chain', 'Pact of the Chain', 'Pact of the Chain grants an at-will no-slot Find Familiar action and materializes the summoned familiar as an actor with legal options.'],
  ['pact-tome', 'Pact of the Tome', 'Pact of the Tome creates durable Book of Shadows rest state containing three cantrips and two level-1 rituals with Warlock provenance.'],
].map(([slug, title, statement]) => ({
  id: `derived.invocation.${slug}`,
  title,
  statement,
  kind: 'invocation' as const,
  targetEntityIds: ['class.warlock'],
  locator: `invocation:${slug}`,
}));

/**
 * Pact invocations are deliberately decomposed below their summary
 * obligations.  A single happy-path cast or attack must never certify a
 * multi-clause feature whose item, actor, component, or terminal lifecycle is
 * still missing.
 */
const INVOCATION_ATOMIC_OBLIGATIONS: readonly MicroMvpDerivedObligationSpec[] = [
  {
    id: 'derived.invocation.pact-blade.bond-and-replacement',
    title: 'Pact Blade bond and replacement',
    statement: 'A Bonus Action conjures one legal Simple or Martial Melee weapon into a chosen free hand, or bonds one explicitly touched magic weapon; foreign attunement or another Warlock bond is rejected, and a later legal bond replaces exactly the prior bond.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-blade:bond-and-replacement',
  },
  {
    id: 'derived.invocation.pact-blade.attack-and-damage',
    title: 'Pact Blade attack projection',
    statement: 'Only the held active pact-weapon item is automatically proficient; each of its attacks independently chooses Strength, Dexterity when otherwise legal, or Charisma for both attack and damage and independently chooses normal, Necrotic, Psychic, or Radiant damage without granting Weapon Mastery.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-blade:attack-and-damage',
  },
  {
    id: 'derived.invocation.pact-blade.material-focus',
    title: 'Pact Blade material focus',
    statement: 'The active pact weapon functions as a spellcasting focus only while held and only for a spell’s Material component; it never replaces Verbal or Somatic components and never erases a costly or consumed material requirement.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-blade:material-focus',
  },
  {
    id: 'derived.invocation.pact-blade.end-lifecycle',
    title: 'Pact Blade terminal lifecycle',
    statement: 'Explicit continuous distance greater than 5 feet for at least one minute or an authoritative owner-death adjudication ends the bond; a conjured weapon disappears, an existing magic item remains, and zero Hit Points alone never asserts death.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-blade:end-lifecycle',
  },
  {
    id: 'derived.invocation.pact-chain.casting-and-forms',
    title: 'Pact Chain casting and forms',
    statement: 'Pact of the Chain grants Find Familiar as an at-will Magic action without a spell slot, still consumes the spell’s material cost, and offers every normal Find Familiar form plus the eight level-1 Pact Chain forms with an explicit Celestial, Fey, or Fiend spirit type.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-chain:casting-and-forms',
  },
  {
    id: 'derived.invocation.pact-chain.actor-lifecycle',
    title: 'Pact Chain familiar actor lifecycle',
    statement: 'The owner has at most one independently acting familiar actor with its own Initiative and turn, telepathy and shared-senses state, temporary and permanent dismissal, reappearance, equipment drop, and zero-Hit-Point disappearance, all preserved by checkpoint and replay.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-chain:actor-lifecycle',
  },
  {
    id: 'derived.invocation.pact-chain.attack-substitution',
    title: 'Pact Chain attack substitution',
    statement: 'When the Warlock takes the Attack action, exactly one remaining attack can be replaced by one legal familiar attack; the familiar spends its Reaction, the owner’s attack budget advances once, and ordinary Find Familiar forms remain eligible when their stat block has an attack.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-chain:attack-substitution',
  },
  {
    id: 'derived.invocation.pact-chain.touch-delivery',
    title: 'Familiar touch-spell delivery',
    statement: 'A familiar within 100 feet can spend its Reaction to deliver its owner’s Touch spell: the owner pays the spell action and casting resource exactly once, the familiar supplies origin-to-target facts, and any attack roll, saving throw, Reaction, and continuation resolves against the target exactly once.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-chain:touch-delivery',
  },
  {
    id: 'derived.invocation.pact-tome.rest-selection',
    title: 'Pact Tome rest selection',
    statement: 'At the end of either rest the Warlock creates or replaces one Book of Shadows containing exactly three distinct cantrips and two distinct level-1 Ritual spells from any class lists, excluding every spell the actor already has prepared.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-tome:rest-selection',
  },
  {
    id: 'derived.invocation.pact-tome.book-and-focus',
    title: 'Pact Tome book ownership and focus',
    statement: 'The selected spells are prepared Warlock spells sourced only by the current physical Book of Shadows; the carried book is their spellcasting focus, replacement removes only the prior source-owned book and grants, and a missing, foreign, or stale book fails closed.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-tome:book-and-focus',
  },
  {
    id: 'derived.invocation.pact-tome.casting-modes',
    title: 'Pact Tome casting modes',
    statement: 'Book cantrips cast normally without a slot; each selected level-1 Ritual can be cast normally with the Warlock’s legal slot or as a ten-minute Ritual without a slot, with one audited payment and one action declaration.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-tome:casting-modes',
  },
  {
    id: 'derived.invocation.pact-tome.owner-death',
    title: 'Pact Tome owner-death lifecycle',
    statement: 'An authoritative owner-death adjudication atomically removes the Book of Shadows, its five source-owned grants and actions, and the Tome invocation while preserving foreign capabilities; zero Hit Points alone never performs this cleanup.',
    kind: 'invocation',
    targetEntityIds: ['class.warlock'],
    locator: 'invocation:pact-tome:owner-death',
  },
];

const RUNTIME_OBLIGATIONS: readonly MicroMvpDerivedObligationSpec[] = [
  {
    id: 'derived.runtime.active-effect-build-projection',
    title: 'Active effect build projection',
    statement: 'The Dwarf Stonecunning feature granted through an effect becomes a catalog action owned by the Dwarf actor and retains the source effect identity.',
    kind: 'runtime',
    targetEntityIds: ['species.dwarf'],
    locator: 'runtime:active-effect-build-projection',
  },
  {
    id: 'derived.runtime.alert-initiative-swap',
    title: 'Alert initiative swap',
    statement: 'Immediately after Initiative, Alert permits exactly one swap with a willing ally when neither participant is Incapacitated and preserves the resulting turn order.',
    kind: 'runtime',
    targetEntityIds: ['feat.alert'],
    locator: 'feat:alert:initiative-swap',
  },
  {
    id: 'derived.runtime.area-geometry-and-multi-target',
    title: 'Area geometry and multi-target resolution',
    statement: 'Area spells derive all legal targets from explicit area facts and resolve each target exactly once without allowing a single-target adapter to claim full area semantics.',
    kind: 'runtime',
    targetEntityIds: ['spell.burning-hands', 'spell.thunderwave'],
    locator: 'runtime:area-geometry-and-multi-target',
  },
  {
    id: 'derived.runtime.chill-touch-healing-lock',
    title: 'Chill Touch healing lock',
    statement: 'A creature hit by Chill Touch cannot regain Hit Points until the end of the caster’s next turn, while Temporary Hit Points and later healing remain distinguishable.',
    kind: 'runtime',
    targetEntityIds: ['spell.chill-touch'],
    locator: 'spell:chill-touch:healing-lock',
  },
  {
    id: 'derived.runtime.detect-magic-world-sensing',
    title: 'Detect Magic world sensing',
    statement: 'Detect Magic queries world facts within 30 feet, respects blocking materials, and records per-object aura and school results from its follow-up Magic action.',
    kind: 'runtime',
    targetEntityIds: ['spell.detect-magic'],
    locator: 'spell:detect-magic:world-sensing',
  },
  {
    id: 'derived.runtime.dragonborn-attack-replacement',
    title: 'Dragonborn Breath Weapon attack replacement',
    statement: 'Breath Weapon replaces one attack inside the Attack action rather than consuming the whole action, spends one use, and resolves its ancestry-specific save and damage.',
    kind: 'runtime',
    targetEntityIds: ['species.dragonborn'],
    locator: 'species:dragonborn:attack-replacement',
  },
  {
    id: 'derived.runtime.elf-lineage-spellcasting-ability',
    title: 'Elf lineage spellcasting ability',
    statement: 'The Elf lineage choice records Intelligence, Wisdom, or Charisma and propagates that persisted choice into every level-1 lineage spell declaration and execution. No level-1 lineage spell makes an attack roll or forces a saving throw; numeric save-DC acceptance begins with the Drow’s level-3 Faerie Fire in part-MVP.',
    kind: 'runtime',
    targetEntityIds: ['species.elf'],
    locator: 'species:elf:lineage-spellcasting-ability',
  },
  {
    id: 'derived.runtime.elf-trance-and-sleep-immunity',
    title: 'Elf Trance and sleep immunity',
    statement: 'Magical sleep cannot put an Elf to sleep, and a four-hour Trance completes the Elf’s Long Rest without shortening another creature’s rest.',
    kind: 'runtime',
    targetEntityIds: ['species.elf'],
    locator: 'species:elf:trance-and-sleep-immunity',
  },
  {
    id: 'derived.runtime.environmental-object-effects',
    title: 'Spell effects on environmental objects',
    statement: 'Burning Hands ignites unattended flammable objects and Thunderwave moves unsecured objects using explicit world-object events that replay deterministically.',
    kind: 'runtime',
    targetEntityIds: ['spell.burning-hands', 'spell.thunderwave'],
    locator: 'runtime:environmental-object-effects',
  },
  {
    id: 'derived.runtime.light-world-illumination',
    title: 'Light world illumination',
    statement: 'Light attaches illumination to a target object, contributes bright and dim world-light facts, respects opaque cover, and replaces the caster’s prior Light instance.',
    kind: 'runtime',
    targetEntityIds: ['spell.light'],
    locator: 'spell:light:world-illumination',
  },
  {
    id: 'derived.runtime.magic-missile-distribution-and-shield',
    title: 'Magic Missile distribution and Shield immunity',
    statement: 'Three Magic Missile darts can be distributed among legal creatures, resolve simultaneously for 1d4+1 Force each, and deal no damage to a target protected by Shield.',
    kind: 'runtime',
    targetEntityIds: ['spell.magic-missile'],
    locator: 'spell:magic-missile:distribution-and-shield',
  },
  {
    id: 'derived.runtime.minor-illusion-object-and-study',
    title: 'Minor Illusion object and Study state',
    statement: 'Minor Illusion creates durable sound or image world state and records each observer’s Study result without globally revealing the illusion to every actor.',
    kind: 'runtime',
    targetEntityIds: ['spell.minor-illusion'],
    locator: 'spell:minor-illusion:object-and-study',
  },
  {
    id: 'derived.runtime.source-turn-relative-expiry',
    title: 'Source-turn-relative expiry',
    statement: 'Effects that expire at the start or end of the source actor’s next turn retain source identity and expire at that boundary even when applied to another actor.',
    kind: 'runtime',
    targetEntityIds: ['spell.ray-of-frost', 'spell.chill-touch', 'spell.guiding-bolt'],
    locator: 'runtime:source-turn-relative-expiry',
  },
  {
    id: 'derived.runtime.weapon-profile-authority',
    title: 'Reachable weapon profile authority',
    statement: 'Every weapon reachable from the 448 level-1 roots declares one strict mechanics.weapon_profile that owns damage, ability, category, attack modes, properties, mastery, ammunition, enchantment, attunement, Heavy threshold, and actor-bound targeting; execution fails closed instead of reading conflicting display fields.',
    kind: 'runtime',
    targetEntityIds: ['class.fighter', 'class.rogue'],
    locator: 'runtime:weapon-profile-authority',
  },
  {
    id: 'derived.mastery.topple',
    title: 'Topple mastery continuation',
    statement: 'A qualifying Topple hit opens a target Constitution save, survives JSON reload, applies Prone only on failure, and never repeats hit damage.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:topple',
  },
  {
    id: 'derived.mastery.sap',
    title: 'Sap mastery next-attack disadvantage',
    statement: 'A qualifying Sap hit gives the target Disadvantage on its next attack roll, consumes the effect on that roll only, and expires at the start of the attacker’s next turn.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:sap',
  },
  {
    id: 'derived.mastery.slow',
    title: 'Slow mastery speed reduction',
    statement: 'When its explicit optional choice is accepted after dealing damage, Slow reduces the target’s Speed by 10 feet without stacking and expires at the start of the attacker’s next turn.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:slow',
  },
  {
    id: 'derived.mastery.vex',
    title: 'Vex mastery target-locked advantage',
    statement: 'A qualifying Vex hit that deals damage gives Advantage on the attacker’s next attack against that exact target, consumes on that attack only, and expires at the end of the attacker’s next turn.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:vex',
  },
  {
    id: 'derived.mastery.push',
    title: 'Push mastery voluntary movement',
    statement: 'After a qualifying Push hit, an explicit choice can move a Large-or-smaller target directly away by any legal distance from 0 through 10 feet.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:push',
  },
  {
    id: 'derived.mastery.graze',
    title: 'Graze mastery miss damage',
    statement: 'After a qualifying miss and explicit optional choice, Graze deals damage of the weapon’s damage type equal to the attack ability modifier, floored at zero, without any additional damage modifiers.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:graze',
  },
  {
    id: 'derived.mastery.nick',
    title: 'Nick mastery Light attack economy',
    statement: 'The explicitly selected Light extra attack can be made as part of the Attack action instead of as a Bonus Action, no more than once per turn.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:nick',
  },
  {
    id: 'derived.mastery.cleave',
    title: 'Cleave mastery follow-up attack',
    statement: 'A qualifying melee hit opens one same-weapon attack per turn against a different creature within 5 feet of the first target; positive ability-modifier damage is omitted and the choice expires at end of turn.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:cleave',
  },
  {
    id: 'derived.mastery.topple-after-shield',
    title: 'Topple continuation after Shield',
    statement: 'When Shield resolves but the triggering attack still hits, the suspended attack continues into exactly one Topple save without repeating its damage or costs.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:topple-after-shield',
  },
  {
    id: 'derived.mastery.topple-concentration-queue',
    title: 'Topple and Concentration save ordering',
    statement: 'Damage that triggers both Topple and a Concentration save serializes the two target-owned decisions, preserves both across reload, and opens at most one pending resolution at a time.',
    kind: 'mastery',
    targetEntityIds: ['class.fighter'],
    locator: 'weapon-mastery:topple-concentration-queue',
  },
  {
    id: 'derived.runtime.wizard-prepared-subset',
    title: 'Wizard prepared subset',
    statement: 'A level-1 Wizard can cast a levelled spell normally only from the current prepared subset while retaining the larger spellbook; Ritual Adept permits an unprepared Ritual-tagged spell in that spellbook to be cast as a ritual, and preparation changes preserve both sets.',
    kind: 'runtime',
    targetEntityIds: ['class.wizard'],
    locator: 'class:wizard:prepared-spells',
  },
];

export const MICRO_MVP_DERIVED_OBLIGATION_SPECS: readonly MicroMvpDerivedObligationSpec[] = [
  ...CHOICE_OBLIGATIONS,
  ...LINEAGE_OBLIGATIONS,
  ...INVOCATION_OBLIGATIONS,
  ...INVOCATION_ATOMIC_OBLIGATIONS,
  ...RUNTIME_OBLIGATIONS,
];

function sourceReference(input: {
  section: string;
  locator: string;
  sourceId?: string;
  track?: string;
  sourceHash?: RuleSourceReference['sourceHash'];
}): RuleSourceReference {
  return {
    sourceId: input.sourceId ?? 'phb-2024',
    track: input.track ?? 'PHB',
    edition: '2024',
    version: 'initial-2024-release+errata-v1',
    section: input.section,
    locator: input.locator,
    retrievedAt: '2026-08-04',
    sourceHash: input.sourceHash ?? PINNED_PHB_2024_CORPUS_HASH,
  };
}

function entityObligationId(entityId: string): string {
  return `micro-mvp.entity.${entityId}`;
}

export function microMvpEntityObligationId(entityId: string): string {
  return entityObligationId(entityId);
}

export function microMvpChoiceObligationId(choiceSuffix: string, entityId: string): string {
  return `derived.choice.${choiceSuffix}.${entityId.replaceAll('.', '-')}`;
}

function obligation(input: {
  id: string;
  title: string;
  statement: string;
  source: RuleSourceReference;
}): RuleObligation {
  return {
    schemaVersion: 1,
    id: input.id,
    title: input.title,
    statement: input.statement,
    owner: 'rules-team',
    release: { ...MICRO_MVP_COVERAGE_RELEASE },
    source: input.source,
  };
}

function stableManifestEntities(manifest: MicroMvpSnapshotManifest): MicroMvpCoverageEntity[] {
  const entities = COLLECTIONS.flatMap((collection) => (
    (manifest.collections[collection] ?? []).map((entry) => ({
      id: entry.key,
      collection,
      label: entry.label,
      cardNumber: entry.selector.cardNumber ?? '',
    }))
  )).sort((left, right) => left.id.localeCompare(right.id));

  const issues: string[] = [];
  if (entities.length !== MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY) {
    issues.push(
      `canonical entity cardinality changed: expected ${MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY}, got ${entities.length}`,
    );
  }
  const duplicateIds = entities
    .filter((entity, index) => entities.findIndex((item) => item.id === entity.id) !== index)
    .map((entity) => entity.id);
  if (duplicateIds.length) issues.push(`duplicate manifest entity IDs: ${[...new Set(duplicateIds)].join(', ')}`);
  const missingCards = entities.filter((entity) => !entity.cardNumber).map((entity) => entity.id);
  if (missingCards.length) issues.push(`entities without stable cardNumber: ${missingCards.join(', ')}`);

  const statementIds = Object.keys(ENTITY_RULE_STATEMENTS).sort();
  const entityIds = entities.map((entity) => entity.id);
  const missingStatements = entityIds.filter((id) => !ENTITY_RULE_STATEMENTS[id]);
  const staleStatements = statementIds.filter((id) => !entityIds.includes(id));
  if (missingStatements.length || staleStatements.length) {
    issues.push(
      `independent rule statements are stale: missing=[${missingStatements.join(', ')}], orphaned=[${staleStatements.join(', ')}]`,
    );
  }
  if (issues.length) throw new Error(`Invalid micro-MVP coverage manifest:\n${issues.join('\n')}`);
  return entities;
}

function productRuleIsCurrent(manifest: MicroMvpSnapshotManifest): boolean {
  return manifest.productRules.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const rule = candidate as Record<string, unknown>;
    return rule.id === MICRO_MVP_PRODUCT_RULE_ID
      && rule.provenance === 'product_rule'
      && rule.status === 'active';
  });
}

/**
 * Builds the denominator from the independently versioned content manifest.
 * Assertions are deliberately not an input and therefore cannot shrink scope.
 */
export function createMicroMvpCoverageDenominator(
  manifest: MicroMvpSnapshotManifest,
): MicroMvpCoverageDenominator {
  if (manifest.release !== 'micro-mvp' || manifest.systemId !== 'dnd5e-2024') {
    throw new Error(`Unexpected manifest release ${manifest.release}/${manifest.systemId}`);
  }
  if (!productRuleIsCurrent(manifest)) {
    throw new Error(`Missing active product rule ${MICRO_MVP_PRODUCT_RULE_ID}`);
  }

  const entities = stableManifestEntities(manifest);
  const entityObligationIds = Object.fromEntries(entities.map((entity) => [
    entity.id,
    entityObligationId(entity.id),
  ]));
  const entityObligations = entities.map((entity) => obligation({
    id: entityObligationIds[entity.id],
    title: `${entity.label}: complete level-1 behavior`,
    statement: ENTITY_RULE_STATEMENTS[entity.id],
    source: sourceReference({
      section: entity.collection,
      locator: `card:${entity.cardNumber}`,
    }),
  }));
  const productRuleObligation = obligation({
    id: `micro-mvp.product-rule.${MICRO_MVP_PRODUCT_RULE_ID}`,
    title: 'Independent Origin-feat choice',
    statement: 'Every build selects exactly one product Origin feat independently of background, replaces rather than adds the official background feat, and preserves distinct species-granted feats.',
    source: sourceReference({
      sourceId: `project-rule:${MICRO_MVP_PRODUCT_RULE_ID}`,
      track: 'project-ruling',
      section: 'Character creation',
      locator: 'docs/product-rules/free_origin_feat_choice_v1.json',
      sourceHash: PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH,
    }),
  });
  const derivedObligations = MICRO_MVP_DERIVED_OBLIGATION_SPECS.map((spec) => obligation({
    id: spec.id,
    title: spec.title,
    statement: spec.statement,
    source: sourceReference({ section: `derived-${spec.kind}`, locator: spec.locator }),
  }));

  const targets: CapabilityTarget[] = [
    ...entities.map((entity) => ({
      entityId: entity.id,
      obligationId: entityObligationIds[entity.id],
      capabilityProfileIds: ['semantic-unit-and-scenario'],
      owner: 'rules-team',
    })),
    ...entities
      .filter((entity) => entity.collection === 'originFeats')
      .map((entity) => ({
        entityId: entity.id,
        obligationId: productRuleObligation.id,
        capabilityProfileIds: ['semantic-unit-and-scenario'],
        owner: 'product-rules-team',
      })),
    ...MICRO_MVP_DERIVED_OBLIGATION_SPECS.flatMap((spec) => spec.targetEntityIds.map((entityId) => ({
      entityId,
      obligationId: spec.id,
      capabilityProfileIds: ['semantic-unit-and-scenario'],
      owner: 'rules-team',
    }))),
  ].sort((left, right) => (
    left.entityId.localeCompare(right.entityId)
      || left.obligationId.localeCompare(right.obligationId)
  ));

  const matrix: CapabilityEvidenceMatrix = {
    schemaVersion: 1,
    id: 'micro-mvp-2024-semantic-denominator-v1',
    owner: 'rules-qa',
    release: { ...MICRO_MVP_COVERAGE_RELEASE },
    scopeEntityIds: entities.map((entity) => entity.id),
    profiles: [{
      id: 'semantic-unit-and-scenario',
      title: 'Semantic unit and two-character scenario acceptance',
      owner: 'rules-qa',
      requirements: [{
        aspectId: MICRO_MVP_SEMANTIC_ASPECT,
        evidenceTypes: ['unit', 'scenario', 'compiled_release_scenario'],
        notApplicable: 'forbidden',
      }],
    }],
    targets,
    notApplicableScopeRules: [],
    notApplicable: [],
  };

  return {
    currentRelease: { ...MICRO_MVP_COVERAGE_RELEASE },
    entities,
    currentEntityIds: entities.map((entity) => entity.id),
    obligations: [...entityObligations, productRuleObligation, ...derivedObligations]
      .sort((left, right) => left.id.localeCompare(right.id)),
    matrix,
    entityObligationIds,
    derivedObligations: MICRO_MVP_DERIVED_OBLIGATION_SPECS,
  };
}
