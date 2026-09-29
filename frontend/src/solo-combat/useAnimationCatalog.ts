import { useEffect, useSyncExternalStore } from 'react';
import { apiClient } from '../api/client';
import { getCombatAnimationCatalog, setCombatAnimationCatalog, type CombatAnimationCatalog } from './animationProfiles';

let pending: Promise<void> | undefined;
let loaded = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function loadAnimationCatalog(force = false): Promise<void> {
  if (pending) return pending;
  if (loaded && !force) return Promise.resolve();
  pending = apiClient.get<CombatAnimationCatalog>('/api/animations').then(response => {
    const catalog = response.data;
    if (!Array.isArray(catalog.profiles) || !Array.isArray(catalog.bindings) || !catalog.defaults) return;
    setCombatAnimationCatalog(catalog);
    loaded = true;
    listeners.forEach(listener => listener());
  }).catch(() => { /* Auth/network failures never interrupt an encounter. */ }).finally(() => { pending = undefined; });
  return pending;
}
export function useAnimationCatalog(): CombatAnimationCatalog {
  const catalog = useSyncExternalStore(subscribe, getCombatAnimationCatalog, getCombatAnimationCatalog);
  useEffect(() => {
    void loadAnimationCatalog();
    const refresh = () => { void loadAnimationCatalog(true); };
    window.addEventListener('animation-catalog-changed', refresh);
    return () => window.removeEventListener('animation-catalog-changed', refresh);
  }, []);
  return catalog;
}
