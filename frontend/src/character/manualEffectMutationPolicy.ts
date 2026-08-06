export const ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON =
  'Ручное изменение эффектов недоступно в сетевом бою: его должен выполнить авторитетный обработчик боя.';

export function manualEffectMutationBlockReason(
  currentEncounterId: string | null | undefined,
): string | null {
  return currentEncounterId ? ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON : null;
}

export function assertManualEffectMutationAllowed(
  currentEncounterId: string | null | undefined,
): void {
  const reason = manualEffectMutationBlockReason(currentEncounterId);
  if (reason) throw new Error(reason);
}
