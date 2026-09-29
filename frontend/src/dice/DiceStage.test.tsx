// @vitest-environment jsdom
import {act, useEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import D20RollTray from './D20RollTray';
import {CommittedDie} from './CommittedD20';
import DiceStage, {useDiceVisualStart} from './DiceStage';
import CombatPresentationDialog from '../components/CombatPresentationDialog';
import type {CombatBeat} from '../solo-combat/presentation';
import type {RollLog} from '../mvp/contracts';

const mocks = vi.hoisted(() => ({draw: vi.fn(() => true), play: vi.fn(), available: true}));
vi.mock('./d20Renderer', () => ({createCommittedDieRenderer: () => mocks.available ? {draw: mocks.draw, dispose: vi.fn()} : null}));
vi.mock('../audio/player', () => ({soundPlayer: {playDefault: mocks.play}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const roll: RollLog = {kind: 'd20', dice: [{sides: 20, result: 8}], advantage: 'none', modifiers: [], total: 8, text: ''};

describe('dice audio follows the visible throw', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); mocks.play.mockClear(); mocks.draw.mockReset().mockReturnValue(true); mocks.available = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({matches: false})));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  it('plays once for an advantage group, after a successful animated draw', async () => {
    const paired: RollLog = {...roll, advantage: 'advantage', dice: [...roll.dice, {sides: 20, result: 3, discarded: true}]};
    await act(async () => root.render(<D20RollTray roll={paired} rolling/>));
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith('diceRoll', expect.any(String));
    await act(async () => vi.advanceTimersByTime(800));
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });
  it('waits for a successful visual frame and chooses a single-die sound', async () => {
    mocks.draw.mockReturnValue(false);
    await act(async () => root.render(<CommittedDie sides={8} value={4} rolling/>));
    expect(mocks.play).not.toHaveBeenCalled();
    mocks.draw.mockReturnValue(true);
    await act(async () => vi.advanceTimersByTime(20));
    expect(mocks.play).toHaveBeenCalledWith('diceSingle', expect.any(String));
  });
  it.each(['fallback', 'reduced', 'settled'] as const)('does not play for %s dice', async mode => {
    mocks.available = mode !== 'fallback';
    if (mode === 'reduced') vi.stubGlobal('matchMedia', vi.fn(() => ({matches: true})));
    await act(async () => root.render(<CommittedDie sides={20} value={8} rolling={mode !== 'settled'}/>));
    await act(async () => vi.advanceTimersByTime(1600));
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('keeps one attack sound when a held throw is confirmed and sounds only the newly shown damage', async () => {
    const held: CombatBeat = {id: 'held', sourceEntryId: 'entry', sourceId: 'hero', sourceName: 'Герой', actionName: 'Удар', cues: [], roll: {...roll, target: {type: 'ac', value: 5}, outcome: 'hit'}};
    await act(async () => root.render(<CombatPresentationDialog beat={held} provisional modeOverride="standard" onClose={() => {}}/>));
    await act(async () => vi.advanceTimersByTime(1500));
    expect(mocks.play).toHaveBeenCalledTimes(1);
    const confirmed: CombatBeat = {...held, id: 'confirmed', rollPhase: 'after-reaction', damage: [{amount: 6, damageType: 'fire', roll: {...roll, kind: 'damage', dice: [{sides: 6, result: 2}, {sides: 6, result: 4}], total: 6}}]};
    await act(async () => root.render(<CombatPresentationDialog beat={confirmed} modeOverride="standard" onClose={() => {}}/>));
    expect(mocks.play.mock.calls.map(call => call[0])).toEqual(['diceSingle', 'diceRoll']);
  });
  it('cancels a queued start when the stage unmounts', async () => {
    let start: () => void = () => {};
    function Probe() { const report = useDiceVisualStart('die'); useEffect(() => {start = report;}, [report]); return null; }
    await act(async () => root.render(<DiceStage rollKey="cancel" diceCount={3}><Probe/></DiceStage>));
    start();
    act(() => root.render(null));
    await act(async () => {});
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('cancels remaining render frames on removal', async () => {
    mocks.draw.mockReturnValue(false);
    await act(async () => root.render(<CommittedDie sides={20} value={8} rolling/>));
    await act(async () => root.render(null));
    const count = mocks.draw.mock.calls.length;
    mocks.draw.mockReturnValue(true);
    await act(async () => vi.advanceTimersByTime(1600));
    expect(mocks.draw).toHaveBeenCalledTimes(count);
    expect(mocks.play).not.toHaveBeenCalled();
  });
});
