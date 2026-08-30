import { expect, it } from 'vitest';
import { actionsApi, cardsApi, effectsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { monstersApi } from '../monsters/api';
import { createSoloCombatState } from './engine';
import { writeDedicatedCombatTurnState } from './turnState';

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

it.runIf(process.env.LIVE_SIZE_USERNAME && process.env.LIVE_SIZE_PASSWORD)(
  'measures the production Bard + Goliath + Goblin continuation without mutating production',
  async () => {
    const response = await fetch('https://bagofholding.ru/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.LIVE_SIZE_USERNAME,
        password: process.env.LIVE_SIZE_PASSWORD,
      }),
    });
    expect(response.ok).toBe(true);
    const auth = await response.json() as { token: string };
    const storage = new Map<string, string>([['auth_token', auth.token]]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });

    const [bard, goliath, cardRows, basicRows, goblin] = await Promise.all([
      charactersV3Api.get('100eb271-ad36-4045-9aea-ef0d01a9e395'),
      charactersV3Api.get('84e8c110-bbba-41be-85ef-9165c376d746'),
      cardsApi.getCards({ limit: 5000 }),
      actionsApi.getActions({ type: 'basic', limit: 100 }),
      monstersApi.get('c1000000-0000-4000-8000-000000000001'),
    ]);
    const [monsterActions, monsterEffects] = await Promise.all([
      Promise.all(goblin.action_ids.map((id) => actionsApi.getAction(id))),
      Promise.all(goblin.effect_ids.map((id) => effectsApi.getEffect(id))),
    ]);
    const allActions = [...new Map(
      [...monsterActions, ...basicRows.actions].map((action) => [action.id, action]),
    ).values()];
    const cards = new Map(cardRows.cards.map((card) => [card.id, card]));
    const participant = await loadSheetCombatParticipant({
      character: bard,
      basicActions: basicRows.actions,
      cards,
    });
    const ally = await loadSheetCombatParticipant({
      character: goliath,
      basicActions: basicRows.actions,
      cards,
    });
    const state = await createSoloCombatState({
      character: bard,
      participant,
      allies: [ally],
      selected: [{ monster: goblin, quantity: 1 }],
      actions: allActions,
      effects: monsterEffects,
      rng: () => 0.5,
    });
    const predicted = {
      ...state,
      runtimeRevision: Number(bard.runtime_revision ?? 0) + 1,
      participantRuntimeRevisions: Object.fromEntries([
        [bard.id, Number(bard.runtime_revision ?? 0) + 1],
        [goliath.id, Number(goliath.runtime_revision ?? 0) + 1],
      ]),
    };
    const turnState = writeDedicatedCombatTurnState(
      bard.turn_state,
      predicted.world.actors[bard.id].runtime,
      predicted,
    );
    const fields = Object.fromEntries(Object.entries(predicted).map(([key, value]) => [
      key,
      byteLength(value),
    ]));
    const presentationEntries = Object.fromEntries(Object.entries(predicted.actionPresentation ?? {}).map(
      ([key, value]) => [key, byteLength(value)],
    ));
    console.log(JSON.stringify({
      turnStateBytes: byteLength(turnState),
      originalTurnStateBytes: byteLength(bard.turn_state),
      soloStateBytes: byteLength(predicted),
      fields,
      actionCount: predicted.catalogActions.length,
      presentationCount: Object.keys(predicted.actionPresentation ?? {}).length,
      largestPresentationEntries: Object.entries(presentationEntries)
        .sort((left, right) => right[1] - left[1]).slice(0, 10),
    }, null, 2));
    expect(byteLength(turnState)).toBeLessThanOrEqual(768 * 1024);
  },
  120_000,
);
