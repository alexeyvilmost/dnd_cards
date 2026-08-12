import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import { freeuseKey } from '../engine/freeuse';
import { choiceInstanceId, passiveSourceId } from '../mechanics/expandChoices';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import type { PassiveEffect, Spell } from '../types';
import { collectSheetActions } from './actionSheet';
import { assemble, type AssembledCharacter } from './assemble';
import { buildSavePayload, characterToDraft } from './forgeHelpers';
import { buildCharacterContext } from './runtime';
import { syncRuntimeResources } from './resourceInit';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import { emptyDraft, type CharacterDraft, type ForgeCharacter } from './types';

type RepairVariant = {
  feat: { id: string; cardNumber: string };
  effect: { id: string; cardNumber: string };
  spellList: string;
  mechanics: Record<string, unknown>;
};

const REPAIR = JSON.parse(readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../backend/migrations/data/repair_magic_initiate_2024.v1.json',
), 'utf8')) as { variants: RepairVariant[] };

const catalogs = readProdSnapshotCatalogs();
const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Missing production fixture ${label}`);
  return value;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fixture(input: {
  effectCard: string;
  ability: 'int' | 'wis' | 'cha';
  cantrips: [string, string];
  levelOne: string;
}): {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  effect: PassiveEffect;
  spells: Spell[];
} {
  const variant = required(
    REPAIR.variants.find((candidate) => candidate.effect.cardNumber === input.effectCard),
    input.effectCard,
  );
  const feat = required(catalogs.feats.find((candidate) => candidate.id === variant.feat.id), variant.feat.cardNumber);
  const originalEffect = required(
    catalogs.effects.find((candidate) => candidate.id === variant.effect.id),
    variant.effect.cardNumber,
  );
  const effect = { ...clone(originalEffect), mechanics: clone(variant.mechanics) };
  const origin = { kind: 'feat' as const, id: feat.id, name: feat.name };
  const sourceId = passiveSourceId(origin, effect);
  const rawPrefix = input.effectCard === 'magic_initiate_cleric'
    ? 'magic_initiate_cleric'
    : 'magic_initiate_druid';
  const spells = [...input.cantrips, input.levelOne].map((cardNumber) => required(
    catalogs.spells.find((candidate) => candidate.card_number === cardNumber),
    cardNumber,
  ));
  const draft: CharacterDraft = {
    ...emptyDraft(),
    name: `Magic Initiate ${variant.spellList}`,
    raceId: required(catalogs.races.find((candidate) => candidate.card_number === 'RACE-0002'), 'Human').id,
    classId: required(catalogs.classes.find((candidate) => candidate.card_number === 'CLASS-warrior'), 'Fighter').id,
    backgroundId: required(catalogs.backgrounds.find((candidate) => candidate.card_number === 'BG-0009'), 'Acolyte').id,
    featIds: [feat.id],
    swapFeat: true,
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
    abilityBonuses: { mode: 'two_one', assignments: { wis: 2, int: 1 }, anyAbilities: false },
    classSkillChoices: ['athletics', 'perception'],
    spellIds: spells.map((spell) => spell.id),
    resolvedChoices: {
      [choiceInstanceId(sourceId, `${rawPrefix}_spellcasting_ability`)]: [input.ability],
      [choiceInstanceId(sourceId, `${rawPrefix}_cantrips`)]: spells.slice(0, 2).map((spell) => spell.id),
      [choiceInstanceId(sourceId, `${rawPrefix}_level_1`)]: [spells[2].id],
    },
  };
  const assembled = assemble({
    race: required(catalogs.races.find((candidate) => candidate.id === draft.raceId), 'Human'),
    klass: required(catalogs.classes.find((candidate) => candidate.id === draft.classId), 'Fighter'),
    background: required(catalogs.backgrounds.find((candidate) => candidate.id === draft.backgroundId), 'Acolyte'),
    feats: [feat],
    effects: [{ effect, origin }],
    actions: [],
    spells,
    resources: catalogs.resources,
    variableDefs: catalogs.variables,
  }, draft);
  return { draft, assembled, effect, spells };
}

describe('production Magic Initiate 2024 repair', () => {
  it.each([
    {
      effectCard: 'magic_initiate_cleric', ability: 'wis' as const,
      cantrips: ['SPELL-0286', 'light'] as [string, string], levelOne: 'SPELL-0236',
    },
    {
      effectCard: 'EFFECT-0006', ability: 'cha' as const,
      cantrips: ['druidcraft', 'poison_spray'] as [string, string], levelOne: 'SPELL-0214',
    },
  ])('resolves $effectCard entirely from Effect choices and grants', (input) => {
    const root = fixture(input);
    const rules = resolveCharacterRules(root);
    const spellGrants = rules.appliedGrants.filter((grant) => grant.kind === 'spell');

    expect(spellGrants).toHaveLength(3);
    expect(spellGrants.every((grant) => grant.spellcastingAbility === input.ability)).toBe(true);
    expect(spellGrants.filter((grant) => grant.label === 'cantrip')).toHaveLength(2);
    expect(spellGrants.find((grant) => grant.value === root.spells[2].id)).toMatchObject({
      label: 'always_prepared',
      freeuse: { count: 1, recharge: 'long_rest' },
      source: { type: 'feat', originEntityId: root.assembled.feats[0].id, featureEntityId: root.effect.id },
    });
    expect(rules.freeuseSpells).toEqual([{
      spell: root.spells[2].id, count: 1, recharge: 'long_rest',
    }]);
  });

  it('round-trips Pom’s Fighter/Acolyte build and enables Light plus both Detect Poison paths', () => {
    const root = fixture({
      effectCard: 'magic_initiate_cleric', ability: 'wis',
      cantrips: ['SPELL-0286', 'light'], levelOne: 'SPELL-0236',
    });
    const firstRules = resolveCharacterRules(root);
    const saved = buildSavePayload(root.draft, root.assembled, firstRules);
    const reloadedDraft = characterToDraft({
      ...saved,
      id: 'pom-round-trip', user_id: 'pom-owner', access_mode: 'owner',
      system_id: saved.system_id!, ruleset_version: saved.ruleset_version!,
      character_type: saved.character_type!, character_schema_version: saved.character_schema_version!,
      level: saved.level!, max_hp: saved.max_hp!, current_hp: saved.current_hp!,
      speed: saved.speed!, proficiency_bonus: saved.proficiency_bonus!,
      created_at: '', updated_at: '',
    } as ForgeCharacter);
    const reloaded = assemble({
      race: root.assembled.race,
      klass: root.assembled.klass,
      background: root.assembled.background,
      feats: root.assembled.feats,
      effects: root.assembled.effects,
      actions: [],
      spells: root.spells,
      resources: catalogs.resources,
      variableDefs: catalogs.variables,
    }, reloadedDraft);
    const rules = resolveCharacterRules({ draft: reloadedDraft, assembled: reloaded });
    const ctx = buildCharacterContext(rules, reloadedDraft, [], reloaded.klass);
    const pools = syncRuntimeResources(ctx, reloaded, undefined, rules.freeuseSpells);
    const sheetActions = collectSheetActions(reloaded).filter((action) => action.group === 'spell');
    const canonical = buildSheetCanonicalRuntime({
      character: {
        id: 'pom-round-trip', name: 'Пом', system_id: 'dnd5e-2024', ruleset_version: '2024',
        turn_state: null, resolved_choices: saved.resolved_choices, currency: {},
        resources: pools.resources, max_resources: pools.maxResources,
      },
      assembled: reloaded,
      ruleState: rules,
      sheetActions,
      runtime: {
        hp: { current: rules.maxHP, max: rules.maxHP, temp: 0 },
        resources: pools.resources,
        maxResources: pools.maxResources,
        equipment: {}, inventory: [], activeEffects: [], firedThisTurn: [], firedThisRest: [],
      },
      characterContext: ctx,
      cards: [],
      ac: rules.armorClass,
    });
    const byCard = (cardNumber: string) => required(
      sheetActions.find((action) => action.spellRef?.card_number === cardNumber),
      cardNumber,
    );
    const access = canonical.world.actors[canonical.actorId].spellcastingAccess!;
    const light = canonical.actionFor(byCard('light'));
    const sacredFlame = canonical.actionFor(byCard('SPELL-0286'));
    const detect = canonical.actionFor(byCard('SPELL-0236'));
    const detectGrant = required(access.grants.find((grant) => grant.actionId === detect.id), 'Detect Poison grant');

    for (const cantrip of [light, sacredFlame]) {
      expect(resolveSpellAccess({ state: access, actionId: cantrip.id, resources: pools.resources }))
        .toMatchObject({ status: 'allowed', payment: { kind: 'none' } });
    }
    expect(resolveSpellAccess({ state: access, actionId: detect.id, resources: pools.resources }))
      .toMatchObject({ status: 'allowed', payment: { kind: 'free_use', resource: freeuseKey(root.spells[2].id) } });
    expect(detectGrant).toMatchObject({
      access: 'always_prepared', spellcastingAbility: 'wis', ritual: true,
      freeUseResource: freeuseKey(root.spells[2].id),
    });
    expect(resolveSpellAccess({ state: access, actionId: detect.id, mode: 'ritual', resources: {} }))
      .toMatchObject({ status: 'allowed', payment: { kind: 'none' } });
  });
});
