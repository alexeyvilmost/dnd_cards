import { describe, expect, it } from 'vitest';
import { collectItemMechanics } from './attunement';
import { collectSheetActions } from './actionSheet';
import { emitEvent, executeAction } from '../engine/execute';
import { startTurn } from '../engine/turn';
import { equippedFighterState, FIGHTER_CTX_EQUIPPED } from '../mvp/fixtures';
import type { Card } from '../types';
import type { AssembledCharacter } from './assemble';
import type { ExecuteContext } from '../mvp/contracts';

const assembled = { actions: [], effects: [], spells: [] } as unknown as AssembledCharacter;
const policy = { kind: 'reduce_damage', amount: 2, filter: { source_actor: 'self', source_kinds: ['item'] } };
describe('item compiler retains damage origin through actions and nested listeners', () => {
  it.each([['flask', 5], ['amulet', 8]] as const)('binds %s origin without changing its immutable card', (id, amount) => {
    const damage = { resolution: 'auto', who: 'self', result: [{ kind: 'damage', amount, type: 'force' }] };
    const card = { id, name: id, mechanics: { activation: { mode: 'active', cost: [] }, effects: [damage] } } as unknown as Card;
    const itemMechanics = collectItemMechanics({ main_hand: id }, new Map([[id, card]]), {});
    expect(itemMechanics).toHaveLength(1);
    const action = collectSheetActions(assembled, itemMechanics).find(row => row.itemRef?.id === id)!;
    expect(card.mechanics?.damage_source_kind).toBeUndefined();
    const state = { ...equippedFighterState(), hp: { current: 20, max: 20, temp: 0 } };
    const ctx: ExecuteContext = { selfId: 'hero', character: FIGHTER_CTX_EQUIPPED, passives: [policy], rng: () => { throw Error('Unexpected RNG'); } };
    expect(executeAction(state, action.mechanics, ctx).state.hp.current).toBe(20 - amount + 2);
    const passive = { ...itemMechanics[0].mechanics, activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [
      { kind: 'triggered_effect', event: 'turn_start', effects: [damage] },
    ] }] };
    const restored = JSON.parse(JSON.stringify(state));
    expect(emitEvent({ kind: 'turn_start', source: 'self' }, restored, { ...ctx, passives: [policy, passive] }, [], []).hp.current).toBe(20 - amount + 2);
    const turnContext = { ...ctx.character, selfId: 'hero', passives: [policy, passive], rng: ctx.rng };
    expect(startTurn(restored, turnContext).state.hp.current).toBe(20 - amount + 2);
  });
});
