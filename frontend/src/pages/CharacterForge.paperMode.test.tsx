// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CharacterForge, { type PaperForgeSession } from './CharacterForge';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { charactersV3Api } from '../character/api';
import { projectCharacterStartingEquipmentPatch } from '../character/startingEquipment';
import { assemble, loadBundle, type EntityBundle } from '../character/assemble';
import { loadPaperIdentityAssembly } from '../paper-sheet/loadPaperIdentityAssembly';
import type { PassiveEffect, Spell } from '../types';

vi.mock('../character/api', () => ({ charactersV3Api: { get: vi.fn(), create: vi.fn(), update: vi.fn(), patchRuntime: vi.fn(), uploadAvatar: vi.fn() }, characterV3ErrorMessage: () => 'Ошибка' }));
vi.mock('../contexts/ChoiceDialogContext', () => ({ useChoiceDialog: () => ({ request: vi.fn() }) }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../settings', () => ({ useSiteSettings: () => ({ entityDisplay: {} }) }));
vi.mock('../character/components', async () => ({ ...await vi.importActual('../character/components'), SummaryPanel: () => null, ForgeNav: () => null }));
vi.mock('../character/forgeHelpers', async () => ({ ...await vi.importActual('../character/forgeHelpers'), completionIssues: () => [] }));
vi.mock('../character/assemble', async () => ({ ...await vi.importActual('../character/assemble'), loadBundle: vi.fn(async () => ({ race: null, klass: null, background: null, feats: [], actions: [], effects: [], spells: [] })) }));
vi.mock('../paper-sheet/loadPaperIdentityAssembly', () => ({ loadPaperIdentityAssembly: vi.fn() }));
vi.mock('../character/startingEquipment', () => ({ projectCharacterStartingEquipmentPatch: vi.fn(patch => ({ ...patch, currency: { gp: 25 } })) }));
vi.mock('../api/client', async () => ({
  ...await vi.importActual('../api/client'),
  racesApi: { getRaces: vi.fn(async () => ({ races: [], total: 0 })) },
  classesApi: { getClasses: vi.fn(async () => ({ classes: [], total: 0 })) },
  backgroundsApi: { getBackgrounds: vi.fn(async () => ({ backgrounds: [], total: 0 })) },
  featsApi: { getFeats: vi.fn(async () => ({ feats: [], total: 0 })) },
  spellsApi: { getSpells: vi.fn(async () => ({ spells: [], total: 0 })) },
  resourcesApi: { getResources: vi.fn(async () => ({ resources: [] })) },
}));

let root: Root;
let node: HTMLDivElement;
const emptyBundle = (): EntityBundle => ({ race: null, klass: null, background: null, feats: [], actions: [], effects: [], spells: [] });
const completeAssembly = async (draft: CharacterDraft) => assemble(emptyBundle(), draft);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadBundle).mockImplementation(async () => emptyBundle());
  vi.mocked(loadPaperIdentityAssembly).mockImplementation(completeAssembly);
  localStorage.clear(); node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
const session = (documentId?: string): PaperForgeSession => ({
  documentId, returnURL: '/paper-sheet', onDraftChange: vi.fn(), onSave: vi.fn(async () => undefined),
  draft: { ...emptyDraft(), id: 'source-interactive-id', name: 'Бумажный герой', abilitiesTouched: true,
    abilities: { str: 14, dex: 12, con: 13, int: 15, wis: 8, cha: 10 }, avatarUrl: 'data:image/png;base64,test' },
});
const render = async (value: PaperForgeSession) => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/paper-sheet/paper-id/forge?roguelike=ignored']}><Routes><Route path="/paper-sheet/:id/forge" element={<CharacterForge paperMode paperSession={value} />} /></Routes></MemoryRouter>));
};
const clickSave = async () => {
  const button = node.querySelector<HTMLButtonElement>('.forge-create-btn')!;
  expect(button.disabled).toBe(false); await act(async () => button.click());
};

