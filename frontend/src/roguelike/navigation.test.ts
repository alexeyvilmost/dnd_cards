import { describe, expect, it } from 'vitest';
import type { RoguelikeEncounter, RoguelikeRun } from './api';
import { runCombatURL, runEncounterSelection, runSheetURL } from './navigation';

describe('run-owned encounter roster', () => {
  it('returns from the shop to the character sheet with run context, independent of browser history', () => {
    expect(runSheetURL({id:'run-id',character_id:'shop-character'}))
      .toBe('/characters-v3/shop-character?roguelike=run-id');
    expect(runSheetURL({id:'run-id',character_id:'leader'},'party-member'))
      .toBe('/characters-v3/party-member?roguelike=run-id');
  });
  const roster = [
    { monster_id: 'guard', monster_slug: 'guard', monster_name: 'Стражник', quantity: 1, xp_each: 25 },
    { monster_id: 'bandit', monster_slug: 'bandit', monster_name: 'Бандит', quantity: 2, xp_each: 25 },
  ];
  it('projects every member and gives the frozen roster priority over legacy fields', () => {
    expect(runEncounterSelection({ roster, monster_id: 'ignored', quantity: 99 })).toEqual([
      { id: 'guard', quantity: 1 }, { id: 'bandit', quantity: 2 },
    ]);
  });
  it('retains legacy encounters and does not reinitialize an already saved battle', () => {
    expect(runEncounterSelection({ monster_id: 'wolf', quantity: 2 })).toEqual([{ id: 'wolf', quantity: 2 }]);
    const run = { id: 'run', character_id: 'hero', encounter: { roster } } as RoguelikeRun;
    expect(runCombatURL(run)).toBe('/characters-v3/hero/combat?roguelike=run&guard=1&bandit=2');
    run.character = { turn_state: { solo_combat_v1: {} } } as unknown as RoguelikeRun['character'];
    expect(runCombatURL(run)).toBe('/characters-v3/hero/combat?roguelike=run');
  });
  it.each([0, -1, 1.5, undefined])('rejects invalid member count %s', (quantity) => {
    expect(() => runEncounterSelection({ roster: [{ ...roster[0], quantity }] } as RoguelikeEncounter)).toThrow();
  });
  it('rejects duplicate actor templates instead of silently dropping their quantities', () => {
    expect(() => runEncounterSelection({ roster: [roster[0], roster[0]] })).toThrow();
  });
});
