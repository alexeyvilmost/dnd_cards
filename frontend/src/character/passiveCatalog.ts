import {useEffect, useSyncExternalStore} from 'react';
import {apiClient} from '../api/client';
import type {PassiveEffect} from '../types';

export type PassivePresentation = {key: string; name: string; description: string; image_url: string;
  enabled_description: string; disabled_description: string; version: number};
type Catalog = {passives: PassivePresentation[]; can_manage: boolean; loading?: boolean; error?: string};
// Defaults live in the server catalog. Until it loads, battle toggles keep their
// existing data-owned presentation; the frontend build needs no backend files.
let snapshot: Catalog = {passives: [],can_manage:false,loading:true};
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let fetched = false;
const publish = (value: Catalog) => {snapshot=value;listeners.forEach(listener=>listener());};
export function loadPassiveCatalog(force = false): Promise<void> {
  if (pending) return pending;
  if (fetched && !force) return Promise.resolve();
  pending = apiClient.get<Catalog>('/api/passive-presentations').then(response => {fetched=true;publish(response.data);})
    .catch(() => publish({...snapshot,loading:false,error:'Не удалось загрузить сохранённое оформление пассивов.'})).finally(()=>{pending=undefined;});
  return pending;
}
export function usePassiveCatalog() {
  const catalog = useSyncExternalStore(listener => {listeners.add(listener);return()=>{listeners.delete(listener);};},()=>snapshot);
  useEffect(()=>{void loadPassiveCatalog();},[]);
  return catalog;
}
export async function savePassivePresentation(row: PassivePresentation) {
  const {key,...body}=row;
  const saved=(await apiClient.put<PassivePresentation>(`/api/passive-presentations/${encodeURIComponent(key)}`,body)).data;
  publish({...snapshot,passives:snapshot.passives.map(candidate=>candidate.key===key?saved:candidate)});
  return saved;
}
export function passivePresentationEffect(row: PassivePresentation): PassiveEffect {
  return {id:row.key,name:row.name,description:row.description,image_url:row.image_url,
    effect_type:'passive',type:'Переключаемый пассив',rarity:'common',card_number:'',created_at:'',updated_at:'',
    show_detailed_description:true,detailed_description:`Включено: ${row.enabled_description}\n\nВыключено: ${row.disabled_description}`};
}
