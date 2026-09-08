import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import type {CharacterContext, RuntimeState} from '../mvp/contracts';
import {executeAction} from './execute';
import {applySourceTurnBoundary} from './sourceTurnExpiry';
import {validateMechanics} from './validateMechanics';
const source = readFileSync(new URL('../../../backend/migrations/battle_master_feint_219.go', import.meta.url), 'utf8');
const mechanics = JSON.parse(source.match(/const battleMasterFeint219 = `([^`]+)`/)![1]);
const character: CharacterContext = {level: 3, profBonus: 2, classLevels: {warrior: 3},
  abilityMods: {str: 3, dex: 2, con: 2, int: 0, wis: 0, cha: 0},
  variables: {superiority_die: {count: 1, sides: 8}}};
const fresh = (): RuntimeState => ({hp: {current: 50, max: 50, temp: 0},
  resources: {bonus_action: 1, superiority_die: 4}, maxResources: {bonus_action: 1, superiority_die: 4},
  equipment: {}, inventory: [], activeEffects: []});
const attack = {activation: {cost: []}, effects: [{resolution: 'attack_roll',
  attack_kind: 'unarmed', ability: 'str', who: 'target', on_hit: [{kind: 'damage', amount: 2, type: 'bludgeoning'}]}]};
const prepare = () => executeAction(fresh(), mechanics, {character, selfId: 'source',
  rng: () => {throw Error('Feint must not roll the die until a hit');}, target: {id: 'target', runtimeState: fresh()}});
describe('Feinting Attack', () => {
  it('uses valid shared mechanics and spends bonus action and die only on preparation', () => {
    const validation = validateMechanics(mechanics, {id: 'feint', name: 'Обманная атака', kind: 'action'});
    expect(validation.valid, validation.errors.join('; ')).toBe(true);
    const prepared = prepare();
    expect(prepared.state.resources).toEqual({bonus_action: 0, superiority_die: 3});
    expect(prepared.targetState!.activeEffects).toHaveLength(2);
  });
  it.each(['hit', 'miss', 'crit'])('consumes both benefits on the source next attack: %s', outcome => {
    const prepared = prepare();
    let rolls = 0;
    const result = executeAction(prepared.state, attack, {character, selfId: 'source',
      target: {id: 'target', ac: 15, runtimeState: structuredClone(prepared.targetState!)},
      rng: () => {rolls++; return rolls <= 2 ? outcome === 'miss' ? 0 : outcome === 'crit' ? 0.99 : 0.7 : 0.5;}});
    const roll = result.events.find(event => event.type === 'roll');
    expect(roll?.type === 'roll' && roll.roll.advantage).toBe('advantage');
    expect(result.targetState!.hp.current).toBe(outcome === 'miss' ? 50 : outcome === 'crit' ? 38 : 43);
    expect(rolls).toBe(outcome === 'miss' ? 2 : outcome === 'crit' ? 4 : 3);
    expect(result.targetState!.activeEffects).toHaveLength(0);
    expect(result.state.resources.superiority_die).toBe(3);
    const again = executeAction(result.state, attack, {character, selfId: 'source',
      target: {id: 'target', ac: 15, runtimeState: result.targetState}, rng: () => 0.7});
    expect(again.targetState!.hp.current).toBe(result.targetState!.hp.current - 2);
  });
  it('another attacker neither benefits nor consumes the source mark', () => {
    const prepared = prepare();
    let rolls = 0;
    const result = executeAction(fresh(), attack, {character, selfId: 'ally',
      target: {id: 'target', ac: 15, runtimeState: prepared.targetState}, rng: () => {rolls++; return 0.7;}});
    expect(rolls).toBe(1);
    expect(result.targetState!.hp.current).toBe(48);
    expect(result.targetState!.activeEffects).toHaveLength(2);
  });
  it('expires at this source turn end, not the target turn end or next source turn', () => {
    const marked = structuredClone(prepare().targetState!);
    const unrelated = applySourceTurnBoundary(marked, {sourceActorId: 'target', ownerActorId: 'target', boundary: 'end'});
    expect(unrelated.state.activeEffects).toHaveLength(2);
    expect(applySourceTurnBoundary(unrelated.state, {sourceActorId: 'source', ownerActorId: 'target', boundary: 'end'}).state.activeEffects).toHaveLength(0);
  });
});
