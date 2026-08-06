import { beforeAll, describe, expect, it } from 'vitest';
import { parseWeaponProfile } from '../engine/weaponProfile';
import { pactBladeWeaponCardSnapshot } from '../rules-core/pactBladeRuntime';
import {
  materializeMicroMvpL1ContentPatch,
  MICRO_MVP_L1_CONTENT_PATCH,
} from './declarativeMechanicsPatch';
import { compileMicroMvpL1Overlay, type CompiledMicroMvpL1Provider } from './microMvpL1Overlay';
import { readProdSnapshotCatalogs, type SnapshotCatalogs } from './prodSnapshotL1Fixtures';

const REACHABLE_WEAPON_CARD_NUMBERS = [
  'CARD-0294',
  'CARD-0297',
  'CARD-0298',
  'CARD-0299',
  'CARD-0301',
  'CARD-0304',
  'CARD-0306',
  'CARD-0309',
  'CARD-0311',
  'CARD-0316',
  'CARD-0317',
  'CARD-0327',
] as const;

function collectReferencedStrings(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectReferencedStrings(entry, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.values(value as Record<string, unknown>)
    .forEach((entry) => collectReferencedStrings(entry, out));
}

describe('micro-MVP reachable weapon-profile gate', () => {
  let provider: CompiledMicroMvpL1Provider;
  let catalogs: SnapshotCatalogs;

  beforeAll(async () => {
    catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    provider = await compileMicroMvpL1Overlay();
  }, 60_000);

  it('covers every weapon referenced by all 448 compiled roots with one strict profile', () => {
    expect(provider.roots).toHaveLength(448);
    const cardById = new Map(catalogs.cards.map((card) => [card.id, card]));
    const referenced = new Set<string>();
    provider.roots.forEach((root) => {
      // A compiled character contains descriptive and legacy starting-equipment
      // snapshots that mention archival duplicate cards. Reachability is limited
      // to the reviewed class option surface plus materialized runtime state.
      collectReferencedStrings(root.assembled.klass?.equipment_options, referenced);
      root.actor.runtime.inventory.forEach((entry) => referenced.add(entry.cardId));
      Object.values(root.actor.runtime.equipment).forEach((id) => {
        if (id) referenced.add(id);
      });
    });
    const reachableWeapons = [...referenced]
      .flatMap((id) => cardById.get(id) ? [cardById.get(id)!] : [])
      .filter((card) => card.type === 'weapon');
    expect([...new Set(reachableWeapons.map((card) => card.card_number))].sort())
      .toEqual([...REACHABLE_WEAPON_CARD_NUMBERS].sort());

    for (const card of reachableWeapons) {
      const parsed = parseWeaponProfile(card);
      expect(parsed.valid, `${card.card_number}: ${(parsed as { issue?: string }).issue ?? ''}`).toBe(true);
    }
  });

  it('resolves every declared mastery and ammunition UUID to an exact catalog entity', () => {
    const effects = new Map(catalogs.effects.map((effect) => [effect.id, effect]));
    const cards = new Map(catalogs.cards.map((card) => [card.id, card]));
    for (const cardNumber of REACHABLE_WEAPON_CARD_NUMBERS) {
      const card = catalogs.cards.find((candidate) => candidate.card_number === cardNumber)!;
      const parsed = parseWeaponProfile(card);
      if (!parsed.valid) throw new Error(parsed.issue);
      expect(effects.get(parsed.profile.masteryEffectId)?.id).toBe(parsed.profile.masteryEffectId);
      if (parsed.profile.ammo) {
        expect(cards.get(parsed.profile.ammo.cardId)?.id).toBe(parsed.profile.ammo.cardId);
      }
    }
  });

  it('requires stable entityReferences for the profile UUIDs in every weapon patch', () => {
    const declarations = MICRO_MVP_L1_CONTENT_PATCH.fieldPatches.filter((entry) => (
      REACHABLE_WEAPON_CARD_NUMBERS.includes(
        entry.cardNumber as (typeof REACHABLE_WEAPON_CARD_NUMBERS)[number],
      )
    ));
    expect(declarations).toHaveLength(REACHABLE_WEAPON_CARD_NUMBERS.length);
    for (const declaration of declarations) {
      const profile = (declaration.fields.mechanics as Record<string, unknown>)
        .weapon_profile as Record<string, unknown>;
      const refs = new Set((declaration.entityReferences ?? []).map((entry) => entry.entityId));
      expect(refs.has(String(profile.mastery_effect_id)), declaration.cardNumber).toBe(true);
      const ammo = profile.ammo as { card_id?: string } | null;
      if (ammo) expect(refs.has(String(ammo.card_id)), declaration.cardNumber).toBe(true);
    }
  });

  it('projects the same parsed authority into Pact Blade without legacy category/tag inference', () => {
    for (const cardNumber of REACHABLE_WEAPON_CARD_NUMBERS) {
      const card = catalogs.cards.find((candidate) => candidate.card_number === cardNumber)!;
      const parsed = parseWeaponProfile(card);
      if (!parsed.valid) throw new Error(parsed.issue);
      const snapshot = pactBladeWeaponCardSnapshot(card);
      if (typeof snapshot === 'string') throw new Error(snapshot);
      expect(snapshot).toMatchObject({
        weaponType: parsed.profile.weaponType,
        category: parsed.profile.proficiencyCategory,
        range: parsed.profile.defaultAttackMode,
        normalDamageType: parsed.profile.damageLines[0].type,
        properties: [...parsed.profile.properties].sort(),
        tags: [],
        requiresAttunement: parsed.profile.attunement.required,
      });
    }
  });
});
