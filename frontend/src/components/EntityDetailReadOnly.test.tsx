// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityDetailProvider } from './EntityDetailProvider';
import { EntityDetailContext, useEntityDetail } from '../contexts/entityDetail';
import EntityImageEditor from './EntityImageEditor';
import type { EntityRefType } from './EntityRefRegistry';

const mocks = vi.hoisted(() => ({
  deleteCard: vi.fn(), deleteSpell: vi.fn(), deleteAction: vi.fn(), deleteEffect: vi.fn(),
  deleteConcept: vi.fn(), deleteResource: vi.fn(), deleteVariable: vi.fn(), update: vi.fn(),
  generate: vi.fn(), generateCard: vi.fn(), tagList: vi.fn(), tagGet: vi.fn(), tagWrite: vi.fn(), evict: vi.fn(),
}));

vi.mock('../api/client', () => ({
  cardsApi: { deleteCard: mocks.deleteCard, updateCard: mocks.update },
  spellsApi: { deleteSpell: mocks.deleteSpell, updateSpell: mocks.update },
  actionsApi: { deleteAction: mocks.deleteAction, updateAction: mocks.update },
  effectsApi: { deleteEffect: mocks.deleteEffect, updateEffect: mocks.update },
  conceptsApi: { deleteConcept: mocks.deleteConcept },
  resourcesApi: { deleteResource: mocks.deleteResource },
  variablesApi: { deleteVariable: mocks.deleteVariable },
}));
vi.mock('../api/imagesApi', () => ({ imagesApi: { generateStandalone: mocks.generate, generateImage: mocks.generateCard } }));
vi.mock('../hooks/useContentPermissions', () => ({
  useContentPermissions: () => ({ admin: true, canEdit: () => true, canCreate: () => true, ready: true }),
}));
vi.mock('../api/entityTags', () => ({
  entityTagsApi: { get: mocks.tagGet, list: mocks.tagList, set: mocks.tagWrite, create: mocks.tagWrite },
  merchantSettingsApi: { item: async () => ({ card_id: 'card-one', min_level: 1, weight: 1, kind: 'equipment', quantity: 1, price: null }), saveItem: mocks.tagWrite },
  tagError: (error: Error) => error.message,
}));
vi.mock('../settings', () => ({ useSiteSettings: () => ({ itemPreview: 'card', playerMode: false, showOriginalNames: false }) }));
vi.mock('../utils/resources', () => ({ useResourceOptions: () => [], resourceIcon: () => '', resourceLabel: () => '' }));
vi.mock('../utils/mastery', () => ({ useMasteryEffects: () => [], findMastery: () => undefined }));
vi.mock('./RelatedItems', () => ({ useContainerTotals: () => null, RelatedCardsList: () => null }));
vi.mock('./ImageUploader', () => ({ default: () => <div>Загрузчик изображения</div> }));
vi.mock('../audio/EntitySoundEditor', () => ({ default: () => <button type="button">Сохранить звук</button> }));
vi.mock('./CardPreview', () => ({ default: () => <div data-preview="card">Превью предмета</div> }));
vi.mock('./ItemPreview', () => ({ default: () => <div data-preview="card">Превью предмета</div> }));
vi.mock('./SpellPreview', () => ({ default: () => <div data-preview="spell">Превью заклинания</div> }));
vi.mock('./ActionPreview', () => ({ default: () => <div data-preview="action">Превью действия</div> }));
vi.mock('./EffectPreview', () => ({ default: () => <div data-preview="effect">Превью эффекта</div> }));
vi.mock('./ConceptPreview', () => ({ default: () => <div data-preview="concept">Превью понятия</div> }));
vi.mock('./ResourcePreview', () => ({ default: () => <div data-preview="resource">Превью ресурса</div>, resourceCategoryLabel: () => 'Ресурс', resourceRechargeLabel: () => 'Отдых' }));
vi.mock('./EntityRefPreview', () => ({ default: () => <div>Превью ссылки</div> }));

vi.mock('./EntityRefRegistry', () => ({
  evictEntity: mocks.evict,
  useEntityRef: (type: string, id: string) => ({
    loading: false, error: false,
    entity: {
      id, name: `Сущность ${type}`, rarity: 'common', type: 'weapon', card_number: id,
      description: type === 'spell' ? 'Описание заклинания. [[Связанное действие|action:action-one]]' : `Описание ${type}`,
      concept_id: id, resource_id: id, variable_id: id, category: 'class', recharge: 'long_rest',
      level: 1, school: 'evocation', image_url: '', action_type: 'action', effect_type: 'passive',
    },
  }),
}));

