// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import Dice3DOverlay from './Dice3DOverlay';

const mocks = vi.hoisted(() => ({play: vi.fn(), update: vi.fn(), roll: vi.fn(), box: null as null | {isVisible: boolean; onBeforeRoll: (value: unknown) => void}}));
vi.mock('../audio/player', () => ({soundPlayer: {playDefault: mocks.play}}));
vi.mock('@3d-dice/dice-box', () => ({default: class {
  isVisible = true;
  onBeforeRoll = (_value: unknown) => {};
  constructor() { mocks.box = this; }
  init() { return Promise.resolve(); }
  clear() { return this; }
  updateConfig() { return mocks.update(); }
  roll(notation: unknown) { mocks.roll(notation); this.onBeforeRoll(notation); return new Promise(() => {}); }
}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const props = {active: true, requestKey: 'request', plan: [{sides: 20, label: 'Атака'}], title: 'Бросок', autoThrow: true, targetId: '', onTargetChange: () => {}, onComplete: () => {}, onCancel: () => {}, onFallback: () => {}};

describe('physical dice throw sound', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); mocks.play.mockClear(); mocks.roll.mockClear(); mocks.update.mockReset().mockResolvedValue(undefined); mocks.box = null;
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks();
  });
  it('starts one sound on the rendering frame after the library begins a throw', async () => {
    await act(async () => root.render(<Dice3DOverlay {...props}/>));
    expect(mocks.roll).toHaveBeenCalledTimes(1);
    expect(mocks.play).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(20));
    expect(mocks.play).toHaveBeenCalledWith('diceSingle', expect.any(String));
    await act(async () => root.render(<Dice3DOverlay {...props}/>));
    await act(async () => vi.advanceTimersByTime(20));
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(mocks.roll).toHaveBeenCalledTimes(1);
  });
  it('cancels the pending frame when a request closes', async () => {
    await act(async () => root.render(<Dice3DOverlay {...props}/>));
    await act(async () => root.render(<Dice3DOverlay {...props} active={false}/>));
    await act(async () => vi.advanceTimersByTime(30));
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('does not roll or play after an async configuration completes for an obsolete request', async () => {
    let finish = () => {};
    mocks.update.mockImplementation(() => new Promise<void>(resolve => {finish = resolve;}));
    await act(async () => root.render(<Dice3DOverlay {...props}/>));
    await act(async () => root.render(<Dice3DOverlay {...props} active={false}/>));
    await act(async () => {finish();});
    await act(async () => vi.advanceTimersByTime(30));
    expect(mocks.roll).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('does not sound a WebGL fallback without a visible canvas', async () => {
    await act(async () => root.render(<Dice3DOverlay {...props}/>));
    mocks.box!.isVisible = false;
    await act(async () => vi.advanceTimersByTime(20));
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('uses the group sound for multiple physical dice', async () => {
    await act(async () => root.render(<Dice3DOverlay {...props} plan={[...props.plan, {sides: 6, label: 'Урон'}]}/>));
    await act(async () => vi.advanceTimersByTime(20));
    expect(mocks.play).toHaveBeenCalledWith('diceRoll', expect.any(String));
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });
});
