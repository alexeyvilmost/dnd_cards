import {describe, expect, it} from 'vitest';
import inputJson from './pinnedFighter.fixture.json';
import type {ForgeCharacter} from '../character/types';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';

const fixture = inputJson as unknown as {character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[]};
describe('pinned fighter dependency closure', () => {
  const spell = (id: string, cardNumber: string) => ({id, card_number: cardNumber,
    name: 'Свет', name_en: "  Traveler's Light  ", description: '', level: 0, mechanics: {},
  } as FrozenCombatCatalog['entities']['spell'][number]);

  it.each(['11111111-1111-4111-8111-111111111111', 'travelers_light'])('keeps an exact spell reference %s usable despite duplicate English aliases', async reference => {
    const input = structuredClone(fixture);
    input.catalog.entities.spell = [spell('11111111-1111-4111-8111-111111111111', 'travelers_light'), spell('22222222-2222-4222-8222-222222222222', 'other-card')];
    input.character.spell_ids = [reference];
    expect((await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds)).status).toBe('ready');
  });

  it('resolves a unique trimmed case-insensitive English alias', async () => {
    const input = structuredClone(fixture);
    input.catalog.entities.spell = [spell('11111111-1111-4111-8111-111111111111', 'spell-card')];
    input.character.spell_ids = ['  TRAVELERS_LIGHT  '];
    expect((await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds)).status).toBe('ready');
  });

  it('rejects an actually requested ambiguous alias even when assembly catches optional loads', async () => {
    const input = structuredClone(fixture);
    input.catalog.entities.spell = [spell('11111111-1111-4111-8111-111111111111', 'spell-card'), spell('22222222-2222-4222-8222-222222222222', 'other-card')];
    input.character.spell_ids = ['travelers_light'];
    await expect(prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds)).rejects.toThrow('Неоднозначная ссылка');
  });

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

  it('requests all sibling effects of a wide action together before freezing the participant', async () => {
    const input = structuredClone(fixture);
    const actionId = 'a1000000-0000-4000-8000-000000000001';
    const effects = Array.from({length: 24}, (_, index) => ({
      ...input.catalog.entities.effect[0],
      id: `b1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      card_number: `EFFECT-wide-action-${index}`, name: `Wide effect ${index}`,
      type: 'Эффект', mechanics: {effects: []},
    } as FrozenCombatCatalog['entities']['effect'][number]));
    input.character.action_ids = [actionId];
    input.catalog.entities.action.push({
      ...input.catalog.entities.action[0],
      id: actionId, card_number: 'ACT-wide-effects', name: 'Wide action', type: 'basic',
      mechanics: {activation: {mode: 'active', cost: [{resource: 'action'}]},
        effects: [{resolution: 'auto', result: effects.map(effect => ({kind: 'grant_effect', value: effect.card_number}))}]},
    } as FrozenCombatCatalog['entities']['action'][number]);

    const pending = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(pending.status).toBe('needs_content');
    if (pending.status !== 'needs_content') throw Error('unexpected ready build');
    expect(pending.needs).toEqual(effects.map(effect => ({
      kind: 'entity', entityType: 'effect', reference: effect.card_number,
    })));
    input.catalog.entities.effect.push(...effects);
    const ready = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw Error('unresolved siblings');
    expect(Object.keys(ready.participant.canonical.world.actors[input.character.id].grantedEffects ?? {}))
      .toEqual(expect.arrayContaining(effects.map(effect => effect.card_number)));
  });

  it('requests all sibling actions provided by a reachable effect together', async () => {
    const input = structuredClone(fixture);
    const rootId = 'a2000000-0000-4000-8000-000000000001';
    const effectRef = 'EFFECT-wide-action-provider';
    const actions = Array.from({length: 20}, (_, index) => ({
      ...input.catalog.entities.action[0],
      id: `c2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      card_number: `ACT-wide-provider-${index}`, name: `Granted action ${index}`, type: 'class',
      mechanics: {activation: {mode: 'active', cost: [{resource: 'bonus_action'}]},
        effects: [{resolution: 'auto', result: [{kind: 'temp_hp', amount: String(index + 1)}]}]},
    } as FrozenCombatCatalog['entities']['action'][number]));
    input.character.action_ids = [rootId];
    input.catalog.entities.action.push({
      ...input.catalog.entities.action[0],
      id: rootId, card_number: 'ACT-wide-provider-root', name: 'Summon action provider', type: 'basic',
      mechanics: {activation: {mode: 'active', cost: [{resource: 'action'}]},
        effects: [{resolution: 'auto', result: [{kind: 'grant_effect', value: effectRef}]}]},
    } as FrozenCombatCatalog['entities']['action'][number]);
    const missingProvider = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(missingProvider).toEqual({status: 'needs_content', needs: [
      {kind: 'entity', entityType: 'effect', reference: effectRef},
    ]});
    input.catalog.entities.effect.push({
      ...input.catalog.entities.effect[0],
      id: 'b2000000-0000-4000-8000-000000000001', card_number: effectRef,
      name: 'Wide action provider', type: 'Эффект',
      mechanics: {duration: {type: 'rounds', amount: 2},
        effects: [{resolution: 'auto', result: actions.map(action => ({kind: 'grant_action', value: action.card_number}))}]},
    } as FrozenCombatCatalog['entities']['effect'][number]);

    const pending = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(pending.status).toBe('needs_content');
    if (pending.status !== 'needs_content') throw Error('unexpected ready build');
    expect(pending.needs).toEqual(actions.map(action => ({
      kind: 'entity', entityType: 'action', reference: action.card_number,
    })));
    input.catalog.entities.action.push(...actions);
    const ready = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw Error('unresolved siblings');
    for (const action of actions) {
      expect(ready.participant.canonical.actions).toContainEqual(expect.objectContaining({
        id: action.id,
        mechanics: expect.objectContaining({requires_runtime_action_grant: [action.card_number, action.id]}),
      }));
    }
  });
});
