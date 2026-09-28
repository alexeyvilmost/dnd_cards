// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {expect, it, vi} from 'vitest';
import RoguelikePage from './RoguelikePage';
import {roguelikeApi} from '../roguelike/api';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({run: {
  id: 'winner', revision: 12, mode: 'urvin', status: 'victory', phase: 'ended', character_id: 'hero',
  experience: 10000, encounters_won: 9, attempt: 1,
  characters: [{id: 'hero', name: 'Воин'}, {id: 'ally', name: 'Маг'}],
  journey: {stash: [{card_id: 'boss-loot', name: 'Награда хранителя'}]},
}}));
vi.mock('../roguelike/api', () => ({roguelikeApi: {
  get: vi.fn(async () => fixture.run),
  command: vi.fn(async () => ({...fixture.run, revision: 13, journey: {...fixture.run.journey, stash: []}})),
}}));
vi.mock('../components/RunPartyCamp', () => ({default: () => null}));
vi.mock('../components/CharacterTemplateLibrary', () => ({default: () => null}));
vi.mock('../components/MerchantSettingsDialog', () => ({default: () => null}));
vi.mock('../components/SheetActionLine', () => ({default: ({name}: {name: string}) => <span>{name}</span>}));
vi.mock('../api/client', () => ({cardsApi: {getCard: vi.fn(async () => ({id: 'boss-loot', name: 'Награда хранителя'}))}}));

it('lets a victorious party claim overflow boss loot for the selected member without reopening the route', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/roguelike/winner']}>
      <Routes><Route path="/roguelike/:id" element={<RoguelikePage/>}/></Routes>
    </MemoryRouter>));
    expect(container.textContent).toContain('Победа!');
    expect(container.textContent).toContain('Награда хранителя');
    expect(container.querySelector('[href="/characters-v3/ally?roguelike=winner"]')).toBeNull();
    expect(container.textContent).toContain('Выберите участника со свободным местом');
    const recipient = container.querySelector<HTMLSelectElement>('[aria-label="Получатель добычи"]')!;
    await act(async () => {recipient.value = 'ally'; recipient.dispatchEvent(new Event('change', {bubbles: true}));});
    const claim = [...container.querySelectorAll('button')].find(button => button.textContent === 'Забрать')!;
    await act(async () => claim.click());
    expect(roguelikeApi.command).toHaveBeenCalledWith('winner', 12, 'claim_stash', {card_id: 'boss-loot', character_id: 'ally'});
    expect(container.querySelector('[aria-label="Невместившаяся добыча"]')).toBeNull();
    expect(container.textContent).toContain('Победа!');
    expect(container.textContent).not.toMatch(/Выберите дорогу|Следующее столкновение|Долгий отдых|Короткий отдых/);
  } finally {
    await act(async () => root.unmount()); container.remove();
  }
});
