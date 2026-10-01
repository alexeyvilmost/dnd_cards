import type { RuleActionDefinition } from '../rules-core/domain';
import type { SpellcastingAccessState } from '../rules-core/spellcastingAccess';
import type { SoloCombatState } from './types';
import { FREEUSE_SHOWCASE_KEY, isFreeusePoolKey } from '../engine/freeuse';
import { actionCostResourceIds } from '../utils/resourcePresentation';
import { worldItemActionSource } from '../rules-core/worldItemActions';
import { collectGrantActionSlugs } from '../mechanics/actionGrants';
import { actionPresentationGroup, type ActionPresentationGroup } from '../character/actionPresentationGroups';

export type CombatHotbarGroup = ActionPresentationGroup;
export { ACTION_PRESENTATION_GROUPS as COMBAT_HOTBAR_GROUPS } from '../character/actionPresentationGroups';

/** A trigger changes activation timing, not the existence of the capability. */
export function isCombatHotbarAction(action: RuleActionDefinition): boolean {
  return typeof action.mechanics.variant_of_action_id !== 'string'
    && typeof action.mechanics.variant_of_spell_id !== 'string';
}

/** Catalog definitions survive consumption. Only the current actor's physical
 * inventory/equipment (or an explicitly granting world instance) owns an item
 * capability; knownCards is content identity, never an extra item copy.
 * Timing, attunement and empty charge pools remain availability concerns. */
export function combatHotbarActionHasSource(
  state: Pick<SoloCombatState, 'world' | 'actionPresentation'>,
  actorId: string,
  action: RuleActionDefinition,
): boolean {
  const actor = state.world.actors[actorId];
  if (!actor) return false;
  const cards = [...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])];
  const required = action.mechanics.requires_item_source;
  const alternatives = action.mechanics.requires_any_item_source;
  const actionReferences = [action.id, ...action.sourceEntityIds, state.actionPresentation?.[action.id]?.actionRef?.card_number];
  const sources = typeof required === 'string' && required
    ? [required]
    : Array.isArray(alternatives) && alternatives.length
      ? alternatives.filter((source): source is string => typeof source === 'string' && !!source)
      : cards.filter(card => action.sourceEntityIds.some(id => id === card.id || id === card.card_number)
          // Older frozen grants carry item provenance in the provider card,
          // rather than requires_any_item_source. Read that same declaration.
          || action.mechanics.damage_source_kind === 'item' && collectGrantActionSlugs(card.mechanics)
            .some(reference => actionReferences.includes(reference)))
        .map(card => card.id);
  if (!sources.length) return true;
  return sources.some(reference => {
    const cardId = cards.find(card => card.id === reference || card.card_number === reference)?.id ?? reference;
    return Object.values(actor.runtime.equipment).includes(cardId)
      || actor.runtime.inventory.some(row => row.cardId === cardId && row.qty > 0)
      || !!worldItemActionSource(state.world, actorId, {
        ...action, mechanics: {...action.mechanics, requires_item_source: cardId},
      });
  });
}

/** Use immutable content provenance and requirements, never display labels. */
export function combatHotbarActionGroup(
  state: Pick<SoloCombatState, 'world' | 'actionPresentation'>,
  actorId: string,
  action: RuleActionDefinition,
): CombatHotbarGroup {
  const actor = state.world.actors[actorId];
  const cards = [...(actor?.character.knownCards ?? []), ...(actor?.character.equippedCards ?? [])];
  const origin = cards.some(card => action.sourceEntityIds?.some(id => id === card.id || id === card.card_number))
    ? 'item' : action.kind === 'spell' ? 'spell'
      : state.actionPresentation?.[action.id]?.actionRef?.type === 'basic' ? 'basic' : 'class';
  return actionPresentationGroup(origin,action.mechanics);
}

function grantUsesSlot(grant: SpellcastingAccessState['grants'][number], resourceId: string): boolean {
  if (grant.slotResource === resourceId) return true;
  const selected = /^(spell_slot|pact_slot|warlock_spell_slot)_([1-9])$/.exec(resourceId);
  const declared = /^(spell_slot|pact_slot|warlock_spell_slot)_([1-9])$/.exec(grant.slotResource ?? '');
  // The canonical spell-access resolver permits raising a cast within its
  // declared slot family. It still decides preparation, balance and payment.
  return !!selected && !!declared && selected[1] === declared[1]
    && Number(selected[2]) >= grant.level && Number(selected[2]) >= Number(declared[2]);
}

export function filterCombatActionsByResource(
  actions: readonly RuleActionDefinition[],
  selectedResourceId: string | null,
  freeuseActionIds: ReadonlySet<string>,
  spellcastingAccess?: SpellcastingAccessState,
): RuleActionDefinition[] {
  const parents = actions.filter(isCombatHotbarAction);
  if (!selectedResourceId) return parents;
  if (selectedResourceId === FREEUSE_SHOWCASE_KEY) {
    return parents.filter(action => freeuseActionIds.has(action.id));
  }
  if (selectedResourceId === 'action_surge_action') {
    return parents.filter(action => action.kind !== 'spell' && actionCostResourceIds(action).includes('action'));
  }
  if (selectedResourceId === 'quickened_spell_action') {
    return parents.filter(action => action.kind === 'spell' && actionCostResourceIds(action).includes('action'));
  }
  return parents.filter(action => {
    const grants = spellcastingAccess?.grants.filter(grant => grant.actionId === action.id) ?? [];
    if (grants.some(grant => grant.freeUseResource === selectedResourceId || grantUsesSlot(grant, selectedResourceId))) return true;
    // Source-scoped grants replace template slot costs (for example Pact
    // Magic), but do not replace bonus actions, item charges or other costs.
    if (grants.length && /^(spell_slot|pact_slot|warlock_spell_slot)_/.test(selectedResourceId)) return false;
    return actionCostResourceIds(action).includes(selectedResourceId);
  });
}

export function combatFreeuseActionIds(
  actions: readonly RuleActionDefinition[],
  maxResources: Readonly<Record<string, number>>,
  access?: SpellcastingAccessState,
): Set<string> {
  return new Set(actions.filter(isCombatHotbarAction).filter(action => (
    access?.grants.some(grant => grant.actionId === action.id && grant.freeUseResource
      && (maxResources[grant.freeUseResource] ?? 0) > 0)
    || actionCostResourceIds(action).some(key => isFreeusePoolKey(key) && (maxResources[key] ?? 0) > 0)
  )).map(action => action.id));
}

export function combatHotbarResourceKeys(
  maxResources: Record<string, number>,
  actions?: readonly RuleActionDefinition[],
  freeuseActionIds: ReadonlySet<string> = new Set(),
  access?: SpellcastingAccessState,
): string[] {
  return Object.entries(maxResources).flatMap(([key, maximum]) => (
    maximum > 0 && key !== 'movement' && !isFreeusePoolKey(key)
      && (!actions || filterCombatActionsByResource(actions, key, freeuseActionIds, access).length > 0) ? [key] : []
  ));
}
