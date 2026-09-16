import {useSyncExternalStore} from 'react';

export const PASSIVE_PREFERENCES_KEY = 'dnd-cards:combat-passive-toggles:v1';
const changed = 'dnd-cards:passive-preferences-changed';
let snapshot: Record<string, boolean> = {};
let serialized: string | null | undefined;
function read() {
  let raw: string | null;
  try { raw = localStorage.getItem(PASSIVE_PREFERENCES_KEY); } catch { return snapshot; }
  if (raw === serialized) return snapshot;
  serialized = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    snapshot = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([,value]) => typeof value === 'boolean')) : {};
  } catch { snapshot = {}; }
  return snapshot;
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === PASSIVE_PREFERENCES_KEY || !event.key) listener(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(changed, listener); };
}
export function setPassivePreference(id: string, enabled: boolean) {
  snapshot = {...read(), [id]: enabled};
  try { const next = JSON.stringify(snapshot); localStorage.setItem(PASSIVE_PREFERENCES_KEY, next); serialized = next; }
  catch { /* Session-only preferences remain usable when storage is unavailable. */ }
  window.dispatchEvent(new Event(changed));
}
export function usePassivePreferences() {
  return [useSyncExternalStore(subscribe, read), setPassivePreference] as const;
}
