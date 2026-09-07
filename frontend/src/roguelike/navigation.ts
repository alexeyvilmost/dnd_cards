import type { RoguelikeRun } from './api';

export const runSheetURL = (run: Pick<RoguelikeRun, 'id' | 'character_id'>) =>
  `/characters-v3/${run.character_id}?roguelike=${encodeURIComponent(run.id)}`;

export function runCombatURL(run: RoguelikeRun): string {
  const params = new URLSearchParams({ roguelike: run.id });
  if (!run.character?.turn_state?.solo_combat_v1 && run.encounter.monster_id && run.encounter.quantity) {
    params.set(run.encounter.monster_id, String(run.encounter.quantity));
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