it('saves a new paper build without reading or writing the interactive character API, including a local portrait', async () => {
  const value = session(); await render(value); await clickSave();
  expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({
    draft: expect.objectContaining({ id: undefined, name: 'Бумажный герой' }),
    payload: expect.objectContaining({ avatar_url: 'data:image/png;base64,test' }),
    initialRuntime: expect.objectContaining({ currency: { gp: 25 } }),
  }));
  expect(projectCharacterStartingEquipmentPatch).toHaveBeenCalledTimes(1);
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
  expect(node.querySelector('[aria-label="Тёмная тема"]')).toBeNull();
  expect(node.querySelector('.paper-forge.sheet-paper')).not.toBeNull();
});

it('projects resource maxima when editing but does not grant starting equipment again', async () => {
  const value = session('paper-id'); value.draft.level = 3; await render(value); await clickSave();
  expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({ initialRuntime: expect.objectContaining({ max_resources: expect.any(Object) }) }));
  expect(projectCharacterStartingEquipmentPatch).not.toHaveBeenCalled();
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
});

it('deduplicates simultaneous saves and leaves a failed paper save editable', async () => {
  let reject!: (reason: Error) => void;
  const value = session('paper-id'); value.onSave = vi.fn(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
  await render(value);
  const button = node.querySelector<HTMLButtonElement>('.forge-create-btn')!;
  await act(async () => { button.click(); button.click(); });
  expect(value.onSave).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(true);
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => reject(new Error('Конфликт версий')));
  errorLog.mockRestore();
  expect(node.textContent).toContain('Конфликт версий'); expect(button.disabled).toBe(false);
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
});

it('reports a failed pre-upgrade assembly and retries before enabling level confirmation', async () => {
  let unavailable = true;
  vi.mocked(loadBundle).mockImplementation(async draft => {
    if (draft.level === 1 && unavailable) throw new Error('Старый уровень недоступен');
    return { race: null, klass: null, background: null, feats: [], actions: [], effects: [], spells: [] };
  });
  const value = session('paper-id');
  value.levelUpFrom = { ...value.draft, classId: 'wizard', classLevels: { wizard: 1 }, level: 1 };
  value.draft = { ...value.levelUpFrom, classLevels: { wizard: 2 }, level: 2 };
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await render(value);
  const button = node.querySelector<HTMLButtonElement>('.forge-create-btn')!;
  expect(button.disabled).toBe(true);
  expect(node.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить данные');
  unavailable = false;
  await act(async () => node.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(button.disabled).toBe(false);
  expect(node.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button.click());
  expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ level: 2, classLevels: { wizard: 2 } }) }));
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
  errorLog.mockRestore();
});

