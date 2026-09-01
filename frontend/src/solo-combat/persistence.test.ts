import { describe, expect, it } from 'vitest';
import type { SoloCombatState } from './types';
import { writeSoloCombatState } from './persistence';

describe('solo combat persistence compaction', () => {
  it('omits repeated inline card art while preserving hover-card content', () => {
    const inlineImage = `data:image/png;base64,${'a'.repeat(400_000)}`;
    const state = {
      schemaVersion: 1,
      characterId: 'hero',
      runtimeRevision: 2,
      world: {
        ruleset: {
          systemId: 'dnd5e-2024', releaseId: 'test',
          contentHash: `sha256:${'a'.repeat(64)}`, errataVersion: '2024',
        },
        actors: {}, objects: {}, concentrations: {},
        scene: { mode: 'exploration' },
      },
      catalogActions: [],
      actionPresentation: {
        'spell@source': {
          imageUrl: inlineImage,
          description: 'Readable spell description',
          sourceLabel: 'Wizard',
          entityType: 'spell',
          entityId: 'spell',
          spellRef: {
            id: 'spell', name: 'Light', image_url: inlineImage,
          },
        },
      },
      sideByActorId: {}, actorPresentation: {}, playerActionIds: [],
      certifiedPlayerActionIds: [], monsterActionIds: {}, opportunityActionIds: {},
      resourceBindings: {}, tokens: {}, boardRevision: 1, movementRemainingFt: {},
      initiativeBonuses: {}, initiative: [], log: [], outcome: 'active',
    } as unknown as SoloCombatState;

    const turnState = writeSoloCombatState({}, state);
    expect(JSON.stringify(turnState).length).toBeLessThan(10_000);
    const persisted = (turnState.solo_combat_v1 as SoloCombatState).actionPresentation?.['spell@source'];
    expect(persisted?.imageUrl).toBeUndefined();
    expect(persisted?.spellRef?.image_url).toBeUndefined();
    expect(persisted?.description).toBe('Readable spell description');
    expect(persisted?.spellRef?.name).toBe('Light');

  });
});
