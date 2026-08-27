import { describe, expect, it } from 'vitest';
import { materializeMicroMvpL1ContentPatch } from '../canon/declarativeMechanicsPatch';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import type { Ability } from '../rules-core/domain';
import type { RuntimeState } from '../mvp/contracts';
import type { CharacterClass, PassiveEffect, Spell } from '../types';
import { collectSheetActions } from './actionSheet';
import { assemble, type EntityBundle } from './assemble';
import { buildCharacterContext } from './runtime';
import { syncRuntimeResources } from './resourceInit';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import { emptyDraft, type AbilityScores } from './types';

const catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;

function classEntity(cardNumber: string): CharacterClass {
  const matches = catalogs.classes.filter((candidate) => candidate.card_number === cardNumber);
  if (matches.length !== 1) throw new Error(`${cardNumber}: expected one class, got ${matches.length}`);
  return matches[0];
}

function spellcastingEffect(klass: CharacterClass, cardNumber: string): PassiveEffect {
  const matches = catalogs.effects.filter((candidate) => candidate.card_number === cardNumber);
  if (matches.length !== 1) throw new Error(`${cardNumber}: expected one effect, got ${matches.length}`);
  const effect = matches[0];
  if (!klass.level_progression?.['1']?.effects?.includes(effect.id)) {
    throw new Error(`${cardNumber}: class level 1 does not own the effect`);
  }
  return effect;
}

function levelOneClassSpells(classCardNumber: string): Spell[] {
  return catalogs.spells
    .filter((spell) => spell.level === 1)
    .filter((spell) => {
      const classIds = spell.mechanics?.spell_class_list_ids;
      return Array.isArray(classIds) && classIds.includes(classCardNumber);
    })
    .sort((left, right) => left.card_number.localeCompare(right.card_number))
    .slice(0, 2);
}

function halfCasterBuild(input: {
  classCardNumber: string;
  effectCardNumber: string;
  ability: Ability;
  abilities: AbilityScores;
}) {
  const klass = classEntity(input.classCardNumber);
  const effect = spellcastingEffect(klass, input.effectCardNumber);
  const origin = { kind: 'class' as const, id: klass.id, name: klass.name };
  const spells = levelOneClassSpells(input.classCardNumber);
  if (spells.length !== 2) throw new Error(`${input.classCardNumber}: expected two L1 spells`);
  const bundle = (selectedSpells: Spell[]): EntityBundle => ({
    race: null,
    klass,
    background: null,
    feats: [],
    effects: [{ effect, origin }],
    actions: [],
    spells: selectedSpells,
  });
  const draft = {
    ...emptyDraft(),
    classId: klass.id,
    level: 1,
    abilities: input.abilities,
  };
  const initial = assemble(bundle([]), draft);
  const spellChoice = initial.pendingChoices.find((choice) => (
    choice.origin.kind === 'class'
      && choice.origin.id === klass.id
      && choice.source === 'spell'
      && choice.grantKind === 'grant_spell'
  ));
  if (!spellChoice) throw new Error(`${input.classCardNumber}: class spell choice is absent`);
  draft.resolvedChoices = { [spellChoice.id]: spells.map((spell) => spell.id) };
  draft.spellIds = spells.map((spell) => spell.id);
  const assembled = assemble(bundle(spells), draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  const characterContext = buildCharacterContext(
    ruleState,
    { level: 1, abilities: draft.abilities as Record<string, number> },
    [],
    klass,
  );
  const resourceRuntime = syncRuntimeResources(
    characterContext,
    assembled,
    undefined,
    ruleState.freeuseSpells,
  );
  const runtime: RuntimeState = {
    hp: { current: ruleState.maxHP, max: ruleState.maxHP, temp: 0 },
    resources: resourceRuntime.resources,
    maxResources: resourceRuntime.maxResources,
    equipment: {},
    inventory: [],
    activeEffects: [],
    firedThisTurn: [],
    firedThisRest: [],
  };
  const sheetActions = collectSheetActions(assembled);
  const canonical = buildSheetCanonicalRuntime({
    character: {
      id: `sheet:${input.classCardNumber}`,
      name: input.classCardNumber,
      system_id: 'dnd5e-2024',
      ruleset_version: '2024',
      turn_state: null,
      resolved_choices: draft.resolvedChoices,
    },
    assembled,
    ruleState,
    sheetActions,
    runtime,
    characterContext,
    ac: ruleState.armorClass,
  });
  return { canonical, ruleState, sheetActions, spells, ability: input.ability };
}

describe('Paladin and Ranger Forge -> sheet spellcasting contract', () => {
  it.each([
    {
      classCardNumber: 'CLASS-paladin',
      effectCardNumber: 'EFF-paladin-spellcasting',
      ability: 'cha' as const,
      abilities: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 16 },
    },
    {
      classCardNumber: 'CLASS-ranger',
      effectCardNumber: 'EFF-ranger-spellcasting',
      ability: 'wis' as const,
      abilities: { str: 10, dex: 16, con: 14, int: 8, wis: 16, cha: 12 },
    },
  ])('$classCardNumber compiles selected spells into slot-paying sheet actions', (fixture) => {
    const built = halfCasterBuild(fixture);
    expect(built.ruleState.spellcasting?.ability).toBe(built.ability);
    expect(built.ruleState.spellcasting?.saveDC).toBe(13);
    const access = built.canonical.world.actors[built.canonical.actorId].spellcastingAccess;
    const grants = access?.grants.filter((grant) => grant.sourceId === fixture.classCardNumber) ?? [];
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => (
      grant.access === 'always_prepared'
        && grant.spellcastingAbility === built.ability
        && grant.slotResource === 'spell_slot_1'
    ))).toBe(true);
    expect(built.canonical.world.actors[built.canonical.actorId].runtime.resources.spell_slot_1)
      .toBe(2);

    for (const grant of grants) {
      expect(resolveSpellAccess({
        state: access!,
        actionId: grant.actionId,
        grantId: grant.grantId,
        resources: { spell_slot_1: 2 },
      })).toMatchObject({ status: 'allowed', payment: { kind: 'slot', resource: 'spell_slot_1' } });
      const sheetAction = built.sheetActions.find((candidate) => (
        candidate.spellRef && grant.actionId.includes(candidate.spellRef.id)
      ));
      expect(sheetAction, grant.actionId).toBeDefined();
      expect(built.canonical.actionFor(sheetAction!)).toMatchObject({
        id: grant.actionId,
        kind: 'spell',
      });
    }
  });
});
