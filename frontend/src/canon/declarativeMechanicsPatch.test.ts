import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertMicroMvpL1ContentMaterialized,
  DeclarativeContentPatchError,
  materializeMicroMvpL1ContentPatch,
  MICRO_MVP_L1_CONTENT_PATCH,
} from './declarativeMechanicsPatch';
import {
  assertMicroMvpL1OverlayReady,
  compileMicroMvpL1MaterializedCatalogs,
  compileMicroMvpL1Overlay,
  PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
} from './microMvpL1Overlay';
import { readProdSnapshotCatalogs } from './prodSnapshotL1Fixtures';
import { canonicalStringify } from '../rules-core/determinism';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function readReviewedPreimageCatalogs(): ReturnType<typeof readProdSnapshotCatalogs> {
  const rawFixture = readFileSync(new URL(
    '../../../scripts/content/testdata/micro-mvp-l1-reviewed-preimage.v1.json',
    import.meta.url,
  ));
  const fixtureHash = `sha256:${createHash('sha256').update(rawFixture).digest('hex')}`;
  if (fixtureHash !== 'sha256:029ab1bb4b8ff2d9b3f19fecbbf0746472c5bd9e2511b729bc1c50169914ec27') {
    throw new Error(`Reviewed preimage fixture hash mismatch: ${fixtureHash}`);
  }
  const fixture = JSON.parse(rawFixture.toString('utf8')) as {
    catalogs: Pick<
      ReturnType<typeof readProdSnapshotCatalogs>,
      'effects' | 'actions' | 'spells' | 'races' | 'classes' | 'cards'
    >;
  };
  return {
    backgrounds: [],
    feats: [],
    resources: [],
    variables: [],
    ...fixture.catalogs,
  };
}

