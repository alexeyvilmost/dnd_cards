import { describe, expect, it } from 'vitest';
import { materializeMicroMvpL1ContentPatch } from './declarativeMechanicsPatch';
import {
  POST_SNAPSHOT_CATALOG_PROJECTION,
  PostSnapshotCatalogProjectionError,
  assertPostSnapshotCatalogProjection,
  projectPostSnapshotCatalogsThrough115,
} from './postSnapshotCatalogProjection';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import { readProdSnapshotCatalogs, type SnapshotCatalogs } from './prodSnapshotL1Fixtures';

function projectedCatalogs(): SnapshotCatalogs {
  const release = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
  return projectPostSnapshotCatalogsThrough115(release);
}

function cardNumbersForOption(
  catalogs: SnapshotCatalogs,
  option: { items: Array<{ card_id: string; quantity: number }> },
): Array<[string | undefined, number]> {
  const byId = new Map(catalogs.cards.map((card) => [card.id, card.card_number]));
  return option.items.map((item) => [byId.get(item.card_id), item.quantity]);
}

function hasPayloadKind(mechanics: unknown, kind: string): boolean {
  const root = mechanics && typeof mechanics === 'object' ? mechanics as Record<string, unknown> : {};
  return (Array.isArray(root.effects) ? root.effects : []).some((effect) => {
    const interaction = effect && typeof effect === 'object'
      ? effect as Record<string, unknown>
      : {};
    const payloads = interaction.result ?? interaction.results;
    return (Array.isArray(payloads) ? payloads : []).some((payload) => (
      payload && typeof payload === 'object'
      && (payload as Record<string, unknown>).kind === kind
    ));
  });
}

