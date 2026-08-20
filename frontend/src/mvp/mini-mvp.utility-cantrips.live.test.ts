import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-utility-cantrips.v1.json';
import reviewedWeaponDefinitions from '../../../scripts/content/data/mini-mvp-shillelagh-weapons.v1.json';
import { API_BASE_URL } from '../api/client';
import {
  executeAction,
  executeRemoteManipulator,
  resolveCommunicationLink,
} from '../engine/execute';
import { weaponContext } from '../engine/weapon';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import type { Card, Spell } from '../types';
import type { CharacterContext, RuntimeState } from './contracts';
import { CARD_LONGSWORD, FIGHTER_CTX, freshFighterState } from './fixtures';
import { readLiveJson } from './liveJsonRead';

type Dict = Record<string, unknown>;

async function fetchReviewedSpells(): Promise<Map<string, Spell>> {
  const body = await readLiveJson<Record<string, unknown>>(
    `${API_BASE_URL}/api/spells?page=1&limit=1000`,
    { label: '/api/spells' },
  );
  if (!Array.isArray(body.spells)) throw new Error('/api/spells: required collection spells is missing');
  const catalog = body.spells as Spell[];
  return new Map(reviewedDefinitions.map((reviewed) => {
    const matches = catalog.filter((spell) => spell.card_number === reviewed.card_number);
    if (matches.length !== 1) {
      throw new Error(`Live DB must contain exactly one ${reviewed.card_number}; got ${matches.length}`);
    }
    return [reviewed.card_number, matches[0]];
  }));
}

async function fetchReviewedWeapons(): Promise<Map<string, Card>> {
  const body = await readLiveJson<Record<string, unknown>>(
    `${API_BASE_URL}/api/cards?page=1&limit=1000`,
    { label: '/api/cards' },
  );
  if (!Array.isArray(body.cards)) throw new Error('/api/cards: required collection cards is missing');
  const catalog = body.cards as Card[];
  return new Map(reviewedWeaponDefinitions.map((reviewed) => {
    const matches = catalog.filter((card) => card.card_number === reviewed.card_number);
    if (matches.length !== 1) {
      throw new Error(`Live DB must contain exactly one ${reviewed.card_number}; got ${matches.length}`);
    }
    return [reviewed.card_number, matches[0]];
  }));
}

const club = withDeclaredTestWeaponProfile({
  ...CARD_LONGSWORD, id: 'weapon:club', name: 'Дубинка',
}, {
  weaponType: 'club', proficiencyCategory: 'simple', attackAbility: 'str',
  damageLines: [{ dice: '1d4', type: 'bludgeoning' }],
  defaultAttackMode: 'melee', attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['light'], masteryEffectId: 'mastery:slow',
});
const caster: CharacterContext = {
  ...FIGHTER_CTX,
  level: 1,
  spellcastingAbility: 'wis',
  spellcastingMod: 4,
  equippedCards: [club],
  knownCards: [club],
};
function casterState(): RuntimeState {
  const state = freshFighterState();
  state.equipment = { main_hand: club.id, off_hand: null };
  return state;
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: utility cantrips', () => {
  let spells: Map<string, Spell>;
  let weapons: Map<string, Card>;

  beforeAll(async () => {
    [spells, weapons] = await Promise.all([fetchReviewedSpells(), fetchReviewedWeapons()]);
  }, 180_000);

  const mechanics = (cardNumber: string): Dict => {
    const value = spells.get(cardNumber)?.mechanics;
    if (!value) throw new Error(`Live spell ${cardNumber} was not loaded`);
    return value as Dict;
  };

  it('loads the exact reviewed mechanics from the current database', () => {
    for (const reviewed of reviewedDefinitions) {
      expect(spells.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }
    for (const reviewed of reviewedWeaponDefinitions) {
      expect(weapons.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }
  });

  it('executes Mage Hand and Elementalism from live rows', () => {
    const hand = executeAction(casterState(), mechanics('SPELL-0173'), {
      character: caster, selfId: 'caster', rng: () => 0.5,
    });
    const nextTurn = { ...hand.state, resources: { ...hand.state.resources, action: 1 } };
    expect(executeRemoteManipulator(nextTurn, {
      operation: 'open_unlocked_door', distanceFt: 30,
    }).events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'open_unlocked_door',
    }));

    const elementalism = executeAction(casterState(), mechanics('SPELL-0298'), {
      character: caster, choices: { elementalism_effect: 'air' }, rng: () => 0.5,
    });
    expect(elementalism.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'beckon_air',
    }));
  });

  it('executes Shillelagh against the exact equipped Card from the live row', () => {
    const liveClub = weapons.get('CARD-0857');
    if (!liveClub) throw new Error('Live CARD-0857 was not loaded');
    const liveCaster = { ...caster, equippedCards: [liveClub], knownCards: [liveClub] };
    const liveState = casterState();
    liveState.equipment = { main_hand: liveClub.id, off_hand: null };
    const cast = executeAction(liveState, mechanics('SPELL-0194'), {
      character: liveCaster,
      spell: { baseLevel: 0, spellcastingAbility: 'wis' },
      choices: { shillelagh_weapon: liveClub.id, shillelagh_damage_type: 'force' },
      rng: () => 0.5,
    });
    expect(weaponContext(liveCaster, 'main', cast.state.equipment, cast.state)).toMatchObject({
      ability: 'wis', dice: '1d8', damageType: 'force',
    });
  });

  it('executes Message and its reply contract from the live row', () => {
    const cast = executeAction(casterState(), mechanics('SPELL-0294'), {
      character: caster,
      selfId: 'caster',
      target: { id: 'target', ac: 10, runtimeState: freshFighterState() },
      rng: () => 0.5,
    });
    expect(resolveCommunicationLink(cast.targetState!, { distanceFt: 80 }).events)
      .toContainEqual(expect.objectContaining({ type: 'communication', mode: 'reply' }));
  });

  it('executes persisted stabilization from the live Spare the Dying row', () => {
    const dying = freshFighterState();
    dying.hp.current = 0;
    dying.deathSaves = { successes: 2, failures: 1, stable: false, dead: false };
    const cast = executeAction(casterState(), mechanics('SPELL-0312'), {
      character: caster,
      target: { id: 'target', ac: 10, runtimeState: dying },
      rng: () => 0.5,
    });
    expect(cast.targetState?.deathSaves).toEqual({
      successes: 0, failures: 0, stable: true, dead: false,
    });
  });
});
