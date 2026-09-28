// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {ForgeCharacter} from '../character/types';
import StartRunFromSheet from './StartRunFromSheet';
import {roguelikeApi} from '../roguelike/api';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({
  aura: {id: 'shared-aura', name: 'Аура восстановления', mechanics: {}},
  runs: [{id: 'solo', source_character_id: 'source', status: 'active', mode: 'classic', attempt: 1, encounters_won: 0},
    {id: 'group', source_character_id: 'other', status: 'active', mode: 'urvin', attempt: 1, encounters_won: 2, party: {members: [{source_character_id: 'source'}]}},
    {id: 'unrelated', source_character_id: 'other', status: 'active', mode: 'classic', attempt: 1, encounters_won: 0}],
}));
vi.mock('../roguelike/api', () => ({roguelikeApi: {
  list: vi.fn(async () => fixture.runs),
  modes: vi.fn(async () => ({id: 'urvin', auras: [fixture.aura]})),
  create: vi.fn(async () => ({id: 'created'})),
}}));
vi.mock('../settings', () => ({useSiteSettings: () => ({entityDisplay: {effects: 'row'}})}));
vi.mock('./DialogShell', () => ({default: ({children}: {children: React.ReactNode}) => <section role="dialog">{children}</section>}));
vi.mock('./SheetActionLine', () => ({default: ({name, onActivate}: {name: string; onActivate: () => void}) => <button onClick={onActivate}>{name}</button>}));

let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const character = {id: 'source', name: 'Путник', level: 1, class_id: 'fighter', access_mode: 'owner'} as ForgeCharacter;
  await act(async () => root.render(<MemoryRouter><StartRunFromSheet character={character}/></MemoryRouter>));
});
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.clearAllMocks();});
const click = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
};

it('includes solo and group runs for the source and still creates another independent run', async () => {
  await click('Начать забег');
  expect(document.querySelectorAll('.start-run-dialog__run')).toHaveLength(2);
  await click('Начать классический забег');
  expect(roguelikeApi.create).toHaveBeenCalledWith('source');
});

it('recovers an aura-load failure and submits the chosen Urvin aura', async () => {
  vi.mocked(roguelikeApi.modes).mockRejectedValueOnce(new Error('offline'));
  await click('Начать забег'); await click('Урвинский');
  expect(document.body.textContent).toContain('Не удалось загрузить ауры.');
  await click('Повторить'); await click('Аура восстановления'); await click('Начать Урвинский забег');
  expect(roguelikeApi.create).toHaveBeenCalledWith('source', {mode: 'urvin', aura_id: 'shared-aura'});
});