describe('post-snapshot structural catalog projection', () => {
  it('is explicitly versioned through every production migration 107–115', () => {
    expect(POST_SNAPSHOT_CATALOG_PROJECTION).toEqual({
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
    });
  });

  it('projects canonical Goliath authority and repaired Ranger equipment by stable identity', () => {
    const catalogs = projectedCatalogs();
    assertPostSnapshotCatalogProjection(catalogs);

    const goliath = catalogs.races.find((race) => race.card_number === 'RACE-0011')!;
    const canonicalLineages = catalogs.races.filter((race) => (
      race.parent_race_id === goliath.id && race.card_number.startsWith('RACE-0011-')
    ));
    expect(canonicalLineages.map((race) => race.card_number).sort()).toEqual([
      'RACE-0011-cloud', 'RACE-0011-fire', 'RACE-0011-frost',
      'RACE-0011-hill', 'RACE-0011-stone', 'RACE-0011-storm',
    ]);
    expect(catalogs.races.some((race) => race.card_number === 'sub-stone')).toBe(false);

    const stone = canonicalLineages.find((race) => race.card_number === 'RACE-0011-stone')!;
    const stoneAction = catalogs.actions.find((action) => action.card_number === 'ACT-goliath-stone')!;
    expect(stone.related_actions).toEqual([stoneAction.id]);
    expect(stoneAction.mechanics).toMatchObject({
      activation: { mode: 'reaction', trigger: { event: 'damage_taken', timing: 'before' } },
      targeting: { domain: 'actor', actor_targets: false, shape: 'self' },
    });
    expect(() => compileDeclaredMechanicsTargeting(
      stoneAction.mechanics as Record<string, unknown>,
    )).not.toThrow();
    expect(hasPayloadKind(stoneAction.mechanics, 'reduce_damage')).toBe(true);
    expect((stone.related_effects ?? []).filter((reference) => {
      const effect = catalogs.effects.find((candidate) => (
        candidate.id === reference || candidate.card_number === reference
      ));
      return effect && hasPayloadKind(effect.mechanics, 'reduce_damage');
    })).toEqual([]);

    const ranger = catalogs.classes.find((klass) => klass.card_number === 'CLASS-ranger')!;
    expect(cardNumbersForOption(
      catalogs,
      ranger.equipment_options!.option_a as {
        items: Array<{ card_id: string; quantity: number }>;
      },
    )).toEqual([
      ['CARD-0276', 1], ['CARD-0311', 1], ['CARD-0294', 1], ['CARD-0327', 1],
      ['CARD-0728', 20], ['CARD-0729', 1], ['CARD-0827', 1], ['CARD-0806', 1],
    ]);
    const arrow = catalogs.cards.find((card) => card.card_number === 'CARD-0728')!;
    expect(catalogs.cards.find((card) => card.card_number === 'CARD-0327')).toMatchObject({
      weapon_type: 'longbow',
      range: '150/600',
      mechanics: { weapon_profile: { ammo: { card_id: arrow.id } } },
    });
    expect([
      ['CARD-0485', 'greatsword'], ['CARD-0490', 'shortbow'], ['CARD-0492', 'dagger'],
      ['CARD-0564', 'handaxe'], ['CARD-0567', 'sickle'], ['CARD-0570', 'light_crossbow'],
    ].map(([cardNumber]) => {
      const card = catalogs.cards.find((candidate) => candidate.card_number === cardNumber)!;
      return [
        card.card_number,
        (card.mechanics?.weapon_profile as Record<string, unknown> | undefined)?.weapon_type,
      ];
    })).toEqual([
      ['CARD-0485', 'greatsword'], ['CARD-0490', 'shortbow'], ['CARD-0492', 'dagger'],
      ['CARD-0564', 'handaxe'], ['CARD-0567', 'sickle'], ['CARD-0570', 'light_crossbow'],
    ]);

    const raw = readProdSnapshotCatalogs();
    const rawForest = raw.races.find((race) => race.card_number === 'sub-forest')!;
    const rawForestParent = raw.races.find((race) => race.id === rawForest.parent_race_id)!;
    expect(rawForest.source).toBeNull();
    expect(rawForestParent.source).toEqual(expect.any(String));
    expect(catalogs.races.find((race) => race.card_number === 'sub-forest')?.source)
      .toBe(rawForestParent.source);
  });

  it('mirrors migration 107 spell identity guards and certification invalidation', () => {
    const release = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const klass = release.classes.find((candidate) => !candidate.is_subclass)!;
    const [unlocked, locked, stableToken] = release.spells.slice(0, 3);
    const previousSupport = {
      status: 'verified_mechanical', mechanics_locked: false,
      content_hash: 'sha256:content', dependency_hash: 'sha256:dependency',
      certified_at: '2026-08-01T00:00:00Z', certification_version: 'old-v1',
      evidence_id: 'kept-evidence',
    };
    Object.assign(unlocked, {
      classes: [klass.name], mechanics: { activation: { mode: 'active' }, effects: [] },
      support: previousSupport,
    });
    Object.assign(locked, {
      classes: [klass.name], mechanics: { activation: { mode: 'active' }, effects: [] },
      support: { ...previousSupport, mechanics_locked: true },
    });
    Object.assign(stableToken, {
      classes: [klass.card_number], mechanics: { activation: { mode: 'active' }, effects: [] },
      support: previousSupport,
    });

    const catalogs = projectPostSnapshotCatalogsThrough115(release);
    const projectedUnlocked = catalogs.spells.find((spell) => spell.id === unlocked.id)!;
    const projectedLocked = catalogs.spells.find((spell) => spell.id === locked.id)!;
    const projectedStableToken = catalogs.spells.find((spell) => spell.id === stableToken.id)!;
    expect(projectedUnlocked.mechanics).toMatchObject({
      spell_class_list_ids: [klass.card_number],
    });
    expect(projectedUnlocked.support).toEqual({
      status: 'verified_mechanical', mechanics_locked: false,
      evidence_id: 'kept-evidence',
      note: 'Legacy localized class lists normalized to stable class ids; certification must be refreshed.',
    });
    expect(projectedLocked.mechanics).not.toHaveProperty('spell_class_list_ids');
    expect(projectedLocked.support).toEqual({ ...previousSupport, mechanics_locked: true });
    expect(projectedStableToken.mechanics).not.toHaveProperty('spell_class_list_ids');
  });

  it('preserves migration 116 half-caster mechanics owned by content patch 1.8.0', () => {
    const release = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const expected = [
      {
        id: 'ab0c1d14-d8ef-4d0d-9952-b26e2f862b5c',
        cardNumber: 'EFF-paladin-spellcasting',
        ability: 'cha',
      },
      {
        id: 'c4d0a9b1-90e8-49d4-8201-fc0aff542ae6',
        cardNumber: 'EFF-ranger-spellcasting',
        ability: 'wis',
      },
    ] as const;
    const projected = projectPostSnapshotCatalogsThrough115(release);

    for (const identity of expected) {
      const matches = release.effects.filter((effect) => (
        effect.id === identity.id || effect.card_number === identity.cardNumber
      ));
      expect(matches, identity.cardNumber).toHaveLength(1);
      expect(matches[0]).toMatchObject({ id: identity.id, card_number: identity.cardNumber });
      const interactions = (matches[0].mechanics as { effects?: Array<Record<string, unknown>> }).effects ?? [];
      const firstResults = interactions[0]?.result;
      const payloads = Array.isArray(firstResults) ? firstResults : [];
      expect(payloads.filter((payload) => (
        payload.kind === 'spellcasting_ability'
        && payload.role === 'primary'
        && payload.ability === identity.ability
      )), identity.cardNumber).toHaveLength(1);
      expect(projected.effects.find((effect) => effect.id === identity.id)?.mechanics)
        .toEqual(matches[0].mechanics);
    }

    expect(POST_SNAPSHOT_CATALOG_PROJECTION.migrations).not.toContain(
      '116_repair_half_caster_spellcasting_contract',
    );
  });

  it('is idempotent and fails closed on split stable identities', () => {
    const once = projectedCatalogs();
    expect(projectPostSnapshotCatalogsThrough115(once)).toEqual(once);

    const duplicate = structuredClone(once);
    duplicate.cards.push({ ...duplicate.cards[0], id: 'duplicate-card-id', card_number: 'CARD-0728' });
    expect(() => projectPostSnapshotCatalogsThrough115(duplicate))
      .toThrowError(PostSnapshotCatalogProjectionError);
    expect(() => projectPostSnapshotCatalogsThrough115(duplicate))
      .toThrow(/cards:CARD-0728: expected one stable identity, got 2/);
  });

  it('fails the catalog gate when Stone self-targeting contradicts the strict compiler', () => {
    const catalogs = projectedCatalogs();
    const stone = catalogs.actions.find((action) => action.card_number === 'ACT-goliath-stone')!;
    const mechanics = stone.mechanics as Record<string, unknown>;
    (mechanics.targeting as Record<string, unknown>).actor_targets = true;
    expect(() => assertPostSnapshotCatalogProjection(catalogs)).toThrow(
      /ACT-goliath-stone: strict targeting compilation failed: targeting.domain contradicts targeting.actor_targets/,
    );
  });

  it('resolves the manifest Stone Ranger browser root only from the projected catalog', async () => {
    const manifestUrl = new URL('../../../scripts/content/mini-mvp-manifest.mjs', import.meta.url);
    const { MINI_MVP_MANIFEST } = await import(/* @vite-ignore */ manifestUrl.href) as {
      MINI_MVP_MANIFEST: {
        collections: {
          classes: Array<{ selector: { cardNumber: string } }>;
          species: Array<{
            selector: { cardNumber: string };
            expected?: { variantSelectors?: Array<{ cardNumber: string }> };
          }>;
        };
      };
    };
    const catalogs = projectedCatalogs();
    expect(MINI_MVP_MANIFEST.collections.classes.some((entry) => (
      entry.selector.cardNumber === 'CLASS-ranger'
    ))).toBe(true);
    const goliathManifest = MINI_MVP_MANIFEST.collections.species.find((entry) => (
      entry.selector.cardNumber === 'RACE-0011'
    ));
    expect(goliathManifest?.expected?.variantSelectors).toContainEqual({
      cardNumber: 'RACE-0011-stone',
      label: expect.any(String),
    });
    const ranger = catalogs.classes.filter((klass) => klass.card_number === 'CLASS-ranger');
    const goliath = catalogs.races.filter((race) => race.card_number === 'RACE-0011');
    const stone = catalogs.races.filter((race) => race.card_number === 'RACE-0011-stone');
    expect(ranger).toHaveLength(1);
    expect(goliath).toHaveLength(1);
    expect(stone).toHaveLength(1);
    expect(stone[0].parent_race_id).toBe(goliath[0].id);
  });
});
