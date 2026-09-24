// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntityRefPreview from './EntityRefPreview';

const mocks = vi.hoisted(() => ({
  settings: { itemPreview: 'interface' },
  entity: { id: 'library-entity', name: 'Сущность библиотеки' },
  card: vi.fn(), item: vi.fn(), spell: vi.fn(),
}));
vi.mock('../settings', () => ({ useSiteSettings: () => mocks.settings }));
vi.mock('./EntityRefRegistry', () => ({ useEntityRef: () => ({ entity: mocks.entity, loading: false, error: null }) }));
vi.mock('./CardPreview', () => ({ default: (props: object) => { mocks.card(props); return <div>Карта</div>; } }));
vi.mock('./ItemPreview', () => ({ default: (props: object) => { mocks.item(props); return <div>Интерфейс</div>; } }));
vi.mock('./SpellPreview', () => ({ default: (props: object) => { mocks.spell(props); return <div>Заклинание</div>; } }));
vi.mock('./ActionPreview', () => ({ default: () => null }));
vi.mock('./EffectPreview', () => ({ default: () => null }));
vi.mock('./ConceptPreview', () => ({ default: () => null }));
vi.mock('./ResourcePreview', () => ({ default: () => null }));
vi.mock('./VariablePreview', () => ({ default: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('canonical entity reference previews', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.itemPreview = 'interface';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(['interface', 'card'])('uses the configured %s item preview with the canonical resolved entity', async mode => {
    mocks.settings.itemPreview = mode;
    await act(async () => root.render(<EntityRefPreview type="card" id="library-entity" />));
    const selected = mode === 'interface' ? mocks.item : mocks.card;
    const other = mode === 'interface' ? mocks.card : mocks.item;
    expect(selected).toHaveBeenCalledExactlyOnceWith({ card: mocks.entity, disableHover: true });
    expect(other).not.toHaveBeenCalled();
    expect(mocks.spell).not.toHaveBeenCalled();
  });

  it('keeps spell previews unchanged when the item presentation setting changes', async () => {
    for (const mode of ['interface', 'card']) {
      mocks.settings.itemPreview = mode;
      await act(async () => root.render(<EntityRefPreview type="spell" id="library-entity" />));
    }
    expect(mocks.spell).toHaveBeenCalledTimes(2);
    expect(mocks.spell).toHaveBeenLastCalledWith({ spell: mocks.entity, disableHover: true });
    expect(mocks.item).not.toHaveBeenCalled();
    expect(mocks.card).not.toHaveBeenCalled();
  });
});
