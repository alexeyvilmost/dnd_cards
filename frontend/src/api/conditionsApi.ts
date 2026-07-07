import { effectsApi } from './client';
import { registerConditions, type ConditionModifier, type ConditionRule } from '../engine/conditions';
import { payloadsOf } from '../engine/mechanicsView';

/** Payload modifier эффекта-состояния → правило ConditionModifier (scope сохраняется). */
function toConditionModifier(p: Record<string, unknown>): ConditionModifier | null {
  if (p.kind !== 'modifier') return null;
  const applies = p.applies_to as ConditionModifier['applies_to'] | undefined;
  if (!applies?.roll) return null;
  return {
    applies_to: applies,
    op: String(p.op ?? 'add') as ConditionModifier['op'],
    ...(p.value != null ? { value: String(p.value) } : {}),
    ...(p.scope === 'target' ? { scope: 'target' as const } : {}),
  };
}

/**
 * Догрузить состояния из эффектов типа 'condition' в реестр движка. Состояние — это
 * ЭФФЕКТ (effect_type='condition'); его scoped-модификаторы (self/target) лежат в mechanics.
 * Идемпотентно; при ошибке — тихо остаёмся на встроенных состояниях.
 */
export async function loadConditions(): Promise<void> {
  try {
    const res = await effectsApi.getEffects({ effect_type: 'condition', limit: 200 });
    const defs: ConditionRule[] = (res.effects ?? [])
      .map((e) => {
        const modifiers = payloadsOf(e.mechanics as Record<string, unknown> | undefined)
          .map(toConditionModifier)
          .filter((m): m is ConditionModifier => m !== null);
        const id = String(e.card_number ?? '').replace(/^COND-/, '');
        return { id, label: e.name, modifiers, note: e.description || undefined };
      })
      .filter((d) => d.id);
    if (defs.length) registerConditions(defs);
  } catch {
    /* сеть/эндпойнт недоступны — работаем на встроенных состояниях */
  }
}
