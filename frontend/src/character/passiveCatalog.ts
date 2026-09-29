import { withoutEntityReferences, type EntityReferences } from '../api/entityReferences';
import {useEffect, useSyncExternalStore} from 'react';
import {apiClient} from '../api/client';
import type {PassiveEffect} from '../types';
import type {EntitySupportCertification, SupportableEntity} from '../content/supportStatus';
import {REVIEW_STATUS_CHANGED, type ReviewStatusChange} from '../api/contentReview';

export type PassivePresentation = EntityReferences & SupportableEntity & {key: string; name: string; description: string; image_url: string;
  enabled_description: string; disabled_description: string; version: number};
type Catalog = {passives: PassivePresentation[]; can_manage: boolean; loading?: boolean; error?: string};
// Defaults live in the server catalog. Until it loads, battle toggles keep their
// existing data-owned presentation; the frontend build needs no backend files.
let snapshot: Catalog = {passives: [],can_manage:false,loading:true};
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let fetched = false;
let pendingReviews: Map<string, EntitySupportCertification> | undefined;
const publish = (value: Catalog) => {snapshot=value;listeners.forEach(listener=>listener());};
export function loadPassiveCatalog(force = false): Promise<void> {
  if (pending) return force ? pending.then(() => loadPassiveCatalog(true)) : pending;
  if (fetched && !force) return Promise.resolve();
  const reviews = new Map<string, EntitySupportCertification>();
  pendingReviews = reviews;
  pending = apiClient.get<Catalog>('/api/passive-presentations').then(response => {
    const passives = response.data.passives.map(row => reviews.has(row.key) ? {...row,support:reviews.get(row.key)} : row);
    fetched=true;publish({...response.data,passives});
  })
    .catch(() => publish({...snapshot,loading:false,error:'Не удалось загрузить сохранённое оформление пассивов.'})).finally(()=>{pending=undefined;pendingReviews=undefined;});
  return pending;
}
if (typeof window !== 'undefined') window.addEventListener(REVIEW_STATUS_CHANGED, (event: Event) => {
  const change = (event as CustomEvent<ReviewStatusChange>).detail;
  if (change?.entity_type !== 'passive') return;
  pendingReviews?.set(change.entity_id,change.support);
  publish({...snapshot,passives:snapshot.passives.map(row=>row.key===change.entity_id?{...row,support:change.support}:row)});
});
export function usePassiveCatalog() {
  const catalog = useSyncExternalStore(listener => {listeners.add(listener);return()=>{listeners.delete(listener);};},()=>snapshot);
  useEffect(()=>{void loadPassiveCatalog();},[]);
  return catalog;
}
export async function savePassivePresentation(row: PassivePresentation) {
  const {key,...body}=withoutEntityReferences(row);
  const saved=(await apiClient.put<PassivePresentation>(`/api/passive-presentations/${encodeURIComponent(key)}`,body)).data;
  publish({...snapshot,passives:snapshot.passives.map(candidate=>candidate.key===key?saved:candidate)});
  return saved;
}
export function passivePresentationEffect(row: PassivePresentation): PassiveEffect {
  return {id:row.key,support:row.support,name:row.name,description:row.description,image_url:row.image_url,
    effect_type:'passive',type:'Переключаемый пассив',rarity:'common',card_number:'',created_at:'',updated_at:'',
    show_detailed_description:true,detailed_description:`Включено: ${row.enabled_description}\n\nВыключено: ${row.disabled_description}`};
}
