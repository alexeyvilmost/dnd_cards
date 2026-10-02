// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useParams } from 'react-router-dom';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { apiClient } from './api/client';
import { clearApiCache } from './api/apiCache';
import { emptyDraft } from './character/types';
import { paperForgeDraftKey } from './pages/PaperCharacterForge';
import { paperDocumentApi, type SavedPaperDocument } from './paper-sheet/documentApi';

// Keep the real route, auth provider, forge, assembler, converter and API client.
// The destination marker avoids mounting an unrelated editor after saving.
vi.mock('./audio/AudioDirector', () => ({ default: () => null }));
vi.mock('./pages/PaperSheetEntry', () => ({ default: function CreatedPaperMarker() {
  const { id } = useParams(); return <main data-testid="created-paper">{id}</main>;
} }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const race = { id: 'public-race', card_number: 'RACE-public', name: 'Публичный вид', speed: 30, size: 'medium', traits: [] };
const klass = { id: 'public-class', card_number: 'CLASS-public', name: 'Публичный класс', hit_die: 'd8', level_progression: {} };
const background = { id: 'public-background', card_number: 'BACKGROUND-public', name: 'Публичная предыстория', ability_scores: ['str', 'con', 'wis'] };
const catalog: Record<string, { id: string }[]> = { races: [race], classes: [klass], backgrounds: [background], feats: [], spells: [], resources: [], variables: [] };
let root: Root;
let host: HTMLDivElement;
let oldAdapter: typeof apiClient.defaults.adapter;
let requests: Array<{ method: string; url: string; authorization: unknown; body?: unknown }>;
let created: SavedPaperDocument | undefined;

beforeEach(() => {
  localStorage.clear(); clearApiCache(); requests = []; created = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  oldAdapter = apiClient.defaults.adapter;
  const adapter: AxiosAdapter = async config => {
    const method = config.method ?? 'get';
    const url = config.url ?? '';
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    requests.push({ method, url, authorization: config.headers.get('Authorization'), body });
    const response = (data: unknown, status = 200) => ({ data, status, statusText: 'OK', headers: {}, config });
    if (url === '/api/auth/profile') throw new AxiosError('Expired token', undefined, config, undefined, response({ error: 'Войдите в аккаунт' }, 401));
    if (url === '/api/paper-sheets' && method === 'post') {
      if (body.anonymous !== true || config.headers.get('Authorization')) throw new Error('Guest creation must be explicitly anonymous');
      created = { id: 'created-anonymous-paper', document: body.document, anonymous: true, revision: 1 };
      return response(created, 201);
    }
    if (url === '/api/paper-sheets/created-anonymous-paper' && method === 'get' && created) return response(created);
    const [, kind, id] = /^\/api\/([^/]+)(?:\/([^/]+))?$/.exec(url) ?? [];
    if (method === 'get' && catalog[kind]) {
      if (id) {
        const entry = catalog[kind].find(row => row.id === id);
        if (!entry) throw new Error(`Missing fixture ${url}`);
        return response(entry);
      }
      return response({ [kind]: catalog[kind], total: catalog[kind].length, page: 1, limit: 500 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  apiClient.defaults.adapter = adapter;
  // A complete recovered choice set lets this transport test use the genuine
  // validators and calculations without duplicating the picker interaction tests.
  const draft = { ...emptyDraft(), name: 'Гость без аккаунта', raceId: race.id, classId: klass.id,
    classLevels: { [klass.id]: 1 }, backgroundId: background.id, abilityMethod: 'manual' as const, abilitiesTouched: true,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    abilityBonuses: { mode: 'two_one', anyAbilities: false, assignments: { str: 2, con: 1 } },
    avatarUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };
  localStorage.setItem(paperForgeDraftKey(undefined, false), JSON.stringify({ revision: 0, draft }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  apiClient.defaults.adapter = oldAdapter; clearApiCache(); localStorage.clear();
});

it.each([false, true])('creates from the public route through canonical calculations with no login (expired session=%s)', async expiredSession => {
  if (expiredSession) localStorage.setItem('auth_token', 'expired-local-fixture');
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/paper-sheet/create']}><App /></MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('.forge-create-btn')?.disabled).toBe(false));
  const button = host.querySelector<HTMLButtonElement>('.forge-create-btn')!;
  expect(button.textContent).toBe('Создать анонимный лист');
  expect(host.textContent).toContain('Будет создан анонимный лист');
  expect(requests.filter(request => request.method !== 'get')).toEqual([]);
  await act(async () => button.click());
  await vi.waitFor(() => expect(host.querySelector('[data-testid="created-paper"]')?.textContent).toBe('created-anonymous-paper'));
  expect(created?.anonymous).toBe(true);
  expect(created?.document.identity).toMatchObject({ speciesId: race.id, classId: klass.id, backgroundId: background.id });
  expect(created?.document.progression?.draft.name).toBe('Гость без аккаунта');
  expect(created?.document.portrait).toBe('data:image/png;base64,iVBORw0KGgo=');
  const writes = requests.filter(request => request.method !== 'get');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: 'post', url: '/api/paper-sheets', body: { anonymous: true } });
  expect(requests.filter(request => request.url.includes('/api/auth/')).map(request => request.url)).toEqual(expiredSession ? ['/api/auth/profile'] : []);
  expect(requests.filter(request => !request.url.includes('/api/auth/')).every(request => !request.authorization)).toBe(true);
  expect((await paperDocumentApi.get('created-anonymous-paper')).document).toEqual(created?.document);
  expect(localStorage.getItem(paperForgeDraftKey(undefined, false))).toBeNull();
});
