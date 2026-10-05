import {AUTH_USER_STORAGE_KEY} from './authSession';
import {ImageAPIError} from './imageErrors';

interface StoredLegacyImageAttempt {
  id: string;
  key: string;
  owner: string;
  created_at: string;
}
export interface LegacyImageAttempt extends StoredLegacyImageAttempt {active: boolean}

const prefix = 'image-legacy-attempt:';
const active = new Set<string>();
const keyPattern = /^image-job:[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function unavailable(): ImageAPIError {
  return new ImageAPIError('Не удалось сохранить сведения о попытке в этом браузере. Генерация не запущена.', 'image_job_storage_unavailable', 'storage', undefined, undefined, 'not_started');
}

function context(): {storage: Storage; owner: string; namespace: string} {
  try {
    const storage = globalThis.localStorage;
    const user: unknown = JSON.parse(storage.getItem(AUTH_USER_STORAGE_KEY) ?? 'null');
    const owner = user && typeof user === 'object' && 'id' in user ? user.id : undefined;
    if (typeof owner !== 'string' || !owner.trim()) throw unavailable();
    return {storage, owner, namespace: `${prefix}${encodeURIComponent(owner)}:`};
  } catch {
    throw unavailable();
  }
}

function read(key: string, current = context()): StoredLegacyImageAttempt | null {
  try {
    if (!keyPattern.test(key)) throw unavailable();
    const raw = current.storage.getItem(current.namespace + key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw unavailable();
    const row = value as Record<string, unknown>;
    if (row.owner !== current.owner || row.key !== key || typeof row.id !== 'string' || !idPattern.test(row.id)
      || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw unavailable();
    // Return only the receipt fields, never arbitrary stored metadata.
    return {id: row.id, key, owner: current.owner, created_at: row.created_at};
  } catch {
    throw unavailable();
  }
}

function changed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('image-jobs-changed'));
}

export function readLegacyImageAttempt(key: string): {id: string} | null {
  const row = read(key);
  return row ? {id: row.id} : null;
}

export function beginLegacyImageAttempt(key: string): string {
  const current = context();
  const existing = read(key, current);
  if (existing) {
    throw new ImageAPIError('Результат предыдущей попытки неизвестен. Проверьте изображение и историю перед новым платным запросом.', 'image_legacy_attempt_unknown', 'application', existing.id, undefined, 'unknown');
  }
  let row: StoredLegacyImageAttempt;
  try {
    row = {id: globalThis.crypto.randomUUID(), key, owner: current.owner, created_at: new Date().toISOString()};
    const serialized = JSON.stringify(row);
    current.storage.setItem(current.namespace + key, serialized);
    if (current.storage.getItem(current.namespace + key) !== serialized) throw unavailable();
  } catch {
    throw unavailable();
  }
  active.add(key);
  changed();
  return row.id;
}

/** Acknowledgement only: this never sends or retries a generation request. */
export function finishLegacyImageAttempt(key: string): void {
  const current = context();
  if (!keyPattern.test(key)) throw unavailable();
  try {
    current.storage.removeItem(current.namespace + key);
    if (current.storage.getItem(current.namespace + key) !== null) throw unavailable();
  } catch {
    throw unavailable();
  }
  active.delete(key);
  changed();
}

/** A lost response keeps the durable receipt but ends this tab's active wait. */
export function markLegacyImageAttemptUnknown(key: string): void {
  active.delete(key);
  changed();
}

export function listLegacyImageAttempts(): LegacyImageAttempt[] {
  const current = context();
  try {
    return Object.keys(current.storage)
      .filter(key => key.startsWith(current.namespace))
      .map(key => read(key.slice(current.namespace.length), current))
      .filter((row): row is StoredLegacyImageAttempt => row !== null)
      .map(row => ({...row, active: active.has(row.key)}))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  } catch {
    throw unavailable();
  }
}
