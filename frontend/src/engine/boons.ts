import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export type BoonRollKind = 'attack_roll' | 'saving_throw' | 'ability_check';
export type BoonTiming = 'before_roll' | 'after_failure';

export interface RuntimeBoonSpec {
  effectId: string;
  name: string;
  die: string;
  faces: number;
  appliesTo: BoonRollKind[];
  timing: BoonTiming[];
  refundOnFailure?: { resource: string; amount: number };
}

function boonMechanics(effect: ActiveEffectEntry): Dict | null {
  const mechanics = effect.mechanics as Dict;
  return mechanics.kind === 'boon' ? mechanics : null;
}

export function runtimeBoonSpec(effect: ActiveEffectEntry): RuntimeBoonSpec | null {
  const mechanics = boonMechanics(effect);
  if (!mechanics) return null;
  const die = String(mechanics.die ?? '');
  const match = die.match(/^1d(\d+)$/i);
  const faces = Number(match?.[1]);
  const appliesTo = Array.isArray(mechanics.applies_to)
    ? mechanics.applies_to.filter((value): value is BoonRollKind => (
      value === 'attack_roll' || value === 'saving_throw' || value === 'ability_check'
    ))
    : [];
  const declaredTiming = Array.isArray(mechanics.timing)
    ? mechanics.timing
    : [mechanics.timing ?? 'before_roll'];
  const timing = declaredTiming.filter((value): value is BoonTiming => (
    value === 'before_roll' || value === 'after_failure'
  ));
  if (!Number.isInteger(faces) || faces < 2 || !appliesTo.length || !timing.length) return null;
  const rawRefund = mechanics.refund_on_failure as Dict | undefined;
  const refundResource = String(rawRefund?.resource ?? '').trim();
  const refundAmount = Number(rawRefund?.amount ?? 0);
  const refundOnFailure = refundResource && Number.isInteger(refundAmount) && refundAmount > 0
    ? { resource: refundResource, amount: refundAmount }
    : undefined;
  return { effectId: effect.id, name: effect.name, die, faces, appliesTo, timing, ...(refundOnFailure ? { refundOnFailure } : {}) };
}

export function runtimeBoons(state: RuntimeState): RuntimeBoonSpec[] {
  return state.activeEffects.flatMap((effect) => {
    const spec = runtimeBoonSpec(effect);
    return spec ? [spec] : [];
  });
}

function engineRoll(kind: BoonRollKind): string {
  return kind === 'attack_roll' ? 'attack' : kind;
}

/** Convert one data-driven boon into the ordinary consumable modifier
 * primitive already understood by every sheet/combat d20 path. */
export function armBoonForNextRoll(
  state: RuntimeState,
  effectId: string,
  rollKind: BoonRollKind,
  timing: BoonTiming = 'before_roll',
): RuntimeState {
  const effect = state.activeEffects.find((candidate) => candidate.id === effectId);
  const spec = effect ? runtimeBoonSpec(effect) : null;
  if (!effect || !spec || !spec.appliesTo.includes(rollKind)
    || !spec.timing.includes(timing)) {
    throw new Error('Эту милость нельзя применить в выбранный момент броска.');
  }
  return {
    ...state,
    activeEffects: state.activeEffects.map((candidate) => candidate.id === effectId ? {
      ...candidate,
      name: `${candidate.name}: подготовлено`,
      mechanics: {
        kind: 'modifier',
        op: timing === 'after_failure' ? 'bonus_die_on_failure' : 'bonus_die',
        faces: spec.faces,
        sign: 1,
        applies_to: { roll: engineRoll(rollKind) },
        consume: timing === 'after_failure' ? 'next_on_failure' : 'next',
        source: candidate.name,
        boon: {
          effect_id: effectId,
          roll_kind: rollKind,
          timing,
          ...(spec.refundOnFailure ? { refund_on_failure: spec.refundOnFailure } : {}),
        },
      },
    } : candidate),
  };
}

/** Remove a boon only after the rules path actually rolled its bonus die. */
export function consumeBoonAfterFailure(
  state: RuntimeState,
  effectId: string,
  rollKind: BoonRollKind,
): { state: RuntimeState; spec: RuntimeBoonSpec } {
  const effect = state.activeEffects.find((candidate) => candidate.id === effectId);
  const spec = effect ? runtimeBoonSpec(effect) : null;
  if (!spec || !spec.appliesTo.includes(rollKind) || !spec.timing.includes('after_failure')) {
    throw new Error('Эту милость нельзя применить после провала выбранного броска.');
  }
  return {
    state: { ...state, activeEffects: state.activeEffects.filter((candidate) => candidate.id !== effectId) },
    spec,
  };
}