describe('versioned declarative micro-MVP L1 content patch', () => {
  it('owns every migrated rule as JSON data rather than entity branches in the compiler', () => {
    expect(MICRO_MVP_L1_CONTENT_PATCH).toMatchObject({
      schemaVersion: 1,
      patchId: 'dnd5e-2024.micro-mvp-l1.content-patch.v1',
      authorityTarget: 'database-entity-mechanics',
    });
    expect(MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects).toHaveLength(34);
    expect(MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.actions).toHaveLength(9);
    expect(MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.spells).toHaveLength(26);
    expect(MICRO_MVP_L1_CONTENT_PATCH.fieldPatches).toHaveLength(21);
    expect(MICRO_MVP_L1_CONTENT_PATCH.conditionPatches).toHaveLength(15);
    expect(MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((item) => item.cardNumber))
      .toEqual(expect.arrayContaining(['COND-exhaustion', 'COND-petrified', 'COND-unconscious']));
    const conditionIds = MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((item) => (
      (item.fields.mechanics as { condition?: { id?: string } }).condition?.id
    ));
    expect(conditionIds).toHaveLength(15);
    expect(conditionIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(conditionIds).size).toBe(15);
    for (const declaration of MICRO_MVP_L1_CONTENT_PATCH.conditionPatches) {
      expect((declaration.createFields.mechanics as { condition?: { id?: string } }).condition?.id)
        .toBe((declaration.fields.mechanics as { condition?: { id?: string } }).condition?.id);
    }
    const blindedMechanics = MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.find((item) => (
      item.cardNumber === 'COND-blinded'
    ))?.fields.mechanics as { world_facts?: Record<string, unknown> } | undefined;
    const unconsciousMechanics = MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.find((item) => (
      item.cardNumber === 'COND-unconscious'
    ))?.fields.mechanics as { world_facts?: Record<string, unknown> } | undefined;
    expect(blindedMechanics?.world_facts).toMatchObject({ cannot_see: true });
    expect(unconsciousMechanics?.world_facts).toMatchObject({
      drops_held_items: true,
      unaware_of_surroundings: true,
    });
    for (const cardNumber of ['ACT-breath-acid', 'ACT-breath-cold', 'ACT-breath-fire', 'ACT-breath-lightning', 'ACT-breath-poison']) {
      expect(MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.actions.find((item) => (
        item.cardNumber === cardNumber
      ))?.mechanics.attack_replacement).toMatchObject({
        replacement_key: 'dragonborn:breath-weapon',
        replaces_attacks: 1,
        total_attacks: 1,
        once_per_attack_action: true,
      });
    }
    const fightingStyles = MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects.filter((item) => (
      (item.mechanics as { fighting_style?: unknown }).fighting_style !== undefined
    ));
    expect(fightingStyles).toHaveLength(4);
    expect(fightingStyles.map((item) => (
      (item.mechanics as { fighting_style: { id: string } }).fighting_style.id
    )).sort()).toEqual(['archery', 'defense', 'protection', 'two_weapon_fighting']);
    const spellcastingAbilities = Object.fromEntries(
      MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects.flatMap((item) => {
        const payloads = ((item.mechanics.effects as Array<{
          result?: Array<Record<string, unknown>>;
        }> | undefined)?.flatMap((effect) => effect.result ?? []) ?? []);
        const declaration = payloads.find((payload) => (
          payload.kind === 'spellcasting_ability' && payload.role === 'primary'
        ));
        return declaration ? [[item.cardNumber, declaration.ability]] : [];
      }),
    );
    expect(spellcastingAbilities).toEqual({
      'EFF-cleric-spellcasting': 'wis',
      'EFF-druid-spellcasting': 'wis',
      'EFF-sorcerer-spellcasting': 'cha',
      'EFF-warlock-spellcasting': 'cha',
      'EFF-wizard-spellcasting': 'int',
    });
    const executableEntities = [
      ...MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects,
      ...MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.actions,
      ...MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.spells,
    ].filter((item) => {
      const activation = item.mechanics.activation as { mode?: string } | undefined;
      return activation?.mode === 'active' || activation?.mode === 'reaction';
    });
    for (const entity of executableEntities) {
      const activation = entity.mechanics.activation as { cost?: unknown };
      const targeting = entity.mechanics.targeting as Record<string, unknown> | undefined;
      expect(Array.isArray(activation.cost), `${entity.cardNumber}: explicit cost`).toBe(true);
      const fightingStyle = entity.mechanics.fighting_style as { mode?: string } | undefined;
      if (fightingStyle?.mode === 'reaction_capability') continue;
      expect(targeting, `${entity.cardNumber}: explicit targeting`).toBeDefined();
      for (const key of [
        'domain', 'actor_targets', 'shape', 'min_targets', 'max_targets',
        'range_ft', 'requires_line_of_sight', 'allowed_relations',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(targeting ?? {}, key),
          `${entity.cardNumber}: targeting.${key}`).toBe(true);
      }
    }
    for (const spell of MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.spells) {
      const classIds = spell.mechanics.spell_class_list_ids;
      expect(Array.isArray(classIds), `${spell.cardNumber}: stable class lists`).toBe(true);
      expect(classIds, `${spell.cardNumber}: stable class lists`).not.toHaveLength(0);
      expect(new Set(classIds as unknown[]).size, `${spell.cardNumber}: unique class lists`)
        .toBe((classIds as unknown[]).length);
    }
    const wizardSpellcasting = MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects.find((item) => (
      item.cardNumber === 'EFF-wizard-spellcasting'
    ))!;
    expect((wizardSpellcasting.mechanics.effects as Array<Record<string, unknown>>).find((effect) => (
      effect.kind === 'prepared_spell_choice'
    ))).toMatchObject({
      id: 'wizard_prepared_spells_level_1',
      count: 4,
      source_choice_id: 'wizard_spellbook_level_1',
      resolution: 'on_acquire',
    });
    const magicInitiate = MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.effects.find((item) => (
      item.cardNumber === 'magic_initiate_wizard'
    ))!;
    const magicInitiatePayloads = (magicInitiate.mechanics.effects as Array<
      Record<string, unknown> & { result?: Array<Record<string, unknown>> }
    >).flatMap((effect) => [effect, ...(effect.result ?? [])]);
    expect(magicInitiatePayloads.find((payload) => (
      payload.id === 'magic_initiate_wizard_level_1'
    ))).toMatchObject({ grant: { kind: 'grant_spell', label: 'always_prepared' } });
    expect(MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.actions.find((item) => (
      item.cardNumber === 'ACTION-0001'
    ))?.mechanics.rest_decision).toMatchObject({
      kind: 'slot_recovery',
      decision_type: 'arcane_recovery',
      level_source: { kind: 'class_level', class_id: 'wizard' },
      slot_resource: { prefix: 'spell_slot_', minimum_level: 1, maximum_level: 5 },
    });
    for (const cardNumber of ['SPELL-0174', 'SPELL-0286']) {
      const mechanics = MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.spells.find((item) => (
        item.cardNumber === cardNumber
      ))?.mechanics as { targeting?: { requires_sight?: boolean } } | undefined;
      expect(mechanics?.targeting?.requires_sight).toBe(true);
    }
    expect(MICRO_MVP_L1_CONTENT_PATCH.createEntities.map((item) => item.entity.card_number))
      .toEqual([
        'EFF-invoc-armor_of_shadows',
        'EFF-invoc-eldritch_mind',
        'EFF-rogue-thieves-cant',
      ]);
    const harmful = [
      ...MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.actions,
      ...MICRO_MVP_L1_CONTENT_PATCH.mechanicsPatches.spells,
    ].filter((item) => item.mechanics.interaction && (
      item.mechanics.interaction as { intent?: string }
    ).intent === 'harmful');
    expect(harmful).toHaveLength(14);
    expect(harmful.map((item) => item.cardNumber).sort()).toEqual([
      'ACT-breath-acid',
      'ACT-breath-cold',
      'ACT-breath-fire',
      'ACT-breath-lightning',
      'ACT-breath-poison',
      'SPELL-0171',
      'SPELL-0174',
      'SPELL-0218',
      'SPELL-0229',
      'SPELL-0242',
      'SPELL-0286',
      'chill_touch',
      'fire_bolt',
      'poison_spray',
    ]);
    expect(`sha256:${createHash('sha256')
      .update(canonicalStringify(MICRO_MVP_L1_CONTENT_PATCH))
      .digest('hex')}`)
      .toBe(PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH);
  });

  it('materializes raw snapshot data once and is then a strict no-op', () => {
    const raw = readReviewedPreimageCatalogs();
    expect(() => assertMicroMvpL1ContentMaterialized(raw))
      .toThrow(DeclarativeContentPatchError);

    const first = materializeMicroMvpL1ContentPatch(raw);
    expect(first.changes).toHaveLength(108);
    expect(first.alreadyMaterialized).toHaveLength(0);

    const second = materializeMicroMvpL1ContentPatch(first.catalogs);
    expect(second.changes).toHaveLength(0);
    expect(second.alreadyMaterialized).toHaveLength(108);
    expect(() => assertMicroMvpL1ContentMaterialized(second.catalogs)).not.toThrow();
  });

  it('fails closed when source mechanics drift instead of overwriting them', () => {
    const raw = readProdSnapshotCatalogs();
    const alert = raw.effects.find((effect) => effect.card_number === 'EFF-alert')!;
    alert.mechanics = { activation: { mode: 'passive' }, effects: [], drift: true };
    expect(() => materializeMicroMvpL1ContentPatch(raw)).toThrow(/EFF-alert: expected mechanics/);
  });

  it('fails closed in production verify-only mode when a caster primitive is absent', async () => {
    const materialized = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const wizard = materialized.effects.find((effect) => (
      effect.card_number === 'EFF-wizard-spellcasting'
    ))!;
    const mechanics = wizard.mechanics as {
      effects: Array<{ result?: Array<Record<string, unknown>> }>;
    };
    mechanics.effects[0].result = (mechanics.effects[0].result ?? []).filter((payload) => (
      payload.kind !== 'spellcasting_ability'
    ));

    await expect(compileMicroMvpL1MaterializedCatalogs(materialized))
      .rejects.toThrow(/EFF-wizard-spellcasting: expected mechanics/);
  });

  it('does not accept a pre-existing declared entity by mechanics alone', () => {
    const materialized = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const armor = materialized.effects.find((effect) => (
      effect.card_number === 'EFF-invoc-armor_of_shadows'
    ))!;
    armor.name = 'Wrong production row';
    expect(() => materializeMicroMvpL1ContentPatch(materialized))
      .toThrow(/EFF-invoc-armor_of_shadows: declared entity exists with different fields/);
  });

  it('accepts a server-assigned UUID for a fully matching created entity', () => {
    const materialized = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const armor = materialized.effects.find((effect) => (
      effect.card_number === 'EFF-invoc-armor_of_shadows'
    ))!;
    armor.id = '11111111-1111-4111-8111-111111111111';
    armor.created_at = '2030-01-02T03:04:05.000Z';
    armor.updated_at = '2030-01-02T03:04:06.000Z';
    expect(() => assertMicroMvpL1ContentMaterialized(materialized)).not.toThrow();
  });

  it('consumes the materialized Rogue progression relation without a pinned effect UUID branch', async () => {
    const materialized = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const thievesCant = materialized.effects.find((effect) => (
      effect.card_number === 'EFF-rogue-thieves-cant'
    ))!;
    const declaredEntityId = thievesCant.id;
    thievesCant.id = '22222222-2222-4222-8222-222222222222';

    expect(() => assertMicroMvpL1ContentMaterialized(materialized)).not.toThrow();
    const provider = await compileMicroMvpL1MaterializedCatalogs(materialized);
    const rogueRoots = provider.roots.filter((root) => (
      root.matrixCase.klass.card_number === 'CLASS-rogue'
    ));
    expect(rogueRoots).toHaveLength(64);
    for (const root of rogueRoots) {
      const projection = root.assembled.effects.find(({ effect }) => (
        effect.card_number === 'EFF-rogue-thieves-cant'
      ));
      expect(projection?.effect.id).toBe(thievesCant.id);
      expect(root.assembled.effects.some(({ effect }) => effect.id === declaredEntityId)).toBe(false);
    }
  });

  it('compiles an already materialized catalog through verify-only mode', async () => {
    const raw = readProdSnapshotCatalogs();
    const materialized = materializeMicroMvpL1ContentPatch(copy(raw)).catalogs;
    const [legacy, direct] = await Promise.all([
      compileMicroMvpL1Overlay(),
      compileMicroMvpL1MaterializedCatalogs(materialized),
    ]);

    assertMicroMvpL1OverlayReady(direct);
    expect(direct.release).toEqual(legacy.release);
    expect(direct.roots.map((root) => root.fixtureId))
      .toEqual(legacy.roots.map((root) => root.fixtureId));
  }, 60_000);
});
