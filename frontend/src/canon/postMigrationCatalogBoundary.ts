import {
  assertMicroMvpL1ContentMaterialized,
  materializeMicroMvpL1ContentPatch,
  MICRO_MVP_L1_CONTENT_PATCH,
} from './declarativeMechanicsPatch';
import {
  assertPostSnapshotCatalogProjection,
  POST_SNAPSHOT_CATALOG_PROJECTION,
  projectPostSnapshotCatalogsThrough115,
} from './postSnapshotCatalogProjection';
import type { SnapshotCatalogs } from './prodSnapshotL1Fixtures';

type JsonRecord = Record<string, unknown>;

const GOLIATH_LINEAGE_CARDS = [
  'RACE-0011-cloud',
  'RACE-0011-fire',
  'RACE-0011-frost',
  'RACE-0011-hill',
  'RACE-0011-stone',
  'RACE-0011-storm',
] as const;

const GOLIATH_ACTION_CARDS = [
  'ACT-goliath-cloud',
  'ACT-goliath-fire',
  'ACT-goliath-frost',
  'ACT-goliath-hill',
  'ACT-goliath-stone',
  'ACT-goliath-storm',
] as const;

const GOLIATH_EFFECT_CARDS = [
  'RE-goliath-1',
  'RE-sub-cloud',
  'RE-sub-fire',
  'RE-sub-frost',
  'RE-sub-hill',
  'RE-sub-stone',
  'RE-sub-storm',
] as const;

const STARTING_EQUIPMENT_CLASS_CARDS = [
  'CLASS-warrior',
  'CLASS-cleric',
  'CLASS-druid',
  'CLASS-paladin',
  'CLASS-ranger',
] as const;

const WEAPON_PROFILE_CARDS = [
  'CARD-0485',
  'CARD-0490',
  'CARD-0492',
  'CARD-0564',
  'CARD-0567',
  'CARD-0570',
  'CARD-0327',
] as const;

const POTION_CARDS = ['CARD-0839', 'CARD-0840', 'CARD-0841', 'CARD-0842'] as const;

/**
 * One audit-only catalog boundary shared by isolated browser fixtures and live
 * certification. Runtime authority remains the declarative patch plus the Go
 * migrations named here; this module only materializes and compares their
 * reviewed post-migration result using stable catalog identities.
 */
export const POST_MIGRATION_CATALOG_BOUNDARY = {
  schemaVersion: 1,
  boundaryId: 'micro-mvp-postmigration-catalog-107-116-v1',
  contentPatch: {
    patchId: MICRO_MVP_L1_CONTENT_PATCH.patchId,
    patchVersion: MICRO_MVP_L1_CONTENT_PATCH.patchVersion,
  },
  structuralProjection: {
    projectionId: POST_SNAPSHOT_CATALOG_PROJECTION.projectionId,
    migrations: POST_SNAPSHOT_CATALOG_PROJECTION.migrations,
  },
  patchOwnedMigration: '116_repair_half_caster_spellcasting_contract',
  semanticScopes: ['goliath', 'split-weapon-actions', 'starting-equipment'] as const,
} as const;