// Deliberately exposes a deletion callback to prove the provider rejects it even
// if a future child accidentally renders an authoring control in inspection mode.
vi.mock('./VariableDetailModal', () => ({
  default: ({ variable, onDelete }: { variable: { id: string }; onDelete: (id: string) => void }) => <button type="button" onClick={() => onDelete(variable.id)}>Попытка удаления</button>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('canonical entity details in an inspection context', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tagGet.mockResolvedValue([{ id: 'tag-one', name: 'Метка библиотеки', description: '' }]);
    mocks.tagList.mockResolvedValue({ tags: [], can_manage: true });
    mocks.generate.mockResolvedValue({ image_url: 'https://example.test/image.png' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function Opener({ type }: { type: EntityRefType }) {
    const { openEntity, readOnly } = useEntityDetail();
    return <button type="button" data-read-only={Boolean(readOnly)} onClick={() => openEntity(type, `${type}-one`)}>Открыть</button>;
  }

  async function render(children: ReactNode) {
    await act(async () => root.render(<MemoryRouter>{children}</MemoryRouter>));
  }

  function button(text: string): HTMLButtonElement {
    const element = [...document.body.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
    expect(element, `Missing button: ${text}`).toBeTruthy();
    return element!;
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
    await act(async () => { await vi.dynamicImportSettled(); });
  }

  function expectNoAuthoring() {
    const text = document.body.textContent ?? '';
    for (const label of ['Редактировать', 'Использовать как шаблон', 'Удалить', 'Сгенерировать изображение', 'Перегенерировать', 'Загрузить', 'Изменить теги', 'Сохранить звук', 'Параметры товара забега']) {
      expect(text, label).not.toContain(label);
    }
    expect(document.querySelector('a[href*="creator"], a[href^="/edit/"]')).toBeNull();
    expect(mocks.tagList).not.toHaveBeenCalled();
  }

  it.each(['card', 'spell', 'action', 'effect', 'concept', 'resource'] as const)('keeps %s detail content and previews while removing every catalogue editor', async type => {
    await render(<EntityDetailProvider readOnly><Opener type={type} /></EntityDetailProvider>);
    await click(button('Открыть'));
    expect(document.body.textContent).toContain(`Сущность ${type}`);
    expect(document.body.textContent).toContain(type === 'spell' ? 'Описание заклинания' : `Описание ${type}`);
    expect(document.querySelector(`[data-preview="${type}"]`)).not.toBeNull();
    if (type === 'card') {
      expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Сущность card');
      expect(document.querySelector('button[aria-label="Закрыть"]')).not.toBeNull();
    }
    expect(document.body.textContent).toContain('Метка библиотеки');
    expectNoAuthoring();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.tagWrite).not.toHaveBeenCalled();
  });

  it('keeps linked detail windows in inspection mode when following a spell reference', async () => {
    await render(<EntityDetailProvider readOnly><Opener type="spell" /></EntityDetailProvider>);
    await click(button('Открыть'));
    const link = [...document.querySelectorAll<HTMLElement>('.ft-link')].find(element => element.textContent === 'Связанное действие')!;
    expect(link).toBeTruthy();
    await click(link);
    expect(document.querySelector('.edm-title')?.textContent).toBe('Сущность action');
    expect(document.querySelector('[data-preview="action"]')).not.toBeNull();
    expectNoAuthoring();
  });

  it.each(['card', 'spell'] as const)('keeps the existing %s authoring behavior when readOnly is omitted', async type => {
    await render(<EntityDetailProvider><Opener type={type} /></EntityDetailProvider>);
    await click(button('Открыть'));
    expect(document.querySelector('a[href*="creator"], a[href^="/edit/"]')).not.toBeNull();
    expect(document.body.textContent).toContain(type === 'card' ? 'Сгенерировать изображение' : 'Перегенерировать');
    expect(document.body.textContent).toContain('Изменить теги');
    await click(button('Удалить'));
    expect(type === 'card' ? mocks.deleteCard : mocks.deleteSpell).toHaveBeenCalledExactlyOnceWith(`${type}-one`);
  });

  it('inherits inspection mode through nested providers and rejects a direct delete callback', async () => {
    await render(<EntityDetailProvider readOnly><EntityDetailProvider><Opener type="variable" /></EntityDetailProvider></EntityDetailProvider>);
    expect(button('Открыть').dataset.readOnly).toBe('true');
    await click(button('Открыть'));
    await click(button('Попытка удаления'));
    expect(mocks.deleteVariable).not.toHaveBeenCalled();
    expect(mocks.evict).not.toHaveBeenCalled();
    expect(button('Попытка удаления')).toBeTruthy();
  });

  it('executes the same delete callback in the default authoring context', async () => {
    await render(<EntityDetailProvider><Opener type="variable" /></EntityDetailProvider>);
    await click(button('Открыть'));
    await click(button('Попытка удаления'));
    expect(mocks.deleteVariable).toHaveBeenCalledExactlyOnceWith('variable-one');
    expect(mocks.evict).toHaveBeenCalledWith('variable', 'variable-one');
  });

  it('leaves image generation and persistence available outside inspection contexts', async () => {
    const persist = vi.fn().mockResolvedValue('https://example.test/saved.png');
    await render(<EntityDetailContext.Provider value={{ openEntity: () => {} }}><EntityImageEditor entityId="spell-one" initialUrl="" persist={persist} generateReq={{ style: 'spell_icon', subject: 'Свет' }} renderPreview={url => <img alt="Каноничное превью" src={url || undefined} />} /></EntityDetailContext.Provider>);
    await click(button('Перегенерировать'));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith('spell-one', 'https://example.test/image.png');
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.test/saved.png');
  });
});
