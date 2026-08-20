import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-level1-ongoing-spells.v1.json';
import { API_BASE_URL } from '../api/client';
import { executeAction, projectedAgainst } from '../engine/execute';
import { collectModifiers } from '../engine/modifiers';
import { startTurn } from '../engine/turn';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from './fixtures';
import type { RuntimeState } from './contracts';
import { readLiveJson } from './liveJsonRead';
import type { Spell } from '../types';

type Dict = Record<string, unknown>;

const REVIEWED_CARD_NUMBERS = reviewedDefinitions.map((definition) => definition.card_number);
const face = (value: number, sides = 20) => (value - 0.5) / sides;

async function fetchAllSpells(): Promise<Spell[]> {
  const spells: Spell[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}/api/spells?page=${page}&limit=1000`,
      { label: '/api/spells' },
    );
    if (!Array.isArray(body.spells)) throw new Error('/api/spells: required collection spells is missing');
    const batch = body.spells as Spell[];
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
      if (expectedTotal !== null && responseTotal !== expectedTotal) {
        throw new Error(`/api/spells: total changed from ${expectedTotal} to ${responseTotal}`);
      }
      expectedTotal = responseTotal;
    }
    for (const spell of batch) {
      if (!spell.id || seenIds.has(spell.id)) {
        throw new Error(`/api/spells: pagination repeated or omitted entity id ${spell.id || '<blank>'}`);
      }
      seenIds.add(spell.id);
      spells.push(spell);
    }
    if (expectedTotal !== null) {
      if (spells.length === expectedTotal) return spells;
      if (spells.length > expectedTotal || batch.length === 0) {
        throw new Error(`/api/spells: received ${spells.length}/${expectedTotal} records`);
      }
    } else if (batch.length < 1000) {
      return spells;
    }
  }
  throw new Error('/api/spells: pagination exceeded 100 pages');
}

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 2;
  state.maxResources.spell_slot_1 = 2;
  return state;
}

const caster = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 };
const targetCharacter = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 0 };

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: ongoing spells', () => {
  let spells: Map<string, Spell>;

  beforeAll(async () => {
    const catalog = await fetchAllSpells();
    spells = new Map(REVIEWED_CARD_NUMBERS.map((cardNumber) => {
      const matches = catalog.filter((spell) => spell.card_number === cardNumber);
      if (matches.length !== 1) {
        throw new Error(`Live DB must contain exactly one ${cardNumber}; got ${matches.length}`);
      }
      return [cardNumber, matches[0]];
    }));
  }, 180_000);

  function liveSpell(cardNumber: string): Spell {
    const spell = spells.get(cardNumber);
    if (!spell) throw new Error(`Live DB spell ${cardNumber} was not loaded`);
    return spell;
  }

  function failedSave(cardNumber: string): RuntimeState {
    const spell = liveSpell(cardNumber);
    const result = executeAction(casterState(), spell.mechanics as Dict, {
      character: caster,
      selfId: 'caster',
      target: {
        id: 'target',
        saveMods: { wis: 0, dex: 0 },
        characterContext: targetCharacter,
        runtimeState: freshFighterState(),
      },
      rng: () => face(1),
    });
    if (!result.targetState) throw new Error(`${cardNumber} did not mutate its target`);
    return result.targetState;
  }

  it('loads the exact reviewed mechanics from the current database', () => {
    for (const reviewed of reviewedDefinitions) {
      const actual = liveSpell(reviewed.card_number);
      expect(actual.name).toBe(reviewed.name);
      expect(actual.mechanics).toEqual(reviewed.mechanics);
    }
  });

  it('executes Compelled Duel with source-aware attack disadvantage', () => {
    const state = failedSave('SPELL-0179');
    const against = (targetId: string) => collectModifiers(state, [], {
      roll: 'attack',
      evalCtx: { rollerActorId: 'target', rollTargetActorId: targetId },
    }).advantage;
    expect(against('other-enemy')).toBe('disadvantage');
    expect(against('caster')).toBe('none');
  });

  it('executes Heroism turn-start temp HP and Frightened immunity', () => {
    const protectedTarget = failedSave('SPELL-0181');
    const turn = startTurn(protectedTarget, targetCharacter, { advanceRoundDurations: false });
    expect(turn.state.hp.temp).toBe(3);

    const frightened = executeAction(casterState(), {
      activation: { mode: 'active' },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'condition', value: 'frightened', op: 'apply' }],
      }],
    }, {
      character: caster,
      selfId: 'enemy',
      target: {
        id: 'target',
        characterContext: targetCharacter,
        runtimeState: protectedTarget,
      },
      rng: () => 0.5,
    });
    expect(frightened.targetState?.activeEffects.some((effect) => (
      (effect.mechanics as Dict).kind === 'condition'
        && (effect.mechanics as Dict).value === 'frightened'
    ))).toBe(false);
    expect(frightened.events).toContainEqual(expect.objectContaining({
      type: 'condition_immune', condition: 'frightened',
    }));
  });

  it('executes Faerie Fire with explicit-visibility advantage only', () => {
    const target = failedSave('faerie_fire');
    const projection = (visible?: boolean) => projectedAgainst(
      { id: 'target', runtimeState: target },
      'attack',
      'ranged',
      visible === undefined ? { rollerActorId: 'attacker', rollTargetActorId: 'target' } : {
        rollerActorId: 'attacker',
        rollTargetActorId: 'target',
        visibility: { attacker: { target: visible } },
      },
    ).advantage;
    expect(projection(true)).toBe('advantage');
    expect(projection(false)).toBe('none');
    expect(projection()).toBe('none');
  });
});
