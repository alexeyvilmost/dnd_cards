import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-control-spells.v1.json';
import { API_BASE_URL } from '../api/client';
import { activeConditionsOf } from '../engine/circumstances';
import {
  executeAction,
  projectedAgainst,
  resolveNextTurnCommand,
} from '../engine/execute';
import { deniedCapabilities } from '../engine/modifiers';
import type { CharacterContext, RuntimeState } from './contracts';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from './fixtures';
import { readLiveJson } from './liveJsonRead';
import type { Spell } from '../types';

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

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 4;
  state.maxResources.spell_slot_1 = 4;
  return state;
}

const caster: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  creatureType: 'humanoid',
  spellcastingMod: 3,
};
const targetCharacter: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  creatureType: 'humanoid',
  characterSpeed: 30,
};

const singleAttack: Dict = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    resolution: 'attack_roll', attack_kind: 'spell_melee', ability: 'str', vs: 'ac', who: 'target',
    on_hit: [{ kind: 'damage', dice: '1', type: 'bludgeoning' }],
  }],
  targeting: { shape: 'single', domain: 'actor' },
};

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: control and ward spells', () => {
  let spells: Map<string, Spell>;

  beforeAll(async () => {
    spells = await fetchReviewedSpells();
  }, 180_000);

  function cast(cardNumber: string, choices?: Record<string, string>): RuntimeState {
    const spell = spells.get(cardNumber);
    if (!spell) throw new Error(`Live spell ${cardNumber} was not loaded`);
    const result = executeAction(casterState(), spell.mechanics as Dict, {
      character: caster,
      selfId: 'caster',
      target: {
        id: 'target',
        ac: 10,
        characterContext: targetCharacter,
        runtimeState: freshFighterState(),
      },
      choices,
      rng: () => 0,
    });
    if (!result.targetState) throw new Error(`${cardNumber} did not mutate target`);
    return result.targetState;
  }

  it('loads the exact reviewed mechanics from the current database', () => {
    for (const reviewed of reviewedDefinitions) {
      expect(spells.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }
  });

  it('executes source-type-filtered Protection from the live DB', () => {
    const protectedTarget = cast('SPELL-0201');
    const incoming = (creatureType?: string) => projectedAgainst(
      { id: 'target', runtimeState: protectedTarget },
      'attack',
      'melee',
      {
        rollerActorId: 'attacker',
        rollTargetActorId: 'target',
        rollerCreatureType: creatureType,
      },
    ).advantage;
    expect(incoming('fiend:devil')).toBe('disadvantage');
    expect(incoming('beast')).toBe('none');
  });

  it('executes Command from the live DB and resolves its next-turn directive', () => {
    const commanded = cast('SPELL-0272', { command_option: 'halt' });
    const turn = resolveNextTurnCommand(commanded, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0.5,
    });
    expect(turn).toMatchObject({ command: 'halt', endsTurn: true });
    expect(turn && [...deniedCapabilities(turn.state)].sort()).toEqual([
      'action', 'bonus_action', 'movement',
    ]);

    const grovel = resolveNextTurnCommand(cast('SPELL-0272', { command_option: 'grovel' }), {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0.5,
    });
    expect(grovel && activeConditionsOf(grovel.state).has('prone')).toBe(true);
  });

  it('executes Sanctuary from the live DB before the incoming attack roll', () => {
    const warded = cast('SPELL-0306');
    const before = warded.hp.current;
    const blocked = executeAction(freshFighterState(), singleAttack, {
      character: { ...targetCharacter, creatureType: 'beast' },
      selfId: 'attacker',
      target: {
        id: 'target', ac: 10, characterContext: targetCharacter, runtimeState: warded,
      },
      rng: () => 0,
    });
    expect(blocked.state.resources.action).toBe(0);
    expect(blocked.targetState).toBeUndefined();
    expect(warded.hp.current).toBe(before);
    expect(blocked.events.filter((event) => event.type === 'roll')).toHaveLength(1);
  });
});
