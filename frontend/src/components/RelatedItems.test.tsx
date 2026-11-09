// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardRef } from '../types';
import { useContainerTotals, useResolvedRefs } from './RelatedItems';

const mocks = vi.hoisted(() => ({ getCardsIndex: vi.fn() }));
vi.mock('../utils/cardsIndex', () => ({ getCardsIndex: mocks.getCardsIndex }));
vi.mock('./CardPreview', () => ({ default: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = { id: 'rope', name: 'Верёвка', weight: 3, price: 2 } as Card;
const refs: CardRef[] = [{ card_id: 'rope', quantity: 2 }];
const container = { id: 'bag', contents: refs } as Card;
function Probe({ card, references }: { card: Card | null; references: CardRef[] }) {
  const totals = useContainerTotals(card);
  const resolved = useResolvedRefs(references);
  return <div>{totals ? `${totals.weight}/${totals.gold}` : 'нет содержимого'}:{resolved.map(row => row.card.name).join(',')}</div>;
}

describe('related item loading', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    localStorage.removeItem('auth_token');
    mocks.getCardsIndex.mockReset().mockResolvedValue(new Map([[item.id, item]]));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem('auth_token'); });

  it('does not request an index until a container or reference actually needs it', async () => {
    await act(async () => root.render(<Probe card={null} references={[]} />));
    expect(mocks.getCardsIndex).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe card={{ id: 'empty', contents: [] } as unknown as Card} references={[]} />));
    expect(mocks.getCardsIndex).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe card={container} references={refs} />));
    expect(mocks.getCardsIndex).toHaveBeenCalled();
    expect(host.textContent).toBe('6/4:Верёвка');
  });

  it('ignores a pending index after its contents are removed', async () => {
    let finish!: (value: Map<string, Card>) => void;
    mocks.getCardsIndex.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<Probe card={container} references={[]} />));
    await act(async () => root.render(<Probe card={null} references={[]} />));
    await act(async () => finish(new Map([[item.id, item]])));
    expect(host.textContent).toBe('нет содержимого:');
  });

  it('loads referenced items when references appear without a container', async () => {
    await act(async () => root.render(<Probe card={null} references={[]} />));
    expect(mocks.getCardsIndex).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe card={null} references={refs} />));
    expect(mocks.getCardsIndex).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('нет содержимого:Верёвка');
  });

  it('does not show the previous account index while a new account is loading', async () => {
    localStorage.setItem('auth_token', 'first-session');
    await act(async () => root.render(<Probe card={container} references={refs} />));
    expect(host.textContent).toBe('6/4:Верёвка');
    let finish!: (value: Map<string, Card>) => void;
    mocks.getCardsIndex.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    localStorage.setItem('auth_token', 'second-session');
    await act(async () => root.render(<Probe card={container} references={refs} />));
    expect(host.textContent).not.toContain('Верёвка');
    await act(async () => finish(new Map()));
    expect(host.textContent).not.toContain('Верёвка');
  });

  it('does not revive an earlier index when references disappear and return', async () => {
    await act(async () => root.render(<Probe card={null} references={refs} />));
    expect(host.textContent).toContain('Верёвка');
    await act(async () => root.render(<Probe card={null} references={[]} />));
    mocks.getCardsIndex.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<Probe card={null} references={refs} />));
    expect(host.textContent).not.toContain('Верёвка');
  });
});
