import type {ActorState, RuleActionDefinition} from './domain';

/** Data-owned defense for the triggering attack only, without a lasting AC effect. */
export function singleAttackDefenseBonus(action: RuleActionDefinition): number {
  const policy = action.mechanics.attack_defense as Record<string, unknown> | undefined;
  const bonus = policy?.ac_bonus;
  return policy?.scope === 'triggering_attack' && typeof bonus === 'number'
    && Number.isFinite(bonus) && bonus > 0 ? bonus : 0;
}

export function meleeWeaponDefenseEligible(defender: ActorState, incoming: RuleActionDefinition): boolean {
  const effects = Array.isArray(incoming.mechanics.effects) ? incoming.mechanics.effects as Record<string, unknown>[] : [];
  const melee = effects.some(effect => effect.resolution === 'attack_roll'
    && (effect.attack_kind === 'unarmed' || String(effect.attack_kind).includes('melee')));
  const cards = [...(defender.character.knownCards ?? []), ...(defender.character.equippedCards ?? [])];
  const held = ['main_hand', 'off_hand'].some(slot => {
    const id = defender.runtime.equipment[slot];
    return id && cards.some(card => card.id === id && card.type === 'weapon');
  });
  return melee && held;
}
