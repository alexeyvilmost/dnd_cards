import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import type { ForgeCharacter } from './types';
import type { PassiveEffect, Spell } from '../types';
import type { PendingChoice } from '../mechanics/collectChoices';
import { readSheetSpellPreparation } from './sheetSpellPreparation';
import {
  applySheetPreparedSpellSwap,
  collectSheetPreparedSpellSwapPolicies,
  preparedSpellSwapDeclaration,
} from './sheetSpellPreparationRest';

const PREPARED_CHOICE_ID = 'class:wizard:spellcasting:wizard_prepared';

function spell(reference: string, name: string, level: number): Spell {
  return {
    id: `${reference}-uuid`,
    card_number: reference,
    name,
    level,
    classes: ['wizard'],
  } as Spell;
}

function assembled(mechanics: Record<string, unknown> = {
  activation: { mode: 'passive' },
  spell_preparation_rest: {
    kind: 'prepared_spell_swap',
    decision_type: 'wizard_memorize_spell',
    rest: 'short_rest',
    source: 'spellbook',
    maximum_per_rest: 1,
    minimum_spell_level: 1,
    maximum_spell_level: 'max_available_spell_slot',
    optional: true,
  },
}): AssembledCharacter {
  const preparedChoice = {
    id: PREPARED_CHOICE_ID,
    source: 'prepared_spell',
    count: 2,
    prompt: 'Подготовьте заклинания',
    allowedOptionIds: ['SPELL-SHIELD', 'SPELL-MAGIC-MISSILE', 'SPELL-MISTY-STEP'],
    preparedSpellSourceChoiceId: 'class:wizard:spellcasting:wizard_book',
    origin: { kind: 'class', id: 'wizard-id', name: 'Wizard' },
  } as PendingChoice;
  return {
    effects: [{
      effect: {
        id: 'memorize-effect-id',
        card_number: 'EFF-wizard-memorize-spell',
        name: 'Запомнить заклинание',
        mechanics,
      } as PassiveEffect,
      origin: { kind: 'class', id: 'wizard-id', name: 'Wizard', owningClassLevel: 5 },
    }],
    pendingChoices: [preparedChoice],
    spells: [
      spell('SPELL-SHIELD', 'Щит', 1),
      spell('SPELL-MAGIC-MISSILE', 'Волшебная стрела', 1),
      spell('SPELL-MISTY-STEP', 'Туманный шаг', 2),
    ],
  } as unknown as AssembledCharacter;
}

function character(): Pick<ForgeCharacter, 'turn_state' | 'resolved_choices'> {
  return {
    turn_state: { sibling: { retained: true } },
    resolved_choices: {
      [PREPARED_CHOICE_ID]: ['SPELL-SHIELD', 'SPELL-MAGIC-MISSILE'],
    },
  };
}

describe('Wizard Memorize Spell short-rest workflow', () => {
  it('compiles the catalog declaration without a display-name or class-id branch', () => {
    const renamed = assembled();
    renamed.effects[0].effect.name = 'Renamed feature';
    renamed.effects[0].origin.id = 'another-stable-class-id';
    const [policy] = collectSheetPreparedSpellSwapPolicies({
      assembled: renamed,
      character: character(),
    });

    expect(policy.declaration).toEqual({
      kind: 'prepared_spell_swap',
      decisionType: 'wizard_memorize_spell',
      rest: 'short_rest',
      source: 'spellbook',
      maximumPerRest: 1,
      minimumSpellLevel: 1,
      maximumSpellLevel: 'max_available_spell_slot',
      optional: true,
    });
    expect(policy.current.map(({ name }) => name)).toEqual(['Щит', 'Волшебная стрела']);
    expect(policy.replacements.map(({ name }) => name)).toEqual(['Туманный шаг']);
  });

  it('atomically persists exactly one swap and preserves unrelated turn state', () => {
    const inputCharacter = character();
    const [policy] = collectSheetPreparedSpellSwapPolicies({
      assembled: assembled(),
      character: inputCharacter,
    });
    const result = applySheetPreparedSpellSwap({
      turnState: inputCharacter.turn_state,
      policy,
      selection: {
        forgetReference: 'SPELL-SHIELD',
        memorizeReference: 'SPELL-MISTY-STEP',
      },
    });

    expect(result.changed).toBe(true);
    expect(result.forgotten?.name).toBe('Щит');
    expect(result.memorized?.name).toBe('Туманный шаг');
    expect(result.turnState.sibling).toEqual({ retained: true });
    expect(readSheetSpellPreparation(result.turnState)?.choices[PREPARED_CHOICE_ID])
      .toEqual(['SPELL-MISTY-STEP', 'SPELL-MAGIC-MISSILE']);
  });

  it('allows declining the optional choice without creating preparation state', () => {
    const inputCharacter = character();
    const [policy] = collectSheetPreparedSpellSwapPolicies({
      assembled: assembled(),
      character: inputCharacter,
    });
    const result = applySheetPreparedSpellSwap({
      turnState: inputCharacter.turn_state,
      policy,
      selection: {},
    });
    expect(result).toEqual({
      turnState: { sibling: { retained: true } },
      changed: false,
    });
  });

  it('falls back to the valid Forge seed when a level-up left a stale runtime overlay', () => {
    const inputCharacter = character();
    inputCharacter.turn_state = {
      sheet_spell_preparation_v1: {
        schemaVersion: 1,
        choices: { [PREPARED_CHOICE_ID]: ['SPELL-SHIELD'] },
      },
    };
    const [policy] = collectSheetPreparedSpellSwapPolicies({
      assembled: assembled(),
      character: inputCharacter,
    });
    expect(policy.current.map(({ reference }) => reference)).toEqual([
      'SPELL-SHIELD',
      'SPELL-MAGIC-MISSILE',
    ]);
  });

  it('rejects partial, already prepared, foreign, and stale selections', () => {
    const [policy] = collectSheetPreparedSpellSwapPolicies({
      assembled: assembled(),
      character: character(),
    });
    const apply = (forgetReference?: string, memorizeReference?: string) => (
      applySheetPreparedSpellSwap({
        turnState: {},
        policy,
        selection: { forgetReference, memorizeReference },
      })
    );
    expect(() => apply('SPELL-SHIELD')).toThrow('выберите и подготовленное, и новое');
    expect(() => apply('SPELL-SHIELD', 'SPELL-MAGIC-MISSILE')).toThrow('недоступно в книге');
    expect(() => apply('SPELL-SHIELD', 'SPELL-FIREBALL')).toThrow('недоступно в книге');
    expect(() => apply('SPELL-SLEEP', 'SPELL-MISTY-STEP')).toThrow('больше не подготовлено');
  });

  it('fails closed for malformed catalog declarations and ambiguous spellbooks', () => {
    expect(() => preparedSpellSwapDeclaration({
      spell_preparation_rest: {
        kind: 'prepared_spell_swap',
        decision_type: 'wizard_memorize_spell',
        rest: 'long_rest',
      },
    })).toThrow('malformed');

    const ambiguous = assembled();
    ambiguous.pendingChoices.push({ ...ambiguous.pendingChoices[0], id: 'second-book' });
    expect(() => collectSheetPreparedSpellSwapPolicies({
      assembled: ambiguous,
      character: character(),
    })).toThrow('one unambiguous');
  });
});
