/**
 * Спасброски смерти (PHB 2024): при 0 хитов персонаж без сознания и в начале
 * своих ходов бросает к20 без модификаторов. 10+ — успех, иначе провал;
 * нат. 20 — очнуться с 1 хитом; нат. 1 — два провала. Три успеха — стабилен,
 * три провала — смерть. Урон в нуле — провал (крит — два), лечение сбрасывает.
 * Состояние хранится в turn_state.death_saves (jsonb персонажа).
 */

export interface DeathSaveState {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
}

export type DeathSaveOutcome =
  | 'success'
  | 'fail'
  | 'crit_fail'
  | 'revive'   // нат. 20 — 1 хит
  | 'stable'   // третий успех
  | 'dead';    // третий провал

export const emptyDeathSaves = (): DeathSaveState => ({
  successes: 0, failures: 0, stable: false, dead: false,
});

export function readDeathSaves(turnState: Record<string, unknown> | null | undefined): DeathSaveState {
  const raw = (turnState?.death_saves ?? null) as Partial<DeathSaveState> | null;
  return { ...emptyDeathSaves(), ...(raw ?? {}) };
}

export function applyDeathSaveRoll(
  ds: DeathSaveState,
  natural: number,
): { next: DeathSaveState; outcome: DeathSaveOutcome } {
  if (natural === 20) return { next: emptyDeathSaves(), outcome: 'revive' };
  if (natural === 1) {
    const failures = Math.min(3, ds.failures + 2);
    const dead = failures >= 3;
    return { next: { ...ds, failures, dead }, outcome: dead ? 'dead' : 'crit_fail' };
  }
  if (natural >= 10) {
    const successes = Math.min(3, ds.successes + 1);
    const stable = successes >= 3;
    return { next: { ...ds, successes, stable }, outcome: stable ? 'stable' : 'success' };
  }
  const failures = Math.min(3, ds.failures + 1);
  const dead = failures >= 3;
  return { next: { ...ds, failures, dead }, outcome: dead ? 'dead' : 'fail' };
}

/** Урон при 0 хитов: провал (критическое попадание — два провала). */
export function applyDamageAtZero(
  ds: DeathSaveState,
  crit = false,
): { next: DeathSaveState; dead: boolean } {
  const failures = Math.min(3, ds.failures + (crit ? 2 : 1));
  const dead = failures >= 3;
  return { next: { ...ds, failures, dead, stable: false }, dead };
}

export function describeDeathSaveOutcome(outcome: DeathSaveOutcome, natural: number): string {
  switch (outcome) {
    case 'revive': return `Спасбросок смерти: нат. 20 — вы приходите в себя с 1 хитом!`;
    case 'stable': return `Спасбросок смерти: ${natural} — третий успех, вы стабилизированы.`;
    case 'dead': return `Спасбросок смерти: ${natural} — третий провал. Персонаж погибает.`;
    case 'crit_fail': return `Спасбросок смерти: нат. 1 — два провала!`;
    case 'success': return `Спасбросок смерти: ${natural} — успех.`;
    case 'fail': return `Спасбросок смерти: ${natural} — провал.`;
  }
}
