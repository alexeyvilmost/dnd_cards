import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { postExactSupportBatch } from './exact-support-batch-client.mjs';

function transportTestBatch() {
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: `sha256:${'a'.repeat(64)}`,
    operation_id: 'mini-mvp-forge-sheet:stable-transport-operation',
    expected_count: 1,
    entries: [{
      entity_type: 'race',
      entity_id: '00000000-0000-4000-8000-000000000001',
      expected_current: {
        id: '00000000-0000-4000-8000-000000000001',
        support: null,
      },
      support: {
        status: 'verified_partial',
        certified_at: '2026-08-22T00:00:00.000Z',
      },
    }],
  };
}

function exactBatchReceipt(batch, { alreadyApplied = false } = {}) {
  return {
    schema_version: 1,
    mode: batch.mode,
    plan_hash: batch.plan_hash,
    operation_id: batch.operation_id,
    total: batch.expected_count,
    updated: alreadyApplied ? 0 : batch.expected_count,
    already_in_requested_state_count: alreadyApplied ? batch.expected_count : 0,
    already_applied: alreadyApplied,
    cas: 'atomic_exact_full_api_response_v1',
  };
}

test('pre-response socket loss retries the byte-identical batch and accepts an idempotent replay receipt', async () => {
  const batch = transportTestBatch();
  const requests = [];
  const retries = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: init.body });
    if (requests.length === 1) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'UND_ERR_SOCKET' };
      throw error;
    }
    return Response.json(exactBatchReceipt(batch, { alreadyApplied: true }));
  };

  const receipt = await postExactSupportBatch({
    baseUrl: 'https://api.example.test/',
    batch,
    token: 'token',
    certificationKey: 'key',
    fetchImpl,
    retryDelayMs: 0,
    onTransportRetry: (retry) => retries.push(retry),
  });

  assert.equal(receipt.already_applied, true);
  assert.equal(requests.length, 2);
  assert.equal(retries.length, 1);
  assert.deepEqual(Object.keys(retries[0]).sort(), [
    'attempt', 'attempts', 'operationId', 'reason',
  ]);
  assert.equal(retries[0].reason, 'pre_response_transport');
  assert.equal(requests[0].url, 'https://api.example.test/api/content-support/batch-exact');
  assert.strictEqual(requests[0].init, requests[1].init);
  assert.equal(requests[0].body, requests[1].body);
  assert.deepEqual(JSON.parse(requests[0].body), batch);
  assert.equal(JSON.parse(requests[1].body).operation_id, batch.operation_id);
});

test('fresh exact-support receipt reports the complete committed postcondition', async () => {
  const batch = transportTestBatch();
  let requests = 0;
  const receipt = await postExactSupportBatch({
    baseUrl: 'https://api.example.test',
    batch,
    token: 'token',
    certificationKey: 'key',
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1;
      return Response.json(exactBatchReceipt(batch));
    },
  });
  assert.equal(requests, 1);
  assert.equal(receipt.updated, batch.expected_count);
  assert.equal(receipt.already_in_requested_state_count, 0);
});

test('ambiguous 408, 429, and 5xx responses retry the unchanged operation', async (t) => {
  for (const status of [408, 429, 503]) {
    await t.test(String(status), async () => {
      const batch = transportTestBatch();
      const requests = [];
      const retries = [];
      const receipt = await postExactSupportBatch({
        baseUrl: 'https://api.example.test',
        batch,
        token: 'token',
        certificationKey: 'key',
        retryDelayMs: 0,
        onTransportRetry: (retry) => retries.push(retry),
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          if (requests.length === 1) {
            return new Response('ambiguous upstream response', { status });
          }
          return Response.json(exactBatchReceipt(batch, { alreadyApplied: true }));
        },
      });
      assert.equal(receipt.already_applied, true);
      assert.equal(requests.length, 2);
      assert.strictEqual(requests[0].init, requests[1].init);
      assert.deepEqual(retries.map((retry) => ({ reason: retry.reason, status: retry.status })), [
        { reason: 'http_status', status },
      ]);
    });
  }
});

