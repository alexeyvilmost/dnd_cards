import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from './assemble';
import { collectGrantedActionRequests } from './grantedActions';

describe('shared granted-action discovery', () => {
  it('gives display, resource sync, and rest one deduplicated request set', () => {
    const assembled = {
      actions: [],
      spells: [],
      effects: [{
        effect: {
          id: 'effect-flight',
          name: 'Драконьий полёт',
          mechanics: {
            activation: { mode: 'passive' },
            effects: [{ resolution: 'auto', result: [{
              kind: 'grant_action',
              value: 'ACT-dragonborn-draconic-flight',
              level_gate: 5,
            }] }],
          },
        },
        origin: { kind: 'race', id: 'dragonborn', name: 'Драконорождённый' },
      }],
    } as unknown as AssembledCharacter;
    const item = {
      card: { id: 'item', name: 'Дублирующий предмет' },
      mechanics: {
        effects: [{ resolution: 'auto', result: [{
          kind: 'grant_action',
          value: 'ACT-dragonborn-draconic-flight',
        }] }],
      },
    } as unknown as NonNullable<Parameters<typeof collectGrantedActionRequests>[3]>[number];

    expect(collectGrantedActionRequests(assembled, 4, {}, [])).toEqual([]);
    expect(collectGrantedActionRequests(assembled, 5, {}, [item])).toEqual([{
      slug: 'ACT-dragonborn-draconic-flight',
      sourceLabel: 'Дублирующий предмет',
      group: 'item',
    }]);
  });

  it('uses owning class level for a class-granted action gate', () => {
    const assembled = {
      actions: [], spells: [], pendingChoices: [],
      effects: [{
        effect: {
          id: 'class-feature', name: 'Умение класса',
          mechanics: { effects: [{ resolution: 'auto', result: [{
            kind: 'grant_action', value: 'ACT-level-five', level_gate: 5,
          }] }] },
        },
        origin: {
          kind: 'class', id: 'druid', name: 'Друид', owningClassLevel: 3,
        },
      }],
    } as unknown as AssembledCharacter;

    expect(collectGrantedActionRequests(assembled, 5, {}, [])).toEqual([]);
    assembled.effects[0].origin.owningClassLevel = 5;
    expect(collectGrantedActionRequests(assembled, 5, {}, [])).toEqual([{
      slug: 'ACT-level-five', sourceLabel: 'Умение класса', group: 'class',
    }]);
  });
});
