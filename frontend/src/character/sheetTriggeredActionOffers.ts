import { canPay } from '../engine/cost';
import type { EngineEvent, ReactionOffer, RuntimeState } from '../mvp/contracts';
import { parseWeaponProfile } from '../rules-core/weaponProfile';
import type { Card } from '../types';
import type { SheetAction } from './actionSheet';

type Dict = Record<string, unknown>;

function attackOutcome(events: readonly EngineEvent[]): 'hit' | 'miss' | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'roll' || event.roll.kind !== 'd20') continue;
    if (event.roll.outcome === 'hit' || event.roll.outcome === 'crit') return 'hit';
    if (event.roll.outcome === 'miss') return 'miss';
  }
  return null;
}

function sourceCardNumber(action: SheetAction): string | null {
  return action.actionRef?.card_number ?? action.spellRef?.card_number ?? null;
}

function sourceQualifies(input: {
  action: SheetAction;
  trigger: Dict;
  equipment: RuntimeState['equipment'];
  cards: ReadonlyMap<string, Card>;
}): boolean {
  const source = sourceCardNumber(input.action);
  const required = [
    ...(typeof input.trigger.source_action_card_number === 'string'
      ? [input.trigger.source_action_card_number]
      : []),
    ...(Array.isArray(input.trigger.source_action_card_numbers)
      ? input.trigger.source_action_card_numbers.filter((value): value is string => typeof value === 'string')
      : []),
  ];
  if (!required.length || !source || !required.includes(source)) return false;
  if (input.trigger.source_weapon_qualifier !== 'monk_weapon') return true;
  if (source === 'action_basic_unarmed') return true;
  if (source !== 'action_basic_weapon') return false;
  const weaponId = input.equipment.main_hand;
  const weapon = weaponId ? input.cards.get(weaponId) : undefined;
  if (!weapon) return false;
  const parsed = parseWeaponProfile(weapon);
  return parsed.valid
    && parsed.profile.defaultAttackMode === 'melee'
    && (parsed.profile.proficiencyCategory === 'simple'
      || (parsed.profile.proficiencyCategory === 'martial'
        && parsed.profile.properties.includes('light')));
}

/**
 * Canonical sheet attacks resolve their roll inside the world engine and do
 * not return the legacy pendingReactions array. Preserve data-owned follow-up
 * actions (Brawler, Monk Martial Arts) at that adapter boundary instead of
 * teaching the UI their localized names.
 */
export function sheetTriggeredActionOffersAfterAttack(input: {
  action: SheetAction;
  events: readonly EngineEvent[];
  triggerSources: readonly Dict[];
  state: RuntimeState;
  equipment: RuntimeState['equipment'];
  cards: ReadonlyMap<string, Card>;
  existing?: readonly ReactionOffer[];
}): ReactionOffer[] {
  const event = attackOutcome(input.events);
  if (!event) return [...(input.existing ?? [])];
  const offers = [...(input.existing ?? [])];
  const seen = new Set(offers.map((offer) => offer.listenerId));
  for (const mechanics of input.triggerSources) {
    const activation = mechanics.activation as Dict | undefined;
    const mode = String(activation?.mode ?? '');
    const trigger = activation?.trigger as Dict | undefined;
    if ((mode !== 'triggered' && mode !== 'reaction') || trigger?.event !== event) continue;
    // This bridge is intentionally limited to explicit source-action filters.
    // General reactions continue to come from the engine's pending queue.
    if (!sourceQualifies({
      action: input.action,
      trigger: trigger ?? {},
      equipment: input.equipment,
      cards: input.cards,
    })) continue;
    const cost = Array.isArray(activation?.cost) ? activation.cost as Dict[] : [];
    if (!canPay(input.state, cost).ok) continue;
    const listenerId = String(mechanics.id ?? mechanics.name ?? 'triggered-action');
    if (seen.has(listenerId)) continue;
    seen.add(listenerId);
    offers.push({
      listenerId,
      name: String(mechanics.name ?? 'Доступное действие'),
      mechanics,
      cost,
      event: { kind: event },
    });
  }
  return offers;
}
