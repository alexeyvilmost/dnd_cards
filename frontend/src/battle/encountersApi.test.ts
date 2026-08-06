// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import {
  EncounterStreamError,
  encounterInviteTokenFromHash,
  encounterInviteUrl,
  encountersApi,
  parseEncounterSSEFrames,
} from './encountersApi';

describe('authenticated encounter SSE', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps an incomplete chunk and parses replay frames exactly once', () => {
    const first = parseEncounterSSEFrames(
      ': ping\n\nid: 4\ndata: {"seq":4,"events":["hit"]}\n\nid: 5\ndata: {"seq":',
    );
    expect(first.events).toEqual([{ seq: 4, events: ['hit'] }]);
    expect(first.remainder).toBe('id: 5\ndata: {"seq":');

    const second = parseEncounterSSEFrames(`${first.remainder}5,"round":2}\n\n`);
    expect(second.events).toEqual([{ seq: 5, round: 2 }]);
    expect(second.remainder).toBe('');
  });

  it('sends Bearer authentication and delivers streamed events', async () => {
    localStorage.setItem('auth_token', 'encounter.jwt.token');
    const bytes = new TextEncoder().encode('id: 8\ndata: {"seq":8,"active_index":1}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 13));
        controller.enqueue(bytes.slice(13));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null },
      body,
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpen = vi.fn();
    const onEvent = vi.fn();

    await encountersApi.stream('encounter/id', 7.9, {
      signal: new AbortController().signal,
      onOpen,
      onEvent,
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ seq: 8, active_index: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/encounters/encounter%2Fid/stream?since=7');
    expect(init.headers).toMatchObject({
      Accept: 'text/event-stream',
      Authorization: 'Bearer encounter.jwt.token',
    });
  });

  it('fails closed before network access when no JWT is present', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(encountersApi.stream('encounter', 0, {
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })).rejects.toMatchObject({ status: 401 } satisfies Partial<EncounterStreamError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces participant denial and does not silently reconnect as another identity', async () => {
    localStorage.setItem('auth_token', 'member.jwt.token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => 'application/json' },
      body: null,
    }));

    await expect(encountersApi.stream('foreign-encounter', 0, {
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })).rejects.toMatchObject({
      status: 403,
      message: 'Нет доступа к этому бою',
    } satisfies Partial<EncounterStreamError>);
    expect(localStorage.getItem('auth_token')).toBe('member.jwt.token');
  });

  it('puts invite capability in a fragment rather than a logged query string', () => {
    const url = encounterInviteUrl('encounter-id', 'signed.token/value', 'https://app.example/');
    expect(url).toBe('https://app.example/encounter/encounter-id#invite=signed.token%2Fvalue');
    expect(url).not.toContain('?invite=');
    expect(encounterInviteTokenFromHash('#invite=signed.token%2Fvalue')).toBe('signed.token/value');
    expect(encounterInviteTokenFromHash('')).toBeNull();
  });

  it('issues invites owner-side and submits the capability only in Join body', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: { token: 'signed-invite', expires_at: '2026-08-05T12:15:00Z' } } as never)
      .mockResolvedValueOnce({ data: { id: 'encounter-id' } } as never);

    await expect(encountersApi.issueInvite('encounter-id')).resolves.toEqual({
      token: 'signed-invite',
      expires_at: '2026-08-05T12:15:00Z',
    });
    await encountersApi.join('encounter-id', 'signed-invite');

    expect(post).toHaveBeenNthCalledWith(1, '/api/encounters/encounter-id/invite', {});
    expect(post).toHaveBeenNthCalledWith(2, '/api/encounters/encounter-id/join', { invite_token: 'signed-invite' });
  });

  it('requires an explicit encounter version for Apply and sends it in the command body', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { seq: 8, state: { combatants: [], round: 1, activeIndex: 0 } },
    } as never);

    await expect(encountersApi.apply('encounter-id', -1, { round: 2 })).rejects.toThrow(RangeError);
    expect(post).not.toHaveBeenCalled();
    await encountersApi.apply('encounter-id', 7, { round: 2 });

    expect(post).toHaveBeenCalledWith('/api/encounters/encounter-id/apply', {
      round: 2,
      expected_seq: 7,
    });
  });

  it('exposes owner cleanup through DELETE encounter', async () => {
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never);
    await encountersApi.delete('encounter-id');
    expect(remove).toHaveBeenCalledWith('/api/encounters/encounter-id');
  });
});
