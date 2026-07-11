/** REST-клиент онлайн-боёв + базовый URL для SSE-потока (EventSource). */
import { apiClient } from '../api/client';
import type { Encounter, EncounterState, Combatant } from './encounterTypes';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://backend-production-41c3.up.railway.app';

export interface ApplyOp {
  patches?: { actor_id: string; set?: Record<string, unknown> }[];
  add?: Combatant[];
  remove?: string[];
  round?: number;
  active_index?: number;
  events?: unknown[];
}

export const encountersApi = {
  async list(): Promise<Encounter[]> {
    const r = await apiClient.get<{ encounters: Encounter[] }>('/api/encounters');
    return r.data.encounters ?? [];
  },
  async create(name: string): Promise<Encounter> {
    const r = await apiClient.post<Encounter>('/api/encounters', { name });
    return r.data;
  },
  async get(id: string): Promise<Encounter> {
    const r = await apiClient.get<Encounter>(`/api/encounters/${id}`);
    return r.data;
  },
  async join(id: string): Promise<Encounter> {
    const r = await apiClient.post<Encounter>(`/api/encounters/${id}/join`, {});
    return r.data;
  },
  /** Применить операцию — сервер бампит seq, персистит и рассылает подписчикам. */
  async apply(id: string, op: ApplyOp): Promise<{ seq: number; state: EncounterState }> {
    const r = await apiClient.post<{ seq: number; state: EncounterState }>(`/api/encounters/${id}/apply`, op);
    return r.data;
  },
  /** URL SSE-потока изменений боя (докачка с ?since=<seq>). */
  streamUrl(id: string, since: number): string {
    return `${API_BASE_URL}/api/encounters/${id}/stream?since=${since}`;
  },
};
