import { describe, expect, it } from 'vitest';
import {
  sheetActionPanelLockIssue,
  sheetConcentrationPresentation,
} from './SheetActionsPanel';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { RulesCatalog, WorldState } from '../rules-core/domain';

describe('SheetActionsPanel authoritative-surface lock', () => {
  it('returns the exact player-facing reason used to disable every action', () => {
    expect(sheetActionPanelLockIssue('Use the dedicated combat surface')).toEqual({
      disabled: true,
      reason: 'Use the dedicated combat surface',
    });
  });

  it('does not lock ordinary character-sheet actions', () => {
    expect(sheetActionPanelLockIssue()).toBeNull();
  });
});

describe('SheetActionsPanel canonical concentration presentation', () => {
  const world = {
    concentrations: {
      caster: {
        id: 'concentration:detect-magic',
        sourceActorId: 'caster',
        actionId: 'spell:detect-magic',
        startedAtRevision: 3,
        effectLinks: [],
      },
    },
  } as unknown as WorldState;

  const catalog = {
    getAction: (id: string) => id === 'spell:detect-magic' ? {
      id,
      name: 'Обнаружение магии',
      kind: 'spell' as const,
      sourceEntityIds: ['spell:detect-magic'] as const,
      mechanics: { primitive: { type: 'detect_magic_world_sensing' } },
      concentration: true,
      spell: { level: 1 },
    } : undefined,
  } satisfies RulesCatalog;

  it('surfaces Detect Magic and explains where its aura action is available', () => {
    expect(sheetConcentrationPresentation(
      { world, catalog } as Pick<SheetCanonicalRuntime, 'world' | 'catalog'>,
      'caster',
    )).toEqual({
      name: 'Обнаружение магии',
      detectMagicFollowUp: true,
    });
  });

  it('returns no status when the actor is not concentrating', () => {
    expect(sheetConcentrationPresentation(
      { world, catalog } as Pick<SheetCanonicalRuntime, 'world' | 'catalog'>,
      'other',
    )).toBeNull();
  });
});
