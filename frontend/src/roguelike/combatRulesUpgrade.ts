import {ApiRequestError} from '../api/client';
import {roguelikeApi, type RoguelikeRun} from './api';

/** Retain the same receipt ID/revision after an uncertain response, including
 * reload. Store no combat snapshot, token or private entropy in the browser. */
export async function commandCombatRulesUpgrade(run: RoguelikeRun): Promise<RoguelikeRun> {
  const key = `boh:combat-rules-upgrade:v1:${run.id}`;
  let pending: {id: string; revision: number} | undefined;
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) && Number.isSafeInteger(value.revision) && value.revision >= 0) pending = value;
    } catch { /* Corrupt non-authoritative transport metadata is replaceable. */ }
  }
  pending ??= {id: crypto.randomUUID(), revision: run.revision};
  localStorage.setItem(key, JSON.stringify(pending));
  try {
    const accepted = await roguelikeApi.command(run.id, pending.revision, 'upgrade_combat_rules', {}, pending.id);
    localStorage.removeItem(key);
    return accepted;
  } catch (error) {
    // A definite rejection cannot have committed. Network/5xx outcomes retain
    // the original ID so a repeated click recovers the receipt exactly once.
    if (error instanceof ApiRequestError && error.status && error.status >= 400 && error.status < 500) localStorage.removeItem(key);
    throw error;
  }
}
