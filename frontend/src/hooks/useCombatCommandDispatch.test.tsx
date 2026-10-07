// @vitest-environment jsdom
import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {RoguelikeRun} from '../roguelike/api';
import type {SoloCombatState} from '../solo-combat/types';
import {useCombatCommandDispatch} from './useCombatCommandDispatch';

const api = vi.hoisted(() => ({command: vi.fn(), get: vi.fn()}));
vi.mock('../roguelike/api', () => ({roguelikeApi: api}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function run(revision = 7) {
  return {id: 'owned-run', revision, character: {id: 'fighter'},
    combat_state: {world: {revision}, rng: {seed: 'saved-seed', counter: revision}}} as unknown as RoguelikeRun;
}

describe('combat command lifecycle', () => {
  let root: Root, container: HTMLDivElement;
  let dispatch: ReturnType<typeof useCombatCommandDispatch>;
  let sessionKey: string;
  const runRef: {current: RoguelikeRun | null} = {current: null};
  const presentationBlockedRef = {current: false};
  const applyLocal = vi.fn(), setBusy = vi.fn(), setError = vi.fn();
  const onAccepted = vi.fn((accepted: RoguelikeRun) => { runRef.current = accepted; });
  const local = vi.fn(() => { throw new Error('Trusted commands must not execute locally'); });
  const intent = {type: 'end_turn', actorId: 'fighter'} as const;
  function Harness() {
    dispatch = useCombatCommandDispatch({sessionKey, runRef, presentationBlockedRef, applyLocal, onAccepted, setBusy, setError});
    return null;
  }
  const render = () => act(async () => root.render(<StrictMode><Harness/></StrictMode>));
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionKey = 'fighter:owned-run'; runRef.current = run(); presentationBlockedRef.current = false;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('serializes the explicit upgrade with gameplay and discards responses after changing sessions', async () => {
    const pending = deferred<RoguelikeRun>(); api.command.mockReturnValueOnce(pending.promise);
    let completion: Promise<void>;
    await act(async () => { completion = dispatch.upgrade(); dispatch(intent, local); });
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command.mock.calls[0].slice(0,4)).toEqual(['owned-run',7,'upgrade_combat_rules',{}]);
    sessionKey = 'other:other-run'; const other = {...run(2),id:'other-run'}; runRef.current = other;
    await render();
    await act(async () => { pending.resolve(run(8)); await completion; });
    expect(onAccepted).not.toHaveBeenCalled(); expect(runRef.current).toBe(other);
    expect(setBusy.mock.calls).toEqual([[true]]);
  });

  it('reconciles a lost response before unlocking and uses the confirmed revision on the next click', async () => {
    const command = deferred<RoguelikeRun>(), reconciliation = deferred<RoguelikeRun>();
    api.command.mockReturnValueOnce(command.promise); api.get.mockReturnValueOnce(reconciliation.promise);
    await act(async () => { dispatch(intent, local); dispatch(intent, local); });
    await render();
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(api.command).toHaveBeenLastCalledWith('owned-run', 7, 'combat_intent', {intent});
    await act(async () => command.reject(new Error('Ответ потерян')));
    expect(api.get).toHaveBeenCalledExactlyOnceWith('owned-run');
    await render();
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenCalledTimes(1);
    expect(setBusy.mock.calls).toEqual([[true]]);
    expect(onAccepted).not.toHaveBeenCalled();

    const committed = run(8), serialized = JSON.stringify(committed);
    await act(async () => reconciliation.resolve(committed));
    expect(onAccepted).toHaveBeenCalledExactlyOnceWith(committed);
    expect(runRef.current).toBe(committed);
    expect(JSON.stringify(committed)).toBe(serialized);
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenLastCalledWith('Ответ потерян');
    expect(local).not.toHaveBeenCalled();
    expect(applyLocal).not.toHaveBeenCalled();

    const next = run(9); api.command.mockResolvedValueOnce(next);
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenLastCalledWith('owned-run', 8, 'combat_intent', {intent});
    expect(onAccepted).toHaveBeenLastCalledWith(next);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'incomplete'] as const)('keeps the last confirmed run if reconciliation is %s', async failure => {
    const confirmed = runRef.current;
    api.command.mockRejectedValueOnce(new Error('character runtime revision is stale'));
    if (failure === 'unavailable') api.get.mockRejectedValueOnce(new Error('Offline'));
    else api.get.mockResolvedValueOnce({...run(8), character: null});
    await act(async () => dispatch(intent, local));
    expect(runRef.current).toBe(confirmed);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    expect(setError).toHaveBeenLastCalledWith('Лист изменился в другой вкладке или во время боя.');
    api.command.mockResolvedValueOnce(run(8));
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenCalledTimes(2);
    expect(api.command).toHaveBeenLastCalledWith('owned-run', 7, 'combat_intent', {intent});
  });

  it('allows held-roll continuations through the presentation gate without sending a regular command', async () => {
    presentationBlockedRef.current = true;
    await act(async () => dispatch(intent, local));
    expect(api.command).not.toHaveBeenCalled();
    const continuations = [{type: 'd20_interrupt', actorId: 'fighter'},
      {type: 'death_save', actorId: 'fighter', phase: 'resolved'}] as const;
    for (const continuation of continuations) {
      api.command.mockResolvedValueOnce(run(runRef.current!.revision + 1));
      await act(async () => dispatch(continuation, local));
      expect(api.command).toHaveBeenLastCalledWith('owned-run', runRef.current!.revision - 1,
        'combat_intent', {intent: continuation});
    }
    expect(api.command).toHaveBeenCalledTimes(2);
    expect(api.get).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'lost-response'] as const)('does not publish a late %s from the previous route or unlock the next run', async outcome => {
    const previous = deferred<RoguelikeRun>(), current = deferred<RoguelikeRun>();
    api.command.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    await act(async () => dispatch(intent, local));
    sessionKey = 'other:other-run';
    const nextRun = {...run(2), id: 'other-run'};
    runRef.current = nextRun;
    await render();
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenCalledTimes(2);
    await act(async () => outcome === 'accepted' ? previous.resolve(run(8)) : previous.reject(new Error('Old response lost')));
    expect(onAccepted).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(runRef.current).toBe(nextRun);
    expect(setBusy.mock.calls).toEqual([[true], [true]]);
    expect(setError.mock.calls).toEqual([[null], [null]]);
    await act(async () => dispatch(intent, local));
    expect(api.command).toHaveBeenCalledTimes(2);
    const accepted = {...nextRun, revision: 3};
    await act(async () => current.resolve(accepted));
    expect(onAccepted).toHaveBeenCalledExactlyOnceWith(accepted);
    expect(setBusy.mock.calls).toEqual([[true], [true], [false]]);
  });

  it('discards a reconciliation that finishes after the route changes', async () => {
    const reconciliation = deferred<RoguelikeRun>();
    api.command.mockRejectedValueOnce(new Error('Response lost'));
    api.get.mockReturnValueOnce(reconciliation.promise);
    await act(async () => dispatch(intent, local));
    expect(api.get).toHaveBeenCalledExactlyOnceWith('owned-run');
    sessionKey = 'other:other-run'; runRef.current = {...run(2), id: 'other-run'};
    await render();
    await act(async () => reconciliation.resolve(run(8)));
    expect(onAccepted).not.toHaveBeenCalled();
    expect(setError.mock.calls).toEqual([[null]]);
    expect(setBusy.mock.calls).toEqual([[true]]);
    expect(runRef.current.id).toBe('other-run');
  });

  it('does not publish or reconcile after the owning page unmounts', async () => {
    const command = deferred<RoguelikeRun>(); api.command.mockReturnValueOnce(command.promise);
    await act(async () => dispatch(intent, local));
    await act(async () => root.render(null));
    await act(async () => command.reject(new Error('Response lost')));
    expect(api.get).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(setError.mock.calls).toEqual([[null]]);
    expect(setBusy.mock.calls).toEqual([[true]]);
  });

  it('keeps errors from local preview execution local and does not create a server command', async () => {
    runRef.current = null;
    const failLocal = () => { throw new Error('OutOfRange: target is outside 30 ft range'); };
    await act(async () => dispatch(intent, failLocal as () => SoloCombatState));
    expect(api.command).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(applyLocal).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Цель вне дистанции действия (30 фт.).');
  });
});
