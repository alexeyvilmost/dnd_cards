import { describe, expect, it } from 'vitest';
import { longRest, startTurn } from '../engine/turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import {
  RULES_ENGINE_RUNTIME_TURN_STATE_KEY,
  buildTargetFromCharacter,
  forgeToRuntimeState,
  writeRulesEngineRuntimeTurnState,
} from './runtime';
import type { ForgeCharacter } from './types';

const CONTEXT: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    hp: { current: 7, max: 10, temp: 3 },
    resources: { action: 0 },
    maxResources: { action: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
    firedThisTurn: ['sneak-attack', 'cleave'],
    firedThisRest: ['relentless-endurance'],
    ...overrides,
  };
}

function character(turnState: Record<string, unknown> | null): ForgeCharacter {
  return {
    id: 'character:runtime-ledgers',
    name: 'Runtime ledgers',
    current_hp: 7,
    max_hp: 10,
    resources: { action: 0 },
    max_resources: { action: 1 },
    equipment: {},
    inventory_items: [],
    active_effects: [],
    turn_state: turnState,
  } as unknown as ForgeCharacter;
}

describe('Character Sheet engine ledger persistence', () => {
  it('requires an explicit target Armor Class and preserves an explicit legacy snapshot value', () => {
    const explicit = character(null);
    explicit.armor_class = 14;
    expect(buildTargetFromCharacter(explicit)).toMatchObject({ id: explicit.id, ac: 14 });

    expect(() => buildTargetFromCharacter(character(null)))
      .toThrow(/explicit positive finite Armor Class/);
    for (const armorClass of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = character(null);
      invalid.armor_class = armorClass;
      expect(() => buildTargetFromCharacter(invalid))
        .toThrow(/explicit positive finite Armor Class/);
    }
  });

  it('round-trips once-per-turn/rest identities without erasing other turn state', () => {
    const state = runtime({
      firedThisTurn: ['sneak-attack', 'sneak-attack', 'cleave'],
      firedThisRest: ['relentless-endurance', 'relentless-endurance'],
    });
    const persisted = writeRulesEngineRuntimeTurnState(
      { death_saves: { failures: 1 } },
      state,
      { turn_number: 4 },
    );

    expect(persisted).toMatchObject({
      temp_hp: 3,
      death_saves: { failures: 1 },
      turn_number: 4,
      [RULES_ENGINE_RUNTIME_TURN_STATE_KEY]: {
        schemaVersion: 1,
        firedThisTurn: ['sneak-attack', 'cleave'],
        firedThisRest: ['relentless-endurance'],
      },
    });
    const restored = forgeToRuntimeState(character(
      JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>,
    ));
    expect(restored.firedThisTurn).toEqual(['sneak-attack', 'cleave']);
    expect(restored.firedThisRest).toEqual(['relentless-endurance']);
    expect(restored.hp.temp).toBe(3);
  });

  it('fails closed for malformed or future ledger envelopes', () => {
    expect(() => forgeToRuntimeState(character({
      [RULES_ENGINE_RUNTIME_TURN_STATE_KEY]: {
        schemaVersion: 1,
        firedThisTurn: ['valid', ' '],
        firedThisRest: [],
      },
    }))).toThrow(/firedThisTurn/);
    expect(() => forgeToRuntimeState(character({
      [RULES_ENGINE_RUNTIME_TURN_STATE_KEY]: {
        schemaVersion: 2,
        firedThisTurn: [],
        firedThisRest: [],
      },
    }))).toThrow(/unsupported version/);
  });

  it('keeps the persisted gates until their exact engine lifecycle boundary', () => {
    const restored = forgeToRuntimeState(character(
      writeRulesEngineRuntimeTurnState({}, runtime()),
    ));
    const nextTurn = startTurn(restored, undefined, { advanceRoundDurations: false }).state;
    expect(nextTurn.firedThisTurn).toEqual([]);
    expect(nextTurn.firedThisRest).toEqual(['relentless-endurance']);

    const rested = longRest(nextTurn, CONTEXT).state;
    expect(rested.firedThisTurn).toEqual([]);
    expect(rested.firedThisRest).toEqual([]);
  });
});
