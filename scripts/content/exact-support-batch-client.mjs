const DEFAULT_TRANSPORT_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 100;

function exactBatchEndpoint(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new TypeError('atomic exact-support batch requires a non-empty API base URL');
  }
  const candidate = baseUrl.trim();
  // URL normalizes a trailing bare `?` or `#` to an empty search/hash value,
  // so reject delimiters from the original input as well as parsed values.
  if (candidate.includes('?') || candidate.includes('#')) {
    throw new TypeError('atomic exact-support batch API base URL cannot contain a query or fragment');
  }
  let endpoint;
  try {
    endpoint = new URL(candidate);
  } catch (error) {
    throw new TypeError('atomic exact-support batch requires a valid API base URL', { cause: error });
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new TypeError('atomic exact-support batch requires a credential-free HTTP(S) API base URL');
  }
  if (endpoint.search || endpoint.hash) {
    throw new TypeError('atomic exact-support batch API base URL cannot contain a query or fragment');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/api/content-support/batch-exact`;
  return endpoint.href;
}

function assertBatchIdentity(batch) {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
    throw new TypeError('atomic exact-support batch must be an object');
  }
  if (typeof batch.operation_id !== 'string' || batch.operation_id.trim() === '') {
    throw new TypeError('atomic exact-support batch requires a stable operation_id');
  }
  if (!Number.isSafeInteger(batch.expected_count) || batch.expected_count < 1
    || !Array.isArray(batch.entries) || batch.entries.length !== batch.expected_count) {
    throw new TypeError('atomic exact-support batch expected_count must match its entries');
  }
}

function exactReceipt(receipt, batch) {
  const total = batch.expected_count;
  const freshApply = receipt?.already_applied === false
    && receipt?.updated === total
    && receipt?.already_in_requested_state_count === 0;
  const idempotentReplay = receipt?.already_applied === true
    && receipt?.updated === 0
    && receipt?.already_in_requested_state_count === total;
  if (receipt?.schema_version !== 1
    || receipt?.mode !== batch.mode
    || receipt?.plan_hash !== batch.plan_hash
    || receipt?.operation_id !== batch.operation_id
    || receipt?.total !== total
    || receipt?.cas !== 'atomic_exact_full_api_response_v1'
    || (!freshApply && !idempotentReplay)) {
    throw new Error('atomic exact-support batch returned an invalid receipt');
  }
  return receipt;
}

function retryableHttpStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function deterministicClientError(status) {
  return status >= 400 && status <= 499 && !retryableHttpStatus(status);
}

function transportFailure(error, batch, attempts, phase) {
  return new Error(
    `atomic exact-support batch ${batch.operation_id} ${phase} after ${attempts} attempts`,
    { cause: error },
  );
}

/**
 * Sends one exact-CAS batch with a byte-stable body and operation identity.
 * A socket failure, 408, 429, or 5xx can leave the write outcome ambiguous, so
 * the only safe retry is the same complete batch. The backend classifies a
 * committed replay as all-requested and returns an explicit already_applied
 * receipt. Deterministic 4xx responses and invalid receipts fail closed.
 */
export async function postExactSupportBatch({
  baseUrl,
  batch,
  token,
  certificationKey,
  fetchImpl = globalThis.fetch,
  transportAttempts = DEFAULT_TRANSPORT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  onTransportRetry = ({ attempt, attempts, operationId, reason, status }) => {
    const diagnostic = reason === 'http_status' ? `HTTP ${status}` : reason;
    console.warn(
      `Atomic exact-support transport ambiguity (${diagnostic}); retrying unchanged operation ${operationId} (${attempt + 1}/${attempts})`,
    );
  },
} = {}) {
  assertBatchIdentity(batch);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof token !== 'string' || token.trim() === '') {
    throw new TypeError('atomic exact-support batch requires an API token');
  }
  if (typeof certificationKey !== 'string' || certificationKey.trim() === '') {
    throw new TypeError('atomic exact-support batch requires a certification key');
  }
  if (!Number.isSafeInteger(transportAttempts) || transportAttempts < 1 || transportAttempts > 2) {
    throw new TypeError('transportAttempts must be 1 or 2');
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
    throw new TypeError('retryDelayMs must be an integer from 0 through 5000');
  }
  if (typeof sleepImpl !== 'function' || typeof onTransportRetry !== 'function') {
    throw new TypeError('atomic exact-support batch retry hooks must be functions');
  }

  const endpoint = exactBatchEndpoint(baseUrl);
  const requestBody = JSON.stringify(batch);
  const request = Object.freeze({
    method: 'POST',
    headers: Object.freeze({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Content-Certification-Key': certificationKey,
    }),
    body: requestBody,
  });

  for (let attempt = 1; attempt <= transportAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(endpoint, request);
    } catch (error) {
      if (attempt === transportAttempts) {
        throw transportFailure(
          error,
          batch,
          transportAttempts,
          'failed before an HTTP response',
        );
      }
      onTransportRetry({
        attempt,
        attempts: transportAttempts,
        operationId: batch.operation_id,
        reason: 'pre_response_transport',
      });
      if (retryDelayMs > 0) await sleepImpl(retryDelayMs);
      continue;
    }

    let responseText;
    try {
      responseText = await response.text();
    } catch (error) {
      if (deterministicClientError(response.status)) {
        throw new Error(
          `POST atomic exact-support batch -> ${response.status}: response body unavailable`,
          { cause: error },
        );
      }
      if (attempt === transportAttempts) {
        throw transportFailure(
          error,
          batch,
          transportAttempts,
          'lost the HTTP response body',
        );
      }
      onTransportRetry({
        attempt,
        attempts: transportAttempts,
        operationId: batch.operation_id,
        reason: 'response_body_transport',
        status: response.status,
      });
      if (retryDelayMs > 0) await sleepImpl(retryDelayMs);
      continue;
    }

    if (!response.ok) {
      if (retryableHttpStatus(response.status) && attempt < transportAttempts) {
        onTransportRetry({
          attempt,
          attempts: transportAttempts,
          operationId: batch.operation_id,
          reason: 'http_status',
          status: response.status,
        });
        if (retryDelayMs > 0) await sleepImpl(retryDelayMs);
        continue;
      }
      throw new Error(
        `POST atomic exact-support batch -> ${response.status}: ${responseText.slice(0, 500)}`,
      );
    }
    let receipt = null;
    try {
      receipt = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      throw new Error('atomic exact-support batch returned non-JSON success', { cause: error });
    }
    return exactReceipt(receipt, batch);
  }

  throw new Error('atomic exact-support batch exhausted its bounded attempts');
}
