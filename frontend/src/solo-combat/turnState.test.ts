import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { createWorld } from '../rules-core/domain';
import type { SoloCombatState } from './types';
import {
  readSoloCombatState,
  rebaseSoloCombatParticipantRuntimeRevisions,
} from './persistence';
import { writeDedicatedCombatTurnState } from './turnState';

const runtime: RuntimeState = {
  hp: { current: 7, max: 10, temp: 0 },
  resources: { action: 1 },
  maxResources: { action: 1 },
  equipment: {},
  inventory: [],
  activeEffects: [],
  firedThisTurn: [],
  firedThisRest: [],
};

describe('dedicated combat turn-state ownership', () => {
  it('removes an incompatible sheet continuation when dedicated combat starts', () => {
    const combat = { schemaVersion: 1, marker: 'dedicated' } as unknown as SoloCombatState;
    const next = writeDedicatedCombatTurnState({
      canonical_pending_combat_v1: { pending: true },
      unrelated: 'preserved',
    }, runtime, combat);

    expect(next).not.toHaveProperty('canonical_pending_combat_v1');
    expect(next.solo_combat_v1).toMatchObject({ marker: 'dedicated' });
    expect(next.unrelated).toBe('preserved');
  });

  it('clears both combat envelopes when dedicated combat finishes', () => {
    const next = writeDedicatedCombatTurnState({
      canonical_pending_combat_v1: { pending: true },
      solo_combat_v1: { marker: 'old' },
      unrelated: 'preserved',
    }, runtime, null);

    expect(next).not.toHaveProperty('canonical_pending_combat_v1');
    expect(next).not.toHaveProperty('solo_combat_v1');
    expect(next.unrelated).toBe('preserved');
  });

  it('persists one copy of a large hover-card image and restores the icon projection', () => {
    const image = `data:image/png;base64,${'A'.repeat(300_000)}`;
    const combat = {
      schemaVersion: 1,
      characterId: 'actor:owner',
      runtimeRevision: 7,
      world: createWorld({
        id: 'world:test',
        ruleset: {
          systemId: 'dnd5e-2024',
          releaseId: 'test-release',
          contentHash: 'sha256:test',
          errataVersion: 'test',
        },
        actors: [],
      }),
      catalogActions: [],
      playerActionIds: [],
      certifiedPlayerActionIds: [],
      monsterActionIds: {},
      opportunityActionIds: {},
      resourceBindings: {},
      sideByActorId: {},
      actorPresentation: {},
      tokens: {},
      boardRevision: 1,
      movementRemainingFt: {},
      initiativeBonuses: {},
      initiative: [],
      log: [],
      outcome: 'active',
      actionPresentation: {
        'action:healing-hands': {
          imageUrl: image,
          actionRef: {
            id: 'action:healing-hands',
            name: 'Healing Hands',
            image_url: image,
          },
        },
      },
    } as unknown as SoloCombatState;

    const next = writeDedicatedCombatTurnState({}, runtime, combat);
    const persisted = next.solo_combat_v1 as SoloCombatState;
    const persistedPresentation = persisted.actionPresentation?.['action:healing-hands'];
    expect(persistedPresentation).not.toHaveProperty('imageUrl');
    expect(persistedPresentation?.actionRef?.image_url).toBe(image);
    expect(JSON.stringify(next).match(/data:image\/png;base64/g)).toHaveLength(1);

    const restored = readSoloCombatState(next, 'actor:owner', 7);
    expect(restored?.actionPresentation?.['action:healing-hands'].imageUrl).toBe(image);
    expect(restored?.actionPresentation?.['action:healing-hands'].actionRef?.image_url).toBe(image);
  });

  it('rebases every retained participant revision after out-of-combat sheet updates', () => {
    const combat = {
      characterId: 'actor:owner',
      controlledCharacterIds: ['actor:owner', 'actor:ally'],
      runtimeRevision: 7,
      participantRuntimeRevisions: {
        'actor:owner': 7,
        'actor:ally': 4,
      },
    } as unknown as SoloCombatState;

    const rebased = rebaseSoloCombatParticipantRuntimeRevisions(combat, {
      'actor:owner': 11,
      'actor:ally': 9,
    });

    expect(rebased.runtimeRevision).toBe(11);
    expect(rebased.participantRuntimeRevisions).toEqual({
      'actor:owner': 11,
      'actor:ally': 9,
    });
    expect(combat.runtimeRevision).toBe(7);
  });
});
