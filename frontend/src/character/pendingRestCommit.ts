import type { PreparedSheetAtomicWorldCommit } from './sheetAtomicWorldCommit';

export type PendingRestCommit = { restType: 'short_rest' | 'long_rest' } & (
  { kind: 'sheet'; granted: boolean; prepared: PreparedSheetAtomicWorldCommit }
  | { kind: 'run'; runId: string; revision: number; commandId: string; payload: Record<string, unknown> }
);
const key = (id: string) => `dnd:pending-rest:v1:${id}`;
export function readPendingRestCommit(id: string, store: Pick<Storage, 'getItem'> = localStorage): PendingRestCommit | null {
  const raw = store.getItem(key(id));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingRestCommit;
  if (!['short_rest','long_rest'].includes(value.restType)
    || (value.kind === 'sheet' ? value.prepared?.request?.participants?.length !== 1 || value.prepared.request.participants[0].character_id !== id
      : value.kind !== 'run' || value.payload.actor_id !== id || !Number.isSafeInteger(value.revision) || !value.commandId || !value.runId)) {
    throw Error('Сохранённая команда отдыха повреждена');
  }
  return value;
}
export function writePendingRestCommit(id: string, value: PendingRestCommit | null, store: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  if (value) store.setItem(key(id), JSON.stringify(value));
  else store.removeItem(key(id));
}
