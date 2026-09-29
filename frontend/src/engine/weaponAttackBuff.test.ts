import { describe, expect, it } from 'vitest';
import { CARD_DAGGER, CARD_LONGSWORD, FIGHTER_CTX_EQUIPPED, equippedFighterState, freshFighterState } from '../mvp/fixtures';
import { executeAction } from './execute';
import { collectModifiers } from './modifiers';

const face = (value: number, sides = 20) => (value - 0.5) / sides;

function spell(weaponId: string, damageType: string) {
  return {
    name: 'Elemental weapon test',
    effects: [
      { kind: 'choice', id: 'weapon', context: 'in_play', count: 1,
        options: { source: 'target_equipped_weapon' } },
      { resolution: 'auto', who: 'target', result: [{ kind: 'weapon_attack_buff',
        weapon_choice_id: 'weapon', damage_type: damageType,
        scaling: [
          { min_spell_level: 3, attack_bonus: 1, damage_dice: '1d4' },
          { min_spell_level: 5, attack_bonus: 2, damage_dice: '2d4' },
          { min_spell_level: 7, attack_bonus: 3, damage_dice: '3d4' },
        ], duration: { type: 'hours', amount: 1, concentration: true },
        stack_id: `test:${weaponId}` }] },
    ],
  };
}

describe('data-owned weapon attack buff', () => {
  it.each([
    [CARD_LONGSWORD.id, 'fire', 3, 1, '1d4'],
    [CARD_DAGGER.id, 'cold', 7, 3, '3d4'],
  ] as const)('binds %s to one weapon with %s scaling', (weaponId, damageType, castLevel, bonus, dice) => {
    const state = equippedFighterState();
    const result = executeAction(state, spell(weaponId, damageType), {
      character: FIGHTER_CTX_EQUIPPED, selfId: 'hero',
      target: { id: 'hero', characterContext: FIGHTER_CTX_EQUIPPED, runtimeState: state },
      choices: { weapon: weaponId },
      spell: { baseLevel: 3, castLevel, spellcastingAbility: 'wis', concentration: true },
      rng: () => 0.5,
    });
    expect(result.state.activeEffects).toHaveLength(2);
    const selected = collectModifiers(result.state, [],
      { roll: 'attack', filter: { attackKind: 'weapon', weaponId } });
    expect(selected.modifiers.reduce((sum, modifier) => sum + modifier.value, 0)).toBe(bonus);
    const otherId = weaponId === CARD_LONGSWORD.id ? CARD_DAGGER.id : CARD_LONGSWORD.id;
    const other = collectModifiers(result.state, [],
      { roll: 'attack', filter: { attackKind: 'weapon', weaponId: otherId } });
    expect(other.modifiers).toHaveLength(0);
    expect(result.state.activeEffects.find(effect => effect.mechanics.kind === 'damage_rider')?.mechanics)
      .toMatchObject({ bound_weapon_id: weaponId, dice, type: damageType,
        duration: { concentration: true } });
    const target = freshFighterState();
    target.hp = { current: 40, max: 40, temp: 0 };
    const attack = executeAction(result.state, {
      name: 'Weapon attack', effects: [{ resolution: 'attack_roll', attack_kind: 'weapon_melee',
        ability: 'auto', ...(weaponId === CARD_DAGGER.id ? { tags: ['off_hand'] } : {}),
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }] }],
    }, { character: FIGHTER_CTX_EQUIPPED, selfId: 'hero',
      target: { id: 'enemy', ac: 10, runtimeState: target },
      rng: () => face(15) });
    expect(attack.events.filter(event => event.type === 'damage' && event.damageType === damageType)).toHaveLength(1);
    const rider = attack.events.find(event => event.type === 'damage' && event.damageType === damageType);
    expect(rider?.type === 'damage' ? rider.roll?.dice : []).toHaveLength(Number(dice[0]));
  });

  it('rejects a weapon that is not equipped by the recipient', () => {
    const state = freshFighterState();
    expect(() => executeAction(state, spell(CARD_LONGSWORD.id, 'fire'), {
      character: FIGHTER_CTX_EQUIPPED, selfId: 'hero',
      target: { id: 'hero', characterContext: FIGHTER_CTX_EQUIPPED, runtimeState: state },
      choices: { weapon: CARD_LONGSWORD.id },
      spell: { baseLevel: 3, castLevel: 3, spellcastingAbility: 'wis' }, rng: () => 0.5,
    })).toThrow();
  });

  it('uses an ally target’s equipment rather than the caster’s equipment', () => {
    const caster = freshFighterState();
    const ally = equippedFighterState();
    const result = executeAction(caster, spell(CARD_DAGGER.id, 'lightning'), {
      character: FIGHTER_CTX_EQUIPPED, selfId: 'caster',
      target: { id: 'ally', characterContext: FIGHTER_CTX_EQUIPPED, runtimeState: ally },
      choices: { weapon: CARD_DAGGER.id },
      spell: { baseLevel: 3, castLevel: 5, spellcastingAbility: 'wis', concentration: true },
      rng: () => 0.5,
    });
    expect(result.state.activeEffects).toHaveLength(0);
    expect(result.targetState?.activeEffects).toHaveLength(2);
    expect(result.targetState?.activeEffects.find(effect => effect.mechanics.kind === 'damage_rider')?.mechanics)
      .toMatchObject({ bound_weapon_id: CARD_DAGGER.id, dice: '2d4', type: 'lightning' });
  });
});