export class PostMigrationCatalogBoundaryError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Post-migration catalog boundary failed:\n${problems.join('\n')}`);
    this.name = 'PostMigrationCatalogBoundaryError';
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function exactByCardNumber(
  catalogs: SnapshotCatalogs,
  collection: keyof SnapshotCatalogs,
  cardNumber: string,
): JsonRecord {
  const rows = catalogs[collection] as unknown as JsonRecord[];
  const matches = rows.filter((row) => row.card_number === cardNumber);
  if (matches.length !== 1) {
    throw new PostMigrationCatalogBoundaryError([
      `${String(collection)}:${cardNumber}: expected one active stable identity, got ${matches.length}`,
    ]);
  }
  return matches[0];
}

type CatalogReferenceAliases = ReadonlyMap<string, ReadonlySet<string>>;

function catalogReferenceAliases(catalogs: SnapshotCatalogs): CatalogReferenceAliases {
  const aliases = new Map<string, Set<string>>();
  for (const rows of Object.values(catalogs)) {
    for (const value of rows as unknown as JsonRecord[]) {
      const identity = value.card_number ?? value.resource_id ?? value.variable_id;
      if (typeof identity !== 'string' || !identity) continue;
      for (const reference of [identity, value.id]) {
        if (typeof reference !== 'string' || !reference) continue;
        const identities = aliases.get(reference) ?? new Set<string>();
        identities.add(identity);
        aliases.set(reference, identities);
      }
    }
  }
  return aliases;
}

function stableReference(
  value: string,
  aliases: CatalogReferenceAliases,
  path: string,
): string {
  const identities = [...(aliases.get(value) ?? [])].sort();
  if (identities.length > 1) {
    throw new PostMigrationCatalogBoundaryError([
      `${path}: reference ${value} is ambiguous between ${identities.join(', ')}`,
    ]);
  }
  return identities[0] ?? value;
}

function stableReferences(
  value: unknown,
  aliases: CatalogReferenceAliases,
  path = 'catalog mechanics',
): unknown {
  if (typeof value === 'string') return stableReference(value, aliases, path);
  if (Array.isArray(value)) {
    return value.map((item, index) => stableReferences(item, aliases, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => (
      [key, stableReferences(item, aliases, `${path}.${key}`)]
    )));
    if (normalized.kind === 'movement'
        && normalized.mode === 'teleport'
        && normalized.value === undefined) {
      const canonical: JsonRecord = { ...normalized, value: 'teleport' };
      delete canonical.mode;
      return canonical;
    }
    return normalized;
  }
  return value;
}

function stableReferenceList(
  value: unknown,
  aliases: CatalogReferenceAliases,
  path: string,
): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((reference, index) => {
    if (typeof reference !== 'string') {
      throw new PostMigrationCatalogBoundaryError(['catalog relationship contains a non-string reference']);
    }
    return stableReference(reference, aliases, `${path}[${index}]`);
  }).sort();
}

function stableEquipmentOptions(
  value: unknown,
  aliases: CatalogReferenceAliases,
): JsonRecord {
  return Object.fromEntries(Object.entries(record(value)).sort(([left], [right]) => (
    left.localeCompare(right)
  )).map(([key, rawOption]) => {
    const option = record(rawOption);
    const items = (Array.isArray(option.items) ? option.items : []).map((rawItem) => {
      const item = record(rawItem);
      const reference = typeof item.card_id === 'string'
        ? stableReference(item.card_id, aliases, `${key}.items.card_id`)
        : '';
      if (!reference) {
        throw new PostMigrationCatalogBoundaryError([`${key}: equipment item has no stable card identity`]);
      }
      return { card_id: reference, quantity: Number(item.quantity ?? 1) };
    }).sort((left, right) => (
      left.card_id.localeCompare(right.card_id) || left.quantity - right.quantity
    ));
    return [key, { items, gold: Number(option.gold ?? 0) }];
  }));
}

/** Materializes the reviewed patch and then the structural migrations. */
export function materializeReviewedPostMigrationCatalogs(
  source: SnapshotCatalogs,
): SnapshotCatalogs {
  return projectPostSnapshotCatalogsThrough115(
    materializeMicroMvpL1ContentPatch(source).catalogs,
  );
}

/**
 * Stable semantic projection added to the live compiler attestation. Support,
 * timestamps, descriptions and images are deliberately absent: certification
 * metadata is output of this gate, never an input that can make itself pass.
 */
export function postMigrationCatalogSemanticProjection(
  catalogs: SnapshotCatalogs,
): JsonRecord {
  assertMicroMvpL1ContentMaterialized(catalogs);
  assertPostSnapshotCatalogProjection(catalogs);
  const aliases = catalogReferenceAliases(catalogs);
  const parent = exactByCardNumber(catalogs, 'races', 'RACE-0011');

  const lineages = GOLIATH_LINEAGE_CARDS.map((cardNumber) => {
    const lineage = exactByCardNumber(catalogs, 'races', cardNumber);
    return {
      cardNumber,
      isSubrace: lineage.is_subrace === true,
      parent: typeof lineage.parent_race_id === 'string'
        ? stableReference(lineage.parent_race_id, aliases, `${cardNumber}.parent_race_id`)
        : null,
      subraceLevel: Number(lineage.subrace_level ?? 1),
      relatedActions: stableReferenceList(lineage.related_actions, aliases, `${cardNumber}.related_actions`),
    };
  });

  const goliathActions = GOLIATH_ACTION_CARDS.map((cardNumber) => {
    const action = exactByCardNumber(catalogs, 'actions', cardNumber);
    return { cardNumber, mechanics: stableReferences(action.mechanics, aliases) };
  });

  const goliathEffects = GOLIATH_EFFECT_CARDS.map((cardNumber) => {
    const effect = exactByCardNumber(catalogs, 'effects', cardNumber);
    return { cardNumber, mechanics: stableReferences(effect.mechanics, aliases) };
  });

  const splitActions = [
    'action_basic_weapon',
    'action_basic_offhand',
    'action_basic_weapon_ranged',
  ].map((cardNumber) => {
    const action = exactByCardNumber(catalogs, 'actions', cardNumber);
    return { cardNumber, mechanics: stableReferences(action.mechanics, aliases) };
  });

  const startingEquipment = STARTING_EQUIPMENT_CLASS_CARDS.map((cardNumber) => {
    const characterClass = exactByCardNumber(catalogs, 'classes', cardNumber);
    return {
      cardNumber,
      options: stableEquipmentOptions(characterClass.equipment_options, aliases),
    };
  });

  const weaponProfiles = WEAPON_PROFILE_CARDS.map((cardNumber) => {
    const card = exactByCardNumber(catalogs, 'cards', cardNumber);
    return {
      cardNumber,
      weaponType: card.weapon_type ?? null,
      mastery: typeof card.mastery === 'string'
        ? stableReference(card.mastery, aliases, `${cardNumber}.mastery`)
        : null,
      range: card.range ?? null,
      profile: (() => {
        const profile = stableReferences(
          record(card.mechanics).weapon_profile,
          aliases,
          `${cardNumber}.mechanics.weapon_profile`,
        ) as JsonRecord;
        return {
          ...profile,
          ...(Array.isArray(profile.properties)
            ? { properties: [...profile.properties].sort() }
            : {}),
        };
      })(),
    };
  });

  const potionConsumption = POTION_CARDS.flatMap((cardNumber) => {
    const matches = catalogs.cards.filter((card) => card.card_number === cardNumber);
    return matches.length === 0 ? [] : [{
      cardNumber,
      activation: stableReferences(record(matches[0].mechanics).activation, aliases),
    }];
  });

  return {
    boundary: POST_MIGRATION_CATALOG_BOUNDARY,
    goliath: {
      parent: String(parent.card_number),
      lineages,
      actions: goliathActions,
      effects: goliathEffects,
    },
    splitWeaponActions: splitActions,
    startingEquipment,
    weaponProfiles,
    potionConsumption,
  };
}
