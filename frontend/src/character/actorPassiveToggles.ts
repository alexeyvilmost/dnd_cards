import type {ActorState, RuleActionDefinition} from '../rules-core/domain';
import type {SoloCombatState} from '../solo-combat/types';
import {combatPassiveToggles} from '../solo-combat/actionChoices';
import {decisionPolicyToggles} from '../solo-combat/decisionPolicies';
import type {PassiveTogglePresentation} from '../components/SheetPassiveToggle';

export type PresentedPassiveToggle = PassiveTogglePresentation & {defaultEnabled: boolean};
/** Both sheet and hotbar project the same actor-owned declarations. */
export function actorPassiveToggles(actor: ActorState, actions: readonly RuleActionDefinition[],
  presentation: SoloCombatState['actionPresentation'], choiceActions = actions): PresentedPassiveToggle[] {
  const imageFor = (id: string) => presentation?.[id]?.imageUrl || presentation?.[id]?.actionRef?.image_url || presentation?.[id]?.spellRef?.image_url;
  return [
    ...decisionPolicyToggles('roll_influence'),
    ...actions.filter(action => actor.capabilities.actionIds.includes(action.id)).flatMap(action =>
      decisionPolicyToggles('reaction', action).map(toggle => ({...toggle, sourceName: action.name, imageUrl: toggle.imageUrl || imageFor(action.id)}))),
    ...combatPassiveToggles(actor, choiceActions, id => presentation?.[id]?.actionRef?.card_number)
      .map(toggle => ({...toggle, defaultEnabled: true,
        imageUrl: toggle.imageUrl || imageFor(toggle.parentActionId ?? ''),
        sourceName: actions.find(action => action.id === toggle.parentActionId)?.name})),
  ];
}