test('deterministic 4xx responses are authoritative and are never retried', async (t) => {
  for (const status of [400, 401, 409, 422]) {
    await t.test(String(status), async () => {
      const batch = transportTestBatch();
      let requests = 0;
      await assert.rejects(
        postExactSupportBatch({
          baseUrl: 'https://api.example.test',
          batch,
          token: 'token',
          certificationKey: 'key',
          retryDelayMs: 0,
          fetchImpl: async () => {
            requests += 1;
            return new Response('deterministic rejection', { status });
          },
        }),
        new RegExp(`POST atomic exact-support batch -> ${status}: deterministic rejection`),
      );
      assert.equal(requests, 1);
    });
  }
});

test('response-body transport loss retries the unchanged operation and reconciles replay', async () => {
  const batch = transportTestBatch();
  const requests = [];
  const retries = [];
  const receipt = await postExactSupportBatch({
    baseUrl: 'https://api.example.test',
    batch,
    token: 'token',
    certificationKey: 'key',
    retryDelayMs: 0,
    onTransportRetry: (retry) => retries.push(retry),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => { throw new TypeError('terminated response body'); },
        };
      }
      return Response.json(exactBatchReceipt(batch, { alreadyApplied: true }));
    },
  });
  assert.equal(receipt.already_applied, true);
  assert.equal(requests.length, 2);
  assert.strictEqual(requests[0].init, requests[1].init);
  assert.deepEqual(retries.map((retry) => retry.reason), ['response_body_transport']);
});

test('deterministic 4xx remains non-retryable when its response body is lost', async () => {
  const batch = transportTestBatch();
  let requests = 0;
  await assert.rejects(
    postExactSupportBatch({
      baseUrl: 'https://api.example.test',
      batch,
      token: 'token',
      certificationKey: 'key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return {
          ok: false,
          status: 409,
          text: async () => { throw new TypeError('terminated response body'); },
        };
      },
    }),
    /POST atomic exact-support batch -> 409: response body unavailable/,
  );
  assert.equal(requests, 1);
});

test('a successful response with a drifted operation receipt fails closed without retry', async () => {
  const batch = transportTestBatch();
  let requests = 0;
  await assert.rejects(
    postExactSupportBatch({
      baseUrl: 'https://api.example.test',
      batch,
      token: 'token',
      certificationKey: 'key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return Response.json({
          ...exactBatchReceipt(batch),
          operation_id: 'different-operation',
        });
      },
    }),
    /returned an invalid receipt/,
  );
  assert.equal(requests, 1);
});

test('base URL query/fragment and an attempt count above two fail before network', async () => {
  const batch = transportTestBatch();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return Response.json(exactBatchReceipt(batch));
  };
  for (const baseUrl of [
    'https://api.example.test?target=other',
    'https://api.example.test/#fragment',
    'https://api.example.test?',
    'https://api.example.test#',
  ]) {
    await assert.rejects(
      postExactSupportBatch({
        baseUrl,
        batch,
        token: 'token',
        certificationKey: 'key',
        fetchImpl,
      }),
      /API base URL cannot contain a query or fragment/,
    );
  }
  await assert.rejects(
    postExactSupportBatch({
      baseUrl: 'https://api.example.test',
      batch,
      token: 'token',
      certificationKey: 'key',
      fetchImpl,
      transportAttempts: 3,
    }),
    /transportAttempts must be 1 or 2/,
  );
  assert.equal(requests, 0);
});

test('default retry diagnostics never expose auth, request, response, or transport secrets', async () => {
  const batch = transportTestBatch();
  batch.entries[0].support.note = 'secret-request-body';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));
  let requests = 0;
  try {
    await postExactSupportBatch({
      baseUrl: 'https://api.example.test',
      batch,
      token: 'secret-api-token',
      certificationKey: 'secret-certification-key',
      retryDelayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        if (requests === 1) {
          return new Response('secret-upstream-response', { status: 503 });
        }
        return Response.json(exactBatchReceipt(batch, { alreadyApplied: true }));
      },
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 503/);
  assert.doesNotMatch(
    warnings[0],
    /secret-api-token|secret-certification-key|secret-request-body|secret-upstream-response/,
  );
});

test('every simple certification client uses the shared retry/receipt transport', () => {
  for (const file of [
    'basic-actions-certifications.mjs',
    'certify-mini-mvp-fighting-style-primitives.mjs',
    'mark-mini-mvp-forge-sheet-roots.mjs',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{ postExactSupportBatch \} from '\.\/exact-support-batch-client\.mjs';/);
    assert.match(source, /return postExactSupportBatch\(\{/);
    assert.doesNotMatch(source, /fetch\([^\n]*\/api\/content-support\/batch-exact/);
  }
});
