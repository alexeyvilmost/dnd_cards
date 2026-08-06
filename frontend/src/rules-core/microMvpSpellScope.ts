export const MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT = 49 as const;
export const MICRO_MVP_SPELL_SCOPE_CANTRIP_COUNT = 12 as const;
export const MICRO_MVP_SPELL_SCOPE_LEVEL_ONE_COUNT = 14 as const;

export type MicroMvpSpellClass = 'cleric' | 'druid' | 'sorcerer' | 'warlock' | 'wizard';

export interface MicroMvpSpellScopeManifestEntry {
  key: string;
  selector: { cardNumber?: string };
  expected?: { level?: unknown } & Readonly<Record<string, unknown>>;
}

export interface MicroMvpSpellScopeManifest {
  manifestVersion: string;
  release: string;
  systemId: string;
  characterLevel: number;
  collections: Readonly<Record<string, readonly MicroMvpSpellScopeManifestEntry[]>>;
}

/** The deliberately small snapshot surface needed by the browser-safe policy builder. */
export interface MicroMvpSpellScopeCatalogSpell {
  id: string;
  card_number: string;
  level: number;
  classes?: readonly string[] | null;
  ritual: boolean;
  name?: string;
}

export interface MicroMvpCuratedSpell {
  id: string;
  cardNumber: string;
  manifestKey: string;
  level: 0 | 1;
  classes: readonly string[];
  ritual: boolean;
}

export interface MicroMvpSpellChoicePolicy {
  id: MicroMvpSpellChoiceId;
  count: number;
  level: 0 | 1;
  spellClass?: MicroMvpSpellClass;
  catalogClassName?: string;
  ritual?: true;
  /** Canonical spell UUIDs in manifest order. */
  spellIds: readonly string[];
}

export interface MicroMvpFixedSpellGrantPolicy {
  featureId: MicroMvpFixedSpellGrantFeatureId;
  /** Exact canonical spell UUIDs owned by this feature at character level 1. */
  spellIds: readonly string[];
}

export interface MicroMvpSpellScopePolicy {
  manifestVersion: string;
  manifestEntityCount: typeof MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT;
  spells: readonly MicroMvpCuratedSpell[];
  choices: Readonly<Record<MicroMvpSpellChoiceId, MicroMvpSpellChoicePolicy>>;
  fixedGrants: Readonly<
    Record<MicroMvpFixedSpellGrantFeatureId, MicroMvpFixedSpellGrantPolicy>
  >;
}

interface ChoiceDefinition {
  id: string;
  count: number;
  level: 0 | 1;
  spellClass?: MicroMvpSpellClass;
  ritual?: true;
}

const CLASS_CATALOG_NAMES: Readonly<Record<MicroMvpSpellClass, string>> = {
  cleric: 'жрец',
  druid: 'друид',
  sorcerer: 'чародей',
  warlock: 'колдун',
  wizard: 'волшебник',
};

/**
 * The complete spell-selection surface currently compiled at level 1.
 * Full pending-choice IDs are accepted by suffix, so the overlay can call the
 * integration hook without stripping source-owned choice identity.
 */
export const MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS = [
  { id: 'cleric_cantrips', count: 3, level: 0, spellClass: 'cleric' },
  { id: 'cleric_spells_l1', count: 4, level: 1, spellClass: 'cleric' },
  { id: 'cleric_thaumaturge_cantrip', count: 1, level: 0, spellClass: 'cleric' },
  { id: 'druid_cantrips', count: 2, level: 0, spellClass: 'druid' },
  { id: 'druid_spells_l1', count: 4, level: 1, spellClass: 'druid' },
  { id: 'druid_magician_cantrip', count: 1, level: 0, spellClass: 'druid' },
  { id: 'sorcerer_cantrips', count: 4, level: 0, spellClass: 'sorcerer' },
  { id: 'sorcerer_spells_known', count: 2, level: 1, spellClass: 'sorcerer' },
  { id: 'warlock_cantrips', count: 2, level: 0, spellClass: 'warlock' },
  { id: 'warlock_spells_known', count: 2, level: 1, spellClass: 'warlock' },
  { id: 'wizard_cantrips', count: 3, level: 0, spellClass: 'wizard' },
  { id: 'wizard_spellbook_level_1', count: 6, level: 1, spellClass: 'wizard' },
  { id: 'magic_initiate_wizard_cantrips', count: 2, level: 0, spellClass: 'wizard' },
  { id: 'magic_initiate_wizard_level_1', count: 1, level: 1, spellClass: 'wizard' },
  { id: 'pact_tome_cantrips', count: 3, level: 0 },
  { id: 'pact_tome_rituals', count: 2, level: 1, ritual: true },
] as const satisfies readonly ChoiceDefinition[];

