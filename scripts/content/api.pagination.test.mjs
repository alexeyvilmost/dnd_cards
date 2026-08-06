import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PaginationError,
  RequiredCollectionError,
  fetchAll,
  fetchRequiredCollection,
  login,
} from './api.mjs';

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('fetchAll reads all 766 records when the server clamps limit 1000 to 500', async () => {
  const records = Array.from({ length: 766 }, (_, index) => ({ id: `card-${index + 1}` }));
  const requests = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const page = Number(url.searchParams.get('page'));
    const requestedLimit = Number(url.searchParams.get('limit'));
    const actualLimit = Math.min(requestedLimit, 500);
    const start = (page - 1) * actualLimit;
    return jsonResponse({
      cards: records.slice(start, start + actualLimit),
      total: records.length,
      page,
      limit: actualLimit,
    });
  };

  const result = await fetchAll('/api/cards', 'cards', {
    baseUrl: 'https://catalog.example.test',
    fetchImpl,
    limit: 1000,
    retries: 1,
  });

  assert.equal(result.length, 766);
  assert.deepEqual(result, records);
  assert.deepEqual(requests.map((url) => url.searchParams.get('page')), ['1', '2']);
  assert.deepEqual(requests.map((url) => url.searchParams.get('limit')), ['1000', '1000']);
});

test('fetchAll fails when a required response collection is missing or not an array', async (t) => {
  for (const [name, body] of [
    ['missing', { total: 0, page: 1, limit: 500 }],
    ['null', { cards: null, total: 0, page: 1, limit: 500 }],
    ['object', { cards: {}, total: 0, page: 1, limit: 500 }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        fetchAll('/api/cards', 'cards', {
          baseUrl: 'https://catalog.example.test',
          fetchImpl: async () => jsonResponse(body),
          retries: 1,
        }),
        (error) => {
          assert.ok(error instanceof RequiredCollectionError);
          assert.equal(error.collection, 'cards');
          assert.equal(error.path, '/api/cards');
          return true;
        },
      );
    });
  }
});

test('fetchRequiredCollection rejects an empty required catalog', async () => {
  await assert.rejects(
    fetchRequiredCollection('/api/classes', 'classes', {
      baseUrl: 'https://catalog.example.test',
      fetchImpl: async () => jsonResponse({ classes: [], total: 0, page: 1, limit: 500 }),
      retries: 1,
    }),
    RequiredCollectionError,
  );
});

test('fetchAll rejects an empty page before the advertised total is reached', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchAll('/api/cards', 'cards', {
      baseUrl: 'https://catalog.example.test',
      fetchImpl: async (input) => {
        requestCount += 1;
        const page = Number(new URL(input).searchParams.get('page'));
        return jsonResponse({
          cards: page === 1 ? Array.from({ length: 500 }, (_, index) => ({ id: `card-${index}` })) : [],
          total: 766,
          page,
          limit: 500,
        });
      },
      limit: 1000,
      retries: 1,
    }),
    PaginationError,
  );
  assert.equal(requestCount, 2);
});

test('fetchAll rejects a repeated unpaginated response after the first request', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchAll('/api/resources', 'resources', {
      baseUrl: 'https://catalog.example.test',
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse({ resources: [{ id: 'resource-1' }] });
      },
      retries: 1,
    }),
    PaginationError,
  );
  assert.equal(requestCount, 1);
});

test('fetchAll rejects duplicate identities across advertised pages', async () => {
  await assert.rejects(
    fetchAll('/api/resources', 'resources', {
      baseUrl: 'https://catalog.example.test',
      fetchImpl: async (input) => {
        const page = Number(new URL(input).searchParams.get('page'));
        return jsonResponse({
          resources: [{ id: 'same-resource' }],
          total: 2,
          page,
          limit: 1,
        });
      },
      limit: 1,
      retries: 1,
    }),
    PaginationError,
  );
});

test('fetchAll rejects an advertised catalog larger than maxItems before retaining it', async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchAll('/api/cards', 'cards', {
      baseUrl: 'https://catalog.example.test',
      fetchImpl: async () => {
        requestCount += 1;
        return jsonResponse({ cards: [{ id: 'card-1' }], total: 3, page: 1, limit: 1 });
      },
      maxItems: 2,
      retries: 1,
    }),
    PaginationError,
  );
  assert.equal(requestCount, 1);
});

test('fetchAll requires unique non-empty string ids within every page', async (t) => {
  for (const [name, cards] of [
    ['missing', [{}]],
    ['numeric', [{ id: 1 }]],
    ['empty', [{ id: '' }]],
    ['duplicate', [{ id: 'same' }, { id: 'same' }]],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        fetchAll('/api/cards', 'cards', {
          baseUrl: 'https://catalog.example.test',
          fetchImpl: async () => jsonResponse({
            cards,
            total: cards.length,
            page: 1,
            limit: cards.length,
          }),
          retries: 1,
        }),
        PaginationError,
      );
    });
  }
});

test('login has no tracked credential or auto-registration fallback', async () => {
  let calls = 0;
  await assert.rejects(
    login({
      token: '',
      user: '', pass: '', baseUrl: 'https://api.example.test',
      fetchImpl: async () => { calls += 1; return jsonResponse({}); },
    }),
    /API_TOKEN or CONTENT_ADMIN_USERNAME and CONTENT_ADMIN_PASSWORD/,
  );
  assert.equal(calls, 0);

  const explicitToken = await login({
    token: ' signed-explicit-token ',
    user: '',
    pass: '',
    fetchImpl: async () => { calls += 1; return jsonResponse({}); },
  });
  assert.equal(explicitToken, 'signed-explicit-token');
  assert.equal(calls, 0);

  const requests = [];
  const token = await login({
    token: '',
    user: 'dedicated-content-admin',
    pass: 'explicit-secret',
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input, init) => {
      requests.push({ input, init });
      return jsonResponse({ token: 'signed-token' });
    },
  });
  assert.equal(token, 'signed-token');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://api.example.test/api/auth/login');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    username: 'dedicated-content-admin', password: 'explicit-secret',
  });
});
