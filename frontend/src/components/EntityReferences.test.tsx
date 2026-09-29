// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntityReferences from './EntityReferences';
import { referenceSummary, withoutEntityReferences, type EntityReferences as ReferenceFields } from '../api/entityReferences';
import { getSettings, setSetting } from '../settings';
import { bustPrefix, clearApiCache } from '../api/apiCache';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ apiClient: api }));
vi.mock('../hooks/useContentPermissions', () => ({ useContentPermissions: () => ({ canEdit: () => true }) }));
vi.mock('../api/entityTags', () => ({ tagError: (error: Error) => error.message }));
vi.mock('./CanonicalEntityPreview', () => ({ default: ({ entity }: { entity: { name: string } }) => <article>{entity.name}</article> }));
vi.mock('./ActionPreview', () => ({ default: ({ action }: { action: { name: string } }) => <article data-testid="action-preview">{action.name}</article> }));
vi.mock('./SpellPreview', () => ({ default: ({ spell }: { spell: { name: string } }) => <article data-testid="spell-preview">{spell.name}</article> }));
vi.mock('./EffectPreview', () => ({ default: () => null }));
vi.mock('./ItemPreview', () => ({ default: () => null }));
vi.mock('./CardPreview', () => ({ default: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const fields: ReferenceFields = {
  references: [{ entity_type: 'action', entity_id: 'a', name: 'Действие А', paths: ['mechanics.granted_actions[0]'] }],
  referenced_by: [
    { entity_type: 'class', entity_id: 'c', name: 'Класс Б', level: 3, paths: ['level_progression.3.effects[0]'] },
    { entity_type: 'race', entity_id: 'r', name: 'Вид В', level: 5, paths: ['level_progression.5.effects[0]'] },
  ],
};
async function render(props: React.ComponentProps<typeof EntityReferences>) {
  await act(async () => root.render(<MemoryRouter><EntityReferences {...props} /></MemoryRouter>));
}
async function openPanel() {
  await act(async () => {
    const panel = container.querySelector('details')!;
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); clearApiCache();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  api.get.mockImplementation(async (url: string) => ({ data: url.startsWith('/api/entity-references') ? fields :
    { id: url.split('/').pop(), name: url.includes('/classes/') ? 'Класс Б' : url.includes('/races/') ? 'Вид В' : 'Действие А' } }));
  api.post.mockResolvedValue({ data: fields });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe('mechanic references', () => {
  it.each(['row', 'icon'] as const)('uses canonical action presentation in %s mode and displays source levels', async mode => {
    setSetting('entityDisplay', { ...getSettings().entityDisplay, actions: mode });
    const close = vi.fn();
    await render({ type: 'effect', id: 'e', onNavigate: close });
    expect(api.get).not.toHaveBeenCalled();
    await openPanel();
    expect(api.get).toHaveBeenCalledWith('/api/entity-references/effect/e');
    expect(container.textContent).toContain('Класс · уровень 3');
    expect(container.textContent).toContain('Вид · уровень 5');
    const action = container.querySelector<HTMLButtonElement>(mode === 'icon' ? '.cs-action-tile' : '.sheet-item-row')!;
    expect(action).not.toBeNull();
    await act(async () => action.focus());
    expect(document.querySelector('[data-testid="action-preview"]')?.textContent).toBe('Действие А');
    expect(container.querySelector('[title]')).toBeNull();
    await act(async () => action.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it('previews unsaved mechanic fields through the backend and never invents textual relations', async () => {
    api.post.mockResolvedValue({ data: { references: [], referenced_by: [] } });
    const draft = { description: '[[Только текст|effect:text-only]]', mechanics: { granted_actions: ['a'] } };
    await render({ type: 'race', id: 'race-id', draft }); await openPanel();
    expect(api.post).toHaveBeenCalledWith('/api/entity-references/race/preview', { entity: { ...draft, id: 'race-id' } });
    expect(container.textContent).not.toContain('text-only');
    expect(container.querySelectorAll('.entity-references__item')).toHaveLength(0);
  });

  it('discards a stale preview when mechanic data changes', async () => {
    let resolveOld!: (value: { data: ReferenceFields }) => void;
    api.post.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await render({ type: 'feat', draft: { related_actions: ['old'] } }); await openPanel();
    api.post.mockResolvedValue({ data: { references: [], referenced_by: [] } });
    await render({ type: 'feat', draft: { related_actions: [] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => resolveOld({ data: fields }));
    expect(container.querySelectorAll('.entity-references__item')).toHaveLength(0);
  });

  it('reports refresh failures without replacing saved links', async () => {
    await render({ type: 'effect', id: 'e' }); await openPanel();
    api.post.mockRejectedValueOnce(new Error('Нет прав'));
    const button = [...container.querySelectorAll('button')].find(row => row.textContent === 'Пересчитать сохранённые связи')!;
    await act(async () => button.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Нет прав');
    expect(container.textContent).toContain('Класс Б');
  });

  it('updates an open panel when another saved entity changes its incoming links', async () => {
    await render({ type: 'effect', id: 'e' }); await openPanel();
    expect(container.textContent).toContain('Класс Б');
    api.get.mockResolvedValue({ data: { references: [], referenced_by: [] } });
    await act(async () => bustPrefix('/api/classes'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(container.textContent).not.toContain('Класс Б');
    expect(api.get.mock.calls.filter(([path]) => path === '/api/entity-references/effect/e')).toHaveLength(2);
  });

  it('loads a shared source once when it grants the same entity at several levels', async () => {
    api.get.mockImplementation(async (url: string) => ({ data: url.startsWith('/api/entity-references')
      ? { references: [], referenced_by: [fields.referenced_by![0], { ...fields.referenced_by![0], level: 5 }] }
      : { id: 'c', name: 'Класс Б' } }));
    await render({ type: 'effect', id: 'e' }); await openPanel();
    expect(container.textContent).toContain('Класс · уровень 3');
    expect(container.textContent).toContain('Класс · уровень 5');
    expect(api.get.mock.calls.filter(([path]) => path === '/api/classes/c')).toHaveLength(1);
  });

  it('keeps compact effect origins distinct from outgoing references', () => {
    expect(referenceSummary({ references: fields.references, referenced_by: [] })).toBe('Нет входящих связей');
    expect(referenceSummary(fields)).toBe('Используется: Класс Б · уровень 3; Вид В · уровень 5');
  });

  it('keeps derived indexes out of ordinary authoring payloads', () => {
    const mechanics = { granted_actions: ['a'] };
    expect(withoutEntityReferences({ key: 'passive', mechanics, ...fields })).toEqual({ key: 'passive', mechanics });
  });
});
