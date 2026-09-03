import { describe, expect, it } from 'vitest';
import type { CharacterContext } from '../mvp/contracts';
import type { AssembledCharacter } from './assemble';
import { collectPassiveMechanics, syncRuntimeResources } from './resourceInit';

describe('Warding Flare resource projection', () => {
  it('keeps a triggered listener passive and initializes its Wisdom-scaled pool', () => {
    const assembled = {
      klass: { name: 'Жрец', resources: {} },
      effects: [{
        effect: {
          id: 'warding-flare-uuid', card_number: 'EFFECT-0121', name: 'Защищающая вспышка',
          mechanics: {
            activation: {
              mode: 'triggered', optional: true,
              cost: [{ resource: 'reaction' }, { resource: 'warding_flare' }],
              trigger: { event: 'attack_roll_made', timing: 'before' },
            },
            effects: [{ resolution: 'auto', result: [
              { kind: 'resource', op: 'grant', id: 'warding_flare', amount: 'max(1,wis)', per: 'long_rest' },
              {
                kind: 'd20_interrupt', operation: 'impose_disadvantage', timing: 'before_roll',
                eligible_rolls: ['attack_roll'], range_ft: 30, requires_line_of_sight: true,
                allowed_relations: ['enemy'],
              },
            ] }],
          },
        },
        origin: { kind: 'subclass', id: 'light-domain', name: 'Домен Света' },
      }],
      actions: [], spells: [],
    } as unknown as AssembledCharacter;
    const context: CharacterContext = {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 3, cha: 0 },
      profBonus: 3, level: 5, classLevels: { cleric: 5 },
    };

    const passives = collectPassiveMechanics(assembled);
    expect(passives).toEqual([expect.objectContaining({
      id: 'EFFECT-0121',
      activation: expect.objectContaining({ mode: 'triggered' }),
    })]);
    expect(syncRuntimeResources(context, assembled).resources.warding_flare).toBe(3);
  });
});
