import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { FIGHTER_CTX_EQUIPPED, equippedFighterState } from '../mvp/fixtures';
import { applyDamageAtZero, applyDeathSaveRoll, emptyDeathSaves } from './deathSaves';
import { collectLifePolicies, immediateDeathSaveRequired, remainsConsciousAtZero, zeroHpLifeConsequences } from './lifePolicies';
import { startTurn } from './turn';

type Dict = Record<string, unknown>;
const state = (hp = 0): RuntimeState => ({ ...equippedFighterState(), hp: { current: hp, max: 30, temp: 0 }, deathSaves: emptyDeathSaves() });
const passive = (id: string, payload: Dict): Dict => ({ id, name: id, effects: [{ resolution: 'auto', result: [{ kind: 'life_policy', ...payload }] }] });
const vulnerable = passive('sacrifice', { max_death_failures: 1, immediate_death_save: true });
const staff = passive('staff', { remain_conscious_at_zero: true,
  on_damage_at_zero: [{ kind: 'condition', op: 'apply', value: 'exhaustion' }],
  on_turn_start_at_zero: [{ kind: 'condition', op: 'apply', value: 'exhaustion' }],
});
const exhaustion = (runtime: RuntimeState) => runtime.activeEffects.filter(effect => effect.mechanics.kind === 'condition' && effect.mechanics.value === 'exhaustion');

describe('content-owned life policies', () => {
  it('uses independent failure limits for two entities without changing the default', () => {
    const one = collectLifePolicies(state(), [vulnerable]);
    const two = collectLifePolicies(state(), [passive('second', { max_death_failures: 2 })]);
    expect(applyDeathSaveRoll(emptyDeathSaves(), 4, 4, undefined, one).outcome).toBe('dead');
    const first = applyDeathSaveRoll(emptyDeathSaves(), 4, 4, undefined, two);
    expect(first.outcome).toBe('fail');
    expect(applyDeathSaveRoll(JSON.parse(JSON.stringify(first.next)), 9, 9, undefined, two).outcome).toBe('dead');
    expect(applyDeathSaveRoll(first.next, 9).outcome).toBe('fail');
    expect(applyDamageAtZero(emptyDeathSaves(), false, one).dead).toBe(true);
  });

  it('asks for an immediate save only on the transition that actually loses consciousness', () => {
    const policy = collectLifePolicies(state(), [vulnerable]);
    expect(immediateDeathSaveRequired(state(7), state(), policy)).toBe(true);
    expect(immediateDeathSaveRequired(state(), state(), policy)).toBe(false);
    expect(immediateDeathSaveRequired(state(7), state(1), policy)).toBe(false);
    expect(immediateDeathSaveRequired(state(7), state(), collectLifePolicies(state(), [vulnerable, staff]))).toBe(false);
  });

  it('survives serialization and checks current hands before preventing death', () => {
    const sceptre = passive('sceptre', { cannot_die: true, requires_held_item: 'held-item' });
    const held = { ...state(), equipment: { main_hand: 'held-item' } };
    const protectedPolicy = collectLifePolicies(JSON.parse(JSON.stringify(held)), [sceptre]);
    const failing = { ...emptyDeathSaves(), failures: 2 };
    expect(applyDeathSaveRoll(failing, 3, 3, undefined, protectedPolicy).next).toMatchObject({ failures: 3, dead: false });
    expect(applyDamageAtZero(failing, true, protectedPolicy).dead).toBe(false);
    const releasedPolicy = collectLifePolicies({ ...held, equipment: {} }, [sceptre]);
    expect(applyDamageAtZero(failing, false, releasedPolicy).dead).toBe(true);
  });

  it('supports an independent revive threshold and ignores expired or false-gated sources', () => {
    const aura = passive('aura', { revive_at_natural: 19 });
    expect(applyDeathSaveRoll(emptyDeathSaves(), 19, 19, undefined, collectLifePolicies(state(), [aura])).outcome).toBe('revive');
    const expired = { ...state(), activeEffects: [{ id: 'expired', name: 'expired', roundsLeft: 0, mechanics: aura }] } as RuntimeState;
    expect(collectLifePolicies(expired).reviveAtNatural).toBe(20);
    expect(collectLifePolicies(state(), [passive('held-other', { cannot_die: true, requires_held_item: 'absent' })]).cannotDie).toBe(false);
  });

  it('applies each exhaustion level through the shared condition executor at turn start', () => {
    const ctx = { ...FIGHTER_CTX_EQUIPPED, passives: [staff] };
    const first = startTurn(state(), ctx).state;
    expect(exhaustion(first)).toHaveLength(1);
    const second = startTurn(JSON.parse(JSON.stringify(first)), ctx).state;
    expect(exhaustion(second)).toHaveLength(2);
    expect(remainsConsciousAtZero(second, [staff])).toBe(true);
    expect(exhaustion(startTurn(state(3), ctx).state)).toHaveLength(0);
    expect(zeroHpLifeConsequences(second, collectLifePolicies(second, [staff]), 'damage')).toEqual([
      { source: 'staff', sourceId: 'staff', payloads: [{ kind: 'condition', op: 'apply', value: 'exhaustion' }] },
    ]);
  });

  it('rejects malformed limits and condition consequences before execution', () => {
    expect(() => collectLifePolicies(state(), [passive('invalid', { max_death_failures: 0 })])).toThrow();
    expect(() => collectLifePolicies(state(), [passive('invalid', { on_damage_at_zero: [{ kind: 'damage', amount: 4 }] })])).toThrow();
  });
});