export type MicroMvpSpellChoiceId =
  typeof MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS[number]['id'];

const FIXED_GRANT_DEFINITIONS = [
  { featureId: 'RE-sub-drow', spellCardNumbers: ['dancing_lights'] },
  { featureId: 'RE-sub-high_elf', spellCardNumbers: ['prestidigitation'] },
  { featureId: 'RE-sub-wood_elf', spellCardNumbers: ['druidcraft'] },
  { featureId: 'EFF-pact-chain', spellCardNumbers: ['SPELL-0241'] },
  { featureId: 'EFF-invoc-armor_of_shadows', spellCardNumbers: ['SPELL-0190'] },
] as const;

export type MicroMvpFixedSpellGrantFeatureId =
  typeof FIXED_GRANT_DEFINITIONS[number]['featureId'];

export class MicroMvpSpellScopeError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid micro-MVP spell scope:\n${problems.join('\n')}`);
    this.name = 'MicroMvpSpellScopeError';
  }
}

function fail(problem: string): never {
  throw new MicroMvpSpellScopeError([problem]);
}

function allManifestEntries(
  collections: MicroMvpSpellScopeManifest['collections'],
  problems: string[],
): MicroMvpSpellScopeManifestEntry[] {
  return Object.entries(collections).flatMap(([collection, entries]) => {
    if (!Array.isArray(entries)) {
      problems.push(`manifest collection ${collection} must be an array`);
      return [];
    }
    return entries as MicroMvpSpellScopeManifestEntry[];
  });
}

function spellCollection(
  manifest: MicroMvpSpellScopeManifest,
  collection: 'cantrips' | 'firstLevelSpells',
  expectedCount: number,
  expectedLevel: 0 | 1,
  problems: string[],
): readonly MicroMvpSpellScopeManifestEntry[] {
  const entries = manifest.collections[collection];
  if (!Array.isArray(entries)) {
    problems.push(`manifest collection ${collection} must be an array`);
    return [];
  }
  if (entries.length !== expectedCount) {
    problems.push(`${collection} must contain exactly ${expectedCount} entries; got ${entries.length}`);
  }
  for (const entry of entries) {
    if (entry.expected?.level !== expectedLevel) {
      problems.push(`${entry.key}: manifest level must be ${expectedLevel}`);
    }
  }
  return entries;
}

function buildCuratedSpells(input: {
  manifest: MicroMvpSpellScopeManifest;
  snapshotSpells: readonly MicroMvpSpellScopeCatalogSpell[];
  problems: string[];
}): MicroMvpCuratedSpell[] {
  const cantrips = spellCollection(
    input.manifest,
    'cantrips',
    MICRO_MVP_SPELL_SCOPE_CANTRIP_COUNT,
    0,
    input.problems,
  );
  const levelOne = spellCollection(
    input.manifest,
    'firstLevelSpells',
    MICRO_MVP_SPELL_SCOPE_LEVEL_ONE_COUNT,
    1,
    input.problems,
  );
  const result: MicroMvpCuratedSpell[] = [];
  for (const [expectedLevel, entry] of [
    ...cantrips.map((candidate) => [0, candidate] as const),
    ...levelOne.map((candidate) => [1, candidate] as const),
  ]) {
    const cardNumber = entry.selector?.cardNumber;
    if (typeof cardNumber !== 'string' || !cardNumber.trim()) {
      input.problems.push(`${entry.key}: spell scope requires selector.cardNumber`);
      continue;
    }
    const matches = input.snapshotSpells.filter((spell) => spell.card_number === cardNumber);
    if (matches.length !== 1) {
      input.problems.push(`${entry.key}: ${cardNumber} resolves to ${matches.length} snapshot spells`);
      continue;
    }
    const spell = matches[0];
    if (typeof spell.id !== 'string' || !spell.id.trim()) {
      input.problems.push(`${entry.key}: resolved spell id must be non-empty`);
      continue;
    }
    if (!Number.isInteger(spell.level) || spell.level !== expectedLevel) {
      input.problems.push(`${entry.key}: snapshot level must be ${expectedLevel}; got ${String(spell.level)}`);
      continue;
    }
    if (!Array.isArray(spell.classes) || !spell.classes.length
      || spell.classes.some((spellClass) => typeof spellClass !== 'string' || !spellClass.trim())) {
      input.problems.push(`${entry.key}: snapshot classes must be a non-empty string array`);
      continue;
    }
    if (typeof spell.ritual !== 'boolean') {
      input.problems.push(`${entry.key}: snapshot ritual must be boolean`);
      continue;
    }
    result.push({
      id: spell.id,
      cardNumber,
      manifestKey: entry.key,
      level: expectedLevel,
      classes: [...new Set(spell.classes)],
      ritual: spell.ritual,
    });
  }
  return result;
}

function eligibleForChoice(spell: MicroMvpCuratedSpell, definition: ChoiceDefinition): boolean {
  if (spell.level !== definition.level) return false;
  if (definition.spellClass
    && !spell.classes.includes(CLASS_CATALOG_NAMES[definition.spellClass])) return false;
  if (definition.ritual === true && spell.ritual !== true) return false;
  return true;
}

/**
 * Builds an immutable, fail-closed policy from the independently versioned
 * manifest and its pinned spell snapshot. Importing filesystem-backed canon
 * loaders here is intentionally avoided so this module remains browser-safe.
 */
export function buildMicroMvpSpellScopePolicy(input: {
  manifest: MicroMvpSpellScopeManifest;
  snapshotSpells: readonly MicroMvpSpellScopeCatalogSpell[];
}): MicroMvpSpellScopePolicy {
  const problems: string[] = [];
  if (input.manifest.release !== 'micro-mvp') {
    problems.push(`manifest release must be micro-mvp; got ${String(input.manifest.release)}`);
  }
  if (input.manifest.systemId !== 'dnd5e-2024') {
    problems.push(`manifest systemId must be dnd5e-2024; got ${String(input.manifest.systemId)}`);
  }
  if (input.manifest.characterLevel !== 1) {
    problems.push(`manifest characterLevel must be 1; got ${String(input.manifest.characterLevel)}`);
  }
  if (typeof input.manifest.manifestVersion !== 'string' || !input.manifest.manifestVersion.trim()) {
    problems.push('manifestVersion must be a non-empty string');
  }
  const entries = allManifestEntries(input.manifest.collections, problems);
  if (entries.length !== MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT) {
    problems.push(
      `manifest must contain exactly ${MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT} entities; got ${entries.length}`,
    );
  }
  const manifestKeys = entries.map((entry) => entry?.key);
  if (manifestKeys.some((key) => typeof key !== 'string' || !key.trim())
    || new Set(manifestKeys).size !== manifestKeys.length) {
    problems.push('manifest entity keys must be non-empty and unique');
  }

  const spells = buildCuratedSpells({ ...input, problems });
  if (new Set(spells.map((spell) => spell.id)).size !== spells.length) {
    problems.push('curated manifest spells must resolve to unique snapshot IDs');
  }
  if (new Set(spells.map((spell) => spell.cardNumber)).size !== spells.length) {
    problems.push('curated manifest spell card numbers must be unique');
  }

  const choices = Object.fromEntries(MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS.map((definition) => {
    const spellIds = spells
      .filter((spell) => eligibleForChoice(spell, definition))
      .map((spell) => spell.id);
    if (spellIds.length < definition.count) {
      problems.push(
        `${definition.id}: curated pool has ${spellIds.length}, requires ${definition.count}`,
      );
    }
    const spellClass = 'spellClass' in definition ? definition.spellClass : undefined;
    return [definition.id, {
      id: definition.id,
      count: definition.count,
      level: definition.level,
      ...(spellClass ? {
        spellClass,
        catalogClassName: CLASS_CATALOG_NAMES[spellClass],
      } : {}),
      ...('ritual' in definition && definition.ritual === true ? { ritual: true as const } : {}),
      spellIds,
    }];
  })) as unknown as Record<MicroMvpSpellChoiceId, MicroMvpSpellChoicePolicy>;

  const byCardNumber = new Map(spells.map((spell) => [spell.cardNumber, spell]));
  const fixedGrants = Object.fromEntries(FIXED_GRANT_DEFINITIONS.map((definition) => {
    const resolved = definition.spellCardNumbers.flatMap((cardNumber) => {
      const spell = byCardNumber.get(cardNumber);
      if (!spell) {
        problems.push(`${definition.featureId}: fixed grant ${cardNumber} is outside curated scope`);
        return [];
      }
      return [spell.id];
    });
    return [definition.featureId, { featureId: definition.featureId, spellIds: resolved }];
  })) as unknown as Record<
    MicroMvpFixedSpellGrantFeatureId,
    MicroMvpFixedSpellGrantPolicy
  >;

  if (problems.length) throw new MicroMvpSpellScopeError(problems);
  return {
    manifestVersion: input.manifest.manifestVersion,
    manifestEntityCount: MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT,
    spells,
    choices,
    fixedGrants,
  };
}

function spellIndex(policy: MicroMvpSpellScopePolicy): Map<string, MicroMvpCuratedSpell> {
  return new Map(policy.spells.flatMap((spell) => [
    [spell.id, spell] as const,
    [spell.cardNumber, spell] as const,
  ]));
}

function choicePolicy(
  policy: MicroMvpSpellScopePolicy,
  choiceId: string,
): MicroMvpSpellChoicePolicy {
  const matches = Object.values(policy.choices).filter((candidate) => (
    choiceId === candidate.id || choiceId.endsWith(`:${candidate.id}`)
  ));
  if (matches.length !== 1) fail(`${choiceId}: unsupported spell choice`);
  return matches[0];
}

function resolveSpellRefs(
  policy: MicroMvpSpellScopePolicy,
  refs: readonly string[],
  path: string,
): MicroMvpCuratedSpell[] {
  const index = spellIndex(policy);
  return refs.map((reference) => {
    const spell = index.get(reference);
    if (!spell) fail(`${path}: ${reference} is outside the curated manifest`);
    return spell;
  });
}

export function assertMicroMvpSpellChoiceSelection(input: {
  policy: MicroMvpSpellScopePolicy;
  choiceId: string;
  selectedSpellRefs: readonly string[];
}): readonly string[] {
  const choice = choicePolicy(input.policy, input.choiceId);
  if (input.selectedSpellRefs.length !== choice.count) {
    fail(`${input.choiceId}: requires exactly ${choice.count} spell selections`);
  }
  const spells = resolveSpellRefs(
    input.policy,
    input.selectedSpellRefs,
    input.choiceId,
  );
  if (new Set(spells.map((spell) => spell.id)).size !== spells.length) {
    fail(`${input.choiceId}: selections must be distinct canonical spells`);
  }
  for (const spell of spells) {
    if (spell.level !== choice.level) {
      fail(`${input.choiceId}: ${spell.cardNumber} must be level ${choice.level}`);
    }
    if (choice.catalogClassName && !spell.classes.includes(choice.catalogClassName)) {
      fail(
        `${input.choiceId}: ${spell.cardNumber} is not on the ${choice.spellClass} spell list`,
      );
    }
    if (choice.ritual === true && spell.ritual !== true) {
      fail(`${input.choiceId}: ${spell.cardNumber} is not a ritual`);
    }
  }
  return spells.map((spell) => spell.id);
}

export function assertMicroMvpFixedSpellGrants(input: {
  policy: MicroMvpSpellScopePolicy;
  featureId: string;
  grantedSpellRefs: readonly string[];
}): readonly string[] {
  const fixed = input.policy.fixedGrants[
    input.featureId as MicroMvpFixedSpellGrantFeatureId
  ];
  if (!fixed) fail(`${input.featureId}: unsupported fixed spell-grant feature`);
  const spells = resolveSpellRefs(input.policy, input.grantedSpellRefs, input.featureId);
  const actual = spells.map((spell) => spell.id).sort();
  const expected = [...fixed.spellIds].sort();
  if (actual.length !== expected.length || actual.some((spellId, index) => (
    spellId !== expected[index]
  ))) {
    fail(`${input.featureId}: fixed grants must exactly match their feature-owned policy`);
  }
  return actual;
}

/** Minimal API intended for the subsequent overlay integration change. */
export interface MicroMvpSpellScopeHook {
  choicePool(choiceId: string): readonly string[];
  assertChoice(choiceId: string, selectedSpellRefs: readonly string[]): readonly string[];
  assertFixedGrants(featureId: string, grantedSpellRefs: readonly string[]): readonly string[];
}

export function createMicroMvpSpellScopeHook(
  policy: MicroMvpSpellScopePolicy,
): MicroMvpSpellScopeHook {
  return {
    choicePool: (choiceId) => [...choicePolicy(policy, choiceId).spellIds],
    assertChoice: (choiceId, selectedSpellRefs) => assertMicroMvpSpellChoiceSelection({
      policy,
      choiceId,
      selectedSpellRefs,
    }),
    assertFixedGrants: (featureId, grantedSpellRefs) => assertMicroMvpFixedSpellGrants({
      policy,
      featureId,
      grantedSpellRefs,
    }),
  };
}
