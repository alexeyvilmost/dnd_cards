// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';
import SheetAttunementDialog from './SheetAttunementDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cards = [
  { id: 'cloak', name: 'Cloak', type: 'cloak', rarity: 'rare', requires_attunement: true },
  { id: 'ring', name: 'Ring', type: 'ring', rarity: 'rare', requires_attunement: true },
] as Card[];

describe('attunement availability', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(cards)('marks $name unavailable until a rest and allows it after the rest', async (card) => {
    const onToggle = vi.fn();
    const props = { attunedCards: [], attunableCards: [card], max: 3, onToggle, onClose: vi.fn() };
    await act(async () => root.render(<SheetAttunementDialog {...props} canChange={false} />));
    const locked = container.querySelector<HTMLElement>('.sheet-item-row')!;
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.tabIndex).toBe(-1);
    expect(container.textContent).toContain('только на коротком или долгом отдыхе');
    await act(async () => locked.click()); expect(onToggle).not.toHaveBeenCalled();
    await act(async () => root.render(<SheetAttunementDialog {...props} canChange />));
    const unlocked = container.querySelector<HTMLElement>('.sheet-item-row')!;
    expect(unlocked.getAttribute('aria-disabled')).toBeNull();
    await act(async () => unlocked.click()); expect(onToggle).toHaveBeenCalledExactlyOnceWith(card.id);
  });

  it('blocks additions at capacity while allowing removal and shows a failed save inside the dialog', async () => {
    const onToggle = vi.fn();
    await act(async () => root.render(<SheetAttunementDialog attunedCards={[cards[0]]}
      attunableCards={[cards[1]]} max={1} canChange error="Не удалось сохранить настройку"
      onToggle={onToggle} onClose={vi.fn()} />));
    const [remove, add] = [...container.querySelectorAll<HTMLElement>('.sheet-item-row')];
    expect(remove.getAttribute('aria-disabled')).toBeNull();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { add.click(); remove.click(); });
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(cards[0].id);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось сохранить настройку');
  });

  it('disables both removal and additions during a save', async () => {
    const onToggle = vi.fn();
    await act(async () => root.render(<SheetAttunementDialog attunedCards={[cards[0]]}
      attunableCards={[cards[1]]} max={3} canChange busy onToggle={onToggle} onClose={vi.fn()} />));
    const rows = [...container.querySelectorAll<HTMLElement>('.sheet-item-row')];
    expect(rows).toHaveLength(2);
    await act(async () => rows.forEach(row => row.click()));
    expect(rows.every(row => row.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
