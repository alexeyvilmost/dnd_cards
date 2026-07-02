/**
 * Общие утилиты API для контентных скриптов (фаза G1).
 */
const DEFAULT_API = 'https://backend-production-41c3.up.railway.app';

export function apiUrl() {
  return process.env.API_URL || DEFAULT_API;
}

export async function fetchAll(path, key, { retries = 3, limit = 100 } = {}) {
  const base = apiUrl();
  const items = [];
  let page = 1;
  while (true) {
    let batch = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${base}${path}?page=${page}&limit=${limit}`);
        if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
        const data = await res.json();
        batch = data[key] || [];
        break;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    items.push(...batch);
    if (batch.length < limit) break;
    page++;
  }
  return items;
}

export async function login({
  user = process.env.AUTH_USER || 'importer_user',
  pass = process.env.AUTH_PASS || 'importer_pass123',
} = {}) {
  const base = apiUrl();
  await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: user,
      password: pass,
      email: `${user}@example.com`,
      display_name: 'Content Seeder',
    }),
  }).catch(() => {});

  const res = await fetch(`${base}/api/auth/login`, {
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
