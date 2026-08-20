import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-utility-level1-spells.v1.json';
import {
  commandWorldEntity,
  consumeTemporaryConsumable,
  controlIllusion,
  executeAction,
  inspectIllusion,
  MechanicsExecutionError,
  queryInformationAccess,
  resolveWorldZone,
} from '../engine/execute';
import { validateMechanics } from '../engine/validateMechanics';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from '../mvp/fixtures';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { compileDeclaredMechanicsTargeting } from './actionTargeting';

type Dict = Record<string, unknown>;

const caster: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  level: 1,
  spellcastingAbility: 'int',
  spellcastingMod: 4,
};

function spell(cardNumber: string): { name: string; mechanics: Dict } {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing utility spell ${cardNumber}`);
  return definition as { name: string; mechanics: Dict };
}

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 6;
  state.maxResources.spell_slot_1 = 6;
  return state;
}

function cast(cardNumber: string, choices?: Record<string, string>): ReturnType<typeof executeAction> {
  return executeAction(casterState(), spell(cardNumber).mechanics, {
    character: caster,
    selfId: 'caster',
    spell: { baseLevel: 1, sourceClass: 'wizard', spellcastingAbility: 'int' },
    choices,
    rng: () => 0.5,
  });
}

describe('mini-MVP: data-driven utility level-1 spells', () => {
  it('schema-validates all thirteen declarations and their explicit targeting', () => {
    expect(definitions).toHaveLength(13);
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });
      expect(() => compileDeclaredMechanicsTargeting(definition.mechanics as Dict)).not.toThrow();
    }
  });

  it('persists, inspects, and controls Silent Image from its data policy', () => {
    const result = cast('SPELL-0161');
    expect(inspectIllusion(result.state, { investigationTotal: 13 }).revealed).toBe(false);
    expect(inspectIllusion(result.state, { investigationTotal: 14 }).revealed).toBe(true);
    const nextTurn = { ...result.state, resources: { ...result.state.resources, action: 1 } };
    const moved = controlIllusion(nextTurn, { operation: 'move_illusion', distanceFt: 60 });
    expect(moved.state.resources.action).toBe(0);
    expect(() => controlIllusion(nextTurn, {
      operation: 'move_illusion', distanceFt: 65,
    })).toThrow(MechanicsExecutionError);
  });

  it('creates ten Goodberries and consumes one with a Bonus Action', () => {
    const result = cast('SPELL-0188');
    const wounded = { ...result.state, hp: { ...result.state.hp, current: result.state.hp.max - 2 } };
    const consumed = consumeTemporaryConsumable(wounded);
    expect(consumed.state.hp.current).toBe(result.state.hp.max - 1);
    expect(consumed.state.resources.bonus_action).toBe(0);
    expect(consumed.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ mechanics: expect.objectContaining({ remaining: 9 }) }),
    ]));
  });

  it('uses the same illusion primitive for Illusory Script and Disguise Self', () => {
    const script = cast('SPELL-0206');
    expect(script.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ mechanics: expect.objectContaining({ form: 'inscription' }) }),
    ]));
    const disguise = cast('SPELL-0222');
    expect(inspectIllusion(disguise.state, { physicalInteraction: true }).revealed).toBe(true);
  });

  it('persists an Unseen Servant stat block and validates its commands', () => {
    const servant = cast('SPELL-0232');
    const command = commandWorldEntity(servant.state, {
      operation: 'serve_food', distanceFt: 15,
    });
    expect(command.state.resources.bonus_action).toBe(0);
    expect(command.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'serve_food',
    }));
    expect(() => commandWorldEntity(servant.state, {
      operation: 'attack', distanceFt: 5,
    })).toThrow(MechanicsExecutionError);
  });

  it('queries Detect Evil and Good using range, creature type, and barriers', () => {
    const result = cast('SPELL-0237');
    expect(queryInformationAccess(result.state, {
      distanceFt: 30, creatureType: 'undead',
    }).accessible).toBe(true);
    expect(queryInformationAccess(result.state, {
      distanceFt: 20, creatureType: 'beast',
    }).accessible).toBe(false);
    expect(queryInformationAccess(result.state, {
      distanceFt: 20, creatureType: 'fiend', barrier: { material: 'stone', thicknessFt: 1 },
    }).accessible).toBe(false);
  });

  it('emits an explicit Identify information request', () => {
    const result = cast('SPELL-0245');
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction',
      operation: 'reveal_information',
      parameters: expect.objectContaining({ reveal: 'identify_magic' }),
    }));
  });

  it('persists Floating Disk load and distance constraints', () => {
    const result = cast('SPELL-0256');
    expect(result.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mechanics: expect.objectContaining({
          entity_type: 'floating_disk',
          constraints: expect.objectContaining({ capacity_lb: 500, max_distance_ft: 100 }),
        }),
      }),
    ]));
  });

  it('enforces written touch for Comprehend Languages', () => {
    const result = cast('SPELL-0265');
    expect(queryInformationAccess(result.state, { mode: 'written', touching: false }).accessible)
      .toBe(false);
    expect(queryInformationAccess(result.state, { mode: 'written', touching: true }).accessible)
      .toBe(true);
    expect(queryInformationAccess(result.state, { mode: 'heard' }).accessible).toBe(true);
  });

  it('limits Speak with Animals to Beasts and declared communication modes', () => {
    const result = cast('SPELL-0277');
    expect(queryInformationAccess(result.state, {
      creatureType: 'beast', mode: 'influence_action',
    }).accessible).toBe(true);
    expect(queryInformationAccess(result.state, {
      creatureType: 'dragon', mode: 'speak',
    }).accessible).toBe(false);
  });

  it('persists both Alarm modes and respects exemptions and mental range', () => {
    const alarm = cast('SPELL-0288', { alarm_mode: 'mental' });
    expect(resolveWorldZone(alarm.state, {
      operation: 'mental_alarm', distanceFromCasterFt: 5280,
    }).triggered).toBe(true);
    expect(resolveWorldZone(alarm.state, {
      operation: 'mental_alarm', distanceFromCasterFt: 5281,
    }).triggered).toBe(false);
    expect(resolveWorldZone(alarm.state, {
      operation: 'mental_alarm', distanceFromCasterFt: 30, exempt: true,
    }).triggered).toBe(false);
  });

  it('emits only the selected Create or Destroy Water mutation', () => {
    const result = cast('SPELL-0296', { create_destroy_water_mode: 'destroy_fog' });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'destroy_fog',
    }));
    expect(result.events.some((event) => (
      event.type === 'world_interaction' && event.operation === 'create_rain'
    ))).toBe(false);
  });

  it('persists Fog Cloud and only strong wind disperses it', () => {
    const fog = cast('SPELL-0303');
    expect(resolveWorldZone(fog.state, { operation: 'disperse', strongWind: false }).triggered)
      .toBe(false);
    const dispersed = resolveWorldZone(fog.state, { operation: 'disperse', strongWind: true });
    expect(dispersed.triggered).toBe(true);
    expect(dispersed.state.activeEffects.some((effect) => (
      (effect.mechanics as Dict).kind === 'world_zone'
    ))).toBe(false);
  });
});
