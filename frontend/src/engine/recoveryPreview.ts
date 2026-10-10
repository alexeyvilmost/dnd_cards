import { resolveActionUsesRecovery, usesFromMechanics } from './actionUses';

type RecoveryEntity = {
  mechanics?: Record<string, unknown> | null;
  recharge?: string | null;
  recharge_custom?: string | null;
};

const PERIOD_LABELS: Record<string, string> = {
  short_rest: 'Короткий или долгий отдых',
  long_rest: 'Долгий отдых',
  day: 'Ежедневно',
  turn: 'Каждый ход',
  per_turn: 'Каждый ход',
  encounter: 'Каждый бой',
  per_battle: 'Каждый бой',
  never: 'Не восстанавливаются',
  manual: 'Пополнение вручную',
};

/** Presentation only: the rest engine remains responsible for recovery. */
export function recoveryPreview(entity: RecoveryEntity): string {
  const bounded = resolveActionUsesRecovery(entity.mechanics);
  if (bounded.status === 'invalid') return 'Срок восстановления не задан корректно';
  if (bounded.status === 'configured') {
    const { short_rest: short, long_rest: long } = bounded.recovery;
    const labels: string[] = [];
    if (short.mode === 'fixed') labels.push(`Короткий отдых: +${short.amount}`);
    labels.push(long.mode === 'full'
      ? (labels.length ? 'долгий отдых: все заряды' : 'Долгий отдых')
      : `Долгий отдых: ${long.dice.replace(/d/gi, 'к')} зарядов`);
    return labels.join('; ');
  }
  // Explicit prose can describe conditions or several shared resource pools.
  if (entity.recharge === 'custom' && entity.recharge_custom?.trim()) {
    return entity.recharge_custom.trim();
  }
  const uses = usesFromMechanics(entity.mechanics);
  const per = uses?.per || entity.recharge;
  return per ? PERIOD_LABELS[per] || '' : '';
}
