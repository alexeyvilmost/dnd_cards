/**
 * Общие утилиты API для контентных скриптов (фаза G1).
 */
const DEFAULT_API = 'https://backend-production-41c3.up.railway.app';

export function apiUrl() {
  return process.env.API_URL || DEFAULT_API;
}

export class RequiredCollectionError extends Error {
  constructor(path, key, page, reason) {
    super(`${path} page ${page}: required collection "${key}" ${reason}`);
    this.name = 'RequiredCollectionError';
    this.path = path;
    this.collection = key;
    this.page = page;
  }
}

export class PaginationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'PaginationError';
    this.path = path;
  }
}

export function readRequiredCollection(body, key, { path = '<response>', page = 1 } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequiredCollectionError(path, key, page, 'is missing because the response is not an object');
  }
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    throw new RequiredCollectionError(path, key, page, 'is missing');
  }
  if (!Array.isArray(body[key])) {
    throw new RequiredCollectionError(path, key, page, 'must be an array');
  }
  return body[key];
}

function asOptionalNonNegativeInteger(value, field, path) {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PaginationError(path, `response ${field} must be a non-negative integer`);
  }
  return parsed;
}

function buildPageUrl(baseUrl, path, page, limit) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(path, normalizedBase);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  return url;
}

function isRetryable(error) {
  if (error instanceof RequiredCollectionError || error instanceof PaginationError) return false;
  if (typeof error?.status !== 'number') return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export async function fetchAll(path, key, {
  retries = 3,
  limit = 100,
  baseUrl = apiUrl(),
  fetchImpl = globalThis.fetch,
  maxPages = 10_000,
  retryDelayMs = 1500,
} = {}) {
  if (!Number.isSafeInteger(retries) || retries < 1) {
    throw new TypeError('fetchAll retries must be a positive integer');
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError('fetchAll limit must be a positive integer');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new TypeError('fetchAll maxPages must be a positive integer');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchAll fetchImpl must be a function');

  const items = [];
  let expectedTotal = null;
  let page = 1;
  while (true) {
    let batch = null;
    let body = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(buildPageUrl(baseUrl, path, page, limit).href);
        if (!res.ok) {
          const error = new Error(`${path} HTTP ${res.status}`);
          error.status = res.status;
          throw error;
        }
        body = await res.json();
        batch = readRequiredCollection(body, key, { path, page });
        break;
      } catch (err) {
        if (attempt === retries || !isRetryable(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }

    const responsePage = asOptionalNonNegativeInteger(body.page, 'page', path);
    if (responsePage !== null && responsePage !== page) {
      throw new PaginationError(path, `requested page ${page}, response echoed page ${responsePage}`);
    }

    const responseTotal = asOptionalNonNegativeInteger(body.total, 'total', path);
    if (responseTotal !== null) {
      if (expectedTotal !== null && responseTotal !== expectedTotal) {
        throw new PaginationError(
          path,
          `response total changed from ${expectedTotal} to ${responseTotal} on page ${page}`,
        );
      }
      expectedTotal = responseTotal;
    }

    items.push(...batch);
    if (expectedTotal !== null) {
      if (items.length > expectedTotal) {
        throw new PaginationError(path, `received ${items.length} records, response total is ${expectedTotal}`);
      }
      if (items.length === expectedTotal) break;
      if (batch.length === 0) {
        throw new PaginationError(
          path,
          `received an empty page after ${items.length} of ${expectedTotal} records`,
        );
      }
    } else if (batch.length === 0) {
      break;
    }

    if (page >= maxPages) {
      throw new PaginationError(path, `exceeded maxPages=${maxPages}`);
    }
    page++;
  }
  return items;
}

export async function fetchRequiredCollection(path, key, options = {}) {
  const { allowEmpty = false, ...fetchOptions } = options;
  const items = await fetchAll(path, key, fetchOptions);
  if (!allowEmpty && items.length === 0) {
    throw new RequiredCollectionError(path, key, 1, 'must not be empty');
  }
  return items;
}

export async function login({
  token = process.env.API_TOKEN,
  user = process.env.CONTENT_ADMIN_USERNAME,
  pass = process.env.CONTENT_ADMIN_PASSWORD,
  baseUrl = apiUrl(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof token === 'string' && token.trim() !== '') return token.trim();
  if (typeof user !== 'string' || user.trim() === ''
    || typeof pass !== 'string' || pass.length === 0) {
    throw new Error(
      'API_TOKEN or CONTENT_ADMIN_USERNAME and CONTENT_ADMIN_PASSWORD must be explicitly configured',
    );
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('login fetchImpl must be a function');
  const res = await fetchImpl(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data.token) throw new Error('No token in login response');
  return data.token;
}

export async function apiRequest(token, method, path, body, { retries = 3, dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[DRY] ${method} ${path}`, body ? JSON.stringify(body).slice(0, 120) : '');
    return { dryRun: true };
  }
  const base = apiUrl();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* */ }
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
      return json;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

/** Индекс сущностей по id и card_number. */
export function buildIndex(items) {
  const byKey = new Map();
  for (const item of items) {
    if (item.id) byKey.set(item.id, item);
    if (item.card_number) byKey.set(item.card_number, item);
  }
  return byKey;
}

export function resolveRef(ref, index) {
  if (!ref) return null;
  return index.get(ref) || null;
}
