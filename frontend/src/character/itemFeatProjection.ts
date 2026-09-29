import type {CharacterContext, RuntimeState} from '../mvp/contracts';
import {itemSourceRequirementIssue} from '../engine/actionRequirements';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildCharacterContext} from './runtime';
import {itemGate} from './attunement';

/** Re-run the same rule resolver when an item grant has been revoked. A stored
 * +1 delta is not sufficient at ability caps or with overlapping proficiencies. */
export function projectItemFeatCharacter(character:CharacterContext,state:RuntimeState):CharacterContext{
  const input=character.itemFeatRuleInput;
  if(!input)return character;
  const available=(mechanics:Record<string,unknown>|null|undefined)=>!mechanics
    ||!itemSourceRequirementIssue(mechanics,state,character);
  const effects=input.assembled.effects.filter(row=>available(row.effect.mechanics));
  const actions=input.assembled.actions.filter(row=>available(row.action.mechanics));
  // Recompute even when every source is present: this context may have been
  // saved while a provider was absent and must regain its grants on re-equipping.
  const cards=new Map((character.knownCards??[]).map(card=>[card.id,card]));
  const gate={equipment:state.equipment,inventory:state.inventory,attuned:character.attunedIds??[]};
  const rules=resolveCharacterRules({...input,assembled:{...input.assembled,effects,actions},
    runtimeSources:input.runtimeSources?.filter(row=>row.source.type!=='item'||!!cards.get(row.source.id)&&itemGate(cards.get(row.source.id)!,gate))});
  const projected=buildCharacterContext(rules,input.draft,character.equippedCards??[],input.assembled.klass);
  return {...character,...projected,knownCards:character.knownCards,itemFeatRuleInput:input};
}
