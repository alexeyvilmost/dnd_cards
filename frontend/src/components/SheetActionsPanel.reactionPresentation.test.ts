import { describe, expect, it } from 'vitest';
import type { SheetAction } from '../character/actionSheet';
import {
  sheetSpellActionsForPresentation,
  sheetTriggerOnlyReason,
} from './SheetActionsPanel';

const shield = {
  id: 'shield',
  name: 'Щит',
  group: 'spell',
  mechanics: {
    activation: {
      mode: 'reaction',
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot', level: 1 }],
      trigger: { events: ['hit_by_attack', 'targeted_by_magic_missile'] },
    },
  },
} as SheetAction;

describe('character-sheet reaction presentation', () => {
  it('keeps a known reaction spell visible in the spell catalog but locks proactive use', () => {
    expect(sheetSpellActionsForPresentation([shield])).toEqual([shield]);
    expect(sheetTriggerOnlyReason(shield.mechanics)).toBe(
      'Доступно только в окне реакции после подходящего события',
    );
  });

  it('does not lock an ordinary active spell', () => {
    expect(sheetTriggerOnlyReason({
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
    })).toBeNull();
  });
});
