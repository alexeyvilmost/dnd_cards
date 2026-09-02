import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  equippedFighterState,
  FIGHTER_CTX_EQUIPPED,
  freshFighterState,
} from '../mvp/fixtures';
import { executeAction } from './execute';

const face = (value: number, sides = 20) => (value - 0.5) / sides;
const sequence = (values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
};

function durableTarget(hp = 40): RuntimeState {
  const state = freshFighterState();
  state.hp = { current: hp, max: hp, temp: 0 };
  return state;
}

const weaponAttack = {
  name: 'Атака оружием',
  effects: [{
    resolution: 'attack_roll',
    attack_kind: 'weapon_melee',
    ability: 'auto',
    on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
  }],
};

describe('универсальный damage_rider', () => {
  it('добавляет отдельную строку урона один раз за попадание оружием', () => {
    const prepared = executeAction(equippedFighterState(), {
      name: 'Божественное благоволение',
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'damage_rider',
          trigger: 'hit_by_attack_roll',
          dice: '1d4',
          type: 'radiant',
          filter: { attackKind: 'weapon' },
          duration: { type: 'rounds', amount: 10 },
        }],
      }],
    }, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'paladin',
      rng: () => 0.5,
    });

    const target = durableTarget();
    const result = executeAction(prepared.state, weaponAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'paladin',
      target: { id: 'target', ac: 10, runtimeState: target },
      rng: sequence([face(15), face(5, 8), face(3, 4)]),
    });

    const damage = result.events.filter((event) => event.type === 'damage');
    expect(damage.map((event) => event.type === 'damage' ? event.damageType : '')).toEqual([
      'slashing',
      'radiant',
    ]);
    expect(result.targetState?.hp.current).toBe(40 - 7 - 3);
  });

  it('удваивает кости райдера на критическом попадании', () => {
    const state = equippedFighterState();
    state.activeEffects.push({
      id: 'favor',
      name: 'Божественное благоволение',
      source: 'Божественное благоволение',
      ownerId: 'paladin',
      sourceId: 'paladin',
      mechanics: {
        kind: 'damage_rider', trigger: 'hit_by_attack_roll', dice: '1d4', type: 'radiant',
        filter: { attackKind: 'weapon' }, duration: { type: 'rounds', amount: 10 },
      },
    });
    const result = executeAction(state, weaponAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'paladin',
      target: { id: 'target', ac: 10, runtimeState: durableTarget() },
      rng: sequence([face(20), face(4, 8), face(4, 8), face(2, 4), face(3, 4)]),
    });
    const radiant = result.events.find((event) => (
      event.type === 'damage' && event.damageType === 'radiant'
    ));
    expect(radiant?.type === 'damage' ? radiant.roll?.dice : []).toHaveLength(2);
    expect(radiant?.type === 'damage' ? radiant.amount : 0).toBe(5);
  });

  it('target-scoped метка срабатывает только для сохранившегося source actor', () => {
    const marked = executeAction(equippedFighterState(), {
      name: 'Метка охотника',
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'damage_rider',
          trigger: 'hit_by_attack_roll',
          dice: '1d6',
          type: 'force',
          scope: 'target',
          source_actor_only: true,
          duration: { type: 'hours', amount: 1, concentration: true },
        }],
      }],
    }, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'ranger',
      target: { id: 'quarry', ac: 10, runtimeState: durableTarget() },
      rng: () => 0.5,
    });
    expect(marked.targetState?.activeEffects[0]).toMatchObject({
      ownerId: 'quarry',
      sourceId: 'ranger',
    });

    const noDamageAttack = {
      name: 'Попадание без базового урона',
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', on_hit: [],
      }],
    };
    const ally = executeAction(equippedFighterState(), noDamageAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'ally',
      target: { id: 'quarry', ac: 10, runtimeState: marked.targetState },
      rng: sequence([face(15)]),
    });
    expect(ally.events.some((event) => event.type === 'damage')).toBe(false);

    const ranger = executeAction(equippedFighterState(), noDamageAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'ranger',
      target: { id: 'quarry', ac: 10, runtimeState: marked.targetState },
      rng: sequence([face(15), face(4, 6)]),
    });
    expect(ranger.events).toContainEqual(expect.objectContaining({
      type: 'damage', damageType: 'force', amount: 4,
    }));
  });

  it('снимает одноразовый райдер после первого подходящего попадания', () => {
    const state = equippedFighterState();
    state.activeEffects.push({
      id: 'basic-poison',
      name: 'Яд, простой',
      source: 'Яд, простой',
      ownerId: 'fighter',
      sourceId: 'fighter',
      mechanics: {
        kind: 'damage_rider', trigger: 'hit_by_attack_roll', dice: '1d4', type: 'poison',
        filter: { attackKind: 'weapon' }, consume: 'next', duration: { type: 'rounds', amount: 10 },
      },
    });
    const target = durableTarget();
    const first = executeAction(state, weaponAttack, {
      character: FIGHTER_CTX_EQUIPPED,
      selfId: 'fighter',
      target: { id: 'target', ac: 10, runtimeState: target },
      rng: sequence([face(15), face(5, 8), face(3, 4)]),
    });

    expect(first.state.activeEffects.some((effect) => effect.id === 'basic-poison')).toBe(false);
    expect(first.events).toContainEqual({ type: 'effect_expired', name: 'Яд, простой' });
    expect(first.events.filter((event) => event.type === 'damage')).toHaveLength(2);
  });
});
