/** REST-клиент онлайн-боёв + базовый URL для SSE-потока (EventSource). */
import { API_BASE_URL, apiClient } from '../api/client';
import type { Encounter, EncounterState, Combatant, EncounterEvent, BattleLogEntry } from './encounterTypes';

export interface ApplyOp {
  patches?: { actor_id: string; set?: Record<string, unknown> }[];
  add?: Combatant[];
  remove?: string[];
  round?: number;
  active_index?: number;
  events?: unknown[];
  /** Структурированный журнал: строки боя + адресные записи в журналы персонажей. */
  log?: BattleLogEntry[];
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
  /** Последние события боя (общий журнал) для бэкскролла на доске — хронологический порядок. */
  async getEvents(id: string, limit = 100): Promise<EncounterEvent[]> {
    const r = await apiClient.get<{ events: { seq: number; payload?: EncounterEvent }[] }>(`/api/encounters/${id}/events?limit=${limit}`);
    // Сервер отдаёт EncounterEvent-строки {seq, payload}; разворачиваем payload в плоское событие.
    return (r.data.events ?? []).map((e) => ({ ...(e.payload ?? {}), seq: e.seq } as EncounterEvent));
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