it.each([
  ['str', 2, 16], ['dex', 4, 16],
] as const)('builds the saved rules and payload from the complete catalogue (%s grant)', async (ability, amount, expected) => {
  vi.mocked(loadPaperIdentityAssembly).mockImplementation(async draft => assemble({
    ...emptyBundle(), effects: [{
      effect: { id: `effect-${ability}`, name: `Дар ${ability}`, mechanics: { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_ability_score', ability, amount }] }] } } as unknown as PassiveEffect,
      origin: { kind: 'feat', id: `feat-${ability}`, name: `Черта ${ability}` },
    }],
  }, draft));
  const value = session('paper-id'); await render(value); await clickSave();
  const saved = vi.mocked(value.onSave).mock.calls[0][0];
  expect(saved.ruleState.abilities[ability]).toBe(expected);
  expect(saved.payload.rule_state).toBe(saved.ruleState);
  expect(saved.payload.initiative_bonus).toBe(ability === 'dex' ? 3 : 1);
  expect(saved.draft.abilities).toEqual(value.draft.abilities);
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
});

it('blocks a partial catalogue snapshot and preserves the draft for a successful retry', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(loadPaperIdentityAssembly).mockRejectedValueOnce(new Error('Не все записи каталога загрузились.'));
  const value = session('paper-id'); await render(value); await clickSave();
  expect(value.onSave).not.toHaveBeenCalled();
  expect(node.textContent).toContain('Не все записи каталога загрузились.');
  expect(node.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => node.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  await clickSave();
  expect(value.onSave).toHaveBeenCalledOnce();
  expect(vi.mocked(value.onSave).mock.calls[0][0].draft.name).toBe(value.draft.name);
  expect(loadPaperIdentityAssembly).toHaveBeenCalledTimes(2);
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
  errorLog.mockRestore();
});

it.each(['prepared_spell', 'skill'])('revalidates a required %s choice omitted by the permissive preview', async source => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(loadPaperIdentityAssembly).mockImplementation(async draft => ({
    ...assemble(emptyBundle(), draft), pendingChoices: [{
      id: 'new-choice', source, count: source === 'skill' ? 2 : 1, prompt: 'Новый обязательный выбор',
      origin: { kind: 'class', id: 'wizard', name: 'Маг', owningClassLevel: 2 },
      ...(source === 'prepared_spell' ? { preparedSpellSourceChoiceId: 'spellbook', allowedOptionIds: ['spell-one'] } : {}),
    }],
  }));
  const value = session('paper-id');
  value.levelUpFrom = { ...value.draft, classId: 'wizard', classLevels: { wizard: 1 }, level: 1 };
  value.draft = { ...value.levelUpFrom, classLevels: { wizard: 2 }, level: 2 };
  await render(value); await clickSave();
  expect(value.onSave).not.toHaveBeenCalled();
  expect(node.textContent).toContain('Новый обязательный выбор');
  expect(node.textContent).toContain('Завершите выборы персонажа');
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
  errorLog.mockRestore();
});

it('strictly hydrates freshly selected and granted spells without making grants into draft ownership', async () => {
  const chosen = '11111111-1111-4111-8111-111111111111';
  const granted = 'SPELL-gift';
  vi.mocked(loadPaperIdentityAssembly).mockImplementation(async draft => {
    const result = assemble({
      ...emptyBundle(), effects: [{ effect: { id: 'grant-spell', name: 'Дар заклинания', mechanics: { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_spell', value: granted }] }] } } as unknown as PassiveEffect,
        origin: { kind: 'feat', id: 'feat-magic', name: 'Магическая черта' } }],
      spells: [...(draft.spellIds ?? []), ...(draft.grantedSpellSlugs ?? [])].map(id => ({ id, card_number: id, name: id, level: 1 } as Spell)),
    }, draft);
    result.pendingChoices = [{ id: 'learning', source: 'spell', count: 1, prompt: 'Заклинание', origin: { kind: 'class', id: 'wizard', name: 'Маг' } }];
    return result;
  });
  const value = session('paper-id'); value.draft.resolvedChoices = { learning: [chosen] };
  await render(value); await clickSave();
  expect(loadPaperIdentityAssembly).toHaveBeenCalledTimes(2);
  expect(loadPaperIdentityAssembly).toHaveBeenLastCalledWith(expect.objectContaining({ spellIds: [chosen], grantedSpellSlugs: [granted] }));
  const saved = vi.mocked(value.onSave).mock.calls[0][0];
  expect(saved.assembled.spells.map(spell => spell.id)).toEqual([chosen, granted]);
  expect(saved.draft.spellIds).toEqual([]);
  expect(saved.draft.grantedSpellSlugs ?? []).toEqual([]);
  expect(saved.payload.spell_ids).toContain(chosen);
});

it('ignores a completed catalogue request after leaving the forge', async () => {
  let complete!: (value: Awaited<ReturnType<typeof loadPaperIdentityAssembly>>) => void;
  vi.mocked(loadPaperIdentityAssembly).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const value = session('paper-id'); await render(value); await clickSave();
  await act(async () => root.render(null));
  await act(async () => complete(await completeAssembly(value.draft)));
  expect(value.onSave).not.toHaveBeenCalled();
  for (const transport of Object.values(charactersV3Api)) expect(transport).not.toHaveBeenCalled();
});
