import { apiClient } from './client';
import { registerConditions, type ConditionRule } from '../engine/conditions';

interface ConditionDTO {
  condition_id: string;
  name: string;
  data?: {
    modifiers?: ConditionRule['modifiers'];
    projected_modifiers?: ConditionRule['modifiers'];
    note?: string;
  };
}

/**
 * Догрузить состояния из /api/conditions в реестр движка. Идемпотентно; при ошибке
 * (эндпойнт ещё не задеплоен / нет сети) — тихо остаёмся на встроенных состояниях.
 */
export async function loadConditions(): Promise<void> {
  try {
    const res = await apiClient.get<{ conditions: ConditionDTO[] }>('/api/conditions');
    const defs: ConditionRule[] = (res.data?.conditions ?? []).map((c) => ({
      id: c.condition_id,
      label: c.name,
      modifiers: c.data?.modifiers ?? [],
      projected: c.data?.projected_modifiers,
      note: c.data?.note,
    }));
    if (defs.length) registerConditions(defs);
  } catch {
    /* сеть/эндпойнт недоступны — работаем на встроенных состояниях */
  }
}
