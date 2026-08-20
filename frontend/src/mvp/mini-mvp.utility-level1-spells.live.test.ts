import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-utility-level1-spells.v1.json';
import { API_BASE_URL } from '../api/client';
import {
  commandWorldEntity,
  consumeTemporaryConsumable,
  controlIllusion,
  executeAction,
  inspectIllusion,
  queryInformationAccess,
  resolveWorldZone,
} from '../engine/execute';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from './fixtures';
import { readLiveJson } from './liveJsonRead';
import type { CharacterContext, RuntimeState } from './contracts';
import type { Spell } from '../types';

type Dict = Record<string, unknown>;

const caster: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  level: 1,
  spellcastingAbility: 'int',
  spellcastingMod: 4,
};

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 6;
  state.maxResources.spell_slot_1 = 6;
  return state;
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: utility level-1 spells', () => {
  let spells: Map<string, Spell>;

  beforeAll(async () => {
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}/api/spells?page=1&limit=1000`,
      { label: '/api/spells' },
    );
    if (!Array.isArray(body.spells)) throw new Error('/api/spells: required collection spells is missing');
    const catalog = body.spells as Spell[];
    spells = new Map(reviewedDefinitions.map((reviewed) => {
      const matches = catalog.filter((spell) => spell.card_number === reviewed.card_number);
      if (matches.length !== 1) {
        throw new Error(`Live DB must contain exactly one ${reviewed.card_number}; got ${matches.length}`);
      }
      return [reviewed.card_number, matches[0]];
    }));
  }, 180_000);

  const mechanics = (cardNumber: string): Dict => {
    const value = spells.get(cardNumber)?.mechanics;
    if (!value) throw new Error(`Live spell ${cardNumber} was not loaded`);
    return value as Dict;
  };

  const cast = (cardNumber: string, choices?: Record<string, string>) => executeAction(
    casterState(),
    mechanics(cardNumber),
    {
      character: caster,
      selfId: 'caster',
      spell: { baseLevel: 1, sourceClass: 'wizard', spellcastingAbility: 'int' },
      choices,
      rng: () => 0.5,
    },
  );

  it('loads the exact reviewed mechanics for all thirteen live rows', () => {
    expect(spells.size).toBe(13);
    for (const reviewed of reviewedDefinitions) {
      expect(spells.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }
  });

  it('executes the illusion and temporary-consumable contracts from live rows', () => {
    const image = cast('SPELL-0161');
    expect(inspectIllusion(image.state, { investigationTotal: 14 }).revealed).toBe(true);
    const nextTurn = { ...image.state, resources: { ...image.state.resources, action: 1 } };
    expect(controlIllusion(nextTurn, {
      operation: 'move_illusion', distanceFt: 30,
    }).events).toContainEqual(expect.objectContaining({ operation: 'move_illusion' }));

    const berry = cast('SPELL-0188');
    const eaten = consumeTemporaryConsumable({
      ...berry.state,
      hp: { ...berry.state.hp, current: berry.state.hp.max - 1 },
    });
    expect(eaten.state.hp.current).toBe(berry.state.hp.max);
    expect(eaten.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'consume_temporary_item',
    }));
  });

  it('executes world entities, information access, and reveal from live rows', () => {
    const servant = cast('SPELL-0232');
    expect(commandWorldEntity(servant.state, {
      operation: 'fetch', distanceFt: 20,
    }).events).toContainEqual(expect.objectContaining({ operation: 'fetch' }));

    const detection = cast('SPELL-0237');
    expect(queryInformationAccess(detection.state, {
      distanceFt: 10, creatureType: 'fey',
    }).accessible).toBe(true);

    expect(cast('SPELL-0245').events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'reveal_information',
    }));
    expect(cast('SPELL-0256').state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ mechanics: expect.objectContaining({ entity_type: 'floating_disk' }) }),
    ]));
  });

  it('executes language, alarm, water, and fog contracts from live rows', () => {
    expect(queryInformationAccess(cast('SPELL-0265').state, {
      mode: 'written', touching: true,
    }).accessible).toBe(true);
    expect(queryInformationAccess(cast('SPELL-0277').state, {
      creatureType: 'beast', mode: 'speak',
    }).accessible).toBe(true);

    const alarm = cast('SPELL-0288', { alarm_mode: 'audible' });
    expect(resolveWorldZone(alarm.state, { operation: 'entry' }).triggered).toBe(true);
    expect(cast('SPELL-0296', {
      create_destroy_water_mode: 'create_rain',
    }).events).toContainEqual(expect.objectContaining({ operation: 'create_rain' }));

    const fog = cast('SPELL-0303');
    expect(resolveWorldZone(fog.state, {
      operation: 'disperse', strongWind: true,
    }).triggered).toBe(true);
  });
});
