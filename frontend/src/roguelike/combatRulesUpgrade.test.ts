// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import {ApiRequestError} from '../api/client';
import {commandCombatRulesUpgrade} from './combatRulesUpgrade';
import type {RoguelikeRun} from './api';
const mocks = vi.hoisted(() => ({command: vi.fn()}));
vi.mock('./api', () => ({roguelikeApi: mocks}));
const run = {id: 'run-upgrade', revision: 4} as RoguelikeRun;
beforeEach(() => {localStorage.clear(); mocks.command.mockReset();});
it('retains the same receipt and revision after an uncertain response/reload without storing private state', async () => {
  mocks.command.mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce({...run, revision: 5});
  await expect(commandCombatRulesUpgrade(run)).rejects.toThrow('network lost');
  const first = mocks.command.mock.calls[0];
  const stored = JSON.parse(localStorage.getItem('boh:combat-rules-upgrade:v1:run-upgrade')!);
  expect(Object.keys(stored).sort()).toEqual(['id', 'revision']);
  await commandCombatRulesUpgrade({...run, revision: 5});
  expect(mocks.command.mock.calls[1]).toEqual(first);
  expect(localStorage.length).toBe(0);
});
it('clears definitely rejected commands so a fresh confirmed revision can be selected', async () => {
  mocks.command.mockRejectedValueOnce(new ApiRequestError('stale', 409, 'run_revision_conflict')).mockResolvedValueOnce(run);
  await expect(commandCombatRulesUpgrade(run)).rejects.toThrow('stale');
  await commandCombatRulesUpgrade({...run, revision: 5});
  expect(mocks.command.mock.calls[1][1]).toBe(5);
  expect(mocks.command.mock.calls[1][4]).not.toBe(mocks.command.mock.calls[0][4]);
});
