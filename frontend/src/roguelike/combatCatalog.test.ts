import {describe, expect, it} from 'vitest';
import inputJson from './pinnedFighter.fixture.json';
import type {ForgeCharacter} from '../character/types';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';

const fixture = inputJson as unknown as {character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[]};
describe('pinned fighter dependency closure', () => {
  it('builds the existing fighter from an immutable offline catalog', async () => {
    const input = structuredClone(fixture);
    const result = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('missing content');
    const actor = result.participant.canonical.world.actors[input.character.id];
    expect(actor.ac).toBe(12);
    expect(actor.runtime.hp).toMatchObject({current: 22, max: 22});
    expect(result.participant.canonical.actions.length).toBeGreaterThan(10);
    expect(input).toEqual(fixture);
    const second = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(second.status === 'ready' ? second.contentManifestHash : '').toBe(result.contentManifestHash);
  });
  it('reports missing class content instead of silently dropping class features', async () => {
    const input = structuredClone(fixture);
    input.catalog.entities.class = [];
    const result = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(result.status).toBe('needs_content');
    if (result.status !== 'needs_content') throw Error('unexpected ready build');
    expect(result.needs).toContainEqual({kind: 'entity', entityType: 'class', reference: input.character.class_id});
  });
  it('requires a complete mastery list even when some rows are already cached', async () => {
    const input = structuredClone(fixture);
    input.catalog.completeEffectTypes = input.catalog.completeEffectTypes.filter(type => type !== 'Эффект мастерства');
    const result = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(result.status).toBe('needs_content');
    if (result.status !== 'needs_content') throw Error('unexpected ready build');
    expect(result.needs).toContainEqual({kind: 'effect_type', effectType: 'Эффект мастерства'});
  });
});
