import type { RoguelikeEncounter, RoguelikeRun } from './api';

export function runEncounterSelection(encounter: RoguelikeEncounter): Array<{ id: string; quantity: number }> {
  const rows = encounter.roster ?? (encounter.monster_id
    ? [{ monster_id: encounter.monster_id, quantity: encounter.quantity }] : []);
  const ids = new Set<string>();
  return rows.map((row) => {
    if (!row.monster_id || ids.has(row.monster_id) || !Number.isInteger(row.quantity) || Number(row.quantity) <= 0) {
      throw new Error('Сохранённый состав встречи повреждён');
    }
    ids.add(row.monster_id);
    return { id: row.monster_id, quantity: Number(row.quantity) };
  });
}

export const runSheetURL = (run: Pick<RoguelikeRun, 'id' | 'character_id'>) =>
  `/characters-v3/${run.character_id}?roguelike=${encodeURIComponent(run.id)}`;

export function runCombatURL(run: RoguelikeRun): string {
  const params = new URLSearchParams({ roguelike: run.id });
  if (!run.character?.turn_state?.solo_combat_v1) {
    for (const member of runEncounterSelection(run.encounter)) params.set(member.id, String(member.quantity));
  }
  return `/characters-v3/${run.character_id}/combat?${params}`;
}

export function activeRunId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('roguelike') || undefined;
}

export const RUN_UPDATED_EVENT = 'roguelike:updated';
export function notifyRunUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RUN_UPDATED_EVENT));
}
